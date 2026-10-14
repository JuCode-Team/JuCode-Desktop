import { invoke } from '@tauri-apps/api/core';
import { t } from '$lib/i18n';
import { prefs } from '$lib/prefs.svelte';

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
	/** Why the last navigation failed; cleared by the next one. */
	error = $state('');
	/** URL waiting for the panel placeholder to become visible/measurable. */
	pendingUrl = $state<string | null>(null);
	/** Bumped by open() so the page/dock can reveal the browser tab. */
	openSignal = $state(0);
	/** Native webviews always render above the DOM, so modals hide the browser
	 *  by collapsing its bounds to zero while they're open… */
	suspended = false;
	#modal = false;
	/** …and so does any floating layer (menu, popover, viewer, drag preview)
	 *  over its area, while it is there (`overBrowser`). */
	#covering = new Set<HTMLElement>();
	/** Where the native webview sits (window points), null while hidden: DOM
	 *  overlays (corner notices) keep clear of it. */
	shown = $state<Rect | null>(null);
	#lastRect: Rect | null = null;
	#applied: Rect | null = null;

	/** Open a URL: navigate the live webview, or remember it until the panel
	 *  placeholder reports usable bounds. Always signals the UI to reveal the tab. */
	open(url: string) {
		this.error = '';
		if (this.created) {
			this.url = url;
			this.loading = true;
			invoke('browser_navigate', { url }).catch((e) => this.#failed(url, e));
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
					this.shown = rect;
				} catch (e) {
					this.#failed(url, e);
				}
			}
			return;
		}
		this.#apply(this.suspended ? { x: 0, y: 0, w: 0, h: 0 } : rect);
	}

	#failed(url: string, e: unknown) {
		this.loading = false;
		this.url = url;
		this.error = String(e);
	}

	#apply(r: Rect) {
		const a = this.#applied;
		if (a && a.x === r.x && a.y === r.y && a.w === r.w && a.h === r.h) return;
		this.#applied = r;
		this.shown = r.w > 1 && r.h > 1 ? r : null;
		invoke('browser_set_bounds', { x: r.x, y: r.y, width: r.w, height: r.h }).catch(() => {});
	}

	/** A modal is open (the page) or a floating layer covers the browser. */
	setSuspended(modal: boolean) {
		this.#modal = modal;
		this.#resuspend();
	}

	/** A floating layer `el` was laid out at `rect` (CSS px; null: gone). */
	cover(el: HTMLElement, rect: DOMRect | null) {
		const r = this.#lastRect;
		const z = prefs.zoom || 1;
		// The webview's own place, in CSS px, compared with the layer's.
		const over =
			!!rect &&
			!!r &&
			rect.width > 0 &&
			rect.height > 0 &&
			rect.left < (r.x + r.w) / z &&
			rect.right > r.x / z &&
			rect.top < (r.y + r.h) / z &&
			rect.bottom > r.y / z;
		if (over) this.#covering.add(el);
		else this.#covering.delete(el);
		this.#resuspend();
	}

	#resuspend() {
		const s = this.#modal || this.#covering.size > 0;
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
		this.shown = null;
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
				this.error = '';
				if (url) this.url = url;
				break;
			case 'nav':
				this.loading = false;
				this.error = '';
				if (url) this.url = url;
				break;
			case 'nav-error':
				this.loading = false;
				this.error = t('dock.browser.loadFailed', { url });
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

/** Marks a floating layer: while it overlaps the native browser (which draws
 *  above every DOM element), the browser steps aside. */
export function overBrowser(node: HTMLElement) {
	const check = () => browser.cover(node, node.isConnected ? node.getBoundingClientRect() : null);
	const ro = new ResizeObserver(check);
	ro.observe(node);
	// Placed after mount (anchored popovers measure themselves first).
	const raf = requestAnimationFrame(check);
	check();
	return {
		destroy() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			browser.cover(node, null);
		}
	};
}
