//! Earlier versions ran Claude Code / Codex on the JuCode gateway by
//! rewriting `~/.claude/settings.json` and `~/.codex/*` (with backups here);
//! `restore_leftovers` puts those files back once. The daemon now gives the
//! gateway to each session's process alone.

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

/// Puts back the Claude Code / Codex files an earlier version overwrote
/// (a tool still marked `jucode` in the state file). Run once at startup.
pub fn restore_leftovers() {
    let paths = Paths::live();
    for tool in [Tool::Claude, Tool::Codex] {
        if read_mode(&paths, tool) == "jucode" {
            if let Err(error) = restore(&paths, tool) {
                eprintln!(
                    "[tool-switch] restoring {} config failed: {error}",
                    tool.as_str()
                );
            }
        }
    }
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
    fn leftover_overlays_are_restored() {
        let home = tmp_home("leftover");
        let p = paths(home.clone());
        let live = p.claude_settings();
        fs::create_dir_all(live.parent().unwrap()).unwrap();
        fs::create_dir_all(p.dir()).unwrap();
        fs::write(
            p.bak("claude.settings.bak"),
            "{\"env\":{\"ANTHROPIC_API_KEY\":\"sk-sys\"}}\n",
        )
        .unwrap();
        fs::write(&live, "{\"env\":{\"ANTHROPIC_AUTH_TOKEN\":\"tok\"}}\n").unwrap();
        write_mode(&p, Tool::Claude, "jucode").unwrap();
        restore(&p, Tool::Claude).unwrap();
        assert!(fs::read_to_string(&live).unwrap().contains("sk-sys"));
        assert_eq!(read_mode(&p, Tool::Claude), "system");
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn missing_original_is_deleted_on_restore() {
        let home = tmp_home("absent");
        let p = paths(home.clone());
        fs::create_dir_all(p.dir()).unwrap();
        fs::write(missing_marker(&p.bak("claude.settings.bak")), b"").unwrap();
        let live = p.claude_settings();
        fs::create_dir_all(live.parent().unwrap()).unwrap();
        fs::write(&live, "{}").unwrap();
        restore(&p, Tool::Claude).unwrap();
        assert!(!live.exists());
        let _ = fs::remove_dir_all(home);
    }
}
