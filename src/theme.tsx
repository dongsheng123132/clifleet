import { useEffect, type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // 固定浅色工作台；终端没有 theme 覆盖，CLI/TUI 保有原生 ANSI 配色。
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }, []);
  return <>{children}</>;
}
