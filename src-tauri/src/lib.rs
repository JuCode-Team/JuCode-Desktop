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
            close_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
