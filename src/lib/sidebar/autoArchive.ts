// Sessions left alone for `days` settle themselves (prefs.autoArchiveDays;
// 0 never; a settled session is stored as archived). Kept: pinned ones, drafts, the one in front, any that wants the
// user (waits on them, failed, works, replied unseen), and any whose last
// activity is unknown (the daemon has not said yet). A session the user
// restored counts from then (`keptAt`), so it does not archive again at once.
import type { Session } from '$lib/types';
import { sessionStatus } from '$lib/sessionStatus';

export const DAY_MS = 86_400_000;

export function staleSessions(sessions: Session[], days: number, front: string, now = Date.now()): Session[] {
	if (!(days > 0)) return [];
	const cutoff = now - days * DAY_MS;
	return sessions.filter((s) => {
		if (s.archived || s.pinned || s.draft || s.id === front) return false;
		const last = Math.max(s.updatedAt ?? 0, s.keptAt ?? 0);
		return last > 0 && last < cutoff && !sessionStatus(s.chat);
	});
}
