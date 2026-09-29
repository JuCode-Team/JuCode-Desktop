// Pure logic behind the composer tray (ComposerTray.svelte): keyboard
// navigation over a flat row list, and the stepped AskUserQuestion flow.
import type { Question } from '$lib/approval';

export type TrayNav = { kind: 'move'; index: number } | { kind: 'pick' } | { kind: 'close' } | null;

/** What Tab does in the current tray mode: complete (slash), close (+), or nothing. */
export type TrayTab = 'pick' | 'close' | 'none';

/**
 * Map a key to a tray action. `disabled[i]` rows are skipped by movement.
 * Up/Down wrap; Home/End jump to the first/last enabled row. Returns null for
 * keys the tray doesn't own (they fall through to the editor).
 */
export function trayNav(key: string, index: number, disabled: boolean[], tab: TrayTab = 'none'): TrayNav {
	const n = disabled.length;
	const enabled = (i: number) => i >= 0 && i < n && !disabled[i];
	// First enabled row walking `step` from `from`, wrapping around once.
	const scan = (from: number, step: 1 | -1) => {
		for (let k = 0; k < n; k++) {
			const i = (((from + k * step) % n) + n) % n;
			if (enabled(i)) return i;
		}
		return -1;
	};
	const move = (i: number): TrayNav => (i < 0 ? null : { kind: 'move', index: i });
	switch (key) {
		case 'ArrowDown':
			return n ? move(scan(index + 1, 1)) : null;
		case 'ArrowUp':
			return n ? move(scan(index - 1, -1)) : null;
		case 'Home':
			return n ? move(scan(0, 1)) : null;
		case 'End':
			return n ? move(scan(n - 1, -1)) : null;
		case 'Enter':
			return enabled(index) ? { kind: 'pick' } : null;
		case 'Escape':
			return { kind: 'close' };
		case 'Tab':
			if (tab === 'close') return { kind: 'close' };
			if (tab === 'pick') return enabled(index) ? { kind: 'pick' } : null;
			return null;
		default:
			return null;
	}
}

/** Toggle one label in a multi-select pick list (keeps pick order). */
export function togglePick(picks: string[], label: string): string[] {
	return picks.includes(label) ? picks.filter((l) => l !== label) : [...picks, label];
}

export interface QuestionFlow {
	/** Index of the question currently shown. */
	step: number;
	/** Answers so far, keyed by the full question text (the engine's shape). */
	answers: Record<string, string>;
}

export const startFlow = (): QuestionFlow => ({ step: 0, answers: {} });

/**
 * Record `value` as the answer to the current question and advance. `done`
 * is true once every question has an answer; `answers` is then ready for
 * `{ op: 'approve', decision: 'allow', answers }`.
 */
export function answerStep(
	questions: Question[],
	flow: QuestionFlow,
	value: string
): { flow: QuestionFlow; done: boolean } {
	const q = questions[flow.step];
	if (!q) return { flow, done: flow.step >= questions.length };
	const answers = { ...flow.answers, [q.question]: value };
	const step = flow.step + 1;
	return { flow: { step, answers }, done: step >= questions.length };
}
