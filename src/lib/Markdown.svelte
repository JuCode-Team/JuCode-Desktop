<script lang="ts">
	import { marked } from 'marked';
	import { markedHighlight } from 'marked-highlight';
	import hljs from 'highlight.js';
	import DOMPurify from 'dompurify';
	import { openUrl } from '@tauri-apps/plugin-opener';

	let { text }: { text: string } = $props();

	marked.use(
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

	const html = $derived(DOMPurify.sanitize(marked.parse(text, { async: false }) as string));

	function onClick(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a');
		if (a && a.getAttribute('href')) {
			e.preventDefault();
			openUrl(a.getAttribute('href')!).catch(() => {});
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" onclick={onClick}>{@html html}</div>

<style>
	.md {
		line-height: 1.65;
		word-break: break-word;
	}
	.md :global(p) {
		margin: 0 0 10px;
	}
	.md :global(*:last-child) {
		margin-bottom: 0;
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4) {
		font-family: var(--font-display);
		font-weight: 700;
		line-height: 1.3;
		margin: 18px 0 8px;
	}
	.md :global(h1) {
		font-size: 1.4em;
	}
	.md :global(h2) {
		font-size: 1.25em;
	}
	.md :global(h3) {
		font-size: 1.1em;
	}
	.md :global(ul),
	.md :global(ol) {
		margin: 0 0 10px;
		padding-left: 22px;
	}
	.md :global(li) {
		margin: 3px 0;
	}
	.md :global(a) {
		color: var(--accent-bright);
		text-decoration: none;
	}
	.md :global(a:hover) {
		text-decoration: underline;
	}
	.md :global(strong) {
		font-weight: 700;
	}
	.md :global(blockquote) {
		margin: 0 0 10px;
		padding: 2px 0 2px 12px;
		border-left: 2px solid var(--border);
		color: var(--dim);
	}
	.md :global(hr) {
		border: none;
		border-top: 1px solid var(--hairline);
		margin: 16px 0;
	}
	.md :global(code) {
		font-family: var(--font-mono);
		font-size: 0.88em;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 5px;
		padding: 1px 5px;
	}
	.md :global(pre) {
		margin: 0 0 12px;
		padding: 12px 14px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		overflow-x: auto;
	}
	.md :global(pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: 12.5px;
		line-height: 1.55;
	}
	.md :global(table) {
		border-collapse: collapse;
		margin: 0 0 12px;
		font-size: 0.95em;
	}
	.md :global(th),
	.md :global(td) {
		border: 1px solid var(--hairline);
		padding: 5px 10px;
		text-align: left;
	}
	.md :global(th) {
		background: var(--surface2);
	}

	/* highlight.js tokens mapped to design tokens (adapt to light/dark) */
	.md :global(.hljs-comment),
	.md :global(.hljs-quote) {
		color: var(--dim2);
		font-style: italic;
	}
	.md :global(.hljs-keyword),
	.md :global(.hljs-selector-tag),
	.md :global(.hljs-built_in),
	.md :global(.hljs-name),
	.md :global(.hljs-tag) {
		color: var(--accent-bright);
	}
	.md :global(.hljs-string),
	.md :global(.hljs-attr),
	.md :global(.hljs-symbol),
	.md :global(.hljs-bullet),
	.md :global(.hljs-addition) {
		color: var(--ok);
	}
	.md :global(.hljs-number),
	.md :global(.hljs-literal),
	.md :global(.hljs-regexp) {
		color: var(--warn);
	}
	.md :global(.hljs-title),
	.md :global(.hljs-section),
	.md :global(.hljs-type),
	.md :global(.hljs-class .hljs-title) {
		color: var(--info);
	}
	.md :global(.hljs-attribute),
	.md :global(.hljs-variable),
	.md :global(.hljs-template-variable) {
		color: var(--text);
	}
	.md :global(.hljs-meta) {
		color: var(--dim);
	}
	.md :global(.hljs-deletion) {
		color: var(--err);
	}
</style>
