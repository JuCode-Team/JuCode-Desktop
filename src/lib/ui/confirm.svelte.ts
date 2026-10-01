// In-app confirmation for destructive or irreversible actions, rendered by
// ui/ConfirmHost.svelte in the app's own modal (instead of the system dialog).
//   if (await confirm({ title, message, confirmLabel, danger: true })) …
// With `dontAskKey` the dialog offers 不再提醒; once the user confirms with it
// ticked, later requests with that key answer yes without asking.

export type ConfirmRequest = {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Destructive: the confirm button is red. */
	danger?: boolean;
	/** Offer "don't ask again" for this kind of request (see above). */
	dontAskKey?: string;
};

const dontAskStorage = (key: string) => `jucode-dont-ask:${key}`;

function skipped(key: string | undefined): boolean {
	if (!key) return false;
	try {
		return localStorage.getItem(dontAskStorage(key)) === '1';
	} catch {
		return false;
	}
}

class ConfirmQueue {
	current = $state<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
	#queue: (ConfirmRequest & { resolve: (ok: boolean) => void })[] = [];

	ask(req: ConfirmRequest): Promise<boolean> {
		if (skipped(req.dontAskKey)) return Promise.resolve(true);
		return new Promise((resolve) => {
			this.#queue.push({ ...req, resolve });
			if (!this.current) this.current = this.#queue.shift() ?? null;
		});
	}

	/** `dontAsk`: the user ticked 不再提醒 (kept only when they confirmed). */
	answer(ok: boolean, dontAsk = false) {
		const key = this.current?.dontAskKey;
		if (ok && dontAsk && key) {
			try {
				localStorage.setItem(dontAskStorage(key), '1');
			} catch {
				/* storage unavailable: it asks again next time */
			}
		}
		this.current?.resolve(ok);
		this.current = this.#queue.shift() ?? null;
	}
}

export const confirmQueue = new ConfirmQueue();
export const confirm = (req: ConfirmRequest) => confirmQueue.ask(req);
