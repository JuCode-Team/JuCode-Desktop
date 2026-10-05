import { describe, it, expect } from 'vitest';
import { DaemonClient, type SocketLike } from './daemon';

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: Record<string, unknown>[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(public url: string) {}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {
		this.readyState = 3;
		this.onclose?.();
	}
	/** The daemon says something. */
	push(frame: Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}
	/** Replies to the last request carrying an id. */
	reply(frame: Record<string, unknown>) {
		const request = [...this.sent].reverse().find((op) => typeof op.id === 'number');
		this.push({ ...frame, id: request?.id });
	}
}

function setup(protocol = 2) {
	const sockets: FakeSocket[] = [];
	const frames: [string, Record<string, unknown>][] = [];
	const exits: string[] = [];
	const client = new DaemonClient(
		async () => ({ url: 'ws://127.0.0.1:7788', token: 't k' }),
		(url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			// Greet once the client has attached its handlers.
			queueMicrotask(() => {
				socket.readyState = 1;
				socket.push({ type: 'hello', protocol, version: '0.3.0' });
			});
			return socket;
		}
	);
	client.onFrame = (id, raw) => frames.push([id, JSON.parse(raw)]);
	client.onExit = (id) => exits.push(id);
	return { client, sockets, frames, exits };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openCreated(env: ReturnType<typeof setup>, desktopId: string, session: string) {
	const opened = env.client.open(desktopId, '/work');
	await tick();
	const socket = env.sockets[0];
	socket.reply({ type: 'session_created', session });
	await opened;
	return socket;
}

describe('DaemonClient', () => {
	it('connects with the token, creates a session and watches it', async () => {
		const env = setup();
		const socket = await openCreated(env, 'desk-1', 'sess-1');
		expect(socket.url).toBe('ws://127.0.0.1:7788?token=t%20k');
		expect(socket.sent[0]).toMatchObject({
			op: 'session_create',
			cwd: '/work'
		});
		expect(socket.sent[1]).toEqual({ op: 'watch', session: 'sess-1' });
		expect(env.client.owns('desk-1')).toBe(true);
		expect(env.client.sessionOf('desk-1')).toBe('sess-1');
	});

	it('reopens an existing daemon session instead of creating one', async () => {
		const env = setup();
		const opened = env.client.open('desk-1', '/work', 'sess-9');
		await tick();
		expect(env.sockets[0].sent[0]).toMatchObject({
			op: 'session_open',
			session: 'sess-9'
		});
		env.sockets[0].reply({ type: 'session_opened', session: 'sess-9' });
		await opened;
		expect(env.client.sessionOf('desk-1')).toBe('sess-9');
	});

	it('routes session frames to their desktop session and tags outgoing ops', async () => {
		const env = setup();
		const socket = await openCreated(env, 'desk-1', 'sess-1');
		socket.push({ type: 'assistant_delta', session: 'sess-1', delta: 'hi' });
		socket.push({
			type: 'assistant_delta',
			session: 'someone-else',
			delta: 'no'
		});
		expect(env.frames).toEqual([
			['desk-1', { type: 'assistant_delta', session: 'sess-1', delta: 'hi' }]
		]);

		await env.client.send('desk-1', JSON.stringify({ op: 'user_message', content: 'go' }));
		expect(socket.sent.at(-1)).toEqual({
			op: 'user_message',
			content: 'go',
			session: 'sess-1'
		});
	});

	it('rejects a daemon speaking another protocol', async () => {
		const env = setup(3);
		await expect(env.client.open('desk-1', '/work')).rejects.toThrow(/protocol 3/);
		expect(env.client.owns('desk-1')).toBe(false);
	});

	it('surfaces an error reply as a failed open', async () => {
		const env = setup();
		const opened = env.client.open('desk-1', '/nope');
		await tick();
		env.sockets[0].reply({ type: 'error', message: 'not a directory: /nope' });
		await expect(opened).rejects.toThrow(/not a directory/);
		expect(env.client.owns('desk-1')).toBe(false);
	});

	it('close ends the daemon session and resolves once it has stopped', async () => {
		const env = setup();
		const socket = await openCreated(env, 'desk-1', 'sess-1');
		let closed = false;
		const closing = env.client.close('desk-1').then(() => (closed = true));
		await tick();
		expect(socket.sent.at(-1)).toMatchObject({
			op: 'session_close',
			session: 'sess-1'
		});
		expect(closed).toBe(false);
		socket.push({ type: 'session_closed', session: 'sess-1' });
		await closing;
		expect(env.exits).toEqual(['desk-1']);
		expect(env.client.owns('desk-1')).toBe(false);
	});

	it('a dropped connection exits every hosted session', async () => {
		const env = setup();
		const socket = await openCreated(env, 'desk-1', 'sess-1');
		const second = env.client.open('desk-2', '/work');
		await tick();
		socket.reply({ type: 'session_created', session: 'sess-2' });
		await second;
		socket.close();
		expect(env.exits.sort()).toEqual(['desk-1', 'desk-2']);
		expect(env.client.owns('desk-1')).toBe(false);
	});

	it('a dropped connection ends its terminals, as the daemon kills them', async () => {
		const env = setup();
		const socket = await openCreated(env, 'desk-1', 'sess-1');
		const seen: unknown[] = [];
		env.client.onTerm('t-1', (frame) => seen.push(frame.type));
		socket.push({ type: 'term_output', term: 't-1', data: '' });
		socket.close();
		expect(seen).toEqual(['term_output', 'term_exit']);
	});
});
