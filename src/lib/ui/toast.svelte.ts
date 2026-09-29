// App-wide transient notices, shown by ui/Toaster.svelte at the top of the
// window. Use for the outcome of an action the user took (failed to archive,
// copied, saved); state that lasts belongs in the panel it describes.

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export type Toast = {
	id: number;
	tone: ToastTone;
	message: string;
	/** Optional button, e.g. retry or open settings. */
	action?: { label: string; run: () => void };
};

type Options = { action?: Toast['action']; /** ms; 0 keeps it until closed. */ duration?: number };

const DURATION: Record<ToastTone, number> = { info: 4000, success: 3000, warn: 6000, error: 8000 };
/** Older notices beyond this are dropped. */
const MAX = 4;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

class Toasts {
	/** Newest first. */
	items = $state<Toast[]>([]);

	show(tone: ToastTone, message: string, opts: Options = {}): number {
		// The same notice again (e.g. a repeated failure) restarts its timer
		// instead of stacking a copy.
		const same = this.items.find((t) => t.tone === tone && t.message === message);
		if (same) this.dismiss(same.id);
		const id = nextId++;
		this.items = [{ id, tone, message, action: opts.action }, ...this.items].slice(0, MAX);
		const ms = opts.duration ?? DURATION[tone];
		if (ms > 0) timers.set(id, setTimeout(() => this.dismiss(id), ms));
		return id;
	}

	info = (message: string, opts?: Options) => this.show('info', message, opts);
	success = (message: string, opts?: Options) => this.show('success', message, opts);
	warn = (message: string, opts?: Options) => this.show('warn', message, opts);
	error = (message: string, opts?: Options) => this.show('error', message, opts);

	dismiss(id: number) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toast = new Toasts();
