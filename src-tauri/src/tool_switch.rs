//! Switch Claude Code / Codex live config between the user's original
//! provider and JuCode. Pattern lifted from CC Switch (backup live files,
//! write overlay, restore on revert) without the rest of that app.
//!
//! Claude: merge `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` into
//! `~/.claude/settings.json` (Claude Code posts `{base}/v1/messages`).
//! Codex: replace `~/.codex/auth.json` with the JuCode token and set
//! `model_provider = "jucode"` in `config.toml` (`{api}/v1` + Responses).

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::secrets;

const STATE_FILE: &str = "state.json";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tool {
    Claude,
    Codex,
}

impl Tool {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            _ => Err(format!("tool profile switch only supports claude/codex, not {s}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

struct Paths {
    home: PathBuf,
}

impl Paths {
    fn live() -> Self {
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_default();
        Self { home }
    }

    fn dir(&self) -> PathBuf {
        self.home.join(".jucode").join("tool-switch")
    }

    fn state(&self) -> PathBuf {
        self.dir().join(STATE_FILE)
    }

    fn claude_settings(&self) -> PathBuf {
        let dir = self.home.join(".claude");
        let settings = dir.join("settings.json");
        let legacy = dir.join("claude.json");
        if settings.exists() {
            settings
        } else if legacy.exists() {
            legacy
        } else {
            settings
        }
    }

    fn codex_auth(&self) -> PathBuf {
        self.home.join(".codex").join("auth.json")
    }

    fn codex_config(&self) -> PathBuf {
        self.home.join(".codex").join("config.toml")
    }

    fn bak(&self, name: &str) -> PathBuf {
        self.dir().join(name)
    }
}

pub fn current_mode(backend: &str) -> Result<String, String> {
    let tool = Tool::parse(backend)?;
    Ok(read_mode(&Paths::live(), tool))
}

pub fn switch_to_system(backend: &str) -> Result<(), String> {
    restore(&Paths::live(), Tool::parse(backend)?)
}

pub fn switch_to_jucode(
    backend: &str,
    api_url: &str,
    token: &str,
    model: Option<&str>,
) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("not logged in to JuCode".to_string());
    }
    if let Some(m) = model {
        validate_model(m)?;
    }
    let api = api_url.trim().trim_end_matches('/');
    apply_jucode(&Paths::live(), Tool::parse(backend)?, api, token, model)
}

fn read_mode(paths: &Paths, tool: Tool) -> String {
    let v = read_json(&paths.state());
    v.get(tool.as_str())
        .and_then(Value::as_str)
        .filter(|m| *m == "jucode")
        .unwrap_or("system")
        .to_string()
}

fn write_mode(paths: &Paths, tool: Tool, mode: &str) -> Result<(), String> {
    let mut v = read_json_strict(&paths.state())?;
    let obj = v
        .as_object_mut()
        .ok_or_else(|| "tool-switch state is not an object".to_string())?;
    obj.insert(tool.as_str().to_string(), json!(mode));
    write_json(&paths.state(), &v)
}

fn apply_jucode(
    paths: &Paths,
    tool: Tool,
    api: &str,
    token: &str,
    model: Option<&str>,
) -> Result<(), String> {
    if read_mode(paths, tool) != "jucode" {
        backup(paths, tool)?;
    }
    match tool {
        Tool::Claude => apply_claude(paths, api, token, model)?,
        Tool::Codex => apply_codex(paths, api, token, model)?,
    }
    write_mode(paths, tool, "jucode")
}

fn restore(paths: &Paths, tool: Tool) -> Result<(), String> {
    match tool {
        Tool::Claude => restore_file(&paths.bak("claude.settings.bak"), &paths.claude_settings())?,
        Tool::Codex => {
            restore_file(&paths.bak("codex.auth.bak"), &paths.codex_auth())?;
            restore_file(&paths.bak("codex.config.bak"), &paths.codex_config())?;
        }
    }
    write_mode(paths, tool, "system")
}

fn backup(paths: &Paths, tool: Tool) -> Result<(), String> {
    fs::create_dir_all(paths.dir()).map_err(|e| e.to_string())?;
    match tool {
        Tool::Claude => snapshot(&paths.claude_settings(), &paths.bak("claude.settings.bak")),
        Tool::Codex => {
            snapshot(&paths.codex_auth(), &paths.bak("codex.auth.bak"))?;
            snapshot(&paths.codex_config(), &paths.bak("codex.config.bak"))
        }
    }
}

/// Copy `src` → `dst`. If `src` is missing, write a `.missing` sibling so
/// restore can delete the live file we created.
fn snapshot(src: &Path, dst: &Path) -> Result<(), String> {
    let missing = missing_marker(dst);
    let _ = fs::remove_file(&missing);
    if src.exists() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src, dst).map_err(|e| format!("backup {} failed: {e}", src.display()))?;
    } else {
        fs::write(&missing, b"").map_err(|e| e.to_string())?;
        let _ = fs::remove_file(dst);
    }
    Ok(())
}

fn restore_file(bak: &Path, live: &Path) -> Result<(), String> {
    let missing = missing_marker(bak);
    if bak.exists() {
        if let Some(parent) = live.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(bak, live).map_err(|e| format!("restore {} failed: {e}", live.display()))?;
        secrets::restrict_to_owner(live);
        return Ok(());
    }
    if missing.exists() && live.exists() {
        fs::remove_file(live).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn missing_marker(bak: &Path) -> PathBuf {
    bak.with_extension("missing")
}

fn apply_claude(paths: &Paths, api: &str, token: &str, model: Option<&str>) -> Result<(), String> {
    let path = paths.claude_settings();
    let mut settings = read_json_strict(&path)?;
    overlay_claude(&mut settings, api, token, model);
    write_json(&path, &settings)?;
    secrets::restrict_to_owner(&path);
    Ok(())
}

pub(crate) fn overlay_claude(settings: &mut Value, api: &str, token: &str, model: Option<&str>) {
    let env = settings
        .as_object_mut()
        .map(|o| o.entry("env").or_insert_with(|| json!({})));
    let Some(env) = env.and_then(Value::as_object_mut) else {
        return;
    };
    env.insert("ANTHROPIC_BASE_URL".into(), json!(api));
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), json!(token));
    env.remove("ANTHROPIC_API_KEY");
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        env.insert("ANTHROPIC_MODEL".into(), json!(m));
    }
}

fn apply_codex(paths: &Paths, api: &str, token: &str, model: Option<&str>) -> Result<(), String> {
    let auth_path = paths.codex_auth();
    let cfg_path = paths.codex_config();
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_json(&auth_path, &json!({ "OPENAI_API_KEY": token }))?;
    secrets::restrict_to_owner(&auth_path);

    let original = if cfg_path.exists() {
        fs::read_to_string(&cfg_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let next = overlay_codex_config(&original, &format!("{api}/v1"), model)?;
    fs::write(&cfg_path, next).map_err(|e| e.to_string())?;
    Ok(())
}

/// Upsert top-level `model_provider` / `model` and ensure `[model_providers.jucode]`.
pub(crate) fn overlay_codex_config(
    original: &str,
    base_url: &str,
    model: Option<&str>,
) -> Result<String, String> {
    if base_url.contains('"') || base_url.contains('\n') {
        return Err("invalid JuCode API URL".into());
    }
    let mut text = upsert_top_level(original, "model_provider", "jucode");
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        text = upsert_top_level(&text, "model", m);
    }
    if !has_jucode_provider_table(&text) {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&format!(
            "\n[model_providers.jucode]\nname = \"JuCode\"\nbase_url = \"{base_url}\"\nwire_api = \"responses\"\n"
        ));
    }
    Ok(text)
}

fn has_jucode_provider_table(text: &str) -> bool {
    text.lines().any(|l| {
        let t = l.trim();
        t == "[model_providers.jucode]" || t.eq_ignore_ascii_case("[model_providers.jucode]")
    })
}

/// Replace or insert `key = "value"` in the top-level TOML table (before the
/// first `[section]`). Quoted values only — callers already validate.
fn upsert_top_level(text: &str, key: &str, value: &str) -> String {
    let line = format!("{key} = \"{value}\"");
    let mut out = String::new();
    let mut found = false;
    let mut at_table = false;
    for raw in text.lines() {
        let trimmed = raw.trim();
        if trimmed.starts_with('[') {
            if !found {
                out.push_str(&line);
                out.push('\n');
                found = true;
            }
            at_table = true;
        }
        if !at_table && is_toml_key_line(trimmed, key) {
            out.push_str(&line);
            out.push('\n');
            found = true;
            continue;
        }
        out.push_str(raw);
        out.push('\n');
    }
    if !found {
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn is_toml_key_line(trimmed: &str, key: &str) -> bool {
    let rest = match trimmed.strip_prefix(key) {
        Some(r) => r,
        None => return false,
    };
    rest.trim_start().starts_with('=')
}

fn validate_model(model: &str) -> Result<(), String> {
    if model.is_empty() || model.len() > 80 {
        return Err("invalid model id".into());
    }
    if !model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("invalid model id".into());
    }
    Ok(())
}

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}))
}

fn read_json_strict(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(t) if t.trim().is_empty() => Ok(json!({})),
        Ok(t) => serde_json::from_str(&t)
            .map_err(|e| format!("{} 解析失败，已中止写入：{e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("读取 {} 失败：{e}", path.display())),
    }
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, format!("{text}\n")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_home(name: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("jucode-tool-switch-{name}-{n}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn paths(home: PathBuf) -> Paths {
        Paths { home }
    }

    #[test]
    fn overlay_claude_sets_auth_token_and_drops_api_key() {
        let mut v = json!({
            "env": { "ANTHROPIC_API_KEY": "sk-old", "KEEP": "1" },
            "permissions": { "allow": [] }
        });
        overlay_claude(&mut v, "https://api.jucode.cn", "tok", Some("claude-sonnet"));
        assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "https://api.jucode.cn");
        assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert_eq!(v["env"]["ANTHROPIC_MODEL"], "claude-sonnet");
        assert!(v["env"].get("ANTHROPIC_API_KEY").is_none());
        assert_eq!(v["env"]["KEEP"], "1");
        assert_eq!(v["permissions"]["allow"], json!([]));
    }

    #[test]
    fn overlay_codex_config_inserts_provider_and_keeps_other_keys() {
        let original = "model = \"gpt-5.3-codex\"\nmodel_provider = \"openai\"\napproval_policy = \"on-request\"\n";
        let out = overlay_codex_config(original, "https://api.jucode.cn/v1", Some("gpt-5.5")).unwrap();
        assert!(out.contains("model_provider = \"jucode\""));
        assert!(out.contains("model = \"gpt-5.5\""));
        assert!(out.contains("approval_policy = \"on-request\""));
        assert!(out.contains("[model_providers.jucode]"));
        assert!(out.contains("base_url = \"https://api.jucode.cn/v1\""));
        assert!(out.contains("wire_api = \"responses\""));
        // Idempotent: don't duplicate the table.
        let again = overlay_codex_config(&out, "https://api.jucode.cn/v1", Some("gpt-5.5")).unwrap();
        assert_eq!(
            again.matches("[model_providers.jucode]").count(),
            1
        );
    }

    #[test]
    fn overlay_codex_config_inserts_before_first_table() {
        let original = "[mcp_servers.fs]\ncommand = \"npx\"\n";
        let out = overlay_codex_config(original, "https://api.jucode.cn/v1", None).unwrap();
        let provider_at = out.find("model_provider = \"jucode\"").unwrap();
        let table_at = out.find("[mcp_servers.fs]").unwrap();
        assert!(provider_at < table_at);
    }

    #[test]
    fn jucode_then_system_restores_claude_settings() {
        let home = tmp_home("claude");
        let p = paths(home.clone());
        let live = p.claude_settings();
        fs::create_dir_all(live.parent().unwrap()).unwrap();
        fs::write(&live, "{\n  \"env\": { \"ANTHROPIC_API_KEY\": \"sk-sys\" }\n}\n").unwrap();

        apply_jucode(&p, Tool::Claude, "https://api.jucode.cn", "tok", Some("claude-x")).unwrap();
        let after = fs::read_to_string(&live).unwrap();
        assert!(after.contains("ANTHROPIC_AUTH_TOKEN"));
        assert!(!after.contains("sk-sys"));
        assert_eq!(read_mode(&p, Tool::Claude), "jucode");

        restore(&p, Tool::Claude).unwrap();
        let back = fs::read_to_string(&live).unwrap();
        assert!(back.contains("sk-sys"));
        assert!(!back.contains("ANTHROPIC_AUTH_TOKEN"));
        assert_eq!(read_mode(&p, Tool::Claude), "system");
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn missing_original_is_deleted_on_restore() {
        let home = tmp_home("absent");
        let p = paths(home.clone());
        apply_jucode(&p, Tool::Claude, "https://api.jucode.cn", "tok", None).unwrap();
        assert!(p.claude_settings().exists());
        restore(&p, Tool::Claude).unwrap();
        assert!(!p.claude_settings().exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn second_jucode_switch_does_not_clobber_system_backup() {
        let home = tmp_home("keepbak");
        let p = paths(home.clone());
        let live = p.claude_settings();
        fs::create_dir_all(live.parent().unwrap()).unwrap();
        fs::write(&live, "{\"env\":{\"ANTHROPIC_API_KEY\":\"sk-sys\"}}\n").unwrap();
        apply_jucode(&p, Tool::Claude, "https://api.jucode.cn", "tok1", None).unwrap();
        apply_jucode(&p, Tool::Claude, "https://api.jucode.cn", "tok2", None).unwrap();
        restore(&p, Tool::Claude).unwrap();
        let back = fs::read_to_string(&live).unwrap();
        assert!(back.contains("sk-sys"));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn rejects_junk_model_ids() {
        assert!(validate_model("claude-sonnet-4-5").is_ok());
        assert!(validate_model("gpt-5.5").is_ok());
        assert!(validate_model("bad model").is_err());
        assert!(validate_model("x\"y").is_err());
    }
}
