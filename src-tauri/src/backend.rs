//! Multi-backend engine support: which agent CLI a session runs, how its
//! binary is resolved and which argv it is started with.
//!
//! Safety model: the frontend never passes argv. It passes a `backend` name
//! plus a small `backend_opts` JSON object that is validated here against a
//! FIXED per-backend allowlist; every option value becomes a single argv
//! entry (never shell-interpreted, never split), so option values containing
//! spaces or dashes cannot smuggle extra flags.

use std::path::{Path, PathBuf};

/// The agent engines the desktop can drive.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BackendKind {
    /// Native engine (`jucode serve`), the default — full protocol support.
    Jucode,
    /// OpenAI Codex CLI in stdio JSON-RPC server mode (`codex app-server`).
    Codex,
    /// Claude Code CLI in stream-json print mode.
    Claude,
}

impl BackendKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "jucode" => Ok(Self::Jucode),
            "codex" => Ok(Self::Codex),
            "claude" => Ok(Self::Claude),
            other => Err(format!("unknown backend: {other}")),
        }
    }

    /// Binary base name (without the Windows `.exe` suffix).
    pub fn bin_name(self) -> &'static str {
        match self {
            Self::Jucode => "jucode",
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }

    /// Environment variable that force-overrides binary resolution.
    pub fn env_override(self) -> &'static str {
        match self {
            Self::Jucode => "JUCODE_BIN",
            Self::Codex => "CODEX_BIN",
            Self::Claude => "CLAUDE_BIN",
        }
    }

    /// `backend_opts` keys accepted for this backend. Anything else is rejected.
    fn allowed_opts(self) -> &'static [&'static str] {
        match self {
            Self::Jucode => &["bin_override", "use_shell_env", "env"],
            // Codex app-server takes per-conversation config over JSON-RPC,
            // not argv — only the binary path is configurable at spawn time.
            Self::Codex => &["bin_override", "use_shell_env", "env"],
            Self::Claude => &[
                "bin_override",
                "permission_mode",
                "resume",
                "session_id",
                "model",
                "use_shell_env",
                "env",
            ],
        }
    }
}

/// Validated spawn options (a strict subset of keys per backend).
#[derive(Debug, PartialEq)]
pub struct BackendOpts {
    /// Explicit binary path from the desktop settings (below the env override
    /// in precedence, above PATH).
    pub bin_override: Option<String>,
    /// claude: `--permission-mode <mode>` (fixed enum).
    pub permission_mode: Option<String>,
    /// claude: `--resume <session-id>`.
    pub resume: Option<String>,
    /// claude: `--session-id <uuid>` (mutually exclusive with `resume`).
    pub session_id: Option<String>,
    /// claude: `--model <name>`.
    pub model: Option<String>,
    /// Build the child env from the login-shell snapshot (default true; see
    /// `shell_env`). Off = inherit the GUI environment as before.
    pub use_shell_env: bool,
    /// Per-backend user-defined env vars, applied after the snapshot.
    pub env: Vec<(String, String)>,
}

impl Default for BackendOpts {
    fn default() -> Self {
        Self {
            bin_override: None,
            permission_mode: None,
            resume: None,
            session_id: None,
            model: None,
            use_shell_env: true,
            env: Vec::new(),
        }
    }
}

/// Custom env var names: POSIX-style identifiers only, with dangerous
/// dynamic-linker prefixes rejected outright.
fn is_valid_env_name(name: &str) -> bool {
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

const MAX_CUSTOM_ENV_VARS: usize = 50;
const MAX_CUSTOM_ENV_VALUE_LEN: usize = 4096;

/// Claude Code permission modes the desktop is allowed to request.
const CLAUDE_PERMISSION_MODES: &[&str] = &["default", "plan", "acceptEdits", "bypassPermissions"];

fn expect_string(key: &str, v: &serde_json::Value) -> Result<String, String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("backend option {key} must be a non-empty string"))
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

/// Validates `backend_opts` against the backend's fixed option set. Unknown
/// keys, non-string values and malformed values are all rejected; `None` /
/// `null` means "no options".
pub fn validate_opts(
    kind: BackendKind,
    raw: Option<&serde_json::Value>,
) -> Result<BackendOpts, String> {
    let mut opts = BackendOpts::default();
    let Some(raw) = raw else { return Ok(opts) };
    if raw.is_null() {
        return Ok(opts);
    }
    let map = raw
        .as_object()
        .ok_or_else(|| "backend_opts must be an object".to_string())?;
    for (key, value) in map {
        if !kind.allowed_opts().contains(&key.as_str()) {
            return Err(format!(
                "backend option not allowed for {}: {key}",
                kind.bin_name()
            ));
        }
        // Non-string options first.
        match key.as_str() {
            "use_shell_env" => {
                opts.use_shell_env = value
                    .as_bool()
                    .ok_or_else(|| "use_shell_env must be a boolean".to_string())?;
                continue;
            }
            "env" => {
                let obj = value
                    .as_object()
                    .ok_or_else(|| "env must be an object of string values".to_string())?;
                if obj.len() > MAX_CUSTOM_ENV_VARS {
                    return Err(format!("env accepts at most {MAX_CUSTOM_ENV_VARS} variables"));
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
                opts.env = vars;
                continue;
            }
            _ => {}
        }
        let s = expect_string(key, value)?;
        match key.as_str() {
            "bin_override" => {
                if !is_valid_value(&s) {
                    return Err(format!("invalid bin_override: {s}"));
                }
                opts.bin_override = Some(s);
            }
            "permission_mode" => {
                if !CLAUDE_PERMISSION_MODES.contains(&s.as_str()) {
                    return Err(format!("invalid permission_mode: {s}"));
                }
                opts.permission_mode = Some(s);
            }
            "resume" => {
                if !is_valid_session_id(&s) {
                    return Err(format!("invalid resume session id: {s}"));
                }
                opts.resume = Some(s);
            }
            "session_id" => {
                if !is_valid_session_id(&s) {
                    return Err(format!("invalid session id: {s}"));
                }
                opts.session_id = Some(s);
            }
            "model" => {
                if !is_valid_value(&s) {
                    return Err(format!("invalid model: {s}"));
                }
                opts.model = Some(s);
            }
            _ => unreachable!("key was checked against the allowlist"),
        }
    }
    if opts.resume.is_some() && opts.session_id.is_some() {
        return Err("resume and session_id are mutually exclusive".to_string());
    }
    Ok(opts)
}

/// Fixed argv template per backend, extended only by validated option values —
/// each value is one argv entry, exactly as validated.
pub fn build_args(kind: BackendKind, opts: &BackendOpts) -> Vec<String> {
    match kind {
        BackendKind::Jucode => vec!["serve".to_string()],
        BackendKind::Codex => vec!["app-server".to_string()],
        BackendKind::Claude => {
            let mut args: Vec<String> = [
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--verbose",
                "--replay-user-messages",
                // Route interactive permission prompts over stdio as
                // `control_request` frames (subtype can_use_tool). Verified
                // against claude 2.1.208: without this flag the CLI silently
                // auto-denies gated tools in --print mode instead of asking.
                "--permission-prompt-tool",
                "stdio",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect();
            if let Some(mode) = &opts.permission_mode {
                args.push("--permission-mode".to_string());
                args.push(mode.clone());
            }
            if let Some(sid) = &opts.resume {
                args.push("--resume".to_string());
                args.push(sid.clone());
            }
            if let Some(sid) = &opts.session_id {
                args.push("--session-id".to_string());
                args.push(sid.clone());
            }
            if let Some(model) = &opts.model {
                args.push("--model".to_string());
                args.push(model.clone());
            }
            args
        }
    }
}

/// Well-known install locations probed after PATH (a packaged app inherits a
/// minimal PATH from launchd / the desktop session).
fn well_known_paths(kind: BackendKind) -> Vec<PathBuf> {
    let name = kind.bin_name();
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut paths: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        if kind == BackendKind::Jucode {
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
    if kind == BackendKind::Claude {
        // Claude Code's native installer keeps a launcher here too.
        paths.push(home.join(".claude").join("local").join(&exe));
    }
    paths
}

/// Dev fallback for the native engine only: the freshly-built binary from the
/// sibling `JuCode-CLI` checkout (mirrors the pre-multi-backend behavior).
fn jucode_dev_candidates() -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "jucode.exe" } else { "jucode" };
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

/// Resolves the binary for a backend (see `resolve_with` for the order).
pub fn resolve_backend_bin(kind: BackendKind, bin_override: Option<&str>) -> PathBuf {
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
        assert!(BackendKind::parse("bash").is_err());
        assert!(BackendKind::parse("").is_err());
    }

    // --- arg templates ---

    #[test]
    fn jucode_and_codex_have_fixed_templates() {
        assert_eq!(
            build_args(BackendKind::Jucode, &BackendOpts::default()),
            vec!["serve"]
        );
        assert_eq!(
            build_args(BackendKind::Codex, &BackendOpts::default()),
            vec!["app-server"]
        );
    }

    #[test]
    fn claude_base_template_is_fixed() {
        let args = build_args(BackendKind::Claude, &BackendOpts::default());
        assert_eq!(
            args,
            vec![
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--verbose",
                "--replay-user-messages",
                "--permission-prompt-tool",
                "stdio",
            ]
        );
    }

    #[test]
    fn claude_options_map_to_flag_value_pairs() {
        let opts = validate_opts(
            BackendKind::Claude,
            Some(&json!({
                "permission_mode": "acceptEdits",
                "resume": "0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f",
                "model": "claude-sonnet-4-5"
            })),
        )
        .unwrap();
        let args = build_args(BackendKind::Claude, &opts);
        let tail = &args[args.len() - 6..];
        assert_eq!(
            tail,
            [
                "--permission-mode",
                "acceptEdits",
                "--resume",
                "0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f",
                "--model",
                "claude-sonnet-4-5",
            ]
        );
    }

    #[test]
    fn option_values_with_spaces_or_dashes_stay_single_argv_entries() {
        // A model name containing spaces and inner dashes must arrive as ONE
        // argv entry — never split, never re-interpreted as flags.
        let opts = validate_opts(
            BackendKind::Claude,
            Some(&json!({ "model": "sonnet 4.5 --latest" })),
        )
        .unwrap();
        let args = build_args(BackendKind::Claude, &opts);
        let i = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(args[i + 1], "sonnet 4.5 --latest");
        assert_eq!(args.iter().filter(|a| a.contains("--latest")).count(), 1);
    }

    // --- option validation ---

    #[test]
    fn unknown_keys_are_rejected_per_backend() {
        // jucode / codex don't take claude's options.
        for kind in [BackendKind::Jucode, BackendKind::Codex] {
            let err = validate_opts(kind, Some(&json!({ "permission_mode": "plan" })));
            assert!(err.is_err(), "{kind:?} must reject permission_mode");
        }
        assert!(validate_opts(BackendKind::Claude, Some(&json!({ "argv": ["-x"] }))).is_err());
        assert!(validate_opts(BackendKind::Claude, Some(&json!({ "extra_flag": "--yolo" }))).is_err());
    }

    #[test]
    fn values_starting_with_a_dash_are_rejected() {
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "model": "--dangerously-skip-permissions" }))
        )
        .is_err());
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "resume": "--help" }))
        )
        .is_err());
        assert!(validate_opts(
            BackendKind::Jucode,
            Some(&json!({ "bin_override": "-rf" }))
        )
        .is_err());
    }

    #[test]
    fn permission_mode_is_a_fixed_enum() {
        for ok in CLAUDE_PERMISSION_MODES {
            assert!(validate_opts(BackendKind::Claude, Some(&json!({ "permission_mode": ok }))).is_ok());
        }
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "permission_mode": "bypassPermissions --verbose" }))
        )
        .is_err());
        assert!(
            validate_opts(BackendKind::Claude, Some(&json!({ "permission_mode": "yolo" }))).is_err()
        );
    }

    #[test]
    fn session_ids_must_be_uuid_like() {
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "session_id": "0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f" }))
        )
        .is_ok());
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "session_id": "abc def" }))
        )
        .is_err());
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "resume": "../etc/passwd" }))
        )
        .is_err());
    }

    #[test]
    fn resume_and_session_id_are_mutually_exclusive() {
        assert!(validate_opts(
            BackendKind::Claude,
            Some(&json!({ "resume": "aaa", "session_id": "bbb" }))
        )
        .is_err());
    }

    #[test]
    fn non_string_and_empty_values_are_rejected() {
        assert!(validate_opts(BackendKind::Claude, Some(&json!({ "model": 42 }))).is_err());
        assert!(validate_opts(BackendKind::Claude, Some(&json!({ "model": "" }))).is_err());
        assert!(validate_opts(BackendKind::Claude, Some(&json!({ "model": null }))).is_err());
        assert!(validate_opts(BackendKind::Claude, Some(&json!("serve"))).is_err());
    }

    #[test]
    fn null_or_missing_opts_mean_defaults() {
        assert_eq!(validate_opts(BackendKind::Jucode, None).unwrap(), BackendOpts::default());
        assert_eq!(
            validate_opts(BackendKind::Codex, Some(&serde_json::Value::Null)).unwrap(),
            BackendOpts::default()
        );
        assert_eq!(
            validate_opts(BackendKind::Claude, Some(&json!({}))).unwrap(),
            BackendOpts::default()
        );
    }

    // --- shell-env / custom-env options ---

    #[test]
    fn use_shell_env_defaults_true_and_accepts_bool_only() {
        for kind in [BackendKind::Jucode, BackendKind::Codex, BackendKind::Claude] {
            assert!(validate_opts(kind, None).unwrap().use_shell_env);
            assert!(!validate_opts(kind, Some(&json!({ "use_shell_env": false })))
                .unwrap()
                .use_shell_env);
        }
        assert!(validate_opts(BackendKind::Jucode, Some(&json!({ "use_shell_env": "yes" }))).is_err());
    }

    #[test]
    fn custom_env_names_are_validated_and_dangerous_prefixes_rejected() {
        let ok = validate_opts(
            BackendKind::Claude,
            Some(&json!({ "env": { "NODE_EXTRA_CA_CERTS": "/Users/x/.reclaude/ca.pem", "_UNDER": "1" } })),
        )
        .unwrap();
        assert_eq!(ok.env.len(), 2);
        for bad in [
            json!({ "env": { "DYLD_INSERT_LIBRARIES": "/evil" } }),
            json!({ "env": { "LD_PRELOAD": "/evil" } }),
            json!({ "env": { "1BAD": "x" } }),
            json!({ "env": { "SP ACE": "x" } }),
            json!({ "env": { "A": 42 } }),
            json!({ "env": "PATH=/x" }),
        ] {
            assert!(validate_opts(BackendKind::Claude, Some(&bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn custom_env_is_capped() {
        let mut m = serde_json::Map::new();
        for i in 0..51 {
            m.insert(format!("V{i}"), json!("x"));
        }
        assert!(validate_opts(BackendKind::Jucode, Some(&json!({ "env": m }))).is_err());
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
        assert!(probed.iter().any(|c| c.ends_with(".local/bin/claude") || c.ends_with(".local\\bin\\claude.exe")));
    }

    #[test]
    fn jucode_probes_dev_build_before_bare_fallback() {
        let p = resolve_with(BackendKind::Jucode, None, &no_env, &no_which, &|c| {
            c.to_string_lossy().contains("JuCode-CLI/target/debug")
        });
        assert!(p.to_string_lossy().contains("JuCode-CLI/target/debug"));
        let none = resolve_with(BackendKind::Jucode, None, &no_env, &no_which, &nothing_exists);
        assert_eq!(none, PathBuf::from("jucode"));
    }
}
