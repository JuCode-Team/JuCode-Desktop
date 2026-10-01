// What a session wants the user to notice, most urgent first: it waits on
// them, its last turn failed, it is working, or it replied while out of view.
// No status means idle.
import type { ChatState } from '$lib/chat.svelte';

export type SessionStatus =
	| { kind: 'input'; ask: 'approve' | 'answer' }
	| { kind: 'failed'; message: string }
	| { kind: 'running' }
	| { kind: 'unread' }
	| null;

export function sessionStatus(chat: ChatState): SessionStatus {
	if (chat.pendingApproval?.questions?.length) return { kind: 'input', ask: 'answer' };
	if (chat.pendingApproval || chat.trustPrompt) return { kind: 'input', ask: 'approve' };
	if (chat.engineState === 'exited') return { kind: 'failed', message: chat.lastError ?? '' };
	if (chat.lastError !== null) return { kind: 'failed', message: chat.lastError };
	if (chat.busy) return { kind: 'running' };
	if (chat.unseen) return { kind: 'unread' };
	return null;
}
