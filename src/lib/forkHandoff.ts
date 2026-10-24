// "Bring back the conclusions" of a fork: what the fork did after the turns
// it took from the original, for a one-shot model to write up as a message
// the original conversation goes on from (as t3code's merge back does). The
// user reviews it in the original's composer before it is sent.
import type { Msg } from './chat.svelte';
import { workLine, workSummary } from './workSummary';

/** Characters of the fork's conversation the model reads (its end). */
const LIMIT = 16_000;

export const HANDOFF_SYSTEM =
	'You write a handoff message. The user forked a coding-agent conversation to explore something on the side; ' +
	'you are given what happened in the fork after it split off. Write the message the user will send back to the agent ' +
	'of the original conversation so it can build on the fork: one opening sentence saying it comes from a forked ' +
	'exploration, then the conclusions, decisions and changes made (files, commands, open questions) as short bullet ' +
	'points. Report only what the conversation shows. Write in the language the user writes in. Output only the message.';

/** The fork's part of `messages` (after its first `turns` user turns), as
 *  text; `branch`: the worktree branch its changes are on, if any. Empty
 *  when the fork has not gone on yet. */
export function handoffPrompt(messages: Msg[], turns: number, branch?: string): string {
	let users = 0;
	const start = messages.findIndex((m) => m.kind === 'user' && users++ === turns);
	if (start < 0) return '';
	const lines: string[] = [];
	let tools: Extract<Msg, { kind: 'tool' }>[] = [];
	const flush = () => {
		if (tools.length) lines.push(`(${workLine(workSummary(tools))})`);
		tools = [];
	};
	for (const m of messages.slice(start)) {
		if (m.kind === 'tool' && !m.subagent) tools.push(m);
		else if (m.kind === 'user' || m.kind === 'assistant') {
			flush();
			if (/\S/.test(m.text)) lines.push(`${m.kind === 'user' ? 'User' : 'Agent'}: ${m.text.trim()}`);
		}
	}
	flush();
	const text = lines.join('\n\n');
	const body = text.length > LIMIT ? `…${text.slice(-LIMIT)}` : text;
	return branch ? `The fork's changes are on git branch ${branch}, in its own worktree.\n\n${body}` : body;
}
