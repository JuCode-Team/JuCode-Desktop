// The web app's conversations: kept in the cloud (/v1/oauth/chat/*, shared
// with the Android app and the console), replies streamed from
// /v1/oauth/chat/llm/* (only the models the admin opened to chat, each in
// its own protocol: protocol.ts), web search as tool calls the page runs (/tools/v1/*), deep research
// as a server task the page follows. Ported from the Android app's
// ChatEngine so both behave alike.

import { t } from '$lib/i18n';
import { ApiError, json, request } from './api';
import { parseArgs, protoOf, requestBody, streamRound, wireMessage, withToolRound, type Proto, type ToolCall } from './protocol';
import { models, type ChatModel } from './models.svelte';

export interface Attachment {
	id: string;
	name: string;
	mime: string;
	size?: number;
}
export interface Source {
	title: string;
	url: string;
}
export interface ResearchState {
	id: string;
	status: string;
	steps: { kind: string; text: string }[];
}
export interface Usage {
	input: number;
	output: number;
	reasoning: number;
	cached: number;
	/** What the reply cost, in `currency` (CNY / USD); '' until settled. */
	cost: string;
	currency: string;
}

export interface WebMsg {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning: string;
	/** How long it thought, ms (0: unknown). */
	thoughtMs: number;
	model: string;
	status: 'complete' | 'incomplete' | 'error' | 'streaming';
	error: string;
	kind: 'chat' | 'research' | 'image';
	attachments: Attachment[];
	usage: Usage | null;
	searches: string[];
	sources: Source[];
	/** What its web searches and page reads found (shortened), kept with it
	 *  so later turns still have it, also after a reply cut short. */
	found: Found[];
	research: ResearchState | null;
	createdAt: string;
}

/** One web search or page read of a reply, and what it returned. */
export interface Found {
	tool: string;
	/** The query or the URL. */
	arg: string;
	text: string;
}

export interface ConversationInfo {
	id: string;
	title: string;
	model: string;
	updatedAt: string;
}

export interface SendOptions {
	model: string;
	effort: string;
	search: boolean;
	research: boolean;
}

const MAX_TOOL_ROUNDS = 6;
/** Searches and page reads in one reply: past it the model must answer
 *  with what it has (models otherwise search on and on). */
const MAX_TOOL_CALLS = 10;
const MAX_TOOL_RESULT = 24_000;
/** What is kept of each search or page read for later turns. */
const FOUND_KEEP = 3_000;
const IMAGE_TOKENS = 1_200;

/** Rough tokens: one per CJK character, four ASCII characters per token. */
export function estimate(text: string): number {
	let ascii = 0;
	let other = 0;
	for (const ch of text) if ((ch.codePointAt(0) ?? 0) < 128) ascii++;
	else other++;
	return Math.floor(ascii / 4) + other;
}

function systemPrompt(search: boolean): string {
	const today = new Date().toISOString().slice(0, 10);
	let s = `你是 JuCode 的 AI 助手。今天是 ${today}。回答使用用户的语言，结构清晰，必要时使用 Markdown；数学公式用 $…$（两侧与文字之间留一个空格）或 $$…$$ 书写。`;
	if (search)
		s += `\n你可以调用 web_search 搜索网页、web_fetch 阅读网页全文。涉及最新信息或需要出处时先搜索，回答中用 Markdown 链接注明来源。一次回答最多联网 ${MAX_TOOL_CALLS} 次：先想清楚要查什么，资料够用就直接回答，不要反复换词搜索同一件事。`;
	return s;
}

// ── the cloud's message shape ──
interface CloudMessage {
	id: string;
	role: 'user' | 'assistant';
	content?: string;
	reasoning?: string;
	model?: string;
	status?: string;
	error?: string;
	kind?: string;
	attachments?: Attachment[];
	usage?: { input_tokens?: number; output_tokens?: number; cached_tokens?: number; reasoning_tokens?: number; cost?: string } | null;
	meta?: { searches?: string[]; sources?: Source[]; found?: Found[]; research_id?: string; thought_ms?: number; currency?: string } | null;
	created_at?: string;
}

function fromCloud(m: CloudMessage): WebMsg {
	const meta = m.meta ?? {};
	return {
		id: m.id,
		role: m.role,
		content: m.content ?? '',
		reasoning: m.reasoning ?? '',
		thoughtMs: meta.thought_ms ?? 0,
		model: m.model ?? '',
		status: m.status === 'error' ? 'error' : m.status === 'incomplete' ? 'incomplete' : 'complete',
		error: m.error ?? '',
		kind: m.kind === 'research' ? 'research' : m.kind === 'image' ? 'image' : 'chat',
		attachments: m.attachments ?? [],
		usage: m.usage
			? {
					input: m.usage.input_tokens ?? 0,
					output: m.usage.output_tokens ?? 0,
					reasoning: m.usage.reasoning_tokens ?? 0,
					cached: m.usage.cached_tokens ?? 0,
					cost: m.usage.cost ?? '',
					currency: meta.currency ?? ''
				}
			: null,
		searches: meta.searches ?? [],
		sources: meta.sources ?? [],
		found: meta.found ?? [],
		research: meta.research_id ? { id: meta.research_id, status: '', steps: [] } : null,
		createdAt: m.created_at ?? new Date().toISOString()
	};
}

// What the chat store accepts (biz.ValidateChatMessage): over these a
// message is refused whole.
const META_MAX_BYTES = 60_000;
const ERROR_MAX = 1_000;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

function toCloud(m: WebMsg) {
	// Over the store's limit: the oldest findings go first, then sources.
	let found = m.found;
	let sources = m.sources;
	while (found.length && bytes({ found, sources, searches: m.searches }) > META_MAX_BYTES) found = found.slice(1);
	while (sources.length && bytes({ sources, searches: m.searches }) > META_MAX_BYTES) sources = sources.slice(0, -1);
	return {
		role: m.role,
		content: m.content,
		reasoning: m.reasoning,
		model: m.model,
		status: m.status === 'streaming' ? 'incomplete' : m.status,
		error: m.error.slice(0, ERROR_MAX),
		kind: m.kind,
		attachments: m.attachments.map((a) => ({ id: a.id })),
		usage: m.usage
			? {
					input_tokens: m.usage.input,
					output_tokens: m.usage.output,
					cached_tokens: m.usage.cached,
					reasoning_tokens: m.usage.reasoning,
					cost: m.usage.cost
				}
			: undefined,
		meta: {
			...(m.searches.length ? { searches: m.searches } : {}),
			...(sources.length ? { sources } : {}),
			...(found.length ? { found } : {}),
			...(m.research ? { research_id: m.research.id } : {}),
			...(m.thoughtMs ? { thought_ms: m.thoughtMs } : {}),
			...(m.usage?.currency ? { currency: m.usage.currency } : {})
		},
		created_at: m.createdAt
	};
}

const blank = (role: WebMsg['role'], model = ''): WebMsg => ({
	id: crypto.randomUUID(),
	role,
	content: '',
	reasoning: '',
	thoughtMs: 0,
	model,
	status: 'complete',
	error: '',
	kind: 'chat',
	attachments: [],
	usage: null,
	searches: [],
	sources: [],
	found: [],
	research: null,
	createdAt: new Date().toISOString()
});

// ── attachments ──
const attachmentData = new Map<string, Promise<Blob>>();
/** An attachment's bytes (fetched once; the API wants the token in a header). */
export function attachmentBlob(id: string): Promise<Blob> {
	let got = attachmentData.get(id);
	if (!got) {
		got = request(`/v1/oauth/chat/attachments/${id}`).then((r) => r.blob());
		got.catch(() => attachmentData.delete(id));
		attachmentData.set(id, got);
	}
	return got;
}
const objectURLs = new Map<string, string>();
/** An attachment as a URL an <img> can show. */
export async function attachmentURL(id: string): Promise<string> {
	const known = objectURLs.get(id);
	if (known) return known;
	const url = URL.createObjectURL(await attachmentBlob(id));
	objectURLs.set(id, url);
	return url;
}
const dataURL = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(blob);
	});

export async function uploadAttachment(file: File, conversationId: string): Promise<Attachment> {
	const form = new FormData();
	form.append('file', file);
	form.append('conversation_id', conversationId);
	const a = await json<Attachment>('/v1/oauth/chat/attachments', { body: form });
	attachmentData.set(a.id, Promise.resolve(file));
	return a;
}

async function runTool(call: ToolCall, m: WebMsg, signal: AbortSignal): Promise<string> {
	const args = parseArgs(call.args) as Record<string, string>;
	const keep = (arg: string, text: string) => (m.found = [...m.found, { tool: call.name, arg, text: text.slice(0, FOUND_KEEP) }]);
	try {
		if (call.name === 'web_search') {
			const query = String(args.query ?? '');
			m.searches = [...m.searches, query];
			const res = await json<{ results?: { title?: string; url?: string }[] }>('/tools/v1/search', {
				body: { query, max_results: 8, ...(args.freshness ? { freshness: args.freshness } : {}) },
				signal
			});
			for (const r of res.results ?? []) if (r.url && !m.sources.some((s) => s.url === r.url)) m.sources = [...m.sources, { title: r.title ?? '', url: r.url }];
			const out = JSON.stringify(res).slice(0, MAX_TOOL_RESULT);
			keep(query, out);
			return out;
		}
		if (call.name === 'web_fetch') {
			const url = String(args.url ?? '');
			const res = await json<{ title?: string; content?: string }>('/tools/v1/fetch', { body: { url }, signal });
			if (!m.sources.some((s) => s.url === url)) m.sources = [...m.sources, { title: res.title ?? '', url }];
			keep(url, `${res.title ?? ''}\n${res.content ?? ''}`);
			return JSON.stringify({ url, title: res.title, text: (res.content ?? '').slice(0, MAX_TOOL_RESULT) });
		}
		return JSON.stringify({ error: 'unknown tool' });
	} catch (e) {
		if (signal.aborted) throw e;
		return JSON.stringify({ error: e instanceof Error ? e.message : 'tool failed' });
	}
}

/** A reply as later turns see it: what its searches found, then what it
 *  said (or that it was cut short). */
function replyText(m: WebMsg): string {
	if (!m.found.length) return m.content;
	const found = m.found.map((f) => `[${f.tool === 'web_fetch' ? '阅读网页' : '搜索'}] ${f.arg}\n${f.text}`).join('\n\n');
	const said = m.content.trim() ? m.content : '（这条回答在完成前中断了）';
	return `<web_results>\n以下是这条回答联网检索到的资料（已截短），后续回答可以直接引用：\n\n${found}\n</web_results>\n\n${said}`;
}

/** What the model sees of a message: text, and a user's images. */
async function wire(m: WebMsg, proto: Proto): Promise<object> {
	if (m.role === 'assistant') return wireMessage(proto, 'assistant', replyText(m));
	const images: string[] = [];
	let text = m.content;
	for (const a of m.attachments.filter((a) => a.mime.startsWith('image/'))) {
		try {
			images.push(await dataURL(await attachmentBlob(a.id)));
		} catch {
			text = `[图片 ${a.name} 无法读取]\n${text}`;
		}
	}
	return wireMessage(proto, 'user', text, images);
}

/** The messages that go to the model: a reply that failed or was stopped
 *  still goes when it said or found something. */
const sent = (history: WebMsg[]) =>
	history.filter((m) => m.kind === 'chat' && (m.content.trim() || m.attachments.length || m.found.length) && !(m.status === 'error' && !m.found.length && !m.content.trim()));

/** The whole conversation as the model sees it: nothing is dropped or
 *  shortened (a conversation too long for the model ends instead). */
async function context(history: WebMsg[], proto: Proto): Promise<object[]> {
	const kept: object[] = [];
	for (const m of sent(history)) kept.push(await wire(m, proto));
	return kept;
}

/** Whether the conversation has no room left in the model's window for
 *  `text` and a reply (a quarter of the window kept for it). The last
 *  reply's real token count when known, else an estimate; a model whose
 *  window is not known is never full. */
export function contextFull(model: ChatModel | undefined, history: WebMsg[], text = '', images = 0): boolean {
	if (!model?.window) return false;
	const last = history.at(-1);
	const used =
		last?.role === 'assistant' && last.usage?.input
			? last.usage.input + last.usage.output
			: sent(history).reduce(
					(n, m) => n + estimate(m.role === 'assistant' ? replyText(m) : m.content) + (m.role === 'user' ? m.attachments.filter((a) => a.mime.startsWith('image/')).length * IMAGE_TOKENS : 0),
					0
				);
	return used + estimate(text) + images * IMAGE_TOKENS > model.window * 0.75;
}

class Chat {
	conversations = $state<ConversationInfo[]>([]);
	listLoaded = $state(false);
	hasMore = $state(false);

	/** The open conversation; `null` id: a new one not saved yet. */
	id = $state<string | null>(null);
	saved = $state(false);
	title = $state('');
	msgs = $state<WebMsg[]>([]);
	loading = $state(false);
	busy = $state(false);
	error = $state('');

	#abort: AbortController | null = null;
	#researchTimer: ReturnType<typeof setTimeout> | null = null;
	/** Bumped by stop(): a reply or research from before it no longer owns `busy`. */
	#run = 0;

	async loadList(more = false) {
		const before = more ? this.conversations.at(-1)?.updatedAt : undefined;
		const q = new URLSearchParams({ limit: '50', ...(before ? { before } : {}) });
		const r = await json<{ conversations: { id: string; title?: string; model?: string; updated_at: string }[]; has_more: boolean }>(
			`/v1/oauth/chat/conversations?${q}`
		);
		const rows = r.conversations.map((c) => ({ id: c.id, title: c.title ?? '', model: c.model ?? '', updatedAt: c.updated_at }));
		this.conversations = more ? [...this.conversations, ...rows.filter((x) => !this.conversations.some((y) => y.id === x.id))] : rows;
		this.hasMore = r.has_more;
		this.listLoaded = true;
	}

	/** A new conversation (not saved until its first message). */
	fresh() {
		this.stop();
		this.id = null;
		this.saved = false;
		this.title = '';
		this.msgs = [];
		this.error = '';
	}

	async open(id: string) {
		if (this.id === id && this.saved) return;
		this.stop();
		this.id = id;
		this.saved = true;
		this.msgs = [];
		this.error = '';
		this.loading = true;
		try {
			const r = await json<{ conversation: { title?: string; model?: string }; messages: CloudMessage[] }>(`/v1/oauth/chat/conversations/${id}/messages`);
			if (this.id !== id) return;
			this.title = r.conversation.title ?? '';
			this.msgs = r.messages.map(fromCloud);
			// A research still running when the page was left: follow it again.
			const last = this.msgs.at(-1);
			if (last?.kind === 'research' && last.research && last.status !== 'complete') this.#followResearch(last);
		} catch (e) {
			if (this.id === id) this.error = e instanceof Error ? e.message : String(e);
		} finally {
			if (this.id === id) this.loading = false;
		}
	}

	async #ensureSaved(firstText: string, model: string): Promise<string> {
		const id = this.id ?? crypto.randomUUID();
		this.id = id;
		if (!this.saved) {
			const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 40) || '新对话';
			this.title = title;
			await json(`/v1/oauth/chat/conversations/${id}`, { method: 'PUT', body: { title, model } });
			this.saved = true;
			const now = new Date().toISOString();
			this.conversations = [{ id, title, model, updatedAt: now }, ...this.conversations.filter((c) => c.id !== id)];
		}
		return id;
	}

	/** Saved into the conversation it belongs to, wherever the page is now. */
	#put(m: WebMsg, id: string | null = this.id) {
		if (!id) return Promise.resolve();
		return json(`/v1/oauth/chat/conversations/${id}/messages/${m.id}`, { method: 'PUT', body: toCloud(m) }).catch((e) => {
			// The reply stays on screen; say it is not in the history.
			this.error = `保存失败：${e instanceof Error ? e.message : e}`;
		});
	}

	#touch(model: string) {
		const id = this.id;
		const c = this.conversations.find((x) => x.id === id);
		if (!c) return;
		this.conversations = [{ ...c, model, updatedAt: new Date().toISOString() }, ...this.conversations.filter((x) => x.id !== id)];
	}

	/** A question (with images, uploaded first) and its reply. */
	async send(text: string, files: File[], opts: SendOptions) {
		if (this.busy) return;
		if (contextFull(models.find(opts.model), this.msgs, text, files.length)) throw new Error(t('web.chat.full'));
		this.error = '';
		this.busy = true;
		let id: string;
		let attachments: Attachment[];
		try {
			id = await this.#ensureSaved(text, opts.model);
			attachments = await Promise.all(files.map((f) => uploadAttachment(f, id)));
		} catch (e) {
			this.busy = false;
			throw e;
		}
		this.busy = false;
		const user = { ...blank('user'), content: text, attachments };
		this.msgs = [...this.msgs, user];
		await this.#put(user);
		this.#touch(opts.model);
		await this.#reply(opts, id);
	}

	/** The last reply again, with the same question. */
	async regenerate(opts: SendOptions) {
		if (this.busy) return;
		const last = this.msgs.at(-1);
		if (last?.role === 'assistant') {
			if (this.id && !(await this.#delete([last]))) return;
			this.msgs = this.msgs.slice(0, -1);
		}
		if (this.msgs.at(-1)?.role === 'user' && this.id) await this.#reply(opts, this.id);
	}

	/** A question rewritten: what came after it goes, and it is asked again. */
	async edit(messageId: string, text: string, opts: SendOptions) {
		if (this.busy || !this.id) return;
		const i = this.msgs.findIndex((m) => m.id === messageId);
		if (i < 0) return;
		if (!(await this.#delete(this.msgs.slice(i + 1)))) return;
		const user = { ...this.msgs[i]!, content: text };
		this.msgs = [...this.msgs.slice(0, i), user];
		await this.#put(user);
		await this.#reply(opts, this.id);
	}

	/** Messages removed from the saved history; false (and said) when that failed. */
	async #delete(msgs: WebMsg[]): Promise<boolean> {
		try {
			for (const m of msgs) await json(`/v1/oauth/chat/conversations/${this.id}/messages/${m.id}`, { method: 'DELETE' });
			return true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			return false;
		}
	}

	/** Stops following the reply or research on screen (it is left as it is). */
	stop() {
		this.#run++;
		this.busy = false;
		this.#abort?.abort();
		this.#abort = null;
		if (this.#researchTimer) clearTimeout(this.#researchTimer);
		this.#researchTimer = null;
	}

	/** The composer's stop: a research is cancelled (its card then says so), a reply cut. */
	interrupt() {
		const m = this.msgs.at(-1);
		if (m?.kind === 'research' && m.status === 'streaming') void this.cancelResearch();
		else this.stop();
	}

	async #reply(opts: SendOptions, convId: string) {
		const reply = { ...blank('assistant', opts.model), status: 'streaming' as const };
		if (opts.research) reply.kind = 'research';
		this.msgs = [...this.msgs, reply];
		// The reactive copy: changes to it show as they stream.
		const m = this.msgs.at(-1)!;
		const abort = new AbortController();
		this.#abort = abort;
		this.busy = true;
		const run = this.#run;
		const costs = new Map<string, number>();
		try {
			if (opts.research) return await this.#startResearch(m, opts, convId);
			await this.#put(m, convId);
			const system = systemPrompt(opts.search);
			const proto = protoOf(opts.model);
			let input: object[] = await context(this.msgs.slice(0, -1), proto);
			let thinkingSince = 0;
			let toolCalls = 0;
			for (let round = 0; ; round++) {
				// Out of rounds or of searches: the model answers with what it found.
				const answerOnly = round >= MAX_TOOL_ROUNDS || toolCalls >= MAX_TOOL_CALLS;
				const body = requestBody(proto, { model: opts.model, system, input, effort: opts.effort, tools: opts.search, answerOnly });
				const r = await streamRound(proto, body, abort.signal, {
					onReasoning: (t) => {
						if (!thinkingSince) thinkingSince = Date.now();
						m.reasoning += t;
					},
					onContent: (t) => {
						if (thinkingSince && !m.thoughtMs) m.thoughtMs = Date.now() - thinkingSince;
						m.content += t;
					}
				});
				if (r.usage) {
					m.usage = {
						input: (m.usage?.input ?? 0) + r.usage.input,
						output: (m.usage?.output ?? 0) + r.usage.output,
						reasoning: (m.usage?.reasoning ?? 0) + r.usage.reasoning,
						cached: (m.usage?.cached ?? 0) + r.usage.cached,
						cost: m.usage?.cost ?? '',
						currency: m.usage?.currency ?? ''
					};
					void this.#cost(m, r.requestId, convId, costs);
				}
				if (!r.toolCalls.length || answerOnly) break;
				const results: { id: string; out: string }[] = [];
				for (const c of r.toolCalls) {
					const out =
						++toolCalls > MAX_TOOL_CALLS
							? JSON.stringify({ error: `本次回答的联网次数已用完（${MAX_TOOL_CALLS} 次），请根据已经获得的资料直接回答。` })
							: await runTool(c, m, abort.signal);
					results.push({ id: c.id, out });
				}
				input = withToolRound(proto, input, r, results);
				// What it found so far is kept even if the reply stops here.
				// (awaited: a later save must not be overtaken by this one).
				await this.#put(m, convId);
			}
			if (thinkingSince && !m.thoughtMs) m.thoughtMs = Date.now() - thinkingSince;
			m.status = 'complete';
		} catch (e) {
			if (abort.signal.aborted) m.status = 'incomplete';
			else {
				m.status = 'error';
				m.error = e instanceof Error ? e.message : String(e);
			}
		} finally {
			if (!opts.research || m.status !== 'streaming') {
				if (this.#run === run) this.busy = false;
				if (this.#abort === abort) this.#abort = null;
				await this.#put(m, convId);
			}
		}
	}

	/** A reply's cost: the sum over its requests (one per tool round), each from
	 *  the usage log of that request (settles shortly after). */
	async #cost(m: WebMsg, requestId: string, convId: string, costs: Map<string, number>) {
		if (!requestId) return;
		for (const wait of [1500, 4000]) {
			await new Promise((r) => setTimeout(r, wait));
			try {
				const r = await json<{ cost?: string | number; currency?: string }>(`/v1/oauth/usage-logs/by-request/${encodeURIComponent(requestId)}`);
				if (r.cost !== undefined && r.cost !== null && r.cost !== '') {
					costs.set(requestId, Number(r.cost));
					if (m.usage) {
						m.usage.cost = String(Math.round([...costs.values()].reduce((a, b) => a + b, 0) * 1e6) / 1e6);
						m.usage.currency = r.currency ?? '';
					}
					if (m.status !== 'streaming') void this.#put(m, convId);
					return;
				}
			} catch {
				/* not logged yet */
			}
		}
	}

	async #startResearch(m: WebMsg, opts: SendOptions, convId: string) {
		const question = this.msgs.at(-2)?.content ?? '';
		await this.#put(m, convId);
		const r = await json<{ id: string; status: string }>('/v1/oauth/research', {
			body: { conversation_id: convId, message_id: m.id, question, model: opts.model, effort: ['low', 'medium', 'high'].includes(opts.effort) ? opts.effort : '' }
		});
		m.research = { id: r.id, status: r.status, steps: [] };
		await this.#put(m, convId);
		this.#followResearch(m);
	}

	#followResearch(m: WebMsg) {
		const research = m.research;
		if (!research) return;
		m.status = 'streaming';
		this.busy = true;
		const run = this.#run;
		const poll = async () => {
			try {
				const r = await json<{ status: string; steps?: { kind: string; text: string }[]; sources?: Source[]; report?: string; error?: string }>(
					`/v1/oauth/research/${research.id}`
				);
				// Stopped or left meanwhile: no longer this page's to follow.
				if (this.#run !== run) return;
				m.research = { id: research.id, status: r.status, steps: r.steps ?? [] };
				if (r.sources?.length) m.sources = r.sources;
				if (['done', 'completed', 'failed', 'canceled', 'cancelled'].includes(r.status)) {
					m.content = r.report ?? m.content;
					m.status = r.status === 'failed' ? 'error' : r.status.startsWith('cancel') ? 'incomplete' : 'complete';
					if (r.error) m.error = r.error;
					this.busy = false;
					return;
				}
			} catch (e) {
				if (this.#run !== run) return;
				if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
					this.busy = false;
					return;
				}
			}
			this.#researchTimer = setTimeout(poll, 2500);
		};
		void poll();
	}

	async cancelResearch() {
		const m = this.msgs.at(-1);
		if (!m?.research) return;
		await json(`/v1/oauth/research/${m.research.id}/cancel`, { method: 'POST' }).catch(() => {});
	}

	async rename(id: string, title: string) {
		const c = this.conversations.find((x) => x.id === id);
		if (!c || !title.trim()) return;
		await json(`/v1/oauth/chat/conversations/${id}`, { method: 'PUT', body: { title: title.trim(), model: c.model } });
		this.conversations = this.conversations.map((x) => (x.id === id ? { ...x, title: title.trim() } : x));
		if (this.id === id) this.title = title.trim();
	}

	async remove(id: string) {
		await json(`/v1/oauth/chat/conversations/${id}`, { method: 'DELETE' });
		this.conversations = this.conversations.filter((x) => x.id !== id);
		if (this.id === id) this.fresh();
	}
}

export const chat = new Chat();

