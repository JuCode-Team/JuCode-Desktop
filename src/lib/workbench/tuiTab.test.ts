import { describe, expect, it } from 'vitest';
import { tuiBackendOf, tuiPanelKind, tuiTabTitle } from './tuiTab';

describe('tui tab kinds', () => {
	it('round-trips every backend through the panel kind', () => {
		for (const b of ['jucode', 'codex', 'claude'] as const) {
			expect(tuiBackendOf(tuiPanelKind(b))).toBe(b);
		}
	});

	it('kind strings are stable (persisted in layouts)', () => {
		expect(tuiPanelKind('jucode')).toBe('tui:jucode');
	});

	it('non-tui and malformed kinds map to null', () => {
		for (const k of ['term', 'browser', 'tui', 'tui:', 'tui:bash', 'tui:jucode:x', 'TUI:jucode']) {
			expect(tuiBackendOf(k)).toBeNull();
		}
	});

	it('titles read as "TUI · <cli>"', () => {
		expect(tuiTabTitle('jucode')).toBe('TUI · jucode');
		expect(tuiTabTitle('claude')).toBe('TUI · claude');
	});
});
