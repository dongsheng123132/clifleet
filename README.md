<div align="center">

![OpenCodex — run AI coding CLIs in real terminals, one folder at a time](docs/banner.png)

# OpenCodex

**English** · [简体中文](./README.zh.md)

### A ~3 MB portable workbench for running AI coding CLIs in real terminals — one folder at a time.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/dongsheng123132/opencodex)](https://github.com/dongsheng123132/opencodex/releases/latest)
[![Build](https://github.com/dongsheng123132/opencodex/actions/workflows/release.yml/badge.svg)](https://github.com/dongsheng123132/opencodex/actions/workflows/release.yml)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg)](https://tauri.app)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

</div>

OpenCodex is a minimal folder-based CLI workbench: pick a project folder → the main area **is a real in-app terminal** where you run Claude Code, Codex, Gemini CLI, Aider, opencode, or any CLI → open more terminal tabs when you need parallel work. Everything stays alive — switching projects or tabs never kills your terminal processes.

**Fully local, open-source, no keys, no server.** OpenCodex ships no API keys and points at no relay of its own. Model and endpoint configuration lives **inside your own CLIs** (via cc-switch, magpie, or the CLI's own config) — the terminal inherits your environment exactly as-is and never injects model or proxy variables.

![OpenCodex main UI — project list, terminal tabs, quick launch commands](docs/screenshot-main.png)

## Highlights

- **🗂️ Folder-based projects** — one folder per project on the left; pick a folder and it becomes a project. Click the path to copy it, or open the folder in your file explorer.
- **🖥️ Real multi-terminal tabs** — each tab is a real PTY (`portable_pty`) rendered by xterm.js with **WebGL**, smooth under high-frequency TUI repaints. Switching tabs/projects keeps processes running. Closing a terminal **kills the whole child-process tree** — no orphaned `pwsh`/`claude` processes piling up.
- **⚡ Works with your CLIs** — PATH fallback dirs (npm global, `~/bin`, homebrew…) are **appended, never prepended**, so your preferred CLI implementations keep priority. `claude` / `codex` just work.
- **⌨️ Terminal that's actually usable** — Ctrl/Cmd+C copy with selection, Ctrl+V / Shift+Insert / right-click paste, select-to-copy, adjustable font (`Ctrl ±`), drag & drop files/folders to insert paths, and a soft reset (`Ctrl+Shift+R`) that clears TUI crash residue (mouse garbage, screen artifacts, lost cursor) without touching your shell.
- **🚀 Custom quick commands** — launch your favorite CLIs with one click; add, rename, or remove buttons (stored locally).
- **🫳 Drag to drop paths** — drag a file / image / folder into the terminal and its real path is typed into the command line.
- **🪶 Portable** — ~3 MB binary (size-first Rust profile: `opt-level=z` + LTO + strip), reusing the system WebView (no bundled Chromium). Data follows the exe (`portable-data/`) or stays in `~/.opencodex`.

## Install

Download from [Releases](https://github.com/dongsheng123132/opencodex/releases/latest):

| Platform | Artifact |
|---|---|
| Windows x64 | `OpenCodex-v*-windows-x64-setup.exe` (installer) or `*-portable.zip` (unzip & run) |
| macOS Apple Silicon | `OpenCodex-v*-macos-arm64.dmg` |
| macOS Intel | `OpenCodex-v*-macos-x86_64.dmg` |
| Linux x64 | `OpenCodex-v*-linux-x86_64.AppImage` / `.deb` |

Every release includes `SHA256SUMS.txt` for verification. Builds are currently unsigned — Windows SmartScreen and macOS Gatekeeper may show a warning on first launch.

## Quick start

```bash
pnpm install            # install frontend deps
pnpm tauri dev          # dev mode (window + HMR)
pnpm tauri build        # produce exe + installer
```

Headless self-tests (no GUI):

```bash
cargo run -- --term-test "node --version"   # PTY + PATH injection
cargo run -- --term-kill-test               # process-tree cleanup on close
```

## Usage

1. Launch OpenCodex.
2. **Open folder…** → pick a project folder → it appears in the project list.
3. Run any CLI in the terminal — `claude`, `codex`, `gemini`, `aider`, `opencode`… or click a quick command. Add your own quick commands with the `+` button (right-click a button to remove it).
4. Open more terminal tabs with `+`; close with the tab's `×` (click twice to confirm).

## Stack

Two layers, no sidecar: **React (WebView) ⟷ Tauri 2 (Rust)**.

## Data locations

Data root (first match wins): `OPENCODEX_HOME` env → `portable-data/` next to the exe (portable/U-Disk) → `~/.opencodex`.

- `<data root>/tasks.json` — project list
- `<data root>/logs/opencodex.jsonl` — local bug log (purely local, never uploaded)

## License

[MIT](./LICENSE). No bundled keys, billing, activation, or telemetry — a pure local tool.

> "Claude" / "Claude Code" are trademarks of Anthropic; "Codex" is a trademark of OpenAI. Other CLIs (Gemini CLI, Aider, opencode) belong to their respective owners. OpenCodex is an independent open-source project, not affiliated with or endorsed by any of them, and only runs the AI CLIs and model endpoints you configure yourself.
