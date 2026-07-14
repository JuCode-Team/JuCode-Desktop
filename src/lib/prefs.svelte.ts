// Lightweight user preferences (localStorage-backed, reactive). Kept separate
// from engine/backend settings — these are pure UI choices.
const KEY = 'jucode-prefs';

type PrefsShape = {
	/** Clicking an .html/.htm link in chat opens it in the built-in browser
	 *  (rendered). When false it opens in the editor (source). Non-HTML files
	 *  always open in the editor. */
	htmlOpenInBrowser: boolean;
};

const DEFAULTS: PrefsShape = { htmlOpenInBrowser: true };

function load(): PrefsShape {
	try {
		return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<PrefsShape>) };
	} catch {
		return { ...DEFAULTS };
	}
}

class PrefsStore {
	htmlOpenInBrowser = $state(DEFAULTS.htmlOpenInBrowser);

	init() {
		const p = load();
		this.htmlOpenInBrowser = p.htmlOpenInBrowser;
	}

	#save() {
		try {
			localStorage.setItem(KEY, JSON.stringify({ htmlOpenInBrowser: this.htmlOpenInBrowser }));
		} catch {
			/* private mode / no storage — in-memory only */
		}
	}

	setHtmlOpenInBrowser(v: boolean) {
		this.htmlOpenInBrowser = v;
		this.#save();
	}
}

export const prefs = new PrefsStore();
