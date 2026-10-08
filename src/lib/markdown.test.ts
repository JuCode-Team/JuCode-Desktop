import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown file references', () => {
	it('links file paths in prose, lists and inline code', () => {
		const html = renderMarkdown('Changed src/lib/a.ts:12 and `Cargo.toml`.\n\n- see crates/x.rs:3:4');
		expect(html).toContain('<a class="fileref" href="src/lib/a.ts#L12" title="src/lib/a.ts:12">src/lib/a.ts:12</a>');
		expect(html).toContain('<a class="fileref" href="Cargo.toml" title="Cargo.toml"><code>Cargo.toml</code></a>');
		expect(html).toContain('href="crates/x.rs#L3:4"');
	});

	it('leaves links, code blocks and look-alikes as they were', () => {
		const html = renderMarkdown('[docs](src/a.md) https://x.com/a/b.html `npm i` Node.js\n\n```\nsrc/b.ts\n```');
		expect(html).not.toContain('fileref');
		expect(html).toContain('<code>npm i</code>');
	});

	it('names a code block’s file in its header', () => {
		const html = renderMarkdown('```ts src/app.ts\nlet a = 1;\n```');
		expect(html).toContain('<span class="cb-lang">ts</span><a class="fileref" href="src/app.ts"');
		// …and is still highlighted as its language.
		expect(html).toContain('<span class="hljs-keyword">let</span>');
		expect(renderMarkdown('```rust:src/a.rs\nfn main() {}\n```')).toContain('<span class="hljs-keyword">fn</span>');
	});

	it('escapes what it links', () => {
		const html = renderMarkdown('`a<b>.ts` and x/"y".ts');
		expect(html).not.toContain('<b>');
	});
});

describe('renderMarkdown tables', () => {
	it('wraps a table so a wide one scrolls in its own box', () => {
		const html = renderMarkdown('| 项 | 状态 |\n| --- | :-: |\n| 解析 | ✅ |\n| 渲染 | ⏳ |');
		expect(html.startsWith('<div class="table-wrap"><table>')).toBe(true);
		expect(html.trim().endsWith('</table></div>')).toBe(true);
		expect(html).toContain('<th align="center">状态</th>');
		expect(html.match(/<tr>/g)).toHaveLength(3);
	});
});
