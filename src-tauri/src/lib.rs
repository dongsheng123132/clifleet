//! OpenCodex —— 极简的「基于文件夹的 CLI 终端工作台」（Tauri 入口）。
//!
//! 只做三件事：选文件夹、最近项目列表、每个项目多终端标签。
//! 不做模型配置 / API Key / 端点 / 文件预览 / 浏览器 / 对话流 —— 那些都归 claude、codex
//! 等 CLI 自己管；本工作台的终端完整继承用户已配置的环境，不注入任何模型/代理变量。
//!
//! 模块分工：
//! - `paths`   子进程 PATH 注入（唯一真相源）
//! - `term`    应用内 PTY 终端（portable_pty）
//! - `tasks`   项目/任务持久化（~/.opencodex/tasks.json）
//! - `logs`    本地 bug 收集（纯本地，无上报）
//!
//! 暴露给前端的 command 见底部 `invoke_handler`。

mod logs;
mod paths;
mod tasks;
mod term;

use serde::Serialize;
use tauri::Manager;

/// 启动时探测到的环境信息（前端用）。
#[derive(Debug, Clone, Serialize)]
struct AppEnv {
    /// 平台（windows / macos / linux）
    platform: String,
    /// 用户主目录（`--open-dir` 之外的回落 cwd 用）
    home_dir: String,
    /// 命令行 `--open-dir` 透传进来的目录（CLI 集成预留），无则空
    opened_dir: Option<String>,
}

#[tauri::command]
fn get_env() -> AppEnv {
    AppEnv {
        platform: std::env::consts::OS.to_string(),
        home_dir: paths::home_dir(),
        opened_dir: parse_open_dir_arg(),
    }
}

/// 读系统剪贴板文本。WebView2 的 navigator.clipboard 在 xterm 焦点下常被拒，
/// 改走 Rust 直读，终端粘贴 100% 可靠。读不到（无文本/空）返回空串。
#[tauri::command]
fn clipboard_read() -> Result<String, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    Ok(cb.get_text().unwrap_or_default())
}

/// 写系统剪贴板文本（终端选区复制用）。
#[tauri::command]
fn clipboard_write(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

/// 在系统文件管理器里打开文件夹（项目路径栏的「打开」按钮）。
/// 不做任何注入，就是资源管理器原样打开。
#[tauri::command]
fn reveal_dir(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

// ============================================================
// 辅助
// ============================================================

/// 解析命令行 `--open-dir <path>`（CLI / 右键集成预留）。
fn parse_open_dir_arg() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--open-dir" {
            if let Some(p) = it.next() {
                if !p.is_empty() {
                    return Some(p.clone());
                }
            }
        }
    }
    None
}

// ============================================================
// 入口
// ============================================================

pub fn run() {
    // 先装 panic 钩子：之后任何线程 panic 都先落盘再 abort（panic=abort 下也有据可查）
    logs::install_panic_hook();

    let args: Vec<String> = std::env::args().collect();

    // 终端无头验证：opencodex --term-test "<cmd>"（验证 PTY + PATH 注入，不依赖 GUI）
    if let Some(i) = args.iter().position(|a| a == "--term-test") {
        let cmd = args.get(i + 1).cloned().unwrap_or_else(|| "node --version".into());
        match term::headless_run(&cmd, 8000) {
            Ok(out) => {
                println!("{out}");
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("term-test 失败: {e}");
                std::process::exit(1);
            }
        }
    }

    // 崩溃-清理自检：opencodex --term-kill-test（验证关闭会话杀整棵进程树、不留孤儿）
    #[cfg(windows)]
    if args.iter().any(|a| a == "--term-kill-test") {
        println!("{}", term::headless_kill_test());
        std::process::exit(0);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 窗口退出（含点 × 关闭）时杀光所有 PTY 进程树 —— 安全底子，绝不留孤儿。
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    term::close_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_env,
            clipboard_read,
            clipboard_write,
            reveal_dir,
            term::term_open,
            term::term_write,
            term::term_resize,
            term::term_close,
            tasks::list_tasks,
            tasks::upsert_task,
            tasks::remove_task,
            tasks::reorder_tasks,
            logs::app_log,
        ])
        .build(tauri::generate_context!())
        .expect("启动 OpenCodex 失败")
        .run(|_app, event| {
            // 事件循环退出（Cmd+Q / 最后一个窗口关掉后的 RunEvent::Exit 等）再兜底一次。
            if let tauri::RunEvent::Exit = event {
                term::close_all();
            }
        });
}
