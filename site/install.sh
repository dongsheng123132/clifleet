#!/bin/sh
# CliFleet 一行安装（macOS / Linux）
#
#   curl -fsSL https://clifleet.vercel.app/install.sh | sh
#
# macOS：下载 dmg → 挂载 → 拷 .app 到 /Applications
# Linux：下载 AppImage → 放到 ~/.local/bin/clifleet
# 不动系统配置，不改任何 CLI 的模型/代理设置。

set -eu

REPO="dongsheng123132/clifleet"
MIRRORS="https://github.com https://ghfast.top/https://github.com https://gh-proxy.com/https://github.com"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "需要 curl"

# 1) 版本
TAG="${CLIFLEET_VERSION:-}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL --max-time 20 "https://api.github.com/repos/$REPO/releases/latest" \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1) || true
fi
if [ -z "$TAG" ]; then
  for m in $MIRRORS; do
    TAG=$(curl -fsSL --max-time 25 "$m/https://api.github.com/repos/$REPO/releases/latest" \
          | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1) || true
    [ -n "$TAG" ] && break
  done
fi
[ -n "$TAG" ] || die "拿不到最新版本号；可用 CLIFLEET_VERSION=v0.6.0 指定"

say "CliFleet $TAG"

fetch() { # fetch <asset-name> <dest>
  name="$1"; dest="$2"
  for m in $MIRRORS; do
    if curl -fL --max-time 600 -o "$dest" "$m/$REPO/releases/download/$TAG/$name" 2>/dev/null; then
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
    fetch "$ASSET" "$TMP/clifleet.dmg" || die "下载失败"
    say "挂载并安装到 /Applications ..."
    hdiutil attach "$TMP/clifleet.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"
    [ -d "$TMP/mnt/CliFleet.app" ] || die "dmg 里没找到 CliFleet.app"
    rm -rf "/Applications/CliFleet.app" 2>/dev/null || true
    cp -R "$TMP/mnt/CliFleet.app" /Applications/
    hdiutil detach "$TMP/mnt" -quiet || true
    say ""
    say "装好了：/Applications/CliFleet.app"
    say "首次打开若被拦：系统设置 → 隐私与安全性 → 「仍要打开」（未签名构建）。"
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64) ASSET="CliFleet-$TAG-linux-x86_64.AppImage" ;;
      *) die "目前只提供 x86_64 的 AppImage；其他架构请从 Releases 手动下载 .deb" ;;
    esac
    say "下载 $ASSET ..."
    fetch "$ASSET" "$TMP/clifleet.AppImage" || die "下载失败"
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$TMP/clifleet.AppImage" "$HOME/.local/bin/clifleet"
    say ""
    say "装好了：$HOME/.local/bin/clifleet"
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) : ;;
      *) say "提示：把 ~/.local/bin 加进 PATH 才能直接敲 clifleet" ;;
    esac
    ;;
  *)
    die "这个脚本只处理 macOS / Linux；Windows 用：irm https://clifleet.vercel.app/install.ps1 | iex"
    ;;
esac
