//! The agent CLIs the desktop knows: how their binaries are resolved, which
//! argv their native TUI tabs may start with, and the custom environment a
//! user may give them. Sessions themselves run in the jucode daemon.
//!
//! Safety model: the frontend never passes argv. TUI tabs take a fixed token
//! allowlist per backend, and every value is one argv entry (never
//! shell-interpreted, never split).

use std::path::{Path, PathBuf};

/// The agent engines the desktop can drive.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BackendKind {
    /// Native engine, the default — full protocol support.
    Jucode,
    /// OpenAI Codex CLI in stdio JSON-RPC server mode (`codex app-server`).
    Codex,
    /// Claude Code CLI in stream-json print mode.
    Claude,
    /// Any Agent Client Protocol agent (JSON-RPC over stdio). The command
    /// line comes from the user-managed ACP registry (`acp_registry.rs`) —
    /// the frontend only ever passes a registry entry id.
    Acp,
}

impl BackendKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "jucode" => Ok(Self::Jucode),
            "codex" => Ok(Self::Codex),
            "claude" => Ok(Self::Claude),
            "acp" => Ok(Self::Acp),
            other => Err(format!("unknown backend: {other}")),
        }
    }

    /// Binary base name (without the Windows `.exe` suffix). For `Acp` this is
    /// only used in error messages — the actual command comes from the registry.
    pub fn bin_name(self) -> &'static str {
        match self {
            Self::Jucode => "jucode",
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Acp => "acp",
        }
    }

    /// Environment variable that force-overrides binary resolution. Never
    /// consulted for `Acp` (its binary resolution goes through the registry).
    pub fn env_override(self) -> &'static str {
        match self {
            Self::Jucode => "JUCODE_BIN",
            Self::Codex => "CODEX_BIN",
            Self::Claude => "CLAUDE_BIN",
            Self::Acp => "JUCODE_ACP_BIN_UNUSED",
        }
    }
}

/// Custom env var names: POSIX-style identifiers only, with dangerous
/// dynamic-linker prefixes rejected outright.
pub(crate) fn is_valid_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with("DYLD_")
        && !name.starts_with("LD_")
        && name
            .chars()
            .next()
            .map(|c| c.is_ascii_alphabetic() || c == '_')
            .unwrap_or(false)
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub(crate) const MAX_CUSTOM_ENV_VARS: usize = 50;
pub(crate) const MAX_CUSTOM_ENV_VALUE_LEN: usize = 4096;

/// ACP registry entry ids: short lowercase slugs, so an id can never look
/// like a flag, a path or contain whitespace tricks.
pub(crate) fn is_valid_acp_agent_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Session / resume ids: UUID-ish only (alphanumeric + dashes), so an id can
/// never look like a flag or contain whitespace tricks.
fn is_valid_session_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Free-ish text option values (model names, binary paths): must not start
/// with `-` (they are always passed as a flag *value*, but a leading dash is
/// never legitimate and rejecting it removes any parser ambiguity) and must
/// not contain control characters.
fn is_valid_value(s: &str) -> bool {
    !s.is_empty() && s.len() <= 300 && !s.starts_with('-') && !s.chars().any(|c| c.is_control())
}

/// Validates a user-defined environment (`{NAME: value}`): plain names, no
/// dynamic-linker variables, bounded size.
pub fn validate_env(value: &serde_json::Value) -> Result<Vec<(String, String)>, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "env must be an object of string values".to_string())?;
    if obj.len() > MAX_CUSTOM_ENV_VARS {
        return Err(format!(
            "env accepts at most {MAX_CUSTOM_ENV_VARS} variables"
        ));
    }
    let mut vars = Vec::with_capacity(obj.len());
    for (name, val) in obj {
        if !is_valid_env_name(name) {
            return Err(format!("invalid env variable name: {name}"));
        }
        let val = val
            .as_str()
            .ok_or_else(|| format!("env value for {name} must be a string"))?;
        if val.len() > MAX_CUSTOM_ENV_VALUE_LEN || val.contains('\0') {
            return Err(format!("invalid env value for {name}"));
        }
        vars.push((name.clone(), val.to_string()));
    }
    Ok(vars)
}

// --- native TUI tabs (pty-backed interactive CLI sessions) ---

/// argv tokens `pty_open` accepts per backend when spawning the interactive
/// TUI. Exact-match tokens only — no values, no free-form flags — so the
/// webview can never smuggle arbitrary argv into a spawn.
pub fn tui_allowed_args(kind: BackendKind) -> &'static [&'static str] {
    match kind {
        // Bare `jucode` runs the TUI; it has no safe extra tokens.
        BackendKind::Jucode => &[],
        // `codex resume` opens the interactive session picker.
        BackendKind::Codex => &["resume"],
        // `claude --continue` resumes the last session; a bare `claude
        // --resume` opens the interactive session picker.
        BackendKind::Claude => &["--continue", "--resume"],
        // ACP agents have no fixed binary — their command line lives in the
        // user-managed registry — so they are never spawned as TUI tabs
        // (`validate_tui_args` rejects them outright).
        BackendKind::Acp => &[],
    }
}

/// The one TUI token that may be followed by a session id (GUI → TUI session
/// handoff resumes by id). jucode has no resume argv — its TUI resumes via
/// the `/resume` slash command after spawn.
fn tui_resume_flag(kind: BackendKind) -> Option<&'static str> {
    match kind {
        BackendKind::Claude => Some("--resume"),
        BackendKind::Codex => Some("resume"),
        BackendKind::Jucode | BackendKind::Acp => None,
    }
}

/// Validates the extra argv for a TUI spawn. Accepted shapes only:
/// nothing, exactly one allowlisted token, or the backend's resume flag
/// followed by one id that passes `is_valid_session_id`. Anything else —
/// free-form flags, `--resume=<id>`, flag-like "ids", extra tokens — is
/// rejected outright. ACP backends are rejected entirely: their command
/// comes from the registry, not a resolvable well-known binary.
pub fn validate_tui_args(kind: BackendKind, args: &[String]) -> Result<(), String> {
    if kind == BackendKind::Acp {
        return Err("ACP agents cannot be opened as a TUI tab".to_string());
    }
    match args {
        [] => Ok(()),
        [tok] if tui_allowed_args(kind).contains(&tok.as_str()) => Ok(()),
        [flag, id] if tui_resume_flag(kind) == Some(flag.as_str()) && is_valid_session_id(id) => {
            Ok(())
        }
        _ => Err(format!(
            "arguments not allowed for {} TUI: {}",
            kind.bin_name(),
            args.join(" ")
        )),
    }
}

/// Validates a settings-provided binary path: no leading dash, no control
/// chars.
pub fn validate_bin_override(s: &str) -> Result<(), String> {
    if is_valid_value(s) {
        Ok(())
    } else {
        Err(format!("invalid bin_override: {s}"))
    }
}

/// Well-known install locations probed after PATH (a packaged app inherits a
/// minimal PATH from launchd / the desktop session).
fn well_known_paths(kind: BackendKind) -> Vec<PathBuf> {
    let mut paths = well_known_candidates(kind.bin_name(), kind == BackendKind::Jucode);
    if kind == BackendKind::Claude {
        let exe = exe_name("claude");
        let home = home_dir();
        // Claude Code's native installer keeps a launcher here too.
        paths.push(home.join(".claude").join("local").join(&exe));
    }
    paths
}

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub(crate) fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// Well-known install dirs for an arbitrary program name (shared by the fixed
/// backends and the ACP registry's command resolution).
fn well_known_candidates(name: &str, jucode_installer_dir: bool) -> Vec<PathBuf> {
    let exe = exe_name(name);
    let home = home_dir();
    let mut paths: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        if jucode_installer_dir {
            // Per-user installer dir and the npm global prefix.
            if let Some(la) = std::env::var_os("LOCALAPPDATA") {
                paths.push(PathBuf::from(la).join("Programs").join("jucode").join(&exe));
            }
        }
        if let Some(ad) = std::env::var_os("APPDATA") {
            paths.push(PathBuf::from(ad).join("npm").join(&exe));
        }
        paths.push(home.join(".cargo").join("bin").join(&exe));
        paths.push(home.join(".local").join("bin").join(&exe));
    } else {
        paths.push(PathBuf::from("/opt/homebrew/bin").join(&exe)); // macOS (arm64 Homebrew)
        paths.push(PathBuf::from("/usr/local/bin").join(&exe)); // macOS (intel) / Linux
        paths.push(home.join(".cargo/bin").join(&exe));
        paths.push(home.join(".local/bin").join(&exe)); // per-user installs (incl. Claude Code native)
    }
    paths
}

/// Resolves an ACP registry entry's command to a program path. A command with
/// a path separator is used as-is; the engine binaries reuse the full backend
/// resolution (env override → PATH → well-known dirs → dev builds); anything
/// else goes PATH → well-known dirs → bare name (PATH-spawn at run time).
pub fn resolve_acp_program(command: &str) -> PathBuf {
    for kind in [BackendKind::Jucode, BackendKind::Codex, BackendKind::Claude] {
        if command == kind.bin_name() {
            return resolve_backend_bin(kind, None);
        }
    }
    let p = Path::new(command);
    if p.components().count() > 1 || p.is_absolute() {
        return p.to_path_buf();
    }
    if let Some(found) = crate::which(command) {
        return found;
    }
    for candidate in well_known_candidates(command, false) {
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(command)
}

/// Dev fallback for the native engine only: the freshly-built binary from the
/// sibling `JuCode-CLI` checkout (mirrors the pre-multi-backend behavior).
fn jucode_dev_candidates() -> Vec<PathBuf> {
    let exe = if cfg!(windows) {
        "jucode.exe"
    } else {
        "jucode"
    };
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // <repo>/src-tauri
    [
        format!("../../JuCode-CLI/target/debug/{exe}"),
        format!("../../JuCode-CLI/target/release/{exe}"),
        format!("../../target/debug/{exe}"),
        format!("../../target/release/{exe}"),
    ]
    .into_iter()
    .map(|rel| manifest.join(rel))
    .collect()
}

/// Testable core of binary resolution. Order:
/// env override → settings-provided path → PATH → well-known dirs →
/// (jucode only) sibling dev build → bare binary name.
fn resolve_with(
    kind: BackendKind,
    bin_override: Option<&str>,
    env: &dyn Fn(&str) -> Option<String>,
    which_fn: &dyn Fn(&str) -> Option<PathBuf>,
    exists: &dyn Fn(&Path) -> bool,
) -> PathBuf {
    if let Some(p) = env(kind.env_override()).filter(|p| !p.trim().is_empty()) {
        return PathBuf::from(p);
    }
    if let Some(o) = bin_override {
        return PathBuf::from(o);
    }
    if let Some(found) = which_fn(kind.bin_name()) {
        return found;
    }
    for candidate in well_known_paths(kind) {
        if exists(&candidate) {
            return candidate;
        }
    }
    if kind == BackendKind::Jucode {
        for candidate in jucode_dev_candidates() {
            if exists(&candidate) {
                return candidate;
            }
        }
    }
    PathBuf::from(kind.bin_name())
}

/// Resolves the binary for a backend (see `resolve_with` for the order). A
/// release build runs its own jucode unless an override names another.
pub fn resolve_backend_bin(kind: BackendKind, bin_override: Option<&str>) -> PathBuf {
    let overridden = bin_override.is_some()
        || std::env::var(kind.env_override()).is_ok_and(|p| !p.trim().is_empty());
    if kind == BackendKind::Jucode && !overridden {
        if let Some(path) = crate::app_cli::path() {
            return path;
        }
    }
    resolve_with(
        kind,
        bin_override,
        &|k| std::env::var(k).ok(),
        &|c| crate::which(c),
        &|p| p.is_file(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // --- kind parsing ---

    #[test]
    fn parses_known_backends_and_rejects_unknown() {
        assert_eq!(BackendKind::parse("jucode").unwrap(), BackendKind::Jucode);
        assert_eq!(BackendKind::parse("codex").unwrap(), BackendKind::Codex);
        assert_eq!(BackendKind::parse("claude").unwrap(), BackendKind::Claude);
        assert_eq!(BackendKind::parse("acp").unwrap(), BackendKind::Acp);
        assert!(BackendKind::parse("bash").is_err());
        assert!(BackendKind::parse("").is_err());
    }

    #[test]
    fn acp_program_resolution_keeps_explicit_paths_and_reuses_engine_resolution() {
        // A path with separators is used exactly as configured.
        let p = resolve_acp_program("/usr/local/bin/my-agent");
        assert_eq!(p, PathBuf::from("/usr/local/bin/my-agent"));
        // The engine binaries route through the shared backend resolution
        // (worst case they fall back to the bare name, never to an empty path).
        let ju = resolve_acp_program("jucode");
        assert!(!ju.as_os_str().is_empty());
    }

    // --- custom env ---

    #[test]
    fn custom_env_names_are_validated_and_dangerous_prefixes_rejected() {
        let ok = validate_env(
            &json!({ "NODE_EXTRA_CA_CERTS": "/Users/x/.reclaude/ca.pem", "_UNDER": "1" }),
        )
        .unwrap();
        assert_eq!(ok.len(), 2);
        for bad in [
            json!({ "DYLD_INSERT_LIBRARIES": "/evil" }),
            json!({ "LD_PRELOAD": "/evil" }),
            json!({ "1BAD": "x" }),
            json!({ "SP ACE": "x" }),
            json!({ "A": 42 }),
            json!("PATH=/x"),
        ] {
            assert!(validate_env(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn custom_env_is_capped() {
        let mut m = serde_json::Map::new();
        for i in 0..51 {
            m.insert(format!("V{i}"), json!("x"));
        }
        assert!(validate_env(&serde_json::Value::Object(m)).is_err());
    }

    // --- resolution order ---

    fn no_env(_: &str) -> Option<String> {
        None
    }
    fn no_which(_: &str) -> Option<PathBuf> {
        None
    }
    fn nothing_exists(_: &Path) -> bool {
        false
    }

    #[test]
    fn env_override_beats_everything() {
        let p = resolve_with(
            BackendKind::Codex,
            Some("/settings/codex"),
            &|k| (k == "CODEX_BIN").then(|| "/env/codex".to_string()),
            &|_| Some(PathBuf::from("/path/codex")),
            &|_| true,
        );
        assert_eq!(p, PathBuf::from("/env/codex"));
    }

    #[test]
    fn settings_override_beats_path_lookup() {
        let p = resolve_with(
            BackendKind::Claude,
            Some("/settings/claude"),
            &no_env,
            &|_| Some(PathBuf::from("/path/claude")),
            &|_| true,
        );
        assert_eq!(p, PathBuf::from("/settings/claude"));
    }

    #[test]
    fn path_lookup_beats_well_known_dirs() {
        let p = resolve_with(
            BackendKind::Claude,
            None,
            &no_env,
            &|c| {
                assert_eq!(c, "claude");
                Some(PathBuf::from("/usr/bin/claude"))
            },
            &|_| true,
        );
        assert_eq!(p, PathBuf::from("/usr/bin/claude"));
    }

    #[test]
    fn well_known_dirs_are_probed_before_bare_fallback() {
        let hits = std::sync::Mutex::new(Vec::new());
        let p = resolve_with(BackendKind::Claude, None, &no_env, &no_which, &|c| {
            hits.lock().unwrap().push(c.to_path_buf());
            false
        });
        // Nothing found anywhere → bare name (PATH-spawn at run time).
        assert_eq!(p, PathBuf::from("claude"));
        let probed = hits.lock().unwrap();
        assert!(!probed.is_empty());
        assert!(probed
            .iter()
            .any(|c| c.ends_with(".local/bin/claude") || c.ends_with(".local\\bin\\claude.exe")));
    }

    // --- TUI spawn allowlists ---

    #[test]
    fn tui_accepts_empty_args_for_every_backend() {
        for kind in [BackendKind::Jucode, BackendKind::Codex, BackendKind::Claude] {
            assert!(validate_tui_args(kind, &[]).is_ok(), "{kind:?}");
        }
    }

    #[test]
    fn tui_args_are_fixed_tokens_per_backend() {
        assert!(validate_tui_args(BackendKind::Codex, &["resume".into()]).is_ok());
        assert!(validate_tui_args(BackendKind::Claude, &["--continue".into()]).is_ok());
        assert!(validate_tui_args(BackendKind::Claude, &["--resume".into()]).is_ok());
        // Tokens don't leak across backends.
        assert!(validate_tui_args(BackendKind::Jucode, &["resume".into()]).is_err());
        assert!(validate_tui_args(BackendKind::Codex, &["--continue".into()]).is_err());
        assert!(validate_tui_args(BackendKind::Claude, &["resume".into()]).is_err());
    }

    #[test]
    fn tui_resume_accepts_a_validated_session_id() {
        let sid = "0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f";
        assert!(validate_tui_args(BackendKind::Claude, &["--resume".into(), sid.into()]).is_ok());
        assert!(validate_tui_args(BackendKind::Codex, &["resume".into(), sid.into()]).is_ok());
        // The resume-with-id shape doesn't leak across backends, and jucode
        // has no resume argv at all (it resumes via /resume after spawn).
        assert!(validate_tui_args(BackendKind::Claude, &["resume".into(), sid.into()]).is_err());
        assert!(validate_tui_args(BackendKind::Codex, &["--resume".into(), sid.into()]).is_err());
        assert!(validate_tui_args(BackendKind::Jucode, &["resume".into(), sid.into()]).is_err());
        assert!(validate_tui_args(BackendKind::Jucode, &["--resume".into(), sid.into()]).is_err());
        // Only the resume flag takes a value.
        assert!(
            validate_tui_args(BackendKind::Claude, &["--continue".into(), sid.into()]).is_err()
        );
    }

    #[test]
    fn tui_resume_rejects_invalid_ids_and_extra_tokens() {
        let sid = "0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f";
        for bad_id in [
            "--help",
            "-x",
            "a b",
            "../etc/passwd",
            "",
            "a".repeat(65).as_str(),
        ] {
            assert!(
                validate_tui_args(BackendKind::Claude, &["--resume".into(), bad_id.into()])
                    .is_err(),
                "{bad_id:?} must be rejected as a resume id"
            );
            assert!(
                validate_tui_args(BackendKind::Codex, &["resume".into(), bad_id.into()]).is_err(),
                "{bad_id:?} must be rejected as a resume id"
            );
        }
        // No third token, ever.
        assert!(validate_tui_args(
            BackendKind::Claude,
            &["--resume".into(), sid.into(), "-x".into()]
        )
        .is_err());
        assert!(validate_tui_args(
            BackendKind::Claude,
            &["--continue".into(), "--resume".into(), sid.into()]
        )
        .is_err());
    }

    #[test]
    fn tui_rejects_arbitrary_and_dangerous_argv() {
        for bad in [
            "-rf",
            "--dangerously-skip-permissions",
            "--resume=abc",
            "--resume x",
            "; rm -rf ~",
            "serve",
            "app-server",
            "",
        ] {
            assert!(
                validate_tui_args(BackendKind::Claude, &[bad.to_string()]).is_err(),
                "{bad:?} must be rejected"
            );
        }
        // One good token doesn't smuggle a bad one through.
        assert!(
            validate_tui_args(BackendKind::Claude, &["--continue".into(), "-x".into()]).is_err()
        );
    }

    #[test]
    fn tui_rejects_acp_backend() {
        // ACP command lines come from the registry, not a fixed binary, so
        // an ACP entry can never be spawned through the TUI pty path.
        assert!(validate_tui_args(BackendKind::Acp, &[]).is_err());
        assert!(validate_tui_args(BackendKind::Acp, &["resume".into()]).is_err());
    }

    #[test]
    fn tui_bin_override_rejects_flag_like_and_control_values() {
        assert!(validate_bin_override("/usr/local/bin/claude").is_ok());
        assert!(validate_bin_override("-rf").is_err());
        assert!(validate_bin_override("a\u{7}b").is_err());
        assert!(validate_bin_override("").is_err());
    }

    #[test]
    fn jucode_probes_dev_build_before_bare_fallback() {
        let p = resolve_with(BackendKind::Jucode, None, &no_env, &no_which, &|c| {
            c.to_string_lossy().contains("JuCode-CLI/target/debug")
        });
        assert!(p.to_string_lossy().contains("JuCode-CLI/target/debug"));
        let none = resolve_with(
            BackendKind::Jucode,
            None,
            &no_env,
            &no_which,
            &nothing_exists,
        );
        assert_eq!(none, PathBuf::from("jucode"));
    }
}
