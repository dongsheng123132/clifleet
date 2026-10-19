#!/usr/bin/env node
/**
 * CI 专用：从刚构建的 exe 制作可发布的 Windows 绿色 ZIP。
 *
 * 语义与本地打包脚本一致：
 *  · 永远新建 staging，绝不复用曾启动过的 portable-data（那里可能含任务、路径等用户数据）
 *  · ZIP 只含 OpenCodex.exe + 空的 portable-data/README.txt
 *  · 产出 release-assets/OpenCodex-v{version}-windows-x64-portable.zip + 机器可读的 SHA256 输出
 *
 * 仅在 windows-latest runner 上由 workflow 调用（依赖 powershell.exe 的 Compress-Archive）。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const exe = join(root, "src-tauri", "target", "release", "opencodex.exe");
const assets = join(root, "release-assets");
const stage = join(assets, "portable-staging");
const zipName = `OpenCodex-v${version}-windows-x64-portable.zip`;
const zip = join(assets, zipName);

if (!existsSync(exe)) throw new Error(`找不到发布 exe：${exe}（先跑 pnpm tauri build --bundles nsis）`);
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(join(stage, "portable-data"), { recursive: true });
cpSync(exe, join(stage, "OpenCodex.exe"));
writeFileSync(
  join(stage, "portable-data", "README.txt"),
  "OpenCodex 的便携数据目录。\r\n\r\n首次启动后，项目列表会保存在这里（tasks.json）。请勿把包含个人数据的此目录再次打包或分享。\r\n",
  "utf8",
);

const ps = (s) => `'${s.replaceAll("'", "''")}'`;
execFileSync("powershell.exe", [
  "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
  `$ErrorActionPreference='Stop'; Compress-Archive -Path ${ps(join(stage, "*"))} -DestinationPath ${ps(zip)} -Force`,
], { stdio: "inherit" });

const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
console.log(`已创建绿色包：${zipName}`);
console.log(`SHA256 ${zipName} = ${sha256}`);
