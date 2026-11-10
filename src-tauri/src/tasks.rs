//! 工作台「任务」持久化 —— 每个项目绑一个文件夹，落盘 `~/.clifleet/tasks.json`。
//!
//! ## 为什么落盘成单一 JSON
//! 项目来源（应用内选文件夹 / 命令行 --open-dir 透传）统一写进这份文件。
//! 重启后最近项目还在，右键打开的目录也自动 upsert 成项目。
//!
//! 纯 std + serde_json，零新依赖。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// 项目唯一 id（前端按文件夹生成）
    pub id: String,
    /// 显示名（默认取文件夹名，可重命名）
    pub name: String,
    /// 绑定的文件夹绝对路径
    pub dir: String,
    /// 手动排序权重：0 = 未排（按最近打开置顶，兼容旧数据）；>0 = 显式顺序，越小越靠前。
    /// 由 `reorder_tasks` 整体赋值（1-based）。新建项目保持 0 → 自动冒到顶部。
    #[serde(default)]
    pub order: i64,
    /// 最近打开时间（毫秒，排序用）
    #[serde(default)]
    pub last_opened_at: i64,
    /// 创建时间（毫秒）
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TasksFile {
    version: u32,
    tasks: Vec<Task>,
}

fn tasks_path() -> PathBuf {
    crate::paths::app_home().join("tasks.json")
}

/// 当前毫秒时间戳（i64）。文件不存在等异常时返回 0。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_file() -> TasksFile {
    std::fs::read_to_string(tasks_path())
        .ok()
        .and_then(|s| serde_json::from_str::<TasksFile>(&s).ok())
        .unwrap_or(TasksFile {
            version: 1,
            tasks: Vec::new(),
        })
}

fn write_file(f: &TasksFile) -> Result<(), String> {
    let _ = std::fs::create_dir_all(crate::paths::app_home());
    let s = serde_json::to_string_pretty(f).map_err(|e| format!("序列化任务失败: {e}"))?;
    std::fs::write(tasks_path(), s).map_err(|e| format!("写入 tasks.json 失败: {e}"))
}

/// 列出全部任务。手动排序优先：`order > 0` 按升序（用户拖出来的顺序）；
/// `order == 0`（未排 / 新建）视为置顶，组内再按最近打开倒序——保持「新项目冒顶」的老手感。
#[tauri::command]
pub fn list_tasks() -> Vec<Task> {
    let mut f = read_file();
    f.tasks.sort_by(|a, b| {
        let ka = if a.order == 0 { i64::MIN } else { a.order };
        let kb = if b.order == 0 { i64::MIN } else { b.order };
        ka.cmp(&kb).then(b.last_opened_at.cmp(&a.last_opened_at))
    });
    f.tasks
}

/// 新增 / 更新一个任务（按 id 去重）。每次 upsert 都刷新 last_opened_at（置顶）。
/// created_at 仅首次写入时设。返回写盘后的该任务。
#[tauri::command]
pub fn upsert_task(mut task: Task) -> Result<Task, String> {
    if task.id.trim().is_empty() || task.dir.trim().is_empty() {
        return Err("任务缺少 id 或 dir".into());
    }
    let now = now_ms();
    task.last_opened_at = now;

    let mut f = read_file();
    if let Some(existing) = f.tasks.iter_mut().find(|t| t.id == task.id) {
        // 保留原 created_at 与手动排序权重 order；其余字段以传入为准。
        // （前端 Task 不一定回传 order，重新 upsert 不能把用户拖好的顺序冲掉。）
        task.created_at = if existing.created_at > 0 {
            existing.created_at
        } else {
            now
        };
        task.order = existing.order;
        *existing = task.clone();
    } else {
        if task.created_at == 0 {
            task.created_at = now;
        }
        f.tasks.push(task.clone());
    }
    f.version = 1;
    write_file(&f)?;
    Ok(task)
}

/// 删除一个任务（仅从列表移除，不动文件夹本身）。
#[tauri::command]
pub fn remove_task(id: String) -> Result<(), String> {
    let mut f = read_file();
    f.tasks.retain(|t| t.id != id);
    write_file(&f)
}

/// 重排任务顺序。传入「全部条目 id 的目标顺序」，按位置给持久化任务赋 `order`（1-based）。
/// 不在 `ids` 里的任务保持原 order（理论上不会发生）。
#[tauri::command]
pub fn reorder_tasks(ids: Vec<String>) -> Result<(), String> {
    let mut f = read_file();
    for (i, id) in ids.iter().enumerate() {
        if let Some(t) = f.tasks.iter_mut().find(|t| &t.id == id) {
            t.order = (i as i64) + 1;
        }
    }
    write_file(&f)
}

/// 目录去重键：去尾斜杠 + 小写。与前端 `normDir` 语义一致（跨平台路径大小写不敏感去重）。
fn norm_dir_key(dir: &str) -> String {
    dir.trim_end_matches(['/', '\\']).to_lowercase()
}

#[derive(Serialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub uking_found: bool,
    pub dsh_found: bool,
    pub errors: Vec<String>,
}

fn home_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Read DSH's workspace registry, following its ordered `global.workspaceIds` list.
/// Only reads workspace paths; session rows/messages are never opened.
fn dsh_workspace_paths(value: &serde_json::Value) -> Vec<(String, String)> {
    let Some(ids) = value
        .pointer("/global/workspaceIds")
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    let Some(workspaces) = value
        .pointer("/tables/workspaces")
        .and_then(|v| v.as_object())
    else {
        return Vec::new();
    };

    ids.iter()
        .filter_map(|id| {
            let id = id.as_str()?;
            let row = workspaces.get(id)?;
            let path = row.get("path")?.as_str()?.trim();
            if path.is_empty() || !Path::new(path).is_dir() {
                return None;
            }
            let name = row
                .get("title")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| {
                    Path::new(path)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or(path)
                });
            Some((name.to_string(), path.to_string()))
        })
        .collect()
}

/// Import project directories from U-King and DSH. External data is read-only;
/// existing CliFleet entries are preserved and duplicate paths are skipped.
#[tauri::command]
pub fn import_workspaces() -> Result<ImportSummary, String> {
    let home = home_dir();
    let uking_path = home.join(".uking").join("tasks.json");
    let dsh_path = home.join(".dsh").join("storages").join("workspace.json");
    let mut errors = Vec::new();
    let mut candidates: Vec<(String, String, String)> = Vec::new();
    let uking_found = uking_path.is_file();
    let dsh_found = dsh_path.is_file();

    if uking_found {
        match std::fs::read_to_string(&uking_path)
            .map_err(|e| e.to_string())
            .and_then(|text| serde_json::from_str::<TasksFile>(&text).map_err(|e| e.to_string()))
        {
            Ok(source) => candidates.extend(source.tasks.into_iter().filter_map(|t| {
                (Path::new(&t.dir).is_dir() && !t.id.trim().is_empty())
                    .then_some((t.id, t.name, t.dir))
            })),
            Err(e) => errors.push(format!("U-King: {e}")),
        }
    }

    if dsh_found {
        match std::fs::read_to_string(&dsh_path)
            .map_err(|e| e.to_string())
            .and_then(|text| {
                serde_json::from_str::<serde_json::Value>(&text).map_err(|e| e.to_string())
            }) {
            Ok(value) => {
                candidates.extend(dsh_workspace_paths(&value).into_iter().map(|(name, dir)| {
                    let id = format!("dsh-import:{}", norm_dir_key(&dir));
                    (id, name, dir)
                }))
            }
            Err(e) => errors.push(format!("DSH: {e}")),
        }
    }

    let mut f = read_file();
    let mut existing: std::collections::HashSet<String> =
        f.tasks.iter().map(|t| norm_dir_key(&t.dir)).collect();
    let mut imported = 0usize;
    let mut skipped = 0usize;
    for (id, name, dir) in candidates {
        let key = norm_dir_key(&dir);
        if !existing.insert(key) {
            skipped += 1;
            continue;
        }
        let now = now_ms();
        f.tasks.push(Task {
            id,
            name,
            dir,
            order: 0,
            last_opened_at: now,
            created_at: now,
        });
        imported += 1;
    }

    if imported > 0 {
        f.version = 1;
        write_file(&f)?;
    }
    Ok(ImportSummary {
        imported,
        skipped,
        uking_found,
        dsh_found,
        errors,
    })
}

#[cfg(test)]
mod import_tests {
    use super::dsh_workspace_paths;

    #[test]
    fn dsh_parser_uses_ordered_registry_and_ignores_session_data() {
        let dir = std::env::temp_dir();
        let path = dir.to_string_lossy();
        let value = serde_json::json!({
            "global": { "workspaceIds": ["b", "a", "missing"] },
            "tables": { "workspaces": {
                "a": { "path": "/path/that/does/not/exist", "title": "stale" },
                "b": { "path": path, "title": "temporary" }
            } },
            "sessionMessages": [{ "text": "must not be considered a path" }]
        });
        let paths = dsh_workspace_paths(&value);
        assert_eq!(paths, vec![("temporary".to_string(), path.to_string())]);
    }

    #[test]
    fn dsh_parser_returns_empty_for_unknown_schema() {
        assert!(dsh_workspace_paths(&serde_json::json!({ "unexpected": true })).is_empty());
    }
}
