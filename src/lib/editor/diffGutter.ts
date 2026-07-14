// Git-HEAD diff gutter: EditorPane computes GutterMarks (lineDiff.ts) and
// dispatches them via `setDiffMarks`; the field maps them through document
// changes between recomputes so dots don't jump while typing.

import { gutter, GutterMarker } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, RangeSetBuilder, type Extension } from '@codemirror/state';
import type { GutterMark } from './lineDiff';

export const setDiffMarks = StateEffect.define<GutterMark[]>();

class DiffMarker extends GutterMarker {
	constructor(readonly type: string) {
		super();
	}
	eq(other: DiffMarker) {
		return this.type === other.type;
	}
	toDOM() {
		const el = document.createElement('span');
		el.className = `cm-diff-dot ${this.type}`;
		return el;
	}
}

const MARKERS: Record<string, DiffMarker> = {
	added: new DiffMarker('added'),
	modified: new DiffMarker('modified'),
	deleted: new DiffMarker('deleted')
};

const diffField = StateField.define<RangeSet<GutterMarker>>({
	create: () => RangeSet.empty,
	update(set, tr) {
		set = set.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setDiffMarks)) {
				const marks = [...e.value].sort((a, b) => a.line - b.line);
				const b = new RangeSetBuilder<GutterMarker>();
				for (const m of marks) {
					if (m.line < 0 || m.line >= tr.newDoc.lines) continue;
					const line = tr.newDoc.line(m.line + 1);
					b.add(line.from, line.from, MARKERS[m.type]);
				}
				set = b.finish();
			}
		}
		return set;
	}
});

export function diffGutter(): Extension {
	return [
		diffField,
		gutter({
			class: 'cm-diff-gutter',
			markers: (view) => view.state.field(diffField)
		})
	];
}
