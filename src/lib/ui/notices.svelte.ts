// Notices in the bottom-right corner (ui/CornerNotices.svelte): something the app
// noticed on its own and offers to act on (a dev server came up). They close
// by themselves; the pointer over one holds it open. The outcome of the
// user's own action is a toast instead (toast.svelte.ts).

export type Notice = {
	id: number;
	title: string;
	/** A second line, e.g. a URL. */
	detail?: string;
	action?: { label: string; run: () => void };
	/** Notices with the same key replace each other. */
	key?: string;
};

type Options = Omit<Notice, 'id' | 'title'> & { /** ms; 0 keeps it until closed. */ duration?: number };

const DURATION = 8000;
const MAX = 3;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const left = new Map<number, number>();
const started = new Map<number, number>();

class Notices {
	/** Oldest first: the newest sits at the bottom. */
	items = $state<Notice[]>([]);

	show(title: string, opts: Options = {}): number {
		const { duration = DURATION, ...rest } = opts;
		const same = rest.key ? this.items.find((n) => n.key === rest.key) : undefined;
		if (same) this.dismiss(same.id);
		const id = nextId++;
		this.items = [...this.items, { id, title, ...rest }].slice(-MAX);
		if (duration > 0) {
			left.set(id, duration);
			this.resume(id);
		}
		return id;
	}

	/** The pointer is over it: stop its clock. */
	hold(id: number) {
		const timer = timers.get(id);
		if (timer === undefined) return;
		clearTimeout(timer);
		timers.delete(id);
		left.set(id, (left.get(id) ?? 0) - (Date.now() - (started.get(id) ?? Date.now())));
	}

	resume(id: number) {
		const ms = left.get(id);
		if (ms === undefined || timers.has(id)) return;
		started.set(id, Date.now());
		timers.set(id, setTimeout(() => this.dismiss(id), Math.max(ms, 1500)));
	}

	dismiss(id: number) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		left.delete(id);
		started.delete(id);
		this.items = this.items.filter((n) => n.id !== id);
	}

	dismissKey(key: string) {
		for (const n of this.items) if (n.key === key) this.dismiss(n.id);
	}
}

export const notices = new Notices();
