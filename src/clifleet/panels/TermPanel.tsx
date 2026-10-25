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

/** 终端顶栏一键启动的常用 AI 编程 CLI（默认集，用户可改）。点一下发进当前终端执行。 */
const DEFAULT_QUICK_TOOLS: { label: string; cmd: string }[] = [
  { label: "claude", cmd: "claude" }, // Claude Code
  { label: "codex", cmd: "codex" }, // OpenAI Codex CLI
  { label: "opencode", cmd: "opencode" }, // opencode
  { label: "pi", cmd: "pi" }, // pi coding agent
];

/** 快捷词持久化 key（localStorage；存整个列表，label+cmd）。 */
const QUICK_KEY = "clifleet.quickTools";

/** 历史默认集（按 cmd 序列比对）——用于一次性迁移。
 *  只有当用户列表恰好等于某个旧默认集（说明他没改过）时才换成新默认集；
 *  用户自己加过/删过的列表一律不动（不静默覆盖用户数据）。 */
const LEGACY_DEFAULT_CMDS: string[] = ["claude,codex,gemini,opencode,aider", "claude,codex,gemini,opencode,pi"];

/** 读用户自定义快捷词；没有/坏了/恰好等于旧默认集 → 用新默认集。 */
function loadQuickTools(): { label: string; cmd: string }[] {
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    if (!raw) return DEFAULT_QUICK_TOOLS;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_QUICK_TOOLS;
    const clean = arr
      .filter((x) => x && typeof x.label === "string" && typeof x.cmd === "string")
      .map((x) => ({ label: x.label.slice(0, 24), cmd: x.cmd.slice(0, 200) }));
    if (!clean.length) return DEFAULT_QUICK_TOOLS;
    if (LEGACY_DEFAULT_CMDS.includes(clean.map((x) => x.cmd).join(","))) return DEFAULT_QUICK_TOOLS;
    return clean;
  } catch {
    return DEFAULT_QUICK_TOOLS;
  }
}

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

  // 快捷词：默认内置，用户可增删，localStorage 记住（全局共享，所有项目同一份）
  const [quickTools, setQuickTools] = useState(loadQuickTools);
  const [pendingDel, setPendingDel] = useState<number | null>(null);
  const delTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (delTimer.current) clearTimeout(delTimer.current);
  }, []);
  const saveQuickTools = (next: { label: string; cmd: string }[]) => {
    setQuickTools(next);
    try {
      localStorage.setItem(QUICK_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // 行内「添加快捷词」小表单（window.prompt 在 Tauri WebView 不可用，用行内输入框）
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const submitNew = () => {
    const label = newLabel.trim();
    const cmd = newCmd.trim();
    if (!label || !cmd) return;
    saveQuickTools([...quickTools, { label: label.slice(0, 24), cmd: cmd.slice(0, 200) }]);
    setAdding(false);
    setNewLabel("");
    setNewCmd("");
  };

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
        </div>
        {/* 快捷词：默认内置常用 AI CLI，用户可增删（localStorage 记住）。点=运行，右键=删除。
            onMouseDown preventDefault：点按钮不抢终端焦点。占中间弹性空间。 */}
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto flex-1 pl-2 ml-1 border-l border-white/[0.06] no-scrollbar">
          {quickTools.map((q, i) => (
            <button
              key={q.label + i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runInActive(q.cmd)}
              onContextMenu={(e) => {
                // 右键删除（带确认——按钮先变红再点一次才真删，和终端标签同款防误触）
                e.preventDefault();
                if (pendingDel === i) {
                  setPendingDel(null);
                  const next = quickTools.filter((_, j) => j !== i);
                  setQuickTools(next);
                  try {
                    localStorage.setItem(QUICK_KEY, JSON.stringify(next));
                  } catch {
                    /* ignore */
                  }
                } else {
                  setPendingDel(i);
                  if (delTimer.current) clearTimeout(delTimer.current);
                  delTimer.current = setTimeout(() => setPendingDel(null), 2000);
                }
              }}
              title={pendingDel === i ? t("Click again to remove this quick command") : t("Run in terminal: {cmd} (right-click to remove)", { cmd: q.cmd })}
              className={
                "h-6 px-2 rounded text-[11px] transition-colors shrink-0 " +
                (pendingDel === i
                  ? "bg-danger-500/90 text-white"
                  : "text-ink-3 hover:text-ink-0 hover:bg-accent/[0.14]")
              }
            >
              {q.label}
            </button>
          ))}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAdding((a) => !a);
              setNewLabel("");
              setNewCmd("");
            }}
            title={t("Add a quick command")}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-ink-4 hover:text-ink-0 hover:bg-white/[0.06] shrink-0"
          >
            <Plus size={12} />
          </button>
        </div>
        {/* 右端：字号调节 + 软重置 —— 「视图调节」归右，和左侧「页面管理」隔开，不堆一起。
            字号：A- / 当前值 / A+（也可 Ctrl +/- 调，Ctrl 0 复位 14）。 */}
        <div className="flex items-center gap-0.5 pl-2 ml-1 border-l border-white/[0.06] shrink-0">
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
          {/* 重置终端：一键清掉 TUI 崩溃残留的卡死模式（鼠标坐标乱码/花屏/粘贴异常/光标消失/方向键错乱）。
              只重置 xterm 模拟器自身，不清屏、不碰 shell → 零副作用，卡住了随手点一下（或 Ctrl+Shift+R）。 */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={resetActive}
            title={t("Reset terminal (Ctrl+Shift+R): clears mouse garbage, screen artifacts, and lost-cursor states left behind when claude/codex-style TUIs crash")}
            className="inline-flex items-center justify-center w-6 h-6 rounded ml-1 text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      {/* 行内添加快捷词表单：名字 + 命令，回车保存，Esc 取消 */}
      {adding && (
        <div className="flex items-center gap-1.5 h-9 px-2 border-b border-white/[0.06] bg-bg-1 shrink-0">
          <input
            autoFocus
            placeholder={t("Name (e.g. claude)")}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              else if (e.key === "Escape") setAdding(false);
            }}
            className="w-32 h-6 px-2 rounded bg-black/20 border border-white/[0.14] focus:border-accent/60 text-[12px] text-ink-0 outline-none"
          />
          <input
            placeholder={t("Command (e.g. claude --continue)")}
            value={newCmd}
            onChange={(e) => setNewCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              else if (e.key === "Escape") setAdding(false);
            }}
            className="flex-1 min-w-0 h-6 px-2 rounded bg-black/20 border border-white/[0.14] focus:border-accent/60 text-[12px] text-ink-0 outline-none font-mono"
          />
          <button
            onClick={submitNew}
            title={t("Save")}
            className="h-6 px-2.5 rounded text-[11.5px] bg-accent/[0.14] text-accent-400 hover:bg-accent/[0.20] shrink-0"
          >
            {t("Save")}
          </button>
          <button
            onClick={() => setAdding(false)}
            title={t("Cancel")}
            className="h-6 px-2.5 rounded text-[11.5px] text-ink-3 hover:text-ink-0 hover:bg-white/[0.06] shrink-0"
          >
            {t("Cancel")}
          </button>
        </div>
      )}
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
