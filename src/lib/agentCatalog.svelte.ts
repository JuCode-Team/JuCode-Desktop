// The agents a session can run on, known before any menu opens: whether
// each native backend is installed, the built-in ACP presets (installed,
// version) and the agents the user registered. Loaded once at start and
// refreshed in the background when asked (a menu opening, the registry
// changing); the last answer is kept, so menus are filled on their first
// frame instead of after the version checks (seconds for a Node agent).
import { acpAgentsList, acpPresets, checkBackend, type AcpAgent, type AcpPreset } from './protocol';
import { NATIVE_BACKEND_IDS, type BackendId } from './backends';
import { loadBackendSettings, versionLabel } from './backends/settings';

const KEY = 'jucode-agent-catalog';

type Native = Partial<Record<BackendId, { found: boolean; version: string }>>;

function saved(): { native: Native; presets: AcpPreset[]; agents: AcpAgent[] } {
	try {
		const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
		return {
			native: o.native && typeof o.native === 'object' ? o.native : {},
			presets: Array.isArray(o.presets) ? o.presets : [],
			agents: Array.isArray(o.agents) ? o.agents : []
		};
	} catch {
		return { native: {}, presets: [], agents: [] };
	}
}

class AgentCatalog {
	native = $state<Native>({});
	presets = $state<AcpPreset[]>([]);
	agents = $state<AcpAgent[]>([]);
	#running: Promise<void> | null = null;

	constructor() {
		if (typeof localStorage === 'undefined') return;
		const s = saved();
		this.native = s.native;
		this.presets = s.presets;
		this.agents = s.agents;
	}

	#save() {
		try {
			localStorage.setItem(KEY, JSON.stringify({ native: this.native, presets: this.presets, agents: this.agents }));
		} catch {
			/* storage full or unavailable: the next start checks again */
		}
	}

	/** The registered agents as the registry now has them (after an edit). */
	setAgents(agents: AcpAgent[]) {
		this.agents = agents;
		this.#save();
	}

	/** Checks everything again; one check at a time (calls meanwhile share it). */
	refresh(): Promise<void> {
		this.#running ??= (async () => {
			const paths = loadBackendSettings().paths;
			const native: Native = {};
			await Promise.all([
				...NATIVE_BACKEND_IDS.map((id) =>
					checkBackend(id, paths[id])
						.then((s) => (native[id] = { found: s.found, version: versionLabel(s) }))
						.catch(() => {})
				),
				acpPresets()
					.then((p) => (this.presets = p))
					.catch(() => {}),
				acpAgentsList()
					.then((a) => (this.agents = a))
					.catch(() => {})
			]);
			this.native = { ...this.native, ...native };
			this.#save();
		})().finally(() => (this.#running = null));
		return this.#running;
	}
}

export const agentCatalog = new AgentCatalog();
