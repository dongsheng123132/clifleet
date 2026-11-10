#!/usr/bin/env python3
"""把 CliFleet 官网同步到国内镜像 https://u-claw.org.cn/clifleet/

为什么要有这个脚本（而不是手抄 rsync）：
  镜像挂在**子路径** /clifleet/ 下，而页面里的链接是给根域名写的
  （`/`、`/#install`、`/compare`、`/assets/…`）。直接 rsync 上去，点「安装」
  会跳到 u-claw.org.cn 首页——看起来"页面在"，实际全是死链。所以这里按顺序重写：
      "/assets/  → "/clifleet/assets/
      href="/"   → href="/clifleet/
      href="/#…" → href="/clifleet/#…
      href="/compare" → href="/clifleet/compare.html

前置：本机 ~/.ssh/config 里有 `gz` 别名，远端 sudo -n 可用（脚本用 sudo 落盘）。
  远端站点目录 /var/www/clifleet（nginx location ^~ /clifleet/）。

用法：
  python3 scripts/sync-domestic.py --dry-run     # 只生成到本地 .deploy/，不上传
  python3 scripts/sync-domestic.py               # 生成 + 上传 + 线上验收
  python3 scripts/sync-domestic.py --skip-verify # 上传但不做 HTTP 验收
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
STAGE = ROOT / ".deploy" / "clifleet"

HOST = "gz"
REMOTE_TMP = "/tmp/clifleet-site"
REMOTE_WWW = "/var/www/clifleet"
BASE_URL = "https://u-claw.org.cn/clifleet/"

# 子路径部署要改的东西，顺序有讲究：先改资源前缀，再改导航链接。
REWRITES = [
    ('"/assets/', '"/clifleet/assets/'),
    ('href="/compare"', 'href="/clifleet/compare.html"'),
    ('href="/#', 'href="/clifleet/#'),
    ('href="/"', 'href="/clifleet/"'),
]


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def stage_pages() -> list[pathlib.Path]:
    STAGE.parent.mkdir(parents=True, exist_ok=True)
    if STAGE.exists():
        for p in sorted(STAGE.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
    STAGE.mkdir(parents=True, exist_ok=True)

    written: list[pathlib.Path] = []

    # 1) 页面：重写根路径链接
    for name in ("index.html", "compare.html"):
        src = SITE / name
        text = src.read_text(encoding="utf-8")
        for old, new in REWRITES:
            text = text.replace(old, new)
        dst = STAGE / name
        dst.write_text(text, encoding="utf-8")
        written.append(dst)

    # 2) 安装脚本原样搬（nginx 按 text/plain 供，否则 irm|iex 乱码）
    for name in ("install.ps1", "install.sh", "shortcut.ps1"):
        src = SITE / name
        if src.exists():
            dst = STAGE / name
            dst.write_bytes(src.read_bytes())
            written.append(dst)

    # 3) 静态资源整棵搬
    assets_src = SITE / "assets"
    assets_dst = STAGE / "assets"
    assets_dst.mkdir(parents=True, exist_ok=True)
    for p in assets_src.rglob("*"):
        if p.is_file():
            rel = p.relative_to(assets_src)
            out = assets_dst / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(p.read_bytes())
    return written


def sanity_check(files: list[pathlib.Path]) -> list[str]:
    """上传前自检：漏改的根链接、重复前缀、页面里还残留 vercel 独有路径。"""
    problems: list[str] = []
    pages = [f for f in files if f.suffix == ".html"]
    for page in pages:
        text = page.read_text(encoding="utf-8")
        for bad, why in [
            ('href="/compare"', "根路径对比页链接没重写"),
            ('"/assets/', "资源前缀没重写"),
            ('"/clifleet/clifleet/', "前缀被重复叠加"),
        ]:
            if bad in text:
                problems.append(f"{page.name}: {why} ({bad})")
        for m in re.finditer(r'href="(/[^"]*)"', text):
            href = m.group(1)
            if not href.startswith("/clifleet/"):
                problems.append(f"{page.name}: 绝对路径没落到 /clifleet/ → {href}")
    return problems


def upload() -> None:
    run(["ssh", HOST, f"rm -rf {REMOTE_TMP} && mkdir -p {REMOTE_TMP}"])
    run(["rsync", "-az", "--delete", f"{STAGE}/", f"{HOST}:{REMOTE_TMP}/"])
    # SHA256SUMS.txt 必须跟着发版一起更新：安装脚本会拿它校验刚下下来的包，
    # 留着上一版的校验和 = 新包校验不过（曾经因为 --exclude 它而踩过）。
    run(
        [
            "ssh",
            HOST,
            f"sudo rsync -a {REMOTE_TMP}/ {REMOTE_WWW}/ && "
            f"sudo chown -R root:root {REMOTE_WWW} && sudo nginx -t",
        ]
    )


def write_version_and_checksums(version: str) -> None:
    """写 version.json（安装脚本第一优先读它决定装哪个版本）+ 拉该版本的 SHA256SUMS。

    顺序很重要：version.json 是安装脚本的版本来源，它比安装包先上线的话，
    用户会在包还没同步完时被指到一个还不存在的 tag —— 所以发布顺序是
    「先传二进制 → 再传 version.json → 最后传页面」。
    """
    tag = f"v{version}"
    vj = {
        "version": tag,
        "tag": tag,
        "repo": "https://github.com/dongsheng123132/clifleet",
        "updated": subprocess.run(
            ["date", "+%Y-%m-%dT%H:%M:%S%z"], capture_output=True, text=True, check=True
        ).stdout.strip(),
    }
    (STAGE / "version.json").write_text(json.dumps(vj, ensure_ascii=False, indent=2), encoding="utf-8")

    # SHA256SUMS 从 GitHub Release 取（CI 产物），拿不到不算失败——安装脚本会跳过校验
    url = f"https://github.com/dongsheng123132/clifleet/releases/download/{tag}/SHA256SUMS.txt"
    try:
        data = run(["curl", "-fsSL", "--max-time", "60", url]).stdout
        (STAGE / "SHA256SUMS.txt").write_text(data, encoding="utf-8")
        print(f"checksums: 取到 {tag} 的 SHA256SUMS.txt（{len(data.splitlines())} 行）")
    except subprocess.CalledProcessError:
        print(f"警告：{tag} 的 SHA256SUMS.txt 取不到（安装脚本会跳过校验）", file=sys.stderr)


ASSETS = [
    "CliFleet-{v}-windows-x64-setup.exe",
    "CliFleet-{v}-windows-x64-portable.zip",
    "CliFleet-{v}-macos-arm64.dmg",
    "CliFleet-{v}-macos-x86_64.dmg",
    "CliFleet-{v}-linux-x86_64.AppImage",
    "CliFleet-{v}-linux-x86_64.deb",
]


def sync_binaries(version: str) -> None:
    """让远端自己从 GitHub 拉安装包（本机不必先下载几百 MB），已存在则跳过。

    国内机直连 GitHub Release 会卡（实测 AppImage 80MB 停在 12MB 十几分钟不动），
    所以按「加速镜像 → 直连」的顺序试；任一成功即可。
    """
    tag = f"v{version}"
    names = " ".join(a.format(v=tag) for a in ASSETS) + " SHA256SUMS.txt"
    script = f"""
set -u
D=/var/www/dl-root/download/clifleet
sudo -n mkdir -p "$D"
GH=https://github.com/dongsheng123132/clifleet/releases/download/{tag}
for f in {names}; do
  if sudo -n test -s "$D/$f"; then echo "skip $f"; continue; fi
  ok=0
  for base in "https://gh-proxy.com/$GH" "https://ghfast.top/$GH" "$GH"; do
    if curl -fsSL --max-time 300 --retry 1 -o "/tmp/$f" "$base/$f"; then ok=1; break; fi
  done
  if [ "$ok" = 1 ] && [ -s "/tmp/$f" ]; then
    sudo -n mv "/tmp/$f" "$D/$f" && echo "ok $f"
  else
    echo "FAIL $f" >&2
  fi
done
sudo -n chown -R root:root "$D"
sudo -n find "$D" -type f -exec chmod 644 {{}} \\;
ls -lh "$D" | tail -n +2 | awk '{{print $5, $9}}'
"""
    out = run(["ssh", HOST, script]).stdout
    print(out.rstrip())


def verify() -> list[str]:
    failures: list[str] = []
    checks = {
        BASE_URL: ["CliFleet", "clifleet/assets/app.css"],
        BASE_URL + "compare.html": ["CliFleet vs cmux", "FAQPage"],
        BASE_URL + "assets/app.css": ["--tw-"],
        BASE_URL + "version.json": ['"tag"', '"v'],
    }
    for url, needles in checks.items():
        try:
            out = run(["curl", "-fsS", "-m", "20", url]).stdout
        except subprocess.CalledProcessError:
            failures.append(f"{url} 取不到")
            continue
        for n in needles:
            if n not in out:
                failures.append(f"{url} 缺少 {n!r}")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只生成到 .deploy/，不上传")
    ap.add_argument("--skip-verify", action="store_true", help="上传后不做 HTTP 验收")
    ap.add_argument(
        "--release",
        action="store_true",
        help="同时同步 version.json / SHA256SUMS / 安装包（发版后跑这个）",
    )
    args = ap.parse_args()

    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    print(f"== CliFleet v{version} → {BASE_URL} ==")

    files = stage_pages()
    print(f"staged {len(files)} page/script files + assets → {STAGE}")

    if args.release:
        write_version_and_checksums(version)

    problems = sanity_check(files)
    if problems:
        print("!! 自检不通过，已停止（没有上传）：", file=sys.stderr)
        for p in problems:
            print("   -", p, file=sys.stderr)
        return 2
    print("sanity: OK（无残留根路径链接）")

    if args.dry_run:
        print("dry-run：未上传。检查 " + str(STAGE))
        return 0

    # 发版顺序：先让安装包在位，再让 version.json 指过去（否则用户会拿到还不存在的 tag）
    if args.release:
        print("== 1/3 同步安装包到 /var/www/dl-root/download/clifleet ==")
        sync_binaries(version)

    upload()
    print("uploaded + nginx -t OK")

    if args.skip_verify:
        return 0
    failures = verify()
    if failures:
        print("!! 线上验收失败：", file=sys.stderr)
        for f in failures:
            print("   -", f, file=sys.stderr)
        return 3
    print("verify: OK（页面 / 对比页 / CSS 均可达）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
