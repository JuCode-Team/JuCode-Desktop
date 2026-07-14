import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer so tab lifecycle is testable in node.
vi.mock('$lib/protocol', () => {
	const files = new Map<string, { content: string; mtime: number }>();
	return {
		__files: files,
		readText: vi.fn((path: string) => {
			const f = files.get(path);
			return f ? Promise.resolve(f.content) : Promise.reject(new Error(`no such file: ${path}`));
		}),
		statText: vi.fn((path: string) => {
			const f = files.get(path);
			return f
				? Promise.resolve({ mtime_ms: f.mtime, size: f.content.length })
				: Promise.reject(new Error(`no such file: ${path}`));
		}),
		writeText: vi.fn((path: string, content: string, expectedMtime?: number) => {
			const f = files.get(path);
			if (!f) return Promise.reject(new Error(`no such file: ${path}`));
			if (expectedMtime !== undefined && f.mtime !== expectedMtime)
				return Promise.reject(`conflict:${f.mtime}`);
			f.content = content;
			f.mtime += 1;
			return Promise.resolve({ mtime_ms: f.mtime, size: content.length });
		}),
		gitHeadText: vi.fn(() => Promise.resolve('head-content')),
		isConflictError: (e: unknown) => String(e).startsWith('conflict:')
	};
});

import { EditorStore } from './editorStore.svelte';
import * as protocol from '$lib/protocol';

const files = (protocol as unknown as { __files: Map<string, { content: string; mtime: number }> })
	.__files;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	vi.clearAllMocks();
	files.clear();
	files.set('/proj/a.ts', { content: 'alpha', mtime: 100 });
	files.set('/proj/b.ts', { content: 'beta', mtime: 200 });
});

describe('EditorStore tab lifecycle', () => {
	it('open loads content + stat, activates the tab and shows the pane', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		expect(s.tabs.length).toBe(1);
		expect(s.activePath).toBe('/proj/a.ts');
		expect(s.visible).toBe(true);
		expect(tab.doc).toBe('alpha');
		expect(tab.mtime).toBe(100);
		expect(tab.rel).toBe('a.ts');
		expect(tab.dirty).toBe(false);
		await flush();
		expect(tab.headText).toBe('head-content');
	});

	it('re-opening an open path activates instead of duplicating', async () => {
		const s = new EditorStore();
		await s.open('/proj/a.ts', '/proj');
		await s.open('/proj/b.ts');
		expect(s.activePath).toBe('/proj/b.ts');
		await s.open('/proj/a.ts');
		expect(s.tabs.length).toBe(2);
		expect(s.activePath).toBe('/proj/a.ts');
		expect(protocol.readText).toHaveBeenCalledTimes(2);
	});

	it('open resolves project-relative paths against the root', async () => {
		const s = new EditorStore();
		s.root = '/proj';
		const tab = await s.open('a.ts');
		expect(tab.path).toBe('/proj/a.ts');
	});

	it('open rejects for unreadable files (binary fallback path)', async () => {
		const s = new EditorStore();
		await expect(s.open('/proj/missing.bin', '/proj')).rejects.toThrow();
		expect(s.tabs.length).toBe(0);
	});

	it('close of a clean tab removes it and re-points activePath', async () => {
		const s = new EditorStore();
		await s.open('/proj/a.ts', '/proj');
		await s.open('/proj/b.ts');
		expect(s.close('/proj/b.ts')).toBe(true);
		expect(s.activePath).toBe('/proj/a.ts');
		expect(s.close('/proj/a.ts')).toBe(true);
		expect(s.visible).toBe(false);
	});

	it('close refuses a dirty tab unless forced', async () => {
		const s = new EditorStore();
		await s.open('/proj/a.ts', '/proj');
		s.syncDoc('/proj/a.ts', 'alpha edited');
		expect(s.close('/proj/a.ts')).toBe(false);
		expect(s.tabs.length).toBe(1);
		expect(s.close('/proj/a.ts', true)).toBe(true);
		expect(s.tabs.length).toBe(0);
	});
});

describe('EditorStore dirty tracking and save', () => {
	it('syncDoc marks dirty; save persists and clears it', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.syncDoc('/proj/a.ts', 'alpha v2');
		expect(tab.dirty).toBe(true);
		expect(s.hasDirty).toBe(true);
		const res = await s.save('/proj/a.ts');
		expect(res).toBe('saved');
		expect(tab.dirty).toBe(false);
		expect(files.get('/proj/a.ts')!.content).toBe('alpha v2');
		expect(tab.mtime).toBe(101); // rebased onto the fresh stat
	});

	it('save uses the given live content over the synced doc', async () => {
		const s = new EditorStore();
		await s.open('/proj/a.ts', '/proj');
		s.markDirty('/proj/a.ts');
		await s.save('/proj/a.ts', 'live content');
		expect(files.get('/proj/a.ts')!.content).toBe('live content');
	});

	it('saveAll saves only dirty tabs', async () => {
		const s = new EditorStore();
		await s.open('/proj/a.ts', '/proj');
		await s.open('/proj/b.ts');
		s.syncDoc('/proj/b.ts', 'beta v2');
		await s.saveAll();
		expect(protocol.writeText).toHaveBeenCalledTimes(1);
		expect(files.get('/proj/b.ts')!.content).toBe('beta v2');
	});
});

describe('EditorStore conflict transitions', () => {
	it('save → conflict when the file changed on disk; nothing written', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.syncDoc('/proj/a.ts', 'mine');
		files.get('/proj/a.ts')!.mtime = 999; // external change
		files.get('/proj/a.ts')!.content = 'theirs';
		const res = await s.save('/proj/a.ts');
		expect(res).toBe('conflict');
		expect(tab.conflict).toBe(true);
		expect(tab.dirty).toBe(true);
		expect(files.get('/proj/a.ts')!.content).toBe('theirs');
	});

	it('force save (覆盖) overwrites and clears the conflict', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.syncDoc('/proj/a.ts', 'mine');
		files.get('/proj/a.ts')!.mtime = 999;
		await s.save('/proj/a.ts');
		const res = await s.save('/proj/a.ts', undefined, true);
		expect(res).toBe('saved');
		expect(tab.conflict).toBe(false);
		expect(files.get('/proj/a.ts')!.content).toBe('mine');
	});

	it('reload (重新加载) takes the disk content and clears conflict + dirty', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.syncDoc('/proj/a.ts', 'mine');
		files.get('/proj/a.ts')!.mtime = 999;
		files.get('/proj/a.ts')!.content = 'theirs';
		await s.save('/proj/a.ts');
		const revBefore = tab.rev;
		await s.reload('/proj/a.ts');
		expect(tab.doc).toBe('theirs');
		expect(tab.conflict).toBe(false);
		expect(tab.dirty).toBe(false);
		expect(tab.mtime).toBe(999);
		expect(tab.rev).toBe(revBefore + 1); // pane rebuilds its EditorState
	});

	it('non-conflict write failures surface as tab.error', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		files.delete('/proj/a.ts');
		const res = await s.save('/proj/a.ts', 'x');
		expect(res).toBe('error');
		expect(tab.error).toContain('no such file');
	});
});

describe('EditorStore engine-edit integration (⌘K / Changes hook)', () => {
	it('beginAiEdit marks the range; engine edit reloads and clears it', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.beginAiEdit('/proj/a.ts', 3, 7);
		expect(tab.aiRange).toEqual({ fromLine: 3, toLine: 7 });
		files.get('/proj/a.ts')!.content = 'agent edited';
		s.handleEngineEdit(['/proj/a.ts']);
		await flush();
		expect(tab.doc).toBe('agent edited');
		expect(tab.aiRange).toBeNull();
		expect(tab.dirty).toBe(false);
	});

	it('clean tabs auto-reload on engine edits (relative paths resolved)', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		files.get('/proj/a.ts')!.content = 'agent edited';
		s.handleEngineEdit(['a.ts']);
		await flush();
		expect(tab.doc).toBe('agent edited');
	});

	it('dirty tabs without a pending AI edit become conflicted, not clobbered', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.syncDoc('/proj/a.ts', 'my unsaved work');
		files.get('/proj/a.ts')!.content = 'agent edited';
		s.handleEngineEdit(['/proj/a.ts']);
		await flush();
		expect(tab.doc).toBe('my unsaved work');
		expect(tab.conflict).toBe(true);
	});

	it('paths without an open tab are ignored', async () => {
		const s = new EditorStore();
		await s.open('/proj/a.ts', '/proj');
		expect(() => s.handleEngineEdit(['/proj/unopened.ts'])).not.toThrow();
	});

	it('cancelAiEdit clears the pending range', async () => {
		const s = new EditorStore();
		const tab = await s.open('/proj/a.ts', '/proj');
		s.beginAiEdit('/proj/a.ts', 1, 2);
		s.cancelAiEdit('/proj/a.ts');
		expect(tab.aiRange).toBeNull();
	});
});
