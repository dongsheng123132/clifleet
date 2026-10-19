/**
 * 项目终端面板 —— 在项目文件夹（cwd）里开终端，跑 claude / codex 等 CLI。
 *
 * 复用 useTermGroup 引擎。每个项目一个 TermPanel 实例 = 一个独立终端 group。
 * PTY 保活：切项目时父级用 display:none 隐藏，本组件不卸载 → PTY 续跑；
 * 只有「关闭项目」父级才卸载本组件，useTermGroup 的卸载 effect 关掉本项目所有 PTY。
 */
import { useEffect, useRef, useState } from "react";
import { Plus, X, RotateCcw } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useI18n } from "../../i18n";
import { useTermGroup } from "../term/useTermGroup";
import "@xterm/xterm/css/xterm.css";

/** 把拖入的路径列表拼成命令行片段：含空格/特殊字符的路径加双引号，多个空格分隔，末尾留一个空格。 */
function pathsToCmdText(paths: string[]): string {
  const quote = (p: string) => (/[\s"'`$&|;()<>]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);
  return paths.map(quote).join(" ") + " ";
}

/** 终端顶栏一键启动的常用 AI 编程 CLI。点一下发进当前终端执行。 */
const QUICK_TOOLS: { label: string; cmd: string }[] = [
  { label: "claude", cmd: "claude" }, // Claude Code
  { label: "codex", cmd: "codex" }, // OpenAI Codex CLI
  { label: "gemini", cmd: "gemini" }, // Google Gemini CLI
  { label: "opencode", cmd: "opencode" }, // opencode
  { label: "aider", cmd: "aider" }, // aider
];

export function TermPanel({ cwd, active }: { cwd: string; active: boolean }) {
  const { t } = useI18n();
  const { hostRef, tabs, activeKey, setActiveKey, newTerm, closeTerm, runInActive, pasteToActive, fontSize, bumpFontSize, resetActive } =
    useTermGroup({
      open: active,
      cwd,
    });

  // 拖放落路径：拖文件/图片/文件夹到本终端区 → 把真实路径写进当前命令行（不自动回车）。
  // 走 Tauri 窗口级 onDragDropEvent（webview 拦了 HTML5 drag，但能给真实文件系统路径）。
  // 多终端时按落点屏幕坐标判断命中哪个宿主，只往被拖到的那个写。dragOver 时高亮。
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    if (!active) return; // 只有激活的会话面板才响应（隐藏的不抢拖放）
    let un: (() => void) | undefined;
    let cancelled = false;
    const hostHit = (x: number, y: number) => {
      const el = hostRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      // onDragDropEvent 的 position 是物理像素，需除以 devicePixelRatio 换算成 CSS 像素
      const dpr = window.devicePixelRatio || 1;
      const cx = x / dpr;
      const cy = y / dpr;
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "over") {
          setDragOver(hostHit(p.position.x, p.position.y));
        } else if (p.type === "drop") {
          const hit = hostHit(p.position.x, p.position.y);
          setDragOver(false);
          if (hit && p.paths && p.paths.length) pasteToActive(pathsToCmdText(p.paths));
        } else {
          setDragOver(false); // leave/cancel
        }
      })
      .then((f) => {
        if (cancelled) f();
        else un = f;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      un?.();
    };
  }, [active, hostRef, pasteToActive]);

  // 关闭防误触：第一次点 × 进入「待确认」（按钮变红 ✓），2 秒内再点一次才真关闭，
  // 否则自动撤销。避免手滑把跑着 claude code 的终端一下点没了。
  const [confirmKey, setConfirmKey] = useState<number | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseClick = (key: number) => {
    if (confirmKey === key) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmKey(null);
      closeTerm(key);
    } else {
      setConfirmKey(key);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmKey(null), 2000);
    }
  };
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 标签栏 */}
      <div className="flex items-center h-8 px-2 gap-1 border-b border-white/[0.06] bg-bg-1 shrink-0">
        <div className="flex items-center gap-1 min-w-0 shrink overflow-x-auto">
          {tabs.map((tab) => {
            const pending = confirmKey === tab.key;
            return (
              <div
                key={tab.key}
                onClick={() => setActiveKey(tab.key)}
                className={
                  "group flex items-center gap-1.5 h-6 pl-2.5 pr-1 rounded cursor-pointer text-[12px] shrink-0 " +
                  (tab.key === activeKey ? "bg-accent/[0.12] text-ink-0" : "text-ink-3 hover:bg-white/[0.04]")
                }
              >
                <span className="whitespace-nowrap">{tab.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseClick(tab.key);
                  }}
                  className={
                    "inline-flex items-center justify-center w-4 h-4 rounded ml-0.5 transition-all " +
                    (pending
                      ? "opacity-100 bg-danger-500/90 text-white" // 待确认：红底，再点一次才真关
                      : "opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]")
                  }
                  title={pending ? t("Click again to confirm close") : t("Close this terminal")}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => newTerm()}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-2 bg-white/[0.04] border border-white/[0.10] hover:text-ink-0 hover:bg-accent/[0.18] hover:border-accent/40 shrink-0 transition-colors"
            title={t("New terminal tab")}
          >
            <Plus size={14} />
          </button>
          {/* 字号调节：A- / 当前值 / A+（也可用 Ctrl +/- 调，Ctrl 0 复位） */}
          <div className="flex items-center gap-0.5 ml-1.5 pl-1.5 border-l border-white/[0.06] shrink-0">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => bumpFontSize(-1)}
              title={t("Decrease font size (Ctrl -)")}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[13px] leading-none text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
            >
              −
            </button>
            <span className="text-[10px] text-ink-4 tabular-nums w-4 text-center" title={t("Current font size")}>{fontSize}</span>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => bumpFontSize(1)}
              title={t("Increase font size (Ctrl +)")}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[13px] leading-none text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
            >
              +
            </button>
          </div>
          {/* 重置终端：一键清掉 TUI 崩溃残留的卡死模式（鼠标坐标乱码/花屏/粘贴异常/光标消失/方向键错乱）。
              只重置 xterm 模拟器自身，不清屏、不碰 shell → 零副作用，卡住了随手点一下（或 Ctrl+Shift+R）。 */}
          <div className="flex items-center ml-1.5 pl-1.5 border-l border-white/[0.06] shrink-0">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={resetActive}
              title={t("Reset terminal (Ctrl+Shift+R): clears mouse garbage, screen artifacts, and lost-cursor states left behind when claude/codex-style TUIs crash")}
              className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
        {/* 快捷词：内置常用 AI CLI，占满剩余空间。onMouseDown preventDefault：点按钮不抢终端焦点。 */}
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto flex-1 pl-2 ml-1 border-l border-white/[0.06] no-scrollbar">
          {QUICK_TOOLS.map((q) => (
            <button
              key={q.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runInActive(q.cmd)}
              title={t("Run in terminal: {cmd}", { cmd: q.cmd })}
              className="h-6 px-2 rounded text-[11px] text-ink-3 hover:text-ink-0 hover:bg-accent/[0.14] transition-colors shrink-0"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
      {/* 终端宿主 */}
      <div ref={hostRef} className="relative flex-1 min-h-0 bg-[#0d0d0f]">
        {dragOver && (
          <div className="pointer-events-none absolute inset-1 z-20 rounded-md border-2 border-dashed border-accent/70 bg-accent/[0.08] flex items-center justify-center">
            <span className="text-[12px] text-accent-400 bg-bg-2/90 px-2.5 py-1 rounded">{t("Drop to insert the path into the command line")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
