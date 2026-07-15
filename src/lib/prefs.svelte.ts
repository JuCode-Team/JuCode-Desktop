// Lightweight user preferences (localStorage-backed, reactive). Kept separate
// from engine/backend settings — these are pure UI choices.
const KEY = 'jucode-prefs';

type PrefsShape = {
	/** Clicking an .html/.htm link in chat opens it in the built-in browser
	 *  (rendered). When false it opens in the editor (source). Non-HTML files
	 *  always open in the editor. */
	htmlOpenInBrowser: boolean;
	/** macOS only: frost the sidebar with the native window vibrancy. The native
	 *  effect layer is always present but stays invisible unless this opts the CSS
	 *  in (the root `data-vibrancy` flag), so toggling needs no window round-trip. */
	sidebarVibrancy: boolean;
};

const DEFAULTS: PrefsShape = { htmlOpenInBrowser: true, sidebarVibrancy: true };

function load(): PrefsShape {
	try {
		return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<PrefsShape>) };
	} catch {
		return { ...DEFAULTS };
	}
}

/** True on the macOS desktop app, where the native vibrancy layer exists. */
export const vibrancySupported = () =>
	typeof window !== 'undefined' &&
	('__TAURI_INTERNALS__' in window || '__TAURI__' in window) &&
	/Macintosh|Mac OS X/.test(navigator.userAgent);

class PrefsStore {
	htmlOpenInBrowser = $state(DEFAULTS.htmlOpenInBrowser);
	sidebarVibrancy = $state(DEFAULTS.sidebarVibrancy);

	init() {
		const p = load();
		this.htmlOpenInBrowser = p.htmlOpenInBrowser;
		this.sidebarVibrancy = p.sidebarVibrancy;
		this.#applyVibrancy();
	}

	#save() {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({ htmlOpenInBrowser: this.htmlOpenInBrowser, sidebarVibrancy: this.sidebarVibrancy })
			);
		} catch {
			/* private mode / no storage — in-memory only */
		}
	}

	/** Reflect the vibrancy choice onto the root, gated by platform support. */
	#applyVibrancy() {
		if (typeof document === 'undefined') return;
		if (vibrancySupported() && this.sidebarVibrancy) {
			document.documentElement.setAttribute('data-vibrancy', 'on');
		} else {
			document.documentElement.removeAttribute('data-vibrancy');
		}
	}

	setHtmlOpenInBrowser(v: boolean) {
		this.htmlOpenInBrowser = v;
		this.#save();
	}

	setSidebarVibrancy(v: boolean) {
		this.sidebarVibrancy = v;
		this.#applyVibrancy();
		this.#save();
	}
}

export const prefs = new PrefsStore();
