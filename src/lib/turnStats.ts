import { t } from '$lib/i18n';
import type { TurnStats } from '$lib/chat.svelte';
import type { TurnStatKey } from '$lib/prefs.svelte';
import { costText } from './sessionCost';
import { fmtTokens } from '$lib/usageStats';

export const fmtDur = (ms: number) =>
	ms < 1000
		? `${ms}ms`
		: ms < 60000
			? `${(ms / 1000).toFixed(1)}s`
			: `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;

/** The chosen turn figures, in footer order; shared by the reply footer and its settings preview. */
export function turnParts(s: TurnStats, keys: readonly TurnStatKey[]): { text: string; title: string; mono?: boolean }[] {
	const out: { text: string; title: string; mono?: boolean }[] = [];
	for (const k of keys) {
		if (k === 'elapsed') out.push({ text: fmtDur(s.elapsed), title: t('chat.stat.elapsed'), mono: true });
		else if (k === 'ttft' && s.ttft !== undefined)
			out.push({ text: t('chat.stat.ttftShort', { t: fmtDur(s.ttft) }), title: t('chat.stat.ttft') });
		else if (k === 'tokens' && (s.inTokens || s.outTokens))
			out.push({ text: `↑${fmtTokens(s.inTokens)} ↓${fmtTokens(s.outTokens)}`, title: t('chat.stat.tokens'), mono: true });
		else if (k === 'files' && s.files)
			out.push({ text: t('chat.stat.filesShort', { n: s.files, a: s.added, r: s.removed }), title: t('chat.stat.files') });
		else if (k === 'tools' && s.tools) out.push({ text: t('chat.stat.toolsShort', { n: s.tools }), title: t('chat.stat.tools') });
		else if (k === 'cost' && (s.cost > 0 || s.billing))
			out.push({ text: costText(s.cost, s.billing), title: t(s.billing ? 'chat.costSettledHint' : 'chat.stat.cost'), mono: true });
		else if (k === 'model' && s.model) out.push({ text: s.model, title: t('chat.stat.model') });
	}
	return out;
}
