/**
 * 项目视图 —— 每个项目的主区：顶栏（项目名 + 目录路径）+ 全宽终端。
 * 无文件树 / 浏览器 / 模型 / 分屏入口 —— 终端就是全部。
 */
import type { Task } from "./types";
import { TermPanel } from "./panels/TermPanel";

export function ProjectView({ task, active }: { task: Task; active: boolean }) {
  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* 顶栏：项目名 + 小字目录路径 */}
      <div className="flex items-center gap-2 h-10 px-3 border-b border-white/[0.06] bg-bg-1 shrink-0">
        <span className="text-[13px] font-medium text-ink-0 truncate">{task.name}</span>
        <span
          className="text-ink-5 text-[11px] truncate max-w-[50%] font-mono hidden lg:inline"
          title={task.dir}
        >
          {task.dir}
        </span>
      </div>
      {/* 主区：终端铺满全宽 */}
      <div className="flex-1 min-h-0 min-w-0">
        <TermPanel cwd={task.dir} active={active} />
      </div>
    </div>
  );
}
