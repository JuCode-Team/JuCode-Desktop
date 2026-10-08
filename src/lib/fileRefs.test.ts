import { describe, it, expect } from 'vitest';
import { codeFileRef, fileHref, isAbsolutePath, joinPath, parseFileHref, pathExt, splitFileRefs } from './fileRefs';

const refs = (text: string) => splitFileRefs(text).filter((p) => typeof p !== 'string');

describe('file references', () => {
	it('finds paths with a directory in prose, with their line and column', () => {
		expect(refs('See src/lib/a.ts:12 and crates/x.rs:3:4, then ./README.md.')).toEqual([
			{ path: 'src/lib/a.ts', line: 12, text: 'src/lib/a.ts:12' },
			{ path: 'crates/x.rs', line: 3, col: 4, text: 'crates/x.rs:3:4' },
			{ path: './README.md', text: './README.md' }
		]);
		expect(refs('改了（src/main.rs#L40）和 /Users/me/p/app.py。')).toEqual([
			{ path: 'src/main.rs', line: 40, text: 'src/main.rs#L40' },
			{ path: '/Users/me/p/app.py', text: '/Users/me/p/app.py' }
		]);
	});

	it('leaves prose that only looks like a path alone', () => {
		for (const text of ['Node.js and Vue.js', 'and/or TCP/IP', 'v0.4.7 shipped', 'see example.com/docs/index.html', 'e.g. this', 'src/lib is a folder']) {
			expect(refs(text)).toEqual([]);
		}
		// The text around a reference is kept as it was.
		expect(splitFileRefs('a src/x.ts b').join('|')).toContain('a ');
	});

	it('reads a whole inline code span, bare known files included', () => {
		expect(codeFileRef('Cargo.toml')).toEqual({ path: 'Cargo.toml' });
		expect(codeFileRef('src/app.svelte:7')).toEqual({ path: 'src/app.svelte', line: 7 });
		expect(codeFileRef('foo()')).toBeNull();
		expect(codeFileRef('npm run build')).toBeNull();
		expect(codeFileRef('config.local')).toBeNull();
	});

	it('round-trips a reference through its link target', () => {
		const ref = { path: 'src/a.ts', line: 12, col: 4 };
		expect(parseFileHref(fileHref(ref))).toEqual(ref);
		expect(parseFileHref('file:///abs/b.rs?x=1#L3C2')).toEqual({ path: '/abs/b.rs', line: 3, col: 2 });
		expect(parseFileHref('docs/c.md')).toEqual({ path: 'docs/c.md' });
	});

	it('reads the links marked percent-encodes, Windows paths included', () => {
		expect(parseFileHref('/Users/me/%E9%B9%88%E9%B9%95.html')).toEqual({ path: '/Users/me/鹈鹕.html' });
		expect(parseFileHref('C:%5CUsers%5Cme%5Ca.html#L3')).toEqual({ path: 'C:\\Users\\me\\a.html', line: 3 });
		expect(parseFileHref('file:///C:/Users/me/a.html')).toEqual({ path: 'C:/Users/me/a.html' });
		expect(parseFileHref('docs/100%.md')).toEqual({ path: 'docs/100%.md' });
	});

	it('joins and reads paths with either separator', () => {
		for (const p of ['/abs/a.ts', 'C:\\p\\a.ts', 'c:/p/a.ts', '\\\\server\\share\\a.ts']) {
			expect(isAbsolutePath(p)).toBe(true);
			expect(joinPath('C:\\proj', p)).toBe(p);
		}
		expect(isAbsolutePath('src/a.ts')).toBe(false);
		expect(joinPath('C:\\proj\\', './src/a.ts')).toBe('C:\\proj/src/a.ts');
		expect(joinPath('/proj/', 'src/a.ts')).toBe('/proj/src/a.ts');
		expect(joinPath('', 'src/a.ts')).toBe('src/a.ts');
		expect(pathExt('C:\\p\\site.v2\\Index.HTML')).toBe('html');
		expect(pathExt('C:\\p.d\\README')).toBe('');
		expect(pathExt('/p/.env')).toBe('');
	});
});
