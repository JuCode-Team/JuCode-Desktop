import { describe, expect, it } from 'vitest';
import type { Session } from '$lib/types';
import { DAY_MS, staleSessions } from './autoArchive';

const NOW = 100 * DAY_MS;
const idle = { pendingApproval: null, trustPrompt: false, engineState: 'running', lastError: null, busy: false, bgTasks: [], subagents: {}, agentRuns: { workflows: [], agents: [] }, unseen: false };
const session = (id: string, over: Partial<Session> = {}, chat: object = {}): Session =>
	({ id, updatedAt: NOW - 5 * DAY_MS, chat: { ...idle, ...chat }, ...over }) as unknown as Session;
const ids = (list: Session[]) => list.map((s) => s.id);

describe('staleSessions', () => {
	it('picks sessions idle longer than the limit', () => {
		const list = [session('old'), session('new', { updatedAt: NOW - DAY_MS })];
		expect(ids(staleSessions(list, 3, '', NOW))).toEqual(['old']);
	});

	it('never archives with the limit off', () => {
		expect(staleSessions([session('old')], 0, '', NOW)).toEqual([]);
	});

	it('keeps pinned, drafts, archived, the one in front, and unknown ages', () => {
		const list = [
			session('pinned', { pinned: true }),
			session('draft', { draft: true }),
			session('archived', { archived: true }),
			session('front'),
			session('unknown', { updatedAt: undefined })
		];
		expect(staleSessions(list, 3, 'front', NOW)).toEqual([]);
	});

	it('keeps a session that wants the user', () => {
		const list = [session('busy', {}, { busy: true }), session('unseen', {}, { unseen: true }), session('failed', {}, { lastError: 'x' })];
		expect(staleSessions(list, 3, '', NOW)).toEqual([]);
	});

	it('counts a restored session from when it was restored', () => {
		expect(staleSessions([session('kept', { keptAt: NOW - DAY_MS })], 3, '', NOW)).toEqual([]);
	});
});
