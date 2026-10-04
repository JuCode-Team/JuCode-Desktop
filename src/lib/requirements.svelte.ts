// Requirements on one computer (JuCode-CLI daemon requirements.rs, protocol
// "Requirements"): what the user means to get done, the sessions working on
// it and the progress the daemon keeps across them. The list as the daemon
// broadcasts it, and its ops. The desktop keeps one; the remote page one per
// paired computer.

import { getContext, setContext } from 'svelte';
import type { DaemonClient } from '$lib/daemon';
import { getLocale } from '$lib/i18n';
import { sendFile, type Uploaded } from '$lib/upload';

export type RequirementState = 'idea' | 'open' | 'done' | 'parked';
/** `state`, except while open: what its sessions are doing (see the daemon). */
export type RequirementStatus = 'idea' | 'open' | 'running' | 'approval' | 'failed' | 'review' | 'done' | 'parked';
export type SessionState = 'running' | 'waiting' | 'failed' | 'idle';

export interface RequirementProgress {
	goal: string;
	decided: string[];
	done: string[];
	doing: string[];
	blocked: string[];
	next: string[];
	files: string[];
}

export interface Requirement {
	id: string;
	/** The user's words. */
	text: string;
	title: string;
	/** Screenshots: paths on the computer (fetch with `image`). */
	images: string[];
	projects: string[];
	state: RequirementState;
	status: RequirementStatus;
	/** Linked sessions, oldest first. */
	sessions: string[];
	session_states?: Record<string, SessionState>;
	progress: RequirementProgress | null;
	progress_at?: number;
	/** The end of the latest reply, on the user's turn. */
	last_reply?: string;
	source: 'desktop' | 'phone' | 'session';
	source_session?: string | null;
	created_at: number;
	updated_at: number;
}

/** The list's groups, in order: the user's turn, working, ideas, closed. */
export type RequirementGroup = 'attention' | 'active' | 'idea' | 'closed';
export const GROUPS: RequirementGroup[] = ['attention', 'active', 'idea', 'closed'];

export function groupOf(status: RequirementStatus): RequirementGroup {
	switch (status) {
		case 'approval':
		case 'failed':
		case 'review':
			return 'attention';
		case 'running':
		case 'open':
			return 'active';
		case 'idea':
			return 'idea';
		default:
			return 'closed';
	}
}

export const needsYou = (r: Requirement) => groupOf(r.status) === 'attention';

/** `list` by group; within one, the latest change first. */
export function grouped(list: Requirement[]): Record<RequirementGroup, Requirement[]> {
	const out: Record<RequirementGroup, Requirement[]> = { attention: [], active: [], idea: [], closed: [] };
	for (const r of [...list].sort((a, b) => b.updated_at - a.updated_at)) out[groupOf(r.status)].push(r);
	return out;
}

/** The progress sections in the order they read. */
export const PROGRESS_SECTIONS = ['decided', 'done', 'doing', 'blocked', 'next', 'files'] as const;

/** At most this many screenshots per requirement (the daemon's limit). */
export const MAX_IMAGES = 4;

export class Requirements {
	list = $state<Requirement[]>([]);
	/** Waiting for the user. */
	pending = $derived(this.list.filter(needsYou).length);
	/** The requirement each linked session works on. */
	bySession = $derived(new Map(this.list.flatMap((r) => r.sessions.map((s) => [s, r] as const))));
	#images = new Map<string, Promise<string>>();

	constructor(private daemon: DaemonClient) {}

	/** A daemon-wide frame. */
	handle(frame: Record<string, unknown>) {
		if (frame.type === 'requirements' && Array.isArray(frame.requirements))
			this.list = frame.requirements as Requirement[];
	}

	/** The connection dropped: the next one sends the list again. */
	reset() {
		this.list = [];
	}

	get(id: string): Requirement | undefined {
		return this.list.find((r) => r.id === id);
	}

	// The requirement's id travels as `requirement`: `id` is the request's.
	async create(fields: {
		text: string;
		projects?: string[];
		/** Paths of uploaded screenshots (`upload`). */
		images?: string[];
		source?: 'desktop' | 'phone';
		/** Noted in this session (its project, when `projects` is empty). */
		session?: string;
	}): Promise<Requirement> {
		const reply = await this.daemon.request({ op: 'requirement_create', ...fields });
		return reply.requirement as Requirement;
	}

	/** Sends a screenshot to this computer (see `upload.ts`). */
	upload(file: File, onProgress?: (sent: number, total: number) => void): Promise<Uploaded> {
		return sendFile(this.daemon, file, onProgress);
	}

	async update(id: string, fields: { text?: string; projects?: string[]; state?: RequirementState }) {
		await this.daemon.request({ op: 'requirement_update', requirement: id, ...fields });
	}

	async remove(id: string) {
		await this.daemon.request({ op: 'requirement_delete', requirement: id });
	}

	async link(id: string, session: string) {
		await this.daemon.request({ op: 'requirement_link', requirement: id, session });
	}

	async unlink(id: string, session: string) {
		await this.daemon.request({ op: 'requirement_unlink', requirement: id, session });
	}

	/** Screenshot `index` as a data URL (fetched once). */
	image(id: string, index: number): Promise<string> {
		const key = `${id}:${index}`;
		const cached = this.#images.get(key);
		if (cached) return cached;
		const data = this.daemon
			.request({ op: 'requirement_image', requirement: id, index })
			.then((reply) => String(reply.data));
		data.catch(() => this.#images.delete(key));
		this.#images.set(key, data);
		return data;
	}

	/** The first message of a session that starts on it, with `feedback`. */
	async prompt(id: string, feedback = ''): Promise<string> {
		const reply = await this.daemon.request({ op: 'requirement_prompt', requirement: id, text: feedback, lang: getLocale() });
		return String(reply.text ?? '');
	}

	/** Sends `text` to its latest session, or starts a new one (asked for,
	 *  or none yet) in `cwd` on `engine`; resolves with that session. */
	async reply(
		id: string,
		fields: { text?: string; newSession?: boolean; cwd?: string; engine?: string }
	): Promise<string> {
		const reply = await this.daemon.request({
			op: 'requirement_reply',
			requirement: id,
			text: fields.text ?? '',
			new_session: !!fields.newSession,
			lang: getLocale(),
			...(fields.cwd ? { cwd: fields.cwd } : {}),
			...(fields.engine ? { engine: fields.engine } : {})
		});
		return String(reply.session);
	}
}

const KEY = Symbol('requirements');

/** Makes `reqs` the list the components below this one show. */
export function provideRequirements(reqs: Requirements) {
	setContext(KEY, reqs);
}

export function useRequirements(): Requirements {
	const reqs = getContext<Requirements | undefined>(KEY);
	if (!reqs) throw new Error('useRequirements outside a requirements provider');
	return reqs;
}
