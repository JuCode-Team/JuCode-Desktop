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
