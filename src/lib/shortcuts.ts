// The app's keyboard shortcuts in one table: the window key handler matches
// against it, and buttons, the command palette and the shortcut list show
// the same keys (⌘ on macOS, Ctrl elsewhere). The user may rebind them in the
// shortcut list; their keys are kept on this computer.

export type ShortcutId =
	| 'palette'
	| 'searchSessions'
	| 'newSession'
	| 'settings'
	| 'sidebar'
	| 'find'
	| 'quickOpen'
	| 'audit'
	| 'focusComposer'
	| 'stop'
	| 'sendNow'
	| 'interruptSend'
	| 'model'
	| 'history'
	| 'prevSession'
	| 'nextSession'
	| 'sessionN'
	| 'terminal'
	| 'approvalMode'
	| 'captureRequirement'
	| 'shortcuts'
	| 'zoomIn'
	| 'zoomOut'
	| 'zoomReset';

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
	palette: { key: 'p', mod: true, shift: true, group: 'general' },
	searchSessions: { key: 'k', mod: true, group: 'general' },
	quickOpen: { key: 'p', mod: true, group: 'general' },
	sidebar: { key: 'b', mod: true, group: 'general' },
	settings: { key: ',', mod: true, group: 'general' },
	terminal: { key: '`', ctrl: true, group: 'general' },
	shortcuts: { key: '/', mod: true, group: 'general' },
	captureRequirement: { key: 'n', mod: true, shift: true, group: 'general' },
	zoomIn: { key: '=', mod: true, group: 'general' },
	zoomOut: { key: '-', mod: true, group: 'general' },
	zoomReset: { key: '0', mod: true, group: 'general' },
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
	stop: { key: '.', mod: true, group: 'composer' },
	sendNow: { key: 'Enter', mod: true, group: 'composer' },
	interruptSend: { key: 'Enter', mod: true, shift: true, group: 'composer' }
};

/** A shortcut's keys, without its group. */
export type Binding = Pick<Shortcut, 'key' | 'mod' | 'shift' | 'ctrl'>;

/** Not rebound: a range of keys. */
export const FIXED: ReadonlySet<ShortcutId> = new Set(['sessionN']);

const STORE = 'jucode-shortcuts';

function loadOverrides(): Partial<Record<ShortcutId, Binding>> {
	try {
		const saved = JSON.parse(globalThis.localStorage?.getItem(STORE) || '{}') as Record<string, Binding>;
		return Object.fromEntries(
			Object.entries(saved).filter(([id, b]) => id in SHORTCUTS && !FIXED.has(id as ShortcutId) && typeof b?.key === 'string' && b.key)
		);
	} catch {
		return {};
	}
}

/** The user's own keys, by shortcut. */
let overrides = loadOverrides();

/** Shortcut `id`'s keys: the user's, else the default. */
export function binding(id: ShortcutId): Binding {
	return overrides[id] ?? SHORTCUTS[id];
}

export const isRebound = (id: ShortcutId) => id in overrides;

/** Rebinds `id` (null: back to its default) and keeps it. */
export function setBinding(id: ShortcutId, keys: Binding | null) {
	const { [id]: _, ...rest } = overrides;
	overrides = keys ? { ...rest, [id]: { key: keys.key, mod: !!keys.mod, shift: !!keys.shift, ctrl: !!keys.ctrl } } : rest;
	try {
		globalThis.localStorage?.setItem(STORE, JSON.stringify(overrides));
	} catch {
		/* no storage: for this run only */
	}
}

/** Every shortcut back to its default. */
export function resetBindings() {
	overrides = {};
	try {
		globalThis.localStorage?.removeItem(STORE);
	} catch {
		/* no storage */
	}
}

/** The same keys pressed: off macOS, Control is the mod key. */
const same = (a: Binding, b: Binding, mac: boolean) =>
	a.key === b.key &&
	!!a.shift === !!b.shift &&
	(mac ? !!a.mod === !!b.mod && !!a.ctrl === !!b.ctrl : !!(a.mod || a.ctrl) === !!(b.mod || b.ctrl));

/** The other shortcut already on `keys`, if any. */
export function conflictOf(id: ShortcutId, keys: Binding, mac = isMac()): ShortcutId | null {
	return (Object.keys(SHORTCUTS) as ShortcutId[]).find((other) => other !== id && same(binding(other), keys, mac)) ?? null;
}

/** The keys a key press records: it needs ⌘ or Ctrl (or Shift with a
 *  non-character key such as Tab), and not Option/Alt, which types characters.
 *  null: a bare key, or only a modifier so far. */
export function bindingOf(e: KeyboardEvent, mac = isMac()): Binding | null {
	if (e.altKey || ['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null;
	const key = keyOf(e);
	const mod = mac ? e.metaKey : e.ctrlKey;
	const ctrl = mac && e.ctrlKey;
	if (!mod && !ctrl && !(e.shiftKey && key.length > 1)) return null;
	if (!mac && e.metaKey) return null;
	return { key, mod, shift: e.shiftKey, ctrl };
}

export const isMac = () => typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** The physical key behind `e`: Shift turns `[` into `{` and `/` into `?`. */
function keyOf(e: KeyboardEvent): string {
	if (e.code === 'BracketLeft') return '[';
	if (e.code === 'BracketRight') return ']';
	if (e.code === 'Slash') return '/';
	if (e.code === 'Backquote') return '`';
	if (e.code === 'Period') return '.';
	if (e.code === 'Comma') return ',';
	if (e.code === 'Equal') return '=';
	if (e.code === 'Minus') return '-';
	return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/** Whether `e` is shortcut `id`. For `sessionN` it is the digit (1-9), else
 *  0 when it is not. */
export function matches(e: KeyboardEvent, id: ShortcutId, mac = isMac()): number | boolean {
	const s = binding(id);
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
	return keysLabel(binding(id), mac);
}

/** How `s` reads on this platform. */
export function keysLabel(s: Binding, mac = isMac()): string {
	// The zoom-in key reads as +, as other apps show it.
	const key = s.key === '1-9' ? '1…9' : s.key === '=' ? '+' : s.key.length === 1 ? s.key.toUpperCase() : s.key;
	if (mac) return `${s.ctrl ? '⌃' : ''}${s.shift ? '⇧' : ''}${s.mod ? '⌘' : ''}${key === 'Tab' ? '⇥' : key === 'Enter' ? '↵' : key}`;
	return [s.ctrl || s.mod ? 'Ctrl' : '', s.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** A tooltip: the action, then its shortcut. */
export function withShortcut(label: string, id: ShortcutId): string {
	return `${label} · ${shortcutLabel(id)}`;
}
