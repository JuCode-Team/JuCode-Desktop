// A subagent's conversation opens in a page of its own, read-only (no
// composer): beside the chat, where every subagent opened so far is a tab of
// one column, or as a tab next to the chat itself. Settings pick which
// (prefs.openElsewhere); a ⌘/Ctrl-click opens it the other way. The tab's
// panel names the session and the agent (`subagent:<session>:<agent>`).

export type SubagentPlace = 'side' | 'tab';
/** Where a click opens one: a place, where settings say, or the other one (⌘/Ctrl). */
export type OpenHow = SubagentPlace | 'default' | 'other';

/** The place a click opens a subagent in, given the setting. */
export const placeFor = (how: OpenHow, setting: SubagentPlace): SubagentPlace =>
	how === 'default' ? setting : how === 'other' ? (setting === 'tab' ? 'side' : 'tab') : how;

const PREFIX = 'subagent:';

export const subagentPanel = (sessionId: string, agentId: string) => `${PREFIX}${sessionId}:${agentId}`;

/** The session and agent a `subagent:` panel shows; null for any other panel.
 *  Session ids have no ':', agent ids may. */
export function subagentOf(panel: string): { sessionId: string; agentId: string } | null {
	if (!panel.startsWith(PREFIX)) return null;
	const rest = panel.slice(PREFIX.length);
	const at = rest.indexOf(':');
	return at > 0 && at < rest.length - 1 ? { sessionId: rest.slice(0, at), agentId: rest.slice(at + 1) } : null;
}

class SubagentPages {
	/** The last page asked for; the page shell opens (or shows) its tab. */
	request = $state<{ sessionId: string; agentId: string; place: SubagentPlace; n: number } | null>(null);

	open(sessionId: string, agentId: string, place: SubagentPlace) {
		this.request = { sessionId, agentId, place, n: (this.request?.n ?? 0) + 1 };
	}
}

export const subagentPages = new SubagentPages();
