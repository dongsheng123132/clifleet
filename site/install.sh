#!/bin/sh
# CliFleet 一行安装（macOS / Linux）
#
#   curl -fsSL https://u-claw.org.cn/clifleet/install.sh | sh     # 国内源（推荐）
#   curl -fsSL https://clifleet.vercel.app/install.sh | sh        # 海外/备用
#
# macOS：下载 dmg → 挂载 → 拷 .app 到 /Applications
# Linux：下载 AppImage → 放到 ~/.local/bin/clifleet
# 重复运行 = 升级（配置与项目列表不动）。
# 不动系统配置，不改任何 CLI 的模型/代理设置。

set -eu

REPO="dongsheng123132/clifleet"
CN_BASE="https://u-claw.org.cn"
# 国内源优先，GitHub 与镜像兜底
DL_SOURCES="$CN_BASE/download/clifleet https://github.com https://ghfast.top/https://github.com https://gh-proxy.com/https://github.com"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "需要 curl"

# 1) 版本：优先国内 version.json，再退 GitHub API
TAG="${CLIFLEET_VERSION:-}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL --max-time 15 "$CN_BASE/clifleet/version.json" \
        | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1) || true
fi
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL --max-time 20 "https://api.github.com/repos/$REPO/releases/latest" \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1) || true
fi
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL --max-time 25 "https://gh-proxy.com/https://api.github.com/repos/$REPO/releases/latest" \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1) || true
fi
[ -n "$TAG" ] || die "拿不到版本号；可用 CLIFLEET_VERSION=v0.6.1 指定"

say "CliFleet $TAG"

fetch() { # fetch <asset-name> <dest>
  name="$1"; dest="$2"
  for src in $DL_SOURCES; do
    case "$src" in
      "$CN_BASE"*) url="$src/$name" ;;                       # 国内源无版本段
      *)           url="$src/$REPO/releases/download/$TAG/$name" ;;
    esac
    if curl -fL --max-time 600 -o "$dest" "$url" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) ASSET="CliFleet-$TAG-macos-arm64.dmg" ;;
      x86_64) ASSET="CliFleet-$TAG-macos-x86_64.dmg" ;;
      *) die "不支持的架构：$ARCH" ;;
    esac
    say "下载 $ASSET ..."
    fetch "$ASSET" "$TMP/clifleet.dmg" || die "下载失败（国内源与 GitHub 都不可用）"
    say "挂载并安装到 /Applications ..."
    hdiutil attach "$TMP/clifleet.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"
    [ -d "$TMP/mnt/CliFleet.app" ] || die "dmg 里没找到 CliFleet.app"
    rm -rf "/Applications/CliFleet.app" 2>/dev/null || true
    cp -R "$TMP/mnt/CliFleet.app" /Applications/
    hdiutil detach "$TMP/mnt" -quiet || true
    say ""
    say "装好了：/Applications/CliFleet.app（重复运行本命令 = 升级）"
    say "首次打开若被拦：系统设置 → 隐私与安全性 → 「仍要打开」（未签名构建）。"
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64) ASSET="CliFleet-$TAG-linux-x86_64.AppImage" ;;
      *) die "目前只提供 x86_64 的 AppImage；其他架构请从 https://u-claw.org.cn/clifleet/ 手动下载 .deb" ;;
    esac
    say "下载 $ASSET ..."
    fetch "$ASSET" "$TMP/clifleet.AppImage" || die "下载失败（国内源与 GitHub 都不可用）"
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$TMP/clifleet.AppImage" "$HOME/.local/bin/clifleet"
    say ""
    say "装好了：$HOME/.local/bin/clifleet（重复运行本命令 = 升级）"
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) : ;;
      *) say "提示：把 ~/.local/bin 加进 PATH 才能直接敲 clifleet" ;;
    esac
    ;;
  *)
    die "这个脚本只处理 macOS / Linux；Windows 用：irm https://u-claw.org.cn/clifleet/install.ps1 | iex"
    ;;
esac
