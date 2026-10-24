// The composer's attachments, and the placeholder each leaves in the text
// where it was added: [附件#id], shown in the editor as a chip naming it
// (Composer). Deleting the chip drops the attachment, and removing the
// attachment drops its chip. On send a placeholder becomes the image's
// [图片 #n] (n: its place among the sent images, which MessageList shows as
// a chip) or the file's mention; a file whose chip is gone is mentioned at
// the end, as before chips.

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

/** `text` with its placeholders expanded; `files`: the files no placeholder
 *  placed, to mention after the text. */
export function expandAttachments(text: string, attachments: Attachment[], mention: (path: string) => string): { content: string; files: string[] } {
	const images = attachments.filter((a) => a.image);
	const placed = new Set<number>();
	const content = text.replace(ATTACHMENT_TOKEN, (_, id: string) => {
		const a = attachments.find((x) => x.id === Number(id));
		if (!a) return '';
		placed.add(a.id);
		return a.image ? `[图片 #${images.indexOf(a) + 1}]` : mention(a.path);
	});
	return { content, files: attachments.filter((a) => !a.image && !placed.has(a.id)).map((a) => a.path) };
}

export function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
