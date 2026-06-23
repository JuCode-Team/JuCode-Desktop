import { describe, it, expect } from 'vitest';
import { buildEntries, fuzzyScore, mentionMatches } from './mention';

const FILES = [
	'src/lib/Composer.svelte',
	'src/lib/ui/Button.svelte',
	'src/routes/+page.svelte',
	'README.md',
	'src/lib/chat.svelte.ts'
];

describe('buildEntries', () => {
	it('derives every parent folder, deduped', () => {
		const entries = buildEntries(FILES);
		const dirs = entries.filter((e) => e.dir).map((e) => e.path).sort();
		expect(dirs).toEqual(['src', 'src/lib', 'src/lib/ui', 'src/routes']);
		expect(entries.filter((e) => !e.dir)).toHaveLength(FILES.length);
	});

	it('handles an empty list', () => {
		expect(buildEntries([])).toEqual([]);
	});
});

describe('fuzzyScore', () => {
	it('returns 0 when the query is not a subsequence', () => {
		expect(fuzzyScore('button.svelte', 'xyz')).toBe(0);
	});
	it('scores boundary + consecutive matches higher', () => {
		// "button" hits the basename start (boundary) and runs consecutively
		expect(fuzzyScore('src/ui/button.ts', 'button')).toBeGreaterThan(
			fuzzyScore('abuttonx.ts', 'button')
		);
	});
});

describe('mentionMatches', () => {
	const entries = buildEntries(FILES);

	it('empty query lists root entries, folders first', () => {
		const r = mentionMatches(entries, '');
		expect(r[0]).toEqual({ path: 'src', dir: true });
		expect(r.map((e) => e.path)).toContain('README.md');
		// nothing nested
		expect(r.every((e) => !e.path.includes('/'))).toBe(true);
	});

	it('ranks a basename match to the top', () => {
		expect(mentionMatches(entries, 'comp')[0].path).toBe('src/lib/Composer.svelte');
	});

	it('finds a file deep in a subfolder', () => {
		expect(mentionMatches(entries, 'button')[0].path).toBe('src/lib/ui/Button.svelte');
	});

	it('drills into a folder on trailing slash (direct children only)', () => {
		const r = mentionMatches(entries, 'src/lib/');
		// folder first, then files by localeCompare ('chat…' < 'Composer…')
		expect(r.map((e) => e.path)).toEqual([
			'src/lib/ui',
			'src/lib/chat.svelte.ts',
			'src/lib/Composer.svelte'
		]);
		expect(r.every((e) => !e.path.slice('src/lib/'.length).includes('/'))).toBe(true);
	});

	it('respects the result limit (top-K)', () => {
		const many = buildEntries(Array.from({ length: 500 }, (_, i) => `dir/file${i}.ts`));
		expect(mentionMatches(many, 'file', 10)).toHaveLength(10);
	});

	it('is case-insensitive', () => {
		expect(mentionMatches(entries, 'COMPOSER')[0].path).toBe('src/lib/Composer.svelte');
	});
});
