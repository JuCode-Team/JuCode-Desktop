// The composer's attachments, and the placeholder each leaves in the text
// where it was added: [附件#id], shown in the editor as a chip naming it
// (Composer). Deleting the chip drops the attachment, and removing the
// attachment drops its chip. On send a placeholder becomes the image's
// [图片 #n] (n: its place among the sent images, which MessageList shows as
// a chip) or the file's name; the files themselves go with the message as
// attachments (`files`), not as text.

export interface Attachment {
	id: number;
	path: string;
	image: boolean;
	/** Bytes, when known (a pasted image). */
	size?: number;
}

export const attachmentToken = (id: number) => `[附件#${id}]`;
export const ATTACHMENT_TOKEN = /\[附件#(\d+)\]/g;

/** The attachment ids whose placeholder is in `text`. */
export function tokenIds(text: string): Set<number> {
	return new Set([...text.matchAll(ATTACHMENT_TOKEN)].map((m) => Number(m[1])));
}

const fileName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

/** `text` with its placeholders expanded: an image's [图片 #n], a file's name. */
export function expandAttachments(text: string, attachments: Attachment[]): string {
	const images = attachments.filter((a) => a.image);
	return text.replace(ATTACHMENT_TOKEN, (_, id: string) => {
		const a = attachments.find((x) => x.id === Number(id));
		if (!a) return '';
		return a.image ? `[图片 #${images.indexOf(a) + 1}]` : fileName(a.path);
	});
}

export function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
