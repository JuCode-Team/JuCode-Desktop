import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdaterState } from './updater.svelte';

const { invoke, relaunch } = vi.hoisted(() => ({ invoke: vi.fn(), relaunch: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
	invoke,
	Channel: class {
		onmessage: (message: unknown) => void = () => {};
	}
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.4.0') }));

/** `update_check` finds 0.3.2 on `source`; `install` answers `update_install`. */
function commands(install: () => Promise<void> = () => Promise.resolve(), source = 'github') {
	invoke.mockImplementation((cmd: string) => {
		if (cmd === 'update_check') return Promise.resolve({ version: '0.3.2', notes: null, source });
		if (cmd === 'update_install') return install();
		return Promise.reject(new Error(`unexpected ${cmd}`));
	});
}
const calls = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd).length;

describe('UpdaterState', () => {
	beforeEach(() => {
		invoke.mockReset();
		relaunch.mockReset();
	});

	it('automatically downloads and installs a silent startup update', async () => {
		commands(undefined, 'jucode');
		const state = new UpdaterState();

		await state.check(true, true);

		expect(calls('update_install')).toBe(1);
		expect(state.phase).toBe('ready');
		expect(state.version).toBe('0.3.2');
		expect(state.source).toBe('jucode');
	});

	it('keeps manual checks download-free until the user starts the download', async () => {
		commands();
		const state = new UpdaterState();

		await state.check();

		expect(calls('update_install')).toBe(0);
		expect(state.phase).toBe('available');
	});

	it('does not start a second check while an update is downloading', async () => {
		let resolveDownload!: () => void;
		commands(() => new Promise<void>((resolve) => (resolveDownload = resolve)));
		const state = new UpdaterState();

		const first = state.check(true, true);
		await vi.waitFor(() => expect(state.phase).toBe('downloading'));
		await state.check(true, true);
		expect(calls('update_check')).toBe(1);
		resolveDownload();
		await first;
	});

	it('surfaces an automatic install failure without pretending it is ready', async () => {
		commands(() => Promise.reject(new Error('signature mismatch')));
		const state = new UpdaterState();

		await state.check(true, true);

		expect(state.phase).toBe('error');
		expect(state.error).toContain('signature mismatch');
	});
});

describe('a required version', () => {
	it('downloads the update even on a manual check, and is cleared once current', async () => {
		const { UpdaterState } = await import('./updater.svelte');
		let min = '0.5.0';
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'update_policy') return Promise.resolve(min);
			if (cmd === 'update_check') return Promise.resolve({ version: '0.5.0', notes: 'fixes', source: 'jucode' });
			if (cmd === 'update_install') return Promise.resolve();
			return Promise.reject(new Error(`unexpected ${cmd}`));
		});
		const state = new UpdaterState();
		await state.check();
		expect(state.required).toBe('0.5.0');
		expect(state.phase).toBe('ready');
		expect(state.notes).toBe('fixes');
		min = '';
		await state.check();
		expect(state.required).toBe('');
	});
});

describe('olderThan', () => {
	it('compares versions numerically, a pre-release before its release', async () => {
		const { olderThan } = await import('./updater.svelte');
		expect(olderThan('0.4.0', '0.4.10')).toBe(true);
		expect(olderThan('0.4.10', '0.4.2')).toBe(false);
		expect(olderThan('0.4.0', '0.4.0')).toBe(false);
		expect(olderThan('0.5.0-beta.1', '0.5.0')).toBe(true);
		expect(olderThan('v1.0.0', '0.9.9')).toBe(false);
		expect(olderThan('garbage', '0.4.0')).toBe(false);
	});
});
