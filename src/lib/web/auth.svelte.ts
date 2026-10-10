// The web app's JuCode sign-in (app.jucode.net): OAuth authorization code +
// PKCE as the first-party client `jucode-web`, the same flow the Android app
// uses. The consent page is the console's /cli/oauth; tokens are bearer
// tokens kept in this browser's localStorage. The refresh token rotates on
// every use, so tabs refresh one at a time (Web Locks) and pick up what
// another tab stored.

export const API = 'https://api.jucode.net';
const CLIENT_ID = 'jucode-web';
const KEY = 'jucode-web-auth';
const PENDING = 'jucode-web-signin';

interface Tokens {
	access: string;
	refresh: string;
	/** ms since the epoch. */
	expiresAt: number;
}

export interface Account {
	id: string;
	email: string;
	nickname?: string;
	balance?: string | number;
	currency?: string;
	active_plan?: { name?: string; type?: string; expire_at?: string } | null;
}

const redirectURI = () => `${location.origin}/auth/callback`;

function read(): Tokens | null {
	try {
		const t = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		return t && typeof t.access === 'string' && typeof t.refresh === 'string' ? t : null;
	} catch {
		return null;
	}
}
function write(t: Tokens | null) {
	try {
		if (t) localStorage.setItem(KEY, JSON.stringify(t));
		else localStorage.removeItem(KEY);
	} catch {
		/* private mode: signed in for this page only */
	}
	auth.signedIn = !!t;
}

const b64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** The browser and OS as the account's device list shows it. */
function deviceName(): string {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '浏览器';
	const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
	return `JuCode 网页版 · ${browser}${os ? ` · ${os}` : ''}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
	const res = await fetch(`${API}/v1/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_id: CLIENT_ID, ...body })
	});
	const j = await res.json().catch(() => ({}));
	if (!res.ok || typeof j.access_token !== 'string') throw new AuthError(res.status, String(j.error ?? j.message ?? res.statusText));
	return { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
}

export class AuthError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

class Auth {
	signedIn = $state(read() !== null);
	account = $state<Account | null>(null);

	/** To the consent page; back at /auth/callback, then to `next`. */
	async signIn(next = location.pathname + location.search) {
		const verifier = random(48);
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
		const state = random(16);
		sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, next }));
		const q = new URLSearchParams({
			response_type: 'code',
			client_id: CLIENT_ID,
			redirect_uri: redirectURI(),
			code_challenge: b64url(digest),
			code_challenge_method: 'S256',
			state
		});
		location.assign(`${API}/cli/oauth?${q}`);
	}

	/** The consent page came back: exchange the code; where to go next. */
	async finish(params: URLSearchParams): Promise<string> {
		const pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as { verifier: string; state: string; next: string } | null;
		sessionStorage.removeItem(PENDING);
		const error = params.get('error');
		if (error) throw new AuthError(400, params.get('error_description') || error);
		const code = params.get('code');
		if (!pending || !code || params.get('state') !== pending.state) throw new AuthError(400, 'state');
		write(
			await tokenRequest({
				grant_type: 'authorization_code',
				code,
				redirect_uri: redirectURI(),
				code_verifier: pending.verifier,
				device_name: deviceName()
			})
		);
		return /^\/(?![/\\]|auth\/)/.test(pending.next ?? '') ? pending.next! : '/chat';
	}

	/** A valid access token: refreshed when about to expire (`force`: now). */
	async token(force = false): Promise<string> {
		const now = read();
		if (!now) throw new AuthError(401, 'signed out');
		if (!force && now.expiresAt - Date.now() > 60_000) return now.access;
		const refresh = async () => {
			// Another tab may have refreshed while this one waited.
			const latest = read();
			if (!latest) throw new AuthError(401, 'signed out');
			if (latest.refresh !== now.refresh && latest.expiresAt - Date.now() > 60_000) return latest.access;
			try {
				const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: latest.refresh });
				write(next);
				return next.access;
			} catch (e) {
				if (e instanceof AuthError && e.status >= 400 && e.status < 500) {
					write(null);
					this.account = null;
				}
				throw e;
			}
		};
		return navigator.locks ? navigator.locks.request('jucode-web-refresh', refresh) : refresh();
	}

	async signOut() {
		const t = read();
		write(null);
		this.account = null;
		if (t)
			await fetch(`${API}/v1/oauth/revoke`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ refresh_token: t.refresh })
			}).catch(() => {});
	}

	constructor() {
		if (typeof window === 'undefined') return;
		// Signed in or out in another tab.
		window.addEventListener('storage', (e) => {
			if (e.key !== KEY) return;
			this.signedIn = read() !== null;
			if (!this.signedIn) this.account = null;
		});
	}
}

export const auth = new Auth();
