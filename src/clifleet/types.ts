/** 工作台数据类型 —— 与 Rust src-tauri/src/tasks.rs 的 Task 字段一一对应。 */

export interface Task {
  /** 项目唯一 id（前端按文件夹生成） */
  id: string;
  /** 显示名（默认文件夹名，可重命名） */
  name: string;
  /** 绑定文件夹绝对路径 */
  dir: string;
  /** 手动排序权重（0=未排/置顶，>0 显式顺序）。后端 reorder_tasks 落盘 —— */
  order?: number;
  last_opened_at: number;
  created_at: number;
}

/** 规范化目录路径（去尾斜杠 + 小写），作项目去重键。 */
export function normDir(dir: string): string {
  return dir.replace(/[\\/]+$/, "").toLowerCase();
}

/** 任务名取文件夹名（路径末段）。 */
export function dirBasename(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || dir;
}

/** 用文件夹路径生成稳定 id（同一文件夹 → 同一任务，避免重复）。 */
export function taskIdFromDir(dir: string): string {
  const norm = dir.replace(/[\\/]+$/, "").toLowerCase();
  let h = 0;
  for (let i = 0; i < norm.length; i++) {
    h = (h * 31 + norm.charCodeAt(i)) | 0;
  }
  return "t" + (h >>> 0).toString(36);
}
