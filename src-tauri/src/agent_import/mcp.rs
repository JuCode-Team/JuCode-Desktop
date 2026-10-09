//! MCP servers the other agents are configured with, as JuCode
//! `mcp_servers` entries: {name, transport: "stdio" | "http", command, args,
//! env, url, headers, enabled, timeout_seconds} (JuCode-CLI config.rs).
//!
//! Read from Claude Code's `~/.claude.json` (`mcpServers`, also per project)
//! and its plugins' `.mcp.json`; Codex's `config.toml` (`[mcp_servers.*]`)
//! and its enabled plugins; opencode's `opencode.json(c)` (`mcp`); zcode's
//! config and plugins; omp's `~/.omp/agent/mcp.json`. A server JuCode could
//! not start as written is left out: an SSE endpoint, a command relative to
//! the tool's own folder, or a `${…}` placeholder only its app fills in.

use super::{codex_config, plugins, Roots};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Serialize, Debug, Clone)]
pub struct Found {
    pub source: String,
    /// Where it is set when not in the tool's own settings: the plugin it
    /// comes with, the project folder it is set for.
    pub from: String,
    pub name: String,
    pub transport: &'static str,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
    /// JuCode already has a server of this name.
    pub present: bool,
    /// The `mcp_servers` entry to add.
    pub entry: Value,
}

/// JuCode-CLI `DEFAULT_MCP_TIMEOUT_SECONDS`.
const DEFAULT_TIMEOUT: u64 = 60;

/// A server as some tool writes it, before it is checked.
#[derive(Default, Debug)]
struct Raw {
    kind: Option<String>,
    command: Option<String>,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    url: Option<String>,
    headers: BTreeMap<String, String>,
    disabled: bool,
    timeout_s: Option<u64>,
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(|x| x.as_str().map(str::to_string)).collect()
}

fn string_map(v: &Value) -> BTreeMap<String, String> {
    v.as_object()
        .into_iter()
        .flatten()
        .map(|(k, v)| (k.clone(), v.as_str().map_or_else(|| v.to_string(), str::to_string)))
        .collect()
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn millis(v: &Value) -> Option<u64> {
    v.as_f64().filter(|ms| *ms > 0.0).map(|ms| (ms / 1000.0).ceil() as u64)
}

/// The `mcpServers` shape Claude Code, omp and plugin `.mcp.json` files use.
fn standard(v: &Value) -> Raw {
    let (command, args) = match &v["command"] {
        // Some write the whole command line as a list.
        Value::Array(_) => {
            let mut all = strings(&v["command"]);
            let first = (!all.is_empty()).then(|| all.remove(0));
            all.extend(strings(&v["args"]));
            (first, all)
        }
        other => (text(other), strings(&v["args"])),
    };
    Raw {
        kind: text(&v["type"]).or_else(|| text(&v["transport"])),
        command,
        args,
        env: string_map(&v["env"]),
        url: text(&v["url"]),
        headers: string_map(&v["headers"]),
        disabled: v["disabled"] == json!(true) || v["enabled"] == json!(false),
        timeout_s: millis(&v["timeout"]).or_else(|| millis(&v["timeoutMs"])),
    }
}

/// Codex `[mcp_servers.<name>]`.
fn codex(v: &Value) -> Raw {
    Raw {
        kind: text(&v["type"]),
        command: text(&v["command"]),
        args: strings(&v["args"]),
        env: string_map(&v["env"]),
        url: text(&v["url"]),
        headers: string_map(&v["http_headers"]),
        disabled: v["enabled"] == json!(false),
        timeout_s: v["tool_timeout_sec"].as_f64().filter(|s| *s > 0.0).map(|s| s.ceil() as u64),
    }
}

/// opencode `mcp.<name>`: `local` runs `command` (a list), `remote` is a URL.
fn opencode(v: &Value) -> Raw {
    let mut all = strings(&v["command"]);
    let command = (!all.is_empty()).then(|| all.remove(0));
    Raw {
        kind: text(&v["type"]),
        command,
        args: all,
        env: string_map(&v["environment"]),
        url: text(&v["url"]),
        headers: string_map(&v["headers"]),
        disabled: v["enabled"] == json!(false),
        timeout_s: millis(&v["timeout"]),
    }
}

/// A server name JuCode accepts (`^[A-Za-z0-9_-]+$`).
fn clean_name(name: &str) -> Option<String> {
    let name: String = name
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '-' })
        .collect();
    let name = name.trim_matches('-').to_string();
    (!name.is_empty()).then_some(name)
}

/// The JuCode entry for a server, or None when it could not run as written.
/// `plugin` fills in the plugin-folder placeholders of a plugin's servers.
fn entry(name: &str, mut raw: Raw, plugin: Option<&Path>) -> Option<Value> {
    let name = clean_name(name)?;
    if let Some(dir) = plugin {
        let dir = dir.display().to_string();
        let fill = |s: &mut String| {
            for key in ["${CLAUDE_PLUGIN_ROOT}", "${ZCODE_PLUGIN_ROOT}", "${PLUGIN_ROOT}"] {
                *s = s.replace(key, &dir);
            }
        };
        raw.command.iter_mut().for_each(fill);
        raw.url.iter_mut().for_each(fill);
        raw.args.iter_mut().for_each(fill);
        raw.env.values_mut().for_each(fill);
        raw.headers.values_mut().for_each(fill);
    }
    let unfilled = |s: &String| s.contains("${");
    if raw.command.iter().chain(&raw.url).chain(&raw.args).chain(raw.env.values()).chain(raw.headers.values()).any(unfilled) {
        return None;
    }
    let http = match raw.kind.as_deref() {
        Some("stdio" | "local") => false,
        Some("http" | "streamable-http" | "streamableHttp" | "streamable_http" | "remote") => true,
        // JuCode speaks streamable HTTP, not the older SSE transport.
        Some(_) => return None,
        None => raw.command.is_none() && raw.url.is_some(),
    };
    let timeout = raw.timeout_s.unwrap_or(DEFAULT_TIMEOUT).clamp(1, 3600);
    if http {
        let url = raw.url.filter(|u| u.starts_with("http://") || u.starts_with("https://"))?;
        Some(json!({
            "name": name, "transport": "http", "command": "", "args": [], "env": {},
            "url": url, "headers": raw.headers, "enabled": !raw.disabled, "timeout_seconds": timeout,
        }))
    } else {
        let command = raw.command?;
        // Relative to the tool's own folder (`./bin/server`): not found from here.
        if command.starts_with("./") || command.starts_with("../") || command.starts_with(".\\") {
            return None;
        }
        Some(json!({
            "name": name, "transport": "stdio", "command": command, "args": raw.args, "env": raw.env,
            "url": "", "headers": {}, "enabled": !raw.disabled, "timeout_seconds": timeout,
        }))
    }
}

/// The servers of a `.mcp.json`: under `mcpServers`, or the file itself.
fn server_map(v: &Value) -> Option<&serde_json::Map<String, Value>> {
    v["mcpServers"].as_object().or_else(|| {
        let map = v.as_object()?;
        map.values().all(|s| s.get("command").is_some() || s.get("url").is_some()).then_some(map)
    })
}

/// JSON with comments and trailing commas (opencode.jsonc).
fn strip_jsonc(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            plain.push(c);
            match c {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                plain.push(c);
            }
            ('/', Some('/')) => {
                while chars.peek().is_some_and(|n| *n != '\n') {
                    chars.next();
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut prev = ' ';
                for n in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
            }
            _ => plain.push(c),
        }
    }
    // Trailing commas, outside strings.
    let mut out = String::with_capacity(plain.len());
    let chars: Vec<char> = plain.chars().collect();
    let (mut in_string, mut escaped) = (false, false);
    for (i, &c) in chars.iter().enumerate() {
        if in_string {
            match c {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
        } else if c == '"' {
            in_string = true;
        } else if c == ',' && chars[i + 1..].iter().find(|n| !n.is_whitespace()).is_some_and(|n| matches!(n, '}' | ']')) {
            continue;
        }
        out.push(c);
    }
    out
}

fn read_jsonc(path: &Path) -> Value {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&strip_jsonc(&t)).ok()).unwrap_or_default()
}

/// Names JuCode's config already has.
fn configured(roots: &Roots) -> HashSet<String> {
    let config = crate::read_json(&roots.jucode.join("config.json"));
    config["mcp_servers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s["name"].as_str().map(str::to_string))
        .collect()
}

pub fn scan(roots: &Roots) -> Vec<Found> {
    // (source, from, name, raw server, plugin folder)
    let mut all: Vec<(&'static str, String, String, Raw, Option<std::path::PathBuf>)> = Vec::new();

    let claude = crate::read_json(&roots.home.join(".claude.json"));
    for (name, v) in claude["mcpServers"].as_object().into_iter().flatten() {
        all.push(("claude", String::new(), name.clone(), standard(v), None));
    }
    for (project, p) in claude["projects"].as_object().into_iter().flatten() {
        for (name, v) in p["mcpServers"].as_object().into_iter().flatten() {
            all.push(("claude", project.clone(), name.clone(), standard(v), None));
        }
    }

    let config = codex_config(roots);
    for (name, v) in config["mcp_servers"].as_object().into_iter().flatten() {
        all.push(("codex", String::new(), name.clone(), codex(v), None));
    }

    // opencode.jsonc overrides opencode.json, server by server.
    let dir = roots.config_home.join("opencode");
    let mut servers: BTreeMap<String, Value> = BTreeMap::new();
    for file in ["opencode.json", "opencode.jsonc"] {
        let v = read_jsonc(&dir.join(file));
        for (name, s) in v["mcp"].as_object().into_iter().flatten() {
            servers.insert(name.clone(), s.clone());
        }
    }
    for (name, v) in &servers {
        all.push(("opencode", String::new(), name.clone(), opencode(v), None));
    }

    let zcode = crate::read_json(&roots.home.join(".zcode").join("cli").join("config.json"));
    for (name, v) in zcode["mcp"].as_object().into_iter().flatten() {
        all.push(("zcode", String::new(), name.clone(), opencode(v), None));
    }
    for (name, v) in zcode["mcpServers"].as_object().into_iter().flatten() {
        all.push(("zcode", String::new(), name.clone(), standard(v), None));
    }

    for file in ["mcp.json", ".mcp.json"] {
        let v = read_jsonc(&roots.omp_agent().join(file));
        let off: HashSet<String> = strings(&v["disabledServers"]).into_iter().collect();
        for (name, s) in server_map(&v).into_iter().flatten() {
            let mut raw = standard(s);
            raw.disabled |= off.contains(name);
            all.push(("omp", String::new(), name.clone(), raw, None));
        }
    }

    for plugin in plugins(roots) {
        let v = read_jsonc(&plugin.dir.join(".mcp.json"));
        for (name, s) in server_map(&v).into_iter().flatten() {
            all.push((plugin.source, plugin.name.clone(), name.clone(), standard(s), Some(plugin.dir.clone())));
        }
    }

    let have = configured(roots);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (source, from, name, raw, plugin) in all {
        let Some(entry) = entry(&name, raw, plugin.as_deref()) else { continue };
        let name = entry["name"].as_str().unwrap_or_default().to_string();
        // The same server set for several projects is offered once.
        if !seen.insert((source, name.clone())) {
            continue;
        }
        let stdio = entry["transport"] == "stdio";
        out.push(Found {
            source: source.to_string(),
            from,
            present: have.contains(&name),
            transport: if stdio { "stdio" } else { "http" },
            command: stdio.then(|| entry["command"].as_str().unwrap_or_default().to_string()),
            args: stdio.then(|| strings(&entry["args"])),
            url: (!stdio).then(|| entry["url"].as_str().unwrap_or_default().to_string()),
            name,
            entry,
        });
    }
    let rank = |s: &str| ["claude", "codex", "opencode", "zcode", "omp"].iter().position(|x| *x == s);
    out.sort_by(|a, b| (rank(&a.source), &a.from, &a.name).cmp(&(rank(&b.source), &b.from, &b.name)));
    out
}

#[cfg(test)]
mod tests {
    use super::super::testutil;
    use super::*;

    #[test]
    fn maps_each_tools_format() {
        let roots = testutil::roots("mcp");
        testutil::write(
            &roots.home.join(".claude.json"),
            &json!({
                "mcpServers": {
                    "files": {"type": "stdio", "command": "npx", "args": ["-y", "server-files"], "env": {"ROOT": "/tmp"}},
                    "docs api": {"type": "http", "url": "https://mcp.example.com/mcp", "headers": {"Authorization": "Bearer x"}},
                    "old": {"type": "sse", "url": "https://sse.example.com"},
                    "needs-env": {"command": "srv", "env": {"TOKEN": "${MY_TOKEN}"}}
                },
                "projects": {"/p": {"mcpServers": {"files": {"command": "other"}, "proj": {"command": "proj-srv"}}}}
            })
            .to_string(),
        );
        testutil::write(
            &roots.codex.join("config.toml"),
            "[mcp_servers.node_repl]\ncommand = \"/bin/node_repl\"\nargs = []\ntool_timeout_sec = 120\n\
             [mcp_servers.node_repl.env]\nA = \"1\"\n\
             [mcp_servers.computer-use]\ntype = \"stdio\"\ncommand = \"./App.app/client\"\nenabled = false\n\
             [mcp_servers.remote]\nurl = \"https://r.example.com/mcp\"\nenabled = false\n\
             [plugins.\"notion@curated\"]\nenabled = true\n",
        );
        testutil::write(
            &roots.codex.join("plugins/cache/curated/notion/1dc19589/.mcp.json"),
            &json!({"mcpServers": {"notion": {"type": "http", "url": "https://mcp.notion.com/mcp"}}}).to_string(),
        );
        testutil::write(
            &roots.config_home.join("opencode/opencode.jsonc"),
            "{\n  // mine\n  \"mcp\": {\n    \"jira\": {\"type\": \"local\", \"command\": [\"bun\", \"x\", \"jira-mcp\"], \"environment\": {\"K\": \"v\"}, \"timeout\": 5000,},\n    \"web\": {\"type\": \"remote\", \"url\": \"https://w.example.com/mcp\", \"enabled\": false},\n  },\n}\n",
        );
        // Joined one part at a time: the scan reads it back with native separators.
        let plugin = roots.zcode_plugins().join("official").join("android").join("0.1.0");
        testutil::write(
            &plugin.join(".mcp.json"),
            &json!({"mcpServers": {
                "android": {"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"]},
                "img": {"type": "http", "url": "${ZCODE_BASE_URL}/mcp"}
            }})
            .to_string(),
        );
        testutil::write(
            &roots.omp_agent().join("mcp.json"),
            &json!({"mcpServers": {"gh": {"command": "gh-mcp"}}, "disabledServers": ["gh"]}).to_string(),
        );
        testutil::write(&roots.jucode.join("config.json"), &json!({"mcp_servers": [{"name": "files"}]}).to_string());

        let found = scan(&roots);
        let by = |source: &str, name: &str| {
            found.iter().find(|f| f.source == source && f.name == name).unwrap_or_else(|| panic!("{source} {name}"))
        };
        let names: Vec<(&str, &str)> = found.iter().map(|f| (f.source.as_str(), f.name.as_str())).collect();
        assert_eq!(
            names,
            [
                ("claude", "docs-api"),
                ("claude", "files"),
                ("claude", "proj"),
                ("codex", "node_repl"),
                ("codex", "remote"),
                ("codex", "notion"),
                ("opencode", "jira"),
                ("opencode", "web"),
                ("zcode", "android"),
                ("omp", "gh"),
            ],
            "SSE, unfilled placeholders and folder-relative commands are left out; a name set again for a project is offered once"
        );
        let files = by("claude", "files");
        assert!(files.present);
        assert_eq!(
            files.entry,
            json!({"name": "files", "transport": "stdio", "command": "npx", "args": ["-y", "server-files"], "env": {"ROOT": "/tmp"},
                   "url": "", "headers": {}, "enabled": true, "timeout_seconds": 60})
        );
        assert_eq!(by("claude", "proj").from, "/p");
        let docs = by("claude", "docs-api");
        assert_eq!((docs.transport, docs.url.as_deref()), ("http", Some("https://mcp.example.com/mcp")));
        assert_eq!(docs.entry["headers"], json!({"Authorization": "Bearer x"}));
        assert!(!docs.present);
        let repl = &by("codex", "node_repl").entry;
        assert_eq!((repl["timeout_seconds"].as_u64(), repl["env"].clone()), (Some(120), json!({"A": "1"})));
        assert_eq!(by("codex", "remote").entry["enabled"], false);
        let jira = &by("opencode", "jira").entry;
        assert_eq!((jira["command"].as_str(), jira["args"].clone()), (Some("bun"), json!(["x", "jira-mcp"])));
        assert_eq!((jira["env"].clone(), jira["timeout_seconds"].as_u64()), (json!({"K": "v"}), Some(5)));
        assert_eq!(by("opencode", "web").entry["enabled"], false);
        let android = by("zcode", "android");
        assert_eq!(android.from, "android");
        assert_eq!(android.entry["args"], json!([format!("{}/dist/server.js", plugin.display())]));
        assert_eq!(by("omp", "gh").entry["enabled"], false);
        assert_eq!(by("codex", "notion").from, "notion");
    }

    #[test]
    fn jsonc_comments_and_trailing_commas() {
        let text = "{\"a\": \"x // not a comment\", /* gone */ \"b\": [1, 2,], // end\n}";
        assert_eq!(serde_json::from_str::<Value>(&strip_jsonc(text)).unwrap(), json!({"a": "x // not a comment", "b": [1, 2]}));
        assert_eq!(clean_name("my server.v2"), Some("my-server-v2".into()));
        assert_eq!(clean_name("中文"), None);
    }
}
