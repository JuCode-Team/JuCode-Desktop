import { describe, expect, it } from 'vitest';
import { matches, shortcutLabel } from './shortcuts';

// Tests run in node: a plain event of the fields the matcher reads.
const key = (init: Partial<KeyboardEvent>) =>
	({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

describe('shortcuts', () => {
	it('match ⌘ on macOS and Ctrl elsewhere', () => {
		expect(matches(key({ key: 'k', metaKey: true }), 'palette', true)).toBe(true);
		expect(matches(key({ key: 'k', ctrlKey: true }), 'palette', true)).toBe(false);
		expect(matches(key({ key: 'k', ctrlKey: true }), 'palette', false)).toBe(true);
		expect(matches(key({ key: 'k', metaKey: true, shiftKey: true }), 'palette', true)).toBe(false);
	});

	it('read shifted punctuation by its key, and digits as their number', () => {
		expect(matches(key({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true }), 'prevSession', true)).toBe(true);
		expect(matches(key({ key: 'M', metaKey: true, shiftKey: true }), 'model', true)).toBe(true);
		expect(matches(key({ key: '3', metaKey: true }), 'sessionN', true)).toBe(3);
		expect(matches(key({ key: '0', metaKey: true }), 'sessionN', true)).toBe(0);
		expect(matches(key({ key: '`', code: 'Backquote', ctrlKey: true }), 'terminal', true)).toBe(true);
		expect(matches(key({ key: '`', code: 'Backquote', ctrlKey: true }), 'terminal', false)).toBe(true);
	});

	it('label for the platform', () => {
		expect(shortcutLabel('model', true)).toBe('⇧⌘M');
		expect(shortcutLabel('model', false)).toBe('Ctrl+Shift+M');
		expect(shortcutLabel('terminal', true)).toBe('⌃`');
		expect(shortcutLabel('approvalMode', true)).toBe('⇧⇥');
		expect(shortcutLabel('sessionN', false)).toBe('Ctrl+1…9');
	});
});
