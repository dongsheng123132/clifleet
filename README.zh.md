<div align="center">

![OpenCodex — 用真终端跑 AI 编程 CLI，一次一个文件夹](docs/banner.png)

# OpenCodex

[English](./README.md) · **简体中文**

### 约 3 MB 的绿色（免安装）工作台 —— 用真终端跑 AI 编程 CLI，一次一个文件夹。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/dongsheng123132/opencodex)](https://github.com/dongsheng123132/opencodex/releases/latest)
[![Build](https://github.com/dongsheng123132/opencodex/actions/workflows/release.yml/badge.svg)](https://github.com/dongsheng123132/opencodex/actions/workflows/release.yml)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg)](https://tauri.app)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

</div>

OpenCodex 是一个极简的「基于文件夹的 CLI 工作台」：选一个项目文件夹 → 主区就是**应用内真终端**，跑 Claude Code / Codex / Gemini CLI / Aider / opencode 或任意 CLI → 需要并行干活就多开终端标签。全程保活——切项目、切标签都不杀进程。

**完全本地、开源、无内置 Key、无服务器。** 模型与端点配置放在**你自己的 CLI 里**（cc-switch、magpie 或 CLI 自带配置都行）——终端完整继承你的环境，**不注入任何模型/代理变量**。

![OpenCodex 主界面 —— 项目列表、终端标签、快捷启动](docs/screenshot-main.png)

## 特性

- **🗂️ 基于文件夹的项目** —— 左侧一文件夹一项目；点路径即复制，也可一键在资源管理器中打开。
- **🖥️ 真·多终端标签** —— 每个标签是真 PTY（`portable_pty`）+ xterm.js **WebGL** 渲染，TUI 高频重绘也顺滑。切标签/切项目进程照跑；关终端**杀整棵进程树**，不留 `pwsh`/`claude` 孤儿。
- **⚡ 和你的 CLI 无缝配合** —— PATH 兜底目录（npm 全局、`~/bin`、homebrew…）**只追加不前置**，你优先装的 CLI 永远优先。`claude` / `codex` 直接能跑。
- **⌨️ 真正好用的终端** —— 有选区 Ctrl+C 复制、Ctrl+V / Shift+Insert / 右键粘贴、选中即复制、字号可调（`Ctrl ±`）、拖文件/文件夹插入路径、软重置（`Ctrl+Shift+R`）一键清掉 TUI 崩溃残留（鼠标乱码、花屏、光标丢失），不碰 shell。
- **🚀 自定义快捷词** —— 一键启动常用 CLI；可增删改（本地保存）。
- **🫳 拖放落路径** —— 把文件/图片/文件夹拖进终端，真实路径自动敲进命令行。
- **🪶 极轻量** —— 约 3 MB（Rust 体积优先：`opt-level=z` + LTO + strip），复用系统 WebView（不带 Chromium）。数据跟程序走（`portable-data/`）或留在 `~/.opencodex`。

## 安装

从 [Releases](https://github.com/dongsheng123132/opencodex/releases/latest) 下载：

| 平台 | 产物 |
|---|---|
| Windows x64 | `OpenCodex-v*-windows-x64-setup.exe`（安装包）或 `*-portable.zip`（解压即用） |
| macOS Apple 芯片 | `OpenCodex-v*-macos-arm64.dmg` |
| macOS Intel | `OpenCodex-v*-macos-x86_64.dmg` |
| Linux x64 | `OpenCodex-v*-linux-x86_64.AppImage` / `.deb` |

每个 Release 附 `SHA256SUMS.txt` 供校验。当前为**未签名构建**，首次运行 Windows SmartScreen / macOS Gatekeeper 可能提示。

## 快速开始

```bash
pnpm install            # 装前端依赖
pnpm tauri dev          # 开发模式（弹窗 + HMR）
pnpm tauri build        # 出 exe + 安装包
```

无头自检（不依赖 GUI）：

```bash
cargo run -- --term-test "node --version"   # PTY + PATH 注入
cargo run -- --term-kill-test               # 关闭时进程树清理
```

## 使用

1. 启动 OpenCodex。
2. **打开文件夹…** → 选项目文件夹 → 出现在项目列表。
3. 终端里跑任意 CLI —— `claude`、`codex`、`gemini`、`aider`、`opencode`… 或点快捷词一键启动；`+` 可添加自定义快捷词（右键按钮删除）。
4. `+` 多开终端标签；点标签上的 `×`（点两下确认）关闭。

## 技术栈

两层，无 sidecar：**React（WebView）⟷ Tauri 2（Rust）**。

## 数据位置

数据根（优先级）：`OPENCODEX_HOME` 环境变量 → exe 旁 `portable-data/`（绿色包/U 盘）→ `~/.opencodex`。

- `<数据根>/tasks.json` —— 项目列表
- `<数据根>/logs/opencodex.jsonl` —— 本地 bug 日志（纯本地，绝不上传）

## 许可证

[MIT](./LICENSE)。无内置 Key、无计费、无激活、无遥测——纯本地工具。

> "Claude" / "Claude Code" 是 Anthropic 的商标；"Codex" 是 OpenAI 的商标。其他 CLI（Gemini CLI、Aider、opencode）归各自所有者。OpenCodex 是独立开源项目，与上述各方无关，仅运行你自己配置的 CLI 与端点。
