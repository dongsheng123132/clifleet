#!/usr/bin/env node
/**
 * Sync CliFleet's projects into U-King's U-Workspace task list.
 *
 * Both sides share the same task schema. This is a data-layer merge:
 * existing U-King tasks keep their fields, and CliFleet-only projects are
 * appended with U-King defaults.
 *
 * Privacy: the real task files are user data. This script never prints the
 * project list, only counts. Override paths with CLIFLEET_JSON / UKING_JSON
 * to use fixture data. Default is preview-only; pass --apply to write.
 * A backup is created before an atomic replacement of the U-King task file.
 *
 * Run: node scripts/sync-uking-workspace.mjs [--apply]
 */
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const home = homedir();
const clifleetPath = process.env.CLIFLEET_JSON || path.join(home, ".clifleet", "tasks.json");
const ukingPath = process.env.UKING_JSON || path.join(home, ".uking", "tasks.json");
const apply = process.argv.includes("--apply");

const DEFAULTS = {
  status: "idle",
  source: "manual",
  assignee: null,
  external_ref: null,
  tool: null,
  startup_cmd: null,
  kind: "task",
  expert: null,
};

function readTasks(file) {
  if (!existsSync(file)) throw new Error(`找不到输入文件: ${file}`);
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(data.tasks)) throw new Error(`${file} 里没有 tasks 数组`);
  return data;
}

const normDir = (dir) => String(dir || "").replace(/[/\\]+$/, "").toLowerCase();

function fromClifleet(task) {
  return {
    id: task.id,
    name: task.name,
    dir: task.dir,
    ...DEFAULTS,
    last_opened_at: task.last_opened_at ?? 0,
    created_at: task.created_at ?? 0,
    order: task.order ?? 0,
  };
}

const clifleet = readTasks(clifleetPath);
const uking = readTasks(ukingPath);

const existingDirs = new Set(uking.tasks.map((task) => normDir(task.dir)));
const existingIds = new Set(uking.tasks.map((task) => task.id));
const added = [];

for (const task of clifleet.tasks) {
  const key = normDir(task.dir);
  if (!key || existingDirs.has(key) || existingIds.has(task.id)) continue;
  uking.tasks.push(fromClifleet(task));
  existingDirs.add(key);
  existingIds.add(task.id);
  added.push(task.id);
}

console.log(`来源项目数: ${clifleet.tasks.length}`);
console.log(`U-King 原有: ${uking.tasks.length - added.length}`);
console.log(`本次新增并入: ${added.length}`);
console.log(`合并后总数: ${uking.tasks.length}`);

if (!apply) {
  console.log("预览模式（未写入）。确认后加 --apply 落盘。");
  process.exit(0);
}

if (added.length === 0) {
  console.log("没有需要新增的项目，跳过写入。");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
const backup = `${ukingPath}.bak-${stamp}`;
const temp = `${ukingPath}.tmp-${randomUUID()}`;
const originalMode = statSync(ukingPath).mode & 0o777;
const original = readFileSync(ukingPath);
writeFileSync(backup, original, { mode: originalMode });

try {
  writeFileSync(temp, JSON.stringify(uking, null, 2) + "\n", { mode: originalMode });
  renameSync(temp, ukingPath);
} catch (error) {
  try {
    if (existsSync(temp)) unlinkSync(temp);
  } catch {}
  throw error;
}

console.log(`已写入 ${ukingPath}`);
console.log(`备份: ${backup}`);
