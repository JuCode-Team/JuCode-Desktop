// Workspaces, projects and project files as the daemon keeps them
// (JuCode-CLI docs/daemon-protocol.md, "Projects and files"). The remote page
// reads everything through here; the list stays current from the daemon's
// `workspaces` broadcasts.

import { daemon } from '$lib/protocol';
import { agentDirectory } from '$lib/agents.svelte';

export interface ProjectView {
	id: string;
	name: string;
	path: string;
	/** The chats project (`~/.jucode/chats`). */
	chats?: boolean;
}

export interface WorkspaceView {
	id: string;
	name: string;
	is_default?: boolean;
	projects: ProjectView[];
}

export interface HistoryItem {
	session: string;
	title: string;
	updated_at: number;
	entries: number;
	archived: boolean;
	agent: string | null;
	/** Hosted by the daemon right now. */
	open: boolean;
	/** `jucode` or `claude` (newer daemons). */
	engine?: string;
}

export interface DirEntry {
	name: string;
	dir: boolean;
	size: number;
}

export interface DirListing {
	path: string;
	git: boolean;
	entries: DirEntry[];
	truncated: boolean;
}

export interface FileContent {
	path: string;
	size: number;
	binary: boolean;
	text: string | null;
	truncated: boolean;
}

export interface GitFile {
	path: string;
	/** Porcelain XY code, e.g. ` M`, `A `, `??`. */
	status: string;
	from: string | null;
}

export interface GitStatus {
	repo: boolean;
	branch?: string;
	files: GitFile[];
}

export class RemoteProjects {
	workspaces = $state<WorkspaceView[]>([]);
	rev = $state(0);
	/** False until the daemon sends a `workspaces` frame; an older daemon never does. */
	supported = $state(false);
	/** The workspace shown; the first one when unset. */
	activeId = $state<string | null>(null);
	active = $derived(this.workspaces.find((w) => w.id === this.activeId) ?? this.workspaces[0] ?? null);

	handle(frame: Record<string, unknown>) {
		if (frame.type !== 'workspaces' || !Array.isArray(frame.workspaces)) return;
		this.workspaces = frame.workspaces as WorkspaceView[];
		this.rev = Number(frame.rev) || 0;
		this.supported = true;
	}

	/** Forgets the list when the connection drops, so a reconnect to an older
	 *  daemon is not mistaken for support. */
	reset() {
		this.supported = false;
	}

	async history(cwd: string): Promise<HistoryItem[]> {
		const reply = await daemon.request({ op: 'session_history', cwd });
		return (reply.sessions as HistoryItem[]) ?? [];
	}

	/** No reply on success; the daemon broadcasts the new session list. The
	 *  list changes here first so the row moves at once; a failed send puts
	 *  it back and throws. */
	async setMeta(session: string, meta: { title?: string; archived?: boolean; hidden?: boolean }) {
		const before = agentDirectory.sessions;
		const { hidden, ...fields } = meta;
		agentDirectory.sessions = hidden
			? before.filter((s) => s.session !== session)
			: before.map((s) => (s.session === session ? { ...s, ...fields } : s));
		try {
			await daemon.post({ op: 'session_meta', session, ...meta });
		} catch (e) {
			agentDirectory.sessions = before;
			throw e;
		}
	}

	/** The reply is the new list (also broadcast). */
	async addProject(path: string, workspaceName: string) {
		this.handle(await daemon.request({ op: 'project_add', path, workspace: this.active?.id ?? '', workspace_name: workspaceName }));
	}

	async createProject(parent: string, name: string, gitInit: boolean, workspaceName: string) {
		this.handle(
			await daemon.request({
				op: 'project_create',
				parent,
				name,
				git_init: gitInit,
				workspace: this.active?.id ?? '',
				workspace_name: workspaceName
			})
		);
	}

	/** Leaves the list at once; put back if the daemon refuses. */
	async removeProject(project: string) {
		const workspace = this.active;
		if (!workspace) return;
		const before = this.workspaces;
		this.workspaces = before.map((w) => (w.id === workspace.id ? { ...w, projects: w.projects.filter((p) => p.id !== project) } : w));
		try {
			this.handle(await daemon.request({ op: 'project_remove', workspace: workspace.id, project }));
		} catch (e) {
			this.workspaces = before;
			throw e;
		}
	}

	async list(path: string, dirsOnly = false): Promise<DirListing> {
		return (await daemon.request({ op: 'fs_list', path, dirs_only: dirsOnly })) as unknown as DirListing;
	}

	async read(path: string): Promise<FileContent> {
		return (await daemon.request({ op: 'fs_read', path })) as unknown as FileContent;
	}

	async gitStatus(path: string): Promise<GitStatus> {
		return (await daemon.request({ op: 'git_status', path })) as unknown as GitStatus;
	}

	async gitDiff(path: string, file?: string): Promise<{ diff: string; truncated: boolean }> {
		return (await daemon.request({ op: 'git_diff', path, file })) as unknown as { diff: string; truncated: boolean };
	}
}

export const remoteProjects = new RemoteProjects();

/** `a/b/c` → `c`; the last path segment for display. */
export function baseName(path: string): string {
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/** `/Users/me/dev/app` → `…/dev/app`: enough of a path to recognize it. */
export function shortPath(path: string): string {
	const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
	return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path;
}

/** Whether `path` is `dir` or inside it. */
export function within(path: string, dir: string): boolean {
	const root = dir.replace(/[\\/]+$/, '');
	return path === root || path.startsWith(root + '/') || path.startsWith(root + '\\');
}
