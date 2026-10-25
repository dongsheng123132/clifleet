//! 应用内真终端（PTY）—— Rust 拥有伪终端，前端 xterm.js 只渲染 + 转发输入。
//!
//! ## 为什么自己起 PTY 而不弹外部窗口
//! 外部 PowerShell 用 `-NoProfile` 又不注入 PATH，导致 claude/codex 等 CLI 找不到命令。
//! 这里复用 `paths::path_prefix`（统一口径的 PATH），把 npm 全局、~/bin 等目录追加进（不抢用户 PATH 优先级）
//! 子 shell 的 PATH —— 装过的 CLI 因此能直接跑。
//!
//! ## 环境
//! 子进程只覆盖 `PATH`（追加兜底工具目录）与 `TERM`，**不注入任何模型/代理/工具目录变量** ——
//! 完整沿用用户已配置的环境（profile 里的别名、claude/codex 自己的配置都原样生效）。
//! 唯一例外：macOS 上 `LANG`/`LC_ALL`/`LC_CTYPE` 全缺时补一个 UTF-8 `LANG`（Finder 启动的 app
//! 不带 locale，子 shell 落到 C locale、中文文件名显示成 `???`；Terminal.app / iTerm2 同款做法）。
//! 所有起 shell 的地方都走 `apply_child_env`，别再各写一份。
//!
//! ## 生命周期
//! 一个会话 = 一个长驻 shell。切项目只 hide UI，不杀进程。关标签 / 窗口退出都走
//! `shutdown_sessions` 杀整棵进程树（不留孤儿）。
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

/// 子进程环境的唯一出口：PATH 追加已知工具目录（兜底，让 claude/codex 等 CLI 可解析）、
/// TERM，macOS 再按需补 UTF-8 locale。term_open / headless_run / 崩溃自检都走这里。
fn apply_child_env(builder: &mut CommandBuilder) {
    builder.env("PATH", path_prefix());
    builder.env("TERM", "xterm-256color");
    #[cfg(target_os = "macos")]
    if let Some(lang) = mac_fallback_lang() {
        builder.env("LANG", lang);
    }
}

/// macOS：Finder / Dock 启动的 app 不带 `LANG`/`LC_*`，子 shell 会落到 C locale ——
/// 中文文件名显示成 `???`、git/python 输出乱码。Terminal.app / iTerm2 的做法是补一个 UTF-8 locale。
/// 只在三者都没设时补；用户自己设了任何一个就原样不动。None = 不需要补。
#[cfg(target_os = "macos")]
fn mac_fallback_lang() -> Option<String> {
    let set = |k: &str| std::env::var(k).map(|v| !v.trim().is_empty()).unwrap_or(false);
    if set("LC_ALL") || set("LC_CTYPE") || set("LANG") {
        return None;
    }
    static LANG: OnceLock<String> = OnceLock::new();
    Some(LANG.get_or_init(detect_mac_utf8_locale).clone())
}

/// 按系统「语言与地区」推 UTF-8 locale：`defaults read -g AppleLocale`（形如 `zh_CN`、
/// `en_US@rg=cnzzzz`、`zh-Hans_CN`），系统里真有对应 `.UTF-8` locale 才用，否则回落 `en_US.UTF-8`。
#[cfg(target_os = "macos")]
fn detect_mac_utf8_locale() -> String {
    const FALLBACK: &str = "en_US.UTF-8";
    let Some(raw) = read_apple_locale() else {
        return FALLBACK.into();
    };
    let base = raw.split('@').next().unwrap_or("").trim().to_string();
    let mut candidates = vec![base.clone()];
    // zh-Hans_CN → zh_CN（去掉文字变体，留语言 + 地区）
    if let (Some((lang, _)), Some((_, region))) = (base.split_once('-'), base.rsplit_once('_')) {
        candidates.push(format!("{lang}_{region}"));
    }
    for c in candidates {
        // 只认 `xx_YY` 这类纯字母数字下划线，防奇怪值拼出越界路径
        if c.is_empty() || !c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
            continue;
        }
        let name = format!("{c}.UTF-8");
        if std::path::Path::new("/usr/share/locale").join(&name).is_dir() {
            return name;
        }
    }
    FALLBACK.into()
}

/// 读 `AppleLocale`。子进程带 1s 超时，超时/失败一律 None（走回落），绝不卡住开终端。
#[cfg(target_os = "macos")]
fn read_apple_locale() -> Option<String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut child = Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLocale"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if start.elapsed() < Duration::from_secs(1) => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let s = out.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
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
/// 都不加 -NoProfile（要用户 profile 里的 PATH/别名），我们额外追加已知工具目录兜底（不抢用户 PATH 优先级）。
#[cfg(windows)]
fn shell_builder() -> CommandBuilder {
    let exe = find_pwsh7().unwrap_or_else(|| "powershell.exe".into());
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(["-NoLogo"]);
    cmd
}

/// unix：交给 portable-pty 的 default prog —— `$SHELL`（可执行才用）→ passwd 数据库里的
/// 登录 shell → `/bin/sh`，并以 argv0 前缀 `-` 的方式作为 login shell 启动（等价 `-l`，
/// 对 fish/dash 等所有 shell 都成立）。以前缺 `$SHELL` 硬回落 `/bin/zsh`，没装 zsh 的 Linux 直接起不来。
/// ⚠️ default prog builder 上调 `.arg()` 会 panic（release 是 panic=abort → 整个应用崩），
/// 这里和所有调用方都**不许加参数**，只能设 env / cwd。
#[cfg(not(windows))]
fn shell_builder() -> CommandBuilder {
    CommandBuilder::new_default_prog()
}

/// 无头自检：起一个 PTY 跑一条命令，把输出收集回来（验证 PATH 注入 + ConPTY 正常）。
/// 给 `--term-test <cmd>` 用，不依赖 GUI / xterm。
pub fn headless_run(cmd: &str, timeout_ms: u64) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 100, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut builder = shell_builder();
    apply_child_env(&mut builder);
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
        .stderr(std::process::Stdio::null()) // 进程已退时 kill 会吐 "No such process"，别污染报告
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
    apply_child_env(&mut builder);
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
/// 给 `--term-kill-test` 用，不依赖 GUI。返回 (人读报告, B 组是否 PASS)。
#[cfg(windows)]
pub fn headless_kill_test() -> (String, bool) {
    let mut report = String::new();
    let mut pass = false;

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
        Ok((child, writer, master, shell_pid, node_pid)) => {
            // ← 真·修复路径：term_close / close_all 用的就是这同一个函数
            shutdown_sessions(vec![PtySession { master, writer, child }]);
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let shell_alive = pid_alive(shell_pid);
            let node_alive = pid_alive(node_pid);
            pass = !shell_alive && !node_alive;
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

    (report, pass)
}

/// 崩溃自检用（unix）：PTY 里起 `/bin/sh`，`set -m` 开作业控制后挂一个 `&` 后台任务
/// （模拟 dev server）和一个不吃 SIGHUP 的前台任务（模拟不退出的 CLI），各自把 pid 写进临时文件。
/// 作业控制下两者都在各自的进程组里 —— 正是旧的「只杀 shell 进程组」漏掉的那类进程。
/// 返回 (child, writer, master, shell_pid, bg_pid, fg_pid)。
#[cfg(not(windows))]
#[allow(clippy::type_complexity)]
fn spawn_shell_with_jobs(
    tag: &str,
) -> Result<
    (
        Box<dyn portable_pty::Child + Send + Sync>,
        Box<dyn Write + Send>,
        Box<dyn portable_pty::MasterPty + Send>,
        u32,
        u32,
        u32,
    ),
    String,
> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 100, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut builder = CommandBuilder::new("/bin/sh");
    apply_child_env(&mut builder);
    builder.cwd(home_dir());
    let mut child = pair.slave.spawn_command(builder).map_err(|e| format!("spawn shell: {e}"))?;
    drop(pair.slave);
    let mut writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;
    // 持续读，别让 PTY 输出缓冲写满卡住 shell
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

    let dir = std::env::temp_dir();
    let bg_file = dir.join(format!("cftest_{tag}_bg.pid"));
    let fg_file = dir.join(format!("cftest_{tag}_fg.pid"));
    let _ = std::fs::remove_file(&bg_file);
    let _ = std::fs::remove_file(&fg_file);
    let script = format!(
        "set -m\nsleep 1001 & echo $! > '{bg}'\nsh -c 'trap \"\" HUP; echo $$ > \"{fg}\"; exec sleep 1002'\n",
        bg = bg_file.display(),
        fg = fg_file.display(),
    );
    writer.write_all(script.as_bytes()).map_err(|e| format!("write: {e}"))?;
    let _ = writer.flush();

    // 等两个任务都起来写 pid（最多 5s）
    let read_pid = |p: &std::path::Path| {
        std::fs::read_to_string(p).ok().and_then(|s| s.trim().parse::<u32>().ok())
    };
    let start = std::time::Instant::now();
    let (mut bg_pid, mut fg_pid) = (None, None);
    while start.elapsed().as_secs() < 5 {
        bg_pid = read_pid(bg_file.as_path());
        fg_pid = read_pid(fg_file.as_path());
        if bg_pid.is_some() && fg_pid.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = std::fs::remove_file(&bg_file);
    let _ = std::fs::remove_file(&fg_file);
    match (bg_pid, fg_pid) {
        (Some(bg), Some(fg)) => Ok((child, writer, pair.master, shell_pid, bg, fg)),
        _ => {
            kill_tree(shell_pid);
            let _ = child.kill();
            Err("后台/前台测试任务未起来".into())
        }
    }
}

/// 旧的 unix 清理算法（只给自检 A 组复现 bug 用）：只打 shell 自己那个进程组。
#[cfg(not(windows))]
fn legacy_kill_pgrp(pid: u32) {
    let p = format!("-{pid}");
    let _ = std::process::Command::new("kill").args(["-TERM", &p]).output();
    let _ = std::process::Command::new("kill").args(["-KILL", &p]).output();
}

/// 无头崩溃-清理自检（unix）：A 组复现旧算法漏杀作业控制下的任务，B 组验证按会话清理。
/// 给 `--term-kill-test` 用，不依赖 GUI。返回 (人读报告, B 组是否 PASS)。
#[cfg(not(windows))]
pub fn headless_kill_test() -> (String, bool) {
    let mut report = String::new();
    let mut pass = false;

    // ===== A 组：旧算法 kill -<shell pid>（只杀 shell 进程组）+ child.kill() =====
    //          期望：后台任务、不吃 HUP 的前台任务都活下来 —— 复现旧 bug
    match spawn_shell_with_jobs("a") {
        Ok((mut child, _w, _m, shell_pid, bg_pid, fg_pid)) => {
            legacy_kill_pgrp(shell_pid);
            let _ = child.kill();
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let bg_alive = pid_alive(bg_pid);
            let fg_alive = pid_alive(fg_pid);
            report.push_str(&format!(
                "A 组 (旧算法：只杀 shell 进程组): 后台任务(pid {bg_pid}) 存活={bg_alive}, 不吃 HUP 的前台任务(pid {fg_pid}) 存活={fg_alive}  →  {}\n",
                if bg_alive || fg_alive {
                    "✅ 复现旧 bug：作业控制下的任务不在 shell 的进程组里，成了孤儿"
                } else {
                    "（本机没复现：任务随 shell 一起退出了）"
                }
            ));
            // 清掉 A 组遗留：孤儿的会话 id 仍是原 shell pid，按会话杀得到
            kill_tree(shell_pid);
        }
        Err(e) => report.push_str(&format!("A 组 setup 失败: {e}\n")),
    }

    // ===== B 组：shutdown_sessions（term_close / close_all 用的同一函数）=====
    //          期望：shell + 后台 + 前台任务全清光 —— 验证修复
    match spawn_shell_with_jobs("b") {
        Ok((child, writer, master, shell_pid, bg_pid, fg_pid)) => {
            shutdown_sessions(vec![PtySession { master, writer, child }]);
            std::thread::sleep(std::time::Duration::from_millis(1500));
            // shell 已在 shutdown_sessions 里被 try_wait 回收，kill -0 不会把僵尸误判成活着
            let shell_alive = pid_alive(shell_pid);
            let bg_alive = pid_alive(bg_pid);
            let fg_alive = pid_alive(fg_pid);
            pass = !shell_alive && !bg_alive && !fg_alive;
            report.push_str(&format!(
                "B 组 (按会话杀整棵树): shell(pid {shell_pid}) 存活={shell_alive}, 后台任务(pid {bg_pid}) 存活={bg_alive}, 前台任务(pid {fg_pid}) 存活={fg_alive}  →  {}\n",
                if pass { "✅ PASS：整个会话清光，无孤儿残留" } else { "❌ FAIL：仍有残留进程" }
            ));
            if !pass {
                kill_tree(shell_pid);
            }
            report.push_str(&format!(
                "\n结论: 关闭会话的进程树清理 {}\n",
                if pass { "工作正常 —— 作业控制下的任务也能清掉" } else { "仍有问题 —— 需排查" }
            ));
        }
        Err(e) => report.push_str(&format!("B 组 setup 失败: {e}\n")),
    }

    (report, pass)
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
    apply_child_env(&mut builder);
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
/// 关键：`child.kill()` 只杀顶层 shell（pwsh.exe / zsh），里面跑的 `claude`/`node`/`codex`
/// 等子进程会变孤儿继续占内存/CPU/端口 —— 开关几轮终端后机器堆满孤儿进程 → 卡、不稳定。
/// 因此关闭前先按 PID 杀整棵树（Crystal 同款做法）。
fn kill_tree(pid: u32) {
    kill_trees(&[pid], || {});
}

/// 批量杀进程树。`reap` 在等待期间被反复调用，用来回收已退出的顶层 shell（见下）。
///
/// - Windows：`taskkill /F /T` 按父子关系杀整棵树。
/// - unix：portable-pty 在子进程里 `setsid()`，shell 是会话首进程（sid == shell pid）。
///   交互 shell 开着作业控制，前台/后台任务各在自己的进程组里，只杀 `-pid`（shell 那一组）
///   会漏掉 `&` 后台任务和不吃 SIGHUP 的前台任务；所以按**会话**杀：
///   HUP（交互 shell 忽略 TERM，但收到 HUP 会退出并转发给作业）→ TERM → 最多等 500ms → KILL 残留。
///   会话里已被 init 收养的孤儿也在范围内。局限：自己 `setsid` 脱离会话的守护进程不在此列。
///   顶层 shell 是我们的直接子进程，退出后不回收就是僵尸，`pgrep -s` 仍会数到它 ——
///   所以等待时调 `reap`（try_wait）把它收掉，正常情况几十毫秒就返回。
fn kill_trees(pids: &[u32], mut reap: impl FnMut()) {
    #[cfg(windows)]
    for pid in pids {
        // /T = 连同子进程树，/F = 强制。失败（进程已退）忽略。
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，别闪黑框
            .output();
    }
    #[cfg(not(windows))]
    {
        use std::time::{Duration, Instant};
        // pid 0 对 `pkill -s` 表示「当前会话」—— 会误杀 CliFleet 自己，必须排除
        let sids: Vec<String> = pids.iter().filter(|&&p| p != 0).map(|p| p.to_string()).collect();
        if sids.is_empty() {
            return;
        }
        let list = sids.join(",");
        let signal = |sig: &str| {
            let _ = std::process::Command::new("pkill").args([sig, "-s", &list]).output();
        };
        signal("-HUP");
        signal("-TERM");
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(500) {
            reap();
            if !session_alive(&list) {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        signal("-KILL");
    }
    reap();
}

/// 这些会话里是否还有进程（`pgrep -s` 退出码 0 = 有；macOS/BSD 与 Linux procps 都支持只给 `-s`）。
#[cfg(not(windows))]
fn session_alive(sid_list: &str) -> bool {
    std::process::Command::new("pgrep")
        .args(["-s", sid_list])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 关闭一批会话：杀整棵进程树 → 顶层 shell 仍没退才 kill 兜底 → 释放 PTY。
/// term_close / close_all / 崩溃自检 B 组共用这一个函数（自检测的就是线上路径）。
fn shutdown_sessions(mut list: Vec<PtySession>) {
    let pids: Vec<u32> = list.iter().filter_map(|s| s.child.process_id()).collect();
    kill_trees(&pids, || {
        for s in list.iter_mut() {
            let _ = s.child.try_wait();
        }
    });
    for s in list.iter_mut() {
        // 已被 try_wait 回收的就别再 kill：portable-pty 在 unix 上按原始 pid 发信号，
        // 回收后的 pid 可能已被系统复用
        if matches!(s.child.try_wait(), Ok(None)) {
            let _ = s.child.kill();
        }
    }
    // list drop → master drop → reader 见 EOF 退出
}

/// 关闭会话（杀整棵进程树 + 释放）。
/// 锁内只把会话摘出来；清理放后台线程 —— 同步 command 跑在主线程上，
/// unix 上最多要等 500ms 宽限期，不能卡界面，也不能拿着 sessions 锁挡住别的标签 term_write。
#[tauri::command]
pub fn term_close(session_id: String) -> Result<(), String> {
    let removed = match sessions().lock() {
        Ok(mut map) => map.remove(&session_id),
        Err(p) => p.into_inner().remove(&session_id),
    };
    if let Some(s) = removed {
        std::thread::spawn(move || shutdown_sessions(vec![s]));
    }
    Ok(())
}

/// 关闭所有 PTY 会话（杀光整棵进程树 + 清空 map）。
/// 窗口/应用退出时调用 —— 安全底子，绝不留孤儿进程；进程马上要退，这里同步做完。
pub fn close_all() {
    let drained: Vec<PtySession> = match sessions().lock() {
        Ok(mut map) => map.drain().map(|(_, s)| s).collect(),
        Err(p) => p.into_inner().drain().map(|(_, s)| s).collect(),
    };
    shutdown_sessions(drained);
}
