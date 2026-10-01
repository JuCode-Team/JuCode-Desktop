//! App updates from two sources: GitHub Releases first, and the JuCode server
//! (the same signed bundles, mirrored by the backend) when GitHub cannot be
//! reached or downloads too slowly, as is common from mainland China. The
//! updater plugin checks signatures either way.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const GITHUB_MANIFEST: &str =
    "https://github.com/JuCode-Team/JuCode-Desktop/releases/latest/download/latest.json";
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
/// The first bytes of the bundle must arrive at least this fast from GitHub.
const PROBE_BYTES: u64 = 512 * 1024;
const PROBE_TIME: Duration = Duration::from_secs(4);

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Github,
    Jucode,
}

/// The update found by the last check, for `update_install`.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Source)>>);

#[derive(Serialize)]
pub struct Found {
    version: String,
    notes: Option<String>,
    source: Source,
}

/// Download progress, in the shape of the updater plugin's JS events.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

/// The JuCode server's mirror of the desktop manifest, on the API the user's
/// config names (regional domains differ).
fn jucode_manifest() -> String {
    let api = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| std::path::PathBuf::from(home).join(".jucode").join("config.json"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|config| config["jucode_api_url"].as_str().map(str::to_string))
        .filter(|api| !api.trim().is_empty())
        .unwrap_or_else(|| "https://api.jucode.net".to_string());
    format!("{}/v1/public/releases/desktop/latest.json", api.trim_end_matches('/'))
}

async fn check_at(app: &AppHandle, manifest: &str) -> Result<Option<Update>, String> {
    let url = manifest.parse().map_err(|e| format!("{manifest}: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())
}

/// Whether the start of `url` downloads at a usable rate.
fn downloads_fast(url: &str) -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(PROBE_TIME)
        .timeout_read(PROBE_TIME)
        .build();
    let started = Instant::now();
    let Ok(response) = agent
        .get(url)
        .set("Range", &format!("bytes=0-{}", PROBE_BYTES - 1))
        .call()
    else {
        return false;
    };
    let mut reader = std::io::Read::take(response.into_reader(), PROBE_BYTES);
    let read = std::io::copy(&mut reader, &mut std::io::sink()).unwrap_or(0);
    read > 0 && started.elapsed() <= PROBE_TIME
}

/// Looks for an update: on GitHub, else (unreachable, or too slow to download
/// from) on the JuCode server.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<Option<Found>, String> {
    let found = match check_at(&app, GITHUB_MANIFEST).await {
        Ok(None) => None,
        Ok(Some(update)) => {
            let url = update.download_url.to_string();
            let fast = tauri::async_runtime::spawn_blocking(move || downloads_fast(&url))
                .await
                .unwrap_or(false);
            if fast {
                Some((update, Source::Github))
            } else {
                // Slow GitHub: the mirror when it has this version, else GitHub after all.
                match check_at(&app, &jucode_manifest()).await {
                    Ok(Some(mirror)) if mirror.version == update.version => Some((mirror, Source::Jucode)),
                    _ => Some((update, Source::Github)),
                }
            }
        }
        Err(github) => match check_at(&app, &jucode_manifest()).await {
            Ok(update) => update.map(|update| (update, Source::Jucode)),
            Err(jucode) => return Err(format!("GitHub: {github}; JuCode: {jucode}")),
        },
    };
    let result = found.as_ref().map(|(update, source)| Found {
        version: update.version.clone(),
        notes: update.body.clone(),
        source: *source,
    });
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(result)
}

async fn install(update: &Update, on_event: &Channel<DownloadEvent>) -> Result<(), String> {
    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())
}

/// The lowest version the JuCode server still accepts ("" when it names
/// none or cannot be reached: an unreachable server never locks the app).
#[tauri::command]
pub async fn update_policy() -> String {
    let manifest = jucode_manifest();
    let url = manifest.replace("/latest.json", "/policy");
    tauri::async_runtime::spawn_blocking(move || {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout_read(Duration::from_secs(5))
            .build()
            .get(&url)
            .call()
            .ok()
            .and_then(|response| response.into_json::<serde_json::Value>().ok())
            .and_then(|policy| policy["min_version"].as_str().map(str::to_string))
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// Downloads and installs the update the last check found; a GitHub download
/// that fails is retried once from the JuCode server.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    pending: State<'_, Pending>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let (update, source) = pending
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or("no update to install")?;
    match install(&update, &on_event).await {
        Ok(()) => Ok(()),
        Err(github) if source == Source::Github => {
            match check_at(&app, &jucode_manifest()).await {
                Ok(Some(mirror)) if mirror.version == update.version => install(&mirror, &on_event)
                    .await
                    .map_err(|jucode| format!("GitHub: {github}; JuCode: {jucode}")),
                _ => Err(github),
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_matches_the_plugin_events() {
        let started = serde_json::to_value(DownloadEvent::Started { content_length: Some(9) }).unwrap();
        assert_eq!(started, serde_json::json!({ "event": "Started", "data": { "contentLength": 9 } }));
        let chunk = serde_json::to_value(DownloadEvent::Progress { chunk_length: 3 }).unwrap();
        assert_eq!(chunk, serde_json::json!({ "event": "Progress", "data": { "chunkLength": 3 } }));
        assert_eq!(serde_json::to_value(DownloadEvent::Finished).unwrap(), serde_json::json!({ "event": "Finished" }));
    }

    #[test]
    fn the_mirror_manifest_is_under_the_public_api() {
        assert!(jucode_manifest().ends_with("/v1/public/releases/desktop/latest.json"));
    }
}
