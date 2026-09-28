import { openUrl } from '@tauri-apps/plugin-opener';

/** Opens a link in the system browser: through Tauri in the desktop app,
 *  in a new tab when the page runs in a plain browser (the remote page). */
export function openExternal(href: string) {
	if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
		openUrl(href).catch(() => {});
	} else {
		window.open(href, '_blank', 'noopener');
	}
}
