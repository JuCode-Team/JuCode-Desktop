//! Screenshot / screen-recording capture and video keyframe extraction
//! (ffmpeg). Capture shells out to per-platform tools — macOS `screencapture`,
//! Windows PowerShell/GDI + the Snipping-Tool overlay, Linux
//! grim/gnome-screenshot/spectacle/scrot — resolved once per call via a small
//! backend enum. Videos attach to messages as a set of time-ordered keyframe
//! images plus a text description — the engine protocol only understands image
//! paths, so the conversion happens here.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

/// How to ask the in-flight recorder process to finalize its file.
#[derive(Clone, Copy, Debug, PartialEq)]
enum StopMethod {
    /// SIGINT — `screencapture -v` and `wf-recorder` finalize on it (unix only).
    SigInt,
    /// Write `q` to stdin — ffmpeg's interactive quit key (works on Windows,
    /// where there is no SIGINT for GUI children).
    QuitKey,
}

/// The in-flight recording process, if any.
#[derive(Default)]
pub struct Recorder {
    inner: Mutex<Option<(Child, PathBuf, StopMethod)>>,
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

/// On Windows, hide the transient console window of helper processes
/// (PowerShell, ffmpeg). No-op elsewhere.
fn hide_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn has_tool(name: &str) -> bool {
    crate::which(name).is_some()
}

// ---------------------------------------------------------------------------
// Backend selection (pure — unit tested with a mocked availability probe)
// ---------------------------------------------------------------------------

/// Screenshot backend, resolved once per capture call.
#[derive(Clone, Copy, Debug, PartialEq)]
enum ShotBackend {
    /// macOS `screencapture -i` (interactive region/window).
    MacScreencapture,
    /// Windows: Snipping-Tool overlay (`ms-screenclip:`) + clipboard poll,
    /// falling back to a PowerShell/GDI full-screen grab.
    WinSnip,
    /// Wayland: `grim`, with `slurp` for interactive region selection.
    Grim { slurp: bool },
    /// `gnome-screenshot -a -f` (area selection).
    GnomeScreenshot,
    /// KDE `spectacle -b -n -r -o` (region selection).
    Spectacle,
    /// X11 `scrot -s` (region selection).
    Scrot,
}

fn pick_shot_backend(
    os: &str,
    wayland: bool,
    has: &dyn Fn(&str) -> bool,
) -> Result<ShotBackend, String> {
    match os {
        "macos" => Ok(ShotBackend::MacScreencapture),
        "windows" => Ok(ShotBackend::WinSnip),
        "linux" => {
            if wayland && has("grim") {
                return Ok(ShotBackend::Grim { slurp: has("slurp") });
            }
            if has("gnome-screenshot") {
                return Ok(ShotBackend::GnomeScreenshot);
            }
            if has("spectacle") {
                return Ok(ShotBackend::Spectacle);
            }
            if !wayland && has("scrot") {
                return Ok(ShotBackend::Scrot);
            }
            Err("未找到可用的截图工具（找过 grim / gnome-screenshot / spectacle / scrot）。请安装其中之一，例如 sudo apt-get install gnome-screenshot，Wayland 推荐 grim + slurp。/ No screenshot tool found (looked for grim / gnome-screenshot / spectacle / scrot). Install one, e.g. sudo apt-get install gnome-screenshot; on Wayland prefer grim + slurp.".to_string())
        }
        other => Err(format!(
            "当前平台不支持截图：{other} / Screenshots are not supported on this platform: {other}"
        )),
    }
}

/// Screen-recording backend, resolved once when recording starts.
#[derive(Clone, Copy, Debug, PartialEq)]
enum RecBackend {
    /// macOS `screencapture -v`.
    MacScreencapture,
    /// Windows ffmpeg `gdigrab` desktop capture.
    FfmpegGdigrab,
    /// Wayland `wf-recorder`.
    WfRecorder,
    /// X11 ffmpeg `x11grab`.
    FfmpegX11grab,
}

fn pick_rec_backend(
    os: &str,
    wayland: bool,
    has: &dyn Fn(&str) -> bool,
) -> Result<RecBackend, String> {
    match os {
        "macos" => Ok(RecBackend::MacScreencapture),
        "windows" => {
            if has("ffmpeg") {
                Ok(RecBackend::FfmpegGdigrab)
            } else {
                Err("录屏需要 ffmpeg，未在 PATH 中找到。请安装后重试：winget install Gyan.FFmpeg / Screen recording needs ffmpeg, which was not found on PATH. Install it and retry: winget install Gyan.FFmpeg".to_string())
            }
        }
        "linux" => {
            if wayland {
                if has("wf-recorder") {
                    Ok(RecBackend::WfRecorder)
                } else {
                    Err("Wayland 下录屏需要 wf-recorder，未找到。请安装后重试（例如 sudo apt-get install wf-recorder）。/ Screen recording on Wayland needs wf-recorder, which was not found. Install it and retry (e.g. sudo apt-get install wf-recorder).".to_string())
                }
            } else if has("ffmpeg") {
                Ok(RecBackend::FfmpegX11grab)
            } else {
                Err("录屏需要 ffmpeg，未找到。请安装后重试（例如 sudo apt-get install ffmpeg）。/ Screen recording needs ffmpeg, which was not found. Install it and retry (e.g. sudo apt-get install ffmpeg).".to_string())
            }
        }
        other => Err(format!(
            "当前平台不支持录屏：{other} / Screen recording is not supported on this platform: {other}"
        )),
    }
}

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

/// Interactive region/window screenshot. Returns None when the user cancels —
/// the tools exit non-zero and/or write nothing in that case.
#[tauri::command(async)]
pub fn capture_screenshot() -> Result<Option<String>, String> {
    let backend = pick_shot_backend(std::env::consts::OS, is_wayland(), &has_tool)?;
    let path = capture_dir()?.join(format!("shot-{}.png", stamp()));
    match backend {
        ShotBackend::MacScreencapture => {
            let status = Command::new("screencapture")
                .arg("-i") // interactive selection (space toggles window mode)
                .arg("-x") // no shutter sound
                .arg(&path)
                .status()
                .map_err(|e| format!("failed to run screencapture: {e}"))?;
            if !status.success() || !path.exists() {
                return Ok(None);
            }
        }
        ShotBackend::WinSnip => return win_capture_screenshot(&path),
        ShotBackend::Grim { slurp } => {
            if slurp {
                // slurp prints the selected geometry ("x,y wxh"); Esc → non-zero.
                let out = Command::new("slurp")
                    .output()
                    .map_err(|e| format!("failed to run slurp: {e}"))?;
                if !out.status.success() {
                    return Ok(None);
                }
                let geom = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if geom.is_empty() {
                    return Ok(None);
                }
                let status = Command::new("grim")
                    .arg("-g")
                    .arg(&geom)
                    .arg(&path)
                    .status()
                    .map_err(|e| format!("failed to run grim: {e}"))?;
                if !status.success() || !path.exists() {
                    return Ok(None);
                }
            } else {
                // No slurp — full-screen grab.
                let status = Command::new("grim")
                    .arg(&path)
                    .status()
                    .map_err(|e| format!("failed to run grim: {e}"))?;
                if !status.success() || !path.exists() {
                    return Ok(None);
                }
            }
        }
        ShotBackend::GnomeScreenshot => {
            // -a: area selection. On cancel it may still exit 0 but writes no file.
            let _ = Command::new("gnome-screenshot")
                .arg("-a")
                .arg("-f")
                .arg(&path)
                .status()
                .map_err(|e| format!("failed to run gnome-screenshot: {e}"))?;
            if !path.exists() {
                return Ok(None);
            }
        }
        ShotBackend::Spectacle => {
            // -b: no GUI, -n: no notification, -r: region selection.
            let _ = Command::new("spectacle")
                .args(["-b", "-n", "-r", "-o"])
                .arg(&path)
                .status()
                .map_err(|e| format!("failed to run spectacle: {e}"))?;
            if !path.exists() {
                return Ok(None);
            }
        }
        ShotBackend::Scrot => {
            // -s: interactive region selection; Esc → non-zero.
            let status = Command::new("scrot")
                .arg("-s")
                .arg(&path)
                .status()
                .map_err(|e| format!("failed to run scrot: {e}"))?;
            if !status.success() || !path.exists() {
                return Ok(None);
            }
        }
    }
    Ok(Some(path.display().to_string()))
}

/// Escapes a path for interpolation inside a single-quoted PowerShell string.
fn ps_quote(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

/// Runs a PowerShell snippet (hidden window, STA for clipboard access).
fn run_powershell(script: &str) -> Result<std::process::ExitStatus, String> {
    hide_console(
        Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
    )
    .status()
    .map_err(|e| format!("failed to run powershell: {e}"))
}

/// Windows screenshot: best-effort interactive region capture via the
/// Snipping-Tool overlay (`ms-screenclip:`), reading the result from the
/// clipboard; falls back to a reliable PowerShell/GDI full-screen grab when the
/// overlay can't be launched.
fn win_capture_screenshot(path: &Path) -> Result<Option<String>, String> {
    // Clear any stale clipboard image so the poll only sees the fresh snip.
    let _ = run_powershell(
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()",
    );
    let overlay = hide_console(
        Command::new("explorer.exe")
            .arg("ms-screenclip:")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
    )
    .spawn();
    if overlay.is_err() {
        // Overlay unavailable — reliable full-screen path.
        return win_capture_fullscreen(path).map(Some);
    }
    // Poll the clipboard for the snipped image (user may take a while to select).
    let save = format!(
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $i=[System.Windows.Forms.Clipboard]::GetImage(); if ($i) {{ $i.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png); exit 0 }} exit 1",
        ps_quote(path)
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(800));
        if let Ok(status) = run_powershell(&save) {
            if status.success() && path.exists() {
                return Ok(Some(path.display().to_string()));
            }
        }
    }
    Err("截图超时：未从剪贴板读到截取的图片（可能已取消截图）。/ Screenshot timed out: no snipped image appeared on the clipboard (the snip may have been cancelled).".to_string())
}

/// Full-virtual-screen PNG via .NET System.Drawing — no extra dependencies.
fn win_capture_fullscreen(path: &Path) -> Result<String, String> {
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()",
        ps_quote(path)
    );
    let status = run_powershell(&script)?;
    if !status.success() || !path.exists() {
        return Err("全屏截图失败（PowerShell/GDI 捕获未生成文件）。/ Full-screen capture failed (the PowerShell/GDI grab produced no file).".to_string());
    }
    Ok(path.display().to_string())
}

// ---------------------------------------------------------------------------
// Screen recording
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn start_screen_recording(rec: tauri::State<Recorder>) -> Result<(), String> {
    let backend = pick_rec_backend(std::env::consts::OS, is_wayland(), &has_tool)?;
    let mut guard = rec.inner.lock().map_err(|e| format!("lock poisoned: {e}"))?;
    if guard.is_some() {
        return Err("已有录屏进行中 / A screen recording is already in progress".to_string());
    }
    let dir = capture_dir()?;
    let (child, path, stop) = match backend {
        RecBackend::MacScreencapture => {
            let path = dir.join(format!("rec-{}.mov", stamp()));
            let child = Command::new("screencapture")
                .arg("-v") // record video until stopped
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("failed to start screencapture: {e}"))?;
            (child, path, StopMethod::SigInt)
        }
        RecBackend::FfmpegGdigrab => {
            let path = dir.join(format!("rec-{}.mp4", stamp()));
            let child = hide_console(
                Command::new("ffmpeg")
                    .args(["-y", "-f", "gdigrab", "-framerate", "15", "-i", "desktop"])
                    .args(["-pix_fmt", "yuv420p"])
                    .arg(&path)
                    .stdin(Stdio::piped()) // stop via the interactive 'q' key
                    .stdout(Stdio::null())
                    .stderr(Stdio::null()),
            )
            .spawn()
            .map_err(|e| format!("failed to start ffmpeg: {e}"))?;
            (child, path, StopMethod::QuitKey)
        }
        RecBackend::WfRecorder => {
            let path = dir.join(format!("rec-{}.mp4", stamp()));
            let child = Command::new("wf-recorder")
                .arg("-f")
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("failed to start wf-recorder: {e}"))?;
            (child, path, StopMethod::SigInt)
        }
        RecBackend::FfmpegX11grab => {
            let path = dir.join(format!("rec-{}.mp4", stamp()));
            let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0.0".to_string());
            let child = Command::new("ffmpeg")
                .args(["-y", "-f", "x11grab", "-framerate", "15", "-i", &display])
                .args(["-pix_fmt", "yuv420p"])
                .arg(&path)
                .stdin(Stdio::piped()) // stop via the interactive 'q' key
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("failed to start ffmpeg: {e}"))?;
            (child, path, StopMethod::QuitKey)
        }
    };
    *guard = Some((child, path, stop));
    Ok(())
}

/// Asks the recorder to finalize (SIGINT for screencapture/wf-recorder, 'q' on
/// stdin for ffmpeg) and returns the video path.
#[tauri::command(async)]
pub fn stop_screen_recording(rec: tauri::State<'_, Recorder>) -> Result<String, String> {
    let taken = rec
        .inner
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?
        .take();
    let (mut child, path, stop) =
        taken.ok_or_else(|| "当前没有进行中的录屏 / No screen recording in progress".to_string())?;
    match stop {
        StopMethod::SigInt => {
            let _ = Command::new("kill")
                .arg("-INT")
                .arg(child.id().to_string())
                .status();
        }
        StopMethod::QuitKey => {
            let wrote = child
                .stdin
                .as_mut()
                .and_then(|stdin| stdin.write_all(b"q").and_then(|_| stdin.flush()).ok())
                .is_some();
            // stdin gone (ffmpeg died?) — fall back to SIGINT where it exists.
            if !wrote && cfg!(unix) {
                let _ = Command::new("kill")
                    .arg("-INT")
                    .arg(child.id().to_string())
                    .status();
            }
            drop(child.stdin.take()); // close the pipe so ffmpeg sees EOF too
        }
    }
    let _ = child.wait();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        let _ = std::fs::remove_file(&path);
        let hint = if std::env::consts::OS == "macos" {
            "录屏文件未生成——请在 系统设置 → 隐私与安全性 → 屏幕录制 中授权 JuCode 后重试 / No recording was produced — grant JuCode screen-recording permission in System Settings → Privacy & Security → Screen Recording and retry"
        } else {
            "录屏文件未生成——录制工具未输出任何数据，请检查录屏工具与显示服务器权限后重试 / No recording was produced — the capture tool wrote no data; check the tool and display-server permissions and retry"
        };
        return Err(hint.to_string());
    }
    Ok(path.display().to_string())
}

// ---------------------------------------------------------------------------
// Video keyframe extraction (cross-platform, requires ffmpeg/ffprobe)
// ---------------------------------------------------------------------------

/// Locates ffmpeg/ffprobe: PATH first, then the usual install dirs — the
/// packaged app doesn't inherit a shell PATH.
fn find_tool(name: &str) -> Result<PathBuf, String> {
    if let Some(p) = crate::which(name) {
        return Ok(p);
    }
    if cfg!(windows) {
        let file = format!("{name}.exe");
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Some(la) = std::env::var_os("LOCALAPPDATA") {
            // winget (Gyan.FFmpeg) shim directory.
            dirs.push(PathBuf::from(la).join("Microsoft").join("WinGet").join("Links"));
        }
        dirs.push(PathBuf::from("C:\\ffmpeg\\bin"));
        for dir in dirs {
            let candidate = dir.join(&file);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    } else {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"] {
            let candidate = Path::new(dir).join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    let hint = match std::env::consts::OS {
        "macos" => "brew install ffmpeg",
        "windows" => "winget install Gyan.FFmpeg",
        _ => "sudo apt-get install ffmpeg（或使用发行版对应的包管理器 / or your distro's package manager）",
    };
    Err(format!(
        "未找到 {name}。视频抽帧需要 ffmpeg，请先安装：{hint} / {name} not found. Video keyframe extraction needs ffmpeg — install it first: {hint}"
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

// ---------------------------------------------------------------------------
// Tests — backend selection only; nothing here spawns real capture tools.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(set: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |name| set.contains(&name)
    }

    // --- screenshot backend ---

    #[test]
    fn macos_always_uses_screencapture() {
        let got = pick_shot_backend("macos", false, &avail(&[])).unwrap();
        assert_eq!(got, ShotBackend::MacScreencapture);
    }

    #[test]
    fn windows_always_uses_snip_flow() {
        let got = pick_shot_backend("windows", false, &avail(&[])).unwrap();
        assert_eq!(got, ShotBackend::WinSnip);
    }

    #[test]
    fn wayland_prefers_grim_with_slurp() {
        let got =
            pick_shot_backend("linux", true, &avail(&["grim", "slurp", "gnome-screenshot"]))
                .unwrap();
        assert_eq!(got, ShotBackend::Grim { slurp: true });
    }

    #[test]
    fn wayland_grim_without_slurp_still_selected() {
        let got = pick_shot_backend("linux", true, &avail(&["grim"])).unwrap();
        assert_eq!(got, ShotBackend::Grim { slurp: false });
    }

    #[test]
    fn wayland_without_grim_falls_back_to_gnome_screenshot() {
        let got =
            pick_shot_backend("linux", true, &avail(&["gnome-screenshot", "spectacle"])).unwrap();
        assert_eq!(got, ShotBackend::GnomeScreenshot);
    }

    #[test]
    fn x11_ignores_grim_and_probes_in_order() {
        // grim is wayland-only: never picked on X11 even if installed.
        let got = pick_shot_backend("linux", false, &avail(&["grim", "spectacle", "scrot"]))
            .unwrap();
        assert_eq!(got, ShotBackend::Spectacle);
        let got = pick_shot_backend("linux", false, &avail(&["grim", "scrot"])).unwrap();
        assert_eq!(got, ShotBackend::Scrot);
        let got = pick_shot_backend(
            "linux",
            false,
            &avail(&["gnome-screenshot", "spectacle", "scrot"]),
        )
        .unwrap();
        assert_eq!(got, ShotBackend::GnomeScreenshot);
    }

    #[test]
    fn scrot_not_used_on_wayland() {
        let err = pick_shot_backend("linux", true, &avail(&["scrot"])).unwrap_err();
        assert!(err.contains("grim"), "error should suggest tools: {err}");
    }

    #[test]
    fn linux_without_tools_errors_with_suggestions() {
        let err = pick_shot_backend("linux", false, &avail(&[])).unwrap_err();
        assert!(err.contains("gnome-screenshot") && err.contains("No screenshot tool"));
    }

    // --- recording backend ---

    #[test]
    fn macos_records_with_screencapture() {
        let got = pick_rec_backend("macos", false, &avail(&[])).unwrap();
        assert_eq!(got, RecBackend::MacScreencapture);
    }

    #[test]
    fn windows_records_with_ffmpeg_gdigrab() {
        let got = pick_rec_backend("windows", false, &avail(&["ffmpeg"])).unwrap();
        assert_eq!(got, RecBackend::FfmpegGdigrab);
    }

    #[test]
    fn windows_without_ffmpeg_errors_naming_ffmpeg() {
        let err = pick_rec_backend("windows", false, &avail(&[])).unwrap_err();
        assert!(err.contains("ffmpeg") && err.contains("winget"));
    }

    #[test]
    fn wayland_records_with_wf_recorder_only() {
        let got = pick_rec_backend("linux", true, &avail(&["wf-recorder", "ffmpeg"])).unwrap();
        assert_eq!(got, RecBackend::WfRecorder);
        // ffmpeg alone is not enough on wayland.
        let err = pick_rec_backend("linux", true, &avail(&["ffmpeg"])).unwrap_err();
        assert!(err.contains("wf-recorder"));
    }

    #[test]
    fn x11_records_with_ffmpeg_x11grab() {
        let got = pick_rec_backend("linux", false, &avail(&["ffmpeg"])).unwrap();
        assert_eq!(got, RecBackend::FfmpegX11grab);
        let err = pick_rec_backend("linux", false, &avail(&[])).unwrap_err();
        assert!(err.contains("ffmpeg"));
    }
}
