// 终端快捷键映射（src/clifleet/term/keymap.ts）的纯函数测试。
// 跑法：pnpm test（= node --test test/*.test.mjs；Node 22.18+/23.6+ 原生 type-strip .ts）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { termKeyAction, detectHostOs } from "../src/clifleet/term/keymap.ts";

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
