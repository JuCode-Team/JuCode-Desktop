// The remote Desk tab's items: questions and actions waiting for the user,
// and the agents' reports, named by one key each (the list's selection and
// the page that shows it).

export type DeskKind = 'question' | 'action' | 'report';

export function deskKey(kind: DeskKind, id: string): string {
	return `${kind}:${id}`;
}

export function parseDeskKey(key: string): { kind: DeskKind; id: string } {
	const cut = key.indexOf(':');
	return { kind: key.slice(0, cut) as DeskKind, id: key.slice(cut + 1) };
}

export { when } from '$lib/time';
