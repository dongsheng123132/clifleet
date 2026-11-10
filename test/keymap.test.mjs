// 终端快捷键映射（src/clifleet/term/keymap.ts）的纯函数测试。
// 跑法：pnpm test（= node --test test/*.test.mjs；Node 22.18+/23.6+ 原生 type-strip .ts）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { termKeyAction, detectHostOs, appKeyAction } from "../src/clifleet/term/keymap.ts";

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
const ctrl = (k, extra = {}) => key(k, { ctrlKey: true, ...extra });
const cmd = (k, extra = {}) => key(k, { metaKey: true, ...extra });

test("detectHostOs：三种真实 WebView UA", () => {
  assert.equal(
    detectHostOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"),
    "windows",
  );
  assert.equal(detectHostOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"), "macos");
  assert.equal(detectHostOs("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)"), "linux");
});

test("windows：与改动前行为一致", () => {
  const os = "windows";
  assert.equal(termKeyAction(ctrl("v"), os, false), "paste");
  assert.equal(termKeyAction(ctrl("v", { altKey: true }), os, false), null, "Ctrl+Alt+V 交给 Codex CLI 粘贴图片");
  assert.equal(termKeyAction(ctrl("V", { shiftKey: true }), os, false), "paste");
  assert.equal(termKeyAction(ctrl("c"), os, true), "copy");
  assert.equal(termKeyAction(ctrl("c"), os, false), null, "无选区 Ctrl+C 放行成 ^C 中断");
  assert.equal(termKeyAction(key("Insert", { shiftKey: true }), os, false), "paste");
  assert.equal(termKeyAction(ctrl("="), os, false), "fontUp");
  assert.equal(termKeyAction(ctrl("+", { shiftKey: true }), os, false), "fontUp");
  assert.equal(termKeyAction(ctrl("-"), os, false), "fontDown");
  assert.equal(termKeyAction(ctrl("0"), os, false), "fontReset");
  assert.equal(termKeyAction(ctrl("R", { shiftKey: true }), os, false), "softReset");
  assert.equal(termKeyAction(ctrl("r"), os, false), null, "Ctrl+R（反向搜索）原样进 PTY");
  assert.equal(termKeyAction(key("a"), os, false), null);
});

test("macos：Cmd 管复制粘贴，Ctrl 组合一律进 PTY", () => {
  const os = "macos";
  assert.equal(termKeyAction(cmd("v"), os, false), "paste");
  assert.equal(termKeyAction(cmd("c"), os, true), "copy");
  assert.equal(termKeyAction(cmd("c"), os, false), "swallow");
  assert.equal(termKeyAction(ctrl("v"), os, false), null, "Ctrl+V 是 Claude Code 在 mac 上的贴图键");
  assert.equal(termKeyAction(ctrl("c"), os, true), null, "Ctrl+C 有选区也是中断");
  assert.equal(termKeyAction(ctrl("-"), os, false), null);
  assert.equal(termKeyAction(ctrl("0"), os, false), null);
  assert.equal(termKeyAction(cmd("="), os, false), "fontUp");
  assert.equal(termKeyAction(cmd("-"), os, false), "fontDown");
  assert.equal(termKeyAction(cmd("0"), os, false), "fontReset");
  assert.equal(termKeyAction(cmd("r", { shiftKey: true }), os, false), "softReset");
  assert.equal(termKeyAction(key("Insert", { shiftKey: true }), os, false), "paste");
});

test("linux：Ctrl+Shift+C/V 复制粘贴，纯 Ctrl+C/V 进 PTY", () => {
  const os = "linux";
  assert.equal(termKeyAction(ctrl("V", { shiftKey: true }), os, false), "paste");
  assert.equal(termKeyAction(ctrl("C", { shiftKey: true }), os, true), "copy");
  assert.equal(termKeyAction(ctrl("C", { shiftKey: true }), os, false), "swallow");
  assert.equal(termKeyAction(ctrl("v"), os, false), null);
  assert.equal(termKeyAction(ctrl("c"), os, true), null, "有选区的 Ctrl+C 也是中断");
  assert.equal(termKeyAction(key("Insert", { shiftKey: true }), os, false), "paste");
  assert.equal(termKeyAction(ctrl("="), os, false), "fontUp");
  assert.equal(termKeyAction(ctrl("-"), os, false), "fontDown");
  assert.equal(termKeyAction(ctrl("0"), os, false), "fontReset");
  assert.equal(termKeyAction(ctrl("R", { shiftKey: true }), os, false), "softReset");
  assert.equal(termKeyAction(cmd("v"), os, false), null, "Super+V 不归终端管");
});

// —— 应用级标签快捷键（appKeyAction）——

test("appKeyAction · macos：Cmd 管标签，Ctrl/Cmd+C 不抢", () => {
  const os = "macos";
  assert.equal(appKeyAction(cmd("t"), os), "newTab");
  assert.equal(appKeyAction(cmd("w"), os), "closeTab");
  // Cmd+Shift+[ / ]：美式键盘 key 是 { / }，两种都认
  assert.equal(appKeyAction(cmd("[", { shiftKey: true }), os), "prevTab");
  assert.equal(appKeyAction(cmd("{", { shiftKey: true }), os), "prevTab");
  assert.equal(appKeyAction(cmd("]", { shiftKey: true }), os), "nextTab");
  assert.equal(appKeyAction(cmd("}", { shiftKey: true }), os), "nextTab");
  assert.equal(appKeyAction(cmd("1"), os), "tab1");
  assert.equal(appKeyAction(cmd("9"), os), "tab9");
  // 回归：不能抢终端/系统的键
  assert.equal(appKeyAction(ctrl("t"), os), null, "mac Ctrl+T 必须进 PTY");
  assert.equal(appKeyAction(ctrl("w"), os), null, "mac Ctrl+W 必须进 PTY");
  assert.equal(appKeyAction(cmd("c"), os), null, "Cmd+C 是复制");
  assert.equal(appKeyAction(cmd("v"), os), null, "Cmd+V 是粘贴");
  assert.equal(appKeyAction(cmd("t", { altKey: true }), os), null);
  assert.equal(appKeyAction(cmd("t", { ctrlKey: true }), os), null);
  assert.equal(appKeyAction(key("t"), os), null);
});

test("appKeyAction · windows：Ctrl+Shift 管标签，Ctrl+T/W 仍进 PTY", () => {
  const os = "windows";
  assert.equal(appKeyAction(ctrl("T", { shiftKey: true }), os), "newTab");
  assert.equal(appKeyAction(ctrl("W", { shiftKey: true }), os), "closeTab");
  assert.equal(appKeyAction(ctrl("Tab"), os), "nextTab");
  assert.equal(appKeyAction(ctrl("Tab", { shiftKey: true }), os), "prevTab");
  assert.equal(appKeyAction(ctrl("1"), os), "tab1");
  assert.equal(appKeyAction(ctrl("9"), os), "tab9");
  // 回归：窄规则 —— 这些必须原样进 PTY
  assert.equal(appKeyAction(ctrl("t"), os), null, "Ctrl+T 不能被抢");
  assert.equal(appKeyAction(ctrl("w"), os), null, "Ctrl+W（删词）不能被抢");
  assert.equal(appKeyAction(ctrl("C", { shiftKey: true }), os), null, "Ctrl+Shift+C 是复制");
  assert.equal(appKeyAction(ctrl("V", { shiftKey: true }), os), null, "Ctrl+Shift+V 是粘贴");
  assert.equal(appKeyAction(ctrl("c"), os), null);
  assert.equal(appKeyAction(ctrl("Tab", { altKey: true }), os), null);
  assert.equal(appKeyAction(key("Tab"), os), null);
});

test("appKeyAction · linux：Ctrl+Shift 管标签，纯 Ctrl 不进应用层", () => {
  const os = "linux";
  assert.equal(appKeyAction(ctrl("T", { shiftKey: true }), os), "newTab");
  assert.equal(appKeyAction(ctrl("W", { shiftKey: true }), os), "closeTab");
  assert.equal(appKeyAction(ctrl("Tab"), os), "nextTab");
  assert.equal(appKeyAction(ctrl("Tab", { shiftKey: true }), os), "prevTab");
  assert.equal(appKeyAction(ctrl("1"), os), "tab1");
  assert.equal(appKeyAction(ctrl("t"), os), null);
  assert.equal(appKeyAction(ctrl("w"), os), null);
  assert.equal(appKeyAction(ctrl("C", { shiftKey: true }), os), null, "Linux Ctrl+Shift+C 是复制");
  assert.equal(appKeyAction(ctrl("c"), os), null, "Ctrl+C 是中断");
  assert.equal(appKeyAction(cmd("t"), os), null, "Super+T 不归应用管");
});
