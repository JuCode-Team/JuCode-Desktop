import { invoke } from '@tauri-apps/api/core';

/** A page element captured by the embedded browser's picker, attached to the
 *  next user message as textual context. */
export interface WebRef {
	url: string;
	title: string;
	selector: string;
	tag: string;
	text: string;
	html: string;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Reactive state for the embedded browser panel. The native child webview is
 *  a singleton overlaid on the main window; the BrowserPanel placeholder keeps
 *  its bounds in sync, and everything else (composer chips, tool-driven opens)
 *  talks to this store. */
class BrowserStore {
	/** The native webview exists. */
	created = $state(false);
	url = $state('');
	title = $state('');
	loading = $state(false);
	picking = $state(false);
	/** URL waiting for the panel placeholder to become visible/measurable. */
	pendingUrl = $state<string | null>(null);
	/** Bumped by open() so the page/dock can reveal the browser tab. */
	openSignal = $state(0);
	/** Native webviews always render above the DOM, so modals hide the browser
	 *  by collapsing its bounds to zero while they're open. */
	suspended = false;
	#lastRect: Rect | null = null;
	#applied: Rect | null = null;

	/** Open a URL: navigate the live webview, or remember it until the panel
	 *  placeholder reports usable bounds. Always signals the UI to reveal the tab. */
	open(url: string) {
		if (this.created) {
			this.url = url;
			this.loading = true;
			invoke('browser_navigate', { url }).catch((e) => console.error('browser_navigate', e));
		} else {
			this.pendingUrl = url;
		}
		this.openSignal++;
	}

	/** Called by the panel placeholder (ResizeObserver + safety poll). Creates
	 *  the webview lazily once there's both a URL and visible bounds. */
	async syncBounds(rect: Rect) {
		this.#lastRect = rect;
		if (!this.created) {
			if (this.pendingUrl && rect.w > 1 && rect.h > 1) {
				const url = this.pendingUrl;
				this.pendingUrl = null;
				try {
					await invoke('browser_open', { url, x: rect.x, y: rect.y, width: rect.w, height: rect.h });
					this.created = true;
					this.url = url;
					this.loading = true;
					this.#applied = rect;
				} catch (e) {
					console.error('browser_open', e);
				}
			}
			return;
		}
		this.#apply(this.suspended ? { x: 0, y: 0, w: 0, h: 0 } : rect);
	}

	#apply(r: Rect) {
		const a = this.#applied;
		if (a && a.x === r.x && a.y === r.y && a.w === r.w && a.h === r.h) return;
		this.#applied = r;
		invoke('browser_set_bounds', { x: r.x, y: r.y, width: r.w, height: r.h }).catch(() => {});
	}

	setSuspended(s: boolean) {
		if (s === this.suspended) return;
		this.suspended = s;
		if (!this.created) return;
		const r = s ? { x: 0, y: 0, w: 0, h: 0 } : this.#lastRect;
		if (r) this.#apply(r);
	}

	goBack() {
		if (this.created) invoke('browser_back').catch(() => {});
	}
	goForward() {
		if (this.created) invoke('browser_forward').catch(() => {});
	}
	reload() {
		if (this.created) invoke('browser_reload').catch(() => {});
	}

	async setPicking(on: boolean) {
		if (!this.created) return;
		try {
			await invoke('browser_pick', { enable: on });
			this.picking = on;
		} catch (e) {
			console.error('browser_pick', e);
		}
	}

	/** Destroy the native webview (panel tab closed). */
	async close() {
		this.picking = false;
		this.created = false;
		this.loading = false;
		this.#applied = null;
		await invoke('browser_close').catch(() => {});
	}

	/** Nav/state events forwarded from the Rust host ('element' picks are
	 *  handled by the page, which owns the pending-message context). */
	handleEvent(p: Record<string, unknown>) {
		const kind = typeof p.kind === 'string' ? p.kind : '';
		const url = typeof p.url === 'string' ? p.url : '';
		switch (kind) {
			case 'nav-start':
				this.loading = true;
				if (url) this.url = url;
				break;
			case 'nav':
				this.loading = false;
				if (url) this.url = url;
				break;
			case 'state':
				if (url) this.url = url;
				if (typeof p.title === 'string') this.title = p.title;
				break;
			case 'pick-cancel':
				this.picking = false;
				break;
		}
	}
}

export const browser = new BrowserStore();
