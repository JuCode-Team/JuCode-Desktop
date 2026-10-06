// Words and times shown for requirements, on the desktop and the remote page.

import type { Requirement, RequirementStatus, SessionState } from '$lib/requirements.svelte';
import { t } from '$lib/i18n';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const statusLabel = (status: RequirementStatus) => t(`shell.requirement.status${cap(status)}`);

export const sessionStateLabel = (state: SessionState | undefined) => t(`shell.requirement.session${cap(state ?? 'idle')}`);

export const sourceLabel = (source: Requirement['source']) =>
	source === 'phone'
		? t('shell.requirement.fromPhone')
		: source === 'agent'
			? t('shell.requirement.fromAgent')
			: t('shell.requirement.fromDesktop');

/** The project `id` names among `projects`; none: 未归属. */
export function projectLabel(id: string | null | undefined, projects: { id: string; name: string }[]): string {
	if (!id) return t('shell.requirement.noProject');
	return projects.find((p) => p.id === id)?.name ?? id;
}

/** A date and time, short (month/day hour:minute). */
export function when(ms: number): string {
	return new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
