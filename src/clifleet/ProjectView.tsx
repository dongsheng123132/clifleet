/**
 * 项目视图 —— 每个项目的主区：顶栏（项目名 + 目录路径）+ 全宽终端。
 * 无文件树 / 浏览器 / 模型 / 分屏入口 —— 终端就是全部。
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import type { Task } from "./types";
import { TermPanel } from "./panels/TermPanel";
import { useI18n } from "../i18n";

export function ProjectView({ task, active }: { task: Task; active: boolean }) {
  const { t } = useI18n();
  // 路径点击复制：「已复制」反馈 1.5s 后自动消失
  const [copied, setCopied] = useState(false);
  const copyDir = () => {
    invoke("clipboard_write", { text: task.dir }).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* 顶栏：项目名 + 小字目录路径（点击复制）+ 在资源管理器中打开 */}
      <div className="flex items-center gap-2 h-10 px-3 border-b border-white/[0.06] bg-bg-1 shrink-0">
        <span className="text-[13px] font-medium text-ink-0 truncate">{task.name}</span>
        <span
          onClick={copyDir}
          title={t("Click to copy the folder path")}
          className="text-ink-5 hover:text-ink-3 text-[11px] truncate max-w-[50%] font-mono cursor-pointer"
        >
          {copied ? <span className="text-accent-400">{t("Copied!")}</span> : task.dir}
        </span>
        <button
          onClick={() => invoke("reveal_dir", { path: task.dir }).catch(() => {})}
          title={t("Open folder in file explorer")}
          className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-4 hover:text-ink-0 hover:bg-white/[0.06] shrink-0"
        >
          <FolderOpen size={13} />
        </button>
      </div>
      {/* 主区：终端铺满全宽 */}
      <div className="flex-1 min-h-0 min-w-0">
        <TermPanel cwd={task.dir} active={active} />
      </div>
    </div>
  );
}
