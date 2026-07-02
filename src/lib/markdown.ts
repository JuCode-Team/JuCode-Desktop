import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { t } from '$lib/i18n';

// One configured instance for the whole app. Configuring the shared `marked`
// singleton from each <Markdown> instance stacks the highlight extension and
// makes code blocks get highlighted (and escaped) more than once.
const marked = new Marked(
	markedHighlight({
		langPrefix: 'hljs language-',
		highlight(code, lang) {
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

// Wrap fenced code in a header (language label + copy button). The copy is wired
// by <Markdown> via event delegation, reading the <pre>'s text content.
marked.use({
	renderer: {
		code(token: { text: string; lang?: string; escaped?: boolean }) {
			const lang = (token.lang || '').match(/\S*/)?.[0] ?? '';
			const body = token.escaped ? token.text : escapeHtml(token.text);
			const langCls = lang ? ` language-${lang}` : '';
			return (
				`<div class="codeblock"><div class="cb-head">` +
				`<span class="cb-lang">${escapeHtml(lang)}</span>` +
				`<button class="cb-copy" type="button">${escapeHtml(t('common.copy'))}</button></div>` +
				`<pre><code class="hljs${langCls}">${body}</code></pre></div>`
			);
		}
	}
});

export function renderMarkdown(text: string): string {
	return marked.parse(text, { async: false }) as string;
}
