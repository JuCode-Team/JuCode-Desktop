import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '$lib/daemon';

// The app's shared daemon (Tauri) is never used here.
vi.mock('$lib/protocol', () => ({ daemon: {} }));

import { HostConnection, connectionState } from './connection.svelte';

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: Record<string, unknown>[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.onclose?.();
	}
	push(frame: Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function computer(id: string) {
	const sockets: FakeSocket[] = [];
	const conn = new HostConnection(
		id,
		'lan',
		async () => ({ url: `ws://${id}/`, token: 't' }),
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			queueMicrotask(() => {
				socket.readyState = 1;
				socket.push({ type: 'hello', protocol: 2, version: '0.3.0' });
			});
			return socket;
		}
	);
	return { conn, sockets };
}

const started: HostConnection[] = [];
afterEach(() => {
	for (const conn of started.splice(0)) conn.stop();
});

describe('connectionState', () => {
	it('is ok once the daemon is reached, whatever failed before', () => {
		expect(connectionState('relay', 'on', 'offline').tone).toBe('ok');
		expect(connectionState('lan', 'on', undefined).tone).toBe('ok');
	});

	it('waits while connecting and says why a relay connection is down', () => {
		expect(connectionState('relay', 'connecting', undefined)).toMatchObject({ tone: 'wait', text: 'shell.remote.relayConnecting' });
		expect(connectionState('relay', 'unreachable', 'offline')).toMatchObject({ tone: 'off', short: 'shell.remote.hostOffline' });
		expect(connectionState('relay', 'connecting', 'busy')).toMatchObject({ tone: 'off', text: 'shell.remote.relayBusy' });
		expect(connectionState('relay', 'off', 'revoked')).toMatchObject({ tone: 'off', text: 'shell.remote.relayFatalTitle' });
		expect(connectionState('relay', 'unreachable', 'network').text).toBe('shell.remote.relayNetwork');
	});

	it('treats the LAN daemon as connecting until it is unreachable', () => {
		expect(connectionState('lan', 'connecting', undefined).tone).toBe('wait');
		expect(connectionState('lan', 'unreachable', undefined)).toMatchObject({ tone: 'off', text: 'shell.remote.disconnected' });
	});
});

describe('HostConnection', () => {
	it('keeps each computer’s lists to itself', async () => {
		const a = computer('a');
		const b = computer('b');
		started.push(a.conn, b.conn);
		a.conn.start();
		b.conn.start();
		await tick();
		expect(a.conn.agents.status).toBe('on');
		expect(b.conn.agents.status).toBe('on');

		a.sockets[0].push({ type: 'sessions', sessions: [{ session: 's-a', cwd: '/a', created_at: 1, open: true }] });
		b.sockets[0].push({ type: 'workspaces', rev: 1, workspaces: [{ id: 'w', name: 'B', projects: [] }] });
		expect(a.conn.agents.sessions.map((s) => s.session)).toEqual(['s-a']);
		expect(b.conn.agents.sessions).toEqual([]);
		expect(b.conn.projects.workspaces.map((w) => w.name)).toEqual(['B']);
		expect(a.conn.projects.workspaces).toEqual([]);
	});

	it('routes a session’s frames to the page that opened it on that computer', async () => {
		const a = computer('a');
		const b = computer('b');
		started.push(a.conn, b.conn);
		a.conn.start();
		b.conn.start();
		await tick();
		const onA = vi.fn();
		const onB = vi.fn();
		a.conn.register('page', onA, () => {});
		b.conn.register('page', onB, () => {});

		const opened = a.conn.daemon.open('page', '/a', 's1');
		await tick();
		const request = a.sockets[0].sent.find((op) => op.op === 'session_open')!;
		a.sockets[0].push({ type: 'session_opened', session: 's1', id: request.id });
		await opened;
		a.sockets[0].push({ type: 'text_delta', session: 's1', text: 'hi' });
		b.sockets[0].push({ type: 'text_delta', session: 's1', text: 'other' });
		expect(onA).toHaveBeenCalledTimes(1);
		expect(onB).not.toHaveBeenCalled();
	});

	it('disconnects for good when stopped', async () => {
		const a = computer('a');
		a.conn.start();
		await tick();
		a.conn.stop();
		expect(a.sockets[0].readyState).toBe(3);
		expect(a.conn.agents.status).toBe('off');
		await expect(a.conn.daemon.connect()).rejects.toThrow('connection stopped');
		expect(a.sockets).toHaveLength(1);
	});
});
