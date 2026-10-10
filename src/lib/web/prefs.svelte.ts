// What the composer was last set to (this browser): the model, its effort,
// web search, deep research.

import { t } from '$lib/i18n';
import { models } from './models.svelte';

const KEY = 'jucode-web-prefs';

class ChatPrefs {
	model = $state('');
	/** Per model: the last effort picked for it. */
	efforts = $state<Record<string, string>>({});
	search = $state(false);
	research = $state(false);

	constructor() {
		try {
			const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			this.model = typeof p.model === 'string' ? p.model : '';
			this.efforts = p.efforts && typeof p.efforts === 'object' ? p.efforts : {};
			this.search = p.search === true;
			this.research = p.research === true;
		} catch {
			/* defaults */
		}
	}

	#save() {
		try {
			localStorage.setItem(KEY, JSON.stringify({ model: this.model, efforts: this.efforts, search: this.search, research: this.research }));
		} catch {
			/* no storage */
		}
	}

	/** The model to use: the one picked if still offered, else the first. */
	get current(): string {
		return models.find(this.model)?.id ?? models.list[0]?.id ?? '';
	}
	/** Its effort: the one picked for it if it still has it, else its middle tier. */
	get effort(): string {
		const m = models.find(this.current);
		if (!m?.efforts.length) return '';
		const picked = this.efforts[m.id];
		if (picked && m.efforts.includes(picked)) return picked;
		return m.efforts.includes('medium') ? 'medium' : m.efforts[Math.floor((m.efforts.length - 1) / 2)]!;
	}

	setModel(id: string) {
		this.model = id;
		this.#save();
	}
	setEffort(effort: string) {
		this.efforts = { ...this.efforts, [this.current]: effort };
		this.#save();
	}
	setSearch(on: boolean) {
		this.search = on;
		if (on) this.research = false;
		this.#save();
	}
	setResearch(on: boolean) {
		this.research = on;
		if (on) this.search = false;
		this.#save();
	}
}

export const chatPrefs = new ChatPrefs();

/** An effort tier in words (never the raw value). */
export function effortName(effort: string): string {
	const key = `web.effort.${effort}`;
	const name = t(key);
	return name === key ? t('web.effort.other') : name;
}
