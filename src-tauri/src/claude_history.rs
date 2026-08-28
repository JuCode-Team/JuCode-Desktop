//! Read-only access to Claude Code's persisted session files, for the desktop
//! /resume picker and transcript replay on claude-backed sessions.
//!
//! Claude Code stores one JSONL file per session under
//! `~/.claude/projects/<munged-cwd>/<session-id>.jsonl`, where the cwd is
//! munged by replacing every non-ASCII-alphanumeric character with `-`
//! (verified live against claude 2.1.208: `/`, `.` and `_` all become `-`,
//! case is preserved).
//!
//! Everything here is strictly read-only and bounded: session listing caps the
//! directory scan and per-file preview reads, transcript extraction caps row
//! count and row size. The claude home is injectable so tests run against a
//! fixture directory.

use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

/// One resumable session (newest first).
#[derive(Serialize, Debug, PartialEq)]
pub struct ClaudeSessionEntry {
    /// The session id (`--resume <id>`), i.e. the file stem.
    pub id: String,
    /// File mtime in milliseconds since the epoch (sort key, newest first).
    pub mtime_ms: u64,
    /// Human preview: the stored AI title if present, else the first real
    /// user message. May be empty for sessions with no readable content.
    pub preview: String,
}

/// One replayable transcript row (user / assistant text only).
#[derive(Serialize, Debug, PartialEq)]
pub struct ClaudeTranscriptRow {
    pub role: String,
    pub content: String,
}

/// Newest sessions returned by a listing.
const MAX_SESSIONS: usize = 50;
/// Directory entries examined before giving up (degenerate dirs).
const MAX_DIR_ENTRIES: usize = 2000;
/// Bytes of a session file scanned for its preview.
const MAX_PREVIEW_SCAN: u64 = 256 * 1024;
/// Preview length (characters).
const MAX_PREVIEW_CHARS: usize = 80;
/// Transcript rows replayed (the newest are kept when over).
const MAX_TRANSCRIPT_ROWS: usize = 500;
/// Characters kept per transcript row.
const MAX_ROW_CHARS: usize = 20_000;
/// Bytes of a session file read for transcript extraction.
const MAX_TRANSCRIPT_SCAN: u64 = 64 * 1024 * 1024;

/// Claude Code's cwd → project-directory-name munging (see module docs).
fn munge_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// `~/.claude` (the production base; tests inject a fixture dir instead).
pub fn claude_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(".claude")
}

fn project_dir(home: &Path, cwd: &str) -> PathBuf {
    home.join("projects").join(munge_cwd(cwd))
}

/// Session ids are UUID-ish (alphanumeric + dashes) — same shape the spawn
/// allowlist accepts. Rejecting anything else also blocks path traversal.
fn is_session_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// Rows Claude injects that are not conversation content: subagent streams,
/// meta caveats and the post-compaction continuation summary.
fn is_synthetic(v: &serde_json::Value) -> bool {
    v["isSidechain"].as_bool() == Some(true)
        || v["isMeta"].as_bool() == Some(true)
        || v["isCompactSummary"].as_bool() == Some(true)
        || v["isVisibleInTranscriptOnly"].as_bool() == Some(true)
}

/// Extracts the user/assistant text of a session-file row, or None.
/// String contents starting with `<` are slash-command echoes
/// (`<command-name>…`, `<local-command-stdout>…`) — never conversation text.
fn row_text(v: &serde_json::Value) -> Option<String> {
    let content = &v["message"]["content"];
    if let Some(s) = content.as_str() {
        let t = s.trim();
        return (!t.is_empty() && !t.starts_with('<')).then(|| t.to_string());
    }
    let blocks = content.as_array()?;
    let text = blocks
        .iter()
        .filter(|b| b["type"].as_str() == Some("text"))
        .filter_map(|b| b["text"].as_str())
        .filter(|t| !t.trim().is_empty() && !t.trim_start().starts_with('<'))
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

/// Best-effort preview: the `ai-title` row wins, else the first real user
/// message. Reads at most `MAX_PREVIEW_SCAN` bytes.
fn preview_of(path: &Path) -> String {
    let Ok(file) = fs::File::open(path) else {
        return String::new();
    };
    let mut reader = BufReader::new(file).take(MAX_PREVIEW_SCAN);
    let mut first_user = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match v["type"].as_str() {
            Some("ai-title") => {
                if let Some(t) = v["aiTitle"].as_str() {
                    if !t.trim().is_empty() {
                        return truncate_chars(t.trim(), MAX_PREVIEW_CHARS);
                    }
                }
            }
            Some("user") if first_user.is_empty() && !is_synthetic(&v) => {
                if let Some(t) = row_text(&v) {
                    first_user = truncate_chars(t.lines().next().unwrap_or(""), MAX_PREVIEW_CHARS);
                }
            }
            _ => {}
        }
    }
    first_user
}

/// Lists the resumable sessions persisted for `cwd`, newest first. A missing
/// project directory is not an error — it just means "no history yet".
pub fn list_sessions(home: &Path, cwd: &str) -> Result<Vec<ClaudeSessionEntry>, String> {
    let dir = project_dir(home, cwd);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<(String, u64, PathBuf)> = Vec::new();
    for entry in entries.flatten().take(MAX_DIR_ENTRIES) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_session_id(stem) {
            continue;
        }
        let mtime_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        files.push((stem.to_string(), mtime_ms, path));
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.1));
    files.truncate(MAX_SESSIONS);
    Ok(files
        .into_iter()
        .map(|(id, mtime_ms, path)| ClaudeSessionEntry {
            id,
            mtime_ms,
            preview: preview_of(&path),
        })
        .collect())
}

/// Extracts the replayable user/assistant text rows of a persisted session,
/// in order. Keeps the newest `MAX_TRANSCRIPT_ROWS` rows when over.
pub fn read_transcript(
    home: &Path,
    cwd: &str,
    id: &str,
) -> Result<Vec<ClaudeTranscriptRow>, String> {
    if !is_session_id(id) {
        return Err(format!("invalid session id: {id}"));
    }
    let path = project_dir(home, cwd).join(format!("{id}.jsonl"));
    let file = fs::File::open(&path).map_err(|e| format!("cannot read session {id}: {e}"))?;
    let mut reader = BufReader::new(file).take(MAX_TRANSCRIPT_SCAN);
    let mut rows: Vec<ClaudeTranscriptRow> = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let role = match v["type"].as_str() {
            Some(r @ ("user" | "assistant")) => r,
            _ => continue,
        };
        if is_synthetic(&v) {
            continue;
        }
        let Some(text) = row_text(&v) else { continue };
        rows.push(ClaudeTranscriptRow {
            role: role.to_string(),
            content: truncate_chars(&text, MAX_ROW_CHARS),
        });
        if rows.len() > MAX_TRANSCRIPT_ROWS {
            rows.remove(0);
        }
    }
    Ok(rows)
}

/// `/resume` picker data: the sessions Claude Code persisted for this cwd.
#[tauri::command]
pub fn claude_sessions(cwd: String) -> Result<Vec<ClaudeSessionEntry>, String> {
    list_sessions(&claude_home(), &cwd)
}

/// Transcript replay for a resumed claude session (user/assistant text).
#[tauri::command]
pub fn claude_session_transcript(
    cwd: String,
    id: String,
) -> Result<Vec<ClaudeTranscriptRow>, String> {
    read_transcript(&claude_home(), &cwd, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a fake ~/.claude fixture; unique per test to allow parallelism.
    fn fixture(name: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!(
            "jucode-claude-history-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("projects")).unwrap();
        home
    }

    fn write_session(home: &Path, cwd: &str, id: &str, lines: &[&str]) -> PathBuf {
        let dir = project_dir(home, cwd);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{id}.jsonl"));
        fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    #[test]
    fn munges_cwd_like_claude_does() {
        // Verified live: '/', '.' and '_' all become '-', case is preserved.
        assert_eq!(
            munge_cwd("/Users/apple/dev/JuCode-Desktop"),
            "-Users-apple-dev-JuCode-Desktop"
        );
        assert_eq!(munge_cwd("/tmp/a.b_c"), "-tmp-a-b-c");
        // Non-ASCII collapses to '-' too (one dash per character).
        assert_eq!(munge_cwd("/中文/路径 x"), "-------x");
    }

    #[test]
    fn lists_sessions_newest_first_with_previews() {
        let home = fixture("list");
        let cwd = "/proj/demo";
        write_session(
            &home,
            cwd,
            "aaaaaaaa-1111-4111-8111-111111111111",
            &[r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"fix the login bug"}]}}"#],
        );
        let newer = write_session(
            &home,
            cwd,
            "bbbbbbbb-2222-4222-8222-222222222222",
            &[
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"first message"}]}}"#,
                r#"{"type":"ai-title","aiTitle":"Add dark mode","sessionId":"b"}"#,
            ],
        );
        // Non-session files are ignored.
        fs::write(project_dir(&home, cwd).join("notes.txt"), "x").unwrap();
        fs::write(project_dir(&home, cwd).join("weird name.jsonl"), "x").unwrap();
        // Make the second file strictly newer.
        let newer_time = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        let f = fs::File::options().append(true).open(&newer).unwrap();
        f.set_modified(newer_time).unwrap();

        let sessions = list_sessions(&home, cwd).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, "bbbbbbbb-2222-4222-8222-222222222222");
        assert_eq!(sessions[0].preview, "Add dark mode"); // ai-title wins
        assert_eq!(sessions[1].id, "aaaaaaaa-1111-4111-8111-111111111111");
        assert_eq!(sessions[1].preview, "fix the login bug");
        assert!(sessions[0].mtime_ms >= sessions[1].mtime_ms);
    }

    #[test]
    fn missing_project_dir_means_no_history() {
        let home = fixture("empty");
        assert_eq!(list_sessions(&home, "/never/seen").unwrap(), Vec::new());
    }

    #[test]
    fn preview_skips_command_echoes_and_synthetic_rows() {
        let home = fixture("preview");
        let cwd = "/proj/p";
        write_session(
            &home,
            cwd,
            "cccccccc-3333-4333-8333-333333333333",
            &[
                r#"{"type":"queue-operation","operation":"enqueue"}"#,
                r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>x</local-command-caveat>"}}"#,
                r#"{"type":"user","message":{"role":"user","content":"<command-name>/model</command-name>"}}"#,
                r#"{"type":"user","isSidechain":true,"message":{"role":"user","content":[{"type":"text","text":"subagent inner"}]}}"#,
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"real question"}]}}"#,
            ],
        );
        let sessions = list_sessions(&home, cwd).unwrap();
        assert_eq!(sessions[0].preview, "real question");
    }

    #[test]
    fn transcript_replays_user_and_assistant_text_only() {
        let home = fixture("transcript");
        let cwd = "/proj/t";
        let id = "dddddddd-4444-4444-8444-444444444444";
        write_session(
            &home,
            cwd,
            id,
            &[
                r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"run a command"}]}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"on it"}]}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#,
                r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#,
                r#"{"type":"user","isCompactSummary":true,"isVisibleInTranscriptOnly":true,"message":{"role":"user","content":"This session is being continued…"}}"#,
                r#"{"type":"user","message":{"role":"user","content":"<local-command-stdout>Compacted </local-command-stdout>"}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}"#,
                r#"{"type":"last-prompt","lastPrompt":"x"}"#,
            ],
        );
        let rows = read_transcript(&home, cwd, id).unwrap();
        assert_eq!(
            rows,
            vec![
                ClaudeTranscriptRow { role: "user".into(), content: "run a command".into() },
                ClaudeTranscriptRow { role: "assistant".into(), content: "on it".into() },
                ClaudeTranscriptRow { role: "assistant".into(), content: "done".into() },
            ]
        );
    }

    #[test]
    fn transcript_accepts_interactive_string_user_messages() {
        // Sessions created by the interactive CLI store user text as a plain
        // string, not content blocks.
        let home = fixture("interactive");
        let cwd = "/proj/i";
        let id = "eeeeeeee-5555-4555-8555-555555555555";
        write_session(
            &home,
            cwd,
            id,
            &[r#"{"type":"user","message":{"role":"user","content":"typed in a terminal"}}"#],
        );
        let rows = read_transcript(&home, cwd, id).unwrap();
        assert_eq!(rows[0].content, "typed in a terminal");
    }

    #[test]
    fn transcript_rejects_bad_ids_and_missing_files() {
        let home = fixture("bad");
        assert!(read_transcript(&home, "/p", "../etc/passwd").is_err());
        assert!(read_transcript(&home, "/p", "--flag").is_err());
        assert!(read_transcript(&home, "/p", "").is_err());
        // Valid id, no file → error (the caller treats replay as best-effort).
        assert!(read_transcript(&home, "/p", "ffffffff-6666-4666-8666-666666666666").is_err());
    }

    #[test]
    fn caps_row_count_and_row_length() {
        let home = fixture("caps");
        let cwd = "/proj/c";
        let id = "99999999-7777-4777-8777-777777777777";
        let long = "x".repeat(MAX_ROW_CHARS + 100);
        let mut lines: Vec<String> = (0..MAX_TRANSCRIPT_ROWS + 20)
            .map(|i| {
                format!(
                    r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"text","text":"m{i}"}}]}}}}"#
                )
            })
            .collect();
        lines.push(format!(
            r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{long}"}}]}}}}"#
        ));
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_session(&home, cwd, id, &refs);
        let rows = read_transcript(&home, cwd, id).unwrap();
        assert_eq!(rows.len(), MAX_TRANSCRIPT_ROWS);
        // The oldest rows were dropped, the newest kept.
        assert_eq!(rows.last().unwrap().role, "assistant");
        assert_eq!(rows.last().unwrap().content.chars().count(), MAX_ROW_CHARS + 1); // +1 = ellipsis
    }
}
