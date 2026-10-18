// The conversation as MessageList lays it out: blocks, one per entry of the
// list. A block is a message's row, a run of tool calls shown as one card
// (with the reasoning that led to each call), or a finished turn's work
// folded under one line. Whatever a block holds, it is one block: the list
// windows, keys and anchors blocks, so it never cuts a card or a fold in
// two.
import type { Msg } from './chat.svelte';
import { parseDelivery } from './delivery';
import { turnFolds, type TurnFold } from './turnFold';
import { turnSummary, type TurnSummary } from './turnSummary';

/** A row: one message, or a run of tool calls (`run`, its first message
 *  `m`). */
export type Item = { key: string; m: Msg; run?: Msg[] };

export type Block = {
	key: string;
	/** The block's own row; absent on a fold. */
	item?: Item;
	/** A finished turn's work: its line, and the rows it folds. */
	fold?: { turn: TurnFold; items: Item[] };
	/** The turn's edited files, deliverables and proposals, under its last block. */
	summary?: TurnSummary;
};

export type Timeline = {
	blocks: Block[];
	/** Index of the block that shows each message shown. */
	blockOf: Map<Msg, number>;
	/** The fold each folded message is in. */
	foldOf: Map<Msg, TurnFold>;
	/** The turns folded (their user messages). */
	folded: Set<Msg>;
};

// Keys by message, not by position: a message keeps its row while others
// come and go around it.
const ids = new WeakMap<Msg, number>();
let nextId = 1;
export function keyOf(m: Msg): string {
	let id = ids.get(m);
	if (id === undefined) ids.set(m, (id = nextId++));
	return String(id);
}

export interface TimelineInput {
	/** Whether a message has a row at all. */
	shows: (m: Msg) => boolean;
	/** A tool call that is a row of its own (a subagent card), not part of a run. */
	ownRow: (m: Msg) => boolean;
	/** Finished turns fold their work. */
	foldTurns: boolean;
	/** The last turn is running. */
	busy: boolean;
}

export function timeline(messages: Msg[], { shows, ownRow, foldTurns, busy }: TimelineInput): Timeline {
	// Rows in order: consecutive tool calls (rows that show nothing don't
	// break them) with the reasoning before each call make one; reasoning no
	// call follows (yet) is a row of its own.
	const items: Item[] = [];
	let run: Msg[] = [];
	let thoughts: Msg[] = [];
	const flush = () => {
		if (run.length) items.push({ key: keyOf(run[0]!), m: run[0]!, run });
		for (const t of thoughts) items.push({ key: keyOf(t), m: t });
		run = [];
		thoughts = [];
	};
	for (const m of messages) {
		if (!shows(m)) continue;
		if (m.kind === 'tool' && !ownRow(m)) {
			run.push(...thoughts, m);
			thoughts = [];
		} else if (m.kind === 'reasoning') thoughts.push(m);
		else {
			flush();
			items.push({ key: keyOf(m), m });
		}
	}
	flush();

	const foldOf = new Map<Msg, TurnFold>();
	const folded = new Set<Msg>();
	if (foldTurns)
		for (const f of turnFolds(messages, shows, busy)) {
			folded.add(f.key);
			for (const m of f.members) foldOf.set(m, f);
		}

	// Blocks: a fold sits where its first row was; the rows it leaves out
	// (the final reply, plans, errors) follow it.
	const blocks: Block[] = [];
	const blockOf = new Map<Msg, number>();
	const turnOf: Msg[] = []; // each block's turn (its user message)
	let turn: Msg | undefined;
	const foldAt = new Map<TurnFold, number>();
	for (const it of items) {
		if (it.m.kind === 'user' && !parseDelivery(it.m.text)) turn = it.m;
		const f = foldOf.get(it.m);
		let at = blocks.length;
		if (f) {
			const found = foldAt.get(f);
			if (found !== undefined) at = found;
			else {
				foldAt.set(f, at);
				blocks.push({ key: `f${keyOf(f.key)}`, fold: { turn: f, items: [] } });
				turnOf.push(turn!);
			}
			blocks[at]!.fold!.items.push(it);
		} else {
			blocks.push({ key: it.key, item: it });
			turnOf.push(turn!);
		}
		for (const m of it.run ?? [it.m]) blockOf.set(m, at);
	}

	// Each finished turn's summary goes under its last block.
	const turns: Msg[][] = [];
	for (const m of messages) {
		if (m.kind === 'user' && !parseDelivery(m.text)) turns.push([m]);
		else turns.at(-1)?.push(m);
	}
	const lastOf = new Map<Msg, number>();
	turnOf.forEach((t, i) => t && lastOf.set(t, i));
	turns.forEach((msgs, i) => {
		if (busy && i === turns.length - 1) return;
		const at = lastOf.get(msgs[0]!);
		const summary = at === undefined ? null : turnSummary(msgs);
		if (summary) blocks[at!]!.summary = summary;
	});

	return { blocks, blockOf, foldOf, folded };
}
