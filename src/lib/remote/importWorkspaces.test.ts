import { describe, expect, it, vi } from 'vitest';

const request = vi.fn(() => Promise.resolve({}));
vi.mock('$lib/protocol', () => ({ daemon: { request } }));

const { importIfEmpty, toDaemonWorkspaces } = await import('./importWorkspaces');

const entries = [
	{
		id: 'w1',
		name: '默认工作区',
		isDefault: true,
		layout: null,
		projects: [
			{ id: 'p1', name: '对话', path: '/h/.jucode/chats', chats: true, tabs: [{ id: 't1', title: 'x' }] },
			{ id: 'p2', name: 'crm', path: '/h/dev/crm', tabs: [] }
		]
	},
	{ id: 'w2', name: '空', layout: null, projects: [] }
] as never;

describe('importWorkspaces', () => {
	it('keeps projects and drops tabs and layout', () => {
		expect(toDaemonWorkspaces(entries)[0]).toEqual({
			id: 'w1',
			name: '默认工作区',
			is_default: true,
			projects: [
				{ id: 'p1', name: '对话', path: '/h/.jucode/chats', chats: true },
				{ id: 'p2', name: 'crm', path: '/h/dev/crm' }
			]
		});
	});

	it('imports only into an empty daemon, skipping empty workspaces', () => {
		importIfEmpty({ type: 'workspaces', rev: 3, workspaces: [] }, () => entries);
		importIfEmpty({ type: 'workspaces', rev: 0, workspaces: [{ id: 'x' }] }, () => entries);
		expect(request).not.toHaveBeenCalled();
		importIfEmpty({ type: 'workspaces', rev: 0, workspaces: [] }, () => entries);
		expect(request).toHaveBeenCalledOnce();
		const op = (request.mock.calls[0] as unknown[])[0] as { workspaces: { id: string }[] };
		expect(op.workspaces.map((w) => w.id)).toEqual(['w1']);
	});
});
