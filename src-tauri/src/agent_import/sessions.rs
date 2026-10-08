//! Conversations of the other agents, across every folder.
//!
//! Claude Code and Codex: listed from their session files and imported with
//! native_import (a cleaned copy resumed on that engine).
//!
//! opencode, zcode and omp: converted into a JuCode session, the journal and
//! summary `jucode` itself writes (JuCode-CLI agent-core session.rs):
//! `~/.jucode/sessions/<fnv1a64 of the folder>/<sid>.jsonl` and `<sid>.json`.
//! What a model needs to continue comes along: the prompts, the assistant's
//! text, and each tool call with its result (a `function_call` item and a
//! `tool_output` entry). Reasoning, step markers and compactions are dropped:
//! reasoning only replays on the account that wrote it, and a compaction's
//! summary stands for history the copy has in full.
//!
//! opencode and zcode (an opencode fork) keep conversations in SQLite —
//! `session`, `message` (one row per message, JSON `data`) and `part` (its
//! text, tool calls, reasoning …) — read here read-only. omp (oh-my-pi) keeps
//! a JSONL tree per conversation under `~/.omp/agent/sessions/<folder>/`; the
//! active branch runs from the last entry back through `parentId`.

use super::{Roots, SessionPick};
use crate::claude_history::{is_session_id, is_synthetic, preview_of, row_text, truncate_chars};
use crate::native_import::{
    claude_copy_path, codex_first_prompt, codex_names, codex_threads, existing_copy, import_claude,
    import_codex, is_conversation, load_registry, mtime_ms, now_ms, save_registry, ImportRecord,
    JUCODE_ORIGINATOR, MAX_TITLE_CHARS,
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// A conversation offered for import.
#[derive(Serialize, Debug, Clone)]
pub struct Found {
    /// "claude", "codex", "opencode", "zcode" or "omp".
    pub source: String,
    pub id: String,
    pub title: String,
    /// The folder it ran in.
    pub cwd: String,
    pub updated_at_ms: u64,
    /// Prompts the user sent.
    pub messages: usize,
    /// Imported before: importing again opens that copy.
    pub imported: bool,
}

pub fn scan(roots: &Roots) -> Vec<Found> {
    let registry = load_registry(&roots.registry());
    let mut out = scan_claude(roots, &registry);
    out.extend(scan_codex(roots, &registry));
    out.extend(scan_db(roots, Db::Opencode, &registry));
    out.extend(scan_db(roots, Db::Zcode, &registry));
    out.extend(scan_omp(roots, &registry));
    out.sort_by_key(|s| std::cmp::Reverse(s.updated_at_ms));
    out
}

pub struct Imported {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub engine: &'static str,
    /// An earlier copy was reused.
    pub reused: bool,
}

pub fn import(roots: &Roots, pick: &SessionPick) -> Result<Imported, String> {
    match pick.source.as_str() {
        "claude" | "codex" => {
            let h = roots.native();
            // An import that writes a copy records it; one that finds a copy does not.
            let before = load_registry(&h.registry).len();
            let (engine, done) = if pick.source == "claude" {
                ("claude", import_claude(&h, &pick.cwd, &pick.id)?)
            } else {
                ("codex", import_codex(&h, &pick.cwd, &pick.id)?)
            };
            Ok(Imported {
                id: done.id,
                title: done.title,
                cwd: folder_key(&pick.cwd),
                engine,
                reused: load_registry(&h.registry).len() == before,
            })
        }
        "opencode" => import_converted(roots, "opencode", &pick.id, load_db(roots, Db::Opencode, &pick.id)?),
        "zcode" => import_converted(roots, "zcode", &pick.id, load_db(roots, Db::Zcode, &pick.id)?),
        "omp" => import_converted(roots, "omp", &pick.id, load_omp(roots, &pick.id)?),
        other => Err(format!("unknown source: {other}")),
    }
}

fn copies_of<'a>(registry: &'a [ImportRecord], source: &str) -> HashSet<&'a str> {
    registry.iter().filter(|r| r.source == source).map(|r| r.to.as_str()).collect()
}

/// Calls `each` with every line of a file that contains one of `needles`,
/// parsed. Lines are searched before they are parsed: session files reach
/// 100 MB and most lines are not wanted.
fn matching_rows(path: &Path, needles: &[&str], mut each: impl FnMut(Value)) {
    let Ok(file) = fs::File::open(path) else { return };
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(text) = std::str::from_utf8(&line) else { continue };
        if !needles.iter().any(|n| text.contains(n)) {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(text) {
            each(v);
        }
    }
}

// --- Claude Code -------------------------------------------------------------

fn scan_claude(roots: &Roots, registry: &[ImportRecord]) -> Vec<Found> {
    let h = roots.native();
    let copies = copies_of(registry, "claude");
    let mut out = Vec::new();
    let Ok(dirs) = fs::read_dir(h.claude.join("projects")) else { return out };
    for dir in dirs.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(files) = fs::read_dir(&dir) else { continue };
        for path in files.flatten().map(|e| e.path()) {
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).filter(|s| is_session_id(s)) else { continue };
            if copies.contains(id) {
                continue;
            }
            // The folder comes from the rows (the directory name is lossy).
            let mut cwd: Option<String> = None;
            let mut prompts = 0;
            matching_rows(&path, &["\"type\":\"user\"", "\"cwd\":"], |v| {
                if cwd.is_none() {
                    cwd = v["cwd"].as_str().map(str::to_string);
                }
                let tool_result = v.pointer("/message/content").and_then(Value::as_array).is_some_and(|c| {
                    c.iter().any(|b| b["type"].as_str() == Some("tool_result"))
                });
                if v["type"].as_str() == Some("user") && !tool_result && !is_synthetic(&v) && row_text(&v).is_some() {
                    prompts += 1;
                }
            });
            let Some(cwd) = cwd.filter(|_| prompts > 0) else { continue };
            // native_import finds the file again by folder; one it cannot find
            // (a folder renamed since) is not offered.
            if claude_copy_path(&h, &cwd, id) != path {
                continue;
            }
            out.push(Found {
                source: "claude".into(),
                id: id.into(),
                title: preview_of(&path),
                imported: existing_copy(registry, "claude", id, |to| claude_copy_path(&h, &cwd, to).exists()).is_some(),
                cwd,
                updated_at_ms: mtime_ms(&path),
                messages: prompts,
            });
        }
    }
    out
}

// --- Codex -------------------------------------------------------------------

fn codex_prompts(path: &Path) -> usize {
    let mut n = 0;
    matching_rows(path, &["\"user_message\""], |v| {
        let p = &v["payload"];
        let text = p["message"].as_str().unwrap_or("").trim();
        if v["type"].as_str() == Some("event_msg")
            && p["type"].as_str() == Some("user_message")
            && !text.is_empty()
            && !text.starts_with('<')
        {
            n += 1;
        }
    });
    n
}

fn scan_codex(roots: &Roots, registry: &[ImportRecord]) -> Vec<Found> {
    let threads = codex_threads(&roots.codex);
    if threads.is_empty() {
        return Vec::new();
    }
    let copies = copies_of(registry, "codex");
    let names = codex_names(&roots.codex);
    let mut out = Vec::new();
    for (id, segs) in &threads {
        if copies.contains(id.as_str())
            || !is_conversation(segs)
            || segs[0].meta["originator"].as_str() == Some(JUCODE_ORIGINATOR)
        {
            continue;
        }
        let Some(cwd) = segs[0].meta["cwd"].as_str() else { continue };
        let live: Vec<_> = segs.iter().filter(|s| !s.archived).collect();
        // A fork's own files: its prompts since the fork.
        let prompts = live.iter().map(|s| codex_prompts(&s.path)).sum();
        let title = names
            .get(id)
            .map(|n| truncate_chars(n, MAX_TITLE_CHARS))
            .unwrap_or_else(|| codex_first_prompt(&segs[0].path));
        if prompts == 0 && title.is_empty() {
            continue;
        }
        out.push(Found {
            source: "codex".into(),
            id: id.clone(),
            title,
            cwd: cwd.to_string(),
            updated_at_ms: live.iter().map(|s| mtime_ms(&s.path)).max().unwrap_or(0),
            messages: prompts,
            imported: existing_copy(registry, "codex", id, |to| threads.contains_key(to)).is_some(),
        });
    }
    out
}

// --- converted conversations -------------------------------------------------

/// One step of a conversation, as a JuCode session entry records it.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Turn {
    User(String),
    Assistant(String),
    Call { call_id: String, name: String, arguments: String },
    Output { call_id: String, name: String, output: String },
}

impl Turn {
    /// The entry `kind` (JuCode-CLI session.rs `entry_to_json`).
    fn kind(&self) -> Value {
        match self {
            Turn::User(text) => json!({ "type": "user", "content": text }),
            Turn::Assistant(text) => json!({
                "type": "response_item",
                "item": { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": text }] }
            }),
            Turn::Call { call_id, name, arguments } => json!({
                "type": "response_item",
                "item": { "type": "function_call", "call_id": call_id, "name": name, "arguments": arguments }
            }),
            Turn::Output { call_id, name, output } => json!({
                "type": "tool_output", "call_id": call_id, "name": name, "output": output, "image": null
            }),
        }
    }
}

/// A conversation read from another agent, ready to write.
pub(super) struct Conversation {
    /// Its title there; empty when it had none.
    pub title: String,
    pub cwd: String,
    pub updated_s: u64,
    /// Each with the second it happened (0: unknown).
    pub turns: Vec<(u64, Turn)>,
}

/// Longest tool output kept; the model saw the rest once, and a resumed
/// session would carry it in every request.
const MAX_OUTPUT_CHARS: usize = 32_000;
/// The session name the CLI derives from the first prompt (session.rs
/// `SESSION_LABEL_MAX_CHARS`).
const LABEL_CHARS: usize = 72;

/// A tool-call id the Responses API accepts.
fn clean_call_id(raw: &str) -> String {
    let id: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-')).take(64).collect();
    if id.is_empty() { "call".to_string() } else { id }
}

/// A function name the APIs accept (`^[A-Za-z0-9_-]{1,64}$`).
fn clean_tool_name(raw: &str) -> String {
    let name: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') { c } else { '_' })
        .take(64)
        .collect();
    if name.is_empty() { "tool".to_string() } else { name }
}

fn clip(text: String) -> String {
    match text.char_indices().nth(MAX_OUTPUT_CHARS) {
        Some((cut, _)) => format!("{}\n[truncated on import]", &text[..cut]),
        None => text,
    }
}

/// Makes the turns a valid request history: ids cleaned and unique, every
/// call followed by its output (a call without one, or an output without its
/// call, is dropped — the API rejects either), empty text gone and an
/// assistant's consecutive texts joined.
pub(super) fn tidy(turns: Vec<(u64, Turn)>) -> Vec<(u64, Turn)> {
    let mut out: Vec<(u64, Turn)> = Vec::with_capacity(turns.len());
    let mut used: HashSet<String> = HashSet::new();
    // A call's id as written there → the id it gets here, until answered.
    let mut open: HashMap<String, String> = HashMap::new();
    let mut answered: HashSet<String> = HashSet::new();
    for (at, turn) in turns {
        match turn {
            Turn::User(text) => {
                let text = text.trim();
                if !text.is_empty() {
                    out.push((at, Turn::User(text.to_string())));
                }
            }
            Turn::Assistant(text) => {
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                if let Some((_, Turn::Assistant(prev))) = out.last_mut() {
                    prev.push_str("\n\n");
                    prev.push_str(text);
                } else {
                    out.push((at, Turn::Assistant(text.to_string())));
                }
            }
            Turn::Call { call_id, name, arguments } => {
                let base = clean_call_id(&call_id);
                let mut id = base.clone();
                let mut n = 2;
                while !used.insert(id.clone()) {
                    id = format!("{base}_{n}");
                    n += 1;
                }
                open.insert(call_id, id.clone());
                out.push((at, Turn::Call { call_id: id, name: clean_tool_name(&name), arguments }));
            }
            Turn::Output { call_id, name, output } => {
                let Some(id) = open.remove(&call_id) else { continue };
                answered.insert(id.clone());
                out.push((at, Turn::Output { call_id: id, name: clean_tool_name(&name), output: clip(output) }));
            }
        }
    }
    out.retain(|(_, t)| !matches!(t, Turn::Call { call_id, .. } if !answered.contains(call_id)));
    out
}

fn first_prompt(turns: &[(u64, Turn)]) -> String {
    turns
        .iter()
        .find_map(|(_, t)| match t {
            Turn::User(text) => text.lines().map(str::trim).find(|l| !l.is_empty()),
            _ => None,
        })
        .map(|l| truncate_chars(l, MAX_TITLE_CHARS))
        .unwrap_or_default()
}

/// The folder as the desktop and the daemon name it: its real path while it
/// exists (projects are added canonicalized), else as recorded.
pub(super) fn folder_key(cwd: &str) -> String {
    let trimmed = if cwd.len() > 1 { cwd.trim_end_matches(['/', '\\']) } else { cwd };
    match fs::canonicalize(trimmed) {
        Ok(real) => {
            let real = real.to_string_lossy().into_owned();
            // Windows canonicalizes to `\\?\C:\...`; sessions are keyed by `C:\...`.
            match real.strip_prefix(r"\\?\") {
                Some(plain) if !plain.starts_with("UNC\\") => plain.to_string(),
                _ => real,
            }
        }
        Err(_) => trimmed.to_string(),
    }
}

/// `sessions/<fnv1a64 of the folder>` (session.rs `hash_path`).
pub(super) fn jucode_session_dir(jucode: &Path, cwd: &str) -> PathBuf {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in cwd.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    jucode.join("sessions").join(format!("{hash:016x}"))
}

/// session.rs `single_line_with_limit`: what the CLI shows as a name.
fn label_of(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let prefix: String = chars.by_ref().take(LABEL_CHARS).collect();
    if chars.next().is_some() { format!("{prefix}...") } else { prefix }
}

fn write_file(path: &Path, text: &str) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("session");
    let tmp = path.with_file_name(format!(".{name}.import.tmp"));
    fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Writes the turns as a new JuCode session in `dir`, the way a first save
/// writes one (entries, then the state); returns its id. The summary goes
/// last: a listing never sees a session without its journal.
pub(super) fn write_session(dir: &Path, title: &str, updated_s: u64, turns: &[(u64, Turn)]) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    // `s{secs:x}{nanos:08x}` like the CLI's; bumped past any taken one.
    let mut nanos = now.subsec_nanos();
    let sid = loop {
        let sid = format!("s{:x}{nanos:08x}", now.as_secs());
        if !dir.join(format!("{sid}.json")).exists() && !dir.join(format!("{sid}.jsonl")).exists() {
            break sid;
        }
        nanos = nanos.wrapping_add(1);
    };
    let created = turns.iter().map(|(at, _)| *at).find(|at| *at > 0).unwrap_or(updated_s);
    let updated = updated_s.max(created);
    let mut journal = String::new();
    for (i, (at, turn)) in turns.iter().enumerate() {
        let id = i as u64 + 1;
        let entry = json!({
            "id": id,
            "parent_id": (id > 1).then(|| id - 1),
            "created_at": if *at > 0 { *at } else { created },
            "kind": turn.kind(),
        });
        journal.push_str(&json!({ "type": "entry", "entry": entry }).to_string());
        journal.push('\n');
    }
    let leaf = turns.len() as u64;
    let state = json!({
        "version": 1,
        "id": sid,
        "created_at": created,
        "updated_at": updated,
        "leaf_id": leaf,
        "next_id": leaf + 1,
        "branch_heads": { "root": leaf },
        "resume_summary": null,
        "resume_status": null,
        "resume_summary_updated_at": null,
        "goal": null,
    });
    journal.push_str(&json!({ "type": "state", "state": state }).to_string());
    journal.push('\n');
    let summary = json!({
        "version": 3,
        "id": sid,
        "created_at": created,
        "updated_at": updated,
        "leaf_id": leaf,
        "next_id": leaf + 1,
        "branch_heads": { "root": leaf },
        "entries_count": turns.len(),
        // The daemon lists a session by this; its title there reads better
        // than the first prompt the CLI would derive.
        "label": label_of(title),
        "resume_summary": null,
        "resume_status": null,
        "resume_summary_updated_at": null,
        "goal": null,
        "journal": format!("{sid}.jsonl"),
    });
    write_file(&dir.join(format!("{sid}.jsonl")), &journal)?;
    let text = serde_json::to_string_pretty(&summary).map_err(|e| e.to_string())? + "\n";
    write_file(&dir.join(format!("{sid}.json")), &text)?;
    Ok(sid)
}

fn import_converted(roots: &Roots, source: &str, id: &str, conv: Conversation) -> Result<Imported, String> {
    let cwd = folder_key(&conv.cwd);
    let dir = jucode_session_dir(&roots.jucode, &cwd);
    let mut registry = load_registry(&roots.registry());
    let title = if conv.title.is_empty() { first_prompt(&conv.turns) } else { conv.title };
    if let Some(to) = existing_copy(&registry, source, id, |to| dir.join(format!("{to}.json")).exists()) {
        return Ok(Imported { id: to, title, cwd, engine: "jucode", reused: true });
    }
    let turns = tidy(conv.turns);
    if !turns.iter().any(|(_, t)| matches!(t, Turn::User(_))) {
        return Err("this conversation has no messages to import".to_string());
    }
    let sid = write_session(&dir, &title, conv.updated_s, &turns)?;
    registry.push(ImportRecord { source: source.into(), from: id.into(), to: sid.clone(), at_ms: now_ms() });
    save_registry(&roots.registry(), &registry)?;
    Ok(Imported { id: sid, title, cwd, engine: "jucode", reused: false })
}

fn converted_imported(roots: &Roots, registry: &[ImportRecord], source: &str, id: &str, cwd: &str) -> bool {
    let dir = jucode_session_dir(&roots.jucode, &folder_key(cwd));
    existing_copy(registry, source, id, |to| dir.join(format!("{to}.json")).exists()).is_some()
}

// --- opencode / zcode --------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Db {
    Opencode,
    Zcode,
}

impl Db {
    fn source(self) -> &'static str {
        match self {
            Db::Opencode => "opencode",
            Db::Zcode => "zcode",
        }
    }

    fn path(self, roots: &Roots) -> PathBuf {
        match self {
            Db::Opencode => roots.opencode_db(),
            Db::Zcode => roots.zcode_db(),
        }
    }
}

fn open_db(path: &Path) -> Option<Connection> {
    if !path.is_file() {
        return None;
    }
    let conn =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    // The app may be writing; wait for it rather than fail.
    let _ = conn.busy_timeout(Duration::from_secs(3));
    Some(conn)
}

fn columns(conn: &Connection, table: &str) -> HashSet<String> {
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) else { return HashSet::new() };
    stmt.query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// The app's own title, when it is one: opencode names an untitled session
/// "New session - <date>", zcode marks a placeholder with `title_source`.
fn real_title(title: &str, title_source: Option<&str>) -> String {
    let t = title.trim();
    if t.is_empty()
        || title_source == Some("default")
        || t.starts_with("New session - ")
        || t.starts_with("Child session - ")
    {
        return String::new();
    }
    truncate_chars(t, MAX_TITLE_CHARS)
}

/// Text the user wrote: not the app's own additions (`synthetic`) or parts
/// it left out (`ignored`).
fn written(part: &Value) -> Option<&str> {
    (part["type"].as_str() == Some("text") && part["synthetic"] != json!(true) && part["ignored"] != json!(true))
        .then(|| part["text"].as_str())
        .flatten()
        .filter(|t| !t.trim().is_empty())
}

struct DbSession {
    id: String,
    cwd: String,
    title: String,
    updated_ms: u64,
    prompts: usize,
}

fn db_sessions(conn: &Connection) -> rusqlite::Result<Vec<DbSession>> {
    let cols = columns(conn, "session");
    // Sub-agent sessions resume only through their parent.
    let mut filter = "s.parent_id IS NULL".to_string();
    if cols.contains("task_type") {
        filter.push_str(" AND s.task_type = 'interactive'");
    }
    let title_source = if cols.contains("title_source") { "s.title_source" } else { "NULL" };
    let sql = format!(
        "SELECT s.id, s.directory, s.title, {title_source}, s.time_updated,
           (SELECT COUNT(*) FROM message m
             WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'user'
               AND NOT EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id
                               AND json_extract(p.data, '$.type') = 'compaction'))
         FROM session s WHERE {filter}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        let title: String = row.get(2)?;
        let title_source: Option<String> = row.get(3)?;
        Ok(DbSession {
            id: row.get(0)?,
            cwd: row.get(1)?,
            title: real_title(&title, title_source.as_deref()),
            updated_ms: row.get::<_, i64>(4)?.max(0) as u64,
            prompts: row.get::<_, i64>(5)?.max(0) as usize,
        })
    })?;
    rows.collect()
}

/// The first thing the user wrote in a session (a title for an untitled one).
fn db_first_prompt(conn: &Connection, id: &str) -> String {
    let sql = "SELECT p.data FROM part p JOIN message m ON m.id = p.message_id
               WHERE m.session_id = ?1 AND json_extract(m.data, '$.role') = 'user'
                 AND json_extract(p.data, '$.type') = 'text'
               ORDER BY m.time_created, m.id, p.id LIMIT 20";
    let Ok(mut stmt) = conn.prepare(sql) else { return String::new() };
    let Ok(rows) = stmt.query_map(params![id], |row| row.get::<_, String>(0)) else { return String::new() };
    for data in rows.flatten() {
        let Ok(part) = serde_json::from_str::<Value>(&data) else { continue };
        if let Some(line) = written(&part).and_then(|t| t.lines().map(str::trim).find(|l| !l.is_empty())) {
            return truncate_chars(line, MAX_TITLE_CHARS);
        }
    }
    String::new()
}

fn scan_db(roots: &Roots, db: Db, registry: &[ImportRecord]) -> Vec<Found> {
    let Some(conn) = open_db(&db.path(roots)) else { return Vec::new() };
    let Ok(list) = db_sessions(&conn) else { return Vec::new() };
    list.into_iter()
        .filter(|s| s.prompts > 0)
        .map(|s| Found {
            source: db.source().into(),
            title: if s.title.is_empty() { db_first_prompt(&conn, &s.id) } else { s.title },
            imported: converted_imported(roots, registry, db.source(), &s.id, &s.cwd),
            id: s.id,
            cwd: s.cwd,
            updated_at_ms: s.updated_ms,
            messages: s.prompts,
        })
        .collect()
}

fn text_of(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// How an attached file is mentioned in the prompt it came with.
fn file_label(part: &Value) -> String {
    let local = part["source"]["path"]
        .as_str()
        .or_else(|| part["url"].as_str().filter(|u| u.starts_with('/')))
        .or_else(|| part["url"].as_str().and_then(|u| u.strip_prefix("file://")));
    let name = local.or_else(|| part["filename"].as_str()).unwrap_or("attachment");
    format!("[file: {name}]")
}

/// A tool part's call and its result.
fn db_tool(part: &Value, at: u64) -> [(u64, Turn); 2] {
    let call_id = part["callID"].as_str().unwrap_or("").to_string();
    let name = part["tool"].as_str().unwrap_or("tool").to_string();
    let state = &part["state"];
    let arguments = match &state["input"] {
        Value::Null => "{}".to_string(),
        input => input.to_string(),
    };
    let output = match state["status"].as_str() {
        Some("completed") => text_of(&state["output"]),
        Some("error") => format!("Error: {}", text_of(&state["error"])),
        _ => "[the tool did not finish]".to_string(),
    };
    [(at, Turn::Call { call_id: call_id.clone(), name: name.clone(), arguments }), (at, Turn::Output { call_id, name, output })]
}

/// Messages (in order) and their parts as turns.
pub(super) fn convert_db(messages: &[(String, Value)], parts: &HashMap<String, Vec<Value>>) -> Vec<(u64, Turn)> {
    let none = Vec::new();
    let mut turns = Vec::new();
    for (id, data) in messages {
        let parts = parts.get(id).unwrap_or(&none);
        // A compaction: its marker, and the summary standing for the history
        // before it (opencode: an assistant message with `summary: true`;
        // zcode: a user message carrying a compaction part).
        if parts.iter().any(|p| p["type"].as_str() == Some("compaction")) || data["summary"] == json!(true) {
            continue;
        }
        let at = data["time"]["created"].as_u64().unwrap_or(0) / 1000;
        match data["role"].as_str() {
            Some("user") => {
                let mut text = Vec::new();
                for p in parts {
                    if let Some(t) = written(p) {
                        text.push(t.to_string());
                    } else if p["type"].as_str() == Some("file") {
                        text.push(file_label(p));
                    }
                }
                turns.push((at, Turn::User(text.join("\n\n"))));
            }
            Some("assistant") => {
                for p in parts {
                    match p["type"].as_str() {
                        Some("text") => {
                            if let Some(t) = written(p) {
                                turns.push((at, Turn::Assistant(t.to_string())));
                            }
                        }
                        Some("tool") => turns.extend(db_tool(p, at)),
                        // reasoning, step-start/-finish, patch, snapshot, timeline …
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    turns
}

fn load_db(roots: &Roots, db: Db, id: &str) -> Result<Conversation, String> {
    let conn = open_db(&db.path(roots)).ok_or_else(|| format!("{} has no conversations here", db.source()))?;
    let err = |e: rusqlite::Error| format!("cannot read {}: {e}", db.path(roots).display());
    let title_source = if columns(&conn, "session").contains("title_source") { "title_source" } else { "NULL" };
    let head: Option<(String, String, Option<String>, i64)> = conn
        .query_row(
            &format!("SELECT directory, title, {title_source}, time_updated FROM session WHERE id = ?1"),
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let (cwd, title, title_source, updated_ms) =
        head.ok_or_else(|| format!("{} conversation {id} not found", db.source()))?;
    // zcode numbers messages and parts; opencode's ids sort by time.
    let order = |table: &str, by: &str| {
        if columns(&conn, table).contains("sequence") { format!("{by}sequence, time_created, id") } else { format!("{by}time_created, id") }
    };
    let mut messages = Vec::new();
    {
        let mut stmt = conn
            .prepare(&format!("SELECT id, data FROM message WHERE session_id = ?1 ORDER BY {}", order("message", "")))
            .map_err(err)?;
        let rows = stmt.query_map(params![id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(err)?;
        for row in rows {
            let (mid, data) = row.map_err(err)?;
            messages.push((mid, serde_json::from_str::<Value>(&data).unwrap_or(Value::Null)));
        }
    }
    let mut parts: HashMap<String, Vec<Value>> = HashMap::new();
    {
        let part_order = if columns(&conn, "part").contains("sequence") { "message_id, sequence, id" } else { "message_id, id" };
        let mut stmt = conn
            .prepare(&format!("SELECT message_id, data FROM part WHERE session_id = ?1 ORDER BY {part_order}"))
            .map_err(err)?;
        let rows = stmt.query_map(params![id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(err)?;
        for row in rows {
            let (mid, data) = row.map_err(err)?;
            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                parts.entry(mid).or_default().push(v);
            }
        }
    }
    Ok(Conversation {
        title: real_title(&title, title_source.as_deref()),
        cwd,
        updated_s: updated_ms.max(0) as u64 / 1000,
        turns: convert_db(&messages, &parts),
    })
}

// --- omp ---------------------------------------------------------------------

struct OmpFile {
    id: String,
    cwd: String,
    title: String,
    entries: Vec<Value>,
}

fn omp_files(roots: &Roots) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(dirs) = fs::read_dir(roots.omp_agent().join("sessions")) else { return out };
    for dir in dirs.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(files) = fs::read_dir(&dir) else { continue };
        out.extend(
            files
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl")),
        );
    }
    out
}

/// A session file: an optional fixed-width `title` slot, the `session`
/// header, then the entries.
fn read_omp(path: &Path) -> Option<OmpFile> {
    let text = fs::read_to_string(path).ok()?;
    let mut slot_title = String::new();
    let mut header: Option<Value> = None;
    let mut entries = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match (&header, v["type"].as_str()) {
            (None, Some("title")) => slot_title = v["title"].as_str().unwrap_or("").to_string(),
            (None, Some("session")) => header = Some(v),
            (Some(_), _) => entries.push(v),
            _ => {}
        }
    }
    let header = header?;
    // A sub-agent's or a fork's session names the one it came from; the
    // conversation itself is the parent's.
    if header["parentSession"].as_str().is_some_and(|p| !p.is_empty()) {
        return None;
    }
    let title = Some(slot_title.trim())
        .filter(|t| !t.is_empty())
        .or_else(|| header["title"].as_str().map(str::trim))
        .map(|t| truncate_chars(t, MAX_TITLE_CHARS))
        .unwrap_or_default();
    Some(OmpFile { id: header["id"].as_str()?.to_string(), cwd: header["cwd"].as_str()?.to_string(), title, entries })
}

/// The active branch: from the last entry back to the root (omp rebuilds
/// its leaf from the last physical entry).
fn omp_branch(entries: &[Value]) -> Vec<&Value> {
    let by_id: HashMap<&str, &Value> = entries.iter().filter_map(|e| Some((e["id"].as_str()?, e))).collect();
    let mut path = Vec::new();
    let mut seen = HashSet::new();
    let mut current = entries.iter().rev().find_map(|e| e["id"].as_str());
    while let Some(id) = current {
        if !seen.insert(id) {
            break;
        }
        let Some(entry) = by_id.get(id) else { break };
        path.push(*entry);
        current = entry["parentId"].as_str();
    }
    path.reverse();
    path
}

/// Text of a message's content (a string, or text and image blocks).
fn omp_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| match b["type"].as_str() {
                Some("text") => b["text"].as_str().map(str::to_string),
                Some("image") => Some("[image]".to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(super) fn convert_omp(entries: &[Value]) -> Vec<(u64, Turn)> {
    let mut turns = Vec::new();
    for entry in omp_branch(entries) {
        // compaction, branch_summary, model_change, custom … carry no turns.
        if entry["type"].as_str() != Some("message") {
            continue;
        }
        let m = &entry["message"];
        let at = m["timestamp"].as_u64().unwrap_or(0) / 1000;
        match m["role"].as_str() {
            Some("user") if m["synthetic"] != json!(true) => turns.push((at, Turn::User(omp_text(&m["content"])))),
            Some("assistant") => {
                for block in m["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") => {
                            turns.push((at, Turn::Assistant(block["text"].as_str().unwrap_or("").to_string())))
                        }
                        Some("toolCall") => turns.push((
                            at,
                            Turn::Call {
                                call_id: block["id"].as_str().unwrap_or("").to_string(),
                                name: block["name"].as_str().unwrap_or("tool").to_string(),
                                arguments: match &block["arguments"] {
                                    Value::Null => "{}".to_string(),
                                    Value::String(s) => s.clone(),
                                    args => args.to_string(),
                                },
                            },
                        )),
                        // thinking, redactedThinking
                        _ => {}
                    }
                }
            }
            Some("toolResult") => {
                let text = omp_text(&m["content"]);
                turns.push((
                    at,
                    Turn::Output {
                        call_id: m["toolCallId"].as_str().unwrap_or("").to_string(),
                        name: m["toolName"].as_str().unwrap_or("tool").to_string(),
                        output: if m["isError"] == json!(true) { format!("Error: {text}") } else { text },
                    },
                ))
            }
            // developer, bashExecution, fileMention …
            _ => {}
        }
    }
    turns
}

fn scan_omp(roots: &Roots, registry: &[ImportRecord]) -> Vec<Found> {
    let mut out = Vec::new();
    for path in omp_files(roots) {
        let Some(file) = read_omp(&path) else { continue };
        let turns = convert_omp(&file.entries);
        let prompts = turns.iter().filter(|(_, t)| matches!(t, Turn::User(s) if !s.trim().is_empty())).count();
        if prompts == 0 {
            continue;
        }
        out.push(Found {
            source: "omp".into(),
            title: if file.title.is_empty() { first_prompt(&turns) } else { file.title },
            imported: converted_imported(roots, registry, "omp", &file.id, &file.cwd),
            id: file.id,
            cwd: file.cwd,
            updated_at_ms: mtime_ms(&path),
            messages: prompts,
        });
    }
    out
}

fn load_omp(roots: &Roots, id: &str) -> Result<Conversation, String> {
    for path in omp_files(roots) {
        let Some(file) = read_omp(&path) else { continue };
        if file.id != id {
            continue;
        }
        return Ok(Conversation {
            title: file.title,
            cwd: file.cwd,
            updated_s: mtime_ms(&path) / 1000,
            turns: convert_omp(&file.entries),
        });
    }
    Err(format!("omp conversation {id} not found"))
}

#[cfg(test)]
mod tests {
    use super::super::testutil;
    use super::*;

    fn call(id: &str) -> Turn {
        Turn::Call { call_id: id.into(), name: "bash".into(), arguments: "{}".into() }
    }
    fn output(id: &str) -> Turn {
        Turn::Output { call_id: id.into(), name: "bash".into(), output: "ok".into() }
    }

    #[test]
    fn tidy_pairs_calls_and_cleans_ids() {
        let turns = vec![
            (1, Turn::User("  hi ".into())),
            (1, Turn::Assistant("one".into())),
            (1, Turn::Assistant("two".into())),
            (2, call("call:1/x")),
            (2, output("call:1/x")),
            (3, call("lost")),
            (3, output("never-called")),
            (4, call("dup")),
            (4, output("dup")),
            (4, call("dup")),
            (4, output("dup")),
            (5, Turn::Assistant("   ".into())),
        ];
        let got = tidy(turns);
        assert_eq!(
            got.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>(),
            vec![
                Turn::User("hi".into()),
                Turn::Assistant("one\n\ntwo".into()),
                call("call1x"),
                output("call1x"),
                call("dup"),
                output("dup"),
                call("dup_2"),
                output("dup_2"),
            ]
        );
        let long = tidy(vec![(0, call("a")), (0, Turn::Output { call_id: "a".into(), name: "mcp.x y".into(), output: "x".repeat(MAX_OUTPUT_CHARS + 5) })]);
        match &long[1].1 {
            Turn::Output { name, output, .. } => {
                assert_eq!(name, "mcp_x_y");
                assert!(output.ends_with("[truncated on import]"));
            }
            other => panic!("{other:?}"),
        }
    }

    fn opencode_db(path: &Path, zcode: bool) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(path).unwrap();
        let extra = if zcode { ", task_type text not null default 'interactive', title_source text" } else { "" };
        let seq = if zcode { ", sequence integer" } else { "" };
        conn.execute_batch(&format!(
            "CREATE TABLE session (id text primary key, project_id text, parent_id text, directory text not null,
               title text not null, time_created integer not null, time_updated integer not null{extra});
             CREATE TABLE message (id text primary key, session_id text not null, time_created integer not null,
               time_updated integer not null, data text not null{seq});
             CREATE TABLE part (id text primary key, message_id text not null, session_id text not null,
               time_created integer not null, time_updated integer not null, data text not null{seq});"
        ))
        .unwrap();
        let session = |id: &str, parent: Option<&str>, title: &str| {
            conn.execute(
                "INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated) VALUES (?1, 'p', ?2, '/proj/oc', ?3, 1000, 1790000000000)",
                params![id, parent, title],
            )
            .unwrap();
        };
        session("ses_main", None, "New session - 2026-08-18T10:34:46.692Z");
        session("ses_child", Some("ses_main"), "child");
        let message = |id: &str, session: &str, at: i64, data: Value| {
            conn.execute(
                "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?1, ?2, ?3, ?3, ?4)",
                params![id, session, at, data.to_string()],
            )
            .unwrap();
        };
        let part = |id: &str, msg: &str, data: Value| {
            conn.execute(
                "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?1, ?2, 'ses_main', 0, 0, ?3)",
                params![id, msg, data.to_string()],
            )
            .unwrap();
        };
        message("msg_1", "ses_main", 1_790_000_000_000, json!({"role": "user", "time": {"created": 1_790_000_000_000u64}}));
        part("prt_1", "msg_1", json!({"type": "text", "text": "fix the bug"}));
        part("prt_2", "msg_1", json!({"type": "text", "text": "Called the Read tool", "synthetic": true}));
        part("prt_3", "msg_1", json!({"type": "file", "filename": "a.png", "url": "data:image/png;base64,xx"}));
        message("msg_2", "ses_main", 1_790_000_001_000, json!({"role": "assistant", "time": {"created": 1_790_000_001_000u64}}));
        part("prt_4", "msg_2", json!({"type": "step-start"}));
        part("prt_5", "msg_2", json!({"type": "reasoning", "text": "hmm"}));
        part("prt_6", "msg_2", json!({"type": "tool", "callID": "call-1", "tool": "bash", "state": {"status": "completed", "input": {"command": "ls"}, "output": "a.txt"}}));
        part("prt_7", "msg_2", json!({"type": "tool", "callID": "call-2", "tool": "read", "state": {"status": "error", "input": {"filePath": "x"}, "error": "no such file"}}));
        part("prt_8", "msg_2", json!({"type": "step-finish"}));
        message("msg_3", "ses_main", 1_790_000_002_000, json!({"role": "assistant", "time": {"created": 1_790_000_002_000u64}}));
        part("prt_9", "msg_3", json!({"type": "text", "text": "Done."}));
        // A compaction: the trigger and its summary are left out.
        message("msg_4", "ses_main", 1_790_000_003_000, json!({"role": "user", "time": {"created": 1_790_000_003_000u64}}));
        part("prt_10", "msg_4", json!({"type": "compaction", "auto": true}));
        message("msg_5", "ses_main", 1_790_000_004_000, json!({"role": "assistant", "summary": true, "time": {"created": 1_790_000_004_000u64}}));
        part("prt_11", "msg_5", json!({"type": "text", "text": "Summary of everything"}));
        message("msg_6", "ses_main", 1_790_000_005_000, json!({"role": "user", "time": {"created": 1_790_000_005_000u64}}));
        part("prt_12", "msg_6", json!({"type": "text", "text": "thanks"}));
        message("msg_c", "ses_child", 1_790_000_000_000, json!({"role": "user"}));
    }

    #[test]
    fn opencode_converts_and_reimport_reuses() {
        let roots = testutil::roots("opencode");
        opencode_db(&roots.opencode_db(), false);
        let found = scan(&roots);
        assert_eq!(found.len(), 1, "the sub-agent session is not offered");
        let s = &found[0];
        assert_eq!((s.source.as_str(), s.id.as_str(), s.messages), ("opencode", "ses_main", 2));
        assert_eq!(s.title, "fix the bug", "the placeholder title gives way to the first prompt");
        assert!(!s.imported);

        let pick = SessionPick { source: "opencode".into(), id: "ses_main".into(), cwd: String::new() };
        let done = import(&roots, &pick).unwrap();
        assert!(!done.reused && done.engine == "jucode" && done.cwd == "/proj/oc");
        let dir = jucode_session_dir(&roots.jucode, "/proj/oc");
        let lines: Vec<Value> = fs::read_to_string(dir.join(format!("{}.jsonl", done.id)))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        let kinds: Vec<Value> = lines.iter().filter(|l| l["type"] == "entry").map(|l| l["entry"]["kind"].clone()).collect();
        assert_eq!(
            kinds,
            vec![
                json!({"type": "user", "content": "fix the bug\n\n[file: a.png]"}),
                json!({"type": "response_item", "item": {"type": "function_call", "call_id": "call-1", "name": "bash", "arguments": "{\"command\":\"ls\"}"}}),
                json!({"type": "tool_output", "call_id": "call-1", "name": "bash", "output": "a.txt", "image": null}),
                json!({"type": "response_item", "item": {"type": "function_call", "call_id": "call-2", "name": "read", "arguments": "{\"filePath\":\"x\"}"}}),
                json!({"type": "tool_output", "call_id": "call-2", "name": "read", "output": "Error: no such file", "image": null}),
                json!({"type": "response_item", "item": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]}}),
                json!({"type": "user", "content": "thanks"}),
            ]
        );
        // Entries chain one after another; the state closes the journal.
        let entries: Vec<&Value> = lines.iter().filter(|l| l["type"] == "entry").map(|l| &l["entry"]).collect();
        assert_eq!(entries[0]["parent_id"], Value::Null);
        assert!(entries.windows(2).all(|w| w[1]["parent_id"] == w[0]["id"]));
        assert_eq!(entries[0]["created_at"], 1_790_000_000u64);
        let state = &lines.last().unwrap()["state"];
        assert_eq!(lines.last().unwrap()["type"], "state");
        assert_eq!((state["leaf_id"].as_u64(), state["next_id"].as_u64()), (Some(7), Some(8)));
        assert_eq!(state["branch_heads"], json!({"root": 7}));
        let summary: Value = serde_json::from_str(&fs::read_to_string(dir.join(format!("{}.json", done.id))).unwrap()).unwrap();
        assert_eq!(summary["version"], 3);
        assert_eq!(summary["entries_count"], 7);
        assert_eq!(summary["label"], "fix the bug");
        assert_eq!(summary["journal"], format!("{}.jsonl", done.id));
        assert_eq!(summary["updated_at"], 1_790_000_000u64);
        assert!(done.id.starts_with('s') && done.id.len() > 9);

        let again = import(&roots, &pick).unwrap();
        assert!(again.reused);
        assert_eq!(again.id, done.id);
        assert!(scan(&roots)[0].imported);
        assert!(import(&roots, &SessionPick { source: "opencode".into(), id: "nope".into(), cwd: String::new() }).is_err());
    }

    #[test]
    fn zcode_keeps_interactive_sessions_in_sequence() {
        let roots = testutil::roots("zcode");
        let path = roots.zcode_db();
        opencode_db(&path, true);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "UPDATE session SET title = 'Named', title_source = 'generated' WHERE id = 'ses_main';
             INSERT INTO session (id, parent_id, directory, title, time_created, time_updated, task_type)
               VALUES ('sess_sub', NULL, '/proj/oc', 'sub', 0, 0, 'subagent_child');
             UPDATE message SET sequence = CAST(substr(id, 5) AS integer);
             UPDATE message SET sequence = 0 WHERE id = 'msg_6';",
        )
        .unwrap();
        drop(conn);
        let found = scan(&roots);
        assert_eq!(found.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["ses_main"]);
        assert_eq!(found[0].title, "Named");
        let conv = load_db(&roots, Db::Zcode, "ses_main").unwrap();
        assert_eq!(conv.turns.first().map(|(_, t)| t.clone()), Some(Turn::User("thanks".into())), "zcode's sequence wins over time");
    }

    #[test]
    fn omp_follows_the_active_branch() {
        let roots = testutil::roots("omp");
        let cwd = roots.home.join("work");
        fs::create_dir_all(&cwd).unwrap();
        let cwd = cwd.to_string_lossy().to_string();
        let rows = [
            json!({"type": "title", "v": 1, "title": "Port the parser", "updatedAt": "x", "pad": "   "}),
            json!({"type": "session", "version": 3, "id": "019c625b-b900-7000-8000-000000000001", "cwd": cwd}),
            json!({"type": "model_change", "id": "m0", "parentId": null, "model": "anthropic/x"}),
            json!({"type": "message", "id": "a1", "parentId": "m0", "message": {"role": "user", "content": "port it", "timestamp": 1_790_000_000_000u64}}),
            json!({"type": "message", "id": "a2", "parentId": "a1", "message": {"role": "assistant", "content": [
                {"type": "thinking", "thinking": "hm", "thinkingSignature": "sig"},
                {"type": "text", "text": "Reading."},
                {"type": "toolCall", "id": "toolu_01", "name": "read", "arguments": {"path": "a.rs"}}]}}),
            json!({"type": "message", "id": "a3", "parentId": "a2", "message": {"role": "toolResult", "toolCallId": "toolu_01", "toolName": "read", "content": [{"type": "text", "text": "fn main() {}"}], "isError": false}}),
            json!({"type": "message", "id": "b1", "parentId": "a3", "message": {"role": "user", "content": [{"type": "text", "text": "abandoned"}]}}),
            json!({"type": "compaction", "id": "a4", "parentId": "a3", "summary": "x", "firstKeptEntryId": "a1"}),
            json!({"type": "message", "id": "a5", "parentId": "a4", "message": {"role": "user", "content": [{"type": "text", "text": "now test it"}, {"type": "image", "data": "..", "mimeType": "image/png"}]}}),
        ];
        let text: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
        testutil::write(&roots.omp_agent().join("sessions/-work/2026_019c.jsonl"), &(text.join("\n") + "\n"));
        // A sub-agent's file is not a conversation of its own.
        testutil::write(
            &roots.omp_agent().join("sessions/-work/2026_sub.jsonl"),
            &format!("{}\n", json!({"type": "session", "id": "sub", "cwd": cwd, "parentSession": "019c625b"})),
        );
        let found = scan(&roots);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].title.as_str(), found[0].messages), ("Port the parser", 2));
        let conv = load_omp(&roots, "019c625b-b900-7000-8000-000000000001").unwrap();
        let turns: Vec<Turn> = tidy(conv.turns).into_iter().map(|(_, t)| t).collect();
        assert_eq!(
            turns,
            vec![
                Turn::User("port it".into()),
                Turn::Assistant("Reading.".into()),
                Turn::Call { call_id: "toolu_01".into(), name: "read".into(), arguments: "{\"path\":\"a.rs\"}".into() },
                Turn::Output { call_id: "toolu_01".into(), name: "read".into(), output: "fn main() {}".into() },
                Turn::User("now test it\n[image]".into()),
            ]
        );
        let pick = SessionPick { source: "omp".into(), id: found[0].id.clone(), cwd: String::new() };
        let done = import(&roots, &pick).unwrap();
        assert_eq!(done.cwd, folder_key(&cwd));
        assert!(jucode_session_dir(&roots.jucode, &done.cwd).join(format!("{}.json", done.id)).exists());
    }

    #[test]
    fn claude_sessions_are_found_by_the_folder_in_their_rows() {
        let roots = testutil::roots("claude-scan");
        let cwd = "/proj/claude demo";
        let id = "aaaaaaaa-1111-4111-8111-111111111111";
        let path = claude_copy_path(&roots.native(), cwd, id);
        let rows = [
            json!({"type": "queue-operation", "content": "x"}),
            json!({"type": "user", "cwd": cwd, "uuid": "u1", "message": {"role": "user", "content": "hello there"}}),
            json!({"type": "assistant", "cwd": cwd, "uuid": "a1", "message": {"content": [{"type": "tool_use", "id": "t", "name": "Bash", "input": {}}]}}),
            json!({"type": "user", "cwd": cwd, "uuid": "u2", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "ok"}]}}),
            json!({"type": "user", "cwd": cwd, "isMeta": true, "message": {"role": "user", "content": "<local-command-caveat>"}}),
            json!({"type": "user", "cwd": cwd, "uuid": "u3", "message": {"role": "user", "content": [{"type": "text", "text": "and again"}]}}),
        ];
        let text: Vec<String> = rows.iter().map(|r| r.to_string()).collect();
        testutil::write(&path, &text.join("\n"));
        let found = scan(&roots);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].cwd.as_str(), found[0].messages, found[0].title.as_str()), (cwd, 2, "hello there"));
        let done = import(&roots, &SessionPick { source: "claude".into(), id: id.into(), cwd: cwd.into() }).unwrap();
        assert!(!done.reused && done.engine == "claude");
        let found = scan(&roots);
        assert_eq!(found.len(), 1, "the copy is not offered");
        assert!(found[0].imported);
        assert!(import(&roots, &SessionPick { source: "claude".into(), id: id.into(), cwd: cwd.into() }).unwrap().reused);
    }

    #[test]
    fn session_dir_hash_matches_the_cli() {
        // A folder `jucode` saved sessions for (seen under ~/.jucode/sessions).
        assert_eq!(
            jucode_session_dir(Path::new("/x"), "/Users/chad/Documents/JuCode"),
            Path::new("/x/sessions/16b727a85fdb3de5")
        );
        assert_eq!(label_of("  a\n b  "), "a b");
        assert_eq!(label_of(&"x".repeat(80)), format!("{}...", "x".repeat(72)));
    }
}
