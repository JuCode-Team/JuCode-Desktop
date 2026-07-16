//! Auto-install planning for the external tools the desktop drives.
//!
//! Planning is pure (per tool × OS, driven by a mocked availability probe) and
//! unit-tested here; the actual run/stream lives in `lib.rs::run_install`, which
//! spawns a `Plan::Run` and pumps its output to the webview.
//!
//! Model per platform:
//!   - system tools (node, ffmpeg): Windows → winget, macOS → brew, Linux → a
//!     copyable `sudo <pkg-manager>` command (the GUI never runs sudo itself).
//!   - npm tools (codex, jucode): `npm install -g <pkg>` on every platform,
//!     gated on npm being present (else NeedsPrereq "node").
//!   - claude: the official native installer (Windows PowerShell one-liner,
//!     macOS/Linux curl|bash) — no sudo, user-local.

use serde::Serialize;

/// A tool the setup / dependencies UI can install.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dep {
    /// Node.js — also provides `npm`, the prerequisite for the npm tools.
    Node,
    /// ffmpeg — required for screen recording (see `capture.rs`).
    Ffmpeg,
    /// OpenAI Codex CLI (`@openai/codex`).
    Codex,
    /// JuCode CLI (`@jucode/cli`) — the default engine.
    Jucode,
    /// Claude Code CLI (native installer).
    Claude,
}

impl Dep {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "node" | "npm" => Some(Self::Node),
            "ffmpeg" => Some(Self::Ffmpeg),
            "codex" => Some(Self::Codex),
            "jucode" => Some(Self::Jucode),
            "claude" => Some(Self::Claude),
            _ => None,
        }
    }

    /// The binary whose presence on PATH means the tool is installed.
    pub fn bin(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Ffmpeg => "ffmpeg",
            Self::Codex => "codex",
            Self::Jucode => "jucode",
            Self::Claude => "claude",
        }
    }

    /// Stable id used by the frontend / `run_install`.
    pub fn id(self) -> &'static str {
        self.bin()
    }
}

/// What installing a dep entails on this machine — the UI renders each variant
/// and `run_install` acts on it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Plan {
    /// The app runs `program args…` and streams its output (winget / brew /
    /// npm / the claude installer). `program` is a logical name resolved through
    /// PATH at spawn time (e.g. `npm` → `npm.cmd` on Windows).
    Run { program: String, args: Vec<String> },
    /// Show a copyable command — Linux system packages need sudo, which the GUI
    /// never runs itself.
    Manual { command: String },
    /// No automated path here; open the official download page.
    OpenUrl { url: String },
    /// A prerequisite is missing (e.g. npm for the npm tools) — install it first.
    NeedsPrereq { prereq: String },
}

const NODE_URL: &str = "https://nodejs.org/en/download";
const FFMPEG_URL: &str = "https://ffmpeg.org/download.html";

/// Copyable `sudo` install command for the detected Linux package manager.
fn linux_pkg_command(pkgs: &str, has: &dyn Fn(&str) -> bool) -> Option<String> {
    if has("apt-get") {
        Some(format!("sudo apt-get install -y {pkgs}"))
    } else if has("dnf") {
        Some(format!("sudo dnf install -y {pkgs}"))
    } else if has("pacman") {
        Some(format!("sudo pacman -S --noconfirm {pkgs}"))
    } else if has("zypper") {
        Some(format!("sudo zypper install -y {pkgs}"))
    } else {
        None
    }
}

fn winget(id: &str) -> Plan {
    Plan::Run {
        program: "winget".to_string(),
        args: [
            "install",
            "--id",
            id,
            "-e",
            "--source",
            "winget",
            "--accept-source-agreements",
            "--accept-package-agreements",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
    }
}

fn brew(pkg: &str) -> Plan {
    Plan::Run {
        program: "brew".to_string(),
        args: vec!["install".to_string(), pkg.to_string()],
    }
}

fn npm_global(pkg: &str) -> Plan {
    Plan::Run {
        program: "npm".to_string(),
        args: vec!["install".to_string(), "-g".to_string(), pkg.to_string()],
    }
}

/// A system tool (node / ffmpeg): winget on Windows, brew on macOS, a copyable
/// package-manager command on Linux, else the download page.
fn system_plan(
    os: &str,
    winget_id: &str,
    brew_pkg: &str,
    linux_pkgs: &str,
    url: &str,
    has: &dyn Fn(&str) -> bool,
) -> Plan {
    match os {
        "windows" => {
            if has("winget") {
                winget(winget_id)
            } else {
                Plan::OpenUrl { url: url.to_string() }
            }
        }
        "macos" => {
            if has("brew") {
                brew(brew_pkg)
            } else {
                Plan::OpenUrl { url: url.to_string() }
            }
        }
        "linux" => match linux_pkg_command(linux_pkgs, has) {
            Some(command) => Plan::Manual { command },
            None => Plan::OpenUrl { url: url.to_string() },
        },
        _ => Plan::OpenUrl { url: url.to_string() },
    }
}

/// The install plan for `dep` on `os`, given an availability probe `has`.
pub fn plan(dep: Dep, os: &str, has: &dyn Fn(&str) -> bool) -> Plan {
    match dep {
        Dep::Node => system_plan(os, "OpenJS.NodeJS.LTS", "node", "nodejs npm", NODE_URL, has),
        Dep::Ffmpeg => system_plan(os, "Gyan.FFmpeg", "ffmpeg", "ffmpeg", FFMPEG_URL, has),
        Dep::Codex => {
            if has("npm") {
                npm_global("@openai/codex")
            } else {
                Plan::NeedsPrereq { prereq: "node".to_string() }
            }
        }
        Dep::Jucode => {
            if has("npm") {
                npm_global("@jucode/cli")
            } else {
                Plan::NeedsPrereq { prereq: "node".to_string() }
            }
        }
        Dep::Claude => {
            if os == "windows" {
                // Official Windows installer (PowerShell). `powershell.exe` (5.1)
                // is always present; irm/iex are built in.
                Plan::Run {
                    program: "powershell".to_string(),
                    args: vec![
                        "-NoProfile".to_string(),
                        "-ExecutionPolicy".to_string(),
                        "Bypass".to_string(),
                        "-Command".to_string(),
                        "irm https://claude.ai/install.ps1 | iex".to_string(),
                    ],
                }
            } else {
                // Official macOS/Linux installer — user-local, no sudo.
                Plan::Run {
                    program: "sh".to_string(),
                    args: vec![
                        "-c".to_string(),
                        "curl -fsSL https://claude.ai/install.sh | bash".to_string(),
                    ],
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(present: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |c: &str| present.contains(&c)
    }

    #[test]
    fn dep_parse_round_trips_ids_and_npm_alias() {
        for (s, d) in [
            ("node", Dep::Node),
            ("npm", Dep::Node),
            ("ffmpeg", Dep::Ffmpeg),
            ("codex", Dep::Codex),
            ("jucode", Dep::Jucode),
            ("claude", Dep::Claude),
        ] {
            assert_eq!(Dep::parse(s), Some(d));
        }
        assert_eq!(Dep::parse("git"), None);
        assert_eq!(Dep::parse(""), None);
    }

    #[test]
    fn node_uses_winget_brew_or_pkg_manager() {
        // Windows with winget → winget run.
        assert_eq!(
            plan(Dep::Node, "windows", &avail(&["winget"])),
            winget("OpenJS.NodeJS.LTS")
        );
        // Windows without winget → download page.
        assert!(matches!(
            plan(Dep::Node, "windows", &avail(&[])),
            Plan::OpenUrl { .. }
        ));
        // macOS with brew → brew install node.
        assert_eq!(plan(Dep::Node, "macos", &avail(&["brew"])), brew("node"));
        // Linux with apt → copyable sudo command (nodejs + npm).
        assert_eq!(
            plan(Dep::Node, "linux", &avail(&["apt-get"])),
            Plan::Manual { command: "sudo apt-get install -y nodejs npm".to_string() }
        );
        // Linux without a known manager → download page.
        assert!(matches!(plan(Dep::Node, "linux", &avail(&[])), Plan::OpenUrl { .. }));
    }

    #[test]
    fn ffmpeg_maps_per_platform() {
        assert_eq!(
            plan(Dep::Ffmpeg, "windows", &avail(&["winget"])),
            winget("Gyan.FFmpeg")
        );
        assert_eq!(plan(Dep::Ffmpeg, "macos", &avail(&["brew"])), brew("ffmpeg"));
        assert_eq!(
            plan(Dep::Ffmpeg, "linux", &avail(&["dnf"])),
            Plan::Manual { command: "sudo dnf install -y ffmpeg".to_string() }
        );
    }

    #[test]
    fn npm_tools_gate_on_npm_then_install_global() {
        // No npm → prereq.
        assert_eq!(
            plan(Dep::Codex, "windows", &avail(&[])),
            Plan::NeedsPrereq { prereq: "node".to_string() }
        );
        assert_eq!(
            plan(Dep::Jucode, "linux", &avail(&[])),
            Plan::NeedsPrereq { prereq: "node".to_string() }
        );
        // With npm → npm i -g <pkg>, identical across platforms.
        assert_eq!(plan(Dep::Codex, "windows", &avail(&["npm"])), npm_global("@openai/codex"));
        assert_eq!(plan(Dep::Codex, "macos", &avail(&["npm"])), npm_global("@openai/codex"));
        assert_eq!(plan(Dep::Jucode, "linux", &avail(&["npm"])), npm_global("@jucode/cli"));
    }

    #[test]
    fn claude_uses_native_installer_per_os() {
        match plan(Dep::Claude, "windows", &avail(&[])) {
            Plan::Run { program, args } => {
                assert_eq!(program, "powershell");
                assert!(args.iter().any(|a| a.contains("claude.ai/install.ps1")));
            }
            other => panic!("expected Run, got {other:?}"),
        }
        for os in ["macos", "linux"] {
            match plan(Dep::Claude, os, &avail(&[])) {
                Plan::Run { program, args } => {
                    assert_eq!(program, "sh");
                    assert!(args.iter().any(|a| a.contains("claude.ai/install.sh")));
                }
                other => panic!("expected Run on {os}, got {other:?}"),
            }
        }
    }
}
