import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '$lib/daemon';
import { generateKeyPair, toBase64Url } from '$lib/relay/noise';
import { respond } from '$lib/relay/responder.testing';
import { loadPaired, markPaired } from '$lib/relay/pairing';

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
		expect(connectionState('on', 'offline').tone).toBe('ok');
		expect(connectionState('on', undefined, true).tone).toBe('ok');
	});

	it('waits while connecting and says why a relay connection is down', () => {
		expect(connectionState('connecting', undefined)).toMatchObject({ tone: 'wait', text: 'shell.remote.relayConnecting' });
		expect(connectionState('unreachable', 'restarting')).toMatchObject({ tone: 'wait', text: 'shell.remote.relayConnecting' });
		expect(connectionState('unreachable', 'offline')).toMatchObject({ tone: 'off', short: 'shell.remote.hostOffline' });
		expect(connectionState('connecting', 'busy')).toMatchObject({ tone: 'off', text: 'shell.remote.relayBusy' });
		expect(connectionState('unreachable', 'network').text).toBe('shell.remote.relayNetwork');
	});

	it('asks the user to allow on the computer while a request waits', () => {
		expect(connectionState('connecting', undefined, true)).toMatchObject({ tone: 'wait', text: 'shell.remote.requestWaiting' });
	});

	it('says why the computer refused', () => {
		expect(connectionState('off', 'no-desktop').text).toBe('shell.remote.noDesktop');
		expect(connectionState('off', 'denied').text).toBe('shell.remote.denied');
		expect(connectionState('off', 'expired').text).toBe('shell.remote.expired');
		expect(connectionState('off', 'requests-busy').text).toBe('shell.remote.requestsBusy');
		expect(connectionState('off', 'not-yours').text).toBe('shell.remote.notYours');
		expect(connectionState('off', 'revoked')).toMatchObject({ tone: 'off', text: 'shell.remote.relayRevoked' });
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
		expect(a.conn.daemonState.status).toBe('on');
		expect(b.conn.daemonState.status).toBe('on');

		a.sockets[0].push({ type: 'sessions', sessions: [{ session: 's-a', cwd: '/a', created_at: 1, open: true }] });
		b.sockets[0].push({ type: 'workspaces', rev: 1, workspaces: [{ id: 'w', name: 'B', projects: [] }] });
		expect(a.conn.daemonState.sessions.map((s) => s.session)).toEqual(['s-a']);
		expect(b.conn.daemonState.sessions).toEqual([]);
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

	it('drops a connection that does not answer when the page wakes, then reconnects', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
		try {
			const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
			const a = computer('a');
			started.push(a.conn);
			a.conn.start();
			await flush();
			expect(a.conn.daemonState.status).toBe('on');

			const woke = a.conn.wake();
			await flush();
			expect(a.sockets[0].sent.some((op) => op.op === 'ping')).toBe(true);
			await flush(5000);
			await woke;
			expect(a.sockets[0].readyState).toBe(3);
			expect(a.conn.daemonState.status).toBe('unreachable');

			await flush(2000);
			expect(a.sockets).toHaveLength(2);
			expect(a.conn.daemonState.status).toBe('on');
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a connection that answers when the page wakes', async () => {
		const a = computer('a');
		started.push(a.conn);
		a.conn.start();
		await tick();
		const woke = a.conn.wake();
		await tick();
		const ping = a.sockets[0].sent.find((op) => op.op === 'ping')!;
		a.sockets[0].push({ type: 'pong', id: ping.id });
		await woke;
		expect(a.sockets[0].readyState).toBe(1);
		expect(a.conn.daemonState.status).toBe('on');
	});

	it('asks for the built-in ACP agents once per connection', async () => {
		const a = computer('a');
		started.push(a.conn);
		a.conn.start();
		await tick();
		const asks = () => a.sockets.flatMap((s) => s.sent).filter((op) => op.op === 'acp_presets');
		const first = a.conn.acpPresets();
		const again = a.conn.acpPresets();
		expect(asks()).toHaveLength(1);
		a.sockets[0].push({ type: 'acp_presets', id: asks()[0].id, presets: [{ id: 'pi', name: 'Pi', status: 'ready', approvals: false }] });
		expect((await first).map((p) => p.id)).toEqual(['pi']);
		expect(await again).toBe(await first);
		// A new connection may find other agents installed.
		a.sockets[0].close();
		await vi.waitFor(() => expect(a.conn.daemonState.status).toBe('on'), { timeout: 3000 });
		void a.conn.acpPresets().catch(() => {});
		expect(asks()).toHaveLength(2);
	});

	it('disconnects for good when stopped', async () => {
		const a = computer('a');
		a.conn.start();
		await tick();
		a.conn.stop();
		expect(a.sockets[0].readyState).toBe(3);
		expect(a.conn.daemonState.status).toBe('off');
		await expect(a.conn.daemon.connect()).rejects.toThrow('connection stopped');
		expect(a.sockets).toHaveLength(1);
	});
});

describe('HostConnection.relay', () => {
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const store = new Map<string, string>();

	/** A browser WebSocket; the test plays relay + daemon. */
	class FakeWs {
		static all: FakeWs[] = [];
		binaryType = 'blob';
		sent: Uint8Array[] = [];
		onopen: (() => void) | null = null;
		onmessage: ((event: { data: unknown }) => void) | null = null;
		onerror: (() => void) | null = null;
		onclose: ((event: { code: number; reason: string }) => void) | null = null;
		constructor(
			readonly url: string,
			readonly protocols: string[]
		) {
			FakeWs.all.push(this);
		}
		send(data: Uint8Array) {
			this.sent.push(new Uint8Array(data));
		}
		close() {}
	}

	beforeEach(() => {
		store.clear();
		FakeWs.all = [];
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v),
			removeItem: (k: string) => store.delete(k)
		});
		vi.stubGlobal('WebSocket', FakeWs);
	});
	afterEach(() => vi.unstubAllGlobals());

	const HOST = 'H'.repeat(22);
	const host = generateKeyPair();

	/** Opens the relay socket the connection made and answers its hello
	 *  with `reply` as the daemon; returns what the device said. */
	async function answer(reply: object): Promise<Record<string, unknown>> {
		await vi.waitFor(() => expect(FakeWs.all).toHaveLength(1));
		const ws = FakeWs.all[0];
		ws.onopen?.();
		let hello: Record<string, unknown> = {};
		const r = respond(host, ws.sent[0], (payload) => {
			hello = JSON.parse(dec.decode(payload));
			return enc.encode(JSON.stringify(reply));
		});
		ws.onmessage?.({ data: r.msg2.slice().buffer });
		return hello;
	}

	function open(admit: { pair?: string; request?: boolean }) {
		const conn = HostConnection.relay({ host_id: HOST, static_pub: toBase64Url(host.pub) }, async () => 'tok', 'Chrome', admit);
		started.push(conn);
		conn.start();
		return conn;
	}

	it('asks the computer, waits for its answer and marks it paired once allowed', async () => {
		const conn = open({ request: true });
		const hello = await answer({ ok: true });
		expect(FakeWs.all[0].url).toBe(`wss://api.jucode.net/v1/relay/connect?host=${HOST}`);
		expect(FakeWs.all[0].protocols).toEqual(['jucode-relay', 'jucode-bearer.tok']);
		expect(hello).toEqual({ name: 'Chrome', request: true });
		expect(conn.everConnected).toBe(true);
		expect(conn.waiting).toBe(false);
		expect(loadPaired()).toEqual([HOST]);
	});

	it('stops on a refusal and says why', async () => {
		const conn = open({ request: true });
		await answer({ ok: false, error: 'no_desktop' });
		expect(conn.relayError?.kind).toBe('no-desktop');
		expect(conn.daemonState.status).toBe('off');
		expect(conn.state.text).toBe('shell.remote.noDesktop');
		expect(loadPaired()).toEqual([]);
	});

	it('forgets the paired mark when the computer no longer knows the device', async () => {
		markPaired(HOST);
		const conn = open({});
		const hello = await answer({ ok: false, error: 'not paired' });
		expect(hello).toEqual({ name: 'Chrome' });
		expect(conn.relayError?.kind).toBe('revoked');
		expect(loadPaired()).toEqual([]);
	});
});
