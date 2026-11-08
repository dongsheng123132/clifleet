# AGENTS.md

给 Codex 的项目说明。本目录是 **CliFleet** —— 开源、绿色的本地编程工作台。

## 这是什么

以**文件夹**为基础的多终端 AI 编程与管理工作台（Codex 同款体验）。选一个项目文件夹 →
和用户**自带的模型**对话 → 需要时从对话顶栏滑出应用内真终端、文件树、浏览器。常驻保活。

**完全本地、开源、无服务器、无内置 Key**。派生自 U-King 的 CliFleet 工作台模块，已剥离全部
商业/分发逻辑（虾盘云 Key、设备指纹、余额、充值、bug 上报、自升级、装机向导、托盘、右键菜单等）。

用户沟通用中文。

## 架构

两层，没有 sidecar：React（WebView）⟷ Tauri 2（Rust）。

后端 command（`lib.rs::invoke_handler`）：

| command | 作用 | 实现 |
|---|---|---|
| `get_env` | 平台 / 主目录 / `--open-dir` 透传 | lib.rs |
| `get_config` / `set_config` | 自带模型配置（只读/写 ~/.clifleet/config.json） | config.rs |
| `term_open` / `term_write` / `term_resize` / `term_close` / `list_running` | 应用内 PTY 终端 | term.rs |
| `list_tasks` / `upsert_task` / `remove_task` | 会话/任务持久化 | tasks.rs |
| `claude_send` / `claude_interrupt` / `claude_reset` | 结构化 Codex 对话流 | agent/Codex.rs |
| `list_dir` / `read_text_file` | 文件面板 | fs.rs |
| `open_browser` | 浏览器面板（独立 webview 子窗口） | lib.rs |
| `hide_window` | 隐藏窗口 | lib.rs |

## 关键设计

- **`paths.rs` 是 PATH 注入的唯一真相源**：`search_paths()` 前置便携 Node/Python + npm 全局目录，
  让双击启动（Explorer/Finder 给的瘦 PATH）也能找到 `Codex`/`codex`。term.rs、agent、config 都复用它。
  可选便携运行时放 `~/.clifleet/runtime/{node,python}`，解压即被发现。
- **自带模型（config.rs）**：只读写 `~/.clifleet/config.json`。CliFleet 启动的终端和 AI 子进程会临时注入
  ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL。
  不写 `~/.claude/settings.json`，不改登录态，不改系统环境变量，不静默覆盖用户在 Claude Code 里的模型、代理、Key。
  **不连任何服务器，无内置 Key**。
- **PTY 保活**：一个会话 = 一个长驻 shell。收起面板只 hide UI 不杀进程。reader/writer 热路径
  零 unwrap（release 是 `panic=abort`）。`term_open` 的初始命令过 `validate_cmd` 白名单（挡 shell 注入）。
- **结构化对话**：`Codex --output-format stream-json` 逐行解析成统一事件
  （session/text/tool_start/tool_input/tool_end/usage/done），React 渲染成卡片 + 内联 diff。
  多轮靠 `--resume <session_id>` 续接。
- **UI 保活**：CliFleet 整组常驻渲染，靠 `display` 切换（切会话不卸载 → PTY/历史续存）。

## 已知缺陷与修复记录（2026-11-08 会审后）

> ⚠️ 架构修正：下方「架构」表里的 `get_config/set_config`（config.rs）与 `agent/Codex.rs` **已移除**，
> 本 fork 是纯终端工作台，不做模型配置/API Key/对话流。真实 command 以 `lib.rs::invoke_handler` 为准。

### 终端乱码（中英混排重叠/挤压）— 已修
- **症状**：xterm 终端里 hermes/claude 等 CLI 输出的中文+ASCII 紧邻处视觉重叠；富文本框线（`─│┌→`）混排处最明显。
- **根因**（本机实测 + 6 模型会审收敛，`review_term_乱码_brief.md` + `_out/REPORT.md`）：
  1. `fontFamily: '"JetBrains Mono", ui-monospace, monospace'` —— 本机没装 JetBrains Mono，且 `ui-monospace`
     在 WebKit/Tauri 的 canvas 里解析不稳会被静默回退 → CJK 落到不可控系统字体，与 ASCII 度量错位。
  2. `─│┌→` 是东亚 Ambiguous 宽度字符（`east_asian_width=A`），xterm 与字体对"占 1 还是 2 列"可能不一致。
  3. WebGL 渲染器（`@xterm/addon-webgl`）对 fallback 字形度量与 xterm 内部单元格宽度不一致 → 字形溢出邻格。
- **修复**：`useTermGroup.ts::newTerm` 字体栈改为
  `'"JetBrains Mono", Menlo, Monaco, "SF Mono", Consolas, "DejaVu Sans Mono", "PingFang SC", "Microsoft YaHei", "Noto Sans Mono CJK SC", monospace'`，
  显式给半角回退 + CJK 具名 fallback。**验证**：`pnpm build` + `cargo test`（5 passed）全绿。
- **未做（会审判"不该做"）**：装 JetBrains Mono（无完整中文覆盖，掩盖不根治，用户机器不会都装）；
  裸加 `unicodeVersion`（需先装 `@xterm/addon-unicode11` 注册 provider，本 fork 未装）。
- **遗留**：若改字体栈后仍有个别段落错位，再考虑"关闭 WebGL addon 回退 DOM 渲染"做 A/B 对照定位。

### 剪贴板图片临时文件无限累积 — 已修
- **根因**：`lib.rs::clipboard_read_image` 每次写 `temp_dir()/clifleet-paste/image-<pid>-<n>.png` 从不清理。
- **修复**：加 `cleanup_stale_paste_images`，每次粘贴顺带删除 >24h 的旧图（保留近期可能未读完的）。幂等、失败静默。

### 会审判定的其它项（未改 / 低优先级，达成共识）
- **`term_write` 的 `\r\n→\r` 两步替换是"伪 bug"**：`.replace(/\r\n/g,'\r').replace(/\n/g,'\r')` 先吃 CRLF 再处理孤立 LF，
  不会产生 `\r\r`。裁判们是正则脑算错了，**不要盲改**（会引 bracketed-paste 复杂度）。
- **id 字符串撞车**（`reorder_tasks`）：真实风险但"未对外承诺/未真机验证"，P2。若要做：id 加来源前缀
  （`uking:`/`dsh:`/`new:`）或统一 `crypto.randomUUID()`。
- **DSH 导入只导路径不导会话**：设计边缘非 bug；schema 未真机验证是兼容性缺口，建议加 try/catch 防 parse 崩溃静默。

## 常用命令

```bash
pnpm install                 # 装前端依赖（如遇代理缓存问题见下）
pnpm tauri dev               # 开发模式（弹窗 + HMR）
cd src-tauri && cargo check  # Rust 快速类型检查
pnpm build                   # 前端 tsc + vite build
pnpm tauri build             # 出 exe + NSIS 安装包
```

构建产物：`src-tauri/target/release/clifleet.exe`。

## 验证方式（无头自检）

没有测试框架。验证 = `cargo check` + `pnpm build` + 一个无头 PTY 模式：

```bash
cargo run -- --term-test "node --version"   # 验证 PTY + PATH 注入，不依赖 GUI
```

实测基线（2026-06-16）：`--term-test "node --version"` 经 PowerShell PTY 正确回 `v22.14.0`。

## 数据位置

- `~/.clifleet/tasks.json` —— 会话列表
- `~/.clifleet/config.json` —— 模型配置记录
- `~/.clifleet/runtime/{node,python}` —— 可选便携运行时

## 注意事项（Windows / 本机环境）

- 用 Git Bash，Unix 路径语法；目录名含中文，路径要加引号。
- 代理在 `127.0.0.1:7897`。`pnpm install` 偶尔取到陈旧 registry 元数据时，加 `HTTPS_PROXY` 环境变量重试。
- `tsconfig.json` 开了 `noUnusedLocals`/`noUnusedParameters` —— 改前端时别留未用变量，否则 `tsc` 报错。
- Rust release profile 是 `panic=abort` + `opt-level=z`，PTY reader/writer 热路径勿引入 unwrap。

## 跟其他模块的关系

- 上游来源：`../u-king简化版-u盘版本/`（CliFleet 工作台 + term.rs + agent 都源自此，已去商业化）。
