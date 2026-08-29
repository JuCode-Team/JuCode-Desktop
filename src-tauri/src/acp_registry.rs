//! ACP agent registry: which external Agent Client Protocol agents the
//! desktop may launch, and with what fixed command line.
//!
//! Safety model: mirrors `backend.rs` — the frontend NEVER passes argv to
//! `create_session`. Users register agents (id, name, command, args, env)
//! through the dedicated registry commands below, where every field is
//! validated; a session then only references a registry *id*, and the command
//! line is looked up here at spawn time. Registered args are fixed
//! configuration (they may legitimately start with `-`, e.g.
//! `--experimental-acp`), but they can never be extended or reordered by a
//! session request.
//!
//! The registry persists as `acp-agents.json` in the per-app config dir
//! (same directory as the other desktop app-data files).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::backend;

/// One launchable ACP agent. `env` is applied on top of the shell-env
/// snapshot / custom backend env when the child is spawned.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AcpAgent {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
struct RegistryFile {
    agents: Vec<AcpAgent>,
}

const FILE_NAME: &str = "acp-agents.json";
const MAX_AGENTS: usize = 32;
const MAX_ARGS: usize = 32;
const MAX_ARG_LEN: usize = 300;
const MAX_NAME_LEN: usize = 100;
const MAX_COMMAND_LEN: usize = 300;

fn valid_text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c.is_control())
}

/// Validates one registry entry. Applied on every write AND on every read, so
/// a hand-edited registry file can't smuggle malformed entries into a spawn.
pub fn validate_agent(agent: &AcpAgent) -> Result<(), String> {
    if !backend::is_valid_acp_agent_id(&agent.id) {
        return Err(format!(
            "invalid agent id: {} (lowercase letters, digits, - and _ only)",
            agent.id
        ));
    }
    if !valid_text(&agent.name, MAX_NAME_LEN) {
        return Err("agent name must be 1-100 characters without control characters".to_string());
    }
    if !valid_text(&agent.command, MAX_COMMAND_LEN) || agent.command.starts_with('-') {
        return Err("agent command must be a program name or path (not a flag)".to_string());
    }
    if agent.args.len() > MAX_ARGS {
        return Err(format!("agent accepts at most {MAX_ARGS} arguments"));
    }
    for arg in &agent.args {
        if arg.is_empty() || arg.len() > MAX_ARG_LEN || arg.chars().any(|c| c.is_control()) {
            return Err(format!("invalid agent argument: {arg:?}"));
        }
    }
    if agent.env.len() > backend::MAX_CUSTOM_ENV_VARS {
        return Err(format!(
            "agent env accepts at most {} variables",
            backend::MAX_CUSTOM_ENV_VARS
        ));
    }
    for (name, value) in &agent.env {
        if !backend::is_valid_env_name(name) {
            return Err(format!("invalid env variable name: {name}"));
        }
        if value.len() > backend::MAX_CUSTOM_ENV_VALUE_LEN || value.contains('\0') {
            return Err(format!("invalid env value for {name}"));
        }
    }
    Ok(())
}

/// First-run default: the native engine's own ACP surface, so the picker has
/// a working ACP option out of the box.
fn default_agents() -> Vec<AcpAgent> {
    vec![AcpAgent {
        id: "jucode-acp".to_string(),
        name: "JuCode (ACP)".to_string(),
        command: "jucode".to_string(),
        args: vec!["acp".to_string()],
        env: BTreeMap::new(),
    }]
}

/// Parses the registry file contents, validating every entry.
fn parse_registry(text: &str) -> Result<Vec<AcpAgent>, String> {
    let file: RegistryFile =
        serde_json::from_str(text).map_err(|e| format!("acp registry is malformed: {e}"))?;
    for agent in &file.agents {
        validate_agent(agent)?;
    }
    Ok(file.agents)
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app config dir unavailable: {e}"))?;
    Ok(dir.join(FILE_NAME))
}

/// Loads the registry; a missing file seeds the defaults (an existing but
/// EMPTY registry stays empty — deleting the default entry is respected).
pub fn load(app: &AppHandle) -> Result<Vec<AcpAgent>, String> {
    let path = registry_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_registry(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(default_agents()),
        Err(e) => Err(format!("failed to read {}: {e}", path.display())),
    }
}

/// Write-then-rename so a crash mid-write can't truncate the registry.
fn save(app: &AppHandle, agents: &[AcpAgent]) -> Result<(), String> {
    let path = registry_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&RegistryFile {
        agents: agents.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    let mut tmp = path.clone();
    tmp.set_file_name(format!("{FILE_NAME}.tmp"));
    std::fs::write(&tmp, text.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Looks up (and re-validates) one agent for spawning.
pub fn find_agent(app: &AppHandle, id: &str) -> Result<AcpAgent, String> {
    load(app)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("unknown acp agent: {id}"))
}

/// Lists the registered ACP agents (settings UI + new-session picker).
#[tauri::command]
pub fn acp_agents_list(app: AppHandle) -> Result<Vec<AcpAgent>, String> {
    load(&app)
}

/// Adds or replaces one agent (matched by id). Returns the updated list.
#[tauri::command]
pub fn acp_agent_upsert(app: AppHandle, agent: AcpAgent) -> Result<Vec<AcpAgent>, String> {
    validate_agent(&agent)?;
    let mut agents = load(&app)?;
    if let Some(existing) = agents.iter_mut().find(|a| a.id == agent.id) {
        *existing = agent;
    } else {
        if agents.len() >= MAX_AGENTS {
            return Err(format!("at most {MAX_AGENTS} acp agents can be registered"));
        }
        agents.push(agent);
    }
    save(&app, &agents)?;
    Ok(agents)
}

/// Removes one agent by id. Returns the updated list.
#[tauri::command]
pub fn acp_agent_remove(app: AppHandle, id: String) -> Result<Vec<AcpAgent>, String> {
    let mut agents = load(&app)?;
    agents.retain(|a| a.id != id);
    save(&app, &agents)?;
    Ok(agents)
}

/// Availability probe for one registered agent: resolves its command and runs
/// `<command> --version` best-effort (mirrors `check_backend`).
#[tauri::command(async)]
pub fn acp_agent_check(app: AppHandle, id: String) -> Result<crate::BackendStatus, String> {
    let agent = find_agent(&app, &id)?;
    let bin = backend::resolve_acp_program(&agent.command);
    let path = if bin.components().count() == 1 {
        crate::which(&bin.to_string_lossy())
    } else if bin.is_file() {
        Some(bin)
    } else {
        None
    };
    let Some(path) = path else {
        return Ok(crate::BackendStatus {
            found: false,
            path: None,
            version: None,
        });
    };
    let mut cmd = std::process::Command::new(&path);
    crate::no_window(&mut cmd);
    cmd.arg("--version");
    let version = crate::run_with_timeout(cmd, std::time::Duration::from_secs(15))
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|v| !v.is_empty());
    Ok(crate::BackendStatus {
        found: true,
        path: Some(path.display().to_string()),
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str) -> AcpAgent {
        AcpAgent {
            id: id.to_string(),
            name: "Test Agent".to_string(),
            command: "test-agent".to_string(),
            args: vec!["--experimental-acp".to_string()],
            env: BTreeMap::new(),
        }
    }

    #[test]
    fn default_registry_launches_jucode_acp() {
        let agents = default_agents();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "jucode-acp");
        assert_eq!(agents[0].command, "jucode");
        assert_eq!(agents[0].args, vec!["acp"]);
        validate_agent(&agents[0]).unwrap();
    }

    #[test]
    fn registered_args_may_be_flags_but_stay_bounded() {
        // Fixed config flags like --experimental-acp are legitimate.
        validate_agent(&agent("gemini")).unwrap();
        let mut too_many = agent("gemini");
        too_many.args = vec!["x".to_string(); MAX_ARGS + 1];
        assert!(validate_agent(&too_many).is_err());
        let mut newline = agent("gemini");
        newline.args = vec!["a\nb".to_string()];
        assert!(validate_agent(&newline).is_err());
        let mut empty = agent("gemini");
        empty.args = vec![String::new()];
        assert!(validate_agent(&empty).is_err());
    }

    #[test]
    fn ids_names_and_commands_are_validated() {
        for bad in ["", "UPPER", "a b", "--x", "a/b"] {
            assert!(validate_agent(&agent(bad)).is_err(), "{bad:?}");
        }
        let mut flag_cmd = agent("ok");
        flag_cmd.command = "--rm".to_string();
        assert!(validate_agent(&flag_cmd).is_err());
        let mut no_name = agent("ok");
        no_name.name = String::new();
        assert!(validate_agent(&no_name).is_err());
        // Paths (with spaces) are fine as commands.
        let mut path_cmd = agent("ok");
        path_cmd.command = "/opt/agents/my agent/bin/agent".to_string();
        validate_agent(&path_cmd).unwrap();
    }

    #[test]
    fn env_entries_are_validated_like_backend_env() {
        let mut bad_env = agent("ok");
        bad_env.env.insert("DYLD_INSERT_LIBRARIES".to_string(), "/evil".to_string());
        assert!(validate_agent(&bad_env).is_err());
        let mut bad_name = agent("ok");
        bad_name.env.insert("1BAD".to_string(), "x".to_string());
        assert!(validate_agent(&bad_name).is_err());
        let mut ok_env = agent("ok");
        ok_env
            .env
            .insert("GEMINI_API_KEY".to_string(), "k".to_string());
        validate_agent(&ok_env).unwrap();
    }

    #[test]
    fn parse_registry_validates_every_entry() {
        let ok = r#"{"agents":[{"id":"gemini","name":"Gemini CLI","command":"gemini","args":["--experimental-acp"]}]}"#;
        let agents = parse_registry(ok).unwrap();
        assert_eq!(agents[0].id, "gemini");
        assert_eq!(agents[0].args, vec!["--experimental-acp"]);
        assert!(agents[0].env.is_empty());
        // A hand-edited file with a smuggled entry is rejected wholesale.
        let bad = r#"{"agents":[{"id":"OK?","name":"x","command":"sh"}]}"#;
        assert!(parse_registry(bad).is_err());
        assert!(parse_registry("not json").is_err());
        // An explicitly emptied registry stays empty (no re-seeding).
        assert_eq!(parse_registry(r#"{"agents":[]}"#).unwrap(), Vec::<AcpAgent>::new());
    }
}
