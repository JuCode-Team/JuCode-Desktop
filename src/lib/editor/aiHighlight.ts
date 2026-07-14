// Subtle line highlight for the range a ⌘K AI edit is pending on. EditorPane
// dispatches `setAiRange` with 1-based line numbers (null clears).

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';

export const setAiRange = StateEffect.define<{ fromLine: number; toLine: number } | null>();

const lineDeco = Decoration.line({ class: 'cm-ai-pending' });

const aiField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setAiRange)) {
				if (!e.value) {
					deco = Decoration.none;
				} else {
					const b = new RangeSetBuilder<Decoration>();
					const from = Math.max(1, e.value.fromLine);
					const to = Math.min(tr.newDoc.lines, e.value.toLine);
					for (let l = from; l <= to; l++) {
						const line = tr.newDoc.line(l);
						b.add(line.from, line.from, lineDeco);
					}
					deco = b.finish();
				}
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});

export function aiHighlight(): Extension {
	return [aiField];
}
