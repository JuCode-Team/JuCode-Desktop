// An agent's tasks: its sessions, each with the messages that set it working
// (and where they came from), the reports it posted and what it concluded,
// most recently active first.

import type { MessageView, ReportView } from './agents.svelte';
import type { Schedule } from './schedules';

export type Source =
	| { kind: 'user' }
	| { kind: 'schedule'; name: string }
	| { kind: 'timer' }
	| { kind: 'agent'; id: string }
	| { kind: 'answer' }
	| { kind: 'other'; from: string };

export type ActivityItem =
	| { kind: 'task'; id: string; at: number; message: MessageView; source: Source }
	| { kind: 'report'; id: string; at: number; report: ReportView };

/** Who sent a message, from the daemon's `from` (`user`, `schedule:<id>`, …). */
export function messageSource(from: string, schedules: Schedule[]): Source {
	if (from === 'user') return { kind: 'user' };
	const sep = from.indexOf(':');
	const kind = sep < 0 ? from : from.slice(0, sep);
	const id = sep < 0 ? '' : from.slice(sep + 1);
	switch (kind) {
		case 'schedule':
			return { kind: 'schedule', name: schedules.find((s) => s.id === id)?.name ?? id };
		case 'timer':
			return { kind: 'timer' };
		case 'agent':
			return { kind: 'agent', id };
		case 'question':
			return { kind: 'answer' };
		default:
			return { kind: 'other', from };
	}
}

/** One task of an agent: a session with the message that started it, the
 *  follow-ups, the reports it posted and its handoff note. A message not
 *  delivered yet (or never) is a task of its own until it has a session. */
export interface Thread {
	/** The session, or the lone message's / report's id. */
	id: string;
	session: string | null;
	/** The session's title ('' when it has none yet). */
	title: string;
	/** The first message, and where it came from. */
	task: MessageView | null;
	source: Source | null;
	/** Later messages, oldest first. */
	followUps: MessageView[];
	/** Newest first. */
	reports: ReportView[];
	/** ms */
	latest: number;
	status: 'running' | 'queued' | 'undeliverable' | 'idle';
	/** What the session concluded (its handoff note). */
	handoff: string;
	/** Its session is archived (an earlier scheduled run, or by hand). */
	archived: boolean;
}

export interface ThreadSession {
	session: string;
	agent?: string | null;
	title?: string | null;
	created_at: number;
	updated_at?: number;
	archived?: boolean;
}

export function threads(
	agent: string,
	sessions: ThreadSession[],
	messages: MessageView[],
	reports: ReportView[],
	schedules: Schedule[],
	running: string[],
	handoffs: Record<string, string>
): Thread[] {
	const byId = new Map<string, Thread>();
	const archived = new Set(sessions.filter((s) => s.archived).map((s) => s.session));
	const open = (id: string, session: string | null, title = '', latest = 0): Thread => {
		let thread = byId.get(id);
		if (!thread) {
			thread = {
				id,
				session,
				title,
				task: null,
				source: null,
				followUps: [],
				reports: [],
				latest,
				status: session && running.includes(session) ? 'running' : 'idle',
				handoff: (session && handoffs[session]) || '',
				archived: !!session && archived.has(session)
			};
			byId.set(id, thread);
		}
		return thread;
	};
	for (const s of sessions) {
		if (s.agent === agent) open(s.session, s.session, s.title ?? '', s.updated_at ?? s.created_at);
	}
	const own = messages.filter((m) => m.agent === agent).sort((a, b) => a.at - b.at);
	for (const m of own) {
		const thread = open(m.session ?? m.id, m.session);
		if (thread.task) thread.followUps.push(m);
		else {
			thread.task = m;
			thread.source = messageSource(m.from, schedules);
		}
		thread.latest = Math.max(thread.latest, m.at);
		if (m.status === 'undeliverable') thread.status = 'undeliverable';
		else if (m.status === 'pending' && thread.status === 'idle') thread.status = 'queued';
	}
	for (const r of reports.filter((r) => r.agent === agent).sort((a, b) => b.at - a.at)) {
		const thread = open(r.session || r.id, r.session || null, r.session ? '' : r.title);
		thread.reports.push(r);
		thread.latest = Math.max(thread.latest, r.at);
	}
	return [...byId.values()].sort((a, b) => b.latest - a.latest);
}
