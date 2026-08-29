use std::path::PathBuf;
use std::process::Command;

use super::super::{
    is_valid_ref_name, no_window, resolve_cwd, run_with_timeout, shell_env, which,
    REMOTE_OP_TIMEOUT,
};

/// Resolves the plugin's optional `gh` binary. Packaged apps inherit a minimal
/// PATH, so common install locations are checked after the captured shell PATH.
fn resolve_gh() -> PathBuf {
    if let Some(found) = which("gh") {
        return found;
    }
    for candidate in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return path;
        }
    }
    PathBuf::from("gh")
}

/// Rust-side command allowlist for the first-party GitHub PR plugin.
pub(crate) fn validate_args(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("--version") if args.len() == 1 => Ok(()),
        Some("auth") if args.len() == 2 && args[1] == "status" => Ok(()),
        Some("pr") => validate_pr_args(&args[1..]),
        _ => Err(format!("gh arguments not allowed: {}", args.join(" "))),
    }
}

fn validate_pr_args(rest: &[String]) -> Result<(), String> {
    match rest.first().map(String::as_str) {
        Some("view") => {
            let mut index = 1;
            while index < rest.len() {
                if rest[index] != "--json" {
                    return Err(format!("gh argument not allowed: {}", rest[index]));
                }
                let value = rest
                    .get(index + 1)
                    .ok_or_else(|| "--json requires a value".to_string())?;
                if value.is_empty()
                    || !value
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric() || character == ',')
                {
                    return Err(format!("gh --json fields not allowed: {value}"));
                }
                index += 2;
            }
            Ok(())
        }
        Some("create") => {
            let mut index = 1;
            let mut has_title = false;
            while index < rest.len() {
                match rest[index].as_str() {
                    "--title" | "--body" => {
                        if rest.get(index + 1).is_none() {
                            return Err(format!("{} requires a value", rest[index]));
                        }
                        has_title |= rest[index] == "--title";
                        index += 2;
                    }
                    "--base" | "--head" => {
                        let value = rest
                            .get(index + 1)
                            .ok_or_else(|| format!("{} requires a value", rest[index]))?;
                        if !is_valid_ref_name(value) {
                            return Err(format!("invalid ref name: {value}"));
                        }
                        index += 2;
                    }
                    "--draft" => index += 1,
                    other => return Err(format!("gh argument not allowed: {other}")),
                }
            }
            if !has_title {
                return Err("gh pr create requires --title".to_string());
            }
            Ok(())
        }
        _ => Err(format!("gh pr subcommand not allowed: {}", rest.join(" "))),
    }
}

/// Non-interactive bridge used only by the GitHub PR plugin. The allowlist
/// above keeps the exposed Tauri command narrower than arbitrary `gh` access.
#[tauri::command(async)]
pub(crate) fn gh(args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    validate_args(&args)?;
    let dir = cwd.map(PathBuf::from).unwrap_or_else(resolve_cwd);
    let mut command = Command::new(resolve_gh());
    no_window(&mut command);
    shell_env::merge_into(&mut command);
    command
        .args(&args)
        .current_dir(dir)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "cat")
        .env("NO_COLOR", "1")
        .env("GIT_TERMINAL_PROMPT", "0");
    let output = run_with_timeout(command, REMOTE_OP_TIMEOUT)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if stderr.trim().is_empty() {
            Err(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(stderr)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_args;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn allowlist_matches_manifest_commands() {
        assert!(validate_args(&args(&["--version"])).is_ok());
        assert!(validate_args(&args(&["auth", "status"])).is_ok());
        assert!(validate_args(&args(&["pr", "view", "--json", "url,title,state,isDraft"])).is_ok());
        assert!(validate_args(&args(&[
            "pr", "create", "--title", "feat: x", "--body", "", "--base", "main", "--draft"
        ]))
        .is_ok());
        assert!(validate_args(&args(&["repo", "clone", "x/y"])).is_err());
        assert!(validate_args(&args(&["auth", "login"])).is_err());
        assert!(validate_args(&args(&["pr", "merge"])).is_err());
        assert!(validate_args(&args(&["pr", "create", "--body", "no title"])).is_err());
        assert!(
            validate_args(&args(&["pr", "create", "--title", "t", "--base", "-evil"])).is_err()
        );
        assert!(validate_args(&args(&["pr", "create", "--title", "t", "--web"])).is_err());
        assert!(validate_args(&args(&["pr", "view", "--json", "url;rm -rf"])).is_err());
        assert!(validate_args(&args(&["--version", "extra"])).is_err());
    }
}
