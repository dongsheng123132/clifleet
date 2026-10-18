/** 设置中心。模型档案仅写 OpenCodex 自己的配置；不会改各 CLI 的原配置或 TUI 配色。 */
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Bot, CheckCircle2, Circle, ExternalLink, GitBranch, Info, Monitor, Moon, Palette, Play, Plus, Save, Settings2, Sun, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { askConfirm } from "../lib/confirm";
import { readTheme, setTheme, type Theme } from "../theme";
import {
  CLI_LAUNCH_EVENT, CLI_TOOLS, SETTINGS_UPDATED_EVENT, emptySettings, newProfile, profileFitsCli,
  type AuthKind, type CliDefinition, type CliLaunchRequest, type ConfigStatus,
  type ModelProfile, type ModelSettings,
  type WireApi,
} from "../modelProfiles";
import {
  clampTerminalFontSize, DEFAULT_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE, TERMINAL_FONT_SIZE_EVENT, TERMINAL_FONT_SIZE_KEY,
} from "../opencodex/term/displaySettings";

type Page = "models" | "terminal" | "appearance" | "about";

const GITHUB_REPO = "https://github.com/dongsheng123132/opencodex";

/** 打开外链：优先走系统默认浏览器。shell open 不可用时退回 window.open（开发态兜底）。 */
async function openExternal(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    try {
      window.open(url, "_blank", "noopener");
    } catch {
      /* ignore */
    }
  }
}
type Translate = (key: string, vars?: Record<string, string | number>) => string;

const WIRE_LABELS: Record<WireApi, string> = {
  anthropic_messages: "Anthropic Messages",
  openai_responses: "OpenAI Responses",
  openai_chat_completions: "OpenAI Chat Completions",
  gemini_native: "Gemini Native",
};

function defaultAuthForWire(wire: WireApi): AuthKind {
  return wire === "anthropic_messages" || wire === "gemini_native" ? "api_key" : "bearer";
}

const PRESETS: Array<Pick<ModelProfile, "name" | "wire_api" | "auth_kind" | "base_url" | "model" | "small_model">> = [
  { name: "Anthropic Official", wire_api: "anthropic_messages", auth_kind: "api_key", base_url: "https://api.anthropic.com", model: "claude-sonnet-4-6", small_model: "claude-haiku-4-5-20251001" },
  { name: "DeepSeek Chat", wire_api: "openai_chat_completions", auth_kind: "bearer", base_url: "https://api.deepseek.com", model: "deepseek-chat", small_model: "" },
  { name: "OpenAI Responses", wire_api: "openai_responses", auth_kind: "bearer", base_url: "https://api.openai.com/v1", model: "gpt-5.2-codex", small_model: "" },
  { name: "Kimi (Anthropic)", wire_api: "anthropic_messages", auth_kind: "bearer", base_url: "https://api.moonshot.cn/anthropic", model: "kimi-k2-0905-preview", small_model: "" },
];

export function SettingsDialog({ onToast, onClose, dataDir, portable }: { onToast: (s: string) => void; onClose: () => void; dataDir: string | null; portable: boolean }) {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("models");
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [settings, setSettings] = useState<ModelSettings>(emptySettings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE);
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    invoke<ConfigStatus>("get_config").then((next) => {
      setStatus(next);
      setSettings(next.settings);
      setSelectedId(next.settings.profiles[0]?.id ?? null);
    }).catch((error) => onToast(t("Failed to load settings: {e}", { e: String(error) })));
    invoke<string | null>("kv_get", { key: TERMINAL_FONT_SIZE_KEY }).then((value) => {
      const size = value ? Number(value) : NaN;
      if (Number.isFinite(size)) setTerminalFontSize(clampTerminalFontSize(size));
    }).catch(() => {});
  }, [onToast, t]);

  const selected = useMemo(
    () => settings.profiles.find((profile) => profile.id === selectedId) ?? null,
    [settings.profiles, selectedId],
  );

  const updateTerminalFontSize = (value: number) => {
    const next = clampTerminalFontSize(value);
    setTerminalFontSize(next);
    void invoke("kv_set", { key: TERMINAL_FONT_SIZE_KEY, value: String(next) }).catch(() => {});
    window.dispatchEvent(new CustomEvent<number>(TERMINAL_FONT_SIZE_EVENT, { detail: next }));
  };

  const pickTheme = (next: Theme) => {
    setThemeState(next);
    setTheme(next);
  };

  const addProfile = () => {
    const profile = newProfile();
    setSettings((current) => ({ ...current, profiles: [...current.profiles, profile] }));
    setSelectedId(profile.id);
  };

  const updateProfile = (patch: Partial<ModelProfile>) => {
    if (!selectedId) return;
    setSettings((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => profile.id === selectedId ? { ...profile, ...patch } : profile),
      assignments: patch.wire_api ? Object.fromEntries(Object.entries(current.assignments).filter(([tool, profileId]) => {
        if (profileId !== selectedId) return true;
        const cli = CLI_TOOLS.find((item) => item.id === tool);
        return cli ? cli.wires.includes(patch.wire_api as WireApi) : false;
      })) : current.assignments,
    }));
  };

  const deleteProfile = async () => {
    if (!selectedId) return;
    const usedBy = CLI_TOOLS.filter((cli) => settings.assignments[cli.id] === selectedId).map((cli) => cli.name);
    if (usedBy.length > 0) {
      const accepted = await askConfirm(t("Delete this profile and clear its pairing with: {tools}?", { tools: usedBy.join(", ") }));
      if (!accepted) return;
    }
    const profiles = settings.profiles.filter((profile) => profile.id !== selectedId);
    const assignments = Object.fromEntries(Object.entries(settings.assignments).filter(([, profileId]) => profileId !== selectedId));
    setSettings({ ...settings, profiles, assignments });
    setSelectedId(profiles[0]?.id ?? null);
  };

  const assign = (tool: string, profileId: string) => {
    setSettings((current) => {
      const assignments = { ...current.assignments };
      if (profileId) assignments[tool] = profileId; else delete assignments[tool];
      return { ...current, assignments };
    });
  };

  const persist = async (): Promise<ConfigStatus | null> => {
    setSaving(true);
    try {
      const next = await invoke<ConfigStatus>("set_config", { settings });
      setStatus(next);
      setSettings(next.settings);
      window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
      if (selectedId && !next.settings.profiles.some((profile) => profile.id === selectedId)) setSelectedId(next.settings.profiles[0]?.id ?? null);
      onToast(t("Settings saved"));
      return next;
    } catch (error) {
      onToast(t("Save failed: {e}", { e: String(error) }));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => { if (await persist()) onClose(); };
  const saveAndLaunch = async (cli: CliDefinition) => {
    const saved = await persist();
    if (!saved) return;
    const profileId = saved.settings.assignments[cli.id];
    const profile = saved.settings.profiles.find((item) => item.id === profileId);
    const detail: CliLaunchRequest = { tool: cli.id, name: cli.name, command: cli.command, profileId, profileName: profile?.name };
    window.dispatchEvent(new CustomEvent<CliLaunchRequest>(CLI_LAUNCH_EVENT, { detail }));
    onClose();
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose}>
    <div className="w-[920px] max-w-[95vw] h-[680px] max-h-[90vh] overflow-hidden rounded-card border border-overlay/[0.10] bg-bg-2 shadow-pop flex flex-col" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between px-5 py-4 border-b border-overlay/[0.07]">
        <div className="flex items-center gap-2"><Settings2 size={17} className="text-accent" /><h2 className="text-[15px] font-semibold text-ink-0">{t("AI Setup Center")}</h2></div>
        <button onClick={onClose} className="text-ink-4 hover:text-ink-1" aria-label={t("Cancel")}><X size={18} /></button>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-[176px] shrink-0 border-r border-overlay/[0.07] bg-overlay/[0.018] p-3 space-y-1">
          <NavButton active={page === "models"} icon={<Bot size={15} />} onClick={() => setPage("models")}>{t("Models & CLI pairing")}</NavButton>
          <NavButton active={page === "terminal"} icon={<Monitor size={15} />} onClick={() => setPage("terminal")}>{t("Terminal display")}</NavButton>
          <NavButton active={page === "appearance"} icon={<Palette size={15} />} onClick={() => setPage("appearance")}>{t("Appearance")}</NavButton>
          <NavButton active={page === "about"} icon={<Info size={15} />} onClick={() => setPage("about")}>{t("About")}</NavButton>
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto p-5">
          {page === "models" && <ModelsPage t={t} status={status} settings={settings} selected={selected} selectedId={selectedId} onSelect={setSelectedId} onAdd={addProfile} onUpdate={updateProfile} onDelete={deleteProfile} onAssign={assign} onLaunch={saveAndLaunch} saving={saving} />}
          {page === "terminal" && <TerminalPage t={t} size={terminalFontSize} onChange={updateTerminalFontSize} />}
          {page === "appearance" && <AppearancePage t={t} theme={theme} onTheme={pickTheme} />}
          {page === "about" && <AboutPage t={t} portable={portable} dataDir={dataDir} />}
        </main>
      </div>

      <footer className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-overlay/[0.07]">
        <div className="text-[10.5px] text-ink-5">{t("Unassigned CLIs keep their own settings")}</div>
        <div className="flex items-center gap-2"><button onClick={onClose} className="px-3.5 h-9 rounded-lg border border-overlay/[0.10] text-ink-2 text-[13px] hover:bg-overlay/[0.04]">{t("Cancel")}</button><button onClick={saveAndClose} disabled={saving} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent-600 disabled:opacity-60"><Save size={14} />{saving ? t("Saving…") : t("Save")}</button></div>
      </footer>
    </div>
  </div>;
}

function ModelsPage({ t, status, settings, selected, selectedId, onSelect, onAdd, onUpdate, onDelete, onAssign, onLaunch, saving }: { t: Translate; status: ConfigStatus | null; settings: ModelSettings; selected: ModelProfile | null; selectedId: string | null; onSelect: (id: string) => void; onAdd: () => void; onUpdate: (patch: Partial<ModelProfile>) => void; onDelete: () => void | Promise<void>; onAssign: (tool: string, profileId: string) => void; onLaunch: (cli: CliDefinition) => void; saving: boolean }) {
  return <div className="space-y-5">
    {status?.config_error && <section className="rounded-lg border border-danger-400/25 bg-danger-400/[0.05] px-3.5 py-3"><div className="text-[12px] font-medium text-danger-400">{t("The existing model configuration is damaged")}</div><p className="mt-1 text-[10.5px] text-ink-4 break-all">{status.config_error}</p><p className="mt-1 text-[10.5px] text-ink-5">{t("Saving a new valid configuration will repair it. Profile launches stay blocked until then.")}</p></section>}
    <section className="rounded-lg border border-accent/20 bg-accent/[0.045] px-3.5 py-3"><div className="flex items-center gap-2 text-[12px] font-medium text-ink-1"><Info size={14} className="text-accent shrink-0" />{t("Safe per-CLI model pairing")}</div><p className="mt-1 text-[11px] leading-relaxed text-ink-4">{t("Profiles live only in OpenCodex. A pairing is injected temporarily when OpenCodex launches that CLI; the CLI's own config and TUI appearance are never rewritten.")}</p></section>

    <section>
      <div className="flex items-center justify-between mb-2"><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("Model profiles")}</div><button onClick={onAdd} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-overlay/[0.10] text-[11px] text-ink-2 hover:bg-overlay/[0.04]"><Plus size={13} />{t("Add profile")}</button></div>
      {settings.profiles.length === 0 ? <button onClick={onAdd} className="w-full h-24 rounded-lg border border-dashed border-overlay/[0.15] text-[12px] text-ink-4 hover:border-accent/40 hover:text-ink-2"><Plus size={16} className="inline mr-1.5" />{t("Create your first model profile")}</button> : <div className="grid grid-cols-[180px_minmax(0,1fr)] rounded-lg border border-overlay/[0.08] overflow-hidden min-h-[275px]">
        <div className="border-r border-overlay/[0.07] bg-overlay/[0.018] p-2 space-y-1">{settings.profiles.map((profile) => <button key={profile.id} onClick={() => onSelect(profile.id)} className={`w-full text-left px-2.5 py-2 rounded-md ${selectedId === profile.id ? "bg-accent/10 text-ink-0" : "text-ink-3 hover:bg-overlay/[0.04]"}`}><div className="text-[12px] font-medium truncate">{profile.name}</div><div className="text-[10px] text-ink-5 mt-0.5">{WIRE_LABELS[profile.wire_api]}</div></button>)}</div>
        {selected && <div className="p-4 space-y-3">
          <div className="flex items-start gap-3"><Field label={t("Profile name")} className="flex-1"><input className="input" value={selected.name} onChange={(event) => onUpdate({ name: event.target.value })} /></Field><button onClick={onDelete} className="mt-[21px] w-8 h-8 inline-flex items-center justify-center rounded-md border border-overlay/[0.10] text-ink-4 hover:text-danger-400 hover:bg-danger-400/5" title={t("Delete profile")}><Trash2 size={14} /></button></div>
          <div className="grid grid-cols-2 gap-3"><Field label={t("Wire protocol")}><select className="input" value={selected.wire_api} onChange={(event) => { const wire = event.target.value as WireApi; onUpdate({ wire_api: wire, auth_kind: defaultAuthForWire(wire) }); }}>{Object.entries(WIRE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label={t("Authentication")}><select className="input" value={selected.auth_kind} onChange={(event) => onUpdate({ auth_kind: event.target.value as AuthKind })}>{(selected.wire_api === "anthropic_messages" || selected.wire_api === "gemini_native") && <option value="api_key">x-api-key</option>}{selected.wire_api !== "gemini_native" && <option value="bearer">Bearer token</option>}{selected.wire_api === "openai_responses" && <option value="none">{t("No authentication")}</option>}</select></Field></div>
          <Field label={t("Main model")}><input className="input" value={selected.model} onChange={(event) => onUpdate({ model: event.target.value })} placeholder="provider/model" /></Field>
          <Field label={t("Base URL")}><input className="input" value={selected.base_url} onChange={(event) => onUpdate({ base_url: event.target.value })} placeholder="https://api.example.com" /></Field>
          <div className="grid grid-cols-2 gap-3">{selected.auth_kind !== "none" && <Field label={t("API Key")} hint={t("Stored locally only")}><input className="input font-mono" type="password" autoComplete="off" value={selected.api_key} onChange={(event) => onUpdate({ api_key: event.target.value })} placeholder="sk-…" /></Field>}<Field label={t("Small / fast model")} hint={t("Optional")}><input className="input" value={selected.small_model} onChange={(event) => onUpdate({ small_model: event.target.value })} /></Field></div>
          <div className="flex flex-wrap gap-1.5 pt-1">{PRESETS.map((preset) => <button key={preset.name} onClick={() => onUpdate(preset)} className="h-6 px-2 rounded border border-overlay/[0.09] text-[10.5px] text-ink-4 hover:text-ink-1 hover:bg-overlay/[0.04]">{preset.name}</button>)}</div>
        </div>}
      </div>}
    </section>

    <section><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2">{t("Pair models with CLI tools")}</div><div className="rounded-lg border border-overlay/[0.08] divide-y divide-overlay/[0.07]">
      {CLI_TOOLS.map((cli) => {
        const installed = status?.[cli.installedField] ?? false;
        const candidates = settings.profiles.filter((profile) => profileFitsCli(profile, cli));
        const assignment = settings.assignments[cli.id] ?? "";
        const profileSupportReady = cli.wires.length > 0;
        return <div key={cli.id} className="grid grid-cols-[150px_minmax(180px,1fr)_auto] gap-3 items-center px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">{installed ? <CheckCircle2 size={14} className="text-success-400 shrink-0" /> : <Circle size={14} className="text-ink-5 shrink-0" />}<div className="min-w-0"><div className="text-[12px] text-ink-1 truncate">{cli.name}</div><div className="text-[10px] text-ink-5">{installed ? t("Detected") : t("Not installed")}</div></div></div>
          <div><select className="input h-8 text-[11px]" value={assignment} onChange={(event) => onAssign(cli.id, event.target.value)}><option value="">{t("Use CLI's own settings")}</option>{candidates.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {WIRE_LABELS[profile.wire_api]}</option>)}</select>{!profileSupportReady && <div className="mt-1 text-[9.5px] text-ink-5">{t("Profile launch is not yet safely supported for this CLI")}</div>}</div>
          <button onClick={() => onLaunch(cli)} disabled={!installed || saving} className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-overlay/[0.10] text-[11px] text-ink-2 hover:bg-overlay/[0.04] disabled:opacity-35"><Play size={12} />{t("Save & launch")}</button>
        </div>;
      })}
    </div></section>
  </div>;
}

function TerminalPage({ t, size, onChange }: { t: Translate; size: number; onChange: (size: number) => void }) {
  return <section className="max-w-xl space-y-5"><div><h3 className="text-[14px] font-semibold text-ink-0">{t("Terminal display")}</h3><p className="mt-1 text-[11px] leading-relaxed text-ink-4">{t("OpenCodex changes only the terminal font size. Each CLI keeps its own TUI colors and appearance.")}</p></div><div className="rounded-lg border border-overlay/[0.08] p-4"><div className="text-[12px] font-medium text-ink-2 mb-3">{t("Terminal font size")}</div><div className="flex items-center gap-2"><button onClick={() => onChange(size - 1)} disabled={size <= MIN_TERMINAL_FONT_SIZE} className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-overlay/[0.10] text-ink-2 text-[17px] hover:bg-overlay/[0.04] disabled:opacity-40">−</button><output className="min-w-20 h-9 px-3 inline-flex items-center justify-center rounded-md bg-overlay/[0.05] text-[13px] font-medium tabular-nums text-ink-1">{size}px</output><button onClick={() => onChange(size + 1)} disabled={size >= MAX_TERMINAL_FONT_SIZE} className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-overlay/[0.10] text-ink-2 text-[17px] hover:bg-overlay/[0.04] disabled:opacity-40">+</button><button onClick={() => onChange(DEFAULT_TERMINAL_FONT_SIZE)} disabled={size === DEFAULT_TERMINAL_FONT_SIZE} className="ml-1 h-9 px-3 rounded-md border border-overlay/[0.10] text-[12px] text-ink-3 hover:bg-overlay/[0.04] disabled:opacity-40">{t("Reset")}</button></div></div></section>;
}

function AppearancePage({ t, theme, onTheme }: { t: Translate; theme: Theme; onTheme: (theme: Theme) => void }) {
  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: t("Follow system"), icon: <Monitor size={15} /> },
    { value: "light", label: t("Light"), icon: <Sun size={15} /> },
    { value: "dark", label: t("Dark"), icon: <Moon size={15} /> },
  ];
  return <section className="max-w-xl space-y-5"><div><h3 className="text-[14px] font-semibold text-ink-0">{t("Appearance")}</h3><p className="mt-1 text-[11px] leading-relaxed text-ink-4">{t("The workspace follows this theme. Terminals keep their native ANSI colors regardless.")}</p></div><div className="flex items-center gap-2">{options.map((opt) => <button key={opt.value} onClick={() => onTheme(opt.value)} className={"inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border text-[12px] transition-colors " + (theme === opt.value ? "border-accent/60 bg-accent/10 text-accent font-medium" : "border-overlay/[0.10] text-ink-2 hover:bg-overlay/[0.04]")}>{opt.icon}{opt.label}</button>)}</div></section>;
}

function AboutPage({ t, portable, dataDir }: { t: Translate; portable: boolean; dataDir: string | null }) {
  const link = (label: string, url: string) => (
    <button onClick={() => void openExternal(url)} className="inline-flex items-center gap-1 text-accent-400 hover:text-accent hover:underline">
      {label}<ExternalLink size={11} />
    </button>
  );
  return <section className="max-w-xl space-y-4">
    <div><h3 className="text-[14px] font-semibold text-ink-0">{t("About")}</h3><p className="mt-1 text-[12px] text-ink-3">OpenCodex v{__APP_VERSION__}{portable ? ` · ${t("Portable data")}` : ""}</p></div>
    <div className="rounded-lg border border-overlay/[0.08] p-4 space-y-2">
      <div className="flex items-center gap-2 text-[12px] text-ink-2"><GitBranch size={14} className="text-ink-4" />{link(t("OpenCodex on GitHub"), GITHUB_REPO)}</div>
      <div className="flex items-center gap-2 text-[12px] text-ink-2">{link(t("Report an issue"), `${GITHUB_REPO}/issues/new`)}</div>
      <div className="flex items-center gap-2 text-[12px] text-ink-2">{link(t("Open a pull request"), `${GITHUB_REPO}/pulls`)}</div>
    </div>
    {dataDir && <div className="rounded-lg border border-overlay/[0.08] p-4"><div className="text-[11px] font-medium text-ink-3 mb-1">{t("Data folder")}</div><div className="text-[11px] text-ink-4 font-mono break-all">{dataDir}</div></div>}
  </section>;
}

function NavButton({ active, icon, onClick, children }: { active: boolean; icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`w-full flex items-center gap-2 px-3 h-9 rounded-md text-[12px] ${active ? "bg-accent/10 text-accent font-medium" : "text-ink-3 hover:bg-overlay/[0.04] hover:text-ink-1"}`}>{icon}{children}</button>;
}

function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return <label className={`block ${className}`}><span className="flex items-baseline gap-2 mb-1"><span className="text-[11px] font-medium text-ink-3">{label}</span>{hint && <span className="text-[9.5px] text-ink-5">{hint}</span>}</span>{children}</label>;
}
