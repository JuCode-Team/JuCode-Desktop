import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdaterState } from './updater.svelte';

const { check, relaunch } = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));

vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));

describe('UpdaterState', () => {
	beforeEach(() => {
		check.mockReset();
		relaunch.mockReset();
	});

	const update = () => ({
		version: '0.3.2',
		downloadAndInstall: vi.fn().mockResolvedValue(undefined)
	});

	it('automatically downloads and installs a silent startup update', async () => {
		const u = update();
		check.mockResolvedValue(u);
		const state = new UpdaterState();

		await state.check(true, true);

		expect(u.downloadAndInstall).toHaveBeenCalledOnce();
		expect(state.phase).toBe('ready');
		expect(state.version).toBe('0.3.2');
	});

	it('keeps manual checks download-free until the user starts the download', async () => {
		const u = update();
		check.mockResolvedValue(u);
		const state = new UpdaterState();

		await state.check();

		expect(u.downloadAndInstall).not.toHaveBeenCalled();
		expect(state.phase).toBe('available');
	});

	it('does not start a second check while an update is downloading', async () => {
		const u = update();
		let resolveDownload!: () => void;
		u.downloadAndInstall.mockReturnValue(new Promise<void>((resolve) => (resolveDownload = resolve)));
		check.mockResolvedValue(u);
		const state = new UpdaterState();

		const first = state.check(true, true);
		await vi.waitFor(() => expect(state.phase).toBe('downloading'));
		await state.check(true, true);
		expect(check).toHaveBeenCalledOnce();
		resolveDownload();
		await first;
	});

	it('surfaces an automatic install failure without pretending it is ready', async () => {
		const u = update();
		u.downloadAndInstall.mockRejectedValue(new Error('signature mismatch'));
		check.mockResolvedValue(u);
		const state = new UpdaterState();

		await state.check(true, true);

		expect(state.phase).toBe('error');
		expect(state.error).toContain('signature mismatch');
	});
});
