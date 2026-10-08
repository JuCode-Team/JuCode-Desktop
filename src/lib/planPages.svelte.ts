// A plan the agent proposes opens in a page of its own beside the chat, as
// the embedded browser does: one tab per plan, kept until the user closes it.
// The tab's panel names the session and the plan (`proposal:<session>:<plan>`).

const PREFIX = 'proposal:';

export const proposalPanel = (sessionId: string, planId: string) => `${PREFIX}${sessionId}:${planId}`;

/** The session and plan a `proposal:` panel shows; null for any other panel. */
export function proposalOf(panel: string): { sessionId: string; planId: string } | null {
	if (!panel.startsWith(PREFIX)) return null;
	const rest = panel.slice(PREFIX.length);
	const at = rest.indexOf(':');
	return at > 0 ? { sessionId: rest.slice(0, at), planId: rest.slice(at + 1) } : null;
}

/** Markdown in blocks (blank-line separated, a code fence kept whole), so a
 *  page can bring a plan in one block at a time. */
export function planBlocks(text: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];
	let fenced = false;
	for (const line of text.split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (!fenced && line.trim() === '' && current.length) {
			blocks.push(current.join('\n'));
			current = [];
			continue;
		}
		if (line.trim() !== '' || current.length) current.push(line);
	}
	if (current.length) blocks.push(current.join('\n'));
	return blocks;
}

class PlanPages {
	/** The last page asked for; the page shell opens (or shows) its tab. */
	request = $state<{ sessionId: string; planId: string; n: number } | null>(null);

	open(sessionId: string, planId: string) {
		this.request = { sessionId, planId, n: (this.request?.n ?? 0) + 1 };
	}
}

export const planPages = new PlanPages();
