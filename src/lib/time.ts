// Times shown on the workbench, 24-hour everywhere: `09:05` today,
// `10/9 09:05` this year, `2025/10/9 09:05` before.

const clock: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

export function when(ms: number, now = new Date()): string {
	const d = new Date(ms);
	const time = d.toLocaleTimeString(undefined, clock);
	if (d.toDateString() === now.toDateString()) return time;
	const date = `${d.getMonth() + 1}/${d.getDate()}`;
	return d.getFullYear() === now.getFullYear() ? `${date} ${time}` : `${d.getFullYear()}/${date} ${time}`;
}

/** How long ago, as a sidebar card shows it: `1m` (at least), `5h`, `3d`. */
export function ago(ms: number, now = Date.now()): string {
	const m = Math.max(1, Math.floor((now - ms) / 60_000));
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
