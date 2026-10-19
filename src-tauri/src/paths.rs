//! 路径与子进程 PATH 注入 —— OpenCodex 子进程 PATH 的唯一真相源。
//!
//! 双击启动（Explorer / Finder）给的 PATH 往往不含 npm 全局目录、homebrew 等
//! （它们一般只写进了 shell profile），导致明明装了 claude/codex 却找不到。
//! 所以子进程 PATH **追加**这几个已知位置兜底——只补不抢，用户自己的 PATH 优先。
//!
//! 纯路径子集 —— 不含任何下载/安装/商业逻辑。

use std::path::{Path, PathBuf};

/// OpenCodex 数据根目录。优先级：
/// 1. `OPENCODEX_HOME` 环境变量（测试/特殊部署显式指定，隔离验证用）；
/// 2. exe 旁的 `portable-data/`（绿色包/U 盘场景：数据跟着程序走，不留痕在本机）；
/// 3. `$HOME/.opencodex`（默认安装形态）。
/// 任务列表、日志落在这里。
pub fn app_home() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENCODEX_HOME") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let portable = dir.join("portable-data");
            if portable.is_dir() {
                return portable;
            }
        }
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    Path::new(&home).join(".opencodex")
}

/// 用户主目录（终端默认 cwd）。
pub fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}

/// 子进程 PATH 应前置的已知工具目录（顺序即优先级）。
pub fn search_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    #[cfg(windows)]
    {
        // npm 默认全局 prefix，claude.cmd / codex.cmd 在这
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm = Path::new(&appdata).join("npm");
            if npm.exists() {
                v.push(npm);
            }
        }
        // 用户常把 CLI 手动放进 ~/bin、~/.local/bin
        if let Ok(home) = std::env::var("USERPROFILE") {
            for sub in ["bin", ".local/bin"] {
                let p = Path::new(&home).join(sub);
                if p.exists() {
                    v.push(p);
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        // macOS：Finder 启动的 app PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin
        for d in ["/opt/homebrew/bin", "/usr/local/bin"] {
            let p = PathBuf::from(d);
            if p.exists() {
                v.push(p);
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            for sub in [".npm-global/bin", ".local/bin"] {
                let p = Path::new(&home).join(sub);
                if p.exists() {
                    v.push(p);
                }
            }
        }
    }
    v
}

/// 把 `search_paths` 拼进子进程 `PATH` 的字符串。
///
/// **追加而不是前置**：这些目录只是「PATH 很瘦时的兜底查找」，不能抢用户自己的优先级。
/// （前置过的教训：机器上同时存在能用的 `~/.uking/runtime/node/claude` 和坏掉的
/// npm shim，前置 npm 全局目录后反而先命中坏 shim，把好 CLI 挤到后面。）
/// 已经在 PATH 里的目录跳过，不打乱原有顺序。
pub fn path_prefix() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let old = std::env::var("PATH").unwrap_or_default();
    let existing: Vec<String> = old
        .split(sep)
        .map(|s| s.trim_end_matches(['/', '\\']).to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    let extra: Vec<String> = search_paths()
        .iter()
        .filter(|d| {
            let key = d.display().to_string().trim_end_matches(['/', '\\']).to_lowercase();
            !key.is_empty() && !existing.contains(&key)
        })
        .map(|d| d.display().to_string())
        .collect();
    if extra.is_empty() {
        old
    } else if old.is_empty() {
        extra.join(sep)
    } else {
        format!("{old}{sep}{}", extra.join(sep))
    }
}
