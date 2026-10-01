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
use std::path::Path;

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
    /// git — the Git panel, worktree tasks and the engines' repo tools.
    Git,
    /// GitHub CLI — the Git panel's pull requests.
    Gh,
}

impl Dep {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "node" | "npm" => Some(Self::Node),
            "ffmpeg" => Some(Self::Ffmpeg),
            "codex" => Some(Self::Codex),
            "jucode" => Some(Self::Jucode),
            "claude" => Some(Self::Claude),
            "git" => Some(Self::Git),
            "gh" => Some(Self::Gh),
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
            Self::Git => "git",
            Self::Gh => "gh",
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
    /// The app starts an OS installer that runs in its own window (macOS
    /// `xcode-select --install`); nothing to stream, the user re-checks after.
    SystemDialog { program: String, args: Vec<String> },
    /// No automated path here; open the official download page.
    OpenUrl { url: String },
    /// A prerequisite is missing (e.g. npm for the npm tools) — install it first.
    NeedsPrereq { prereq: String },
}

const NODE_URL: &str = "https://nodejs.org/en/download";
const FFMPEG_URL: &str = "https://ffmpeg.org/download.html";
const GIT_URL: &str = "https://git-scm.com/downloads";
const GH_URL: &str = "https://cli.github.com";
const GH_LINUX_URL: &str = "https://github.com/cli/cli/blob/trunk/docs/install_linux.md";

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
                Plan::OpenUrl {
                    url: url.to_string(),
                }
            }
        }
        "macos" => {
            if has("brew") {
                brew(brew_pkg)
            } else {
                Plan::OpenUrl {
                    url: url.to_string(),
                }
            }
        }
        "linux" => match linux_pkg_command(linux_pkgs, has) {
            Some(command) => Plan::Manual { command },
            None => Plan::OpenUrl {
                url: url.to_string(),
            },
        },
        _ => Plan::OpenUrl {
            url: url.to_string(),
        },
    }
}

/// The install plan for `dep` on `os`, given an availability probe `has`.
pub fn plan(dep: Dep, os: &str, has: &dyn Fn(&str) -> bool) -> Plan {
    match dep {
        Dep::Node => system_plan(os, "OpenJS.NodeJS.LTS", "node", "nodejs npm", NODE_URL, has),
        Dep::Ffmpeg => system_plan(os, "Gyan.FFmpeg", "ffmpeg", "ffmpeg", FFMPEG_URL, has),
        // macOS git comes with the Command Line Tools (Homebrew needs them too).
        Dep::Git if os == "macos" => Plan::SystemDialog {
            program: "xcode-select".to_string(),
            args: vec!["--install".to_string()],
        },
        Dep::Git => system_plan(os, "Git.Git", "git", "git", GIT_URL, has),
        // Linux distributions name and carry gh differently: their own guide.
        Dep::Gh if os == "linux" => Plan::OpenUrl {
            url: GH_LINUX_URL.to_string(),
        },
        Dep::Gh => system_plan(os, "GitHub.cli", "gh", "gh", GH_URL, has),
        Dep::Codex => {
            if has("npm") {
                npm_global("@openai/codex")
            } else {
                Plan::NeedsPrereq {
                    prereq: "node".to_string(),
                }
            }
        }
        Dep::Jucode => {
            if has("npm") {
                npm_global("@jucode/cli")
            } else {
                Plan::NeedsPrereq {
                    prereq: "node".to_string(),
                }
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

/// `major.minor.patch` from a `--version` line ("2.1.286 (Claude Code)",
/// "codex-cli 0.159.3"); a pre-release suffix is ignored.
pub fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    s.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find_map(|token| {
            let mut parts = token.split('.');
            let mut next = || parts.next()?.parse::<u64>().ok();
            Some((next()?, next()?, next()?))
        })
}

/// The npm package an agent CLI is published as. The native installers ship
/// the same versions, so its dist-tags give the latest release whatever the
/// install method.
pub fn npm_package(dep: Dep) -> Option<&'static str> {
    match dep {
        Dep::Claude => Some("@anthropic-ai/claude-code"),
        Dep::Codex => Some("@openai/codex"),
        _ => None,
    }
}

/// `codex update` exists from this release on; before it, `codex update`
/// starts a session with "update" as the prompt.
const CODEX_UPDATE_SINCE: (u64, u64, u64) = (0, 126, 0);

/// How to upgrade the installed Claude Code / Codex at `bin` (whose
/// `--version` printed `version`) in place. Both update themselves and know
/// how they were installed (native, npm, Homebrew…): `claude update`, and
/// `codex update` from 0.126. An older Codex installed by npm is reinstalled
/// through npm; any other old one gets the download page.
pub fn upgrade_plan(
    dep: Dep,
    bin: &Path,
    version: &str,
    has: &dyn Fn(&str) -> bool,
) -> Option<Plan> {
    let update = || Plan::Run {
        program: bin.display().to_string(),
        args: vec!["update".to_string()],
    };
    match dep {
        Dep::Claude => Some(update()),
        Dep::Codex if parse_version(version).is_some_and(|v| v >= CODEX_UPDATE_SINCE) => {
            Some(update())
        }
        Dep::Codex if npm_installed(bin) => Some(plan(Dep::Codex, std::env::consts::OS, has)),
        Dep::Codex => Some(Plan::OpenUrl {
            url: "https://developers.openai.com/codex/cli/".to_string(),
        }),
        _ => None,
    }
}

/// Whether npm put the Codex at `bin` there: on Unix the command links into
/// `node_modules`, on Windows the `.cmd` shim sits next to it.
fn npm_installed(bin: &Path) -> bool {
    let real = bin.canonicalize().unwrap_or_else(|_| bin.to_path_buf());
    real.components().any(|c| c.as_os_str() == "node_modules")
        || bin.parent().is_some_and(|dir| {
            dir.join("node_modules")
                .join("@openai")
                .join("codex")
                .is_dir()
        })
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
            ("git", Dep::Git),
            ("gh", Dep::Gh),
        ] {
            assert_eq!(Dep::parse(s), Some(d));
        }
        assert_eq!(Dep::parse("svn"), None);
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
            Plan::Manual {
                command: "sudo apt-get install -y nodejs npm".to_string()
            }
        );
        // Linux without a known manager → download page.
        assert!(matches!(
            plan(Dep::Node, "linux", &avail(&[])),
            Plan::OpenUrl { .. }
        ));
    }

    #[test]
    fn ffmpeg_maps_per_platform() {
        assert_eq!(
            plan(Dep::Ffmpeg, "windows", &avail(&["winget"])),
            winget("Gyan.FFmpeg")
        );
        assert_eq!(
            plan(Dep::Ffmpeg, "macos", &avail(&["brew"])),
            brew("ffmpeg")
        );
        assert_eq!(
            plan(Dep::Ffmpeg, "linux", &avail(&["dnf"])),
            Plan::Manual {
                command: "sudo dnf install -y ffmpeg".to_string()
            }
        );
    }

    #[test]
    fn npm_tools_gate_on_npm_then_install_global() {
        // No npm → prereq.
        assert_eq!(
            plan(Dep::Codex, "windows", &avail(&[])),
            Plan::NeedsPrereq {
                prereq: "node".to_string()
            }
        );
        assert_eq!(
            plan(Dep::Jucode, "linux", &avail(&[])),
            Plan::NeedsPrereq {
                prereq: "node".to_string()
            }
        );
        // With npm → npm i -g <pkg>, identical across platforms.
        assert_eq!(
            plan(Dep::Codex, "windows", &avail(&["npm"])),
            npm_global("@openai/codex")
        );
        assert_eq!(
            plan(Dep::Codex, "macos", &avail(&["npm"])),
            npm_global("@openai/codex")
        );
        assert_eq!(
            plan(Dep::Jucode, "linux", &avail(&["npm"])),
            npm_global("@jucode/cli")
        );
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

    #[test]
    fn parses_cli_version_lines() {
        assert_eq!(parse_version("2.1.286 (Claude Code)"), Some((2, 1, 286)));
        assert_eq!(parse_version("codex-cli 0.159.3"), Some((0, 159, 3)));
        assert_eq!(
            parse_version("codex-cli 0.161.0-alpha.8"),
            Some((0, 161, 0))
        );
        assert_eq!(parse_version("jucode 0.4.0\n"), Some((0, 4, 0)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn agents_update_themselves_except_old_codex() {
        let bin = Path::new("/home/u/.local/bin/claude");
        assert_eq!(
            upgrade_plan(Dep::Claude, bin, "2.1.0 (Claude Code)", &avail(&[])),
            Some(Plan::Run {
                program: bin.display().to_string(),
                args: vec!["update".to_string()]
            })
        );
        let codex = Path::new("/home/u/.local/bin/codex");
        assert!(matches!(
            upgrade_plan(Dep::Codex, codex, "codex-cli 0.126.0", &avail(&[])),
            Some(Plan::Run { args, .. }) if args == ["update"]
        ));
        // Too old for `codex update`: npm reinstalls it, else the download page.
        let npm = Path::new("/usr/local/lib/node_modules/@openai/codex/bin/codex.js");
        assert_eq!(
            upgrade_plan(Dep::Codex, npm, "codex-cli 0.98.0", &avail(&["npm"])),
            Some(npm_global("@openai/codex"))
        );
        assert!(matches!(
            upgrade_plan(Dep::Codex, codex, "codex-cli 0.98.0", &avail(&["npm"])),
            Some(Plan::OpenUrl { .. })
        ));
        assert_eq!(
            upgrade_plan(Dep::Jucode, bin, "jucode 0.4.0", &avail(&[])),
            None
        );
    }

    #[test]
    fn git_and_gh_map_per_platform() {
        assert_eq!(
            plan(Dep::Git, "macos", &avail(&["brew"])),
            Plan::SystemDialog {
                program: "xcode-select".to_string(),
                args: vec!["--install".to_string()]
            }
        );
        assert_eq!(
            plan(Dep::Git, "windows", &avail(&["winget"])),
            winget("Git.Git")
        );
        assert_eq!(
            plan(Dep::Git, "linux", &avail(&["apt-get"])),
            Plan::Manual {
                command: "sudo apt-get install -y git".to_string()
            }
        );
        assert_eq!(plan(Dep::Gh, "macos", &avail(&["brew"])), brew("gh"));
        assert_eq!(
            plan(Dep::Gh, "windows", &avail(&["winget"])),
            winget("GitHub.cli")
        );
        assert!(matches!(
            plan(Dep::Gh, "macos", &avail(&[])),
            Plan::OpenUrl { .. }
        ));
        assert!(matches!(
            plan(Dep::Gh, "linux", &avail(&["apt-get"])),
            Plan::OpenUrl { .. }
        ));
    }
}
