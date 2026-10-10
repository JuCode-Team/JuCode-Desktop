// Lightweight user preferences (localStorage-backed, reactive). Kept separate
// from engine/backend settings — these are pure UI choices.
import { invoke } from '@tauri-apps/api/core';

const KEY = 'jucode-prefs';

type PrefsShape = {
	/** Clicking an .html/.htm link in chat opens it in the built-in browser
	 *  (rendered). When false it opens in the editor (source). Non-HTML files
	 *  always open in the editor. */
	htmlOpenInBrowser: boolean;
	/** Frost the sidebar and window chrome with the native window effect
	 *  (macOS vibrancy, Windows Mica / Acrylic). The native layer is always
	 *  present but stays invisible unless this opts the CSS in (the root
	 *  `data-vibrancy` flag), so toggling needs no window round-trip. */
	sidebarVibrancy: boolean;
	/** Which per-turn figures the reply footer shows (see TurnStats). */
	turnStats: TurnStatKey[];
	/** Width in px of the conversation column (messages and composer), set by
	 *  dragging its edge. */
	chatWidth: number;
	/** Offer to stop a running turn when one of its requests misses the
	 *  prompt cache (see cacheMiss.ts). */
	cacheMissAlert: boolean;
	/** Send anonymous usage counts (telemetry.svelte.ts). */
	telemetry: boolean;
	/** Terminal font family (CSS list) tried before the built-in ones; empty
	 *  for the defaults. */
	terminalFont: string;
	terminalFontSize: number;
	/** The view an existing conversation opens in: the chat, or its
	 *  engine's own TUI. */
	defaultSurface: 'gui' | 'tui';
	/** Where subagents and tool windows (agents, changes, files…) open: in a
	 *  column beside the chat, or as a tab next to it. */
	openElsewhere: 'side' | 'tab';
	/** Sending a message scrolls the conversation to its end. */
	scrollOnSend: boolean;
	/** Under the composer: the context in use (else only once it nears the limit) and the session's cost. */
	footContext: boolean;
	footCost: boolean;
	/** Engines that can summarize their thinking (Claude, Codex) do, before replying. */
	thinkingSummaries: boolean;
};

export const TURN_STAT_KEYS = ['elapsed', 'ttft', 'tokens', 'files', 'tools', 'cost', 'model'] as const;
export type TurnStatKey = (typeof TURN_STAT_KEYS)[number];

const DEFAULTS: PrefsShape = {
	htmlOpenInBrowser: true,
	sidebarVibrancy: true,
	turnStats: ['elapsed', 'tokens', 'files'],
	chatWidth: 844,
	cacheMissAlert: true,
	telemetry: true,
	terminalFont: '',
	terminalFontSize: 12.5,
	defaultSurface: 'gui',
	openElsewhere: 'side',
	scrollOnSend: true,
	footContext: true,
	footCost: true,
	thinkingSummaries: true
};

/** A terminal font size within 8–32 px; anything else is the default. */
const fontSize = (v: unknown) => (typeof v === 'number' && v >= 8 && v <= 32 ? v : DEFAULTS.terminalFontSize);

function load(): PrefsShape {
	try {
		return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<PrefsShape>) };
	} catch {
		return { ...DEFAULTS };
	}
}

/** Reflects the host OS onto `<html data-os>` so platform-specific window chrome
 *  can be styled in CSS: macOS uses an overlay title bar (traffic lights inset the
 *  top-left), while Windows/Linux get a native title bar and no traffic lights.
 *  Call once, synchronously, before first paint. */
export function applyPlatformClass() {
	if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
	const ua = navigator.userAgent;
	const os = /Macintosh|Mac OS X/.test(ua)
		? 'macos'
		: /Windows/.test(ua)
			? 'windows'
			: 'linux';
	document.documentElement.dataset.os = os;
}

/** The window has a native frost behind it (the app reports which at
 *  startup: `window_effect`); without one the translucent chrome would show
 *  the bare desktop. */
export const vibrancySupported = () => prefs.windowEffect !== null;

class PrefsStore {
	htmlOpenInBrowser = $state(DEFAULTS.htmlOpenInBrowser);
	sidebarVibrancy = $state(DEFAULTS.sidebarVibrancy);
	/** `vibrancy`, `mica` or `acrylic`; null where none applied (Linux, the
	 *  browser, an unsupported Windows). */
	windowEffect = $state<string | null>(
		// The macOS app always has one: assume it for the first frame (no flash
		// of an opaque sidebar); window_effect confirms it right after.
		typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && /Macintosh|Mac OS X/.test(navigator.userAgent)
			? 'vibrancy'
			: null
	);
	turnStats = $state<TurnStatKey[]>(DEFAULTS.turnStats);
	chatWidth = $state(DEFAULTS.chatWidth);
	cacheMissAlert = $state(DEFAULTS.cacheMissAlert);
	telemetry = $state(DEFAULTS.telemetry);
	terminalFont = $state(DEFAULTS.terminalFont);
	terminalFontSize = $state(DEFAULTS.terminalFontSize);
	defaultSurface = $state(DEFAULTS.defaultSurface);
	openElsewhere = $state(DEFAULTS.openElsewhere);
	scrollOnSend = $state(DEFAULTS.scrollOnSend);
	footContext = $state(DEFAULTS.footContext);
	footCost = $state(DEFAULTS.footCost);
	thinkingSummaries = $state(DEFAULTS.thinkingSummaries);

	init() {
		const p = load();
		this.htmlOpenInBrowser = p.htmlOpenInBrowser;
		this.sidebarVibrancy = p.sidebarVibrancy;
		this.turnStats = Array.isArray(p.turnStats)
			? p.turnStats.filter((k): k is TurnStatKey => (TURN_STAT_KEYS as readonly string[]).includes(k))
			: DEFAULTS.turnStats;
		this.chatWidth = Number.isFinite(p.chatWidth) ? p.chatWidth : DEFAULTS.chatWidth;
		this.cacheMissAlert = p.cacheMissAlert !== false;
		this.telemetry = p.telemetry !== false;
		this.terminalFont = typeof p.terminalFont === 'string' ? p.terminalFont : DEFAULTS.terminalFont;
		this.terminalFontSize = fontSize(p.terminalFontSize);
		this.defaultSurface = p.defaultSurface === 'tui' ? 'tui' : 'gui';
		this.openElsewhere = p.openElsewhere === 'tab' ? 'tab' : 'side';
		this.scrollOnSend = p.scrollOnSend !== false;
		this.footContext = p.footContext !== false;
		this.footCost = p.footCost !== false;
		this.thinkingSummaries = p.thinkingSummaries !== false;
		this.#applyVibrancy();
		if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
			invoke<string | null>('window_effect')
				.then((effect) => {
					this.windowEffect = effect;
					this.#applyVibrancy();
				})
				.catch(() => {});
		}
	}

	#save() {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					htmlOpenInBrowser: this.htmlOpenInBrowser,
					sidebarVibrancy: this.sidebarVibrancy,
					turnStats: this.turnStats,
					chatWidth: this.chatWidth,
					cacheMissAlert: this.cacheMissAlert,
					telemetry: this.telemetry,
					terminalFont: this.terminalFont,
					terminalFontSize: this.terminalFontSize,
					defaultSurface: this.defaultSurface,
					openElsewhere: this.openElsewhere,
					scrollOnSend: this.scrollOnSend,
					footContext: this.footContext,
					footCost: this.footCost,
					thinkingSummaries: this.thinkingSummaries
				})
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

	setChatWidth(v: number) {
		this.chatWidth = Math.round(v);
		this.#save();
	}

	setHtmlOpenInBrowser(v: boolean) {
		this.htmlOpenInBrowser = v;
		this.#save();
	}

	setTurnStat(key: TurnStatKey, on: boolean) {
		const rest = this.turnStats.filter((k) => k !== key);
		// Kept in TURN_STAT_KEYS order, the footer's order.
		this.turnStats = on ? TURN_STAT_KEYS.filter((k) => k === key || rest.includes(k)) : rest;
		this.#save();
	}

	setCacheMissAlert(v: boolean) {
		this.cacheMissAlert = v;
		this.#save();
	}

	setScrollOnSend(v: boolean) {
		this.scrollOnSend = v;
		this.#save();
	}

	setTelemetry(v: boolean) {
		this.telemetry = v;
		this.#save();
	}

	setDefaultSurface(v: 'gui' | 'tui') {
		this.defaultSurface = v;
		this.#save();
	}

	setOpenElsewhere(v: 'side' | 'tab') {
		this.openElsewhere = v;
		this.#save();
	}

	/** The switches without side effects of their own. */
	setFlag(name: 'footContext' | 'footCost' | 'thinkingSummaries', v: boolean) {
		this[name] = v;
		this.#save();
	}

	setTerminalFont(v: string) {
		this.terminalFont = v;
		this.#save();
	}

	setTerminalFontSize(v: number) {
		this.terminalFontSize = fontSize(v);
		this.#save();
	}

	setSidebarVibrancy(v: boolean) {
		this.sidebarVibrancy = v;
		this.#applyVibrancy();
		this.#save();
	}
}

export const prefs = new PrefsStore();
