import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

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

export function renderMarkdown(text: string): string {
	return marked.parse(text, { async: false }) as string;
}
