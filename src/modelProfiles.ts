export type WireApi = "anthropic_messages" | "openai_responses" | "openai_chat_completions" | "gemini_native";
export type AuthKind = "api_key" | "bearer" | "none";

export type ModelProfile = {
  id: string;
  name: string;
  wire_api: WireApi;
  auth_kind: AuthKind;
  base_url: string;
  api_key: string;
  model: string;
  small_model: string;
};

export type ModelSettings = {
  version: number;
  profiles: ModelProfile[];
  assignments: Record<string, string>;
};

export type ConfigStatus = {
  settings: ModelSettings;
  config_error: string | null;
  claude_installed: boolean;
  codex_installed: boolean;
  hermes_installed: boolean;
  gemini_installed: boolean;
  opencode_installed: boolean;
  aider_installed: boolean;
};

export type CliDefinition = {
  id: string;
  name: string;
  command: string;
  installedField: keyof Omit<ConfigStatus, "settings">;
  wires: WireApi[];
};

export const CLI_TOOLS: CliDefinition[] = [
  { id: "claude", name: "Claude Code", command: "claude", installedField: "claude_installed", wires: ["anthropic_messages"] },
  { id: "codex", name: "Codex", command: "codex", installedField: "codex_installed", wires: ["openai_responses"] },
  { id: "hermes", name: "Hermes", command: "hermes", installedField: "hermes_installed", wires: [] },
  { id: "gemini", name: "Gemini CLI", command: "gemini", installedField: "gemini_installed", wires: [] },
  { id: "opencode", name: "OpenCode", command: "opencode", installedField: "opencode_installed", wires: [] },
  { id: "aider", name: "Aider", command: "aider", installedField: "aider_installed", wires: ["openai_chat_completions"] },
];

export const CLI_LAUNCH_EVENT = "opencodex:launch-cli";
export const SETTINGS_UPDATED_EVENT = "opencodex:model-settings-updated";

export type CliLaunchRequest = {
  tool: string;
  name: string;
  command: string;
  profileId?: string;
  profileName?: string;
};

export function profileFitsCli(profile: ModelProfile, cli: CliDefinition): boolean {
  return cli.wires.includes(profile.wire_api);
}

export function emptySettings(): ModelSettings {
  return { version: 3, profiles: [], assignments: {} };
}

export function newProfile(): ModelProfile {
  return {
    id: `profile-${Date.now().toString(36)}`,
    name: "New model",
    wire_api: "anthropic_messages",
    auth_kind: "api_key",
    base_url: "",
    api_key: "",
    model: "",
    small_model: "",
  };
}
