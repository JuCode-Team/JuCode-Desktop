// The fonts Settings offers for the interface, the conversation and code: a
// fixed list, of which only those installed on this computer are shown. Each
// named font falls back to the app's own, so a font later removed changes
// nothing. The conversation follows the interface unless set.

export type FontSlot = 'ui' | 'chat' | 'code';

export interface FontChoice {
	id: string;
	/** A font family name, shown as is; unset for the generic choices, which
	 *  are named in the messages (`settings.font.<id>`). */
	family?: string;
	/** The CSS list it applies; unset for the default. */
	stack?: string;
}

const SANS = "'Inter Variable', Inter, -apple-system, 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans SC', system-ui, sans-serif";
const named = (family: string, rest: string): FontChoice => ({ id: family, family, stack: `'${family}', ${rest}` });

const SANS_FAMILIES = ['HarmonyOS Sans SC', 'MiSans', 'Source Han Sans SC', 'Noto Sans SC'];

export const FONT_CHOICES: Record<FontSlot, FontChoice[]> = {
	ui: [{ id: 'default' }, { id: 'system', stack: SYSTEM_SANS }, ...SANS_FAMILIES.map((f) => named(f, SANS))],
	chat: [
		{ id: 'default' },
		{ id: 'system', stack: SYSTEM_SANS },
		{ id: 'serif', stack: "'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', STSong, SimSun, serif" },
		...[...SANS_FAMILIES, 'LXGW WenKai'].map((f) => named(f, 'var(--font-sans)'))
	],
	code: [
		{ id: 'default' },
		{ id: 'system', stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace" },
		...['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'Maple Mono', 'Sarasa Mono SC'].map((f) => named(f, MONO))
	]
};

/** The CSS variable each slot sets (app.css defines their defaults). */
const VARS: Record<FontSlot, string> = { ui: '--font-sans', chat: '--font-chat', code: '--font-mono' };

/** A saved id that is on the slot's list, else the default. */
export function fontChoice(slot: FontSlot, id: unknown): string {
	return FONT_CHOICES[slot].some((c) => c.id === id) ? (id as string) : 'default';
}

/** Applies the slot's choice to the page. */
export function applyFont(slot: FontSlot, id: string) {
	if (typeof document === 'undefined') return;
	const stack = FONT_CHOICES[slot].find((c) => c.id === id)?.stack;
	if (stack) document.documentElement.style.setProperty(VARS[slot], stack);
	else document.documentElement.style.removeProperty(VARS[slot]);
}

/** Whether `family` is installed: text set in it measures differently from
 *  each generic font it would otherwise fall back to. */
export function installed(family: string): boolean {
	const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
	if (!ctx) return false;
	const text = 'mmmmmmmmmmlli10WQ字体样本';
	return ['monospace', 'serif', 'sans-serif'].some((base) => {
		ctx.font = `72px ${base}`;
		const width = ctx.measureText(text).width;
		ctx.font = `72px '${family}', ${base}`;
		return ctx.measureText(text).width !== width;
	});
}

/** The slot's choices to offer: the generic ones, the named fonts installed
 *  here, and the current one whatever it is. */
export function offeredFonts(slot: FontSlot, current: string): FontChoice[] {
	return FONT_CHOICES[slot].filter((c) => !c.family || c.id === current || installed(c.family));
}
