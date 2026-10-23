// A turn the plan's usage limit stopped carries on once the limit resets, if
// the user asked (UsageLimit.svelte): in place, as an automatic retry is
// (SessionStore.retryTurn). The wait lives in this run of the app only.

import type { ChatState } from './chat.svelte';
import { t } from './i18n';
import type { SessionStore } from './session.svelte';

/** After the reset time: the provider's clock may run a little behind. */
const GRACE_MS = 30_000;

export class LimitResume {
	#timers = new Map<ChatState, ReturnType<typeof setTimeout>>();

	/** Set by the page. */
	store: SessionStore | null = null;

	/** Carries the session on when its limit resets. */
	arm(chat: ChatState) {
		const at = chat.rateLimit?.resetsAt;
		if (!at) return;
		this.cancel(chat);
		chat.resumeAtReset = true;
		this.#timers.set(
			chat,
			setTimeout(() => this.#fire(chat), Math.max(0, at - Date.now()) + GRACE_MS)
		);
	}

	cancel(chat: ChatState) {
		const timer = this.#timers.get(chat);
		if (timer) clearTimeout(timer);
		this.#timers.delete(chat);
		chat.resumeAtReset = false;
	}

	#fire(chat: ChatState) {
		this.cancel(chat);
		const session = this.store?.allSessions.find((s) => s.chat === chat);
		if (!this.store || !session || chat.busy) return;
		chat.rateLimit = null;
		void this.store.retryTurn(session.id, t('chat.limit.resumed'), true);
	}
}

export const limitResume = new LimitResume();
