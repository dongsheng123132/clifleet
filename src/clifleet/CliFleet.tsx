/**
 * CliFleet 工作台主框架 —— 左项目列表 | 右 项目终端区。
 * 保活：每个项目整组常驻渲染，靠 display 切换显示，切项目不杀 PTY。
 */
import { useEffect, useRef } from "react";
import { FolderPlus } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { WorkbenchProvider, useWorkbench } from "./store";
import type { Task } from "./types";
import { SessionList } from "./SessionList";
import { ProjectView } from "./ProjectView";
import { useI18n } from "../i18n";

type Props = {
  openedDir: string | null;
};

function WorkbenchInner({ openedDir }: Props) {
  const { t } = useI18n();
  const { state, addTask } = useWorkbench();
  const consumedDir = useRef<string | null>(null);

  // 命令行 --open-dir 透传的目录 → 自动建项目并激活（同文件夹已有则激活）
  useEffect(() => {
    if (!state.loaded || !openedDir || consumedDir.current === openedDir) return;
    consumedDir.current = openedDir;
    void addTask(openedDir);
  }, [state.loaded, openedDir, addTask]);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: t("Select a project folder") });
    if (typeof dir === "string" && dir) await addTask(dir);
  };

  return (
    <div className="flex h-full min-h-0 rounded-card border border-white/[0.08] overflow-hidden bg-bg-2">
      <SessionList />
      <div className="flex-1 min-w-0 min-h-0 relative">
        {state.tasks.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="text-ink-1 text-[15px] font-medium">{t("Open a folder to get started")}</div>
            <div className="text-ink-4 text-[13px] leading-relaxed max-w-sm">
              {t("Pick a folder — it becomes a project, and the main area is a real terminal\nwhere you can run claude / codex / any CLI.")}
            </div>
            <button
              onClick={pickFolder}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-accent hover:bg-accent-600 text-white text-[13px] font-medium"
            >
              <FolderPlus size={15} />
              {t("Open folder…")}
            </button>
          </div>
        ) : (
          state.tasks.map((task: Task) => (
            <div
              key={task.id}
              className="absolute inset-0"
              style={{ display: state.activeId === task.id ? "block" : "none" }}
            >
              <ProjectView task={task} active={state.activeId === task.id} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function CliFleet(props: Props) {
  return (
    <WorkbenchProvider>
      <WorkbenchInner {...props} />
    </WorkbenchProvider>
  );
}
