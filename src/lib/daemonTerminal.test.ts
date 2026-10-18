import { describe, it, expect, vi, afterEach } from 'vitest';
import { ACK_BYTES, ACK_DELAY_MS, AckCounter, DaemonTerminal, decodeBase64, encodeBase64 } from './daemonTerminal';

type Frame = Record<string, unknown>;

function fakeDaemon() {
	const sent: Frame[] = [];
	const handlers = new Map<string, (frame: Frame) => void>();
	const daemon = {
		sent,
		request: vi.fn(async (op: Frame) => {
			sent.push(op);
			if (op.op === 'session_tui') return { type: 'term_opened', term: 't-new' };
			if (op.op === 'term_attach' && op.term === 'gone') throw new Error('unknown terminal gone');
			return { type: 'term_attached', term: op.term };
		}),
		post: vi.fn(async (op: Frame) => {
			sent.push(op);
		}),
		onTerm: (term: string, handler: (frame: Frame) => void) => {
			handlers.set(term, handler);
			return () => handlers.delete(term);
		},
		push: (frame: Frame) => handlers.get(String(frame.term))?.(frame),
		handlers
	};
	return daemon;
}

function viewer() {
	const log: string[] = [];
	return {
		log,
		reset: () => log.push('reset'),
		output: (bytes: Uint8Array, done: () => void) => {
			log.push(`out:${bytes.length}`);
			done();
		},
		exit: (code: number | null) => log.push(`exit:${code}`),
		detached: (reason: string) => log.push(`detached:${reason}`)
	};
}

const b64 = (n: number) => encodeBase64(new Uint8Array(n));

afterEach(() => vi.useRealTimers());

describe('DaemonTerminal.attach', () => {
	it('views a known terminal with term_attach, else asks the session for its TUI', async () => {
		const daemon = fakeDaemon();
		const known = new DaemonTerminal(daemon, viewer());
		expect(await known.attach({ term: 't-1', cols: 80, rows: 24 })).toBe('t-1');
		expect(daemon.sent.at(-1)).toEqual({ op: 'term_attach', term: 't-1', cols: 80, rows: 24 });

		const fresh = new DaemonTerminal(daemon, viewer());
		expect(await fresh.attach({ session: 's', cols: 100, rows: 30, force: true })).toBe('t-new');
		expect(daemon.sent.at(-1)).toEqual({ op: 'session_tui', session: 's', cols: 100, rows: 30, force: true });
		expect(daemon.handlers.has('t-new')).toBe(true);
	});

	it('stops listening when the terminal is gone', async () => {
		const daemon = fakeDaemon();
		const term = new DaemonTerminal(daemon, viewer());
		await expect(term.attach({ term: 'gone', cols: 80, rows: 24 })).rejects.toThrow('unknown terminal');
		expect(daemon.handlers.has('gone')).toBe(false);
	});

	it('resets the emulator once, before the first replay frame of each attach', async () => {
		const daemon = fakeDaemon();
		const v = viewer();
		const term = new DaemonTerminal(daemon, v);
		await term.attach({ term: 't-1', cols: 80, rows: 24 });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(3), replay: true });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(2), replay: true });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(1) });
		await term.attach({ term: 't-1', cols: 80, rows: 24 });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(4), replay: true });
		expect(v.log).toEqual(['reset', 'out:3', 'out:2', 'out:1', 'reset', 'out:4']);
	});

	it('reports exit and detach, and detaches on leave without ending the TUI', async () => {
		const daemon = fakeDaemon();
		const v = viewer();
		const term = new DaemonTerminal(daemon, v);
		await term.attach({ term: 't-1', cols: 80, rows: 24 });
		daemon.push({ type: 'term_detached', term: 't-1', reason: 'slow' });
		await term.attach({ term: 't-1', cols: 80, rows: 24 });
		term.detach();
		expect(daemon.sent.at(-1)).toEqual({ op: 'term_detach', term: 't-1' });
		await term.attach({ term: 't-1', cols: 80, rows: 24 });
		term.close();
		expect(daemon.sent.at(-1)).toEqual({ op: 'term_close', term: 't-1' });
		daemon.push({ type: 'term_exit', term: 't-1', code: null });
		expect(v.log).toEqual(['detached:slow', 'exit:null']);
		expect(daemon.handlers.has('t-1')).toBe(false);
	});

	it('acks a paired device\'s writes; a local view never acks', async () => {
		vi.useFakeTimers();
		const daemon = fakeDaemon();
		const device = new DaemonTerminal(daemon, viewer(), true);
		await device.attach({ term: 't-1', cols: 80, rows: 24 });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(ACK_BYTES), replay: true });
		expect(daemon.sent.at(-1)).toEqual({ op: 'term_ack', term: 't-1', bytes: ACK_BYTES });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(10) });
		vi.advanceTimersByTime(ACK_DELAY_MS);
		expect(daemon.sent.at(-1)).toEqual({ op: 'term_ack', term: 't-1', bytes: ACK_BYTES + 10 });
		// Counted from zero again after an attach.
		await device.attach({ term: 't-1', cols: 80, rows: 24 });
		daemon.push({ type: 'term_output', term: 't-1', data: b64(5), replay: true });
		vi.advanceTimersByTime(ACK_DELAY_MS);
		expect(daemon.sent.at(-1)).toEqual({ op: 'term_ack', term: 't-1', bytes: 5 });

		const local = fakeDaemon();
		const desk = new DaemonTerminal(local, viewer());
		await desk.attach({ term: 't-2', cols: 80, rows: 24 });
		local.push({ type: 'term_output', term: 't-2', data: b64(ACK_BYTES * 2) });
		vi.advanceTimersByTime(ACK_DELAY_MS);
		expect(local.sent.some((op) => op.op === 'term_ack')).toBe(false);
	});
});

describe('AckCounter', () => {
	it('acks at the threshold at once, else after a quiet moment', () => {
		vi.useFakeTimers();
		const acks: number[] = [];
		const counter = new AckCounter((n) => acks.push(n));
		expect(counter.wrote(1000)).toBe(false);
		vi.advanceTimersByTime(ACK_DELAY_MS - 1);
		expect(counter.wrote(1000)).toBe(false);
		vi.advanceTimersByTime(ACK_DELAY_MS - 1);
		expect(acks).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(acks).toEqual([2000]);
		expect(counter.wrote(ACK_BYTES)).toBe(true);
		expect(acks).toEqual([2000, 2000 + ACK_BYTES]);
		counter.wrote(7);
		counter.reset();
		vi.advanceTimersByTime(ACK_DELAY_MS);
		expect(acks).toHaveLength(2);
	});
});

describe('base64', () => {
	it('round-trips bytes that are not UTF-8', () => {
		const bytes = new Uint8Array([0, 0xff, 0xfe, 0x80, 0x1b, 0x5b, 0xc3]);
		expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
	});
});
