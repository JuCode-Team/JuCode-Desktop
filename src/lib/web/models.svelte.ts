// The models the chat offers: the ones the admin opened to chat (site
// setting chat_models, each pinned to a group the server enforces) that this
// account can use (/v1/models), with their names, effort tiers and windows.

import { json, publicJSON } from './api';

export interface ChatModel {
	id: string;
	name: string;
	/** Effort tiers, lowest first; empty: the model takes none. */
	efforts: string[];
	window: number;
}

interface SiteInfo {
	chat_models?: { model: string; group_id: string }[] | null;
}
interface ModelRow {
	id: string;
	display_name?: string;
	context_window?: number;
	reasoning_efforts?: string[];
}

class Models {
	list = $state<ChatModel[]>([]);
	/** Loaded once: the chat is closed when the admin opened no model. */
	loaded = $state(false);
	error = $state('');

	async load() {
		try {
			const [site, rows] = await Promise.all([
				publicJSON<SiteInfo>('/v1/public/site-info'),
				json<{ data: ModelRow[] }>('/v1/models')
			]);
			const known = new Map(rows.data.map((r) => [r.id, r]));
			this.list = (site.chat_models ?? [])
				.map((m) => known.get(m.model) ?? { id: m.model })
				.map((r) => ({
					id: r.id,
					name: r.display_name || r.id,
					efforts: r.reasoning_efforts ?? [],
					window: r.context_window ?? 0
				}));
			this.error = '';
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loaded = true;
		}
	}

	find(id: string): ChatModel | undefined {
		return this.list.find((m) => m.id === id);
	}
}

export const models = new Models();
