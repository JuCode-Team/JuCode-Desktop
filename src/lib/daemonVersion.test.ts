import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, request } = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./protocol', () => ({ daemon: { request } }));

import { checkDaemonVersion } from './daemonVersion';

/** The app ships `bundled`; replace_daemon succeeds unless told otherwise. */
function app(bundled: string | null, replace: () => Promise<void> = () => Promise.resolve()) {
	invoke.mockImplementation((cmd: string) =>
		cmd === 'app_cli_version' ? Promise.resolve(bundled) : cmd === 'replace_daemon' ? replace() : Promise.reject()
	);
}

describe('checkDaemonVersion', () => {
	beforeEach(() => {
		invoke.mockReset();
		request.mockReset();
	});

	it('leaves a daemon of the bundled version, and development builds, alone', async () => {
		app('0.4.0');
		expect(await checkDaemonVersion('0.4.0')).toEqual({ kind: 'current' });
		app(null);
		expect(await checkDaemonVersion('0.3.9')).toEqual({ kind: 'current' });
		expect(request).not.toHaveBeenCalled();
	});

	it('asks an older daemon to restart once idle, once per run', async () => {
		app('0.4.1');
		request.mockResolvedValue({});
		expect(await checkDaemonVersion('0.4.0')).toEqual({ kind: 'restart-when-idle', version: '0.4.1' });
		expect(request).toHaveBeenCalledWith({ op: 'restart_when_idle' });
		expect(await checkDaemonVersion('0.4.0')).toEqual({ kind: 'current' });
		expect(request).toHaveBeenCalledOnce();
	});

	it('replaces a daemon too old to restart itself', async () => {
		app('0.4.1');
		request.mockRejectedValue(new Error('unknown op'));
		expect(await checkDaemonVersion('0.3.0')).toEqual({ kind: 'replaced', version: '0.4.1' });
		app('0.4.1', () => Promise.reject('login service'));
		expect(await checkDaemonVersion('0.2.0')).toEqual({ kind: 'failed', version: '0.4.1', error: 'login service' });
	});
});
