// What an agent offers (its models, efforts, slash commands, capabilities),
// known before any session of it runs, as t3code knows its providers': the
// daemon runs the engine once out of every list (`engine_probe`) and the
// answer goes into the backend profile a draft is seeded from
// (backendProfile.ts). A profile probed recently is not probed again.
import { acpAgentsList, daemon } from './protocol';
import { buildBackendOpts } from './backends/settings';
import { loadProfile, profileKey, rememberProfile, type BackendProfile } from './backendProfile';
import type { BackendId } from './backends';
import type { AcpAgentRef } from './types';
import type { BackendCaps } from './backends/types';
import type { CommandItem, ModelOption } from './chat.svelte';

/** A profile probed more recently than this is current. */
export const PROBE_FRESH_MS = 6 * 3_600_000;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The profile a probe's events make. */
export function profileFromEvents(events: Record<string, unknown>[]): BackendProfile {
	const patch: BackendProfile = {};
	for (const ev of events) {
		if (ev.type === 'model_status') {
			Object.assign(patch, {
				provider: str(ev.provider),
				model: str(ev.model),
				modelLabel: str(ev.model_label),
				effort: str(ev.reasoning_effort),
				efforts: arr<string>(ev.reasoning_efforts),
				effortDefault: str(ev.default_effort),
				contextWindow: typeof ev.context_window === 'number' ? ev.context_window : 0
			});
		} else if (ev.type === 'model_view') {
			patch.catalog = arr<ModelOption>(ev.models);
			patch.catalogEffort = str(ev.active_effort);
		} else if (ev.type === 'command_list') {
			patch.commands = arr<CommandItem>(ev.commands);
		} else if (ev.type === 'engine_caps' && ev.caps && typeof ev.caps === 'object') {
			patch.caps = ev.caps as Partial<BackendCaps>;
		}
	}
	return patch;
}

/** The engine spec a probe of `backend` (and ACP `agent`) runs, as a session
 *  of it starts: the configured binary and environment, the agent's command. */
async function specFor(backend: BackendId, agent?: AcpAgentRef): Promise<{ engine: string; options: Record<string, unknown> } | null> {
	const base = buildBackendOpts(backend);
	const program = { ...(base?.bin_override ? { bin: base.bin_override } : {}), ...(base?.env ? { env: base.env } : {}) };
	if (backend === 'claude' || backend === 'codex') return { engine: backend, options: program };
	if (backend !== 'acp' || !agent) return null;
	if (agent.preset) return { engine: 'acp', options: { agent: agent.id } };
	const entry = (await acpAgentsList()).find((a) => a.id === agent.id);
	return entry ? { engine: 'acp', options: { command: entry.command, args: entry.args, env: { ...(base?.env ?? {}), ...entry.env } } } : null;
}

const running = new Map<string, Promise<boolean>>();

/** Probes `backend` (an ACP `agent`) unless its profile is fresh (`force`:
 *  anyway); true when the profile changed. One probe per profile at a time. */
export function probeEngine(backend: BackendId, agent?: AcpAgentRef, force = false): Promise<boolean> {
	const key = profileKey(backend, agent?.id);
	if (!force && Date.now() - (loadProfile(key).probedAt ?? 0) < PROBE_FRESH_MS) return Promise.resolve(false);
	let job = running.get(key);
	if (!job) {
		job = (async () => {
			const spec = await specFor(backend, agent);
			if (!spec) return false;
			const reply = await daemon.request({ op: 'engine_probe', engine: spec.engine, options: spec.options });
			const patch = profileFromEvents(arr<Record<string, unknown>>(reply.events));
			rememberProfile(key, { ...patch, probedAt: Date.now() });
			return Object.keys(patch).length > 0;
		})()
			.catch(() => false)
			.finally(() => running.delete(key));
		running.set(key, job);
	}
	return job;
}
