// Cross-component signal: "open a native TUI tab for this backend". The
// command palette raises it, the page reveals the right dock, and RightDock
// adds or re-activates the tab — same pattern as browser.openSignal.

import type { BackendId } from '$lib/backends/types';

class TuiOpenSignal {
	/** Bumped on every request so effects can react to repeated opens. */
	n = $state(0);
	backend: BackendId = 'jucode';

	open(backend: BackendId) {
		this.backend = backend;
		this.n++;
	}
}

export const tuiOpen = new TuiOpenSignal();
