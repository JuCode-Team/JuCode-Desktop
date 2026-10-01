import { describe, expect, it } from 'vitest';
import { extractPrUrl, hasGitHubRemote, parseGhVersion, parsePrView } from './github-pr';

describe('GitHub PR output parsing', () => {
	it('extracts the gh version', () => {
		expect(parseGhVersion('gh version 2.63.2 (2024-12-05)')).toBe('2.63.2');
		expect(parseGhVersion('command not found: gh')).toBeNull();
	});

	it('recognizes GitHub remotes only', () => {
		expect(hasGitHubRemote('origin\tgit@github.com:a/b.git (fetch)')).toBe(true);
		expect(hasGitHubRemote('origin\thttps://gitlab.com/a/b.git (fetch)')).toBe(false);
	});

	it('parses current and newly-created pull requests', () => {
		expect(parsePrView('{"url":"https://github.com/a/b/pull/7","title":"feat: x","state":"OPEN","isDraft":false}')).toEqual({
			url: 'https://github.com/a/b/pull/7',
			title: 'feat: x',
			state: 'OPEN',
			isDraft: false
		});
		expect(parsePrView('no pull request')).toBeNull();
		expect(extractPrUrl('created\nhttps://github.com/a/b/pull/12\n')).toBe('https://github.com/a/b/pull/12');
	});
});
