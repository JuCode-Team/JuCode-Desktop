//! External editors a project or file opens in: which are installed and how
//! each family is launched. macOS finds the app bundles and runs the command
//! line tool inside them (a GUI app's PATH rarely has `code`); Windows and
//! Linux find the editors' command line tools on PATH.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

/// How an editor takes a folder, or a file at a line.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Family {
    /// VS Code and its forks: `code <root> -g <file>:<line>:<col>`.
    Code,
    /// `zed <root> <file>:<line>:<col>`.
    Zed,
    /// `subl <root> <file>:<line>:<col>`.
    Sublime,
    /// `idea --line <line> <file>`; on macOS through `open -na <app> --args`.
    JetBrains,
    /// `open -a Xcode <path>` (macOS only).
    Xcode,
}

struct Editor {
    id: &'static str,
    name: &'static str,
    family: Family,
    /// macOS app bundle names, without `.app` (JetBrains Toolbox and the
    /// standalone installers name some differently).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    apps: &'static [&'static str],
    /// The command line tool inside the bundle, relative to `Contents/`.
    bundle_cli: &'static str,
    /// Command names on PATH (Windows, Linux).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    clis: &'static [&'static str],
}

const fn code(id: &'static str, name: &'static str, apps: &'static [&'static str], bundle_cli: &'static str, clis: &'static [&'static str]) -> Editor {
    Editor { id, name, family: Family::Code, apps, bundle_cli, clis }
}
const fn jetbrains(id: &'static str, name: &'static str, apps: &'static [&'static str], clis: &'static [&'static str]) -> Editor {
    Editor { id, name, family: Family::JetBrains, apps, bundle_cli: "", clis }
}

const EDITORS: &[Editor] = &[
    code("vscode", "VS Code", &["Visual Studio Code"], "Resources/app/bin/code", &["code"]),
    code("vscode-insiders", "VS Code Insiders", &["Visual Studio Code - Insiders"], "Resources/app/bin/code-insiders", &["code-insiders"]),
    code("cursor", "Cursor", &["Cursor"], "Resources/app/bin/cursor", &["cursor"]),
    code("windsurf", "Windsurf", &["Windsurf"], "Resources/app/bin/windsurf", &["windsurf"]),
    code("vscodium", "VSCodium", &["VSCodium"], "Resources/app/bin/codium", &["codium"]),
    Editor { id: "zed", name: "Zed", family: Family::Zed, apps: &["Zed"], bundle_cli: "MacOS/cli", clis: &["zed", "zeditor"] },
    Editor { id: "sublime", name: "Sublime Text", family: Family::Sublime, apps: &["Sublime Text"], bundle_cli: "SharedSupport/bin/subl", clis: &["subl"] },
    Editor { id: "xcode", name: "Xcode", family: Family::Xcode, apps: &["Xcode"], bundle_cli: "", clis: &[] },
    jetbrains("idea", "IntelliJ IDEA", &["IntelliJ IDEA", "IntelliJ IDEA Ultimate"], &["idea"]),
    jetbrains("idea-ce", "IntelliJ IDEA CE", &["IntelliJ IDEA CE", "IntelliJ IDEA Community Edition"], &[]),
    jetbrains("webstorm", "WebStorm", &["WebStorm"], &["webstorm"]),
    jetbrains("pycharm", "PyCharm", &["PyCharm", "PyCharm Professional Edition"], &["pycharm"]),
    jetbrains("pycharm-ce", "PyCharm CE", &["PyCharm CE", "PyCharm Community Edition"], &[]),
    jetbrains("goland", "GoLand", &["GoLand"], &["goland"]),
    jetbrains("clion", "CLion", &["CLion"], &["clion"]),
    jetbrains("rustrover", "RustRover", &["RustRover"], &["rustrover"]),
    jetbrains("phpstorm", "PhpStorm", &["PhpStorm"], &["phpstorm"]),
    jetbrains("rider", "Rider", &["Rider"], &["rider"]),
    jetbrains("rubymine", "RubyMine", &["RubyMine"], &["rubymine"]),
    jetbrains("android-studio", "Android Studio", &["Android Studio"], &["studio"]),
];

#[derive(Serialize)]
pub struct EditorInfo {
    id: &'static str,
    name: &'static str,
    /// The app's own icon as a PNG data URL (macOS); none elsewhere.
    icon: Option<String>,
}

/// Where an installed editor is: its app bundle (macOS) or its command line
/// tool (Windows, Linux).
enum Install {
    #[allow(dead_code)] // built on macOS only
    App(PathBuf),
    #[allow(dead_code)] // built off macOS only
    Cli(PathBuf),
}

#[cfg(target_os = "macos")]
fn locate(e: &Editor) -> Option<Install> {
    let home = crate::backend::home_dir();
    let dirs = [PathBuf::from("/Applications"), home.join("Applications"), home.join("Applications/JetBrains Toolbox")];
    let app = e.apps.iter().flat_map(|a| dirs.iter().map(move |d| d.join(format!("{a}.app")))).find(|p| p.is_dir())?;
    // A bundle without its command line tool can't take a line number; the
    // editor is left out rather than opened some other way.
    if !e.bundle_cli.is_empty() && !app.join("Contents").join(e.bundle_cli).is_file() {
        return None;
    }
    Some(Install::App(app))
}

#[cfg(not(target_os = "macos"))]
fn locate(e: &Editor) -> Option<Install> {
    e.clis.iter().find_map(|c| crate::which(c)).map(Install::Cli)
}

/// The editors installed on this computer, in the order of EDITORS. Async:
/// the first call converts icons, off the main thread.
#[tauri::command(async)]
pub fn list_editors() -> Vec<EditorInfo> {
    EDITORS
        .iter()
        .filter_map(|e| {
            let install = locate(e)?;
            let icon = match &install {
                Install::App(app) => app_icon(app),
                Install::Cli(_) => None,
            };
            Some(EditorInfo { id: e.id, name: e.name, icon })
        })
        .collect()
}

/// The bundle's icon (CFBundleIconFile) converted by `sips` to a 64 px PNG,
/// cached for the life of the app. None when the app keeps its icon only in
/// an asset catalog; the UI then shows a generic one.
fn app_icon(app: &Path) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().ok()?.get(app) {
        return hit.clone();
    }
    let icon = render_icon(app);
    cache.lock().ok()?.insert(app.to_path_buf(), icon.clone());
    icon
}

fn render_icon(app: &Path) -> Option<String> {
    use base64::Engine;
    let plist = app.join("Contents/Info.plist");
    let out = Command::new("/usr/bin/defaults").arg("read").arg(&plist).arg("CFBundleIconFile").output().ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || name.is_empty() {
        return None;
    }
    let file = if name.ends_with(".icns") { name } else { format!("{name}.icns") };
    let icns = app.join("Contents/Resources").join(file);
    static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let png = std::env::temp_dir().join(format!("jucode-editor-icon-{}-{seq}.png", std::process::id()));
    let ok = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png", "-Z", "64"])
        .arg(&icns)
        .arg("--out")
        .arg(&png)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let bytes = ok.then(|| std::fs::read(&png).ok()).flatten();
    let _ = std::fs::remove_file(&png);
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes?)))
}

/// Opens `path` (a folder, or a file at `line`/`col`) in the editor `id`. A
/// file opens in the window of `root` (the project) where the editor can.
#[tauri::command(async)]
pub fn open_in_editor(id: String, path: String, line: Option<u32>, col: Option<u32>, root: Option<String>) -> Result<(), String> {
    let e = EDITORS.iter().find(|e| e.id == id).ok_or_else(|| format!("unknown editor: {id}"))?;
    let target = PathBuf::from(&path);
    // Absolute and existing: the path can't read as an option (`-x`), and a
    // reply can't make the editor create a file.
    if !target.is_absolute() || !target.exists() {
        return Err(format!("not found: {path}"));
    }
    let root = root.map(PathBuf::from).filter(|r| r.is_absolute() && r.is_dir() && target.is_file() && target.starts_with(r));
    let install = locate(e).ok_or_else(|| format!("{} is not installed", e.name))?;
    let mut cmd = command(e, &install, &target, line, col, root.as_deref());
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|err| format!("{}: {err}", e.name))?;
    // The tools hand the path to the running editor and exit; reap them.
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn command(e: &Editor, install: &Install, target: &Path, line: Option<u32>, col: Option<u32>, root: Option<&Path>) -> Command {
    let args = editor_args(e.family, target, line, col, root);
    match install {
        Install::Cli(cli) => {
            let mut cmd = Command::new(cli);
            cmd.args(args);
            cmd
        }
        Install::App(app) => match e.family {
            Family::JetBrains => {
                let mut cmd = Command::new("/usr/bin/open");
                cmd.arg("-na").arg(app).arg("--args").args(args);
                cmd
            }
            Family::Xcode => {
                let mut cmd = Command::new("/usr/bin/open");
                cmd.arg("-a").arg(app).arg(xcode_target(target));
                cmd
            }
            _ => {
                let mut cmd = Command::new(app.join("Contents").join(e.bundle_cli));
                cmd.args(args);
                cmd
            }
        },
    }
}

fn editor_args(family: Family, target: &Path, line: Option<u32>, col: Option<u32>, root: Option<&Path>) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = Vec::new();
    if target.is_dir() {
        args.push(target.into());
        return args;
    }
    let at = {
        let mut s = target.as_os_str().to_owned();
        if let Some(l) = line {
            s.push(format!(":{l}"));
            if let Some(c) = col {
                s.push(format!(":{c}"));
            }
        }
        s
    };
    match family {
        Family::Code => {
            args.extend(root.map(|r| r.into()));
            args.push("-g".into());
            args.push(at);
        }
        Family::Zed | Family::Sublime => {
            args.extend(root.map(|r| r.into()));
            args.push(at);
        }
        Family::JetBrains => {
            // The file opens in whichever open project holds it.
            if let Some(l) = line {
                args.push("--line".into());
                args.push(l.to_string().into());
            }
            args.push(target.into());
        }
        Family::Xcode => args.push(target.into()),
    }
    args
}

/// A folder opens in Xcode as the workspace, project or package in it, if any.
fn xcode_target(target: &Path) -> PathBuf {
    if !target.is_dir() {
        return target.to_path_buf();
    }
    let Ok(entries) = std::fs::read_dir(target) else {
        return target.to_path_buf();
    };
    let names: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    let with_ext = |ext: &str| names.iter().find(|p| p.extension().is_some_and(|x| x == ext)).cloned();
    with_ext("xcworkspace")
        .or_else(|| with_ext("xcodeproj"))
        .or_else(|| names.iter().find(|p| p.file_name().is_some_and(|n| n == "Package.swift")).cloned())
        .unwrap_or_else(|| target.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_per_family() {
        let dir = std::env::temp_dir().join(format!("jucode-editors-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("App.xcodeproj")).unwrap();
        let file = dir.join("a.ts");
        std::fs::write(&file, "").unwrap();
        let s = |v: Vec<std::ffi::OsString>| v.into_iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let f = file.display().to_string();
        let d = dir.display().to_string();
        assert_eq!(s(editor_args(Family::Code, &file, Some(12), Some(4), Some(&dir))), vec![d.clone(), "-g".into(), format!("{f}:12:4")]);
        assert_eq!(s(editor_args(Family::Code, &file, None, None, None)), vec!["-g".to_string(), f.clone()]);
        assert_eq!(s(editor_args(Family::Zed, &file, Some(3), None, Some(&dir))), vec![d.clone(), format!("{f}:3")]);
        assert_eq!(s(editor_args(Family::JetBrains, &file, Some(3), Some(9), Some(&dir))), vec!["--line".to_string(), "3".into(), f.clone()]);
        assert_eq!(s(editor_args(Family::JetBrains, &dir, Some(3), None, None)), vec![d.clone()]);
        assert_eq!(xcode_target(&dir), dir.join("App.xcodeproj"));
        assert_eq!(xcode_target(&file), file);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_refuses_relative_and_missing_paths() {
        assert!(open_in_editor("vscode".into(), "src/a.ts".into(), None, None, None).is_err());
        assert!(open_in_editor("vscode".into(), "/nonexistent/a.ts".into(), None, None, None).is_err());
        assert!(open_in_editor("nope".into(), "/".into(), None, None, None).is_err());
    }
}
