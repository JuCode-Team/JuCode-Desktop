// Dispatches on one paired computer (JuCode-CLI daemon dispatch.rs): the
// list as the daemon broadcasts it, and the ops that start one or answer
// its plan.

import type { DaemonClient } from '$lib/daemon';

export type DispatchMode = 'manual' | 'auto-edit' | 'auto' | 'full-access';
export type DispatchStatus = 'planning' | 'awaiting' | 'running' | 'done' | 'cancelled' | 'failed';
export type TaskStatus = 'planned' | 'sent' | 'running' | 'waiting' | 'done' | 'failed';

export interface DispatchTask {
	id: number;
	title: string;
	project: string;
	session: string | null;
	engine: string;
	status: TaskStatus;
	/** The end of its session's last reply. */
	reply: string;
}

export interface DispatchView {
	/** Also the dispatcher's session. */
	id: string;
	text: string;
	plan: boolean;
	mode: DispatchMode;
	status: DispatchStatus;
	tasks: DispatchTask[];
	summary: string;
	created_at: number;
	updated_at: number;
}

export class Dispatches {
	list = $state<DispatchView[]>([]);
	/** Plans waiting for the user. */
	pending = $derived(this.list.filter((d) => d.status === 'awaiting').length);

	constructor(private daemon: DaemonClient) {}

	/** A daemon-wide frame. */
	handle(frame: Record<string, unknown>) {
		if (frame.type === 'dispatches' && Array.isArray(frame.dispatches)) this.list = frame.dispatches as DispatchView[];
	}

	async send(text: string, plan: boolean, mode: DispatchMode): Promise<DispatchView> {
		const reply = await this.daemon.request({ op: 'dispatch_send', text, plan, approval_mode: mode });
		return reply.dispatch as DispatchView;
	}

	async confirm(id: string, approve: boolean, note = ''): Promise<void> {
		await this.daemon.request({ op: 'dispatch_confirm', dispatch: id, approve, note });
	}
}
