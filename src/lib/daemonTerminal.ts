// A view of one daemon terminal: the TUI a session handed its conversation
// to (daemon-protocol.md, Terminals). The terminal belongs to the session and
// runs in the daemon; a client only views it, so several may at once, and a
// view that goes away (a closed tab, a dropped connection) leaves it running
// to be attached again. Used by the desktop's TuiPanel and the remote page's
// TerminalView; the xterm itself stays with them.

import type { DaemonClient } from './daemon';

/** Unacked bytes that make a paired device ack at once. */
export const ACK_BYTES = 64 * 1024;
/** Otherwise the ack goes this long after the last unacked write. */
export const ACK_DELAY_MS = 100;

export function encodeBase64(bytes: Uint8Array): string {
	let text = '';
	for (const byte of bytes) text += String.fromCharCode(byte);
	return btoa(text);
}

export function decodeBase64(data: string): Uint8Array {
	return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

/** What a paired device has written to its emulator since its latest
 *  attach, and when to tell the daemon (`term_ack`): the daemon stops
 *  sending past 512 KiB unacked. */
export class AckCounter {
	#written = 0;
	#acked = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private send: (bytes: number) => void) {}

	/** `n` more bytes were written; true when that acked them at once. */
	wrote(n: number): boolean {
		this.#written += n;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		if (this.#written - this.#acked >= ACK_BYTES) {
			this.#flush();
			return true;
		}
		this.#timer = setTimeout(() => this.#flush(), ACK_DELAY_MS);
		return false;
	}

	/** A new attach: the daemon counts from zero again. */
	reset() {
		this.dispose();
		this.#written = 0;
		this.#acked = 0;
	}

	dispose() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	#flush() {
		this.#timer = undefined;
		if (this.#written <= this.#acked) return;
		this.#acked = this.#written;
		this.send(this.#acked);
	}
}

export interface TerminalViewer {
	/** Clear the emulator: the scrollback replay follows. */
	reset(): void;
	/** Write output; call `done` once the emulator has taken it. */
	output(bytes: Uint8Array, done: () => void): void;
	/** The TUI ended (`code` null: killed by a signal). */
	exit(code: number | null): void;
	/** This view was detached and may attach again: `slow` (a paired device
	 *  fell behind) or `disconnected` (the connection dropped). */
	detached(reason: string): void;
}

type Daemon = Pick<DaemonClient, 'request' | 'post' | 'onTerm'>;

export class DaemonTerminal {
	/** The terminal viewed; '' until the first attach. */
	term = '';
	#off: (() => void) | null = null;
	#replayed = false;
	/** Counts attaches, so a write the emulator finishes after a new attach
	 *  is not acked against it. */
	#attaches = 0;
	#ack: AckCounter | null;
	#encoder = new TextEncoder();

	/** `ack`: the daemon flow-controls this client (a paired device). */
	constructor(
		private daemon: Daemon,
		private viewer: TerminalViewer,
		ack = false
	) {
		this.#ack = ack ? new AckCounter((bytes) => this.#post({ op: 'term_ack', term: this.term, bytes })) : null;
	}

	/** Views terminal `term` when its id is known (another client opened it,
	 *  or this view is coming back), else moves `session` into its TUI
	 *  (`force`: a running reply may be cut short). Returns the term id. */
	async attach(to: { term?: string; session?: string; cols: number; rows: number; force?: boolean }): Promise<string> {
		this.#off?.();
		this.#ack?.reset();
		this.#replayed = false;
		this.#attaches++;
		const { cols, rows } = to;
		if (to.term) {
			this.term = to.term;
			// Listening first: the replay follows the reply at once.
			this.#listen();
			try {
				await this.daemon.request({ op: 'term_attach', term: to.term, cols, rows });
			} catch (e) {
				this.#off?.();
				this.#off = null;
				throw e;
			}
		} else {
			const reply = await this.daemon.request({ op: 'session_tui', session: to.session, cols, rows, force: !!to.force });
			this.term = String(reply.term ?? '');
			this.#listen();
		}
		return this.term;
	}

	input(data: string) {
		return this.daemon.post({ op: 'term_input', term: this.term, data: encodeBase64(this.#encoder.encode(data)) });
	}

	resize(cols: number, rows: number) {
		this.#post({ op: 'term_resize', term: this.term, cols, rows });
	}

	/** Stops viewing; the TUI keeps running. */
	detach() {
		if (this.#off) this.#post({ op: 'term_detach', term: this.term });
		this.dispose();
	}

	/** Ends the TUI (for every viewer); `term_exit` follows. */
	close() {
		this.#post({ op: 'term_close', term: this.term });
	}

	dispose() {
		this.#off?.();
		this.#off = null;
		this.#ack?.dispose();
	}

	#post(op: Record<string, unknown>) {
		if (this.term) this.daemon.post(op).catch(() => {});
	}

	#listen() {
		const attach = this.#attaches;
		this.#off = this.daemon.onTerm(this.term, (frame) => {
			if (frame.type === 'term_output') {
				if (frame.replay === true && !this.#replayed) {
					this.#replayed = true;
					this.viewer.reset();
				}
				const bytes = decodeBase64(String(frame.data ?? ''));
				this.viewer.output(bytes, () => {
					if (this.#attaches === attach && this.#off) this.#ack?.wrote(bytes.length);
				});
			} else if (frame.type === 'term_exit') {
				this.dispose();
				this.viewer.exit(typeof frame.code === 'number' ? frame.code : null);
			} else if (frame.type === 'term_detached') {
				this.dispose();
				this.viewer.detached(String(frame.reason ?? ''));
			}
		});
	}
}
