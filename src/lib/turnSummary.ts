// What a turn leaves behind, shown under its final reply (MessageList): the
// files it edited, the deliverables the agent presented (`present_files`)
// and the scheduled tasks it proposed (`propose_schedule`). The two tools
// render only here, never as tool cards.
import type { Msg } from './chat.svelte';
import { diffStat, editedPaths, isEdit, parseToolOutput } from './toolSummary';
import type { Repeat } from './schedules';

export const USER_TOOLS = new Set(['present_files', 'propose_schedule']);

export interface EditedFile {
	path: string;
	add: number;
	del: number;
}

export interface Artifact {
	path: string;
	description: string;
	size: number;
}

export interface Proposal {
	/** Ties the card to the task created from it (the task's `origin`). */
	id: string;
	name: string;
	prompt: string;
	repeat: Repeat;
	time: string;
	days?: number[];
	date?: string;
}

/** A session this turn started (`start_session`). */
export interface ChildSession {
	session: string;
	engine: string;
	title: string;
}

export interface TurnSummary {
	edited: EditedFile[];
	artifacts: Artifact[];
	proposals: Proposal[];
	children: ChildSession[];
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Lines each file of an edit gained and lost: the per-file counts the
 *  engine gave, a multi-file diff split at its `+++` headers, or the whole
 *  diff for a one-file edit. */
export function fileStats(parsed: Record<string, unknown> | null): EditedFile[] {
	if (!parsed || parsed.error) return [];
	if (Array.isArray(parsed.files))
		return parsed.files.flatMap((f) => (f && typeof f === 'object' && str(f.path) ? [{ path: str(f.path), add: num(f.add), del: num(f.del) }] : []));
	const diff = str(parsed.diff);
	if (/^--- .*\n\+\+\+ /m.test(diff)) {
		const out: EditedFile[] = [];
		let cur: EditedFile | null = null;
		let from = '';
		for (const line of diff.split('\n')) {
			if (line.startsWith('--- ')) from = line.slice(4).replace(/^a\//, '');
			else if (line.startsWith('+++ ')) {
				const to = line.slice(4).replace(/^b\//, '');
				cur = { path: to === '/dev/null' ? from : to, add: 0, del: 0 };
				out.push(cur);
			} else if (cur && line.startsWith('+')) cur.add++;
			else if (cur && line.startsWith('-')) cur.del++;
		}
		if (out.length) return out;
	}
	const paths = editedPaths(parsed);
	const stat = diffStat(parsed) ?? { add: 0, del: 0 };
	return paths.length ? [{ path: paths[0]!, ...stat }] : [];
}

/** The summary of one turn's messages (null: nothing to show). */
export function turnSummary(turn: Msg[]): TurnSummary | null {
	const edited = new Map<string, EditedFile>();
	const artifacts = new Map<string, Artifact>();
	const proposals: Proposal[] = [];
	const children: ChildSession[] = [];
	for (const m of turn) {
		if (m.kind !== 'tool' || m.running) continue;
		const parsed = parseToolOutput(m.output);
		if (m.name === 'present_files') {
			const files = Array.isArray(parsed?.files) ? parsed.files : [];
			for (const f of files) {
				if (!f || typeof f !== 'object' || !str(f.path)) continue;
				// Presented again: the newer description, in its new place.
				artifacts.delete(str(f.path));
				artifacts.set(str(f.path), { path: str(f.path), description: str(f.description), size: num(f.size) });
			}
		} else if (m.name === 'start_session') {
			if (parsed && str(parsed.session)) children.push({ session: str(parsed.session), engine: str(parsed.engine), title: str(parsed.title) });
		} else if (m.name === 'propose_schedule') {
			if (parsed && str(parsed.id) && str(parsed.name)) proposals.push(parsed as unknown as Proposal);
		} else if (isEdit(m.name) && !m.isError) {
			for (const f of fileStats(parsed)) {
				const seen = edited.get(f.path);
				if (seen) {
					seen.add += f.add;
					seen.del += f.del;
				} else edited.set(f.path, { ...f });
			}
		}
	}
	if (!edited.size && !artifacts.size && !proposals.length && !children.length) return null;
	return { edited: [...edited.values()], artifacts: [...artifacts.values()], proposals, children };
}

/** `path` relative to `root` when it lies inside it. */
export function relativeTo(path: string, root: string): string {
	const base = root.replace(/[\\/]+$/, '');
	return base && path.startsWith(base + '/') ? path.slice(base.length + 1) : path;
}
