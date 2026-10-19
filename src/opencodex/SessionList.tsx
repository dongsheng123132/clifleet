/**
 * 左侧项目列表 —— 平铺（无分组、无拖拽排序）。
 * 每行 = 项目名（双击重命名）+ 关闭按钮；点击行切换激活项目。
 * 顶栏 "Projects" + 收起按钮；「Open folder…」选文件夹建项目。
 */
import { useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, FolderPlus, FolderOpen, Download } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useWorkbench } from "./store";
import { useI18n } from "../i18n";

export function SessionList() {
  const { t } = useI18n();
  const { state, addTask, removeTask, renameTask, activate, reloadTasks } = useWorkbench();

  // 收起成窄条（44px），只留展开 + 新建项目两个图标。纯视图偏好，localStorage 记住。
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem("opencodex.sidebar.collapsed") === "1",
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem("opencodex.sidebar.collapsed", n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: t("Select a project folder") });
    if (typeof dir === "string" && dir) await addTask(dir);
  };

  // 从 U-King 工作台导入项目 —— importing 防重入；结果贴在列表底部就地显示，
  // 不另建 toast 组件（守「极简」边界）。
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };
  const importUking = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const r = await invoke<{ imported: number; skipped: number; source_exists: boolean }>(
        "import_uking_tasks",
      );
      if (!r.source_exists) {
        showNotice(t("No U-King workspace data found (~/.uking/tasks.json)"));
      } else if (r.imported > 0) {
        showNotice(
          t("Imported {n} project(s) from U-King ({skipped} already present)", {
            n: r.imported,
            skipped: r.skipped,
          }),
        );
        reloadTasks();
      } else {
        showNotice(
          t("Nothing to import — all {skipped} U-King project(s) are already here", {
            skipped: r.skipped,
          }),
        );
      }
    } catch (e) {
      showNotice(t("Import failed: {err}", { err: String(e) }));
    } finally {
      setImporting(false);
    }
  };

  // 正在重命名的项目 id + 输入框内容。双击名字进入，回车/失焦保存，Esc 取消。
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);

  // 关闭项目 —— 两击确认（和终端标签同款防误触）：第一下变红，2 秒内再点才真关。
  // 不用原生确认框：自动化实测它在合成点击下会被意外确认，两击确认单次点击永远删不掉。
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDelClick = (id: string) => {
    if (pendingClose === id) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setPendingClose(null);
      void removeTask(id);
    } else {
      setPendingClose(id);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setPendingClose(null), 2000);
    }
  };

  // 折叠态：窄条 —— 只留展开 + 新建项目两个图标，把空间全让给终端
  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 flex flex-col items-center gap-1 py-2 border-r border-white/[0.06] bg-bg-1 min-h-0">
        <button
          onClick={toggleCollapsed}
          title={t("Expand project bar")}
          className="w-8 h-8 grid place-items-center rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
        >
          <ChevronsRight size={16} />
        </button>
        <button
          onClick={pickFolder}
          title={t("Open folder…")}
          className="w-8 h-8 grid place-items-center rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
        >
          <FolderPlus size={15} />
        </button>
        <button
          onClick={importUking}
          disabled={importing}
          title={t("Import projects from the U-King workspace (~/.uking/tasks.json)")}
          className={
            "w-8 h-8 grid place-items-center rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]" +
            (importing ? " opacity-40" : "")
          }
        >
          <Download size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="relative shrink-0 flex flex-col border-r border-white/[0.06] bg-bg-1 min-h-0 w-60">
      {/* 顶部标题 + 收起按钮 */}
      <div className="px-3 pt-3 pb-1 shrink-0 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{t("Projects")}</span>
        <button
          onClick={toggleCollapsed}
          title={t("Collapse project bar (give the space to the terminal)")}
          className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06]"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>

      {/* 打开文件夹 —— 唯一的新建入口 */}
      <div className="px-2.5 pt-2 pb-2 shrink-0">
        <button
          onClick={pickFolder}
          className="w-full inline-flex items-center gap-2 h-8 px-2.5 rounded-card bg-accent/[0.14] text-accent-400 hover:bg-accent/[0.20] text-[12.5px] font-medium"
        >
          <FolderOpen size={14} />
          {t("Open folder…")}
        </button>
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto py-1.5 min-h-0">
        {state.tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-ink-4 text-[12px] leading-relaxed">
            {t("No projects yet.")}
            <br />
            {t('Click "Open folder…" to add one.')}
          </div>
        ) : (
          state.tasks.map((task) => {
            const on = state.activeId === task.id;
            return (
              <div
                key={task.id}
                onClick={() => activate(task.id)}
                className={
                  "group flex items-center gap-2 mx-1.5 mb-0.5 pl-2.5 pr-1 py-1.5 rounded-card cursor-pointer select-none " +
                  (on ? "bg-accent/[0.10]" : "hover:bg-white/[0.03]")
                }
                title={task.dir}
              >
                {renaming?.id === task.id ? (
                  // 重命名输入框：拦掉 click，否则会触发切换项目
                  <input
                    autoFocus
                    value={renaming.text}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: task.id, text: e.target.value })}
                    onBlur={() => {
                      void renameTask(task.id, renaming.text);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void renameTask(task.id, renaming.text);
                        setRenaming(null);
                      } else if (e.key === "Escape") {
                        setRenaming(null); // 原名不动
                      }
                    }}
                    className="flex-1 min-w-0 h-5 px-1 rounded bg-black/20 border border-accent/50 text-[12.5px] text-ink-0 outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenaming({ id: task.id, text: task.name });
                    }}
                    title={t("Double-click to rename")}
                    className={"flex-1 min-w-0 truncate text-[12.5px] " + (on ? "text-ink-0" : "text-ink-1")}
                  >
                    {task.name}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelClick(task.id);
                  }}
                  className={
                    "inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-all " +
                    (pendingClose === task.id
                      ? "opacity-100 bg-danger-500/90 text-white" // 待确认：红底，再点一次才真关
                      : "opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]")
                  }
                  title={
                    pendingClose === task.id
                      ? t("Click again to confirm close")
                      : t("Close project (ends its terminal sessions; the folder on disk is untouched)")
                  }
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* 导入结果就地提示（6 秒自动消失） */}
      {notice && (
        <div className="mx-1.5 mb-1 px-2.5 py-1.5 rounded-card bg-white/[0.06] text-[11px] leading-relaxed text-ink-2 shrink-0">
          {notice}
        </div>
      )}

      {/* 底部：导入 U-King + 版本号 */}
      <div className="px-2.5 py-2 border-t border-white/[0.06] shrink-0 flex items-center justify-between">
        <button
          onClick={importUking}
          disabled={importing}
          title={t("Import projects from the U-King workspace (~/.uking/tasks.json)")}
          className={
            "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-ink-5 hover:text-ink-2 hover:bg-white/[0.05]" +
            (importing ? " opacity-40" : "")
          }
        >
          <Download size={11} />
          {importing ? t("Importing…") : t("Import U-King")}
        </button>
        <span
          className="text-[10px] font-mono text-ink-5 px-1.5 py-0.5 rounded bg-white/[0.04]"
          title={t("OpenCodex version")}
        >
          v{__APP_VERSION__}
        </span>
      </div>
    </aside>
  );
}
