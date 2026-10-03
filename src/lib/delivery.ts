import { t } from '$lib/i18n';

/** A user turn the daemon or the engine wrote, not the user: an agent's
 *  message, a timer, a scheduled task, a question's answer, a task update or
 *  a deferred action's outcome. Recognised by the header line the CLI puts
 *  first (`delivery_text` in daemon/src/hub.rs, `decision_message` in
 *  agent-core/src/actions.rs); it is plain text in every engine's transcript,
 *  so it is the one mark a reopened session keeps. */
export type Delivery =
	| { kind: 'message'; label: string; body: string }
	/** A deferred action that ran: shown as the tool call it was. */
	| { kind: 'action'; label: string; name: string; output: string; failed: boolean }
	| { kind: 'declined'; label: string };

const HEADERS: [RegExp, (m: RegExpMatchArray) => string][] = [
	[/^\[message from agent (.+) · \S+\]$/, (m) => t('chat.delivery.agent', { name: m[1] })],
	[/^\[timer \S+ fired · \S+\]$/, () => t('chat.delivery.timer')],
	[/^\[scheduled task \S+ · \S+\]$/, () => t('chat.delivery.schedule')],
	[/^\[answer to your question \S+ · \S+\]$/, () => t('chat.delivery.answer')],
	[/^\[task \S+ update · \S+\]$/, () => t('chat.delivery.task')],
	[/^\[message from (.+) · \S+\]$/, (m) => t('chat.delivery.from', { name: m[1] })]
];

export function parseDelivery(text: string): Delivery | null {
	if (!text.startsWith('[')) return null;
	const nl = text.indexOf('\n');
	const head = nl < 0 ? text : text.slice(0, nl);
	const body = nl < 0 ? '' : text.slice(nl + 1);
	const action = head.match(/^\[deferred action \S+ (approved and executed(, failed)?|declined)\]$/);
	if (action) {
		if (action[1] === 'declined') {
			const name = body.match(/declined `([^`]+)`/)?.[1] ?? '';
			return { kind: 'declined', label: t('chat.delivery.declined', { name }) };
		}
		// `name` (summary)\nresult:\n<output>; the summary may span lines.
		const ran = body.match(/^`([^`\n]+)`(?: \([\s\S]*?\))?\nresult:\n([\s\S]*)$/);
		if (!ran) return null;
		return { kind: 'action', label: t('chat.delivery.approved'), name: ran[1]!, output: ran[2]!, failed: !!action[2] };
	}
	for (const [re, label] of HEADERS) {
		const m = head.match(re);
		if (m) return { kind: 'message', label: label(m), body };
	}
	return null;
}
