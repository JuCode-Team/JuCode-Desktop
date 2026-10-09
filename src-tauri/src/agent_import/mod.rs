//! 一键导入: the conversations, skills and MCP servers of the other coding
//! agents on this machine (Claude Code, Codex, opencode, zcode, omp), listed
//! in one scan and imported in one go. Their files are never changed; the
//! only writes outside `~/.jucode` are the Claude Code and Codex conversation
//! copies, added next to that engine's own sessions (`~/.claude/projects`,
//! `~/.codex/sessions`).
//!
//! - Conversations: Claude Code and Codex ones become a cleaned copy in the
//!   engine's own format (native_import) and continue on that engine.
//!   opencode, zcode and omp have no engine here, so theirs are converted
//!   into JuCode sessions (sessions.rs). Either way
//!   `~/.jucode/native-imports.json` records the import, and importing again
//!   reuses the first copy.
//! - Skills are copied into `~/.jucode/skills` (skills.rs).
//! - MCP servers are mapped to `mcp_servers` entries (mcp.rs). The desktop
//!   adds them through the daemon (`mcp_set`), as Settings → MCP does, so
//!   open sessions pick them up.

mod mcp;
mod sessions;
mod skills;

use crate::native_import::{self, Homes};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Where everything is read from and written to (injectable so tests run
/// against a fixture home).
pub struct Roots {
    pub home: PathBuf,
    /// `~/.jucode`: sessions, skills, config.json and the import registry.
    pub jucode: PathBuf,
    pub claude: PathBuf,
    pub codex: PathBuf,
    /// `$XDG_DATA_HOME` or `~/.local/share` (opencode's database).
    pub data_home: PathBuf,
    /// `$XDG_CONFIG_HOME` or `~/.config` (opencode's config and skills).
    pub config_home: PathBuf,
}

impl Roots {
    fn real() -> Roots {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_default();
        let xdg = |var: &str, fallback: &str| {
            std::env::var_os(var)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or_else(|| home.join(fallback))
        };
        let native = native_import::homes();
        Roots {
            jucode: crate::jucode_dir(),
            claude: native.claude,
            codex: native.codex,
            data_home: xdg("XDG_DATA_HOME", ".local/share"),
            config_home: xdg("XDG_CONFIG_HOME", ".config"),
            home,
        }
    }

    fn native(&self) -> Homes {
        Homes { claude: self.claude.clone(), codex: self.codex.clone(), registry: self.registry() }
    }

    fn registry(&self) -> PathBuf {
        self.jucode.join("native-imports.json")
    }

    fn opencode_db(&self) -> PathBuf {
        self.data_home.join("opencode").join("opencode.db")
    }

    fn zcode_db(&self) -> PathBuf {
        self.home.join(".zcode").join("cli").join("db").join("db.sqlite")
    }

    fn zcode_plugins(&self) -> PathBuf {
        self.home.join(".zcode").join("cli").join("plugins").join("cache")
    }

    fn omp_agent(&self) -> PathBuf {
        self.home.join(".omp").join("agent")
    }
}

/// A plugin another agent has installed: skills and MCP servers come with
/// it (`skills/`, `.mcp.json`).
pub(crate) struct Plugin {
    pub source: &'static str,
    pub name: String,
    pub dir: PathBuf,
}

/// Codex's `config.toml` as JSON (null when missing or unreadable).
fn codex_config(roots: &Roots) -> serde_json::Value {
    std::fs::read_to_string(roots.codex.join("config.toml"))
        .ok()
        .and_then(|text| text.parse::<toml::Table>().ok())
        .and_then(|table| serde_json::to_value(table).ok())
        .unwrap_or_default()
}

/// The newest version folder of a plugin cache entry (`<plugin>/<version>/`).
fn latest_version(dir: &Path) -> Option<PathBuf> {
    let key = |p: &PathBuf| -> Vec<(u64, String)> {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name.split(['.', '-', '+'])
            .map(|part| part.parse::<u64>().map_or((0, part.to_string()), |n| (n, String::new())))
            .collect()
    };
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && !p.file_name().and_then(|n| n.to_str()).unwrap_or(".").starts_with('.'))
        .max_by(|a, b| key(a).cmp(&key(b)))
}

/// Installed plugins: Claude Code's registry (less the ones turned off in its
/// settings), the ones Codex's config enables, and every one in zcode's cache.
fn plugins(roots: &Roots) -> Vec<Plugin> {
    let mut out = Vec::new();
    let installed = crate::read_json(&roots.claude.join("plugins").join("installed_plugins.json"));
    let enabled = crate::read_json(&roots.claude.join("settings.json"));
    for (key, entry) in installed["plugins"].as_object().into_iter().flatten() {
        if enabled["enabledPlugins"][key] == serde_json::json!(false) {
            continue;
        }
        // One install (older registries) or one per scope.
        let entries = entry.as_array().cloned().unwrap_or_else(|| vec![entry.clone()]);
        let dir = entries.iter().rev().filter_map(|e| e["installPath"].as_str()).map(PathBuf::from).find(|p| p.is_dir());
        if let Some(dir) = dir {
            out.push(Plugin { source: "claude", name: key.split('@').next().unwrap_or(key).to_string(), dir });
        }
    }
    let config = codex_config(roots);
    for (key, entry) in config["plugins"].as_object().into_iter().flatten() {
        let Some((name, market)) = key.split_once('@') else { continue };
        if entry["enabled"] == serde_json::json!(false) || name.contains(['/', '\\']) || market.contains(['/', '\\']) {
            continue;
        }
        if let Some(dir) = latest_version(&roots.codex.join("plugins").join("cache").join(market).join(name)) {
            out.push(Plugin { source: "codex", name: name.to_string(), dir });
        }
    }
    for market in std::fs::read_dir(roots.zcode_plugins()).into_iter().flatten().flatten() {
        for plugin in std::fs::read_dir(market.path()).into_iter().flatten().flatten() {
            if let Some(dir) = latest_version(&plugin.path()) {
                out.push(Plugin { source: "zcode", name: plugin.file_name().to_string_lossy().into_owned(), dir });
            }
        }
    }
    out
}

#[derive(Serialize, Debug)]
pub struct Scan {
    pub sessions: Vec<sessions::Found>,
    pub skills: Vec<skills::Found>,
    pub mcp: Vec<mcp::Found>,
}

fn scan(roots: &Roots) -> Scan {
    Scan { sessions: sessions::scan(roots), skills: skills::scan(roots), mcp: mcp::scan(roots) }
}

#[derive(Deserialize, Debug)]
pub struct SessionPick {
    pub source: String,
    pub id: String,
    /// The folder the scan found it in (Claude Code and Codex copies are
    /// written per folder).
    #[serde(default)]
    pub cwd: String,
}

#[derive(Deserialize, Debug)]
pub struct SkillPick {
    pub source: String,
    pub path: String,
}

#[derive(Deserialize, Debug, Default)]
pub struct Selection {
    #[serde(default)]
    pub sessions: Vec<SessionPick>,
    #[serde(default)]
    pub skills: Vec<SkillPick>,
}

/// What became of one picked item.
#[derive(Serialize, Debug)]
pub struct Outcome {
    /// "session" or "skill".
    pub kind: &'static str,
    pub source: String,
    /// The item as the scan named it: a session id, a skill folder.
    pub key: String,
    /// "imported"; "existing" when an earlier import (or a skill of that
    /// name) is already there; "failed".
    pub status: &'static str,
    /// Sessions: the copy to open. Skills: the folder it was copied to.
    pub target: Option<String>,
    pub title: Option<String>,
    /// Sessions: the folder the conversation belongs to, and the engine its
    /// copy continues on ("jucode", "claude", "codex").
    pub cwd: Option<String>,
    pub engine: Option<String>,
    /// Whether `cwd` is still a folder on this machine (only then can it be a
    /// project).
    pub cwd_exists: bool,
    pub error: Option<String>,
}

impl Outcome {
    fn failed(kind: &'static str, source: &str, key: &str, error: String) -> Outcome {
        Outcome {
            kind,
            source: source.to_string(),
            key: key.to_string(),
            status: "failed",
            target: None,
            title: None,
            cwd: None,
            engine: None,
            cwd_exists: false,
            error: Some(error),
        }
    }
}

fn apply(roots: &Roots, selection: Selection) -> Vec<Outcome> {
    // One import at a time, here or from a history picker: each extends the
    // registry.
    let _one = native_import::IMPORTING.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::new();
    for pick in &selection.sessions {
        out.push(match sessions::import(roots, pick) {
            Ok(done) => Outcome {
                kind: "session",
                source: pick.source.clone(),
                key: pick.id.clone(),
                status: if done.reused { "existing" } else { "imported" },
                target: Some(done.id),
                title: Some(done.title),
                cwd_exists: Path::new(&done.cwd).is_dir(),
                cwd: Some(done.cwd),
                engine: Some(done.engine.to_string()),
                error: None,
            },
            Err(e) => Outcome::failed("session", &pick.source, &pick.id, e),
        });
    }
    if !selection.skills.is_empty() {
        let found = skills::scan(roots);
        for pick in &selection.skills {
            out.push(match skills::import(roots, &found, &pick.source, &pick.path) {
                Ok((copied, dest)) => Outcome {
                    kind: "skill",
                    source: pick.source.clone(),
                    key: pick.path.clone(),
                    status: if copied { "imported" } else { "existing" },
                    target: Some(dest.display().to_string()),
                    title: None,
                    cwd: None,
                    engine: None,
                    cwd_exists: false,
                    error: None,
                },
                Err(e) => Outcome::failed("skill", &pick.source, &pick.path, e),
            });
        }
    }
    out
}

// --- commands ----------------------------------------------------------------

/// Everything the other agents on this machine have that JuCode can take
/// over: conversations (all folders), skills and MCP servers.
#[tauri::command(async)]
pub fn import_scan() -> Scan {
    scan(&Roots::real())
}

/// Imports the picked conversations and skills (MCP servers go through the
/// daemon, see the module docs); one outcome per item, in order.
#[tauri::command(async)]
pub fn import_apply(selection: Selection) -> Vec<Outcome> {
    apply(&Roots::real(), selection)
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::Roots;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A fresh fake home for one test.
    pub fn roots(name: &str) -> Roots {
        let home = std::env::temp_dir().join(format!("jucode-agent-import-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        Roots {
            jucode: home.join(".jucode"),
            claude: home.join(".claude"),
            codex: home.join(".codex"),
            data_home: home.join(".local/share"),
            config_home: home.join(".config"),
            home,
        }
    }

    pub fn write(path: &Path, text: &str) -> PathBuf {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scans this machine's real agents (read-only) and converts a few of the
    /// opencode / zcode / omp conversations into a temporary JuCode home.
    /// `cargo test --lib real_machine -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_machine_scan_and_convert() {
        let real = Roots::real();
        let started = std::time::Instant::now();
        let found = scan(&real);
        println!("scan took {:?}", started.elapsed());
        // For a look at the page with this machine's data (tests/browser).
        if let Some(path) = std::env::var_os("IMPORT_SCAN_JSON") {
            std::fs::write(path, serde_json::to_string(&found).unwrap()).unwrap();
        }
        let count = |s: &str| found.sessions.iter().filter(|x| x.source == s).count();
        for source in ["claude", "codex", "opencode", "zcode", "omp"] {
            println!("{source}: {} conversations", count(source));
        }
        for s in found.sessions.iter().take(3) {
            println!("  e.g. {} {} {:?} {} prompts", s.source, s.id, s.title, s.messages);
        }
        println!("skills: {}", found.skills.len());
        for s in &found.skills {
            println!("  {} {} {} present={}", s.source, s.plugin.as_deref().unwrap_or("-"), s.name, s.present);
        }
        println!("mcp: {}", found.mcp.len());
        for m in &found.mcp {
            println!("  {} {} {} present={} {}", m.source, m.from, m.name, m.present, m.entry);
        }
        // Converted copies go to a temporary JuCode home, never ~/.jucode.
        let tmp = testutil::roots("real");
        let into = Roots { jucode: tmp.jucode.clone(), ..Roots::real() };
        for source in ["opencode", "zcode", "omp"] {
            for s in found.sessions.iter().filter(|x| x.source == source).take(3) {
                let pick = SessionPick { source: s.source.clone(), id: s.id.clone(), cwd: s.cwd.clone() };
                let done = sessions::import(&into, &pick).expect("converts");
                let dir = sessions::jucode_session_dir(&into.jucode, &done.cwd);
                let journal = std::fs::read_to_string(dir.join(format!("{}.jsonl", done.id))).unwrap();
                println!("{source} {} → {} ({} journal lines) in {}", s.id, done.id, journal.lines().count(), dir.display());
            }
        }
    }
}
