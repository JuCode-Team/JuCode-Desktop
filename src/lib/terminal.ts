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

/** Route committed text through InputEvent, whose data is independent of
 *  key ordering. macOS IMEs may commit punctuation before keydown (229);
 *  xterm's keydown gate and deferred textarea diff then drop or duplicate it.
 *  See https://github.com/xtermjs/xterm.js/issues/6045. Call after open(). */
export function useTerminalInput(term: Terminal): () => void {
	const textarea = term.textarea!;
	const element = term.element!;
	let composing = false;
	let endTimer: ReturnType<typeof setTimeout> | undefined;
	const start = () => {
		clearTimeout(endTimer);
		composing = true;
	};
	const end = () => {
		// xterm reads the final textarea value on its own timer. Its listener
		// was registered by open(), so this timer runs after that commit.
		endTimer = setTimeout(() => { composing = false; });
	};
	const input = (event: InputEvent) => {
		if (term.options.screenReaderMode) return;
		if (composing || event.isComposing) {
			// CompositionHelper owns this text, including the input event that
			// can follow compositionend before its deferred commit.
			event.stopImmediatePropagation();
			return;
		}
		const data = event.inputType === 'insertText' ? event.data
			: event.inputType === 'deleteContentBackward' ? '\x7f' : null;
		if (!data) return;
		// Ancestor capture precedes xterm's textarea input handler. One event,
		// one send; no accumulated textarea text for a later key to resend.
		event.stopImmediatePropagation();
		textarea.value = '';
		term.input(data, true);
	};
	term.attachCustomKeyEventHandler((event) => term.options.screenReaderMode || (
		// Control/navigation keys still use xterm. Printable keypress and the
		// 229 textarea-diff fallback must not also send the committed text.
		event.type !== 'keypress' && !(event.type === 'keydown' && event.keyCode === 229)
	));
	textarea.addEventListener('compositionstart', start);
	textarea.addEventListener('compositionend', end);
	element.addEventListener('input', input, { capture: true });
	return () => {
		clearTimeout(endTimer);
		textarea.removeEventListener('compositionstart', start);
		textarea.removeEventListener('compositionend', end);
		element.removeEventListener('input', input, { capture: true });
		term.attachCustomKeyEventHandler(() => true);
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
