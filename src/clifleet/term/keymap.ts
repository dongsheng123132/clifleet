/**
 * 终端快捷键映射 —— 纯函数，按平台走各自的终端惯例。
 *
 * - Windows（Windows Terminal 习惯）：Ctrl+C/V 复制粘贴（无选区的 Ctrl+C 仍是中断）。
 * - macOS：Cmd 管复制粘贴/字号；**Ctrl 组合一律原样进 PTY** —— Ctrl+C 永远是中断，
 *   Ctrl+V 是 Claude Code 在 mac 上的贴图键。
 * - Linux（GNOME Terminal 习惯）：Ctrl+Shift+C/V 复制粘贴；纯 Ctrl+C/V 原样进 PTY。
 *
 * 不 import 任何东西、只用可擦除的 TS 语法：`node --test` 直接 type-strip 跑（test/keymap.test.mjs）。
 */

export type HostOs = "macos" | "windows" | "linux";

export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey: boolean;
};

/** null = 不拦截，交给 xterm 按原样发给 PTY。 */
export type TermKeyAction = "paste" | "copy" | "swallow" | "fontUp" | "fontDown" | "fontReset" | "softReset";

/** 应用级快捷键动作（标签管理）。null = 不是应用快捷键，原样交给终端/浏览器。 */
export type AppKeyAction = "newTab" | "closeTab" | "nextTab" | "prevTab" | "tab1" | "tab2" | "tab3" | "tab4" | "tab5" | "tab6" | "tab7" | "tab8" | "tab9";

/** 按 UA 判平台：WebView2 带 "Windows"，WKWebView 带 "Macintosh"，WebKitGTK 带 "X11; Linux"。 */
export function detectHostOs(ua: string): HostOs {
  if (/Mac/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "linux";
}

/** 当前宿主平台。键盘处理要同步拿到，所以不等 get_env；Node 测试环境无 navigator → linux。 */
export const HOST_OS: HostOs = detectHostOs(typeof navigator === "undefined" ? "" : navigator.userAgent);

export function termKeyAction(e: KeyLike, os: HostOs, hasSelection: boolean): TermKeyAction | null {
  const k = e.key.toLowerCase();
  if (e.shiftKey && k === "insert") return "paste";

  // Codex CLI Windows 图片粘贴键。必须优先交给 CLI，不能被通用 Ctrl+V 文本粘贴吞掉。
  if (os === "windows" && e.ctrlKey && e.altKey && k === "v") return null;

  // 复制粘贴的修饰键：各平台不同
  const clip =
    os === "windows" ? e.ctrlKey || e.metaKey : os === "macos" ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey;
  if (clip && k === "v") return "paste";
  if (clip && k === "c") {
    if (hasSelection) return "copy";
    // Windows 无选区放行 ^C 中断；mac 的 Cmd+C、Linux 的 Ctrl+Shift+C 本来就不是中断，吞掉
    return os === "windows" ? null : "swallow";
  }

  // 字号 / 软重置的修饰键：mac 用 Cmd，其余用 Ctrl（Windows 维持 ctrl||meta 旧行为）
  const mod = os === "macos" ? e.metaKey && !e.ctrlKey : os === "windows" ? e.ctrlKey || e.metaKey : e.ctrlKey;
  if (!mod) return null;
  if (k === "=" || k === "+") return "fontUp";
  if (k === "-" || k === "_") return "fontDown";
  if (k === "0") return "fontReset";
  if (e.shiftKey && k === "r") return "softReset";
  return null;
}

/**
 * 应用级标签快捷键（不是终端内快捷键，交给 TermPanel 的 window 监听）。
 *
 * - macOS：Cmd+T 新建、Cmd+W 关闭、Cmd+Shift+[ / ] 切换、Cmd+1..9 跳标签。
 * - Windows / Linux：Ctrl+Shift+T 新建、Ctrl+Shift+W 关闭、Ctrl+Tab / Ctrl+Shift+Tab 切换、Ctrl+1..9 跳标签。
 *
 * 刻意保持「窄」：Ctrl+T / Ctrl+W（Windows）与 Cmd+C/V 等一律返回 null，
 * 继续原样进 PTY（比如 Claude Code 的 Ctrl+T、shell 的 Ctrl+W 删词）。
 */
export function appKeyAction(e: KeyLike, os: HostOs): AppKeyAction | null {
  const k = e.key.toLowerCase();

  if (os === "macos") {
    // 只认纯 Cmd 组合；带 Ctrl/Alt 的一律不抢
    if (!e.metaKey || e.ctrlKey || e.altKey) return null;
    if (k === "t") return "newTab";
    if (k === "w") return "closeTab";
    // Cmd+Shift+[ / ]：美式键盘在 Shift 下 key 会变成 "{" / "}"，两种都认
    if (e.shiftKey && (k === "[" || k === "{")) return "prevTab";
    if (e.shiftKey && (k === "]" || k === "}")) return "nextTab";
    if (k >= "1" && k <= "9") return `tab${k}` as AppKeyAction;
    return null;
  }

  // Windows / Linux：只认 Ctrl（不认 Meta/Alt）
  if (!e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.shiftKey) {
    if (k === "t") return "newTab";
    if (k === "w") return "closeTab";
    if (k === "tab") return "prevTab";
    // Ctrl+Shift+C/V 等复制粘贴键必须原样进 PTY / 交给 termKeyAction
    return null;
  }
  if (k === "tab") return "nextTab";
  if (k >= "1" && k <= "9") return `tab${k}` as AppKeyAction;
  return null;
}
