<script lang="ts" module>
	// Rendered HTML by source text: a row windowed back in on the way up
	// renders again, and parsing (code, math) is the costly part of that.
	const rendered = new Map<string, string>();
	const RENDERED_MAX = 400;
</script>

<script lang="ts">
	import DOMPurify from 'dompurify';
	import 'katex/dist/katex.min.css';
	import { openExternal } from '$lib/openExternal';
	import { renderMarkdown } from '$lib/markdown';
	import { getLocale, t } from '$lib/i18n';
	import { useFileCheck } from '$lib/fileCheck';
	import { renderMermaid } from '$lib/mermaid';
	import { themeState } from '$lib/theme.svelte';

	let { text, onFile }: { text: string; onFile?: (href: string) => void } = $props();

	const html = $derived.by(() => {
		// The code blocks' copy button is in the interface language.
		const key = `${getLocale()}\n${text}`;
		let out = rendered.get(key);
		if (out === undefined) {
			out = DOMPurify.sanitize(renderMarkdown(text));
			if (rendered.size >= RENDERED_MAX) rendered.delete(rendered.keys().next().value!);
			rendered.set(key, out);
		}
		return out;
	});

	// File links whose path names no file read as plain text (where the
	// conversation provides the check, fileCheck.ts).
	const fileCheck = useFileCheck();
	let root = $state<HTMLDivElement>();
	$effect(() => {
		void html;
		if (!fileCheck || !root) return;
		for (const a of root.querySelectorAll<HTMLAnchorElement>('a.fileref')) {
			const href = a.getAttribute('href');
			if (!href) continue;
			const known = fileCheck.known(href);
			if (known !== undefined) a.classList.toggle('dead', !known);
			else fileCheck.check(href).then((ok) => a.classList.toggle('dead', !ok));
		}
	});

	// A ```mermaid block shows its diagram; its source stays in the <pre>
	// (hidden) for the copy button, and shows when it doesn't parse.
	$effect(() => {
		void html;
		// Redrawn in the colours of a theme change (revision: every apply).
		void themeState.revision;
		const dark = themeState.value === 'dark';
		if (!root) return;
		for (const code of root.querySelectorAll<HTMLElement>('.codeblock code.language-mermaid')) {
			const block = code.closest<HTMLElement>('.codeblock')!;
			renderMermaid(code.textContent ?? '', dark).then((svg) => {
				if (!svg || !block.isConnected) return;
				let view = block.querySelector<HTMLElement>('.mermaid-view');
				if (!view) {
					view = document.createElement('div');
					view.className = 'mermaid-view';
					block.append(view);
				}
				view.innerHTML = svg;
				block.classList.add('diagram');
			});
		}
	});

	// Only hand a link to the system opener if it carries an explicit, allowed
	// scheme. The test is anchored and case-insensitive so tricks like
	// "JavaScript:" or " javascript:" (already trimmed by the browser) can't slip
	// through. Relative/schemeless hrefs return false — nothing is opened.
	function isSafeExternalHref(href: string): boolean {
		return /^(https?|mailto):/i.test(href.trim());
	}

	function onClick(e: MouseEvent) {
		const el = e.target as HTMLElement;
		const copy = el.closest('.cb-copy');
		if (copy) {
			e.preventDefault();
			const pre = copy.closest('.codeblock')?.querySelector('pre');
			const code = pre?.textContent ?? '';
			navigator.clipboard?.writeText(code).catch(() => {});
			const btn = copy as HTMLButtonElement;
			btn.textContent = t('common.copied');
			setTimeout(() => (btn.textContent = t('common.copy')), 1400);
			return;
		}
		const a = el.closest('a');
		const href = a?.getAttribute('href');
		if (a?.classList.contains('dead')) return void e.preventDefault();
		if (href) {
			// Always stop the webview from navigating to a markdown link (it's
			// LLM/file-supplied). Safe external schemes go to the system opener;
			// in-page anchors are ignored; anything else is treated as a workspace
			// file path and handed to the host to open (editor / built-in browser).
			e.preventDefault();
			if (isSafeExternalHref(href)) openExternal(href);
			else if (!href.startsWith('#')) onFile?.(href);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" bind:this={root} onclick={onClick}>{@html html}</div>

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
		font-weight: 600;
		line-height: 1.3;
		margin: 18px 0 8px;
	}
	.md :global(h1),
	.md :global(h2) {
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.md :global(h1) {
		font-size: 1.55em;
	}
	.md :global(h2) {
		font-size: 1.35em;
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
		color: var(--brand-bright);
		text-decoration: none;
	}
	.md :global(a:hover) {
		text-decoration: underline;
	}
	/* A file the reply names: mono like code, the link colour, opened in the
	   editor (at its line) on click. */
	.md :global(a.fileref) {
		font-family: var(--font-mono);
		font-size: 0.88em;
		text-decoration: underline;
		text-decoration-color: color-mix(in oklab, var(--brand-bright) 40%, transparent);
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
	}
	.md :global(a.fileref:hover) {
		text-decoration-color: currentColor;
	}
	.md :global(a.fileref code) {
		font-size: 1em;
		color: inherit;
	}
	/* Its file type's icon, ahead of the name. */
	.md :global(a.fileref .fi) {
		width: 1.15em;
		height: 1.15em;
		margin-right: 0.3em;
		vertical-align: -0.2em;
	}
	:global(:root[data-theme='light']) .md :global(a.fileref .fi-dark),
	:global(:root:not([data-theme='light'])) .md :global(a.fileref .fi-light) {
		display: none;
	}
	/* Names no file: plain text (inline code stays code). */
	.md :global(a.fileref.dead) {
		color: inherit;
		text-decoration: none;
		cursor: text;
	}
	.md :global(a.fileref.dead .fi) {
		display: none;
	}
	.md :global(.cb-head .fileref) {
		margin: 0 auto 0 10px;
		font-size: var(--fs-2xs);
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
		border-radius: var(--r-code);
		padding: 1px 5px;
	}
	.md :global(pre) {
		margin: 0 0 12px;
		padding: 12px 14px;
		background: var(--surface);
		border-radius: var(--r);
		overflow-x: auto;
	}
	.md :global(pre code) {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--fs-sm);
		line-height: 1.55;
	}
	.md :global(.codeblock) {
		margin: 0 0 12px;
		border-radius: var(--r);
		overflow: hidden;
		background: var(--surface);
	}
	.md :global(.codeblock pre) {
		margin: 0;
		border: none;
		border-radius: 0;
		background: none;
	}
	.md :global(.codeblock.diagram pre) {
		display: none;
	}
	.md :global(.mermaid-view) {
		display: flex;
		justify-content: center;
		padding: 14px;
		overflow-x: auto;
	}
	.md :global(.mermaid-view svg) {
		max-width: 100%;
		height: auto;
	}
	.md :global(.cb-head) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px 4px 12px;
		border-bottom: 1px solid var(--hairline);
		background: var(--surface2);
	}
	.md :global(.cb-lang) {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.md :global(.cb-copy) {
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-2xs);
		cursor: pointer;
		padding: 2px 7px;
		border-radius: var(--r);
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.md :global(.cb-copy:hover) {
		background: var(--panel);
		color: var(--text);
	}
	/* Tables: compact cells on hairlines, a tinted header, zebra rows; a wide
	   one scrolls sideways in its own box (markdown.ts wraps it). */
	.md :global(.table-wrap) {
		max-width: 100%;
		margin: 0 0 12px;
		overflow-x: auto;
		border-radius: var(--r);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.md :global(table) {
		width: max-content;
		min-width: 100%;
		border-collapse: collapse;
		font-size: 0.92em;
		line-height: 1.45;
		font-variant-numeric: tabular-nums;
	}
	.md :global(th),
	.md :global(td) {
		padding: 6px 12px;
		border: none;
		border-bottom: 1px solid var(--hairline);
		text-align: left;
		vertical-align: top;
	}
	.md :global(th[align='center']),
	.md :global(td[align='center']) {
		text-align: center;
	}
	.md :global(th[align='right']),
	.md :global(td[align='right']) {
		text-align: right;
	}
	.md :global(th) {
		background: var(--surface2);
		font-weight: 600;
		white-space: nowrap;
	}
	.md :global(tbody tr:nth-child(even)) {
		background: var(--surface);
	}
	.md :global(tbody tr:last-child td) {
		border-bottom: none;
	}
	.md :global(td code) {
		white-space: nowrap;
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
