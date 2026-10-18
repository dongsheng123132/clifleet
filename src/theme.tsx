import { useEffect, type ReactNode } from "react";

/** 主题三态：跟随系统 / 浅色 / 深色。只影响工作台配色；终端没有 theme 覆盖，CLI/TUI 保有原生 ANSI 配色。 */
export type Theme = "system" | "light" | "dark";

const THEME_KEY = "opencodex.theme";

/** 读持久化的主题选择；没有则跟随系统。 */
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "system" || saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage 不可用时静默回退 */
  }
  return "system";
}

/** 把主题落到 DOM（data-theme + .dark + color-scheme）。system 态按系统偏好解析成 light/dark。 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  let prefersDark = false;
  try {
    prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    /* ignore */
  }
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.dataset.theme = dark ? "dark" : "light";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/** 选择并持久化主题（设置中心「外观」页用）。 */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme(readTheme());
    // 跟随系统时，系统配色变化要实时生效（浅/深/跟随三态才名副其实）。
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (readTheme() === "system") applyTheme("system");
      };
      mq.addEventListener("change", onChange);
      return () => mq?.removeEventListener("change", onChange);
    } catch {
      /* 旧内核无 addEventListener 时放弃实时跟随 */
      return undefined;
    }
  }, []);
  return <>{children}</>;
}
