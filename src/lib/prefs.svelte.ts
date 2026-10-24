// Lightweight user preferences (localStorage-backed, reactive). Kept separate
// from engine/backend settings — these are pure UI choices.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { applyFont, fontChoice, type FontSlot } from './fonts';

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
	/** The interface, conversation and code fonts: ids from FONT_CHOICES. */
	uiFont: string;
	chatFont: string;
	codeFont: string;
	/** The view an existing conversation opens in: the chat, or its
	 *  engine's own TUI. */
	defaultSurface: 'gui' | 'tui';
	/** Sending a message scrolls the conversation to its end. */
	scrollOnSend: boolean;
	/** A finished turn folds its work (tool calls, thinking, interim text)
	 *  into one line, leaving the question and the final reply. */
	foldTurns: boolean;
	/** Under the composer: the context in use (else only once it nears the limit) and the session's cost. */
	footContext: boolean;
	footCost: boolean;
	/** Engines that can summarize their thinking (Claude, Codex) do, before replying. */
	thinkingSummaries: boolean;
	/** A dev server an agent starts opens in the built-in browser (else a notice offers it). */
	devServerAutoOpen: boolean;
	/** A sound when a task ends or needs the user, unless they are watching it (chime.ts). */
	sounds: boolean;
	/** Each sidebar conversation starts with its engine's mark. */
	sessionAgentIcon: boolean;
	/** Interface zoom (the webview's page zoom), one of ZOOM_STEPS. */
	zoom: number;
	/** Sessions idle this many days archive themselves (0: never). */
	autoArchiveDays: number;
	/** A new worktree starts from its base branch's remote tip, fetched
	 *  first (else from the local branch). */
	worktreeFromOrigin: boolean;
};

/** The zoom levels ⌘+ / ⌘- step through. */
export const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const TURN_STAT_KEYS = ['elapsed', 'ttft', 'tokens', 'tps', 'tools', 'cost', 'model'] as const;
export type TurnStatKey = (typeof TURN_STAT_KEYS)[number];

const DEFAULTS: PrefsShape = {
	htmlOpenInBrowser: true,
	sidebarVibrancy: true,
	turnStats: ['elapsed', 'tokens'],
	chatWidth: 844,
	cacheMissAlert: true,
	telemetry: true,
	terminalFont: '',
	terminalFontSize: 12.5,
	uiFont: 'default',
	chatFont: 'default',
	codeFont: 'default',
	defaultSurface: 'gui',
	scrollOnSend: true,
	foldTurns: true,
	footContext: true,
	footCost: true,
	thinkingSummaries: true,
	devServerAutoOpen: false,
	sounds: true,
	sessionAgentIcon: true,
	zoom: 1,
	autoArchiveDays: 3,
	worktreeFromOrigin: true
};

/** A terminal font size within 8–32 px; anything else is the default. */
const fontSize = (v: unknown) => (typeof v === 'number' && v >= 8 && v <= 32 ? v : DEFAULTS.terminalFontSize);
/** Whole days within 0–90; anything else is the default. */
const archiveDays = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 90 ? v : DEFAULTS.autoArchiveDays);
const zoomLevel = (v: unknown) => (typeof v === 'number' && ZOOM_STEPS.includes(v) ? v : DEFAULTS.zoom);
const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
	uiFont = $state(DEFAULTS.uiFont);
	chatFont = $state(DEFAULTS.chatFont);
	codeFont = $state(DEFAULTS.codeFont);
	defaultSurface = $state(DEFAULTS.defaultSurface);
	scrollOnSend = $state(DEFAULTS.scrollOnSend);
	foldTurns = $state(DEFAULTS.foldTurns);
	footContext = $state(DEFAULTS.footContext);
	footCost = $state(DEFAULTS.footCost);
	thinkingSummaries = $state(DEFAULTS.thinkingSummaries);
	devServerAutoOpen = $state(DEFAULTS.devServerAutoOpen);
	sounds = $state(DEFAULTS.sounds);
	sessionAgentIcon = $state(DEFAULTS.sessionAgentIcon);
	zoom = $state(DEFAULTS.zoom);
	autoArchiveDays = $state(DEFAULTS.autoArchiveDays);
	worktreeFromOrigin = $state(DEFAULTS.worktreeFromOrigin);

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
		this.uiFont = fontChoice('ui', p.uiFont);
		this.chatFont = fontChoice('chat', p.chatFont);
		this.codeFont = fontChoice('code', p.codeFont);
		applyFont('ui', this.uiFont);
		applyFont('chat', this.chatFont);
		applyFont('code', this.codeFont);
		this.defaultSurface = p.defaultSurface === 'tui' ? 'tui' : 'gui';
		this.scrollOnSend = p.scrollOnSend !== false;
		this.foldTurns = p.foldTurns !== false;
		this.footContext = p.footContext !== false;
		this.footCost = p.footCost !== false;
		this.thinkingSummaries = p.thinkingSummaries !== false;
		this.devServerAutoOpen = p.devServerAutoOpen === true;
		this.sounds = p.sounds !== false;
		this.sessionAgentIcon = p.sessionAgentIcon !== false;
		this.zoom = zoomLevel(p.zoom);
		this.autoArchiveDays = archiveDays(p.autoArchiveDays);
		this.worktreeFromOrigin = p.worktreeFromOrigin !== false;
		this.#applyVibrancy();
		if (inTauri()) {
			if (this.zoom !== 1) this.#applyZoom();
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
					uiFont: this.uiFont,
					chatFont: this.chatFont,
					codeFont: this.codeFont,
					defaultSurface: this.defaultSurface,
					scrollOnSend: this.scrollOnSend,
					foldTurns: this.foldTurns,
					footContext: this.footContext,
					footCost: this.footCost,
					thinkingSummaries: this.thinkingSummaries,
					devServerAutoOpen: this.devServerAutoOpen,
					sounds: this.sounds,
					sessionAgentIcon: this.sessionAgentIcon,
					zoom: this.zoom,
					autoArchiveDays: this.autoArchiveDays,
					worktreeFromOrigin: this.worktreeFromOrigin
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

	/** The switches without side effects of their own. */
	setFlag(name: 'foldTurns' | 'footContext' | 'footCost' | 'thinkingSummaries' | 'devServerAutoOpen' | 'sounds' | 'sessionAgentIcon' | 'worktreeFromOrigin', v: boolean) {
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

	setFont(slot: FontSlot, id: string) {
		const choice = fontChoice(slot, id);
		this[`${slot}Font`] = choice;
		applyFont(slot, choice);
		this.#save();
	}

	setAutoArchiveDays(days: number) {
		this.autoArchiveDays = archiveDays(days);
		this.#save();
	}
	/** Step the interface zoom up (1) or down (-1), or reset it (0). */
	stepZoom(dir: 1 | -1 | 0) {
		const i = ZOOM_STEPS.indexOf(this.zoom);
		const next = dir === 0 ? 1 : ZOOM_STEPS[Math.min(Math.max(i + dir, 0), ZOOM_STEPS.length - 1)];
		if (next === this.zoom) return;
		this.zoom = next;
		this.#applyZoom();
		this.#save();
	}

	#applyZoom() {
		// The title bar stays at its size (TitleBar.svelte) so it keeps lining
		// up with the system's traffic lights, which do not zoom.
		document.documentElement.style.setProperty('--ui-zoom', String(this.zoom));
		if (inTauri()) getCurrentWebview().setZoom(this.zoom).catch((e) => console.error('setZoom', e));
	}

	setSidebarVibrancy(v: boolean) {
		this.sidebarVibrancy = v;
		this.#applyVibrancy();
		this.#save();
	}
}

export const prefs = new PrefsStore();
