/**
 * CliFleet —— 极简的基于文件夹的 CLI 终端工作台。
 *
 * 整屏只装一个工作台：左项目列表 + 右项目终端区。顶栏只有品牌 + 语言切换。
 * 没有模型配置 / Key / 端点 —— 那些都归 claude、codex 等 CLI 自己管。
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Languages, Sparkles } from "lucide-react";
import { CliFleet } from "./clifleet/CliFleet";
import { useI18n } from "./i18n";

type AppEnv = {
  platform: string;
  home_dir: string;
  opened_dir: string | null;
};

export function App() {
  const [env, setEnv] = useState<AppEnv | null>(null);

  useEffect(() => {
    invoke<AppEnv>("get_env").then(setEnv).catch(() => setEnv(null));
  }, []);

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <main className="flex-1 min-w-0 min-h-0 p-3">
        <CliFleet openedDir={env?.opened_dir ?? null} />
      </main>
    </div>
  );
}

/* ---------------- 自定义标题栏 ---------------- */

function TitleBar() {
  const { lang, setLang } = useI18n();
  const toggleLang = useCallback(() => setLang(lang === "zh" ? "en" : "zh"), [lang, setLang]);
  return (
    <header
      data-tauri-drag-region
      className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-white/[0.06] bg-bg-0"
    >
      <div className="flex items-center gap-2 pointer-events-none select-none">
        <span className="grid place-items-center w-5 h-5 rounded bg-accent text-white">
          <Sparkles size={12} />
        </span>
        <span className="text-[12px] font-semibold text-ink-1 tracking-wide">CliFleet</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={toggleLang}
          title="Switch language / 切换语言"
          className="pointer-events-auto inline-flex items-center gap-1 px-2 h-6 rounded text-ink-3 text-[11px] hover:bg-white/[0.04] hover:text-ink-1 transition-colors"
        >
          <Languages size={12} />
          {lang === "zh" ? "EN" : "中文"}
        </button>
      </div>
    </header>
  );
}
