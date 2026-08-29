import { describe, it, expect } from 'vitest';
import { BUILTIN_ICONS, isEmojiSlug, normalizeColor, parseTabIcon, sanitizeSvg } from './tabChrome';

const PATH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff"><path d="M4 4 L20 20"/></svg>';

describe('sanitizeSvg', () => {
	it('accepts a simple path svg', () => {
		expect(sanitizeSvg(PATH_SVG)).toBe(PATH_SVG);
		expect(sanitizeSvg(`  ${PATH_SVG}  `)).toBe(PATH_SVG);
	});

	it('accepts shapes, groups and a title', () => {
		const svg =
			'<svg viewBox="0 0 10 10"><title>ok</title><g stroke="red"><circle cx="5" cy="5" r="4"/><rect x="1" y="1" width="2" height="2"/><polyline points="1,2 3,4"/></g></svg>';
		expect(sanitizeSvg(svg)).toBe(svg);
	});

	it('rejects script and other executable elements', () => {
		expect(sanitizeSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><foreignObject></foreignObject></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><iframe></iframe></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><animate attributeName="x"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><set attributeName="x"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><use href="#x"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><image href="http://x"/></svg>')).toBeNull();
	});

	it('rejects event handlers and dangerous attribute values', () => {
		expect(sanitizeSvg('<svg onload="alert(1)"><path d="M0 0"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><path d="M0 0" onclick="x()"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><path fill="javascript:alert(1)"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><path fill="data:text/html,x"/></svg>')).toBeNull();
		expect(sanitizeSvg('<svg><path href="#x" d="M0 0"/></svg>')).toBeNull();
	});

	it('rejects non-svg roots, comments and oversized markup', () => {
		expect(sanitizeSvg('<div>hi</div>')).toBeNull();
		expect(sanitizeSvg('<svg><!-- sneaky --><path d="M0 0"/></svg>')).toBeNull();
		expect(sanitizeSvg(`<svg><path d="M${'0 '.repeat(5000)}"/></svg>`)).toBeNull();
		expect(sanitizeSvg('')).toBeNull();
	});
});

describe('parseTabIcon', () => {
	it('accepts a known builtin id and rejects unknown ones', () => {
		expect(parseTabIcon({ kind: 'builtin', id: 'rocket' })).toEqual({ kind: 'builtin', id: 'rocket' });
		expect(parseTabIcon({ kind: 'builtin', id: 'not-an-icon' })).toBeUndefined();
		expect(BUILTIN_ICONS).toContain('rocket');
	});

	it('trims slugs and caps their length', () => {
		expect(parseTabIcon({ kind: 'slug', value: '  🚀  ' })).toEqual({ kind: 'slug', value: '🚀' });
		expect(parseTabIcon({ kind: 'slug', value: '   ' })).toBeUndefined();
		expect(parseTabIcon({ kind: 'slug', value: 'x'.repeat(33) })).toBeUndefined();
		expect(parseTabIcon({ kind: 'slug', value: 'x'.repeat(32) })).toEqual({ kind: 'slug', value: 'x'.repeat(32) });
	});

	it('sanitizes svg icons and rejects dirty markup', () => {
		expect(parseTabIcon({ kind: 'svg', markup: PATH_SVG })).toEqual({ kind: 'svg', markup: PATH_SVG });
		expect(parseTabIcon({ kind: 'svg', markup: '<svg><script>x</script></svg>' })).toBeUndefined();
	});

	it('rejects garbage shapes', () => {
		expect(parseTabIcon(null)).toBeUndefined();
		expect(parseTabIcon('rocket')).toBeUndefined();
		expect(parseTabIcon({ kind: 'nope' })).toBeUndefined();
	});
});

describe('normalizeColor', () => {
	it('accepts #rgb and #rrggbb, lowercased', () => {
		expect(normalizeColor('#ABC')).toBe('#abc');
		expect(normalizeColor(' #2563eb ')).toBe('#2563eb');
	});
	it('rejects everything else', () => {
		expect(normalizeColor('red')).toBeUndefined();
		expect(normalizeColor('#12345')).toBeUndefined();
		expect(normalizeColor('rgb(1,2,3)')).toBeUndefined();
		expect(normalizeColor(42)).toBeUndefined();
	});
});

describe('isEmojiSlug', () => {
	it('treats short non-ascii slugs as text', () => {
		expect(isEmojiSlug('🚀')).toBe(true);
		expect(isEmojiSlug('👩‍💻')).toBe(true);
		expect(isEmojiSlug('火')).toBe(true);
	});
	it('ascii names and long strings are not emoji', () => {
		expect(isEmojiSlug('rocket')).toBe(false);
		expect(isEmojiSlug('')).toBe(false);
		expect(isEmojiSlug('这是一个很长的中文说明文字啊')).toBe(false);
	});
});
