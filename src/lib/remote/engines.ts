// What a phone may start a session on: the native engines, and the
// computer's built-in ACP agents, which the daemon starts by id alone
// (`options.agent`). Agents registered on the desktop run commands only the
// desktop may choose, so they are not offered here.

import { BACKEND_LABELS } from '$lib/backends/types';
import type { AcpPreset } from '$lib/protocol';
import type { DaemonSessionView } from '$lib/daemonState.svelte';
import { t } from '$lib/i18n';

export interface EngineRow {
	/** `jucode`, `claude`, `codex`, or `acp:<preset>`. */
	key: string;
	engine: string;
	/** The preset id, for `acp`. */
	agent?: string;
	label: string;
	/** Not installed, or too old to run. */
	disabled: boolean;
	/** Why it is disabled, or 无审批 for an agent that never asks. */
	note?: string;
}

export function engineKey(engine: string | undefined, agent?: string | null): string {
	return engine === 'acp' && agent ? `acp:${agent}` : (engine ?? 'jucode');
}

export function pickEngines(presets: AcpPreset[]): EngineRow[] {
	return [
		...(['jucode', 'claude', 'codex'] as const).map((engine) => ({
			key: engine,
			engine,
			label: BACKEND_LABELS[engine],
			disabled: false
		})),
		...presets.map((p) => ({
			key: `acp:${p.id}`,
			engine: 'acp',
			agent: p.id,
			label: p.name,
			disabled: p.status !== 'ready',
			note:
				p.status === 'missing'
					? t('settings.acp.notInstalled')
					: p.status === 'unsupported'
						? t('settings.acp.tooOld', { min: p.min_version ?? '' })
						: p.approvals
							? undefined
							: t('chat.noApproval')
		}))
	];
}

/** The sessions a phone lists: a closed ACP session only when it ran a
 *  built-in agent (one of a registered agent reopens on the desktop only). */
export function listable(s: Pick<DaemonSessionView, 'engine' | 'open' | 'agent'>): boolean {
	return s.engine !== 'acp' || s.open || !!s.agent;
}
