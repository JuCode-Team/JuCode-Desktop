import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from '$lib/hljs';
import { t } from '$lib/i18n';
import { codeFileRef, fileHref, splitFileRefs, type FileRef } from '$lib/fileRefs';

// One configured instance for the whole app. Configuring the shared `marked`
// singleton from each <Markdown> instance stacks the highlight extension and
// makes code blocks get highlighted (and escaped) more than once.
const marked = new Marked(
	markedHighlight({
		langPrefix: 'hljs language-',
		highlight(code, info) {
			// The info string may go on to name the file ("rust src/a.rs", "ts:src/a.ts").
			const lang = (info || '').split(/[\s:]/)[0];
			const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
			try {
				return hljs.highlight(code, { language }).value;
			} catch {
				return code;
			}
		}
	})
);
marked.setOptions({ breaks: true, gfm: true });

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/** A file reference as a link the chat opens in the editor (see <Markdown>). */
function fileLink(ref: FileRef, inner: string): string {
	const where = ref.line ? `:${ref.line}${ref.col ? `:${ref.col}` : ''}` : '';
	return `<a class="fileref" href="${escapeAttr(fileHref(ref))}" title="${escapeAttr(ref.path + where)}">${inner}</a>`;
}

// Wrap fenced code in a header (language label + copy button). The copy is wired
// by <Markdown> via event delegation, reading the <pre>'s text content.
marked.use({
	renderer: {
		code(token: { text: string; lang?: string; escaped?: boolean }) {
			// The info string may name the file: "ts src/a.ts" or "ts:src/a.ts".
			const info = (token.lang || '').trim();
			const [head, ...rest] = info.split(/\s+/);
			const [langPart, pathPart] = head.includes(':') && head.includes('/') ? head.split(/:(.*)/s) : [head, rest[0]];
			const lang = langPart ?? '';
			const named = pathPart ? codeFileRef(pathPart) : null;
			const body = token.escaped ? token.text : escapeHtml(token.text);
			const langCls = lang ? ` language-${escapeAttr(lang)}` : '';
			return (
				`<div class="codeblock"><div class="cb-head">` +
				`<span class="cb-lang">${escapeHtml(lang)}</span>` +
				(named ? fileLink(named, escapeHtml(pathPart!)) : '') +
				`<button class="cb-copy" type="button">${escapeHtml(t('common.copy'))}</button></div>` +
				`<pre><code class="hljs${langCls}">${body}</code></pre></div>`
			);
		},
		// Inline code that is all one file path opens it.
		codespan(token: { text: string }) {
			const code = `<code>${escapeHtml(token.text)}</code>`;
			const ref = codeFileRef(token.text);
			return ref ? fileLink(ref, code) : code;
		}
	},
	extensions: [
		{
			name: 'fileref',
			level: 'inline',
			renderer(token) {
				const ref = token as unknown as FileRef & { raw: string };
				return fileLink(ref, escapeHtml(ref.raw));
			}
		}
	]
});

type Tok = { type: string; raw?: string; text?: string; tokens?: Tok[]; items?: Tok[]; header?: Tok[]; rows?: Tok[][] };

/** Prose tokens with their file paths split out as `fileref` tokens.
 *  Links, code and HTML keep their text. */
function linkFiles(tokens: Tok[]): Tok[] {
	const out: Tok[] = [];
	for (const token of tokens) {
		if (token.type === 'text' && !token.tokens && token.text) {
			for (const part of splitFileRefs(token.text)) {
				out.push(
					typeof part === 'string'
						? { type: 'text', raw: part, text: part }
						: ({ ...part, type: 'fileref', raw: part.text } as unknown as Tok)
				);
			}
			continue;
		}
		if (!['link', 'image', 'code', 'codespan', 'html'].includes(token.type)) {
			if (token.tokens) token.tokens = linkFiles(token.tokens);
			if (token.items) token.items = linkFiles(token.items);
			for (const cell of [...(token.header ?? []), ...(token.rows ?? []).flat()]) {
				if (cell.tokens) cell.tokens = linkFiles(cell.tokens);
			}
		}
		out.push(token);
	}
	return out;
}

// Before the highlight extension walks the tokens: file paths in prose
// become `fileref` tokens.
marked.use({
	hooks: {
		processAllTokens(tokens) {
			return linkFiles(tokens as unknown as Tok[]) as never;
		}
	}
});

export function renderMarkdown(text: string): string {
	// A table scrolls sideways in its own box when it is wider than the column.
	return (marked.parse(text, { async: false }) as string)
		.replace(/<table>/g, '<div class="table-wrap"><table>')
		.replace(/<\/table>/g, '</table></div>');
}
