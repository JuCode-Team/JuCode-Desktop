// Picks a session back up after its turn failed on a dropped connection or an
// overloaded upstream, once the engine's own retries (if any) are spent: a
// few attempts, spaced out, each in place (SessionStore.retryTurn) so the
// conversation does not fill up with "continue" messages. The countdown
// shows in the transcript (ChatState.autoRetry) with "now" and "cancel".

import type { ChatState } from './chat.svelte';
import { describeError } from './errorInfo';
import { t } from './i18n';
import type { SessionStore } from './session.svelte';

/** The wait before each attempt. */
export const AUTO_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

/** Failures a later attempt can get past: the connection, or a server that
 *  was overloaded or down. Not rate limits or quotas, which a retry repeats. */
export function retryable(message: string, backend: string): boolean {
	const kind = describeError(message, backend)?.kind;
	return kind === 'network' || kind === 'upstream';
}

export class AutoRetry {
	#timers = new Map<ChatState, ReturnType<typeof setTimeout>>();
	#started = new Map<ChatState, boolean>();

	/** Set by the page. */
	store: SessionStore | null = null;

	/** A turn failed (ChatState.onTurnFailed). */
	failed(chat: ChatState, message: string, started: boolean) {
		this.cancel(chat);
		if (!retryable(message, chat.backendId)) return;
		const attempt = chat.autoRetries + 1;
		if (attempt > AUTO_RETRY_DELAYS_MS.length) return;
		const delayMs = AUTO_RETRY_DELAYS_MS[attempt - 1];
		chat.autoRetry = { attempt, max: AUTO_RETRY_DELAYS_MS.length, reason: message, delayMs, at: Date.now() };
		this.#started.set(chat, started);
		this.#timers.set(
			chat,
			setTimeout(() => this.now(chat), delayMs)
		);
	}

	/** Retries at once (the notice's "retry now"). */
	now(chat: ChatState) {
		const pending = chat.autoRetry;
		const started = this.#started.get(chat) ?? true;
		this.cancel(chat);
		if (!pending) return;
		const session = this.store?.allSessions.find((s) => s.chat === chat);
		if (!this.store || !session) return;
		chat.autoRetries = pending.attempt;
		void this.store.retryTurn(
			session.id,
			t('chat.autoRetry.note', { n: pending.attempt, max: pending.max }),
			started
		);
	}

	/** Drops a waiting retry (the notice's "cancel", a new message, an interrupt). */
	cancel(chat: ChatState) {
		const timer = this.#timers.get(chat);
		if (timer) clearTimeout(timer);
		this.#timers.delete(chat);
		this.#started.delete(chat);
		chat.autoRetry = null;
	}
}

export const autoRetry = new AutoRetry();
