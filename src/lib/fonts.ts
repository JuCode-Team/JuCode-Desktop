// The fonts of the interface, the conversation and code: a generic choice
// (the app's own, the system's, a serif) or any family installed here, which
// Settings lists from the system (system_fonts). A named font falls back to
// the app's own, so one later removed changes nothing. The conversation
// follows the interface unless set.

export type FontSlot = 'ui' | 'chat' | 'code';

/** A generic choice; its label is in the messages (`settings.behavior.font*`). */
export interface FontChoice {
	id: string;
	/** The CSS list it applies; unset for the default. */
	stack?: string;
}

const SANS = "'Inter Variable', Inter, -apple-system, 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans SC', system-ui, sans-serif";

/** The generic choices of each slot (named in `settings.behavior.font*`). */
export const FONT_CHOICES: Record<FontSlot, FontChoice[]> = {
	ui: [{ id: 'default' }, { id: 'system', stack: SYSTEM_SANS }],
	chat: [
		{ id: 'default' },
		{ id: 'system', stack: SYSTEM_SANS },
		{ id: 'serif', stack: "'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', STSong, SimSun, serif" }
	],
	code: [{ id: 'default' }, { id: 'system', stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace" }]
};

/** What a named font falls back to, per slot. */
const FALLBACK: Record<FontSlot, string> = { ui: SANS, chat: 'var(--font-sans)', code: MONO };

/** A family name that can go into CSS as it is quoted there. */
const isFamily = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/['";{}\\<>]/.test(v);

/** The CSS variable each slot sets (app.css defines their defaults). */
const VARS: Record<FontSlot, string> = { ui: '--font-sans', chat: '--font-chat', code: '--font-mono' };

/** A saved id: a generic choice of the slot or a family name, else the default. */
export function fontChoice(slot: FontSlot, id: unknown): string {
	return FONT_CHOICES[slot].some((c) => c.id === id) || isFamily(id) ? (id as string) : 'default';
}

/** The CSS list a choice applies (none for the default). */
export function fontStack(slot: FontSlot, id: string): string | undefined {
	const generic = FONT_CHOICES[slot].find((c) => c.id === id);
	if (generic) return generic.stack;
	return isFamily(id) ? `'${id}', ${FALLBACK[slot]}` : undefined;
}

/** Applies the slot's choice to the page. */
export function applyFont(slot: FontSlot, id: string) {
	if (typeof document === 'undefined') return;
	const stack = fontStack(slot, id);
	if (stack) document.documentElement.style.setProperty(VARS[slot], stack);
	else document.documentElement.style.removeProperty(VARS[slot]);
}
