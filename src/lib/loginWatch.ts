import type { ChatState } from '$lib/chat.svelte';

/** The engine reports a failed /login as an error in the session that ran it;
 *  the login UI (Settings, Setup) watches for one after `mark` (the message
 *  count when the login started) so it can stop waiting and show why. */
export function loginErrorSince(chat: ChatState | undefined, mark: number): string {
	if (!chat) return '';
	for (let i = chat.messages.length - 1; i >= mark; i--) {
		const m = chat.messages[i];
		if (m.kind === 'error' && /login/i.test(m.text)) return m.text;
	}
	return '';
}
