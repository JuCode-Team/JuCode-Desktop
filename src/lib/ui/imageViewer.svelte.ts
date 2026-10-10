// The full-size view of an image the user attached or sent (ImageViewerHost,
// mounted once in the root layout). An image is named by its path on the
// computer the engine runs on: the desktop opens the file itself, the remote
// page has it read there (`load`), as UserImage does.

export interface ViewerImage {
	path: string;
	/** Reads the image on the engine's computer (the remote page); absent: the desktop opens `path`. */
	load?: (path: string) => Promise<string>;
}

class ImageViewer {
	images = $state<ViewerImage[]>([]);
	index = $state(0);

	/** Shows `images` (the set the clicked one belongs to, for ← →) from `index`. */
	open(images: ViewerImage[], index = 0) {
		if (!images.length) return;
		this.images = images;
		this.index = Math.min(Math.max(index, 0), images.length - 1);
	}

	close() {
		this.images = [];
		this.index = 0;
	}

	step(by: number) {
		const n = this.images.length;
		if (n > 1) this.index = (this.index + by + n) % n;
	}
}

export const imageViewer = new ImageViewer();
