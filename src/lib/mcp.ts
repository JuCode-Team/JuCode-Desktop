// Pure logic for the Settings → 扩展 (Extensions & MCP) section: form values ↔
// engine config entry conversion, client-side validation mirroring the engine
// rules (see JuCode docs/mcp.md), and merging the persisted config list with
// the live `mcp_servers` engine view. Framework-free so it's unit-testable.

export type McpTransport = 'stdio' | 'http';
export type McpState = 'connecting' | 'connected' | 'failed' | 'disabled';

export interface McpTool {
	name: string;
	description: string;
}

/** One server in the engine's `mcp_servers` event (live runtime view). */
export interface McpServerView {
	name: string;
	transport: McpTransport;
	state: McpState;
	tools: McpTool[];
	error?: string;
}

/** One `mcp_servers` config entry — the payload of the `mcp_set` op. */
export interface McpServerEntry {
	name: string;
	transport: McpTransport;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled: boolean;
	timeout_seconds?: number;
}

/** A read-only `extensions` config entry (proprietary extension mechanism). */
export interface ExtensionInfo {
	name: string;
	command: string;
	lazy: boolean;
}

/** What the add/edit form binds to. Multi-value fields are line-oriented text. */
export interface McpFormValues {
	name: string;
	transport: McpTransport;
	command: string;
	/** stdio arguments, one per line (or space-separated — simple splitting, no quoting). */
	argsText: string;
	/** stdio environment, KEY=VALUE per line. */
	envText: string;
	url: string;
	/** http headers, KEY: VALUE per line. */
	headersText: string;
	/** Convenience: sets the Authorization header to `Bearer <token>`. */
	bearerToken: string;
	timeoutText: string;
	enabled: boolean;
}

export const MCP_NAME_RE = /^[A-Za-z0-9_-]+$/;
export const MCP_DEFAULT_TIMEOUT = 60;

export function emptyMcpForm(): McpFormValues {
	return {
		name: '',
		transport: 'stdio',
		command: '',
		argsText: '',
		envText: '',
		url: '',
		headersText: '',
		bearerToken: '',
		timeoutText: '',
		enabled: true
	};
}

/** Split an args field on whitespace/newlines. Deliberately simple: no quote
 *  handling — each whitespace-separated token is one argument. */
export function splitArgs(text: string): string[] {
	return text.split(/\s+/).filter((s) => s.length > 0);
}

/** Parse `KEY<sep>VALUE` lines (env `=`, headers `:`). Blank lines are skipped;
 *  the value may contain the separator (split at the first occurrence). Lines
 *  without a separator or with an empty key are collected as `invalid`. */
export function parseKeyValueLines(
	text: string,
	sep: '=' | ':'
): { map: Record<string, string>; invalid: string[] } {
	const map: Record<string, string> = {};
	const invalid: string[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const i = line.indexOf(sep);
		const key = i < 0 ? '' : line.slice(0, i).trim();
		if (i < 0 || !key) {
			invalid.push(line);
			continue;
		}
		map[key] = line.slice(i + 1).trim();
	}
	return { map, invalid };
}

export function formatKeyValueLines(map: Record<string, string>, sep: '=' | ':'): string {
	const glue = sep === ':' ? ': ' : '=';
	return Object.entries(map)
		.map(([k, v]) => `${k}${glue}${v}`)
		.join('\n');
}

export type McpFormErrors = Partial<
	Record<'name' | 'command' | 'url' | 'env' | 'headers' | 'timeout', string>
>;

/** Client-side validation mirroring the engine's `parse_mcp_server_value`.
 *  Returns i18n sub-keys under `settings.mcp.err.*` keyed by field; an empty
 *  object means the form is valid. */
export function validateMcpForm(v: McpFormValues): McpFormErrors {
	const errors: McpFormErrors = {};
	const name = v.name.trim();
	if (!name) errors.name = 'nameRequired';
	else if (!MCP_NAME_RE.test(name)) errors.name = 'nameInvalid';
	if (v.transport === 'stdio') {
		if (!v.command.trim()) errors.command = 'commandRequired';
		if (parseKeyValueLines(v.envText, '=').invalid.length) errors.env = 'envInvalid';
	} else {
		const url = v.url.trim();
		if (!url) errors.url = 'urlRequired';
		else if (!/^https?:\/\/.+/i.test(url)) errors.url = 'urlInvalid';
		if (parseKeyValueLines(v.headersText, ':').invalid.length) errors.headers = 'headersInvalid';
	}
	const timeout = v.timeoutText.trim();
	if (timeout) {
		const n = Number(timeout);
		if (!Number.isInteger(n) || n < 1 || n > 3600) errors.timeout = 'timeoutInvalid';
	}
	return errors;
}

/** Convert validated form values into the `mcp_set` server payload. The bearer
 *  convenience field wins over an explicit Authorization header line. */
export function formToEntry(v: McpFormValues): McpServerEntry {
	const entry: McpServerEntry = {
		name: v.name.trim(),
		transport: v.transport,
		enabled: v.enabled
	};
	if (v.transport === 'stdio') {
		entry.command = v.command.trim();
		const args = splitArgs(v.argsText);
		if (args.length) entry.args = args;
		const env = parseKeyValueLines(v.envText, '=').map;
		if (Object.keys(env).length) entry.env = env;
	} else {
		entry.url = v.url.trim();
		const headers = parseKeyValueLines(v.headersText, ':').map;
		if (v.bearerToken.trim()) headers['Authorization'] = `Bearer ${v.bearerToken.trim()}`;
		if (Object.keys(headers).length) entry.headers = headers;
	}
	const timeout = v.timeoutText.trim();
	if (timeout) entry.timeout_seconds = Number(timeout);
	return entry;
}

/** Populate the edit form from a config entry. A `Bearer …` Authorization
 *  header is extracted into the convenience field. */
export function entryToForm(entry: McpServerEntry): McpFormValues {
	const form = emptyMcpForm();
	form.name = entry.name;
	form.transport = entry.transport;
	form.command = entry.command ?? '';
	form.argsText = (entry.args ?? []).join('\n');
	form.envText = formatKeyValueLines(entry.env ?? {}, '=');
	form.url = entry.url ?? '';
	const headers = { ...(entry.headers ?? {}) };
	const auth = headers['Authorization'];
	const bearer = typeof auth === 'string' ? auth.match(/^Bearer\s+(.+)$/) : null;
	if (bearer) {
		form.bearerToken = bearer[1];
		delete headers['Authorization'];
	}
	form.headersText = formatKeyValueLines(headers, ':');
	form.bearerToken ||= '';
	form.timeoutText =
		entry.timeout_seconds != null && entry.timeout_seconds !== MCP_DEFAULT_TIMEOUT
			? String(entry.timeout_seconds)
			: '';
	form.enabled = entry.enabled;
	return form;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const asTransport = (v: unknown): McpTransport => (v === 'http' ? 'http' : 'stdio');

/** Sanitize the `servers` array of an `mcp_servers` engine event. */
export function parseMcpServersEvent(ev: Record<string, unknown>): McpServerView[] {
	if (!Array.isArray(ev.servers)) return [];
	const out: McpServerView[] = [];
	for (const raw of ev.servers) {
		if (!raw || typeof raw !== 'object') continue;
		const s = raw as Record<string, unknown>;
		const name = str(s.name);
		if (!name) continue;
		const state = str(s.state);
		const view: McpServerView = {
			name,
			transport: asTransport(s.transport),
			state:
				state === 'connected' || state === 'failed' || state === 'disabled'
					? state
					: 'connecting',
			tools: (Array.isArray(s.tools) ? s.tools : [])
				.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
				.map((t) => ({ name: str(t.name), description: str(t.description) }))
				.filter((t) => t.name)
		};
		if (typeof s.error === 'string' && s.error) view.error = s.error;
		out.push(view);
	}
	return out;
}

const strMap = (v: unknown): Record<string, string> => {
	const out: Record<string, string> = {};
	if (v && typeof v === 'object' && !Array.isArray(v)) {
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			if (typeof val === 'string') out[k] = val;
		}
	}
	return out;
};

/** Lenient parse of `mcp_servers` from a raw config.json object (read-only /
 *  no-session fallback and edit-form source). Entries without a name are skipped. */
export function parseConfigServers(cfg: Record<string, unknown>): McpServerEntry[] {
	if (!Array.isArray(cfg.mcp_servers)) return [];
	const out: McpServerEntry[] = [];
	for (const raw of cfg.mcp_servers) {
		if (!raw || typeof raw !== 'object') continue;
		const s = raw as Record<string, unknown>;
		const name = str(s.name).trim();
		if (!name || out.some((e) => e.name === name)) continue;
		const entry: McpServerEntry = {
			name,
			transport: asTransport(s.transport),
			enabled: s.enabled !== false
		};
		if (str(s.command)) entry.command = str(s.command);
		if (Array.isArray(s.args)) entry.args = s.args.filter((a): a is string => typeof a === 'string');
		const env = strMap(s.env);
		if (Object.keys(env).length) entry.env = env;
		if (str(s.url)) entry.url = str(s.url);
		const headers = strMap(s.headers);
		if (Object.keys(headers).length) entry.headers = headers;
		if (typeof s.timeout_seconds === 'number') entry.timeout_seconds = s.timeout_seconds;
		out.push(entry);
	}
	return out;
}

/** Read-only parse of the proprietary `extensions` config list. */
export function parseConfigExtensions(cfg: Record<string, unknown>): ExtensionInfo[] {
	if (!Array.isArray(cfg.extensions)) return [];
	const out: ExtensionInfo[] = [];
	for (const raw of cfg.extensions) {
		if (!raw || typeof raw !== 'object') continue;
		const e = raw as Record<string, unknown>;
		const name = str(e.name).trim();
		const command = str(e.command).trim();
		if (!name || !command) continue;
		out.push({ name, command, lazy: e.lazy === true });
	}
	return out;
}

/** One row of the servers list: live view (when an engine reported) merged with
 *  the persisted config entry (edit-form source / no-session fallback). */
export interface McpRow {
	name: string;
	transport: McpTransport;
	entry?: McpServerEntry;
	view?: McpServerView;
	enabled: boolean;
}

/** Merge the persisted config list with the live engine view. Live servers come
 *  first in engine order; config-only entries (no session yet, or an engine
 *  that predates them) follow in config order. `enabled` prefers the config
 *  truth and falls back to the live state. */
export function mergeServers(
	entries: McpServerEntry[] | null,
	views: McpServerView[] | null
): McpRow[] {
	const rows: McpRow[] = [];
	const byName = new Map((entries ?? []).map((e) => [e.name, e]));
	for (const view of views ?? []) {
		const entry = byName.get(view.name);
		byName.delete(view.name);
		rows.push({
			name: view.name,
			transport: view.transport,
			entry,
			view,
			enabled: entry ? entry.enabled : view.state !== 'disabled'
		});
	}
	for (const entry of entries ?? []) {
		if (!byName.has(entry.name)) continue;
		rows.push({ name: entry.name, transport: entry.transport, entry, enabled: entry.enabled });
	}
	return rows;
}
