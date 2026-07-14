use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

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
    // On Windows the engine binary carries an .exe suffix.
    let exe = if cfg!(windows) { "jucode.exe" } else { "jucode" };
    if let Ok(path) = std::env::var("JUCODE_BIN") {
        return PathBuf::from(path);
    }
    // System install (PATH). A packaged app inherits a minimal PATH (launchd on
    // macOS, the desktop session elsewhere), so also probe the usual install
    // locations directly.
    if let Some(found) = which("jucode") {
        return found;
    }
    // HOME on unix; USERPROFILE on Windows.
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut well_known: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        // Per-user installer dir and the npm global prefix.
        if let Some(la) = std::env::var_os("LOCALAPPDATA") {
            well_known.push(PathBuf::from(la).join("Programs").join("jucode").join(exe));
        }
        if let Some(ad) = std::env::var_os("APPDATA") {
            well_known.push(PathBuf::from(ad).join("npm").join(exe));
        }
        well_known.push(home.join(".cargo").join("bin").join(exe));
    } else {
        well_known.push(PathBuf::from("/opt/homebrew/bin/jucode")); // macOS (arm64 Homebrew)
        well_known.push(PathBuf::from("/usr/local/bin/jucode")); // macOS (intel) / Linux
        well_known.push(home.join(".cargo/bin/jucode"));
        well_known.push(home.join(".local/bin/jucode")); // Linux per-user installs
    }
    for candidate in well_known {
        if candidate.is_file() {
            return candidate;
        }
    }
    // Dev fallback: the freshly-built engine from the sibling checkout.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // <repo>/src-tauri
    let candidates = [
        format!("../../JuCode-CLI/target/debug/{exe}"),
        format!("../../JuCode-CLI/target/release/{exe}"),
        format!("../../target/debug/{exe}"),
        format!("../../target/release/{exe}"),
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

/// After canonicalization: is `path` inside `root`, or inside `root`'s
/// parallel-task worktree container (`<root-parent>/.jucode-worktrees/<root-name>`)?
/// Task worktrees are deliberate siblings of the repo, so the fallback keeps the
/// files/editor commands usable in worktree projects without opening up
/// arbitrary paths.
fn in_root_or_task_container(canon_path: &Path, canon_root: &Path) -> bool {
    if canon_path.starts_with(canon_root) {
        return true;
    }
    worktree_base_dir(canon_root)
        .and_then(|c| c.canonicalize().map_err(|e| e.to_string()))
        .map(|c| canon_path.starts_with(&c))
        .unwrap_or(false)
}

/// Confines a requested filesystem `path` to `root` (or the project root when no
/// override is given). Canonicalizes both and rejects anything that resolves
/// outside the root — defeating `../` traversal and symlink escapes. Returns the
/// canonical path on success. Without an explicit root, the launch root's
/// parallel-task worktree container is accepted too (see in_root_or_task_container).
fn confine_to_root(path: &Path, root: Option<&Path>) -> Result<PathBuf, String> {
    let explicit = root.is_some();
    let base = root.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let canon_root = base
        .canonicalize()
        .map_err(|e| format!("failed to resolve project root: {e}"))?;
    let canon_path = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))?;
    let ok = if explicit {
        canon_path.starts_with(&canon_root)
    } else {
        in_root_or_task_container(&canon_path, &canon_root)
    };
    if ok {
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

/// How the setup wizard should offer to install git on this machine.
/// kind: "auto" (one-click button works) | "manual-command" (show a copyable
/// command, never run sudo ourselves) | "open-url" (download page only).
#[derive(Serialize, Debug, PartialEq)]
struct InstallAdvice {
    kind: String,
    command: Option<String>,
    url: String,
}

const GIT_URL_WIN: &str = "https://git-scm.com/download/win";
const GIT_URL_LINUX: &str = "https://git-scm.com/download/linux";
const GIT_URL_GENERIC: &str = "https://git-scm.com/downloads";

/// Exact git-install command for the detected Linux package manager. Returned
/// to the UI for copy-paste — we never run sudo from the GUI.
fn linux_git_install_command(has: &dyn Fn(&str) -> bool) -> Option<String> {
    if has("apt-get") {
        Some("sudo apt-get install -y git".to_string())
    } else if has("dnf") {
        Some("sudo dnf install -y git".to_string())
    } else if has("pacman") {
        Some("sudo pacman -S --noconfirm git".to_string())
    } else if has("zypper") {
        Some("sudo zypper install -y git".to_string())
    } else {
        None
    }
}

/// Platform-aware install advice for git (pure; unit tested with a mocked
/// availability probe).
fn git_install_advice(os: &str, has: &dyn Fn(&str) -> bool) -> InstallAdvice {
    match os {
        "macos" => InstallAdvice {
            kind: "auto".to_string(), // xcode-select --install (native dialog)
            command: Some("brew install git".to_string()),
            url: GIT_URL_GENERIC.to_string(),
        },
        "windows" => {
            if has("winget") {
                InstallAdvice {
                    kind: "auto".to_string(),
                    command: Some("winget install --id Git.Git -e --source winget".to_string()),
                    url: GIT_URL_WIN.to_string(),
                }
            } else {
                InstallAdvice {
                    kind: "open-url".to_string(),
                    command: None,
                    url: GIT_URL_WIN.to_string(),
                }
            }
        }
        "linux" => match linux_git_install_command(has) {
            Some(cmd) => InstallAdvice {
                kind: "manual-command".to_string(),
                command: Some(cmd),
                url: GIT_URL_LINUX.to_string(),
            },
            None => InstallAdvice {
                kind: "open-url".to_string(),
                command: None,
                url: GIT_URL_LINUX.to_string(),
            },
        },
        _ => InstallAdvice {
            kind: "open-url".to_string(),
            command: None,
            url: GIT_URL_GENERIC.to_string(),
        },
    }
}

#[derive(Serialize)]
struct EnvReport {
    os: String,
    arch: String,
    git: DepStatus,
    engine: DepStatus,
    /// How to offer a git install on this platform (drives the wizard UI).
    git_install: InstallAdvice,
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
        git_install: git_install_advice(std::env::consts::OS, &|cmd| which(cmd).is_some()),
    }
}

/// What `install_dependency` actually did (or wants the UI to do). Serialized
/// with a `kind` tag so the wizard can render each variant:
/// installed | started-install | manual-command | open-url.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum InstallOutcome {
    Installed { message: String },
    StartedInstall { message: String },
    ManualCommand { command: String, message: String },
    OpenUrl { url: String, message: String },
}

/// Best-effort dependency install.
/// - macOS: triggers Apple's Command Line Tools installer (which provides git)
///   via a native dialog — no sudo, returns immediately (started-install).
/// - Windows: starts `winget install Git.Git` when winget exists
///   (started-install; winget shows its own progress/UAC UI), else asks the UI
///   to open the download page (open-url).
/// - Linux: never runs sudo from the GUI — returns the exact package-manager
///   command for the UI to display copyable (manual-command), or the download
///   page when no known package manager is present (open-url).
#[tauri::command(async)]
fn install_dependency(name: String) -> Result<InstallOutcome, String> {
    if name != "git" {
        return Err(format!("unsupported dependency: {name}"));
    }
    if which("git").is_some() {
        return Ok(InstallOutcome::Installed {
            message: "Git 已安装，点「重新检查」刷新状态。 / Git is already installed — click Re-check to refresh.".to_string(),
        });
    }
    match std::env::consts::OS {
        "macos" => {
            // Exit code 1 means "already installed" — not a failure for our purposes.
            Command::new("xcode-select")
                .arg("--install")
                .output()
                .map_err(|e| e.to_string())?;
            Ok(InstallOutcome::StartedInstall {
                message: "已触发 macOS 命令行工具安装。请在弹出的系统对话框中点「安装」完成，然后点「重新检查」。".to_string(),
            })
        }
        "windows" => {
            if which("winget").is_some() {
                // Long-running; run detached and let the user re-check when done.
                Command::new("winget")
                    .args([
                        "install",
                        "--id",
                        "Git.Git",
                        "-e",
                        "--source",
                        "winget",
                        "--accept-source-agreements",
                        "--accept-package-agreements",
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|e| format!("failed to start winget: {e}"))?;
                Ok(InstallOutcome::StartedInstall {
                    message: "已通过 winget 开始安装 Git（可能弹出授权窗口）。安装完成后点「重新检查」。 / Started installing Git via winget (an elevation prompt may appear). Click Re-check once it finishes.".to_string(),
                })
            } else {
                Ok(InstallOutcome::OpenUrl {
                    url: GIT_URL_WIN.to_string(),
                    message: "未检测到 winget，请从官方下载页安装 Git。 / winget not found — please install Git from the official download page.".to_string(),
                })
            }
        }
        "linux" => match linux_git_install_command(&|cmd| which(cmd).is_some()) {
            Some(command) => Ok(InstallOutcome::ManualCommand {
                command,
                message: "出于安全考虑不会自动执行 sudo，请复制命令到终端运行，完成后点「重新检查」。 / For safety the app never runs sudo itself — copy the command into a terminal, then click Re-check.".to_string(),
            }),
            None => Ok(InstallOutcome::OpenUrl {
                url: GIT_URL_LINUX.to_string(),
                message: "未检测到已知的包管理器，请参考官方安装指引。 / No known package manager detected — see the official install guide.".to_string(),
            }),
        },
        _ => Ok(InstallOutcome::OpenUrl {
            url: GIT_URL_GENERIC.to_string(),
            message: "当前平台不支持自动安装，请从官方下载页安装 Git。 / Auto-install is not supported on this platform — install Git from the official download page.".to_string(),
        }),
    }
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

#[derive(Serialize)]
struct FileStat {
    mtime_ms: u64,
    size: u64,
}

fn file_stat(path: &Path) -> Result<FileStat, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        mtime_ms,
        size: meta.len(),
    })
}

/// mtime (ms) + size of a file in the project root — the editor's
/// optimistic-concurrency baseline for `write_text`.
#[tauri::command]
fn stat_text(path: String) -> Result<FileStat, String> {
    let safe = confine_to_root(&PathBuf::from(&path), None)?;
    file_stat(&safe)
}

/// Structured-error prefix `write_text` returns when the file changed on disk
/// since it was read (the UI turns it into a 覆盖 / 重新加载 conflict prompt).
const CONFLICT_PREFIX: &str = "conflict:";

/// Writes a UTF-8 text file with the SAME confinement as `read_text`: the path
/// is canonicalized and must stay inside the project root, which defeats `../`
/// traversal and symlink escapes. Only existing regular files can be written
/// (the built-in editor edits files it opened), so canonicalization always has
/// a real target to resolve. Optimistic concurrency: when `expected_mtime`
/// (ms) is given and the file's current mtime differs, nothing is written and
/// a structured `conflict:<current_mtime_ms>` error is returned. Returns the
/// fresh stat on success so the editor can rebase its conflict check.
#[tauri::command]
fn write_text(
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> Result<FileStat, String> {
    let safe = confine_to_root(&PathBuf::from(&path), None)?;
    let meta = std::fs::metadata(&safe).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a regular file".to_string());
    }
    if content.len() as u64 > MAX_TEXT_READ {
        return Err(format!("file too large to save ({} bytes)", content.len()));
    }
    if let Some(expected) = expected_mtime {
        let cur = file_stat(&safe)?;
        if cur.mtime_ms != expected {
            return Err(format!("{CONFLICT_PREFIX}{}", cur.mtime_ms));
        }
    }
    std::fs::write(&safe, content.as_bytes()).map_err(|e| e.to_string())?;
    file_stat(&safe)
}

/// Repo-relative paths handed to `git show HEAD:<rel>` must be plain relative
/// paths: no leading `-` (option smuggling), no absolute/`..`/`.` components,
/// no backslashes or control characters.
fn is_valid_repo_relpath(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && !s.starts_with('/')
        && !s.contains('\\')
        && !s.chars().any(|c| c.is_control())
        && s.split('/').all(|c| !c.is_empty() && c != "." && c != "..")
}

/// Content of a file at git HEAD, for the editor's diff gutter. The requested
/// path is confined to the project root first (same canonicalize + prefix check
/// as `read_text`), rebased onto the repo top-level, then passed to
/// `git show HEAD:<relpath>` as a single validated positional — no flags, no
/// caller-controlled argv beyond the validated relpath.
#[tauri::command(async)]
fn git_head_text(path: String, cwd: Option<String>) -> Result<String, String> {
    let root = cwd.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let safe = confine_to_root(&PathBuf::from(&path), Some(&root))?;
    let top_out = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&root)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !top_out.status.success() {
        return Err(String::from_utf8_lossy(&top_out.stderr).into_owned());
    }
    let top = PathBuf::from(String::from_utf8_lossy(&top_out.stdout).trim())
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let rel = safe
        .strip_prefix(&top)
        .map_err(|_| "file is outside the git repository".to_string())?
        .to_string_lossy()
        .into_owned();
    if !is_valid_repo_relpath(&rel) {
        return Err(format!("invalid repository path: {rel}"));
    }
    let out = Command::new("git")
        .arg("show")
        .arg(format!("HEAD:{rel}"))
        .current_dir(&top)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    if out.stdout.len() as u64 > MAX_TEXT_READ {
        return Err(format!("file too large to diff ({} bytes)", out.stdout.len()));
    }
    String::from_utf8(out.stdout).map_err(|_| "not a UTF-8 text file".to_string())
}

/// Subcommands the GUI is allowed to run through the `git` bridge — read-only
/// inspection, the local staging/commit/branch workflow, plus a tightly
/// argument-validated set of remote operations (fetch / pull / push / remote -v).
/// Anything that can run arbitrary programs is intentionally excluded.
const GIT_SUBCOMMANDS: &[&str] = &[
    "status", "log", "diff", "add", "reset", "restore", "commit", "stash", "show",
    "rev-parse", "branch", "checkout", "switch", "ls-files", "clean", "fetch", "pull",
    "push", "remote", "merge", "rev-list",
];

/// 需要访问网络的子命令：禁用凭据交互提示、限时执行（防止卡在等待输入上）。
const GIT_REMOTE_SUBCOMMANDS: &[&str] = &["fetch", "pull", "push"];

/// 远端操作（git fetch/pull/push、gh）的最长执行时间，超时即杀掉子进程。
const REMOTE_OP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Remote names passed as positional args must look like plain names
/// (`origin`, `upstream`…) — never URLs, so `ext::`/`ssh://`-style transport
/// tricks can't reach the bridge (`:` and `/` are simply not allowed).
fn is_valid_remote_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 250
        && !s.starts_with('-')
        && !s.starts_with('.')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

/// `git check-ref-format` 风格的分支 / ref 名校验（比 git 本身更严一点）：
/// 只允许字母数字与 `_ . - /`，拒绝前导 `-`/`.`/`/`、`..`、`@{`、`//`、
/// 结尾的 `/`、`.`、`.lock` —— 足以覆盖正常分支名，同时排除一切选项注入。
fn is_valid_ref_name(s: &str) -> bool {
    if s.is_empty() || s.len() > 250 {
        return false;
    }
    if s.starts_with('-') || s.starts_with('.') || s.starts_with('/') {
        return false;
    }
    if s.ends_with('/') || s.ends_with('.') || s.ends_with(".lock") {
        return false;
    }
    if s.contains("..") || s.contains("@{") || s.contains("//") {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | '/'))
}

/// Per-subcommand flag allowlist. `--flag=value` forms are matched on the part
/// before `=`. Any `-`-prefixed arg not listed here is rejected.
fn git_flag_allowed(sub: &str, arg: &str) -> bool {
    let base = arg.split_once('=').map(|(k, _)| k).unwrap_or(arg);
    let allowed: &[&str] = match sub {
        "status" => &["--porcelain", "-s", "-b", "-sb", "--short", "--branch", "--no-color"],
        "log" => &["--oneline", "-n", "-1", "--no-color", "--pretty", "--format", "--max-count"],
        "diff" => &["--cached", "--staged", "--no-color", "--stat", "--numstat", "--name-only"],
        "add" => &["-A", "--all"],
        "restore" => &["--staged", "--worktree"],
        "commit" => &["-m"],
        "stash" => &["-m", "-u", "--include-untracked"],
        "show" => &["--no-color", "--stat", "--pretty", "--format", "-s"],
        "rev-parse" => &["--abbrev-ref", "--symbolic-full-name", "--short", "--verify"],
        "branch" => &["--show-current", "--format", "--list", "--no-color", "-d", "-D", "--delete"],
        "checkout" => &["-b"],
        // 注意：不放行 `-c`（与全局禁用的 config 短参撞名），创建分支用
        // `switch --create` 或 `checkout -b`。
        "switch" => &["--create"],
        "ls-files" => &["--others", "--exclude-standard"],
        "clean" => &["-f", "-d", "-fd", "-df"],
        "fetch" => &["--prune", "--all"],
        "pull" => &["--ff-only"],
        "push" => &["-u", "--set-upstream"],
        "remote" => &["-v", "--verbose"],
        // 并行任务「合并回主仓库」：只放行非交互的普通合并与中止。
        "merge" => &["--no-ff", "--no-edit", "--abort"],
        // ahead/behind 统计（`rev-list --left-right --count base...branch`）。
        "rev-list" => &["--left-right", "--count", "--no-color"],
        _ => &[],
    };
    allowed.contains(&base)
}

/// Flags whose value arrives as the *next* argv entry (free text, e.g. a commit
/// message) — that value is exempt from flag checks.
fn git_flag_takes_value(sub: &str, arg: &str) -> bool {
    matches!((sub, arg), ("commit", "-m") | ("stash", "-m"))
}

/// Rejects git argument vectors that could be used to run arbitrary code or smuggle
/// options: the first arg must be a whitelisted subcommand, no arg may set a config
/// value / exec path / upload- or receive-pack override, every `-`-prefixed arg must
/// be in the subcommand's flag allowlist, and remote-op positionals are validated as
/// remote names / ref names (URLs are never accepted).
fn validate_git_args(args: &[String]) -> Result<(), String> {
    let sub = args
        .first()
        .ok_or_else(|| "no git subcommand given".to_string())?
        .as_str();
    if !GIT_SUBCOMMANDS.contains(&sub) {
        return Err(format!("git subcommand not allowed: {sub}"));
    }
    let is_remote = GIT_REMOTE_SUBCOMMANDS.contains(&sub);
    let mut positionals: Vec<&str> = Vec::new();
    let mut skip_value = false;
    for arg in &args[1..] {
        if skip_value {
            skip_value = false;
            continue;
        }
        // 全局黑名单：任何能改配置 / 换执行程序 / 换传输命令的参数一律拒绝。
        if arg == "-c"
            || arg == "--config"
            || arg.starts_with("--config=")
            || arg.starts_with("--upload-pack")
            || arg.starts_with("--receive-pack")
            || arg.starts_with("--exec")
        {
            return Err(format!("git argument not allowed: {arg}"));
        }
        if arg == "--" {
            // `--` 之后是路径参数（git 在项目目录内执行），不再按 flag 校验；
            // 远端子命令不需要路径，禁止以免绕过 refspec 校验。
            if is_remote {
                return Err(format!("git argument not allowed for {sub}: --"));
            }
            break;
        }
        if arg.starts_with('-') {
            if !git_flag_allowed(sub, arg) {
                return Err(format!("git argument not allowed: {arg}"));
            }
            if git_flag_takes_value(sub, arg) {
                skip_value = true;
            }
        } else {
            positionals.push(arg);
        }
    }
    match sub {
        // fetch/pull/push：第一个位置参数是远端名，其余是分支 / refspec。
        "fetch" | "pull" | "push" => {
            if let Some((remote, refs)) = positionals.split_first() {
                if !is_valid_remote_name(remote) {
                    return Err(format!("invalid remote name: {remote}"));
                }
                for r in refs {
                    if !is_valid_ref_name(r) {
                        return Err(format!("invalid ref name: {r}"));
                    }
                }
            }
        }
        // 分支操作 / 合并的位置参数必须是合法分支名。
        "branch" | "checkout" | "switch" | "merge" => {
            for r in &positionals {
                if !is_valid_ref_name(r) {
                    return Err(format!("invalid ref name: {r}"));
                }
            }
        }
        // remote 只用于列出（remote -v），不放行 add/set-url 等子操作。
        "remote" => {
            if !positionals.is_empty() {
                return Err("git remote only supports listing (-v)".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

// --- 并行任务（git worktree）桥 ---------------------------------------------
//
// 目录约定：worktree 一律放在主仓库的兄弟目录
// `<repo-parent>/.jucode-worktrees/<repo-name>/<task-slug>` 下（不在主工作树
// 内部，也不会被主仓库的 git status 看到）。add/remove 的路径都会 canonicalize
// 后与该容器目录比对，拒绝任何容器外的路径。

/// 并行任务 worktree 的容器目录：`<repo-parent>/.jucode-worktrees/<repo-name>`。
fn worktree_base_dir(repo_root: &Path) -> Result<PathBuf, String> {
    let canon = repo_root
        .canonicalize()
        .map_err(|e| format!("failed to resolve repo root: {e}"))?;
    let name = canon
        .file_name()
        .ok_or_else(|| "cannot determine repository name".to_string())?
        .to_owned();
    let parent = canon
        .parent()
        .ok_or_else(|| "repository has no parent directory".to_string())?;
    Ok(parent.join(".jucode-worktrees").join(name))
}

/// 任务 slug：小写字母/数字/连字符，不以连字符开头结尾（与前端 slugify 一致）。
fn is_valid_task_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with('-')
        && !s.ends_with('-')
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Confines a worktree add/remove path to exactly `<container>/<slug>`.
/// The container dir is created first so canonicalization has a real target even
/// for `add` (whose leaf doesn't exist yet); `..`/symlink escapes in the parent
/// therefore can't slip past the comparison.
fn confine_worktree_path(path: &str, repo_root: &Path) -> Result<(), String> {
    let base = worktree_base_dir(repo_root)?;
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("worktree path must be absolute".to_string());
    }
    let slug = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid worktree path".to_string())?;
    if !is_valid_task_slug(slug) {
        return Err(format!("invalid task slug: {slug}"));
    }
    let parent = p
        .parent()
        .ok_or_else(|| "invalid worktree path".to_string())?;
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("failed to create worktree container dir: {e}"))?;
    let canon_base = base
        .canonicalize()
        .map_err(|e| format!("failed to resolve worktree container dir: {e}"))?;
    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("failed to resolve worktree path: {e}"))?;
    if canon_parent != canon_base {
        return Err("worktree path is outside the task container directory".to_string());
    }
    Ok(())
}

/// `git worktree` 参数校验（独立于 validate_git_args，因为需要知道仓库根来做
/// 路径圈禁）。只放行四种形态：
///   worktree add <path> -b <newbranch> [<base-ref>]
///   worktree add <path> <branch>
///   worktree list --porcelain
///   worktree remove <path> [--force]
///   worktree prune
fn validate_worktree_args(args: &[String], repo_root: &Path) -> Result<(), String> {
    if args.first().map(String::as_str) != Some("worktree") {
        return Err("not a worktree invocation".to_string());
    }
    let verb = args
        .get(1)
        .map(String::as_str)
        .ok_or_else(|| "no git worktree verb given".to_string())?;
    let rest = &args[2..];
    match verb {
        "list" => {
            if rest.len() == 1 && rest[0] == "--porcelain" {
                Ok(())
            } else {
                Err("git worktree list only supports --porcelain".to_string())
            }
        }
        "prune" => {
            if rest.is_empty() {
                Ok(())
            } else {
                Err("git worktree prune takes no arguments".to_string())
            }
        }
        "add" => {
            let mut positionals: Vec<&str> = Vec::new();
            let mut new_branch: Option<&str> = None;
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-b" => {
                        if new_branch.is_some() {
                            return Err("duplicate -b".to_string());
                        }
                        new_branch = Some(
                            rest.get(i + 1)
                                .ok_or_else(|| "-b requires a value".to_string())?,
                        );
                        i += 2;
                    }
                    a if a.starts_with('-') => {
                        return Err(format!("git worktree argument not allowed: {a}"))
                    }
                    a => {
                        positionals.push(a);
                        i += 1;
                    }
                }
            }
            let (path, refs) = positionals
                .split_first()
                .ok_or_else(|| "git worktree add requires a path".to_string())?;
            confine_worktree_path(path, repo_root)?;
            for r in refs {
                if !is_valid_ref_name(r) {
                    return Err(format!("invalid ref name: {r}"));
                }
            }
            if let Some(b) = new_branch {
                if !is_valid_ref_name(b) {
                    return Err(format!("invalid ref name: {b}"));
                }
            }
            // -b 新分支：可带 0/1 个 base-ref；复用已有分支：恰好 1 个。
            match (new_branch.is_some(), refs.len()) {
                (true, 0 | 1) | (false, 1) => Ok(()),
                _ => Err("unsupported git worktree add form".to_string()),
            }
        }
        "remove" => {
            let mut positionals: Vec<&str> = Vec::new();
            for a in rest {
                if a == "--force" {
                    continue;
                }
                if a.starts_with('-') {
                    return Err(format!("git worktree argument not allowed: {a}"));
                }
                positionals.push(a);
            }
            if positionals.len() != 1 {
                return Err("git worktree remove requires exactly one path".to_string());
            }
            confine_worktree_path(positionals[0], repo_root)
        }
        other => Err(format!("git worktree verb not allowed: {other}")),
    }
}

/// 前端据此拼出任务 worktree 的目标路径（`<容器>/<slug>`）。
#[tauri::command]
fn worktree_base(cwd: String) -> Result<String, String> {
    worktree_base_dir(Path::new(&cwd)).map(|p| p.display().to_string())
}

/// Runs a spawned command to completion with a hard deadline: stdout/stderr are
/// drained on threads, and the child is killed if it outlives `timeout` (e.g. a
/// remote op stuck on the network even with prompts disabled).
fn run_with_timeout(
    mut cmd: Command,
    timeout: std::time::Duration,
) -> Result<std::process::Output, String> {
    use std::time::Instant;
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run command: {e}"))?;
    let mut out_pipe = child.stdout.take().ok_or("failed to capture stdout")?;
    let mut err_pipe = child.stderr.take().ok_or("failed to capture stderr")?;
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out_pipe.read_to_end(&mut buf);
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err_pipe.read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "操作超时（{}s），已终止。请检查网络连接或凭据配置。",
                    timeout.as_secs()
                ));
            }
            None => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    };
    let stdout = out_thread.join().unwrap_or_default();
    let stderr = err_thread.join().unwrap_or_default();
    Ok(std::process::Output { status, stdout, stderr })
}

/// Runs a git command in the project root and returns stdout (or stderr on failure).
/// Remote subcommands run with credential prompts disabled (`GIT_TERMINAL_PROMPT=0`,
/// user's `GIT_SSH_COMMAND` passes through untouched) and a bounded timeout, so
/// missing credentials fail fast with git's own stderr instead of hanging.
#[tauri::command(async)]
fn git(args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    let dir = cwd.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    // worktree 子命令需要仓库根做路径圈禁，走专用校验；其余走通用白名单。
    if args.first().map(String::as_str) == Some("worktree") {
        validate_worktree_args(&args, &dir)?;
    } else {
        validate_git_args(&args)?;
    }
    let is_remote = args
        .first()
        .is_some_and(|s| GIT_REMOTE_SUBCOMMANDS.contains(&s.as_str()));
    let mut cmd = Command::new("git");
    cmd.args(&args)
        .current_dir(dir)
        // 永不弹终端凭据提示：缺凭据直接失败，stderr 会带回前端展示。
        .env("GIT_TERMINAL_PROMPT", "0");
    let output = if is_remote {
        run_with_timeout(cmd, REMOTE_OP_TIMEOUT)?
    } else {
        cmd.output().map_err(|e| format!("failed to run git: {e}"))?
    };
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        // 失败时 stdout 也可能携带关键信息（如 merge 的 CONFLICT 列表），一并带回。
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut msg = stderr.trim_end().to_string();
        if !stdout.trim().is_empty() {
            if !msg.is_empty() {
                msg.push('\n');
            }
            msg.push_str(stdout.trim_end());
        }
        Err(msg)
    }
}

/// Resolves the GitHub CLI binary: PATH first, then the usual install locations
/// (a packaged .app inherits a minimal PATH from launchd).
fn resolve_gh() -> PathBuf {
    if let Some(found) = which("gh") {
        return found;
    }
    for candidate in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("gh")
}

/// gh CLI 桥的参数白名单：只放行 PR 工作流需要的四种调用 ——
/// `--version`（可用性检测）、`auth status`（登录检测）、
/// `pr view --json …`（查询当前分支已有 PR）、`pr create`（创建 PR）。
fn validate_gh_args(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("--version") if args.len() == 1 => Ok(()),
        Some("auth") if args.len() == 2 && args[1] == "status" => Ok(()),
        Some("pr") => validate_gh_pr_args(&args[1..]),
        _ => Err(format!("gh arguments not allowed: {}", args.join(" "))),
    }
}

fn validate_gh_pr_args(rest: &[String]) -> Result<(), String> {
    match rest.first().map(String::as_str) {
        // gh pr view --json url,title,state,isDraft
        Some("view") => {
            let mut i = 1;
            while i < rest.len() {
                if rest[i] != "--json" {
                    return Err(format!("gh argument not allowed: {}", rest[i]));
                }
                let v = rest
                    .get(i + 1)
                    .ok_or_else(|| "--json requires a value".to_string())?;
                if v.is_empty() || !v.chars().all(|c| c.is_ascii_alphanumeric() || c == ',') {
                    return Err(format!("gh --json fields not allowed: {v}"));
                }
                i += 2;
            }
            Ok(())
        }
        // gh pr create --title … --body … [--base <branch>] [--draft]
        Some("create") => {
            let mut i = 1;
            let mut has_title = false;
            while i < rest.len() {
                match rest[i].as_str() {
                    "--title" | "--body" => {
                        // 值是自由文本（作为独立 argv 传给 gh，无 shell 解释）。
                        if rest.get(i + 1).is_none() {
                            return Err(format!("{} requires a value", rest[i]));
                        }
                        has_title |= rest[i] == "--title";
                        i += 2;
                    }
                    "--base" | "--head" => {
                        let v = rest
                            .get(i + 1)
                            .ok_or_else(|| format!("{} requires a value", rest[i]))?;
                        if !is_valid_ref_name(v) {
                            return Err(format!("invalid ref name: {v}"));
                        }
                        i += 2;
                    }
                    "--draft" => i += 1,
                    other => return Err(format!("gh argument not allowed: {other}")),
                }
            }
            if !has_title {
                return Err("gh pr create requires --title".to_string());
            }
            Ok(())
        }
        _ => Err(format!("gh pr subcommand not allowed: {}", rest.join(" "))),
    }
}

/// GitHub CLI bridge (separate from the git whitelist). Fully non-interactive:
/// prompts are disabled so a missing login fails fast with gh's stderr, and the
/// whole call is killed after a bounded timeout.
#[tauri::command(async)]
fn gh(args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    validate_gh_args(&args)?;
    let dir = cwd.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let mut cmd = Command::new(resolve_gh());
    cmd.args(&args)
        .current_dir(dir)
        // 全程非交互：未登录 / 缺配置时立即报错返回，绝不挂起等输入。
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "cat")
        .env("NO_COLOR", "1")
        .env("GIT_TERMINAL_PROMPT", "0");
    let output = run_with_timeout(cmd, REMOTE_OP_TIMEOUT)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if stderr.trim().is_empty() {
            Err(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(stderr)
        }
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

/// The shell the embedded terminal runs. Windows has no `$SHELL`: prefer
/// PowerShell 7 (`pwsh`), then Windows PowerShell, then `%COMSPEC%`/cmd. Unix
/// keeps `$SHELL` with a `/bin/zsh` → `/bin/bash` → `/bin/sh` fallback chain.
fn default_shell() -> String {
    if cfg!(windows) {
        if which("pwsh").is_some() {
            return "pwsh.exe".to_string();
        }
        if which("powershell").is_some() {
            return "powershell.exe".to_string();
        }
        return std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    }
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.trim().is_empty() {
            return shell;
        }
    }
    for sh in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if Path::new(sh).exists() {
            return sh.to_string();
        }
    }
    "/bin/sh".to_string()
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
    let mut cmd = CommandBuilder::new(default_shell());
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

/// 显示并聚焦主窗口（托盘点击 / 二次启动 / 深链 / Dock 图标都会走这里）。
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 创建系统托盘：左键点击显示主窗口，右键菜单提供 显示主窗口 / 新建会话 / 退出。
/// 关闭主窗口只是隐藏到托盘（见 on_window_event），真正退出走托盘菜单「退出」。
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let new_session = MenuItem::with_id(app, "new-session", "新建会话", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_session, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("JuCode")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "new-session" => {
                // 前端监听该事件，在当前项目里新建一个会话。
                show_main_window(app);
                let _ = app.emit("tray-new-session", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    // 复用应用图标作为托盘图标。
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // 单实例插件必须最先注册：第二次启动只聚焦已有窗口；启用 deep-link feature 后
    // argv 里的 jucode:// 链接会自动转发给 deep-link 插件（Windows/Linux）。
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                setup_tray(app)?;
                // 开发/未打包运行时，Windows 和 Linux 需要在运行时注册 scheme
                //（打包安装时由安装器写注册表 / .desktop 文件）。
                #[cfg(any(windows, target_os = "linux"))]
                let _ = app.deep_link().register_all();
                // 深链到达时先把窗口带到前台，具体路由由前端解析处理。
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |_| show_main_window(&handle));
            }
            Ok(())
        })
        // 关闭主窗口时隐藏到托盘而不是退出（macOS/Windows/Linux 一致），
        // 真正退出通过托盘菜单「退出」。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
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
            stat_text,
            write_text,
            git_head_text,
            save_temp_image,
            check_environment,
            install_dependency,
            git,
            gh,
            worktree_base,
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
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // macOS：窗口隐藏在托盘时点击 Dock 图标重新显示主窗口。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main_window(_app);
            }
        });
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

    // --- git install advice (setup wizard) ---

    use super::{git_install_advice, linux_git_install_command};

    fn avail(set: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |name| set.contains(&name)
    }

    #[test]
    fn linux_package_manager_probe_order() {
        // apt-get wins even when others exist.
        assert_eq!(
            linux_git_install_command(&avail(&["apt-get", "dnf", "pacman"])).as_deref(),
            Some("sudo apt-get install -y git")
        );
        assert_eq!(
            linux_git_install_command(&avail(&["dnf"])).as_deref(),
            Some("sudo dnf install -y git")
        );
        assert_eq!(
            linux_git_install_command(&avail(&["pacman"])).as_deref(),
            Some("sudo pacman -S --noconfirm git")
        );
        assert_eq!(
            linux_git_install_command(&avail(&["zypper"])).as_deref(),
            Some("sudo zypper install -y git")
        );
        assert_eq!(linux_git_install_command(&avail(&[])), None);
    }

    #[test]
    fn macos_advice_is_auto() {
        let advice = git_install_advice("macos", &avail(&[]));
        assert_eq!(advice.kind, "auto");
    }

    #[test]
    fn windows_advice_depends_on_winget() {
        let advice = git_install_advice("windows", &avail(&["winget"]));
        assert_eq!(advice.kind, "auto");
        assert!(advice.command.unwrap().contains("winget install --id Git.Git"));
        let advice = git_install_advice("windows", &avail(&[]));
        assert_eq!(advice.kind, "open-url");
        assert_eq!(advice.url, "https://git-scm.com/download/win");
    }

    #[test]
    fn linux_advice_is_manual_command_never_auto() {
        let advice = git_install_advice("linux", &avail(&["apt-get"]));
        assert_eq!(advice.kind, "manual-command");
        assert!(advice.command.unwrap().starts_with("sudo apt-get"));
        let advice = git_install_advice("linux", &avail(&[]));
        assert_eq!(advice.kind, "open-url");
    }

    // --- git bridge argument validation ---

    use super::{is_valid_ref_name, is_valid_remote_name, validate_gh_args, validate_git_args};

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn git_local_workflow_is_allowed() {
        for cmd in [
            vec!["status", "--porcelain=v1"],
            vec!["status", "-sb"],
            vec!["status", "--porcelain=v1", "--", "a.txt"],
            vec!["diff", "--numstat", "--", "a.txt", "b.txt"],
            vec!["diff", "--cached", "--no-color", "--", "a.txt"],
            vec!["log", "--oneline", "-n", "30", "--no-color"],
            vec!["log", "-1", "--pretty=%s"],
            vec!["add", "-A"],
            vec!["add", "--", "src/main.rs"],
            vec!["restore", "--staged", "--worktree", "--", "a.txt"],
            vec!["commit", "-m", "-message starting with dash"],
            vec!["clean", "-fd", "--", "junk.txt"],
            vec!["branch", "--format=%(refname:short)"],
            vec!["branch", "-d", "feature/x"],
            vec!["switch", "--create", "feature/new-ui"],
            vec!["checkout", "-b", "feature/new-ui"],
            vec!["checkout", "main"],
            vec!["remote", "-v"],
        ] {
            assert!(validate_git_args(&args(&cmd)).is_ok(), "should allow: {cmd:?}");
        }
    }

    #[test]
    fn git_remote_ops_are_allowed_with_plain_names() {
        for cmd in [
            vec!["fetch"],
            vec!["pull", "--ff-only"],
            vec!["push"],
            vec!["push", "-u", "origin", "feature/new-ui"],
        ] {
            assert!(validate_git_args(&args(&cmd)).is_ok(), "should allow: {cmd:?}");
        }
    }

    #[test]
    fn git_injection_vectors_are_rejected() {
        for cmd in [
            // 危险的全局参数
            vec!["fetch", "--upload-pack=touch /tmp/pwn"],
            vec!["push", "--receive-pack=evil"],
            vec!["pull", "--exec=evil"],
            vec!["log", "-c", "core.pager=evil"],
            vec!["status", "--config=alias.st=!evil"],
            // 白名单外的子命令 / flag
            vec!["daemon"],
            vec!["push", "--force"],
            vec!["pull", "--rebase"],
            vec!["log", "--output=/etc/passwd"],
            // URL / ext:: 传输伪装成远端名
            vec!["push", "ext::sh -c evil", "main"],
            vec!["fetch", "https://evil.example/repo.git"],
            vec!["pull", "origin/../../etc", "main"],
            // 位置参数伪装成选项
            vec!["push", "origin", "--force"],
            vec!["switch", "--create", "-evil"],
            vec!["switch", "-c", "feature/x"],
            vec!["branch", "-D", "@{upstream}"],
            // remote 只允许列出
            vec!["remote", "add", "evil", "ext::sh"],
            vec!["remote", "set-url", "origin", "https://evil"],
            // 远端子命令禁止 `--` 逃逸
            vec!["push", "--", "origin"],
        ] {
            assert!(validate_git_args(&args(&cmd)).is_err(), "should reject: {cmd:?}");
        }
    }

    #[test]
    fn remote_and_ref_name_validation() {
        assert!(is_valid_remote_name("origin"));
        assert!(is_valid_remote_name("my-fork_2.0"));
        assert!(!is_valid_remote_name("ext::sh"));
        assert!(!is_valid_remote_name("https://evil"));
        assert!(!is_valid_remote_name("-origin"));
        assert!(!is_valid_remote_name(""));

        assert!(is_valid_ref_name("main"));
        assert!(is_valid_ref_name("feature/new-ui"));
        assert!(is_valid_ref_name("v1.2.3"));
        assert!(!is_valid_ref_name("-b"));
        assert!(!is_valid_ref_name("a..b"));
        assert!(!is_valid_ref_name("a@{1}"));
        assert!(!is_valid_ref_name("branch.lock"));
        assert!(!is_valid_ref_name("branch/"));
        assert!(!is_valid_ref_name("a//b"));
        assert!(!is_valid_ref_name("has space"));
        assert!(!is_valid_ref_name("ssh://host/repo"));
    }

    #[test]
    fn repo_relpath_validation() {
        use super::is_valid_repo_relpath;
        assert!(is_valid_repo_relpath("src/lib.rs"));
        assert!(is_valid_repo_relpath("a/b/c.txt"));
        assert!(is_valid_repo_relpath(".gitignore"));
        assert!(is_valid_repo_relpath("有中文/文件.md"));
        assert!(!is_valid_repo_relpath(""));
        assert!(!is_valid_repo_relpath("-flag"));
        assert!(!is_valid_repo_relpath("/etc/passwd"));
        assert!(!is_valid_repo_relpath("../escape"));
        assert!(!is_valid_repo_relpath("a/../b"));
        assert!(!is_valid_repo_relpath("a/./b"));
        assert!(!is_valid_repo_relpath("a//b"));
        assert!(!is_valid_repo_relpath("a\\b"));
        assert!(!is_valid_repo_relpath("a\nb"));
    }

    #[test]
    fn write_text_optimistic_concurrency() {
        use super::{file_stat, CONFLICT_PREFIX};
        // Exercise the conflict check through file_stat directly (write_text
        // itself is root-confined, so use a file in this repo's target dir via
        // the same primitives).
        let p = tmp("write-conflict.txt");
        std::fs::write(&p, "v1").unwrap();
        let st = file_stat(&p).unwrap();
        assert_eq!(st.size, 2);
        // Simulate an on-disk change: bump mtime by rewriting with different content.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&p, "v2-changed").unwrap();
        let st2 = file_stat(&p).unwrap();
        assert!(st2.mtime_ms >= st.mtime_ms);
        assert_ne!(st2.size, st.size);
        // The structured error the UI matches on.
        let err = format!("{CONFLICT_PREFIX}{}", st2.mtime_ms);
        assert!(err.starts_with("conflict:"));
        let _ = std::fs::remove_file(&p);
    }

    // --- worktree bridge: path confinement + arg validation ---

    use super::{is_valid_task_slug, validate_worktree_args, worktree_base_dir};

    /// Creates <tmp>/<name>/repo and returns (tmp_root, repo_root).
    fn tmp_repo(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "jucode-wt-test-{}-{}",
            std::process::id(),
            name
        ));
        let repo = root.join("repo");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&repo).unwrap();
        (root, repo)
    }

    #[test]
    fn worktree_base_dir_is_sibling_container() {
        let (root, repo) = tmp_repo("base");
        let base = worktree_base_dir(&repo).unwrap();
        assert_eq!(
            base,
            root.canonicalize().unwrap().join(".jucode-worktrees").join("repo")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn task_slug_validation() {
        assert!(is_valid_task_slug("fix-login"));
        assert!(is_valid_task_slug("a1-b2-c3"));
        assert!(!is_valid_task_slug(""));
        assert!(!is_valid_task_slug("-lead"));
        assert!(!is_valid_task_slug("trail-"));
        assert!(!is_valid_task_slug("Upper"));
        assert!(!is_valid_task_slug("has space"));
        assert!(!is_valid_task_slug("dot.dot"));
        assert!(!is_valid_task_slug("路径"));
    }

    #[test]
    fn worktree_add_confines_paths_to_container() {
        let (root, repo) = tmp_repo("add");
        let base = worktree_base_dir(&repo).unwrap();
        let ok = base.join("my-task").display().to_string();
        assert!(validate_worktree_args(
            &args(&["worktree", "add", &ok, "-b", "task/my-task", "main"]),
            &repo
        )
        .is_ok());
        assert!(validate_worktree_args(&args(&["worktree", "add", &ok, "-b", "task/my-task"]), &repo).is_ok());
        assert!(validate_worktree_args(&args(&["worktree", "add", &ok, "task/my-task"]), &repo).is_ok());

        // 容器外 / 穿越 / 非法 slug / 非法分支名 / 非法 flag 一律拒绝。
        let escape = base.join("../evil").display().to_string();
        let abs_out = root.join("elsewhere/task").display().to_string();
        let nested = base.join("a/b").display().to_string();
        for bad in [
            vec!["worktree", "add", "/tmp/evil", "-b", "task/x"],
            vec!["worktree", "add", escape.as_str(), "-b", "task/x"],
            vec!["worktree", "add", abs_out.as_str(), "-b", "task/x"],
            vec!["worktree", "add", nested.as_str(), "-b", "task/x"],
            vec!["worktree", "add", "relative/path", "-b", "task/x"],
            vec!["worktree", "add", ok.as_str(), "-b", "-evil"],
            vec!["worktree", "add", ok.as_str(), "-b", "task/x", "a..b"],
            vec!["worktree", "add", ok.as_str(), "--detach"],
            vec!["worktree", "add", ok.as_str()],
            vec!["worktree", "add", ok.as_str(), "main", "extra"],
        ] {
            assert!(
                validate_worktree_args(&args(&bad), &repo).is_err(),
                "should reject: {bad:?}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn worktree_remove_list_prune_validation() {
        let (root, repo) = tmp_repo("rm");
        let base = worktree_base_dir(&repo).unwrap();
        std::fs::create_dir_all(base.join("done-task")).unwrap();
        let ok = base.join("done-task").display().to_string();
        assert!(validate_worktree_args(&args(&["worktree", "remove", &ok]), &repo).is_ok());
        assert!(validate_worktree_args(&args(&["worktree", "remove", &ok, "--force"]), &repo).is_ok());
        assert!(validate_worktree_args(&args(&["worktree", "list", "--porcelain"]), &repo).is_ok());
        assert!(validate_worktree_args(&args(&["worktree", "prune"]), &repo).is_ok());

        // 主仓库自身 / 容器外路径 / 多余参数被拒。
        let repo_s = repo.display().to_string();
        for bad in [
            vec!["worktree", "remove", repo_s.as_str()],
            vec!["worktree", "remove", "/etc"],
            vec!["worktree", "remove", ok.as_str(), "extra"],
            vec!["worktree", "remove"],
            vec!["worktree", "list"],
            vec!["worktree", "list", "-v"],
            vec!["worktree", "prune", "--dry-run"],
            vec!["worktree", "lock", ok.as_str()],
            vec!["worktree", "move", ok.as_str(), "/tmp/x"],
        ] {
            assert!(
                validate_worktree_args(&args(&bad), &repo).is_err(),
                "should reject: {bad:?}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn task_container_is_second_root_for_file_confinement() {
        use super::in_root_or_task_container;
        let (root, repo) = tmp_repo("confine");
        let container = worktree_base_dir(&repo).unwrap();
        std::fs::create_dir_all(container.join("my-task")).unwrap();
        std::fs::write(container.join("my-task/f.txt"), "x").unwrap();
        std::fs::write(root.join("outside.txt"), "x").unwrap();
        let canon_repo = repo.canonicalize().unwrap();
        let inside_repo = canon_repo.clone();
        let inside_container = container.join("my-task/f.txt").canonicalize().unwrap();
        let outside = root.join("outside.txt").canonicalize().unwrap();
        assert!(in_root_or_task_container(&inside_repo, &canon_repo));
        assert!(in_root_or_task_container(&inside_container, &canon_repo));
        assert!(!in_root_or_task_container(&outside, &canon_repo));
        assert!(!in_root_or_task_container(std::path::Path::new("/etc"), &canon_repo));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn merge_and_revlist_whitelist() {
        assert!(validate_git_args(&args(&["merge", "--no-ff", "--no-edit", "task/fix-login"])).is_ok());
        assert!(validate_git_args(&args(&["merge", "--abort"])).is_ok());
        assert!(validate_git_args(&args(&["rev-list", "--left-right", "--count", "main...task/x"])).is_ok());

        assert!(validate_git_args(&args(&["merge", "--squash", "task/x"])).is_err());
        assert!(validate_git_args(&args(&["merge", "--no-ff", "-evil"])).is_err());
        assert!(validate_git_args(&args(&["merge", "-s", "ours", "task/x"])).is_err());
        // worktree 不走通用校验入口。
        assert!(validate_git_args(&args(&["worktree", "list", "--porcelain"])).is_err());
    }

    #[test]
    fn gh_whitelist_allows_pr_workflow_only() {
        assert!(validate_gh_args(&args(&["--version"])).is_ok());
        assert!(validate_gh_args(&args(&["auth", "status"])).is_ok());
        assert!(validate_gh_args(&args(&["pr", "view", "--json", "url,title,state,isDraft"])).is_ok());
        assert!(validate_gh_args(&args(&[
            "pr", "create", "--title", "feat: x", "--body", "", "--base", "main", "--draft"
        ]))
        .is_ok());

        assert!(validate_gh_args(&args(&["repo", "clone", "x/y"])).is_err());
        assert!(validate_gh_args(&args(&["auth", "login"])).is_err());
        assert!(validate_gh_args(&args(&["pr", "merge"])).is_err());
        assert!(validate_gh_args(&args(&["pr", "create", "--body", "no title"])).is_err());
        assert!(validate_gh_args(&args(&["pr", "create", "--title", "t", "--base", "-evil"])).is_err());
        assert!(validate_gh_args(&args(&["pr", "create", "--title", "t", "--web"])).is_err());
        assert!(validate_gh_args(&args(&["pr", "view", "--json", "url;rm -rf"])).is_err());
        assert!(validate_gh_args(&args(&["--version", "extra"])).is_err());
    }
}
