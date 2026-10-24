// What a session's sidebar card says besides its state: the lines its latest
// turn changed, how far its plan is, the background tasks still running and
// the messages waiting to be sent. Each is left out when there is none.
import type { ChatState } from '$lib/chat.svelte';
import { planSummary, runningTasks } from '$lib/agentProgress';
import { turnSummary } from '$lib/turnSummary';

export interface CardInfo {
	diff: { add: number; del: number } | null;
	plan: { done: number; total: number } | null;
	tasks: number;
	queued: number;
}

type Input = Pick<ChatState, 'messages' | 'plan' | 'pendingMessages' | 'subagents' | 'agentRuns' | 'bgTasks'>;

export function cardInfo(chat: Input): CardInfo {
	const from = chat.messages.findLastIndex((m) => m.kind === 'user');
	const edited = turnSummary(chat.messages.slice(from + 1))?.edited ?? [];
	const add = edited.reduce((n, f) => n + f.add, 0);
	const del = edited.reduce((n, f) => n + f.del, 0);
	const plan = planSummary(chat.plan);
	return {
		diff: add || del ? { add, del } : null,
		// A finished plan says nothing more.
		plan: plan.total && plan.done < plan.total ? { done: plan.done, total: plan.total } : null,
		tasks: runningTasks(chat),
		queued: chat.pendingMessages.length
	};
}
