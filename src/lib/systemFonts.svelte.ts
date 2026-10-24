// The font families installed on this computer (Rust `system_fonts`), read
// once, when Settings first needs them.
import { invoke } from '@tauri-apps/api/core';

export interface FontFamily {
	family: string;
	/** Fixed-width: offered for code and the terminal. */
	mono: boolean;
}

class SystemFonts {
	list = $state<FontFamily[]>([]);
	#asked = false;

	load() {
		if (this.#asked) return;
		this.#asked = true;
		invoke<FontFamily[]>('system_fonts')
			.then((list) => (this.list = list))
			.catch(() => (this.#asked = false));
	}
}

export const systemFonts = new SystemFonts();
