import type { Mermaid } from 'mermaid';

// Mermaid is a few MB: loaded the first time a reply has a diagram.
let loading: Promise<Mermaid> | null = null;
let configured = '';
let seq = 0;

// SVG by theme and source: a row windowed back in, or the same diagram again.
const rendered = new Map<string, string | null>();
const RENDERED_MAX = 100;

/** A CSS colour as opaque hex over the page background: mermaid derives
 *  shades from its colours and reads neither custom properties nor alpha. */
function solid(color: string, bg: string): string {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return color;
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, 1, 1);
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Mermaid's theme from the app's current colours (custom themes included). */
function themeVariables(dark: boolean) {
	const css = getComputedStyle(document.documentElement);
	const v = (name: string) => css.getPropertyValue(name).trim();
	const bg = solid(v('--bg'), dark ? '#000' : '#fff');
	const c = (name: string) => solid(v(name), bg);
	return {
		darkMode: dark,
		background: bg,
		fontFamily: v('--font-sans'),
		fontSize: '14px',
		primaryColor: c('--panel'),
		primaryTextColor: c('--text'),
		primaryBorderColor: c('--dim2'),
		secondaryColor: c('--surface2'),
		tertiaryColor: c('--surface'),
		lineColor: c('--dim'),
		edgeLabelBackground: c('--surface'),
		textColor: c('--text')
	};
}

/** The diagram as SVG, or null when the source isn't valid mermaid
 *  (the code block then stays as it is). */
export async function renderMermaid(source: string, dark: boolean): Promise<string | null> {
	const vars = themeVariables(dark);
	const theme = JSON.stringify(vars);
	const key = `${theme}\n${source}`;
	const hit = rendered.get(key);
	if (hit !== undefined) return hit;
	loading ??= import('mermaid').then((m) => m.default);
	const mermaid = await loading;
	if (configured !== theme) {
		mermaid.initialize({
			startOnLoad: false,
			// Labels are sanitized and click handlers are off.
			securityLevel: 'strict',
			suppressErrorRendering: true,
			theme: 'base',
			themeVariables: vars
		});
		configured = theme;
	}
	let svg: string | null = null;
	try {
		if (await mermaid.parse(source, { suppressErrors: true })) {
			svg = (await mermaid.render(`jc-mermaid-${++seq}`, source)).svg;
		}
	} catch {
		svg = null;
	}
	if (rendered.size >= RENDERED_MAX) rendered.delete(rendered.keys().next().value!);
	rendered.set(key, svg);
	return svg;
}
