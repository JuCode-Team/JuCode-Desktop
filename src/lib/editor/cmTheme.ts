// CodeMirror theme built from the app's CSS custom properties, so the editor
// re-themes automatically when `data-theme` flips (values are var() references,
// resolved live by the browser). Only the `dark` flag needs a reconfigure.

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const uiTheme = (dark: boolean) =>
	EditorView.theme(
		{
			'&': {
				height: '100%',
				fontSize: '12.5px',
				backgroundColor: 'var(--bg)',
				color: 'var(--text)'
			},
			'.cm-scroller': {
				fontFamily: 'var(--font-mono)',
				lineHeight: '1.6'
			},
			'.cm-content': { caretColor: 'var(--accent-bright)' },
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-bright)' },
			'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
				{
					backgroundColor: 'color-mix(in oklab, var(--accent) 24%, transparent) !important'
				},
			'.cm-activeLine': { backgroundColor: 'var(--surface)' },
			'.cm-gutters': {
				backgroundColor: 'var(--bg)',
				color: 'var(--dim2)',
				borderRight: '1px solid var(--hairline)'
			},
			'.cm-activeLineGutter': {
				backgroundColor: 'var(--surface2)',
				color: 'var(--dim)'
			},
			'.cm-searchMatch': {
				backgroundColor: 'color-mix(in oklab, var(--warn) 28%, transparent)',
				outline: '1px solid color-mix(in oklab, var(--warn) 55%, transparent)'
			},
			'.cm-searchMatch.cm-searchMatch-selected': {
				backgroundColor: 'color-mix(in oklab, var(--warn) 45%, transparent)'
			},
			'.cm-selectionMatch': {
				backgroundColor: 'color-mix(in oklab, var(--accent) 14%, transparent)'
			},
			'&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
				backgroundColor: 'color-mix(in oklab, var(--accent) 20%, transparent)',
				outline: 'none'
			},
			'.cm-panels': {
				backgroundColor: 'var(--panel)',
				color: 'var(--text)',
				borderTop: '1px solid var(--hairline)'
			},
			'.cm-panels input, .cm-panels button': {
				fontFamily: 'var(--font-sans)',
				fontSize: '12px',
				color: 'var(--text)',
				background: 'var(--surface2)',
				border: '1px solid var(--border)',
				borderRadius: '6px'
			},
			'.cm-panels button': { cursor: 'pointer' },
			'.cm-tooltip': {
				backgroundColor: 'var(--panel)',
				color: 'var(--text)',
				border: '1px solid var(--border)',
				borderRadius: 'var(--r-sm)',
				boxShadow: 'var(--shadow-pop)'
			},
			'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
				backgroundColor: 'var(--surface2)',
				color: 'var(--text)'
			},
			// diff gutter dots (added / modified) and deletion triangle
			'.cm-diff-gutter': { width: '8px' },
			'.cm-diff-dot': {
				display: 'inline-block',
				width: '6px',
				height: '100%',
				borderRadius: '2px'
			},
			'.cm-diff-dot.added': { background: 'color-mix(in oklab, var(--ok) 70%, transparent)' },
			'.cm-diff-dot.modified': { background: 'color-mix(in oklab, var(--info) 70%, transparent)' },
			'.cm-diff-dot.deleted': {
				width: '0',
				height: '0',
				borderRadius: '0',
				background: 'transparent',
				borderLeft: '6px solid var(--err)',
				borderTop: '4px solid transparent',
				borderBottom: '4px solid transparent'
			},
			// ⌘K in-flight lines
			'.cm-ai-pending': {
				backgroundColor: 'color-mix(in oklab, var(--accent) 10%, transparent)',
				animation: 'cm-ai-pulse 1.4s ease-in-out infinite'
			}
		},
		{ dark }
	);

// Syntax palette from --cm-* tokens (defined in app.css for both themes).
const highlight = HighlightStyle.define([
	{ tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: 'var(--cm-keyword)' },
	{ tag: [t.string, t.special(t.string), t.regexp], color: 'var(--cm-string)' },
	{ tag: [t.number, t.bool, t.null, t.atom], color: 'var(--cm-number)' },
	{ tag: [t.comment, t.blockComment, t.lineComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
	{ tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--cm-function)' },
	{ tag: [t.typeName, t.className, t.namespace], color: 'var(--cm-type)' },
	{ tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--cm-property)' },
	{ tag: [t.tagName, t.angleBracket], color: 'var(--cm-tag)' },
	{ tag: [t.definition(t.variableName), t.local(t.variableName)], color: 'var(--text)' },
	{ tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--cm-punct)' },
	{ tag: [t.meta, t.processingInstruction, t.labelName], color: 'var(--dim)' },
	{ tag: t.heading, color: 'var(--cm-keyword)', fontWeight: '700' },
	{ tag: t.link, color: 'var(--cm-function)', textDecoration: 'underline' },
	{ tag: t.emphasis, fontStyle: 'italic' },
	{ tag: t.strong, fontWeight: '700' },
	{ tag: t.strikethrough, textDecoration: 'line-through' },
	{ tag: t.invalid, color: 'var(--err)' }
]);

export function editorTheme(dark: boolean): Extension {
	return [uiTheme(dark), syntaxHighlighting(highlight)];
}
