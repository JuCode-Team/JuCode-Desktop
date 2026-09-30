// Hands the desktop's workspaces and projects to a daemon that has none yet
// (a first start, or a daemon older than shared projects), so paired devices
// see the same projects. Tabs and layout stay on the desktop.

import { daemon } from '$lib/protocol';
import type { WorkspaceEntry } from '$lib/workbench/workspaces';

export function toDaemonWorkspaces(entries: WorkspaceEntry[]) {
	return entries.map((ws) => ({
		id: ws.id,
		name: ws.name,
		...(ws.isDefault ? { is_default: true } : {}),
		...(ws.color ? { color: ws.color } : {}),
		...(ws.icon ? { icon: ws.icon } : {}),
		projects: ws.projects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			...(p.chats ? { chats: true } : {}),
			...(p.worktree ? { worktree: p.worktree } : {})
		}))
	}));
}

/** Called with each daemon-wide frame; imports on an empty `workspaces`. */
export function importIfEmpty(frame: Record<string, unknown>, entries: () => WorkspaceEntry[]) {
	if (frame.type !== 'workspaces' || frame.rev !== 0) return;
	if (Array.isArray(frame.workspaces) && frame.workspaces.length > 0) return;
	const workspaces = toDaemonWorkspaces(entries()).filter((ws) => ws.projects.length > 0);
	if (workspaces.length === 0) return;
	daemon.request({ op: 'workspaces_set', rev: 0, workspaces }).catch(() => {
		/* another client imported first: its list stands */
	});
}
