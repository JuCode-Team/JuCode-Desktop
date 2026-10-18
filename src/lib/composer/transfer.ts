// What a paste or drop brings into the composer: image files, which become
// attachments, or else its plain text. Nothing else (HTML, an <img>) ever goes
// into the editable text. Read while the event runs: a DataTransfer is
// emptied once its handler returns.

export interface Taken {
	images: { file: File; ext: string }[];
	text: string;
}

type Transfer = Pick<DataTransfer, 'getData'> & { items: Iterable<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>> };

export function takeTransfer(dt: Transfer): Taken {
	const images: Taken['images'] = [];
	for (const it of dt.items) {
		if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
		const file = it.getAsFile();
		if (file) images.push({ file, ext: (it.type.split('/')[1] || '').replace(/[^a-z0-9]/gi, '') || 'png' });
	}
	// A copied image file also carries its name as text: the image is what was meant.
	return { images, text: images.length ? '' : dt.getData('text/plain') };
}

// Pasted images take a moment to save. A send asked for meanwhile waits for
// them, or it would go without them (and, with no text, not at all).
export class PendingSaves {
	#count = 0;
	#then: (() => void) | null = null;

	async track(work: () => Promise<void>) {
		this.#count++;
		try {
			await work();
		} finally {
			if (--this.#count === 0 && this.#then) {
				const then = this.#then;
				this.#then = null;
				then();
			}
		}
	}

	/** `send` now, or once nothing is being saved. */
	send(send: () => void) {
		if (this.#count) this.#then = send;
		else send();
	}
}
