// The web app's sidebar: hidden or shown on a wide screen (kept), a drawer
// on a narrow one.

const KEY = 'jucode-web-sidebar';

class Shell {
	collapsed = $state(false);
	drawer = $state(false);

	constructor() {
		try {
			this.collapsed = localStorage.getItem(KEY) === 'hidden';
		} catch {
			/* no storage */
		}
	}

	setCollapsed(v: boolean) {
		this.collapsed = v;
		try {
			localStorage.setItem(KEY, v ? 'hidden' : 'shown');
		} catch {
			/* no storage */
		}
	}

	/** The header's sidebar button: the drawer on a narrow screen, else show/hide. */
	toggle() {
		if (matchMedia('(max-width: 760px)').matches) this.drawer = !this.drawer;
		else this.setCollapsed(!this.collapsed);
	}
}

export const shell = new Shell();
