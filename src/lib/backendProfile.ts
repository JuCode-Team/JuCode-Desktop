// What each backend last reported about itself: its model, the models and
// thinking efforts it offers, and its slash commands. A draft session (no
// engine yet) shows these, so the model menu and the slash menu work before
// anything is started. A backend that never ran here has no profile.

import type { CommandItem, ModelOption } from '$lib/chat.svelte';

export interface BackendProfile {
	provider?: string;
	model?: string;
	modelLabel?: string;
	effort?: string;
	efforts?: string[];
	contextWindow?: number;
	catalog?: ModelOption[];
	catalogEffort?: string;
	commands?: CommandItem[];
}

const KEY = 'jucode-backend-profiles';

/** One profile per backend; each ACP agent has its own. */
export function profileKey(backendId: string, acpAgentId = ''): string {
	return backendId === 'acp' ? `acp:${acpAgentId}` : backendId;
}

function readAll(): Record<string, BackendProfile> {
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export function loadProfile(key: string): BackendProfile {
	return readAll()[key] ?? {};
}

export function rememberProfile(key: string, patch: BackendProfile): void {
	const all = readAll();
	all[key] = { ...all[key], ...patch };
	try {
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {
		/* storage full or unavailable: the draft menus stay empty */
	}
}
