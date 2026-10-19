//! 工作台「任务」持久化 —— 每个项目绑一个文件夹，落盘 `~/.opencodex/tasks.json`。
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
    pub source_exists: bool,
}

/// 从 U-King 工作台导入项目（`~/.uking/tasks.json` → OpenCodex 项目列表）。
///
/// 只增不删：已按目录去重存在的任务计入 skipped，绝不改动已有条目。
/// U-King 的 `order` 是它自己的排序权重，直接沿用会打乱 OpenCodex 的排序手感，
/// 所以导入时统一置 0（0 = 未排/置顶），`last_opened_at` 保留源值便于确定顺序。
#[tauri::command]
pub fn import_uking_tasks() -> Result<ImportSummary, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    let src = Path::new(&home).join(".uking").join("tasks.json");
    let text = match std::fs::read_to_string(&src) {
        Ok(t) => t,
        Err(_) => {
            return Ok(ImportSummary {
                imported: 0,
                skipped: 0,
                source_exists: false,
            });
        }
    };
    let source: TasksFile =
        serde_json::from_str(&text).map_err(|e| format!("解析 U-King tasks.json 失败: {e}"))?;

    let mut f = read_file();
    let mut existing: std::collections::HashSet<String> =
        f.tasks.iter().map(|t| norm_dir_key(&t.dir)).collect();

    let mut imported = 0usize;
    let mut skipped = 0usize;
    for mut t in source.tasks {
        if t.dir.trim().is_empty() || t.id.trim().is_empty() {
            continue; // 空白条目不计入 skipped
        }
        if existing.contains(&norm_dir_key(&t.dir)) {
            skipped += 1;
            continue;
        }
        let now = now_ms();
        if t.created_at == 0 {
            t.created_at = now;
        }
        if t.last_opened_at == 0 {
            t.last_opened_at = now;
        }
        t.order = 0;
        existing.insert(norm_dir_key(&t.dir));
        f.tasks.push(t);
        imported += 1;
    }

    if imported > 0 {
        f.version = 1;
        write_file(&f)?;
    }
    Ok(ImportSummary {
        imported,
        skipped,
        source_exists: true,
    })
}
