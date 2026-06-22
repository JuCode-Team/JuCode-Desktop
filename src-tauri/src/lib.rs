use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

/// Resolves the `jucode` binary: `JUCODE_BIN` override, then a sibling
/// `JuCode-CLI` checkout, then an in-tree build, then `jucode` on PATH.
fn resolve_bin() -> PathBuf {
    if let Ok(path) = std::env::var("JUCODE_BIN") {
        return PathBuf::from(path);
    }
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

/// Spawns a new engine process for `session`. The frontend generates the id and
/// registers its event listener before calling this, so no startup event is lost.
#[tauri::command]
fn create_session(
    session: String,
    app: AppHandle,
    engines: tauri::State<Engines>,
) -> Result<(), String> {
    let mut child = Command::new(resolve_bin())
        .arg("serve")
        .current_dir(resolve_cwd())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to start jucode serve: {error}"))?;

    let stdout = child.stdout.take().expect("child stdout");
    let stdin = child.stdin.take().expect("child stdin");

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

    engines.sessions.lock().unwrap().insert(
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
        .unwrap()
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
    let mut current = read_json(&path);
    if let (Some(cur), Some(p)) = (current.as_object_mut(), patch.as_object()) {
        for (key, value) in p {
            cur.insert(key.clone(), value.clone());
        }
    }
    write_json(&path, &current)
}

/// Returns the provider names that have a stored API key (not the keys).
#[tauri::command]
fn read_auth_providers() -> Vec<String> {
    read_json(&jucode_dir().join("auth.json"))
        .get("providers")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
fn set_auth_key(provider: String, key: String) -> Result<(), String> {
    let path = jucode_dir().join("auth.json");
    let mut current = read_json(&path);
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

/// Fetches the JuCode skills marketplace using the configured api url and the
/// stored jucode key, returning the raw `{skills, default_skill_ids}` JSON.
#[tauri::command]
fn fetch_marketplace() -> Result<serde_json::Value, String> {
    let config = read_json(&jucode_dir().join("config.json"));
    let api_url = config
        .get("jucode_api_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://api.jucode.cn")
        .trim_end_matches('/')
        .to_string();
    let key = read_json(&jucode_dir().join("auth.json"))
        .get("providers")
        .and_then(|p| p.get("jucode"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let url = format!("{api_url}/v1/skills/marketplace");
    let mut req = ureq::get(&url).timeout(std::time::Duration::from_secs(30));
    if let Some(k) = key.filter(|k| !k.trim().is_empty()) {
        req = req.set("Authorization", &format!("Bearer {k}"));
    }
    req.call()
        .map_err(|e| e.to_string())?
        .into_json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_session(session: String, engines: tauri::State<Engines>) -> Result<(), String> {
    if let Some(target) = engines.sessions.lock().unwrap().remove(&session) {
        if let Ok(mut child) = target.child.lock() {
            let _ = child.kill();
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

#[derive(Serialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Lists a directory (defaults to the project root), directories first.
#[tauri::command]
fn list_dir(path: Option<String>) -> Result<Vec<FsEntry>, String> {
    let dir = path.map(PathBuf::from).unwrap_or_else(resolve_cwd);
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

/// Reads a UTF-8 text file (size-capped). Returns an error for binary/oversized files.
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_TEXT_READ {
        return Err(format!("file too large to view ({} bytes)", meta.len()));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "not a UTF-8 text file".to_string())
}

/// Runs a git command in the project root and returns stdout (or stderr on failure).
#[tauri::command]
fn git(args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
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

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(resolve_cwd());
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let handle = app.clone();
    let stream_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
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

    ptys.map.lock().unwrap().insert(
        id,
        Arc::new(Pty {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
        }),
    );
    Ok(())
}

#[tauri::command]
fn pty_write(id: String, data: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    let pty = ptys.map.lock().unwrap().get(&id).cloned();
    let pty = pty.ok_or_else(|| "unknown terminal".to_string())?;
    let mut writer = pty.writer.lock().unwrap();
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(id: String, cols: u16, rows: u16, ptys: tauri::State<Ptys>) -> Result<(), String> {
    use portable_pty::PtySize;
    let pty = ptys.map.lock().unwrap().get(&id).cloned();
    let pty = pty.ok_or_else(|| "unknown terminal".to_string())?;
    let master = pty.master.lock().unwrap();
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
    if let Some(pty) = ptys.map.lock().unwrap().remove(&id) {
        let _ = pty.child.lock().unwrap().kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Engines::default())
        .manage(Ptys::default())
        .invoke_handler(tauri::generate_handler![
            create_session,
            send_op,
            close_session,
            read_config,
            write_config,
            read_auth_providers,
            set_auth_key,
            fetch_marketplace,
            project_root,
            list_dir,
            read_text,
            git,
            pty_open,
            pty_write,
            pty_resize,
            pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
