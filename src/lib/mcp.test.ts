import { describe, it, expect } from 'vitest';
import {
	emptyMcpForm,
	entryToForm,
	formToEntry,
	formatKeyValueLines,
	mergeServers,
	parseConfigExtensions,
	parseConfigServers,
	parseKeyValueLines,
	parseMcpServersEvent,
	splitArgs,
	validateMcpForm,
	type McpFormValues,
	type McpServerEntry,
	type McpServerView
} from './mcp';

const stdioForm = (over: Partial<McpFormValues> = {}): McpFormValues => ({
	...emptyMcpForm(),
	name: 'files',
	transport: 'stdio',
	command: 'mcp-server-files',
	...over
});
const httpForm = (over: Partial<McpFormValues> = {}): McpFormValues => ({
	...emptyMcpForm(),
	name: 'search',
	transport: 'http',
	url: 'https://example.com/mcp',
	...over
});

describe('splitArgs', () => {
	it('splits on newlines and spaces, dropping blanks', () => {
		expect(splitArgs('--root\n.\n  --verbose  ')).toEqual(['--root', '.', '--verbose']);
		expect(splitArgs('--root . --verbose')).toEqual(['--root', '.', '--verbose']);
		expect(splitArgs('  \n \n')).toEqual([]);
	});
});

describe('parseKeyValueLines', () => {
	it('parses env KEY=VALUE lines, splitting at the first separator', () => {
		const { map, invalid } = parseKeyValueLines('DEBUG=1\nPATH=/a=b\n\n', '=');
		expect(map).toEqual({ DEBUG: '1', PATH: '/a=b' });
		expect(invalid).toEqual([]);
	});
	it('parses header lines with ":" and trims key/value', () => {
		const { map } = parseKeyValueLines('X-Api-Key:  abc \nAccept: application/json', ':');
		expect(map).toEqual({ 'X-Api-Key': 'abc', Accept: 'application/json' });
	});
	it('collects separator-less and empty-key lines as invalid', () => {
		const { map, invalid } = parseKeyValueLines('GOOD=1\nnope\n=empty-key', '=');
		expect(map).toEqual({ GOOD: '1' });
		expect(invalid).toEqual(['nope', '=empty-key']);
	});
	it('round-trips through formatKeyValueLines', () => {
		const headers = { Authorization: 'Bearer x', Accept: 'text/html' };
		expect(parseKeyValueLines(formatKeyValueLines(headers, ':'), ':').map).toEqual(headers);
	});
});

describe('validateMcpForm', () => {
	it('accepts a minimal valid stdio form', () => {
		expect(validateMcpForm(stdioForm())).toEqual({});
	});
	it('accepts a minimal valid http form', () => {
		expect(validateMcpForm(httpForm())).toEqual({});
	});
	it('requires a name matching ^[A-Za-z0-9_-]+$', () => {
		expect(validateMcpForm(stdioForm({ name: '' })).name).toBe('nameRequired');
		expect(validateMcpForm(stdioForm({ name: 'has space' })).name).toBe('nameInvalid');
		expect(validateMcpForm(stdioForm({ name: '文件' })).name).toBe('nameInvalid');
		expect(validateMcpForm(stdioForm({ name: 'a_B-9' })).name).toBeUndefined();
	});
	it('requires command for stdio and url for http', () => {
		expect(validateMcpForm(stdioForm({ command: '  ' })).command).toBe('commandRequired');
		expect(validateMcpForm(httpForm({ url: '' })).url).toBe('urlRequired');
	});
	it('requires an http(s) url', () => {
		expect(validateMcpForm(httpForm({ url: 'ftp://x' })).url).toBe('urlInvalid');
		expect(validateMcpForm(httpForm({ url: 'example.com' })).url).toBe('urlInvalid');
		expect(validateMcpForm(httpForm({ url: 'http://localhost:8080/mcp' })).url).toBeUndefined();
	});
	it('validates env / header line shapes per transport', () => {
		expect(validateMcpForm(stdioForm({ envText: 'BAD' })).env).toBe('envInvalid');
		expect(validateMcpForm(httpForm({ headersText: 'no-colon' })).headers).toBe('headersInvalid');
		// env is a stdio field only — an http form ignores it (and vice versa).
		expect(validateMcpForm(httpForm({ envText: 'BAD' })).env).toBeUndefined();
		expect(validateMcpForm(stdioForm({ headersText: 'no-colon' })).headers).toBeUndefined();
	});
	it('validates timeout range 1–3600 (blank = default)', () => {
		expect(validateMcpForm(stdioForm({ timeoutText: '' }))).toEqual({});
		expect(validateMcpForm(stdioForm({ timeoutText: '60' }))).toEqual({});
		expect(validateMcpForm(stdioForm({ timeoutText: '0' })).timeout).toBe('timeoutInvalid');
		expect(validateMcpForm(stdioForm({ timeoutText: '3601' })).timeout).toBe('timeoutInvalid');
		expect(validateMcpForm(stdioForm({ timeoutText: '1.5' })).timeout).toBe('timeoutInvalid');
		expect(validateMcpForm(stdioForm({ timeoutText: 'abc' })).timeout).toBe('timeoutInvalid');
	});
});

describe('formToEntry', () => {
	it('builds a stdio entry with args/env and omits empty optionals', () => {
		const entry = formToEntry(stdioForm({ argsText: '--root\n.', envText: 'DEBUG=1' }));
		expect(entry).toEqual({
			name: 'files',
			transport: 'stdio',
			enabled: true,
			command: 'mcp-server-files',
			args: ['--root', '.'],
			env: { DEBUG: '1' }
		});
		expect(formToEntry(stdioForm())).toEqual({
			name: 'files',
			transport: 'stdio',
			enabled: true,
			command: 'mcp-server-files'
		});
	});
	it('builds an http entry; the bearer field sets the Authorization header', () => {
		const entry = formToEntry(httpForm({ bearerToken: 'tok-123', headersText: 'Accept: text/html' }));
		expect(entry.url).toBe('https://example.com/mcp');
		expect(entry.headers).toEqual({ Accept: 'text/html', Authorization: 'Bearer tok-123' });
	});
	it('bearer wins over an explicit Authorization header line', () => {
		const entry = formToEntry(httpForm({ bearerToken: 'new', headersText: 'Authorization: Bearer old' }));
		expect(entry.headers).toEqual({ Authorization: 'Bearer new' });
	});
	it('carries timeout and enabled through', () => {
		const entry = formToEntry(stdioForm({ timeoutText: ' 120 ', enabled: false }));
		expect(entry.timeout_seconds).toBe(120);
		expect(entry.enabled).toBe(false);
	});
});

describe('entryToForm', () => {
	it('round-trips a full http entry, extracting the bearer token', () => {
		const entry: McpServerEntry = {
			name: 'search',
			transport: 'http',
			url: 'https://example.com/mcp',
			headers: { Authorization: 'Bearer tok', Accept: 'text/html' },
			enabled: true,
			timeout_seconds: 120
		};
		const form = entryToForm(entry);
		expect(form.bearerToken).toBe('tok');
		expect(form.headersText).toBe('Accept: text/html');
		expect(form.timeoutText).toBe('120');
		expect(formToEntry(form)).toEqual(entry);
	});
	it('round-trips a stdio entry and leaves the default timeout blank', () => {
		const entry: McpServerEntry = {
			name: 'files',
			transport: 'stdio',
			command: 'srv',
			args: ['--root', '.'],
			env: { A: '1' },
			enabled: false,
			timeout_seconds: 60
		};
		const form = entryToForm(entry);
		expect(form.timeoutText).toBe('');
		expect(form.argsText).toBe('--root\n.');
		expect(formToEntry(form)).toEqual({ ...entry, timeout_seconds: undefined });
	});
	it('keeps a non-bearer Authorization header in the headers text', () => {
		const form = entryToForm({
			name: 's',
			transport: 'http',
			url: 'https://x',
			headers: { Authorization: 'Basic abc' },
			enabled: true
		});
		expect(form.bearerToken).toBe('');
		expect(form.headersText).toBe('Authorization: Basic abc');
	});
});

describe('parseMcpServersEvent', () => {
	it('sanitizes a well-formed event', () => {
		const servers = parseMcpServersEvent({
			servers: [
				{
					name: 'files',
					transport: 'stdio',
					state: 'connected',
					tools: [{ name: 'read_file', description: 'Read a file' }]
				},
				{ name: 'search', transport: 'http', state: 'failed', error: 'boom', tools: [] }
			]
		});
		expect(servers).toHaveLength(2);
		expect(servers[0]).toEqual({
			name: 'files',
			transport: 'stdio',
			state: 'connected',
			tools: [{ name: 'read_file', description: 'Read a file' }]
		});
		expect(servers[1].error).toBe('boom');
	});
	it('drops malformed entries and defaults unknown states to connecting', () => {
		const servers = parseMcpServersEvent({
			servers: [null, 42, { transport: 'stdio' }, { name: 'x', state: 'weird', tools: 'no' }]
		});
		expect(servers).toEqual([{ name: 'x', transport: 'stdio', state: 'connecting', tools: [] }]);
	});
	it('returns [] for a missing servers array', () => {
		expect(parseMcpServersEvent({})).toEqual([]);
	});
});

describe('parseConfigServers / parseConfigExtensions', () => {
	it('reads mcp_servers leniently, skipping nameless and duplicate entries', () => {
		const entries = parseConfigServers({
			mcp_servers: [
				{ name: 'files', command: 'srv', args: ['--x'], env: { A: '1' }, timeout_seconds: 30 },
				{ name: 'files', command: 'dup' },
				{ command: 'nameless' },
				{ name: 'web', transport: 'http', url: 'https://x', enabled: false }
			]
		});
		expect(entries.map((e) => e.name)).toEqual(['files', 'web']);
		expect(entries[0]).toMatchObject({ transport: 'stdio', enabled: true, timeout_seconds: 30 });
		expect(entries[1]).toMatchObject({ transport: 'http', url: 'https://x', enabled: false });
	});
	it('reads extensions requiring name and command', () => {
		const exts = parseConfigExtensions({
			extensions: [{ name: 'jira', command: 'jira-ext', lazy: true }, { name: 'broken' }, 'junk']
		});
		expect(exts).toEqual([{ name: 'jira', command: 'jira-ext', lazy: true }]);
	});
	it('handles configs without the arrays', () => {
		expect(parseConfigServers({})).toEqual([]);
		expect(parseConfigExtensions({})).toEqual([]);
	});
});

describe('mergeServers', () => {
	const entry = (name: string, enabled = true): McpServerEntry => ({
		name,
		transport: 'stdio',
		command: 'srv',
		enabled
	});
	const view = (name: string, state: McpServerView['state']): McpServerView => ({
		name,
		transport: 'stdio',
		state,
		tools: []
	});

	it('pairs live views with config entries, live order first', () => {
		const rows = mergeServers([entry('a'), entry('b')], [view('b', 'connected'), view('a', 'failed')]);
		expect(rows.map((r) => r.name)).toEqual(['b', 'a']);
		expect(rows[0].entry?.name).toBe('b');
		expect(rows[0].view?.state).toBe('connected');
	});
	it('appends config-only entries (no session) after live rows', () => {
		const rows = mergeServers([entry('a'), entry('c')], [view('a', 'connected')]);
		expect(rows.map((r) => r.name)).toEqual(['a', 'c']);
		expect(rows[1].view).toBeUndefined();
	});
	it('keeps engine-only servers even without a config entry', () => {
		const rows = mergeServers(null, [view('ghost', 'connecting')]);
		expect(rows).toHaveLength(1);
		expect(rows[0].entry).toBeUndefined();
		expect(rows[0].enabled).toBe(true);
	});
	it('derives enabled from the config entry, falling back to the live state', () => {
		expect(mergeServers([entry('a', false)], [view('a', 'connected')])[0].enabled).toBe(false);
		expect(mergeServers(null, [view('a', 'disabled')])[0].enabled).toBe(false);
	});
});
