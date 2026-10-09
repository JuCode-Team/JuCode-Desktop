//! Skills of the other agents: folders with a SKILL.md, in each tool's
//! skills directory and in the plugins it has installed. Importing copies
//! the folder into `~/.jucode/skills`, where JuCode loads skills from; a
//! skill JuCode already has by that name (there or in `~/.agents/skills`)
//! is left alone.

use super::{plugins, Roots};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
pub struct Found {
    pub source: String,
    pub name: String,
    pub description: String,
    /// The skill's folder.
    pub path: String,
    /// The plugin it comes with, if any.
    pub plugin: Option<String>,
    /// JuCode already has a skill of this name.
    pub present: bool,
}

/// How deep skills may sit under a skills folder (JuCode descends into
/// folders without a SKILL.md, as a skill pack lays them out).
const MAX_DEPTH: usize = 3;

struct Skill {
    name: String,
    description: String,
    dir: PathBuf,
}

/// `key: value` from a SKILL.md's front matter (a folded `>` / `|` value
/// reads as its lines joined).
fn front_matter(text: &str, key: &str) -> Option<String> {
    let body = text.strip_prefix("---")?;
    let end = body.find("\n---")?;
    let mut lines = body[..end].lines();
    while let Some(line) = lines.next() {
        let Some(value) = line.strip_prefix(key).and_then(|rest| rest.trim_start().strip_prefix(':')) else { continue };
        let value = value.trim();
        let value = if matches!(value, "|" | ">" | "|-" | ">-" | "") {
            lines
                .by_ref()
                .take_while(|l| l.starts_with(' ') || l.starts_with('\t'))
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            value.trim_matches(|c| c == '"' || c == '\'').to_string()
        };
        return Some(value).filter(|v| !v.is_empty());
    }
    None
}

fn find_skills(dir: &Path, depth: usize, out: &mut Vec<Skill>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = read.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let hidden = path.file_name().and_then(|n| n.to_str()).is_none_or(|n| n.starts_with('.'));
        // Hidden folders hold a tool's own (Codex's `.system`).
        if hidden || !path.is_dir() {
            continue;
        }
        let file = path.join("SKILL.md");
        match fs::read_to_string(&file) {
            Ok(text) => {
                let folder = path.file_name().and_then(|n| n.to_str()).unwrap_or("skill").to_string();
                let description = front_matter(&text, "description").unwrap_or_default();
                let name = front_matter(&text, "name").unwrap_or(folder);
                out.push(Skill { name, description, dir: path });
            }
            Err(_) if depth < MAX_DEPTH => find_skills(&path, depth + 1, out),
            Err(_) => {}
        }
    }
}

/// Names of the skills JuCode loads for every project.
fn installed_names(roots: &Roots) -> HashSet<String> {
    let mut skills = Vec::new();
    find_skills(&roots.jucode.join("skills"), 0, &mut skills);
    find_skills(&roots.home.join(".agents").join("skills"), 0, &mut skills);
    skills.into_iter().map(|s| s.name).collect()
}

pub fn scan(roots: &Roots) -> Vec<Found> {
    let mut places: Vec<(&'static str, PathBuf, Option<String>)> = vec![
        ("claude", roots.claude.join("skills"), None),
        ("codex", roots.codex.join("skills"), None),
        ("opencode", roots.config_home.join("opencode").join("skills"), None),
        ("opencode", roots.config_home.join("opencode").join("skill"), None),
        ("zcode", roots.home.join(".zcode").join("skills"), None),
        ("omp", roots.omp_agent().join("skills"), None),
    ];
    places.extend(plugins(roots).into_iter().map(|p| (p.source, p.dir.join("skills"), Some(p.name))));
    let installed = installed_names(roots);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (source, dir, plugin) in places {
        let mut skills = Vec::new();
        find_skills(&dir, 0, &mut skills);
        for skill in skills {
            let path = skill.dir.display().to_string();
            if !seen.insert((source, path.clone())) {
                continue;
            }
            out.push(Found {
                source: source.to_string(),
                present: installed.contains(&skill.name) || dest(roots, &skill.dir).is_some_and(|d| d.exists()),
                name: skill.name,
                description: skill.description,
                path,
                plugin: plugin.clone(),
            });
        }
    }
    out
}

/// Where a skill is copied to: its folder name under `~/.jucode/skills`.
fn dest(roots: &Roots, dir: &Path) -> Option<PathBuf> {
    let folder = dir.file_name()?.to_str()?;
    (!folder.starts_with('.')).then(|| roots.jucode.join("skills").join(folder))
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("cannot create {}: {e}", dst.display()))?;
    let read = fs::read_dir(src).map_err(|e| format!("cannot read {}: {e}", src.display()))?;
    for entry in read.flatten() {
        let name = entry.file_name();
        if matches!(name.to_str(), Some(".git" | "node_modules" | ".DS_Store")) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        // Symlinks inside a skill are skipped: one may point anywhere on the
        // machine (a skill folder that is itself a link, as zcode links
        // skills in from Codex, is still read through).
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            copy_dir(&from, &to)?;
        } else if kind.is_file() {
            fs::copy(&from, &to).map_err(|e| format!("cannot copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

/// Copies one scanned skill; `Ok((false, …))` when JuCode already has it.
pub fn import(roots: &Roots, found: &[Found], source: &str, path: &str) -> Result<(bool, PathBuf), String> {
    // Only what the scan offered: the path comes back from the page.
    let skill = found
        .iter()
        .find(|s| s.source == source && s.path == path)
        .ok_or_else(|| format!("skill not found: {path}"))?;
    let src = Path::new(&skill.path);
    let dest = dest(roots, src).ok_or_else(|| format!("not a skill folder: {path}"))?;
    if dest.exists() || installed_names(roots).contains(&skill.name) {
        return Ok((false, dest));
    }
    let parent = dest.parent().unwrap_or(&roots.jucode);
    let tmp = parent.join(format!(".import-{}.tmp", dest.file_name().and_then(|n| n.to_str()).unwrap_or("skill")));
    let _ = fs::remove_dir_all(&tmp);
    copy_dir(src, &tmp).inspect_err(|_| {
        let _ = fs::remove_dir_all(&tmp);
    })?;
    fs::rename(&tmp, &dest).map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
    Ok((true, dest))
}

#[cfg(test)]
mod tests {
    use super::super::testutil;
    use super::*;

    fn skill(dir: &Path, name: &str, desc: &str) {
        testutil::write(&dir.join("SKILL.md"), &format!("---\nname: {name}\ndescription: \"{desc}\"\n---\n\nBody\n"));
    }

    #[test]
    fn finds_skills_and_plugin_skills_and_copies_them() {
        let roots = testutil::roots("skills");
        skill(&roots.claude.join("skills/review"), "review", "Review code");
        testutil::write(&roots.claude.join("skills/review/scripts/run.sh"), "echo hi");
        testutil::write(&roots.claude.join("skills/review/node_modules/x/index.js"), "x");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&roots.home, roots.claude.join("skills/review/home")).unwrap();
        skill(&roots.codex.join("skills/.system/imagegen"), "imagegen", "Codex's own");
        skill(&roots.codex.join("skills/pack/inner"), "inner-skill", "Nested in a pack");
        // A zcode plugin, two versions: the newer one counts.
        let cache = roots.zcode_plugins().join("official/docs");
        skill(&cache.join("0.1.9/skills/docx"), "docx-old", "old");
        skill(&cache.join("0.1.10/skills/docx"), "docx", "new");
        // JuCode already has one by that name.
        skill(&roots.home.join(".agents/skills/inner"), "inner-skill", "mine");

        let found = scan(&roots);
        let names: Vec<(&str, &str, Option<&str>, bool)> =
            found.iter().map(|s| (s.source.as_str(), s.name.as_str(), s.plugin.as_deref(), s.present)).collect();
        assert_eq!(
            names,
            [("claude", "review", None, false), ("codex", "inner-skill", None, true), ("zcode", "docx", Some("docs"), false)]
        );
        assert_eq!(found[0].description, "Review code");

        let review = &found[0];
        let (copied, dest) = import(&roots, &found, "claude", &review.path).unwrap();
        assert!(copied);
        assert_eq!(dest, roots.jucode.join("skills/review"));
        assert_eq!(fs::read_to_string(dest.join("scripts/run.sh")).unwrap(), "echo hi");
        assert!(!dest.join("node_modules").exists());
        assert!(fs::symlink_metadata(dest.join("home")).is_err(), "a symlink is not followed");
        assert!(!import(&roots, &found, "claude", &review.path).unwrap().0, "a second import leaves it");
        assert!(!import(&roots, &found, "codex", &found[1].path).unwrap().0, "a name JuCode has is skipped");
        assert!(import(&roots, &found, "claude", "/etc").is_err(), "only scanned skills are copied");
        assert!(scan(&roots)[0].present);
    }

    #[test]
    fn front_matter_reads_quoted_and_folded_values() {
        let text = "---\nname: 'x'\ndescription: >\n  first line\n  second\nother: y\n---\nbody";
        assert_eq!(front_matter(text, "name").as_deref(), Some("x"));
        assert_eq!(front_matter(text, "description").as_deref(), Some("first line second"));
        assert_eq!(front_matter("no front matter", "name"), None);
    }
}
