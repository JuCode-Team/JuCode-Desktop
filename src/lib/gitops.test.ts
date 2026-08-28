import { describe, it, expect } from 'vitest';
import {
	isValidBranchName,
	parseBranches,
	parseNumstat,
	parseSyncStatus,
	defaultBaseBranch,
	slugifyTaskName,
	parseWorktreeList,
	taskWorktrees,
	parseAheadBehind,
	mergeBlocker,
	canFinishTask
} from './gitops';

describe('isValidBranchName', () => {
	it('accepts normal branch names', () => {
		expect(isValidBranchName('main')).toBe(true);
		expect(isValidBranchName('feature/new-ui')).toBe(true);
		expect(isValidBranchName('fix_v1.2.3')).toBe(true);
	});

	it('rejects option-injection and invalid ref shapes', () => {
		expect(isValidBranchName('')).toBe(false);
		expect(isValidBranchName('-b')).toBe(false);
		expect(isValidBranchName('--force')).toBe(false);
		expect(isValidBranchName('.hidden')).toBe(false);
		expect(isValidBranchName('a..b')).toBe(false);
		expect(isValidBranchName('a@{1}')).toBe(false);
		expect(isValidBranchName('a//b')).toBe(false);
		expect(isValidBranchName('branch/')).toBe(false);
		expect(isValidBranchName('branch.')).toBe(false);
		expect(isValidBranchName('branch.lock')).toBe(false);
		expect(isValidBranchName('has space')).toBe(false);
		expect(isValidBranchName('分支')).toBe(false);
	});
});

describe('parseBranches', () => {
	it('splits and trims branch list output', () => {
		expect(parseBranches('main\nfeature/x\n\ndev\n')).toEqual(['main', 'feature/x', 'dev']);
	});

	it('skips detached HEAD entries', () => {
		expect(parseBranches('(HEAD detached at 1a2b3c)\nmain\n')).toEqual(['main']);
	});
});

describe('parseNumstat', () => {
	it('parses added/removed counts and paths', () => {
		expect(parseNumstat('3\t1\tsrc/a.ts\n10\t0\tsrc/b.ts\n')).toEqual([
			{ path: 'src/a.ts', added: 3, removed: 1 },
			{ path: 'src/b.ts', added: 10, removed: 0 }
		]);
	});
	it('marks binary files (- counts) as -1', () => {
		expect(parseNumstat('-\t-\tassets/logo.png\n')).toEqual([{ path: 'assets/logo.png', added: -1, removed: -1 }]);
	});
	it('ignores blank lines and rows without a path', () => {
		expect(parseNumstat('\n2\t2\n5\t5\tx.ts\n')).toEqual([{ path: 'x.ts', added: 5, removed: 5 }]);
	});
});

describe('parseSyncStatus', () => {
	it('parses ahead/behind against upstream', () => {
		expect(parseSyncStatus('## main...origin/main [ahead 2, behind 1]\n M a.txt')).toEqual({
			upstream: 'origin/main',
			ahead: 2,
			behind: 1
		});
	});

	it('parses ahead-only and behind-only', () => {
		expect(parseSyncStatus('## dev...origin/dev [ahead 3]')).toEqual({ upstream: 'origin/dev', ahead: 3, behind: 0 });
		expect(parseSyncStatus('## dev...origin/dev [behind 4]')).toEqual({ upstream: 'origin/dev', ahead: 0, behind: 4 });
	});

	it('in-sync branch has upstream and zero counts', () => {
		expect(parseSyncStatus('## main...origin/main')).toEqual({ upstream: 'origin/main', ahead: 0, behind: 0 });
	});

	it('no upstream / detached / empty output → null upstream', () => {
		expect(parseSyncStatus('## feature/local-only')).toEqual({ upstream: null, ahead: 0, behind: 0 });
		expect(parseSyncStatus('## HEAD (no branch)')).toEqual({ upstream: null, ahead: 0, behind: 0 });
		expect(parseSyncStatus('')).toEqual({ upstream: null, ahead: 0, behind: 0 });
	});
});

describe('slugifyTaskName', () => {
	it('lowercases and collapses non-alphanumerics into single hyphens', () => {
		expect(slugifyTaskName('Fix Login Bug')).toBe('fix-login-bug');
		expect(slugifyTaskName('  重构 API v2!! ')).toBe('api-v2');
		expect(slugifyTaskName('a__b..c')).toBe('a-b-c');
	});

	it('trims leading/trailing hyphens and caps the length', () => {
		expect(slugifyTaskName('---abc---')).toBe('abc');
		const long = slugifyTaskName('x'.repeat(80));
		expect(long.length).toBeLessThanOrEqual(40);
		expect(long.endsWith('-')).toBe(false);
	});

	it('returns empty string when nothing slug-able remains', () => {
		expect(slugifyTaskName('中文任务')).toBe('');
		expect(slugifyTaskName('!!!')).toBe('');
		expect(slugifyTaskName('')).toBe('');
	});
});

describe('parseWorktreeList', () => {
	const porcelain = [
		'worktree /Users/me/dev/repo',
		'HEAD 1111111111111111111111111111111111111111',
		'branch refs/heads/main',
		'',
		'worktree /Users/me/dev/.jucode-worktrees/repo/fix-login',
		'HEAD 2222222222222222222222222222222222222222',
		'branch refs/heads/task/fix-login',
		'',
		'worktree /Users/me/dev/.jucode-worktrees/repo/gone-task',
		'HEAD 3333333333333333333333333333333333333333',
		'detached',
		'prunable gitdir file points to non-existent location',
		''
	].join('\n');

	it('parses blocks into entries with short branch names', () => {
		const entries = parseWorktreeList(porcelain);
		expect(entries).toHaveLength(3);
		expect(entries[0]).toMatchObject({ path: '/Users/me/dev/repo', branch: 'main', detached: false, prunable: false });
		expect(entries[1]).toMatchObject({
			path: '/Users/me/dev/.jucode-worktrees/repo/fix-login',
			head: '2222222222222222222222222222222222222222',
			branch: 'task/fix-login'
		});
		expect(entries[2]).toMatchObject({ branch: null, detached: true, prunable: true });
	});

	it('handles bare/locked attributes and missing trailing newline', () => {
		const out = 'worktree /repo\nbare\nlocked reason with spaces';
		expect(parseWorktreeList(out)).toEqual([
			{ path: '/repo', head: '', branch: null, detached: false, bare: true, locked: true, prunable: false }
		]);
	});

	it('returns [] for empty output', () => {
		expect(parseWorktreeList('')).toEqual([]);
		expect(parseWorktreeList('\n\n')).toEqual([]);
	});

	it('filters task worktrees by container dir and derives slugs', () => {
		const tasks = taskWorktrees(parseWorktreeList(porcelain), '/Users/me/dev/.jucode-worktrees/repo');
		expect(tasks.map((t) => t.slug)).toEqual(['fix-login', 'gone-task']);
		// 主工作树不在容器目录下，被排除
		expect(tasks.some((t) => t.path === '/Users/me/dev/repo')).toBe(false);
		// 嵌套/非法 slug 路径被排除
		const nested = parseWorktreeList('worktree /Users/me/dev/.jucode-worktrees/repo/a/b\nHEAD 4444\n');
		expect(taskWorktrees(nested, '/Users/me/dev/.jucode-worktrees/repo')).toEqual([]);
	});
});

describe('parseAheadBehind', () => {
	it('parses left-right counts (left=behind, right=ahead)', () => {
		expect(parseAheadBehind('2\t5\n')).toEqual({ behind: 2, ahead: 5 });
		expect(parseAheadBehind('0\t0')).toEqual({ behind: 0, ahead: 0 });
	});

	it('returns zeros for malformed output', () => {
		expect(parseAheadBehind('')).toEqual({ ahead: 0, behind: 0 });
		expect(parseAheadBehind('fatal: bad revision')).toEqual({ ahead: 0, behind: 0 });
	});
});

describe('merge preconditions', () => {
	it('mergeBlocker requires a branch, a clean tree, and commits ahead', () => {
		expect(mergeBlocker({ dirty: false, branch: 'task/x', ahead: 2 })).toBeNull();
		expect(mergeBlocker({ dirty: true, branch: 'task/x', ahead: 2 })).toBe('dirty');
		expect(mergeBlocker({ dirty: false, branch: null, ahead: 2 })).toBe('detached');
		expect(mergeBlocker({ dirty: false, branch: 'task/x', ahead: 0 })).toBe('noCommits');
		// detached 优先于 dirty（先解决在哪个分支的问题）
		expect(mergeBlocker({ dirty: true, branch: null, ahead: 0 })).toBe('detached');
	});

	it('canFinishTask requires clean tree and fully-merged branch', () => {
		expect(canFinishTask({ dirty: false, ahead: 0 })).toBe(true);
		expect(canFinishTask({ dirty: true, ahead: 0 })).toBe(false);
		expect(canFinishTask({ dirty: false, ahead: 1 })).toBe(false);
	});
});

describe('defaultBaseBranch', () => {
	it('prefers main, then master, then develop', () => {
		expect(defaultBaseBranch(['dev', 'main', 'master'], 'dev')).toBe('main');
		expect(defaultBaseBranch(['dev', 'master'], 'dev')).toBe('master');
		expect(defaultBaseBranch(['dev', 'develop'], 'dev')).toBe('develop');
	});

	it('never suggests the current branch', () => {
		expect(defaultBaseBranch(['main', 'feature'], 'main')).toBe('feature');
		expect(defaultBaseBranch(['main'], 'main')).toBe('');
	});
});
