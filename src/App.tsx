/**
 * CliFleet —— 极简的基于文件夹的 CLI 终端工作台。
 *
 * 整屏只装一个工作台：左项目列表 + 右项目终端区。顶栏只有品牌 + 语言切换。
 * 没有模型配置 / Key / 端点 —— 那些都归 claude、codex 等 CLI 自己管。
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitPullRequest, Languages, Sparkles } from "lucide-react";
import { CliFleet } from "./clifleet/CliFleet";
import { useI18n } from "./i18n";

/** 仓库地址 —— 顶栏 PR 入口用；改仓库名只改这一处。 */
const REPO_URL = "https://github.com/dongsheng123132/clifleet";
const PR_URL = `${REPO_URL}/pulls`;

type AppEnv = {
  platform: string;
  home_dir: string;
  opened_dir: string | null;
};

/** 内置 GitHub 标（lucide 已移除品牌图标，这里用官方 mark 的 path 自绘）。 */
function GithubMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

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
  const { lang, setLang, t } = useI18n();
  const toggleLang = useCallback(() => setLang(lang === "zh" ? "en" : "zh"), [lang, setLang]);
  const openRepo = useCallback(() => {
    invoke("open_url", { url: REPO_URL }).catch(() => {});
  }, []);
  const openPr = useCallback(() => {
    invoke("open_url", { url: PR_URL }).catch(() => {});
  }, []);
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
          onClick={openRepo}
          title={t("Open the GitHub repository")}
          className="pointer-events-auto inline-flex items-center gap-1 px-2 h-6 rounded text-ink-3 text-[11px] hover:bg-white/[0.04] hover:text-ink-1 transition-colors"
        >
          <GithubMark size={12} />
          GitHub
        </button>
        <button
          onClick={openPr}
          title={t("Open the pull request page on GitHub")}
          className="pointer-events-auto inline-flex items-center gap-1 px-2 h-6 rounded text-ink-3 text-[11px] hover:bg-white/[0.04] hover:text-ink-1 transition-colors"
        >
          <GitPullRequest size={12} />
          PR
        </button>
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
