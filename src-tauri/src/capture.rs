//! Screenshot / screen-recording capture (macOS `screencapture`) and video
//! keyframe extraction (ffmpeg). Videos attach to messages as a set of
//! time-ordered keyframe images plus a text description — the engine protocol
//! only understands image paths, so the conversion happens here.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

/// The in-flight `screencapture -v` process, if a recording is running.
#[derive(Default)]
pub struct Recorder {
    inner: Mutex<Option<(Child, PathBuf)>>,
}

fn capture_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("jucode-capture");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn require_macos() -> Result<(), String> {
    if std::env::consts::OS == "macos" {
        Ok(())
    } else {
        Err("截图/录屏目前仅支持 macOS".to_string())
    }
}

/// Interactive region/window screenshot. Returns None when the user cancels
/// (Esc) — screencapture exits non-zero and writes nothing in that case.
#[tauri::command(async)]
pub fn capture_screenshot() -> Result<Option<String>, String> {
    require_macos()?;
    let path = capture_dir()?.join(format!("shot-{}.png", stamp()));
    let status = Command::new("screencapture")
        .arg("-i") // interactive selection (space toggles window mode)
        .arg("-x") // no shutter sound
        .arg(&path)
        .status()
        .map_err(|e| format!("failed to run screencapture: {e}"))?;
    if !status.success() || !path.exists() {
        return Ok(None);
    }
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub fn start_screen_recording(rec: tauri::State<Recorder>) -> Result<(), String> {
    require_macos()?;
    let mut guard = rec.inner.lock().map_err(|e| format!("lock poisoned: {e}"))?;
    if guard.is_some() {
        return Err("已有录屏进行中".to_string());
    }
    let path = capture_dir()?.join(format!("rec-{}.mov", stamp()));
    let child = Command::new("screencapture")
        .arg("-v") // record video until stopped
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start screencapture: {e}"))?;
    *guard = Some((child, path));
    Ok(())
}

/// Stops the recording (SIGINT lets screencapture finalize the file) and
/// returns the .mov path.
#[tauri::command(async)]
pub fn stop_screen_recording(rec: tauri::State<'_, Recorder>) -> Result<String, String> {
    let taken = rec
        .inner
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .take();
    let (mut child, path) = taken.ok_or_else(|| "当前没有进行中的录屏".to_string())?;
    let _ = Command::new("kill")
        .arg("-INT")
        .arg(child.id().to_string())
        .status();
    let _ = child.wait();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        let _ = std::fs::remove_file(&path);
        return Err(
            "录屏文件未生成——请在 系统设置 → 隐私与安全性 → 屏幕录制 中授权 JuCode 后重试"
                .to_string(),
        );
    }
    Ok(path.display().to_string())
}

/// Locates ffmpeg/ffprobe: PATH first, then the usual Homebrew/MacPorts dirs
/// (the packaged .app doesn't inherit a shell PATH).
fn find_tool(name: &str) -> Result<PathBuf, String> {
    if let Some(p) = crate::which(name) {
        return Ok(p);
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "未找到 {name}。视频抽帧需要 ffmpeg，请先安装：brew install ffmpeg"
    ))
}

#[derive(Serialize)]
pub struct VideoInfo {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub frames: Vec<String>,
}

/// Extracts evenly-spaced keyframes from a video (scaled to ≤1280px wide JPEGs
/// so each stays well under the engine's per-image size cap) and probes basic
/// metadata for the text description.
#[tauri::command(async)]
pub fn process_video(path: String, max_frames: Option<u32>) -> Result<VideoInfo, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    let ffprobe = find_tool("ffprobe")?;
    let ffmpeg = find_tool("ffmpeg")?;

    let out = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(&src)
        .output()
        .map_err(|e| format!("failed to run ffprobe: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ffprobe 解析失败: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let probe: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("ffprobe 输出解析失败: {e}"))?;
    let duration = probe
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    let stream = probe.get("streams").and_then(|s| s.get(0));
    let width = stream
        .and_then(|s| s.get("width"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let height = stream
        .and_then(|s| s.get("height"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    // Roughly one frame per 5s, clamped to [1, cap]; a broken/zero duration
    // still yields the first frame.
    let cap = max_frames.unwrap_or(8).clamp(1, 12) as usize;
    let n = if duration > 0.0 {
        ((duration / 5.0).ceil() as usize).clamp(3.min(cap), cap)
    } else {
        1
    };

    let dir = capture_dir()?;
    let batch = stamp();
    let mut frames = Vec::new();
    for i in 0..n {
        let t = if duration > 0.0 {
            duration * ((i as f64 + 0.5) / n as f64)
        } else {
            0.0
        };
        let frame_path = dir.join(format!("frame-{batch}-{i:02}.jpg"));
        let status = Command::new(&ffmpeg)
            .args(["-v", "error", "-ss", &format!("{t:.3}"), "-i"])
            .arg(&src)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale='min(1280,iw)':-2",
                "-q:v",
                "4",
                "-y",
            ])
            .arg(&frame_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("failed to run ffmpeg: {e}"))?;
        if status.success() && frame_path.exists() {
            frames.push(frame_path.display().to_string());
        }
    }
    if frames.is_empty() {
        return Err("无法从视频中提取关键帧".to_string());
    }
    Ok(VideoInfo {
        path,
        duration,
        width,
        height,
        frames,
    })
}
