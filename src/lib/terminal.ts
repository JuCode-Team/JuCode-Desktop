// What the two xterm views (TerminalPanel, TuiPanel) share: their look and
// their renderer.
import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { prefs } from '$lib/prefs.svelte';
import { themeState, terminalPalette } from '$lib/theme.svelte';

/** Nerd Fonts first, for the glyphs TUIs and prompts draw. */
const DEFAULT_FONT =
	"'MesloLGL Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font', 'Hack Nerd Font', 'FiraCode Nerd Font', 'Symbols Nerd Font', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace, 'Apple Color Emoji'";

/** Theme colors and the font from Settings (a CSS font-family list, placed
 *  before the defaults). Read in an `$effect`, it reruns when either
 *  changes. */
export function terminalLook(): Pick<ITerminalOptions, 'theme' | 'fontFamily' | 'fontSize'> {
	void themeState.value; // the palette is read from CSS, which follows it
	const font = prefs.terminalFont.trim();
	return {
		theme: terminalPalette(),
		fontFamily: font ? `${font}, ${DEFAULT_FONT}` : DEFAULT_FONT,
		fontSize: prefs.terminalFontSize
	};
}

/** Draw `term` with WebGL, on the exact cell grid. The default DOM renderer
 *  gives wide characters such as `（，；` the font's width instead of two
 *  cells, so the rest of the row shifts (TUI tables break, long rows wrap
 *  onto each other). Without WebGL2 (some WebKitGTK setups) loading throws
 *  and xterm keeps the DOM renderer; a lost context does the same. */
export function useWebgl(term: Terminal): void {
	try {
		const webgl = new WebglAddon();
		webgl.onContextLoss(() => webgl.dispose());
		term.loadAddon(webgl);
	} catch (e) {
		console.warn('terminal: WebGL renderer unavailable, using DOM', e);
	}
}
