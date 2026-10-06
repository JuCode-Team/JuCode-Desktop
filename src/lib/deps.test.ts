import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepReport, InstallDoneEvent } from './protocol';

const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	checkDependencies: vi.fn(),
	checkBackend: vi.fn(),
	runInstall: vi.fn(),
	runUpgrade: vi.fn(),
	openUrl: vi.fn(),
	handlers: {} as Record<string, (event: { payload: unknown }) => void>
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }));
vi.mock('$lib/protocol', () => mocks);
vi.mock('$lib/i18n', () => ({ t: (key: string) => key }));

const claude: DepReport = {
	id: 'claude', present: false, detail: '',
	plan: { kind: 'run', program: 'powershell', args: [] }
};
const finish = (event: InstallDoneEvent) => mocks.handlers['install-done']({ payload: event });

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.handlers = {};
	mocks.listen.mockImplementation(async (name, handler) => {
		mocks.handlers[name] = handler;
		return () => {};
	});
	mocks.runInstall.mockResolvedValue({ kind: 'running' });
	mocks.checkDependencies.mockResolvedValue([]);
	mocks.checkBackend.mockResolvedValue({ found: true, version: '2.1.0 (Claude Code)' });
});

describe('dependency installation feedback', () => {
	it('waits for both event listeners before starting the installer', async () => {
		const ready: (() => void)[] = [];
		mocks.listen.mockImplementation((name, handler) => new Promise((resolve) => {
			ready.push(() => {
				mocks.handlers[name] = handler;
				resolve(() => {});
			});
		}));
		const { installDep, deps } = await import('./deps.svelte');
		const pending = installDep(claude);
		await Promise.resolve();
		expect(mocks.runInstall).not.toHaveBeenCalled();
		ready.forEach((resolve) => resolve());
		await pending;
		finish({ id: 'claude', success: false, code: 1 });
		expect(deps.installing.claude).toBe(false);
		expect(deps.msgs.claude?.ok).toBe(false);
	});

	it('shows a listener registration failure instead of starting without feedback', async () => {
		mocks.listen.mockRejectedValue(new Error('cannot listen'));
		const { installDep, deps } = await import('./deps.svelte');
		await installDep(claude);
		expect(mocks.runInstall).not.toHaveBeenCalled();
		expect(deps.installing.claude).toBe(false);
		expect(deps.msgs.claude?.ok).toBe(false);
	});

	it.each([
		{ found: false },
		{ found: true, version: null }
	])('does not claim success when Claude Code cannot run: %j', async (status) => {
		mocks.checkBackend.mockResolvedValue(status);
		const { installDep, deps } = await import('./deps.svelte');
		await installDep(claude);
		finish({ id: 'claude', success: true, code: 0 });
		await vi.waitFor(() => expect(deps.msgs.claude?.ok).toBe(false));
		expect(deps.msgs.claude?.text).toBe('setup.deps.verifyFailed');
		expect(deps.installing.claude).toBe(false);
	});

	it('reports success only after checking Claude Code and refreshing dependencies', async () => {
		mocks.checkDependencies.mockResolvedValue([{ ...claude, present: true }]);
		const { installDep, deps } = await import('./deps.svelte');
		await installDep(claude);
		finish({ id: 'claude', success: true, code: 0 });
		await vi.waitFor(() => expect(mocks.checkBackend).toHaveBeenCalledWith('claude'));
		await vi.waitFor(() => expect(deps.msgs.claude?.ok).toBe(true));
		expect(mocks.checkDependencies).toHaveBeenCalled();
		expect(deps.installing.claude).toBe(false);
	});

	it('reports detection failure instead of claiming an installation succeeded', async () => {
		mocks.checkDependencies.mockRejectedValue(new Error('probe failed'));
		const { installDep, deps } = await import('./deps.svelte');
		await installDep(claude);
		finish({ id: 'claude', success: true, code: 0 });
		await vi.waitFor(() => expect(deps.msgs.claude?.ok).toBe(false));
		expect(deps.installing.claude).toBe(false);
	});

	it('rejects a successful installer exit if the dependency is still missing', async () => {
		const { installDep, deps } = await import('./deps.svelte');
		await installDep({ ...claude, id: 'node' });
		finish({ id: 'node', success: true, code: 0 });
		await vi.waitFor(() => expect(deps.msgs.node?.text).toBe('setup.deps.notDetectedAfterInstall'));
		expect(deps.msgs.node?.ok).toBe(false);
	});

	it('keeps upgrade feedback working for a settings-pinned binary outside the default paths', async () => {
		mocks.runUpgrade.mockResolvedValue({ kind: 'running' });
		const { upgradeDep, deps } = await import('./deps.svelte');
		await upgradeDep('claude', '/custom/claude');
		finish({ id: 'claude', success: true, code: 0 });
		await vi.waitFor(() => expect(deps.msgs.claude?.ok).toBe(true));
		expect(deps.msgs.claude?.text).toBe('setup.deps.upgradeOk');
		expect(deps.upgrading.claude).toBe(false);
	});
});
