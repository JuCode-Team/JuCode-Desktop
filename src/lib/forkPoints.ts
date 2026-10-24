// Where a conversation can fork (MessageList): the reply that ends each
// finished turn, with how many user turns a fork from it keeps (the turn it
// ends and those before). The turn still running has none.
import type { Msg } from './chat.svelte';

export function forkPoints(messages: Msg[], busy: boolean): Map<Msg, number> {
	const points = new Map<Msg, number>();
	let users = 0;
	let last: Msg | null = null;
	for (const m of messages) {
		if (m.kind === 'user') {
			if (last) points.set(last, users);
			last = null;
			users++;
		} else if (m.kind === 'assistant' && /\S/.test(m.text)) last = m;
	}
	if (last && !busy) points.set(last, users);
	return points;
}
