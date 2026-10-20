// Unsent composer text, kept per conversation in localStorage so it survives
// switching away, closing the tab and restarting the app. Blank text is
// removed rather than stored. (Not to be confused with a draft session.)

const PREFIX = 'jucode-composer:';

export function loadComposerText(key: string): string {
	try {
		return localStorage.getItem(PREFIX + key) ?? '';
	} catch {
		return ''; // no localStorage (tests, private mode)
	}
}

export function saveComposerText(key: string, text: string) {
	try {
		if (text.trim()) localStorage.setItem(PREFIX + key, text);
		else localStorage.removeItem(PREFIX + key);
	} catch {
		/* no localStorage, or it is full: the text lives only in memory */
	}
}

// What else the composer holds before it is sent (attachments, quotes,
// picked page elements), per conversation, kept in memory so it survives
// the pane closing (a workspace switch), not a restart.
const extras = new Map<string, unknown>();

export function loadComposerExtras<T>(key: string): T | undefined {
	return extras.get(key) as T | undefined;
}

/** `value` undefined forgets it. */
export function saveComposerExtras(key: string, value: unknown) {
	if (value === undefined) extras.delete(key);
	else extras.set(key, value);
}
