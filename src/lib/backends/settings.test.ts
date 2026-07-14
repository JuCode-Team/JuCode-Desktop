import { describe, it, expect } from 'vitest';
import {
	parseBackendSettings,
	defaultBackendFor,
	buildBackendOpts,
	versionLabel,
	parseEnvLines,
	formatEnvLines,
	DEFAULT_BACKEND_SETTINGS,
	type BackendSettings
} from './settings';

describe('backend settings parsing', () => {
	it('handles missing / garbage storage safely', () => {
		expect(parseBackendSettings(null)).toEqual(DEFAULT_BACKEND_SETTINGS);
		expect(parseBackendSettings('not json {')).toEqual(DEFAULT_BACKEND_SETTINGS);
		expect(parseBackendSettings('42')).toEqual(DEFAULT_BACKEND_SETTINGS);
	});

	it('drops unknown backend ids and blank paths, normalizes the default', () => {
		const parsed = parseBackendSettings(
			JSON.stringify({
				default: 'gpt', // unknown → jucode
				paths: { claude: '  /opt/claude  ', gpt: '/nope', codex: '   ' }
			})
		);
		expect(parsed.default).toBe('jucode');
		expect(parsed.paths).toEqual({ claude: '/opt/claude' });
	});

	it('round-trips a valid settings object', () => {
		const parsed = parseBackendSettings(
			JSON.stringify({ default: 'claude', paths: { codex: '/usr/local/bin/codex' } })
		);
		expect(parsed).toEqual({
			default: 'claude',
			paths: { codex: '/usr/local/bin/codex' },
			useShellEnv: true,
			env: {}
		});
	});
});

describe('default backend for new sessions', () => {
	const settings: BackendSettings = { default: 'codex', paths: {}, useShellEnv: true, env: {} };

	it("the project's last-used backend wins", () => {
		expect(defaultBackendFor('claude', settings)).toBe('claude');
		expect(defaultBackendFor('jucode', settings)).toBe('jucode');
	});

	it('falls back to the settings default, then jucode', () => {
		expect(defaultBackendFor(undefined, settings)).toBe('codex');
		expect(defaultBackendFor(null, settings)).toBe('codex');
		expect(defaultBackendFor('bogus', settings)).toBe('codex');
		expect(
			defaultBackendFor(undefined, { default: 'jucode', paths: {}, useShellEnv: true, env: {} })
		).toBe('jucode');
	});
});

const base = (over: Partial<BackendSettings> = {}): BackendSettings => ({
	default: 'jucode',
	paths: {},
	useShellEnv: true,
	env: {},
	...over
});

describe('spawn options from settings', () => {
	it('returns undefined when nothing is configured (keeps the historical jucode call)', () => {
		expect(buildBackendOpts('jucode', base())).toBeUndefined();
		expect(buildBackendOpts('claude', base({ paths: { codex: '/x' } }))).toBeUndefined();
	});

	it('passes the configured path as bin_override', () => {
		const s = base({ paths: { claude: '/opt/claude', jucode: '/dev/jucode' } });
		expect(buildBackendOpts('claude', s)).toEqual({ bin_override: '/opt/claude' });
		expect(buildBackendOpts('jucode', s)).toEqual({ bin_override: '/dev/jucode' });
	});

	it('sends use_shell_env only when the toggle is off (on is the engine default)', () => {
		expect(buildBackendOpts('jucode', base({ useShellEnv: false }))).toEqual({
			use_shell_env: false
		});
		expect(buildBackendOpts('jucode', base({ useShellEnv: true }))).toBeUndefined();
	});

	it('includes per-backend custom env only for the matching backend', () => {
		const s = base({ env: { claude: { NODE_EXTRA_CA_CERTS: '/x/ca.pem' } } });
		expect(buildBackendOpts('claude', s)).toEqual({
			env: { NODE_EXTRA_CA_CERTS: '/x/ca.pem' }
		});
		expect(buildBackendOpts('codex', s)).toBeUndefined();
	});
});

describe('env line parsing', () => {
	it('parses KEY=VALUE lines, keeping = inside values and skipping comments/blanks', () => {
		const { env, invalid } = parseEnvLines('A=1\n\n# note\nURL=https://x?a=b=c\n');
		expect(env).toEqual({ A: '1', URL: 'https://x?a=b=c' });
		expect(invalid).toEqual([]);
	});

	it('flags invalid names (bad chars, dangerous prefixes, missing =)', () => {
		const { env, invalid } = parseEnvLines('1BAD=x\nDYLD_INSERT_LIBRARIES=/e\nLD_PRELOAD=/e\nnoequals\nOK=1');
		expect(env).toEqual({ OK: '1' });
		expect(invalid).toHaveLength(4);
	});

	it('round-trips through formatEnvLines', () => {
		const env = { A: '1', B: 'two words' };
		expect(parseEnvLines(formatEnvLines(env)).env).toEqual(env);
		expect(formatEnvLines(undefined)).toBe('');
	});
});

describe('persisted settings with env fields', () => {
	it('parses useShellEnv=false and per-backend env maps, dropping invalid names', () => {
		const s = parseBackendSettings(
			JSON.stringify({
				default: 'claude',
				useShellEnv: false,
				env: { claude: { GOOD: '1', 'BAD NAME': 'x', DYLD_X: 'x' }, nope: { A: '1' } }
			})
		);
		expect(s.useShellEnv).toBe(false);
		expect(s.env).toEqual({ claude: { GOOD: '1' } });
	});

	it('defaults useShellEnv to true for legacy payloads', () => {
		expect(parseBackendSettings(JSON.stringify({ default: 'jucode', paths: {} })).useShellEnv).toBe(true);
		expect(parseBackendSettings(null).useShellEnv).toBe(true);
	});
});

describe('availability status parsing', () => {
	it('versionLabel keeps the first line, trimmed', () => {
		expect(versionLabel({ found: true, version: '2.0.14 (Claude Code)' })).toBe('2.0.14 (Claude Code)');
		expect(versionLabel({ found: true, version: 'codex-cli 0.42.0\nextra noise' })).toBe('codex-cli 0.42.0');
		expect(versionLabel({ found: true, version: '  jucode 1.3.0  ' })).toBe('jucode 1.3.0');
		expect(versionLabel({ found: false })).toBe('');
		expect(versionLabel({ found: true, version: null })).toBe('');
	});
});
