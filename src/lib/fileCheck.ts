// Whether a file a reply names exists, for showing its link (Markdown.svelte):
// a path that resolves to no file reads as plain text. The conversation that
// knows where its paths resolve provides the check by context.

import { getContext, setContext } from 'svelte';

const KEY = Symbol('file-check');
/** A missing file may be written soon (the agent names it, then creates it):
 *  ask again after this long. Found files stay found. */
const RETRY_MS = 20_000;

export interface FileCheck {
	/** The answer already known, if any. */
	known(href: string): boolean | undefined;
	check(href: string): Promise<boolean>;
}

export function provideFileCheck(resolve: (href: string) => Promise<boolean>) {
	const answers = new Map<string, { ok: boolean; at: number }>();
	const asking = new Map<string, Promise<boolean>>();
	const known = (href: string) => {
		const a = answers.get(href);
		return a && (a.ok || performance.now() - a.at < RETRY_MS) ? a.ok : undefined;
	};
	setContext<FileCheck>(KEY, {
		known,
		check(href) {
			let p = asking.get(href);
			if (!p) {
				p = resolve(href)
					.catch(() => false)
					.then((ok) => {
						answers.set(href, { ok, at: performance.now() });
						asking.delete(href);
						return ok;
					});
				asking.set(href, p);
			}
			return p;
		}
	});
}

export const useFileCheck = () => getContext<FileCheck | undefined>(KEY);
