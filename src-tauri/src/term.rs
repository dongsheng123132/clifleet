//! 应用内真终端（PTY）—— Rust 拥有伪终端，前端 xterm.js 只渲染 + 转发输入。
//!
//! ## 为什么自己起 PTY 而不弹外部窗口
//! 外部 PowerShell 用 `-NoProfile` 又不注入 PATH，导致 claude/codex 等 CLI 找不到命令。
//! 这里复用 `paths::path_prefix`（统一口径的 PATH），把 npm 全局、~/bin 等目录前置进
//! 子 shell 的 PATH —— 装过的 CLI 因此能直接跑。
//!
//! ## 环境
//! 子进程只覆盖 `PATH`（前置已知工具目录）与 `TERM`，**不注入任何模型/代理/工具目录变量** ——
//! 完整沿用用户已配置的环境（profile 里的别名、claude/codex 自己的配置都原样生效）。
//!
//! ## 生命周期
//! 一个会话 = 一个长驻 shell。切项目只 hide UI，不杀进程。窗口退出时 `close_all()`
//! 杀光所有 PTY 进程树（不留孤儿）。
//! 输出走 Tauri Channel 流回前端；键盘经 `term_write` 写回 PTY stdin。
//!
//! ## panic=abort 安全
//! release profile 是 `panic="abort"`，reader 线程内一旦 panic 会整体 abort。
//! 因此 reader/writer 热路径**零 unwrap/expect**，全部 `let _ =` / `if let Ok`。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
#[cfg(windows)]
use std::os::windows::process::CommandExt; // taskkill 用 creation_flags 隐藏黑框

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use crate::paths::path_prefix;

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

fn sessions() -> &'static Mutex<HashMap<String, PtySession>> {
    static S: OnceLock<Mutex<HashMap<String, PtySession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 单调递增会话 id（不引 uuid）。
fn next_id() -> String {
    static N: OnceLock<Mutex<u64>> = OnceLock::new();
    let m = N.get_or_init(|| Mutex::new(0));
    let mut g = match m.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *g += 1;
    format!("t{}", *g)
}

/// 前置已知工具目录的 PATH，让 claude/codex 等 CLI 可解析。
fn build_path() -> String {
    path_prefix()
}

fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}

/// cwd 选择：传入路径非空且确为已存在目录则用它，否则回落 home。
fn resolve_cwd(cwd: Option<String>) -> String {
    cwd.map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty() && std::path::Path::new(p).is_dir())
        .unwrap_or_else(home_dir)
}

/// Windows 下定位 PowerShell 7（pwsh.exe）：用户 profile 里的别名/UTF-8 配置都依赖它。
/// 先查标准安装路径，再退回系统 PATH 上的 `pwsh.exe`；都没有返回 None（回落 5.1）。
#[cfg(windows)]
fn find_pwsh7() -> Option<String> {
    // 标准安装位置（系统级 / 用户级）
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for env in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(env) {
            candidates.push(std::path::Path::new(&base).join("PowerShell").join("7").join("pwsh.exe"));
        }
    }
    for c in candidates {
        if c.exists() {
            return Some(c.display().to_string());
        }
    }
    // 退回系统 PATH 上的 pwsh.exe（pwsh 7 安装时通常会写进 PATH）
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            if dir.is_empty() {
                continue;
            }
            let p = std::path::Path::new(dir).join("pwsh.exe");
            if p.exists() {
                return Some(p.display().to_string());
            }
        }
    }
    None
}

/// 构造交互式 shell 命令。Windows 优先 PowerShell 7（pwsh），保留用户 profile
/// （别名 cc/cx/gem、UTF-8 等都在里面）；没装 7 则回退 Windows PowerShell 5.1。
/// 都不加 -NoProfile（要用户 profile 里的 PATH/别名），我们额外前置已知工具目录。
#[cfg(windows)]
fn shell_builder() -> CommandBuilder {
    let exe = find_pwsh7().unwrap_or_else(|| "powershell.exe".into());
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(["-NoLogo"]);
    cmd
}

#[cfg(not(windows))]
fn shell_builder() -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd
}

/// 无头自检：起一个 PTY 跑一条命令，把输出收集回来（验证 PATH 注入 + ConPTY 正常）。
/// 给 `--term-test <cmd>` 用，不依赖 GUI / xterm。
pub fn headless_run(cmd: &str, timeout_ms: u64) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 100, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut builder = shell_builder();
    builder.env("PATH", build_path());
    builder.env("TERM", "xterm-256color");
    builder.cwd(home_dir());
    let mut child = pair.slave.spawn_command(builder).map_err(|e| format!("spawn: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
    let mut writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;

    let out = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
    let out2 = out.clone();
    let t = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(mut g) = out2.lock() {
                        g.extend_from_slice(&buf[..n]);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let _ = writer.write_all(cmd.as_bytes());
    let _ = writer.write_all(b"\r\n");
    let _ = writer.write_all(b"exit\r\n");
    let _ = writer.flush();

    // 简单超时等待
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < timeout_ms as u128 {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let _ = child.kill();
    drop(pair.master);
    let _ = t.join();

    let g = out.lock().map_err(|_| "lock")?;
    Ok(String::from_utf8_lossy(&g).to_string())
}

/// 查某 pid 是否还活着（无额外依赖，给崩溃自检用）。
#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .creation_flags(0x0800_0000)
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")),
        Err(_) => false,
    }
}
#[cfg(not(windows))]
fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 崩溃自检用：起一个 shell（同 term_open 路径），让它内部跑一个常驻 node 子进程
/// （模拟 claude/codex/node），返回 (child 句柄, writer, master, shell_pid, node_pid)。
/// node 会把自己的 pid 写到临时文件，便于事后判断它是否被清掉。
#[cfg(windows)]
fn spawn_shell_with_node(
    tag: &str,
) -> Result<
    (
        Box<dyn portable_pty::Child + Send + Sync>,
        Box<dyn Write + Send>,
        Box<dyn portable_pty::MasterPty + Send>,
        u32,
        u32,
    ),
    String,
> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 100, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut builder = shell_builder();
    builder.env("PATH", build_path());
    builder.env("TERM", "xterm-256color");
    builder.cwd(home_dir());
    let mut child = pair.slave.spawn_command(builder).map_err(|e| format!("spawn shell: {e}"))?;
    drop(pair.slave);
    let mut writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;
    // 必须持续读，否则 pwsh 输出写满 PTY 缓冲会卡住，node 命令发不进去
    if let Ok(mut r) = pair.master.try_clone_reader() {
        std::thread::spawn(move || {
            let mut b = [0u8; 4096];
            loop {
                match r.read(&mut b) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });
    }
    let shell_pid = child.process_id().ok_or("拿不到 shell pid")?;

    let pidfile = std::env::temp_dir().join(format!("octest_{tag}.pid"));
    let _ = std::fs::remove_file(&pidfile);
    let pf = pidfile.display().to_string().replace('\\', "/");
    // node 子进程：写自己 pid → 文件，然后常驻（1e9ms 一个空定时器，挂着不退）
    let cmd = format!(
        "node -e \"require('fs').writeFileSync('{pf}', String(process.pid)); setInterval(()=>{{}}, 1e9)\"\r\n"
    );
    writer.write_all(cmd.as_bytes()).map_err(|e| format!("write: {e}"))?;
    let _ = writer.flush();

    // 等 node 起来写 pid（最多 8s）
    let start = std::time::Instant::now();
    let mut node_pid = None;
    while start.elapsed().as_secs() < 8 {
        if let Ok(s) = std::fs::read_to_string(&pidfile) {
            if let Ok(p) = s.trim().parse::<u32>() {
                node_pid = Some(p);
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = std::fs::remove_file(&pidfile);
    let node_pid = match node_pid {
        Some(p) => p,
        None => {
            // node 没起来：先把 pwsh 清掉别泄漏，再报错
            kill_tree(shell_pid);
            let _ = child.kill();
            return Err("node 子进程未起来(测试环境无 node?)".into());
        }
    };
    Ok((child, writer, pair.master, shell_pid, node_pid))
}

/// 无头崩溃-清理自检：复现「shell 起子进程 → 关会话」，对照验证 kill_tree 不留孤儿。
/// 给 `--term-kill-test` 用，不依赖 GUI。返回人读报告。
#[cfg(windows)]
pub fn headless_kill_test() -> String {
    let mut report = String::new();

    // ===== A 组：只 child.kill() 杀顶层 pwsh（模拟没有 kill_tree 的旧行为）=====
    //          期望：node 子进程变孤儿、继续存活 —— 复现崩溃根因
    match spawn_shell_with_node("a") {
        Ok((mut child, _w, _m, shell_pid, node_pid)) => {
            let _ = child.kill(); // 只杀顶层，不动子树
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let node_alive = pid_alive(node_pid);
            report.push_str(&format!(
                "A 组 (仅杀顶层 child.kill): node 子进程(pid {node_pid}) 存活={node_alive}  →  {}\n",
                if node_alive {
                    "✅ 复现旧 bug：顶层一杀，子进程变孤儿继续占资源"
                } else {
                    "（本机父死子亡，少见；说明 portable-pty 自带 job 级联杀）"
                }
            ));
            // 清掉 A 组遗留（不管死活都兜底）
            kill_tree(shell_pid);
            kill_tree(node_pid);
        }
        Err(e) => report.push_str(&format!("A 组 setup 失败: {e}\n")),
    }

    // ===== B 组：调真正的 kill_tree（term_close 用的同一函数）=====
    //          期望：shell + node 整棵树全清光 —— 验证修复
    match spawn_shell_with_node("b") {
        Ok((mut child, _w, _m, shell_pid, node_pid)) => {
            kill_tree(shell_pid); // ← 真·修复路径（term_close 内部就是这一句）
            let _ = child.kill();
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let shell_alive = pid_alive(shell_pid);
            let node_alive = pid_alive(node_pid);
            let pass = !shell_alive && !node_alive;
            report.push_str(&format!(
                "B 组 (kill_tree 整棵树): shell(pid {shell_pid}) 存活={shell_alive}, node(pid {node_pid}) 存活={node_alive}  →  {}\n",
                if pass { "✅ PASS：整棵进程树清光，无孤儿残留" } else { "❌ FAIL：仍有残留进程" }
            ));
            if !pass {
                kill_tree(shell_pid);
                kill_tree(node_pid);
            }
            report.push_str(&format!(
                "\n结论: 关闭会话的进程树清理 {}\n",
                if pass { "工作正常 —— 崩溃根因(孤儿堆积)已修复" } else { "仍有问题 —— 需排查" }
            ));
        }
        Err(e) => report.push_str(&format!("B 组 setup 失败: {e}\n")),
    }

    report
}

/// 起一个 PTY 会话。返回 session_id；输出通过 `on_data` Channel 流回前端。
#[tauri::command]
pub async fn term_open(
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    cwd: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty 失败: {e}"))?;

    let mut builder = shell_builder();
    builder.env("PATH", build_path());
    builder.env("TERM", "xterm-256color");
    builder.cwd(resolve_cwd(cwd));

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("启动 shell 失败: {e}"))?;
    // slave 端关掉，否则 reader 永远等不到 EOF
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader 失败: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer 失败: {e}"))?;

    let id = next_id();

    // reader 线程：PTY 输出 → Channel（零 unwrap，panic=abort 安全）
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    if let Ok(mut map) = sessions().lock() {
        map.insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    Ok(id)
}

/// 键盘输入 → PTY stdin。
#[tauri::command]
pub fn term_write(session_id: String, data: String) -> Result<(), String> {
    let mut map = sessions().lock().map_err(|_| "终端会话锁异常")?;
    let s = map.get_mut(&session_id).ok_or("会话不存在")?;
    s.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))?;
    let _ = s.writer.flush();
    Ok(())
}

/// 终端尺寸变化。
#[tauri::command]
pub fn term_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = sessions().lock().map_err(|_| "终端会话锁异常")?;
    let s = map.get(&session_id).ok_or("会话不存在")?;
    s.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize 失败: {e}"))
}

/// 杀掉整棵进程树（含子孙）。
///
/// 关键：`child.kill()` 只杀顶层 shell（pwsh.exe），里面跑的 `claude`/`node`/`codex`
/// 等子进程会变孤儿继续占内存/CPU/端口 —— 开关几轮终端后机器堆满孤儿进程 → 卡、不稳定。
/// 因此关闭前先按 PID 杀整棵树（Crystal 同款做法）。
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        // /T = 连同子进程树，/F = 强制。失败（进程已退）忽略。
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，别闪黑框
            .output();
    }
    #[cfg(not(windows))]
    {
        // 负 PID = 杀整个进程组（spawn 时进程会成为组长）。先 TERM 再 KILL。
        let p = pid as i32;
        let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{p}")]).output();
        let _ = std::process::Command::new("kill").args(["-KILL", &format!("-{p}")]).output();
    }
}

/// 关闭会话（杀整棵进程树 + 释放）。
#[tauri::command]
pub fn term_close(session_id: String) -> Result<(), String> {
    if let Ok(mut map) = sessions().lock() {
        if let Some(mut s) = map.remove(&session_id) {
            // 先按 PID 杀整棵树（带走 claude/node 等子进程），再 kill 兜底。
            if let Some(pid) = s.child.process_id() {
                kill_tree(pid);
            }
            let _ = s.child.kill();
            // master drop 后 reader 见 EOF 退出
        }
    }
    Ok(())
}

/// 关闭所有 PTY 会话（杀光整棵进程树 + 清空 map）。
/// 窗口/应用退出时调用 —— 安全底子，绝不留孤儿进程。
pub fn close_all() {
    if let Ok(mut map) = sessions().lock() {
        let ids: Vec<String> = map.keys().cloned().collect();
        for id in ids {
            if let Some(mut s) = map.remove(&id) {
                if let Some(pid) = s.child.process_id() {
                    kill_tree(pid);
                }
                let _ = s.child.kill();
            }
        }
    }
}
