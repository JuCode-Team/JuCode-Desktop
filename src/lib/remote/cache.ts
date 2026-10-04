// What the remote page last saw, kept on the phone so a weak network does
// not mean a blank page: each computer's lists (localStorage, small) and the
// conversations opened recently (IndexedDB, larger). Shown at once on the
// next visit and replaced by what the computer sends once it is reached.

const LISTS = 'jucode-remote-lists:';
const DB = 'jucode-remote';
const STORE = 'sessions';
/** Conversations kept; the least recently opened go first. */
const KEEP_SESSIONS = 40;
/** Messages kept of one conversation (its end). */
const KEEP_MESSAGES = 300;

export function loadLists<T>(host: string): T | null {
	try {
		const raw = localStorage.getItem(LISTS + host);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

export function saveLists(host: string, lists: unknown) {
	try {
		localStorage.setItem(LISTS + host, JSON.stringify(lists));
	} catch {
		/* full or private mode: the lists come from the computer next time */
	}
}

export function forgetLists(host: string) {
	try {
		localStorage.removeItem(LISTS + host);
	} catch {
		/* nothing kept */
	}
}

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
	db ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return db;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

type Kept<T> = { at: number; messages: T[]; title?: string };

/** A conversation as last seen on this phone (`host`:`session`). */
export async function loadSession<T>(key: string): Promise<Kept<T> | null> {
	if (typeof indexedDB === 'undefined') return null;
	try {
		const store = (await open()).transaction(STORE).objectStore(STORE);
		return ((await done(store.get(key))) as Kept<T> | undefined) ?? null;
	} catch {
		return null;
	}
}

export async function saveSession<T>(key: string, messages: T[], title?: string) {
	if (typeof indexedDB === 'undefined' || !messages.length) return;
	try {
		const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
		// Svelte state proxies cannot be cloned into IndexedDB: plain copies.
		const kept: Kept<T> = { at: Date.now(), messages: JSON.parse(JSON.stringify(messages.slice(-KEEP_MESSAGES))), title };
		await done(store.put(kept, key));
		const keys = (await done(store.getAllKeys())) as string[];
		if (keys.length <= KEEP_SESSIONS) return;
		const all = (await done(store.getAll())) as Kept<T>[];
		const oldest = keys
			.map((k, i) => [k, all[i].at] as const)
			.sort((a, b) => a[1] - b[1])
			.slice(0, keys.length - KEEP_SESSIONS);
		const write = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
		for (const [k] of oldest) write.delete(k);
	} catch {
		/* not kept: the computer sends it again next time */
	}
}
