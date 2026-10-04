// The app's keyboard shortcuts in one table: the window key handler matches
// against it, and buttons, the command palette and the shortcut list show
// the same keys (⌘ on macOS, Ctrl elsewhere).

export type ShortcutId =
	| 'palette'
	| 'newSession'
	| 'settings'
	| 'sidebar'
	| 'find'
	| 'quickOpen'
	| 'audit'
	| 'focusComposer'
	| 'stop'
	| 'model'
	| 'history'
	| 'prevSession'
	| 'nextSession'
	| 'sessionN'
	| 'terminal'
	| 'approvalMode'
	| 'captureRequirement'
	| 'shortcuts';

export interface Shortcut {
	/** `KeyboardEvent.key` (lower case for letters), or `1-9` for digits. */
	key: string;
	/** ⌘ on macOS, Ctrl elsewhere. */
	mod?: boolean;
	shift?: boolean;
	/** The Control key on every platform. */
	ctrl?: boolean;
	group: 'general' | 'session' | 'composer';
}

export const SHORTCUTS: Record<ShortcutId, Shortcut> = {
	palette: { key: 'k', mod: true, group: 'general' },
	quickOpen: { key: 'p', mod: true, group: 'general' },
	sidebar: { key: 'b', mod: true, group: 'general' },
	settings: { key: ',', mod: true, group: 'general' },
	terminal: { key: '`', ctrl: true, group: 'general' },
	shortcuts: { key: '/', mod: true, group: 'general' },
	captureRequirement: { key: 'n', mod: true, shift: true, group: 'general' },
	newSession: { key: 'n', mod: true, group: 'session' },
	history: { key: 'h', mod: true, shift: true, group: 'session' },
	prevSession: { key: '[', mod: true, shift: true, group: 'session' },
	nextSession: { key: ']', mod: true, shift: true, group: 'session' },
	sessionN: { key: '1-9', mod: true, group: 'session' },
	find: { key: 'f', mod: true, group: 'session' },
	audit: { key: 'e', mod: true, group: 'session' },
	focusComposer: { key: 'l', mod: true, group: 'composer' },
	model: { key: 'm', mod: true, shift: true, group: 'composer' },
	approvalMode: { key: 'Tab', shift: true, group: 'composer' },
	stop: { key: '.', mod: true, group: 'composer' }
};

export const isMac = () => typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** The physical key behind `e`: Shift turns `[` into `{` and `/` into `?`. */
function keyOf(e: KeyboardEvent): string {
	if (e.code === 'BracketLeft') return '[';
	if (e.code === 'BracketRight') return ']';
	if (e.code === 'Slash') return '/';
	if (e.code === 'Backquote') return '`';
	if (e.code === 'Period') return '.';
	if (e.code === 'Comma') return ',';
	return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/** Whether `e` is shortcut `id`. For `sessionN` it is the digit (1-9), else
 *  0 when it is not. */
export function matches(e: KeyboardEvent, id: ShortcutId, mac = isMac()): number | boolean {
	const s = SHORTCUTS[id];
	if (!!s.shift !== e.shiftKey || e.altKey) return false;
	// On macOS Control is a modifier of its own; elsewhere it is the mod key.
	const held = mac ? e.metaKey === !!s.mod && e.ctrlKey === !!s.ctrl : !e.metaKey && e.ctrlKey === !!(s.mod || s.ctrl);
	if (!held) return false;
	const key = keyOf(e);
	if (s.key === '1-9') return /^[1-9]$/.test(key) ? Number(key) : 0;
	return key === s.key;
}

/** How shortcut `id` reads on this platform: ⌘⇧M, Ctrl+Shift+M. */
export function shortcutLabel(id: ShortcutId, mac = isMac()): string {
	const s = SHORTCUTS[id];
	const key = s.key === '1-9' ? '1…9' : s.key.length === 1 ? s.key.toUpperCase() : s.key;
	if (mac) return `${s.ctrl ? '⌃' : ''}${s.shift ? '⇧' : ''}${s.mod ? '⌘' : ''}${key === 'Tab' ? '⇥' : key}`;
	return [s.ctrl || s.mod ? 'Ctrl' : '', s.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** A tooltip: the action, then its shortcut. */
export function withShortcut(label: string, id: ShortcutId): string {
	return `${label} · ${shortcutLabel(id)}`;
}
