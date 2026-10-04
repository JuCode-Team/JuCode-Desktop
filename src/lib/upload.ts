// Sending a file to the computer (daemon `upload`, JuCode-CLI
// docs/daemon-protocol.md "Uploads"): base64 chunks over the daemon
// connection, each acknowledged before the next, so through the relay the
// file stays end to end encrypted and the session's own frames keep flowing.
// The daemon replies to the last chunk with the file's path on the computer.

import type { DaemonClient } from '$lib/daemon';

/** Bytes per chunk (before base64). */
const CHUNK = 256 * 1024;
/** Photos are scaled to fit this many pixels on their long side. */
const MAX_SIDE = 2048;
/** Images up to this size and side are sent as they are. */
const KEEP_BYTES = 1.5 * 1024 * 1024;

export interface Uploaded {
	path: string;
	name: string;
	size: number;
	image: boolean;
}

function toBase64(bytes: Uint8Array): string {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

/** Uploads `blob` as `name`; `onProgress` gets the bytes sent so far. */
export async function uploadFile(
	daemon: Pick<DaemonClient, 'request'>,
	blob: Blob,
	name: string,
	onProgress?: (sent: number, total: number) => void
): Promise<Uploaded> {
	let upload: string | undefined;
	let offset = 0;
	do {
		const end = Math.min(offset + CHUNK, blob.size);
		const data = toBase64(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
		const last = end >= blob.size;
		const reply = await daemon.request(
			upload ? { op: 'upload', upload, offset, data, last } : { op: 'upload', name, data, last }
		);
		upload = String(reply.upload);
		offset = end;
		onProgress?.(offset, blob.size);
		if (last) return reply as unknown as Uploaded;
	} while (offset < blob.size);
	throw new Error('upload ended early');
}

/** A photo scaled down (JPEG) when it is large; anything else as it is. */
export async function shrinkImage(file: File): Promise<{ blob: Blob; name: string }> {
	const same = { blob: file as Blob, name: file.name };
	if (!file.type.startsWith('image/') || file.type === 'image/gif' || typeof createImageBitmap !== 'function') return same;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return same; // a format this browser cannot decode (HEIC): sent as it is
	}
	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	if (scale === 1 && file.size <= KEEP_BYTES) return same;
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
	if (!blob || blob.size >= file.size) return same;
	return { blob, name: file.name.replace(/\.[^.]*$/, '') + '.jpg' };
}

/** Shrinks (images) and uploads `file`. */
export async function sendFile(
	daemon: Pick<DaemonClient, 'request'>,
	file: File,
	onProgress?: (sent: number, total: number) => void
): Promise<Uploaded> {
	const { blob, name } = await shrinkImage(file);
	return uploadFile(daemon, blob, name || 'file', onProgress);
}
