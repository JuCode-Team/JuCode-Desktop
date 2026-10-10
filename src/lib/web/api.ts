// The JuCode API as the web app calls it (cross-origin, bearer token): JSON
// in and out, one retry with a fresh token on 401, and the server's error
// text as the thrown message.

import { API, auth, AuthError } from './auth.svelte';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public requestId = ''
	) {
		super(message);
	}
}

/** The error text in an error body: {error:{message}}, {error}, {message}, or the text. */
export function errorText(status: number, body: string): string {
	try {
		const j = JSON.parse(body);
		const e = j?.error;
		const msg = typeof e === 'string' ? e : (e?.message ?? j?.message);
		if (typeof msg === 'string' && msg) return msg;
	} catch {
		/* not JSON */
	}
	const text = body.trim();
	return text && !text.startsWith('<') ? text.slice(0, 300) : `HTTP ${status}`;
}

type Init = { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> };

/** A request with the signed-in token; `body` is sent as JSON unless it is FormData. */
export async function request(path: string, init: Init = {}): Promise<Response> {
	const send = async (force: boolean) => {
		const headers: Record<string, string> = { Authorization: `Bearer ${await auth.token(force)}`, ...init.headers };
		let body: BodyInit | undefined;
		if (init.body instanceof FormData) body = init.body;
		else if (init.body !== undefined) {
			headers['Content-Type'] = 'application/json';
			body = JSON.stringify(init.body);
		}
		return fetch(`${API}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, signal: init.signal });
	};
	let res = await send(false);
	if (res.status === 401) res = await send(true);
	if (res.status === 401) {
		await auth.signOut();
		throw new AuthError(401, 'signed out');
	}
	if (!res.ok) throw new ApiError(res.status, errorText(res.status, await res.text().catch(() => '')), res.headers.get('X-Request-Id') ?? '');
	return res;
}

export async function json<T>(path: string, init: Init = {}): Promise<T> {
	const res = await request(path, init);
	return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Public endpoints (no token). */
export async function publicJSON<T>(path: string): Promise<T> {
	const res = await fetch(`${API}${path}`);
	if (!res.ok) throw new ApiError(res.status, errorText(res.status, await res.text().catch(() => '')));
	const j = await res.json();
	return (j && typeof j === 'object' && 'data' in j ? j.data : j) as T;
}
