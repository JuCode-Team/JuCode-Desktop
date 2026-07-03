use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

mod browser;
mod capture;

/// One `jucode serve` child process backing a single GUI session.
struct Session {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
}

/// All live sessions, keyed by the frontend-generated session id.
#[derive(Default)]
struct Engines {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

/// Stdout line tagged with the session it came from.
#[derive(Clone, Serialize)]
struct EventPayload {
    session: String,
    data: String,
}

/// Resolves the `jucode` binary: `JUCODE_BIN` override, then the system-installed
/// CLI on PATH, then a sibling `JuCode-CLI` checkout / in-tree build (dev
/// convenience). The desktop app no longer bundles the engine — it drives
/// whatever `jucode` the user has installed.
fn resolve_bin() -> PathBuf {
    if let Ok(path) = std::env::var("JUCODE_BIN") {
        return PathBuf::from(path);
    }
    // System install (PATH). A packaged .app inherits a minimal PATH from
    // launchd, so also probe the usual install locations directly.
    if let Some(found) = which("jucode") {
        return found;
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let well_known = [
        PathBuf::from("/opt/homebrew/bin/jucode"),
        PathBuf::from("/usr/local/bin/jucode"),
        home.join(".cargo/bin/jucode"),
        home.join(".local/bin/jucode"),
    ];
    for candidate in well_known {
        if candidate.is_file() {
            return candidate;
        }
    }
    // Dev fallback: the freshly-built engine from the sibling checkout.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // <repo>/src-tauri
    let candidates = [
        "../../JuCode-CLI/target/debug/jucode",
        "../../JuCode-CLI/target/release/jucode",
        "../../target/debug/jucode",
        "../../target/release/jucode",
    ];
    for rel in candidates {
        let candidate = manifest.join(rel);
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("jucode")
}

/// Working directory the agent operates in. `JUCODE_CWD` override, else the
/// directory the app was launched from.
fn resolve_cwd() -> PathBuf {
    if let Ok(path) = std::env::var("JUCODE_CWD") {
        return PathBuf::from(path);
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Confines a requested filesystem `path` to `root` (or the project root when no
/// override is given). Canonicalizes both and rejects anything that resolves
/// outside the root — defeating `../` traversal and symlink escapes. Returns the
/// canonical path on success.
fn confine_to_root(path: &Path, root: Option<&Path>) -> Result<PathBuf, String> {
    let base = root.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let canon_root = base
        .canonicalize()
        .map_err(|e| format!("failed to resolve project root: {e}"))?;
    let canon_path = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))?;
    if canon_path.starts_with(&canon_root) {
        Ok(canon_path)
    } else {
        Err("path is outside the project root".to_string())
    }
}

/// Spawns a new engine process for `session`. The frontend generates the id and
/// registers its event listener before calling this, so no startup event is lost.
#[tauri::command]
fn create_session(
    session: String,
    cwd: Option<String>,
    app: AppHandle,
    engines: tauri::State<Engines>,
) -> Result<(), String> {
    let dir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(resolve_cwd);
    let mut child = Command::new(resolve_bin())
        .arg("serve")
        // Lets the engine enable desktop-only tools (e.g. browser_open).
        .env("JUCODE_DESKTOP", "1")
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to start jucode serve: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture child stdout".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture child stdin".to_string())?;

    let id = session.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    let _ = handle.emit(
                        "agent-event",
                        EventPayload {
                            session: id.clone(),
                            data: line,
                        },
                    );
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = handle.emit("agent-exit", id.clone());
    });

    engines
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .insert(
            session,
            Arc::new(Session {
                stdin: Mutex::new(stdin),
                child: Mutex::new(child),
            }),
        );
    Ok(())
}

#[tauri::command]
fn send_op(
    session: String,
    op: serde_json::Value,
    engines: tauri::State<Engines>,
) -> Result<(), String> {
    let target = engines
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .get(&session)
        .cloned()
        .ok_or_else(|| format!("unknown session: {session}"))?;
    let line = serde_json::to_string(&op).map_err(|error| error.to_string())?;
    let mut stdin = target.stdin.lock().map_err(|error| error.to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| error.to_string())
}

fn jucode_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    PathBuf::from(home.unwrap_or_default()).join(".jucode")
}

fn read_json(path: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Like `read_json`, but for read-modify-write callers: a missing/empty file is a
/// fresh `{}`, while a present-but-unparseable file is an error. This stops a
/// corrupt config/auth file from being silently overwritten (which would drop the
/// other providers' keys still in it).
fn read_json_strict(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(serde_json::json!({})),
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("{} 解析失败，已中止写入以免覆盖现有内容：{e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("读取 {} 失败：{e}", path.display())),
    }
}

fn write_json(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_config() -> serde_json::Value {
    read_json(&jucode_dir().join("config.json"))
}

/// Shallow-merges `patch`'s top-level keys into config.json. Applies to newly
/// created sessions (the engine reads config at startup).
#[tauri::command]
fn write_config(patch: serde_json::Value) -> Result<(), String> {
    let path = jucode_dir().join("config.json");
    let mut current = read_json_strict(&path)?;
    if let (Some(cur), Some(p)) = (current.as_object_mut(), patch.as_object()) {
        for (key, value) in p {
            cur.insert(key.clone(), value.clone());
        }
    }
    write_json(&path, &current)
}

/// Returns the provider names the user is authenticated with. JuCode is now
/// an OAuth login (tokens live in the top-level `jucode` block, not the
/// `providers` map), so it's reported as "jucode" whenever a refresh token
/// is present.
#[tauri::command]
fn read_auth_providers() -> Vec<String> {
    let auth = read_json(&jucode_dir().join("auth.json"));
    let mut providers: Vec<String> = auth
        .get("providers")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    let logged_in = auth
        .get("jucode")
        .and_then(|j| j.get("refresh_token"))
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if logged_in && !providers.iter().any(|p| p == "jucode") {
        providers.push("jucode".to_string());
    }
    providers
}

#[tauri::command]
fn set_auth_key(provider: String, key: String) -> Result<(), String> {
    let path = jucode_dir().join("auth.json");
    let mut current = read_json_strict(&path)?;
    let root = current
        .as_object_mut()
        .ok_or_else(|| "auth.json is not an object".to_string())?;
    let providers = root
        .entry("providers")
        .or_insert_with(|| serde_json::json!({}));
    if let Some(map) = providers.as_object_mut() {
        map.insert(provider, serde_json::Value::String(key));
    }
    write_json(&path, &current)
}

/// Removes a provider's stored credential — logout (jucode) / clear key (others).
/// For jucode this clears the OAuth token block; the device authorization
/// itself can be revoked from the web console's 授权设备 page.
#[tauri::command]
fn remove_auth_key(provider: String) -> Result<(), String> {
    let path = jucode_dir().join("auth.json");
    let mut current = read_json_strict(&path)?;
    if provider == "jucode" {
        if let Some(root) = current.as_object_mut() {
            root.remove("jucode");
        }
    }
    if let Some(map) = current
        .get_mut("providers")
        .and_then(|v| v.as_object_mut())
    {
        map.remove(&provider);
    }
    write_json(&path, &current)
}

const DEFAULT_API_URL: &str = "https://api.jucode.cn";

fn jucode_api_url() -> String {
    read_json(&jucode_dir().join("config.json"))
        .get("jucode_api_url")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_API_URL)
        .trim_end_matches('/')
        .to_string()
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Returns a valid JuCode access token, transparently refreshing (and
/// rewriting auth.json) via the rotating refresh token when the stored
/// access token is missing or near expiry. The CLI engine owns login; this
/// only keeps the Desktop's own API calls authenticated between logins.
fn jucode_access_token() -> Result<String, String> {
    let path = jucode_dir().join("auth.json");
    let auth = read_json(&path);
    let jucode = auth.get("jucode").cloned().unwrap_or_else(|| serde_json::json!({}));
    let access = jucode
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let refresh = jucode
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let access_exp = jucode.get("access_expires_at").and_then(|v| v.as_u64()).unwrap_or(0);
    if refresh.is_empty() {
        return Err("not logged in to JuCode".to_string());
    }
    let now = unix_now();
    if !access.is_empty() && access_exp > now + 120 {
        return Ok(access);
    }
    // Serialize the read-modify-write of auth.json so two concurrent refreshes
    // can't clobber each other's rotated refresh token.
    static REFRESH_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    let _guard = REFRESH_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    // Re-read after acquiring the lock: another thread may have just refreshed.
    let fresh = read_json(&path);
    let fresh_jucode = fresh.get("jucode").cloned().unwrap_or_else(|| serde_json::json!({}));
    let fresh_access = fresh_jucode
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let fresh_exp = fresh_jucode
        .get("access_expires_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if !fresh_access.is_empty() && fresh_exp > now + 120 {
        return Ok(fresh_access);
    }
    let refresh = fresh_jucode
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(refresh);
    let api_url = jucode_api_url();
    // The token endpoint carries the refresh token; refuse to send it over cleartext.
    if !api_url.starts_with("https://") {
        return Err("refusing to refresh JuCode token over non-https endpoint".to_string());
    }
    let url = format!("{}/v1/oauth/token", api_url);
    let resp: serde_json::Value = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send_json(serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": "jucode-cli",
            "refresh_token": refresh,
        }))
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    let new_access = resp.get("access_token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let new_refresh = resp.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if new_access.is_empty() || new_refresh.is_empty() {
        return Err("JuCode session expired; please sign in again".to_string());
    }
    let expires_in = resp.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600);
    let refresh_expires_in = resp
        .get("refresh_expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(90 * 24 * 3600);
    let mut current = read_json(&path);
    if let Some(root) = current.as_object_mut() {
        root.insert(
            "jucode".to_string(),
            serde_json::json!({
                "access_token": new_access,
                "refresh_token": new_refresh,
                "access_expires_at": now + expires_in,
                "refresh_expires_at": now + refresh_expires_in,
            }),
        );
    }
    let _ = write_json(&path, &current);
    Ok(new_access)
}

fn jucode_get(path: &str) -> Result<serde_json::Value, String> {
    let token = jucode_access_token()?;
    let url = format!("{}{}", jucode_api_url(), path);
    ureq::get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|e| e.to_string())?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

/// Fetches the JuCode skills marketplace. The endpoint is public; the access
/// token (when present) is sent best-effort without forcing a refresh.
#[tauri::command(async)]
fn fetch_marketplace() -> Result<serde_json::Value, String> {
    let url = format!("{}/v1/skills/marketplace", jucode_api_url());
    let key = read_json(&jucode_dir().join("auth.json"))
        .get("jucode")
        .and_then(|j| j.get("access_token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(30));
    if let Some(k) = key.filter(|k| !k.trim().is_empty()) {
        req = req.set("Authorization", &format!("Bearer {k}"));
    }
    req.call()
        .map_err(|e| e.to_string())?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

/// Account overview (profile + balance + active plan) for the GUI.
#[tauri::command(async)]
fn fetch_account_info() -> Result<serde_json::Value, String> {
    jucode_get("/v1/oauth/userinfo")
}

/// Plan quota usage (5h / weekly / monthly used vs cap).
#[tauri::command(async)]
fn fetch_usage() -> Result<serde_json::Value, String> {
    jucode_get("/v1/oauth/usage")
}

/// Recent call details (调用详情).
#[tauri::command(async)]
fn fetch_usage_logs() -> Result<serde_json::Value, String> {
    jucode_get("/v1/oauth/usage-logs?limit=10")
}

/// DeepSeek account balance (https://api.deepseek.com/user/balance), using the
/// API key stored under providers.deepseek in auth.json.
#[tauri::command(async)]
fn fetch_deepseek_balance() -> Result<serde_json::Value, String> {
    let key = read_json(&jucode_dir().join("auth.json"))
        .get("providers")
        .and_then(|p| p.get("deepseek"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "未配置 DeepSeek API key".to_string())?;
    ureq::get("https://api.deepseek.com/user/balance")
        .timeout(std::time::Duration::from_secs(30))
        .set("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(|e| e.to_string())?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

/// 语音转写：调用小米 MiMo ASR（OpenAI 兼容 chat/completions 端点，模型
/// mimo-v2.5-asr），API key 存于 auth.json 的 providers.mimo。音频为 base64
/// 编码的 WAV/MP3（编码后 ≤10MB），返回转写文本。
#[tauri::command(async)]
fn transcribe_audio(
    audio_base64: String,
    mime: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let key = read_json(&jucode_dir().join("auth.json"))
        .get("providers")
        .and_then(|p| p.get("mimo"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "未配置 MiMo API key（设置 → 账户 → 语音识别）".to_string())?;
    let mime = mime.unwrap_or_else(|| "audio/wav".to_string());
    let language = language.unwrap_or_else(|| "auto".to_string());
    let body = serde_json::json!({
        "model": "mimo-v2.5-asr",
        "messages": [{
            "role": "user",
            "content": [{
                "type": "input_audio",
                "input_audio": { "data": format!("data:{mime};base64,{audio_base64}") }
            }]
        }],
        "asr_options": { "language": language }
    });
    let resp = ureq::post("https://api.xiaomimimo.com/v1/chat/completions")
        .timeout(std::time::Duration::from_secs(120))
        .set("api-key", &key)
        .send_json(body)
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => format!(
                "MiMo ASR 请求失败（HTTP {code}）：{}",
                r.into_string().unwrap_or_default()
            ),
            other => other.to_string(),
        })?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())?;
    resp.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("无法解析转写结果：{resp}"))
}

#[tauri::command]
fn close_session(session: String, engines: tauri::State<Engines>) -> Result<(), String> {
    let removed = engines
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .remove(&session);
    if let Some(target) = removed {
        if let Ok(mut child) = target.child.lock() {
            let _ = child.kill();
            // Reap the process so it doesn't linger as a zombie.
            let _ = child.wait();
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// IDE features (file manager / git / terminal), backed by the Tauri layer
// operating directly on the project working directory — independent of the
// jucode agent engine.
// ---------------------------------------------------------------------------

const MAX_TEXT_READ: u64 = 2_000_000;

#[tauri::command]
fn project_root() -> String {
    resolve_cwd().display().to_string()
}

/// Scans PATH for an executable named `cmd`, returning its full path.
pub(crate) fn which(cmd: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(cmd);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{cmd}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

#[derive(Serialize)]
struct DepStatus {
    present: bool,
    detail: String,
}

#[derive(Serialize)]
struct EnvReport {
    os: String,
    arch: String,
    git: DepStatus,
    engine: DepStatus,
}

/// First-run environment check: is `git` available, and can the `jucode` engine
/// binary be resolved? Drives the setup wizard.
#[tauri::command(async)]
fn check_environment() -> EnvReport {
    let git = match Command::new("git").arg("--version").output() {
        Ok(out) if out.status.success() => DepStatus {
            present: true,
            detail: String::from_utf8_lossy(&out.stdout).trim().to_string(),
        },
        _ => DepStatus {
            present: false,
            detail: String::new(),
        },
    };

    let bin = resolve_bin();
    // resolve_bin() returns a bare "jucode" as its last fallback; treat that as a
    // PATH lookup rather than a relative-to-cwd path.
    let engine_path = if bin.components().count() == 1 {
        which(&bin.to_string_lossy())
    } else if bin.exists() {
        Some(bin)
    } else {
        None
    };
    let engine = DepStatus {
        present: engine_path.is_some(),
        detail: engine_path.map(|p| p.display().to_string()).unwrap_or_default(),
    };

    EnvReport {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        git,
        engine,
    }
}

/// Best-effort dependency install. On macOS this triggers Apple's Command Line
/// Tools installer (which provides git) via a native dialog — no sudo, returns
/// immediately. Other platforms are guided (the UI shows a copyable command), so
/// this returns an error there.
#[tauri::command(async)]
fn install_dependency(name: String) -> Result<String, String> {
    if name != "git" {
        return Err(format!("unsupported dependency: {name}"));
    }
    if std::env::consts::OS != "macos" {
        return Err("auto-install is only supported on macOS".to_string());
    }
    // Exit code 1 means "already installed" — not a failure for our purposes.
    Command::new("xcode-select")
        .arg("--install")
        .output()
        .map_err(|e| e.to_string())?;
    Ok("已触发 macOS 命令行工具安装。请在弹出的系统对话框中点「安装」完成，然后点「重新检查」。".to_string())
}

#[derive(Serialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Lists a directory (defaults to the project root), directories first.
#[tauri::command]
fn list_dir(path: Option<String>) -> Result<Vec<FsEntry>, String> {
    let requested = path.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let dir = confine_to_root(&requested, None)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".gitignore" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(FsEntry {
            name,
            path: entry.path().display().to_string(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Built-in providers (id + default base_url) from the engine, for the settings picker.
#[tauri::command(async)]
fn list_providers() -> Result<serde_json::Value, String> {
    let out = Command::new(resolve_bin())
        .arg("providers")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

/// Flat list of project files (relative paths) for @-mention completion. Walks the
/// filesystem directly — no git dependency — so non-git directories and untracked /
/// gitignored files are all referenceable; only heavy dependency/build/cache dirs
/// are pruned by name (see SKIP_DIRS), bounded by MAX_LIST_FILES.
#[tauri::command(async)]
fn list_files(cwd: Option<String>) -> Result<Vec<String>, String> {
    let dir = cwd.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let mut files = Vec::new();
    walk_files(&dir, &dir, &mut files);
    files.sort();
    Ok(files)
}

const MAX_LIST_FILES: usize = 20_000;

/// Directory names skipped while walking — heavy dependency/build/cache dirs and
/// tooling metadata (including the `.git` store). Other dotfiles (.env, .github,
/// .gitignore…) are kept so they stay referenceable.
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".svelte-kit",
    ".next",
    ".nuxt",
    ".cache",
    ".gradle",
    ".idea",
    ".vscode",
    ".venv",
    ".turbo",
    ".pytest_cache",
    ".mypy_cache",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    "vendor",
    "venv",
    "__pycache__",
    "Pods",
    "bower_components",
];

fn walk_files(root: &Path, dir: &Path, out: &mut Vec<String>) {
    if out.len() >= MAX_LIST_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let file_type = entry.file_type().ok();
        // Never follow symlinks: a symlink like node_modules -> /etc could escape
        // the project root.
        if file_type.map(|t| t.is_symlink()).unwrap_or(false) {
            continue;
        }
        if file_type.map(|t| t.is_dir()).unwrap_or(false) {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk_files(root, &path, out);
        } else if name != ".DS_Store" {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.display().to_string());
            }
        }
    }
}

/// Writes pasted image bytes to a temp file and returns its path, so the composer
/// can attach it the same way as a dragged/picked file (the protocol only accepts
/// local paths, not inline data).
#[tauri::command]
fn save_temp_image(data: Vec<u8>, ext: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("jucode-paste");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Best-effort: drop paste images older than a day so this temp dir doesn't
    // grow without bound across sessions.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let now = std::time::SystemTime::now();
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .map(|age| age.as_secs() > 86_400)
                .unwrap_or(false);
            if stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let safe_ext = if !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        ext.to_lowercase()
    } else {
        "png".to_string()
    };
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = dir.join(format!("paste-{stamp}.{safe_ext}"));
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Reads a UTF-8 text file (size-capped). Returns an error for binary/oversized files.
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let safe = confine_to_root(&PathBuf::from(&path), None)?;
    let meta = std::fs::metadata(&safe).map_err(|e| e.to_string())?;
    if meta.len() > MAX_TEXT_READ {
        return Err(format!("file too large to view ({} bytes)", meta.len()));
    }
    let bytes = std::fs::read(&safe).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "not a UTF-8 text file".to_string())
}

/// Subcommands the GUI is allowed to run through the `git` bridge — read-only
/// inspection plus the local staging/commit workflow. Anything that can talk to a
/// remote or run arbitrary programs is intentionally excluded.
const GIT_SUBCOMMANDS: &[&str] = &[
    "status", "log", "diff", "add", "reset", "restore", "commit", "stash", "show",
    "rev-parse", "branch", "checkout", "ls-files",
];

/// Rejects git argument vectors that could be used to run arbitrary code or reach a
/// remote host: the first arg must be a whitelisted subcommand, and no arg may set a
/// config value, an exec path, or an upload/receive-pack override.
fn validate_git_args(args: &[String]) -> Result<(), String> {
    let sub = args
        .first()
        .ok_or_else(|| "no git subcommand given".to_string())?;
    if !GIT_SUBCOMMANDS.contains(&sub.as_str()) {
        return Err(format!("git subcommand not allowed: {sub}"));
    }
    for arg in args {
        if arg == "-c"
            || arg == "--config"
            || arg.starts_with("--upload-pack")
            || arg.starts_with("--receive-pack")
            || arg.starts_with("--exec")
            || arg.starts_with("--upload-pack=")
            || arg.starts_with("--receive-pack=")
            || arg.starts_with("--exec=")
        {
            return Err(format!("git argument not allowed: {arg}"));
        }
    }
    Ok(())
}

/// Runs a git command in the project root and returns stdout (or stderr on failure).
#[tauri::command(async)]
fn git(args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    validate_git_args(&args)?;
    let dir = cwd.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let output = Command::new("git")
        .args(&args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

// --- terminal (real PTY) ---

struct Pty {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    /// Set by `pty_close` to tell the reader thread to stop before the child is killed.
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
struct Ptys {
    map: Mutex<HashMap<String, Arc<Pty>>>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

/// Opens a pseudo-terminal running the user's shell in the project root. Output
/// is streamed to the webview as `pty-output` events tagged with `id`.
#[tauri::command]
fn pty_open(
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    app: AppHandle,
    ptys: tauri::State<Ptys>,
) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let dir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(resolve_cwd);
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(dir);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let stop = Arc::new(AtomicBool::new(false));
    let handle = app.clone();
    let stream_id = id.clone();
    let reader_stop = stop.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if reader_stop.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = handle.emit(
                        "pty-output",
                        PtyOutput {
                            id: stream_id.clone(),
                            data,
                        },
                    );
                }
            }
        }
        let _ = handle.emit("pty-exit", stream_id.clone());
    });

    ptys.map
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .insert(
            id,
            Arc::new(Pty {
                writer: Mutex::new(writer),
                master: Mutex::new(pair.master),
                child: Mutex::new(child),
                stop,
            }),
        );
    Ok(())
}

#[tauri::command]
fn pty_write(id: String, data: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    let pty = ptys
        .map
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .get(&id)
        .cloned();
    let pty = pty.ok_or_else(|| "unknown terminal".to_string())?;
    let mut writer = pty.writer.lock().map_err(|e| format!("lock poisoned: {e}"))?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(id: String, cols: u16, rows: u16, ptys: tauri::State<Ptys>) -> Result<(), String> {
    use portable_pty::PtySize;
    let pty = ptys
        .map
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .get(&id)
        .cloned();
    let pty = pty.ok_or_else(|| "unknown terminal".to_string())?;
    let master = pty.master.lock().map_err(|e| format!("lock poisoned: {e}"))?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_close(id: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    let removed = ptys
        .map
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .remove(&id);
    if let Some(pty) = removed {
        // Stop the reader thread before killing so it doesn't spin on a dead fd.
        pty.stop.store(true, Ordering::Relaxed);
        if let Ok(mut child) = pty.child.lock() {
            let _ = child.kill();
            // Reap the process so it doesn't linger as a zombie.
            let _ = child.wait();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Engines::default())
        .manage(Ptys::default())
        .manage(capture::Recorder::default())
        .invoke_handler(tauri::generate_handler![
            create_session,
            send_op,
            close_session,
            read_config,
            write_config,
            read_auth_providers,
            set_auth_key,
            remove_auth_key,
            fetch_marketplace,
            fetch_account_info,
            fetch_usage,
            fetch_usage_logs,
            fetch_deepseek_balance,
            transcribe_audio,
            project_root,
            list_providers,
            list_dir,
            list_files,
            read_text,
            save_temp_image,
            check_environment,
            install_dependency,
            git,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_set_bounds,
            browser::browser_close,
            browser::browser_pick,
            capture::capture_screenshot,
            capture::start_screen_recording,
            capture::stop_screen_recording,
            capture::process_video
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::read_json_strict;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("jucode-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn missing_file_is_empty_object() {
        let p = tmp("missing.json");
        assert_eq!(read_json_strict(&p).unwrap(), serde_json::json!({}));
    }

    #[test]
    fn empty_file_is_empty_object() {
        let p = tmp("empty.json");
        std::fs::write(&p, "   \n").unwrap();
        assert_eq!(read_json_strict(&p).unwrap(), serde_json::json!({}));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn valid_json_is_parsed() {
        let p = tmp("valid.json");
        std::fs::write(&p, r#"{"providers":{"openai":"k"}}"#).unwrap();
        assert_eq!(
            read_json_strict(&p).unwrap(),
            serde_json::json!({ "providers": { "openai": "k" } })
        );
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupt_file_errors_instead_of_clobbering() {
        let p = tmp("corrupt.json");
        std::fs::write(&p, "{ not valid json").unwrap();
        assert!(read_json_strict(&p).is_err());
        let _ = std::fs::remove_file(&p);
    }
}
