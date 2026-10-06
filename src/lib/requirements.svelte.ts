// Requirements on one computer (JuCode-CLI daemon requirements.rs, protocol
// "Requirements"): what the user means to get done, the sessions working on
// it and the progress the daemon keeps across them. The list as the daemon
// broadcasts it, and its ops. The desktop keeps one; the remote page one per
// paired computer.

import { getContext, setContext } from 'svelte';
import type { DaemonClient } from '$lib/daemon';
import { getLocale } from '$lib/i18n';
import { sendFile, type Uploaded } from '$lib/upload';

/** `proposed`: an agent proposed it; the user accepts or rejects it. */
export type RequirementState = 'idea' | 'open' | 'done' | 'parked' | 'proposed';
/** `state`, except while open: what its sessions are doing (see the daemon).
 *  `confirm`: its start waits for the user to confirm (see `gate`);
 *  `proposal`: an agent proposes to close it. */
export type RequirementStatus =
	| 'idea'
	| 'open'
	| 'running'
	| 'approval'
	| 'failed'
	| 'review'
	| 'confirm'
	| 'proposed'
	| 'proposal'
	| 'done'
	| 'parked';
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

/** A session starting on it: the agent first says how it understands it
 *  (`understand`), then, when asked for, its plan (`plan`); each waits for
 *  the user's confirmation, then the session switches to `mode` and works. */
export interface RequirementGate {
	session: string;
	stage: 'understand' | 'plan';
	plan: boolean;
	mode: string;
	/** A turn ended at this stage (only then is it the user's to confirm). */
	answered?: boolean;
}

/** An agent's proposal: a new requirement, or closing this one. */
export interface RequirementProposal {
	kind: 'create' | 'close';
	outcome?: 'done' | 'parked';
	agent: string;
	session?: string;
	reason: string;
	at: number;
}

export interface Requirement {
	id: string;
	/** The user's words. */
	text: string;
	title: string;
	/** Screenshots: paths on the computer (fetch with `image`). */
	images: string[];
	/** The project (its id) it belongs to; null: none yet. */
	project: string | null;
	gate?: RequirementGate;
	proposal?: RequirementProposal;
	state: RequirementState;
	status: RequirementStatus;
	/** Linked sessions, oldest first. */
	sessions: string[];
	session_states?: Record<string, SessionState>;
	progress: RequirementProgress | null;
	progress_at?: number;
	/** The end of the latest reply, on the user's turn. */
	last_reply?: string;
	source: 'desktop' | 'phone' | 'session' | 'agent';
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
		case 'confirm':
		case 'proposed':
		case 'proposal':
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

/** What confirming `gate` does next: from the understanding to the plan or
 *  to the work, or from the plan to the work. */
export function gateNext(gate: RequirementGate): 'understandPlan' | 'understandGo' | 'planGo' {
	if (gate.stage === 'plan') return 'planGo';
	return gate.plan ? 'understandPlan' : 'understandGo';
}

/** The gate open on `session` (it waits for the user once the turn ends). */
export function gateOf(r: Requirement | undefined, session: string | undefined): RequirementGate | undefined {
	return r?.gate && session && r.gate.session === session ? r.gate : undefined;
}

/** The mode a session started on a requirement works in once confirmed: the
 *  composer's, except plan (the plan comes from the gate). */
export const workMode = (mode: string) => (mode === 'plan' ? 'edits' : mode);

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

	get(id: string): Requirement | undefined {
		return this.list.find((r) => r.id === id);
	}

	// The requirement's id travels as `requirement`: `id` is the request's.
	async create(fields: {
		text: string;
		/** The project's id; none: the session's project, else none. */
		project?: string | null;
		/** Paths of uploaded screenshots (`upload`). */
		images?: string[];
		source?: 'desktop' | 'phone';
		/** Noted in this session (its project, when `project` is not given). */
		session?: string;
	}): Promise<Requirement> {
		const reply = await this.daemon.request({ op: 'requirement_create', ...fields });
		return reply.requirement as Requirement;
	}

	/** Sends a screenshot to this computer (see `upload.ts`). */
	upload(file: File, onProgress?: (sent: number, total: number) => void): Promise<Uploaded> {
		return sendFile(this.daemon, file, onProgress);
	}

	/** `project: null` leaves it without a project. */
	async update(id: string, fields: { text?: string; project?: string | null; state?: RequirementState }) {
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

	/** Starts `session` on it: linked, read-only until the user confirms
	 *  the agent's understanding (and its plan, with `plan`), then in `mode`.
	 *  `text`: the user's words to go with it. */
	async begin(id: string, fields: { session: string; plan: boolean; mode: string; text?: string }) {
		await this.daemon.request({
			op: 'requirement_begin',
			requirement: id,
			session: fields.session,
			plan: fields.plan,
			mode: fields.mode,
			text: fields.text ?? '',
			lang: getLocale()
		});
	}

	/** Confirms its gate's stage: on to the plan, or to the work. */
	async confirm(id: string, text = '') {
		await this.daemon.request({ op: 'requirement_confirm', requirement: id, text, lang: getLocale() });
	}

	/** Accepts or rejects an agent's proposal. */
	async answerProposal(id: string, accept: boolean) {
		await this.daemon.request({ op: 'requirement_proposal', requirement: id, accept });
	}

	/** Sends `text` to its latest session, or starts a new one (asked for,
	 *  or none yet) in `cwd` on `engine`, through the confirmations (`plan`,
	 *  then `mode`; see `begin`); resolves with that session. */
	async reply(
		id: string,
		fields: { text?: string; newSession?: boolean; cwd?: string; engine?: string; plan?: boolean; mode?: string }
	): Promise<string> {
		const reply = await this.daemon.request({
			op: 'requirement_reply',
			requirement: id,
			text: fields.text ?? '',
			new_session: !!fields.newSession,
			lang: getLocale(),
			...(fields.cwd ? { cwd: fields.cwd } : {}),
			...(fields.engine ? { engine: fields.engine } : {}),
			...(fields.plan ? { plan: true } : {}),
			...(fields.mode ? { mode: fields.mode } : {})
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
