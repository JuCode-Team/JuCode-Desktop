// External editors (VS Code, Zed, Xcode, JetBrains IDEs…) a project or file
// opens in. Which are installed comes from the app (editors.rs); the one
// last chosen is remembered on this computer only — another computer has
// other editors installed, so it is not synced.
import { listEditors, openInEditor, type EditorInfo } from '$lib/protocol';

const KEY = 'jucode-editor';

class Editors {
	list = $state<EditorInfo[]>([]);
	#chosen = $state(typeof localStorage === 'undefined' ? '' : (localStorage.getItem(KEY) ?? ''));

	/** The editor a plain click opens: the last chosen while it is installed, else the first found. */
	get preferred(): EditorInfo | undefined {
		return this.list.find((e) => e.id === this.#chosen) ?? this.list[0];
	}

	/** Look again (an editor may have been installed since). */
	async load() {
		this.list = await listEditors().catch((e) => {
			console.error('list editors failed', e);
			return [];
		});
	}

	/** Open in `id` and make it the preferred one. Rejects with the reason it could not. */
	async open(id: string, path: string, at?: { line?: number; col?: number }, root?: string) {
		this.#chosen = id;
		localStorage.setItem(KEY, id);
		await openInEditor(id, path, at, root);
	}
}

export const editors = new Editors();
