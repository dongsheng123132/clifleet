/**
 * 工作台状态 —— useReducer + Context（不引 zustand，守体积红线）。
 *
 * 持久化：项目列表落 ~/.opencodex/tasks.json（后端 tasks.rs）。
 * 项目来源（应用内选文件夹 / --open-dir 透传）统一经 addTask 写进同一份 tasks.json。
 */
import { createContext, useContext, useEffect, useReducer, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Task } from "./types";
import { dirBasename, normDir, taskIdFromDir } from "./types";

type State = {
  tasks: Task[];
  activeId: string | null;
  loaded: boolean;
};

type Action =
  | { type: "load"; tasks: Task[] }
  | { type: "upsert"; task: Task }
  | { type: "remove"; id: string }
  | { type: "reorder"; ids: string[] }
  | { type: "activate"; id: string };

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "load":
      return { ...state, tasks: a.tasks, loaded: true };
    case "upsert": {
      // 已存在 → 原位替换（不打乱用户排好的顺序）；新项目 → 置顶。
      const exists = state.tasks.some((t) => t.id === a.task.id);
      const tasks = exists
        ? state.tasks.map((t) => (t.id === a.task.id ? a.task : t))
        : [a.task, ...state.tasks];
      return { ...state, tasks, activeId: a.task.id };
    }
    case "remove": {
      const tasks = state.tasks.filter((t) => t.id !== a.id);
      const activeId = state.activeId === a.id ? (tasks[0]?.id ?? null) : state.activeId;
      return { ...state, tasks, activeId };
    }
    case "reorder": {
      // 按传入 id 顺序重排；漏掉的（防御）补到末尾，保证不丢项目。
      const byId = new Map(state.tasks.map((t) => [t.id, t]));
      const tasks: Task[] = [];
      for (const id of a.ids) {
        const t = byId.get(id);
        if (t) {
          tasks.push(t);
          byId.delete(id);
        }
      }
      for (const t of byId.values()) tasks.push(t);
      return { ...state, tasks };
    }
    case "activate":
      return { ...state, activeId: a.id };
    default:
      return state;
  }
}

type Ctx = {
  state: State;
  /** 新建/激活一个项目（按文件夹）。同文件夹已有项目则直接激活 —— 「选文件夹」直觉。 */
  addTask: (dir: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  /** 按给定 id 顺序重排左侧列表，并把顺序落盘。 */
  reorderTasks: (ids: string[]) => void;
  /** 重新从后端拉取任务列表（外部变更后刷新左侧）。 */
  reloadTasks: () => void;
  /** 重命名项目显示名（纯展示，空名/原名忽略）。 */
  renameTask: (id: string, name: string) => Promise<void>;
  activate: (id: string) => void;
};

const WorkbenchCtx = createContext<Ctx | null>(null);

export function WorkbenchProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    tasks: [],
    activeId: null,
    loaded: false,
  });

  const seq = useRef(0);

  // 启动：拉取持久化项目
  useEffect(() => {
    reloadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从后端拉任务列表（启动 + 外部变更后刷新共用同一份逻辑）
  const reloadTasks = useCallback(() => {
    invoke<Task[]>("list_tasks")
      .then((tasks) => dispatch({ type: "load", tasks }))
      .catch(() => dispatch({ type: "load", tasks: [] }));
  }, []);

  const addTask = useCallback(
    async (dir: string) => {
      const proj = normDir(dir);
      const now = Date.now();
      // 同文件夹已有项目则激活不新建 —— 更符合「选文件夹」直觉
      const existing = state.tasks.find((t) => normDir(t.dir) === proj);
      if (existing) {
        dispatch({ type: "activate", id: existing.id });
        return;
      }
      const id = `sess-${taskIdFromDir(dir)}-${++seq.current}`;
      const task: Task = {
        id,
        name: dirBasename(dir),
        dir,
        last_opened_at: now,
        created_at: now,
      };
      try {
        const saved = await invoke<Task>("upsert_task", { task });
        dispatch({ type: "upsert", task: saved });
      } catch {
        dispatch({ type: "upsert", task }); // 落盘失败也先进内存
      }
    },
    [state.tasks],
  );

  const removeTask = useCallback(async (id: string) => {
    dispatch({ type: "remove", id });
    await invoke("remove_task", { id }).catch(() => {});
  }, []);

  // 重排：先动内存让 UI 立刻跟手，再把 id 顺序丢给后端落盘。
  const reorderTasks = useCallback((ids: string[]) => {
    dispatch({ type: "reorder", ids });
    void invoke("reorder_tasks", { ids }).catch(() => {});
  }, []);

  // 重命名：存一个空名字会让左侧列表出现一行点不中的空白，比不给改还糟。
  const renameTask = useCallback(
    async (id: string, name: string) => {
      const next = name.trim();
      if (!next) return;
      const cur = state.tasks.find((x) => x.id === id);
      if (!cur || cur.name === next) return;
      const task = { ...cur, name: next };
      dispatch({ type: "upsert", task });
      // 失败不回滚内存：名字是纯展示，下次重启顶多回到旧名，不值得为它闪一次 UI。
      await invoke("upsert_task", { task }).catch(() => {});
    },
    [state.tasks],
  );

  const activate = useCallback((id: string) => dispatch({ type: "activate", id }), []);

  return (
    <WorkbenchCtx.Provider
      value={{ state, addTask, removeTask, reorderTasks, reloadTasks, renameTask, activate }}
    >
      {children}
    </WorkbenchCtx.Provider>
  );
}

export function useWorkbench(): Ctx {
  const ctx = useContext(WorkbenchCtx);
  if (!ctx) throw new Error("useWorkbench 必须在 WorkbenchProvider 内使用");
  return ctx;
}
