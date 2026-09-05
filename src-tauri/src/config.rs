//! 模型档案与 CLI 搭配。
//!
//! 只写 OpenCodex 自己的 config.json。显式档案启动由后端直接构造程序、argv 和 env；
//! 档案缺失/协议不兼容时拒绝启动，绝不静默退回 CLI 的个人配置。

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::tool_installed;

const SETTINGS_VERSION: u32 = 3;
const SUPPORTED_TOOLS: &[&str] = &["claude", "codex", "hermes", "gemini", "opencode", "aider"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelProfile {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// anthropic_messages | openai_responses | openai_chat_completions | gemini_native
    #[serde(default = "default_wire_api")]
    pub wire_api: String,
    /// api_key | bearer | none
    #[serde(default = "default_auth_kind")]
    pub auth_kind: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub small_model: String,
}

fn default_wire_api() -> String {
    "anthropic_messages".into()
}
fn default_auth_kind() -> String {
    "api_key".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSettings {
    #[serde(default = "default_settings_version")]
    pub version: u32,
    #[serde(default)]
    pub profiles: Vec<ModelProfile>,
    /// CLI id -> profile id。缺失表示明确沿用该 CLI 自己的配置。
    #[serde(default)]
    pub assignments: BTreeMap<String, String>,
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            profiles: Vec::new(),
            assignments: BTreeMap::new(),
        }
    }
}
fn default_settings_version() -> u32 {
    SETTINGS_VERSION
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LegacyModelConfig {
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    small_model: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigStatus {
    pub settings: ModelSettings,
    pub config_error: Option<String>,
    pub claude_installed: bool,
    pub codex_installed: bool,
    pub hermes_installed: bool,
    pub gemini_installed: bool,
    pub opencode_installed: bool,
    pub aider_installed: bool,
}

/// 密钥永远只在 env 中，不进入 argv、tasks.json、kv 或错误文本。
pub struct ProfileLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

fn config_path() -> PathBuf {
    crate::paths::app_home().join("config.json")
}

fn migrate_legacy(raw: &str) -> Result<ModelSettings, String> {
    let legacy = serde_json::from_str::<LegacyModelConfig>(raw)
        .map_err(|error| format!("旧版 config.json 无法解析: {error}"))?;
    let has_values = !legacy.base_url.trim().is_empty()
        || !legacy.api_key.trim().is_empty()
        || !legacy.model.trim().is_empty()
        || !legacy.small_model.trim().is_empty();
    if !has_values {
        return Ok(ModelSettings::default());
    }
    let id = "legacy-default".to_string();
    let profile = ModelProfile {
        id: id.clone(),
        name: "Default model".into(),
        wire_api: default_wire_api(),
        auth_kind: default_auth_kind(),
        base_url: legacy.base_url,
        api_key: legacy.api_key,
        model: legacy.model,
        small_model: legacy.small_model,
    };
    let mut assignments = BTreeMap::new();
    assignments.insert("claude".into(), id);
    Ok(ModelSettings {
        version: SETTINGS_VERSION,
        profiles: vec![profile],
        assignments,
    })
}

fn read_settings() -> Result<ModelSettings, String> {
    let raw = match std::fs::read_to_string(config_path()) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ModelSettings::default())
        }
        Err(error) => return Err(format!("读取 config.json 失败: {error}")),
    };
    let json = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| format!("config.json 已损坏: {error}"))?;
    let is_profiles = json
        .as_object()
        .map(|object| object.contains_key("profiles"))
        .unwrap_or(false);
    if !is_profiles {
        return migrate_legacy(&raw);
    }
    let mut settings = serde_json::from_str::<ModelSettings>(&raw)
        .map_err(|error| format!("模型档案无法解析: {error}"))?;
    settings.version = SETTINGS_VERSION;
    Ok(settings)
}

fn mask_key(key: &str) -> String {
    let n = key.chars().count();
    if n <= 8 {
        if key.is_empty() {
            String::new()
        } else {
            "•".repeat(n)
        }
    } else {
        let head: String = key.chars().take(4).collect();
        let tail: String = key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{head}…{tail}")
    }
}
fn is_masked_key(key: &str) -> bool {
    !key.is_empty() && (key.contains('…') || key.chars().all(|c| c == '•'))
}
fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}
fn safe_model(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && !value.contains("..")
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_=./:".contains(c))
}
fn safe_url(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 2048
        && (value.starts_with("https://") || value.starts_with("http://"))
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~:/[]@+;,=".contains(c))
}
fn valid_wire(value: &str) -> bool {
    matches!(
        value,
        "anthropic_messages" | "openai_responses" | "openai_chat_completions" | "gemini_native"
    )
}
fn valid_auth(value: &str) -> bool {
    matches!(value, "api_key" | "bearer" | "none")
}

fn wire_supports_auth(wire_api: &str, auth_kind: &str) -> bool {
    matches!(
        (wire_api, auth_kind),
        ("anthropic_messages", "api_key" | "bearer")
            | ("openai_responses", "bearer" | "none")
            | ("openai_chat_completions", "bearer")
            | ("gemini_native", "api_key")
    )
}

/// 0.4.3 只开放已经能确定性构造启动参数的组合。
pub fn cli_supports_wire(tool: &str, wire_api: &str) -> bool {
    matches!(
        (tool, wire_api),
        ("claude", "anthropic_messages")
            | ("codex", "openai_responses")
            | ("aider", "openai_chat_completions")
    )
}

fn validate_settings(settings: &ModelSettings) -> Result<(), String> {
    if settings.profiles.len() > 50 {
        return Err("模型档案最多 50 个".into());
    }
    let mut ids = HashSet::new();
    for profile in &settings.profiles {
        if !safe_id(profile.id.trim()) {
            return Err("模型档案 ID 不合法".into());
        }
        if !ids.insert(profile.id.trim()) {
            return Err("模型档案 ID 不能重复".into());
        }
        if profile.name.trim().is_empty() || profile.name.chars().count() > 80 {
            return Err("模型档案名称不能为空且不能超过 80 字符".into());
        }
        if !valid_wire(profile.wire_api.trim()) {
            return Err("模型档案的线协议不受支持".into());
        }
        if !valid_auth(profile.auth_kind.trim()) {
            return Err("认证方式不受支持".into());
        }
        if !wire_supports_auth(&profile.wire_api, &profile.auth_kind) {
            return Err("该线协议不支持所选认证方式".into());
        }
        let url = profile.base_url.trim();
        if !safe_url(url) {
            return Err("Base URL 无效，或包含空白、引号等不安全字符".into());
        }
        if !safe_model(profile.model.trim()) {
            return Err("主模型名为空或包含不安全字符".into());
        }
        if !profile.small_model.trim().is_empty() && !safe_model(profile.small_model.trim()) {
            return Err("小模型名包含不安全字符".into());
        }
        if profile.auth_kind != "none" && profile.api_key.trim().is_empty() {
            return Err("该认证方式需要 API Key".into());
        }
        if profile.api_key.len() > 4096
            || profile.api_key.contains('\0')
            || profile.api_key.contains('\r')
            || profile.api_key.contains('\n')
        {
            return Err("API Key 过长或包含换行等无效字符".into());
        }
    }
    for (tool, profile_id) in &settings.assignments {
        if !SUPPORTED_TOOLS.contains(&tool.as_str()) {
            return Err(format!("不支持的 CLI：{tool}"));
        }
        let Some(profile) = settings
            .profiles
            .iter()
            .find(|profile| profile.id == *profile_id)
        else {
            return Err(format!("CLI {tool} 引用了不存在的模型档案"));
        };
        if !cli_supports_wire(tool, &profile.wire_api) {
            return Err(format!("CLI {tool} 暂不支持 {} 协议档案", profile.wire_api));
        }
    }
    Ok(())
}

fn write_settings(settings: &ModelSettings) -> Result<(), String> {
    let dir = crate::paths::app_home();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let target = config_path();
    let temp = dir.join("config.json.tmp");
    let backup = dir.join("config.json.bak");
    let body =
        serde_json::to_string_pretty(settings).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(&temp, body).map_err(|e| format!("写入临时配置失败: {e}"))?;
    if target.exists() {
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(&target, &backup).map_err(|e| format!("备份旧配置失败: {e}"))?;
    }
    if let Err(error) = std::fs::rename(&temp, &target) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, &target);
        }
        return Err(format!("替换 config.json 失败: {error}"));
    }
    Ok(())
}

fn push_env(env: &mut Vec<(String, String)>, key: &str, value: impl Into<String>) {
    env.push((key.into(), value.into()));
}

pub fn profile_launch(tool: &str, profile_id: &str) -> Result<ProfileLaunch, String> {
    let settings =
        read_settings().map_err(|error| format!("{error}；已阻止启动，未改用 CLI 自身账号"))?;
    let profile = settings
        .profiles
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "模型档案不存在；已阻止启动，未改用 CLI 自身账号".to_string())?;
    launch_for_profile(tool, profile)
}

fn launch_for_profile(tool: &str, profile: ModelProfile) -> Result<ProfileLaunch, String> {
    if !cli_supports_wire(tool, &profile.wire_api) {
        return Err(format!(
            "{tool} 暂不支持该档案的 {} 协议；已阻止启动",
            profile.wire_api
        ));
    }
    if !safe_model(profile.model.trim()) {
        return Err("模型名无效；已阻止启动".into());
    }
    if !safe_url(profile.base_url.trim()) {
        return Err("Base URL 无效；已阻止启动".into());
    }
    if profile.auth_kind != "none" && profile.api_key.trim().is_empty() {
        return Err("档案缺少 API Key；已阻止启动".into());
    }
    if !wire_supports_auth(&profile.wire_api, &profile.auth_kind) {
        return Err("线协议与认证方式不兼容；已阻止启动".into());
    }

    let mut env = Vec::new();
    let mut args = Vec::new();
    let model = profile.model.trim().to_string();
    match tool {
        "claude" => {
            for key in [
                "CLAUDE_CODE_USE_BEDROCK",
                "CLAUDE_CODE_USE_VERTEX",
                "CLAUDE_CODE_USE_FOUNDRY",
            ] {
                push_env(&mut env, key, "");
            }
            push_env(&mut env, "ANTHROPIC_BASE_URL", profile.base_url.trim());
            match profile.auth_kind.as_str() {
                "api_key" => {
                    push_env(&mut env, "ANTHROPIC_API_KEY", profile.api_key);
                    push_env(&mut env, "ANTHROPIC_AUTH_TOKEN", "");
                }
                "bearer" => {
                    push_env(&mut env, "ANTHROPIC_API_KEY", "");
                    push_env(&mut env, "ANTHROPIC_AUTH_TOKEN", profile.api_key);
                }
                "none" => {
                    push_env(&mut env, "ANTHROPIC_API_KEY", "");
                    push_env(&mut env, "ANTHROPIC_AUTH_TOKEN", "");
                }
                _ => return Err("Claude 认证方式不受支持".into()),
            }
            push_env(&mut env, "ANTHROPIC_MODEL", &model);
            push_env(
                &mut env,
                "ANTHROPIC_SMALL_FAST_MODEL",
                profile.small_model.trim(),
            );
            args.extend(["--model".into(), model]);
        }
        "codex" => {
            use std::sync::atomic::{AtomicU64, Ordering};
            static PROVIDER_SEQ: AtomicU64 = AtomicU64::new(0);
            let provider = format!(
                "opencodex_{}_{}",
                std::process::id(),
                PROVIDER_SEQ.fetch_add(1, Ordering::Relaxed)
            );
            push_env(&mut env, "OPENAI_API_KEY", "");
            if profile.auth_kind != "none" {
                push_env(&mut env, "OPENCODEX_PROFILE_API_KEY", profile.api_key);
            }
            args.extend([
                "-c".into(),
                format!("model_providers.{provider}.name='OpenCodexProfile'"),
                "-c".into(),
                format!(
                    "model_providers.{provider}.base_url='{}'",
                    profile.base_url.trim()
                ),
                "-c".into(),
                format!("model_providers.{provider}.wire_api='responses'"),
                "-c".into(),
                format!("model_providers.{provider}.requires_openai_auth=false"),
            ]);
            if profile.auth_kind != "none" {
                args.extend([
                    "-c".into(),
                    format!("model_providers.{provider}.env_key='OPENCODEX_PROFILE_API_KEY'"),
                ]);
            }
            args.extend([
                "-c".into(),
                format!("model_provider='{provider}'"),
                "--model".into(),
                model,
            ]);
        }
        "aider" => {
            push_env(&mut env, "OPENAI_API_KEY", "");
            let aider_model = if model.starts_with("openai/") {
                model
            } else {
                format!("openai/{model}")
            };
            push_env(&mut env, "AIDER_OPENAI_API_BASE", profile.base_url.trim());
            if profile.auth_kind != "none" {
                push_env(&mut env, "AIDER_OPENAI_API_KEY", profile.api_key);
            } else {
                push_env(&mut env, "AIDER_OPENAI_API_KEY", "");
            }
            push_env(&mut env, "AIDER_MODEL", &aider_model);
            if !profile.small_model.trim().is_empty() {
                let weak = if profile.small_model.starts_with("openai/") {
                    profile.small_model
                } else {
                    format!("openai/{}", profile.small_model.trim())
                };
                push_env(&mut env, "AIDER_WEAK_MODEL", weak);
            }
            args.extend(["--model".into(), aider_model]);
        }
        _ => {
            return Err(format!(
                "{tool} 暂不支持确定性的模型档案启动；请选择沿用自身配置"
            ))
        }
    }
    Ok(ProfileLaunch {
        program: tool.into(),
        args,
        env,
    })
}

#[tauri::command]
pub fn get_config() -> ConfigStatus {
    let (mut settings, config_error) = match read_settings() {
        Ok(settings) => (settings, None),
        Err(error) => (ModelSettings::default(), Some(error)),
    };
    for profile in &mut settings.profiles {
        profile.api_key = mask_key(&profile.api_key);
    }
    ConfigStatus {
        settings,
        config_error,
        claude_installed: tool_installed("claude"),
        codex_installed: tool_installed("codex"),
        hermes_installed: tool_installed("hermes"),
        gemini_installed: tool_installed("gemini"),
        opencode_installed: tool_installed("opencode"),
        aider_installed: tool_installed("aider"),
    }
}

#[tauri::command]
pub fn set_config(mut settings: ModelSettings) -> Result<ConfigStatus, String> {
    let old = read_settings().unwrap_or_default();
    settings.version = SETTINGS_VERSION;
    for profile in &mut settings.profiles {
        profile.id = profile.id.trim().to_string();
        profile.name = profile.name.trim().to_string();
        profile.wire_api = profile.wire_api.trim().to_lowercase();
        profile.auth_kind = profile.auth_kind.trim().to_lowercase();
        profile.base_url = profile.base_url.trim().trim_end_matches('/').to_string();
        profile.model = profile.model.trim().to_string();
        profile.small_model = profile.small_model.trim().to_string();
        if is_masked_key(&profile.api_key) {
            profile.api_key = old
                .profiles
                .iter()
                .find(|old_profile| old_profile.id == profile.id)
                .map(|old_profile| old_profile.api_key.clone())
                .unwrap_or_default();
        } else {
            profile.api_key = profile.api_key.trim().to_string();
        }
    }
    validate_settings(&settings)?;
    write_settings(&settings)?;
    Ok(get_config())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_config_only_to_claude() {
        let settings = migrate_legacy(
            r#"{"base_url":"https://example.test","api_key":"secret","model":"m1","small_model":"m0"}"#,
        ).expect("legacy config");
        assert_eq!(settings.profiles.len(), 1);
        assert_eq!(
            settings.assignments.get("claude").map(String::as_str),
            Some("legacy-default")
        );
        assert_eq!(settings.assignments.len(), 1);
    }

    #[test]
    fn support_matrix_is_conservative() {
        assert!(cli_supports_wire("codex", "openai_responses"));
        assert!(!cli_supports_wire("codex", "openai_chat_completions"));
        assert!(!cli_supports_wire("hermes", "openai_chat_completions"));
        assert!(!cli_supports_wire("hermes", "openai_responses"));
        assert!(!cli_supports_wire("gemini", "gemini_native"));
        assert!(!cli_supports_wire("opencode", "openai_chat_completions"));
    }

    #[test]
    fn model_and_ids_reject_shell_tokens() {
        assert!(safe_model("provider/model-1"));
        assert!(!safe_model("model;calc"));
        assert!(safe_id("profile-1"));
        assert!(safe_url("https://example.test/v1"));
        assert!(!safe_url("https://example.test/\"\nmodel_provider=evil"));
    }

    fn profile(wire_api: &str) -> ModelProfile {
        ModelProfile {
            id: "test".into(),
            name: "Test".into(),
            wire_api: wire_api.into(),
            auth_kind: "bearer".into(),
            base_url: "https://example.test/v1".into(),
            api_key: "top-secret-key".into(),
            model: "model-1".into(),
            small_model: "small-1".into(),
        }
    }

    #[test]
    fn launches_never_put_key_in_argv() {
        for (tool, wire) in [
            ("claude", "anthropic_messages"),
            ("codex", "openai_responses"),
            ("aider", "openai_chat_completions"),
        ] {
            let launch = launch_for_profile(tool, profile(wire)).expect("supported launch");
            assert!(!launch.args.join(" ").contains("top-secret-key"));
            assert!(launch
                .env
                .iter()
                .any(|(_, value)| value == "top-secret-key"));
        }
        let claude =
            launch_for_profile("claude", profile("anthropic_messages")).expect("claude launch");
        assert!(claude
            .env
            .iter()
            .any(|(key, value)| key == "CLAUDE_CODE_USE_BEDROCK" && value.is_empty()));
    }

    #[test]
    fn incompatible_or_unimplemented_launches_fail_closed() {
        assert!(launch_for_profile("codex", profile("openai_chat_completions")).is_err());
        assert!(launch_for_profile("gemini", profile("gemini_native")).is_err());
        assert!(launch_for_profile("opencode", profile("openai_chat_completions")).is_err());
        let mut no_auth_chat = profile("openai_chat_completions");
        no_auth_chat.auth_kind = "none".into();
        assert!(launch_for_profile("aider", no_auth_chat).is_err());
    }

    #[test]
    fn aider_always_routes_gateway_models_through_openai_provider() {
        let mut candidate = profile("openai_chat_completions");
        candidate.model = "Qwen/Qwen3-Coder".into();
        candidate.small_model = "deepseek-ai/DeepSeek-V3".into();
        let launch = launch_for_profile("aider", candidate).expect("aider launch");
        assert!(launch
            .env
            .iter()
            .any(|(key, value)| key == "AIDER_MODEL" && value == "openai/Qwen/Qwen3-Coder"));
        assert!(launch
            .env
            .iter()
            .any(|(key, value)| key == "AIDER_WEAK_MODEL"
                && value == "openai/deepseek-ai/DeepSeek-V3"));
    }
}
