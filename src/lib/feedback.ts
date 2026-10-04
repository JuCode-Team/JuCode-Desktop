// A bug report's logs: the end of the engine's and the daemon's logs,
// with secrets and the user's name in paths taken out, gzipped into one
// attachment of the ticket (backend: application/gzip, at most 8 MB).

/** Patterns of secrets a log line can carry, and what replaces them. */
const SECRETS: [RegExp, string][] = [
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
	[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
	[/\b(sk|jcp|ghp|gho|xox[abp]|pk)[-_][A-Za-z0-9_-]{12,}/g, '[redacted-key]'],
	[/("?(?:access_token|refresh_token|id_token|api_key|apikey|api-key|authorization|password|secret|token|key)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, '$1[redacted]'],
	[/(\/Users\/|\/home\/)[^/\s"']+/g, '$1~'],
	[/([A-Za-z]:\\\\?Users\\\\?)[^\\\s"']+/g, '$1~']
];

export function redact(text: string): string {
	return SECRETS.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

/** The logs as one text, each under its name, redacted. */
export function logBundle(logs: { name: string; text: string }[]): string {
	return logs.map((log) => `===== ${log.name} =====\n${redact(log.text)}`).join('\n\n');
}

/** `text` gzipped, as a data URL a ticket attachment takes. */
export async function gzipDataURL(text: string): Promise<string> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
	const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return `data:application/gzip;base64,${btoa(binary)}`;
}
