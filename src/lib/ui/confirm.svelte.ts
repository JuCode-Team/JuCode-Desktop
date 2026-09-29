// In-app confirmation for destructive or irreversible actions, rendered by
// ui/ConfirmHost.svelte in the app's own modal (instead of the system dialog).
//   if (await confirm({ title, message, confirmLabel, danger: true })) …

export type ConfirmRequest = {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Destructive: the confirm button is red. */
	danger?: boolean;
};

class ConfirmQueue {
	current = $state<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
	#queue: (ConfirmRequest & { resolve: (ok: boolean) => void })[] = [];

	ask(req: ConfirmRequest): Promise<boolean> {
		return new Promise((resolve) => {
			this.#queue.push({ ...req, resolve });
			if (!this.current) this.current = this.#queue.shift() ?? null;
		});
	}

	answer(ok: boolean) {
		this.current?.resolve(ok);
		this.current = this.#queue.shift() ?? null;
	}
}

export const confirmQueue = new ConfirmQueue();
export const confirm = (req: ConfirmRequest) => confirmQueue.ask(req);
