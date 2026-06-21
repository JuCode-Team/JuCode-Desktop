use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
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

#[tauri::command]
fn close_session(session: String, engines: tauri::State<Engines>) -> Result<(), String> {
    if let Some(target) = engines.sessions.lock().unwrap().remove(&session) {
        if let Ok(mut child) = target.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Engines::default())
        .invoke_handler(tauri::generate_handler![
            create_session,
            send_op,
            close_session,
            read_config,
            write_config,
            read_auth_providers,
            set_auth_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
