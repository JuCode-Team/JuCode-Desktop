// A finished turn's work folds into one line (MessageList): the tool calls,
// thinking and interim text between the user's message and the final reply.
// What the user still has to see or act on stays out: the final reply and
// plans (their approval). A turn that failed or that the user stopped does
// not fold, so what went wrong stays in view (as in t3code).
import type { Msg } from './chat.svelte';
import { parseDelivery } from './delivery';

export interface TurnFold {
	/** The user message that opened the turn: keys its open state. */
	key: Msg;
	/** The rows folded away, in order; the first one carries the fold's line. */
	members: Msg[];
	/** How long the turn took, ms: as timed live, else from when the
	 *  question and the final reply were written (null: neither known). */
	elapsed: number | null;
}

/** The folds of `messages`' finished turns. `shows`: whether a message has
 *  a row at all; `busy`: the last turn is still running. Its work folds only
 *  as far as a reply that ended it before (a background task that finished
 *  runs a short turn of its own after it): what runs now stays open. */
export function turnFolds(messages: Msg[], shows: (m: Msg) => boolean, busy: boolean): TurnFold[] {
	const turns: { key: Msg; body: Msg[] }[] = [];
	for (const m of messages) {
		if (m.kind === 'user' && !parseDelivery(m.text)) turns.push({ key: m, body: [] });
		else if (shows(m)) turns.at(-1)?.body.push(m);
	}
	const folds: TurnFold[] = [];
	turns.forEach(({ key, body: all }, i) => {
		let body = all;
		if (busy && i === turns.length - 1) {
			const ended = all.findLastIndex((m) => m.kind === 'assistant' && !!m.turn);
			if (ended < 0) return;
			body = all.slice(0, ended + 1);
		}
		// The final reply: the text after the last other row (a reply split
		// by nothing but empty rows is one reply).
		const stats = body.findLast((m) => m.kind === 'assistant' && !!m.turn);
		const turn = stats?.kind === 'assistant' ? stats.turn : undefined;
		if (turn?.stopped || body.some((m) => m.kind === 'error')) return;
		let end = body.length;
		while (end > 0 && body[end - 1]!.kind === 'plan') end--;
		let reply = end;
		while (reply > 0 && body[reply - 1]!.kind === 'assistant') reply--;
		const members = body.slice(0, reply).filter((m) => m.kind !== 'plan');
		if (!members.some((m) => m.kind === 'tool' || m.kind === 'reasoning')) return;
		const asked = key.kind === 'user' ? key.at : undefined;
		const answered = body.findLast((m) => m.kind === 'assistant' && m.at !== undefined);
		const at = answered?.kind === 'assistant' ? answered.at : undefined;
		folds.push({
			key,
			members,
			elapsed: turn ? turn.elapsed : asked !== undefined && at !== undefined && at >= asked ? at - asked : null
		});
	});
	return folds;
}
