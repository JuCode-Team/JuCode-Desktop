// Anonymous usage counts: how often a few things happen in the app, by day
// (app start, a session started on a backend, a requirement noted or
// started, a dispatch, a bug report, an error of some kind). No content, no
// account: a random id per install. Kept on this computer and sent now and
// then (and again later if offline); the server adds them up. Off in
// Settings → General. Shown once on first start.

import { prefs } from './prefs.svelte';

const KEY = 'jucode-telemetry';
/** Sent at start and then this often. */
const EVERY_MS = 30 * 60 * 1000;
/** Days kept while unsent (the server takes the last week). */
const KEEP_DAYS = 7;

type State = {
	install: string;
	/** Day ("2026-10-04", UTC) → event → count. */
	days: Record<string, Record<string, number>>;
	/** The first-start notice was shown. */
	noticed?: boolean;
};

type Send = (install: string, days: { day: string; events: Record<string, number> }[]) => Promise<void>;

const today = () => new Date().toISOString().slice(0, 10);

function load(): State {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as State | null;
		if (saved?.install) return { ...saved, days: saved.days ?? {} };
	} catch {
		/* no or bad state: start over */
	}
	return { install: crypto.randomUUID(), days: {} };
}

export class Telemetry {
	#state: State | null = null;
	#send: Send | null = null;
	#timer: ReturnType<typeof setInterval> | undefined;
	#sending = false;

	get #s(): State {
		this.#state ??= load();
		return this.#state;
	}

	#save() {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.#s));
		} catch {
			/* full or private: counts live until the app closes */
		}
	}

	/** Counts `event` today (nothing while turned off). */
	track(event: string) {
		if (!prefs.telemetry) return;
		const day = (this.#s.days[today()] ??= {});
		day[event] = (day[event] ?? 0) + 1;
		this.#save();
	}

	/** Starts counting and sending; true the first time (show the notice). */
	start(send: Send): boolean {
		this.#send = send;
		const first = !this.#s.noticed;
		this.#s.noticed = true;
		this.#save();
		this.track('app_start');
		void this.flush();
		clearInterval(this.#timer);
		this.#timer = setInterval(() => void this.flush(), EVERY_MS);
		return first;
	}

	/** Sends what is kept; what was sent is dropped, the rest is kept. */
	async flush() {
		const send = this.#send;
		if (!send || this.#sending) return;
		if (!prefs.telemetry) {
			this.#s.days = {};
			this.#save();
			return;
		}
		const oldest = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
		const days = Object.entries(this.#s.days)
			.filter(([day, events]) => day >= oldest && Object.keys(events).length)
			.map(([day, events]) => ({ day, events: { ...events } }));
		if (!days.length) return;
		this.#sending = true;
		try {
			await send(this.#s.install, days);
			for (const { day, events } of days) {
				const kept = this.#s.days[day] ?? {};
				for (const [event, n] of Object.entries(events)) {
					kept[event] = (kept[event] ?? 0) - n;
					if (kept[event] <= 0) delete kept[event];
				}
				if (!Object.keys(kept).length) delete this.#s.days[day];
			}
			for (const day of Object.keys(this.#s.days)) if (day < oldest) delete this.#s.days[day];
			this.#save();
		} catch {
			/* offline or refused: sent next time */
		} finally {
			this.#sending = false;
		}
	}
}

export const telemetry = new Telemetry();
