// A finished turn's work folds into one line (MessageList): the tool calls,
// thinking and interim text between the user's message and the final reply.
// What the user still has to see or act on stays out: the final reply, plans
// (their approval) and errors.
import type { Msg } from './chat.svelte';
import { parseDelivery } from './delivery';
import { editedPaths, isEdit, parseToolOutput, toolVerb } from './toolSummary';

export interface TurnFold {
	/** The user message that opened the turn: keys its open state. */
	key: Msg;
	/** The rows folded away, in order; the first one carries the fold's line. */
	members: Msg[];
	/** How long the turn took, ms (null: unknown, e.g. a replayed transcript). */
	elapsed: number | null;
	/** Tool calls folded away. */
	calls: number;
	/** Distinct files edited or written. */
	files: number;
	/** Commands run. */
	commands: number;
}

/** The folds of `messages`' finished turns. `shows`: whether a message has
 *  a row at all; `busy`: the last turn is still running (it never folds). */
export function turnFolds(messages: Msg[], shows: (m: Msg) => boolean, busy: boolean): TurnFold[] {
	const turns: { key: Msg; body: Msg[] }[] = [];
	for (const m of messages) {
		if (m.kind === 'user' && !parseDelivery(m.text)) turns.push({ key: m, body: [] });
		else if (shows(m)) turns.at(-1)?.body.push(m);
	}
	const folds: TurnFold[] = [];
	turns.forEach(({ key, body }, i) => {
		if (busy && i === turns.length - 1) return;
		// The final reply: the text after the last other row (a reply split
		// by nothing but empty rows is one reply).
		let end = body.length;
		while (end > 0 && (body[end - 1]!.kind === 'plan' || body[end - 1]!.kind === 'error')) end--;
		let reply = end;
		while (reply > 0 && body[reply - 1]!.kind === 'assistant') reply--;
		const members = body.slice(0, reply).filter((m) => m.kind !== 'plan' && m.kind !== 'error');
		if (!members.some((m) => m.kind === 'tool' || m.kind === 'reasoning')) return;
		const files = new Set<string>();
		let calls = 0;
		let commands = 0;
		for (const m of members) {
			if (m.kind !== 'tool') continue;
			calls++;
			if (toolVerb(m.name) === 'Ran') commands++;
			if (isEdit(m.name)) for (const p of editedPaths(parseToolOutput(m.output))) files.add(p);
		}
		const stats = body.findLast((m) => m.kind === 'assistant' && m.turn);
		folds.push({
			key,
			members,
			elapsed: stats?.kind === 'assistant' && stats.turn ? stats.turn.elapsed : null,
			calls,
			files: files.size,
			commands
		});
	});
	return folds;
}
