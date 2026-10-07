import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';

vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('$lib/prefs.svelte', () => ({ prefs: {} }));
vi.mock('$lib/theme.svelte', () => ({ themeState: {}, terminalPalette: vi.fn() }));

import { useTerminalInput } from './terminal';

function setup() {
	const textarea = Object.assign(new EventTarget(), { value: '' });
	const element = new EventTarget();
	const input = vi.fn();
	let key: (event: KeyboardEvent) => boolean = () => true;
	const options = { screenReaderMode: false };
	const dispose = useTerminalInput({
		textarea, element, options, input,
		attachCustomKeyEventHandler: (handler: typeof key) => { key = handler; }
	} as unknown as Terminal);
	const commit = (data: string, inputType = 'insertText', isComposing = false) => {
		textarea.value += data;
		element.dispatchEvent(Object.assign(new Event('input'), { data, inputType, isComposing }));
	};
	return { textarea, input, options, dispose, commit, key: (type: string, keyCode: number) => key({ type, keyCode } as KeyboardEvent) };
}

afterEach(() => vi.useRealTimers());

describe('terminal IME input', () => {
	it('sends direct IME commits once regardless of keydown ordering', () => {
		const t = setup();
		expect(t.key('keydown', 229)).toBe(false);
		t.commit('，');
		t.commit('！');
		expect(t.key('keydown', 229)).toBe(false);
		t.commit('abc');
		expect(t.input.mock.calls).toEqual([['，', true], ['！', true], ['abc', true]]);
		expect(t.textarea.value).toBe('');
		expect(t.key('keydown', 13)).toBe(true);
		expect(t.key('keypress', 65)).toBe(false);
		t.dispose();
	});

	it('leaves composition and its deferred commit to xterm, then resumes direct input', () => {
		vi.useFakeTimers();
		const t = setup();
		t.textarea.dispatchEvent(new Event('compositionstart'));
		t.commit('ni', 'insertCompositionText', true);
		t.textarea.dispatchEvent(new Event('compositionend'));
		t.commit('你');
		expect(t.input).not.toHaveBeenCalled();
		t.textarea.dispatchEvent(new Event('compositionstart'));
		vi.runAllTimers();
		t.commit('好');
		expect(t.input).not.toHaveBeenCalled();
		t.textarea.dispatchEvent(new Event('compositionend'));
		vi.runAllTimers();
		t.commit('。');
		expect(t.input.mock.calls).toEqual([['。', true]]);
		t.dispose();
	});

	it('handles IME backspace and preserves screen reader input and teardown', () => {
		const t = setup();
		t.commit('', 'deleteContentBackward');
		expect(t.input.mock.calls).toEqual([['\x7f', true]]);
		t.options.screenReaderMode = true;
		expect(t.key('keypress', 65)).toBe(true);
		t.commit('a');
		expect(t.textarea.value).toBe('a');
		t.options.screenReaderMode = false;
		t.dispose();
		t.commit('b');
		expect(t.input).toHaveBeenCalledTimes(1);
		expect(t.key('keydown', 229)).toBe(true);
	});
});
