// Language resolution for the editor: common languages are bundled eagerly;
// everything else lazy-loads through @codemirror/language-data descriptions.

import type { LanguageSupport } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

export interface ResolvedLanguage {
	label: string;
	support: LanguageSupport | null;
}

const EAGER: Record<string, () => ResolvedLanguage> = {
	js: () => ({ label: 'JavaScript', support: javascript() }),
	mjs: () => ({ label: 'JavaScript', support: javascript() }),
	cjs: () => ({ label: 'JavaScript', support: javascript() }),
	jsx: () => ({ label: 'JSX', support: javascript({ jsx: true }) }),
	ts: () => ({ label: 'TypeScript', support: javascript({ typescript: true }) }),
	mts: () => ({ label: 'TypeScript', support: javascript({ typescript: true }) }),
	tsx: () => ({ label: 'TSX', support: javascript({ typescript: true, jsx: true }) }),
	json: () => ({ label: 'JSON', support: json() }),
	html: () => ({ label: 'HTML', support: html() }),
	htm: () => ({ label: 'HTML', support: html() }),
	// Svelte/Vue SFCs are close enough to HTML for highlighting purposes.
	svelte: () => ({ label: 'Svelte', support: html() }),
	vue: () => ({ label: 'Vue', support: html() }),
	css: () => ({ label: 'CSS', support: css() }),
	py: () => ({ label: 'Python', support: python() }),
	rs: () => ({ label: 'Rust', support: rust() }),
	md: () => ({ label: 'Markdown', support: markdown() }),
	markdown: () => ({ label: 'Markdown', support: markdown() })
};

/** Resolve editor language support for a filename (eager map, then lazy
 *  language-data lookup). Never rejects — unknown types get plain text. */
export async function languageFor(filename: string): Promise<ResolvedLanguage> {
	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	const eager = EAGER[ext];
	if (eager) return eager();
	const desc =
		languages.find((d) => d.extensions.includes(ext)) ??
		languages.find((d) => d.filename?.test(filename));
	if (desc) {
		try {
			return { label: desc.name, support: await desc.load() };
		} catch {
			return { label: desc.name, support: null };
		}
	}
	return { label: ext ? ext.toUpperCase() : 'Plain', support: null };
}
