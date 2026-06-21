use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Holds the live `jucode serve` child so the GUI can write commands to its
/// stdin. Its stdout is pumped to the webview as `agent-event` events.
struct Engine {
    stdin: Mutex<ChildStdin>,
    #[allow(dead_code)]
    child: Mutex<Child>,
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

#[tauri::command]
fn send_op(op: serde_json::Value, engine: tauri::State<Engine>) -> Result<(), String> {
    let line = serde_json::to_string(&op).map_err(|error| error.to_string())?;
    let mut stdin = engine.stdin.lock().map_err(|error| error.to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => {
                            let _ = handle.emit("agent-event", line);
                        }
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
                let _ = handle.emit("agent-exit", ());
            });

            app.manage(Engine {
                stdin: Mutex::new(stdin),
                child: Mutex::new(child),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_op])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
