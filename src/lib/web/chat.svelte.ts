// The web app's conversations: kept in the cloud (/v1/oauth/chat/*, shared
// with the Android app and the console), replies streamed from
// /v1/oauth/chat/llm/chat/completions (only the models the admin opened to
// chat), web search as tool calls the page runs (/tools/v1/*), deep research
// as a server task the page follows. Ported from the Android app's
// ChatEngine so both behave alike.

import { ApiError, json, request } from './api';
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
	research: ResearchState | null;
	createdAt: string;
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
const MAX_TOOL_RESULT = 24_000;
const DEFAULT_WINDOW = 32_000;
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
	if (search) s += '\n你可以调用 web_search 搜索网页、web_fetch 阅读网页全文。涉及最新信息或需要出处时先搜索，回答中用 Markdown 链接注明来源。';
	return s;
}

const WEB_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'web_search',
			description:
				'Search the web and return ranked results: title, url and a snippet. Use for current information or to find sources; then read pages in full with web_fetch.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search query, at most 400 characters.' },
					freshness: { type: 'string', enum: ['day', 'week', 'month', 'year'] }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'web_fetch',
			description: 'Read the text of a web page by URL.',
			parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
		}
	}
];

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
	meta?: { searches?: string[]; sources?: Source[]; research_id?: string; thought_ms?: number; currency?: string } | null;
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
	let sources = m.sources;
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

// ── streaming ──
interface StreamEvents {
	onReasoning(text: string): void;
	onContent(text: string): void;
}
interface ToolCall {
	id: string;
	name: string;
	args: string;
}
interface Round {
	content: string;
	toolCalls: ToolCall[];
	usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } | null;
	requestId: string;
}

async function streamRound(body: object, signal: AbortSignal, on: StreamEvents): Promise<Round> {
	const res = await request('/v1/oauth/chat/llm/chat/completions', { body, signal });
	const round: Round = { content: '', toolCalls: [], usage: null, requestId: res.headers.get('X-Request-Id') ?? '' };
	const reader = res.body!.getReader();
	const dec = new TextDecoder();
	let buf = '';
	const calls = new Map<number, ToolCall>();
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		let nl: number;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (data === '[DONE]') continue;
			let j: {
				error?: { message?: string } | string;
				usage?: Round['usage'];
				choices?: {
					delta?: {
						content?: string;
						reasoning_content?: string;
						reasoning?: string;
						tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
					};
				}[];
			};
			try {
				j = JSON.parse(data);
			} catch {
				continue;
			}
			if (j.error) throw new ApiError(502, typeof j.error === 'string' ? j.error : (j.error.message ?? 'stream error'), round.requestId);
			if (j.usage) round.usage = j.usage;
			const delta = j.choices?.[0]?.delta;
			if (!delta) continue;
			const thinking = delta.reasoning_content ?? delta.reasoning;
			if (thinking) on.onReasoning(thinking);
			if (delta.content) {
				round.content += delta.content;
				on.onContent(delta.content);
			}
			for (const tc of delta.tool_calls ?? []) {
				const i = tc.index ?? 0;
				const call = calls.get(i) ?? { id: '', name: '', args: '' };
				if (tc.id) call.id = tc.id;
				if (tc.function?.name) call.name += tc.function.name;
				if (tc.function?.arguments) call.args += tc.function.arguments;
				calls.set(i, call);
			}
		}
	}
	round.toolCalls = [...calls.values()].filter((c) => c.name);
	return round;
}

async function runTool(call: ToolCall, m: WebMsg, signal: AbortSignal): Promise<string> {
	let args: Record<string, string> = {};
	try {
		args = JSON.parse(call.args || '{}');
	} catch {
		return JSON.stringify({ error: 'bad arguments' });
	}
	try {
		if (call.name === 'web_search') {
			const query = String(args.query ?? '');
			m.searches = [...m.searches, query];
			const res = await json<{ results?: { title?: string; url?: string }[] }>('/tools/v1/search', {
				body: { query, max_results: 8, ...(args.freshness ? { freshness: args.freshness } : {}) },
				signal
			});
			for (const r of res.results ?? []) if (r.url && !m.sources.some((s) => s.url === r.url)) m.sources = [...m.sources, { title: r.title ?? '', url: r.url }];
			return JSON.stringify(res).slice(0, MAX_TOOL_RESULT);
		}
		if (call.name === 'web_fetch') {
			const url = String(args.url ?? '');
			const res = await json<{ title?: string; content?: string }>('/tools/v1/fetch', { body: { url }, signal });
			if (!m.sources.some((s) => s.url === url)) m.sources = [...m.sources, { title: res.title ?? '', url }];
			return JSON.stringify({ url, title: res.title, text: (res.content ?? '').slice(0, MAX_TOOL_RESULT) });
		}
		return JSON.stringify({ error: 'unknown tool' });
	} catch (e) {
		if (signal.aborted) throw e;
		return JSON.stringify({ error: e instanceof Error ? e.message : 'tool failed' });
	}
}

/** What the model sees of a message: text, and a user's images. */
async function wire(m: WebMsg): Promise<object> {
	const images = m.role === 'user' ? m.attachments.filter((a) => a.mime.startsWith('image/')) : [];
	if (!images.length) return { role: m.role, content: m.content };
	const parts: object[] = [];
	for (const a of images) {
		try {
			parts.push({ type: 'image_url', image_url: { url: await dataURL(await attachmentBlob(a.id)) } });
		} catch {
			parts.push({ type: 'text', text: `[图片 ${a.name} 无法读取]` });
		}
	}
	if (m.content) parts.push({ type: 'text', text: m.content });
	return { role: m.role, content: parts };
}

/** The newest messages that fit the model's window (a quarter kept for the
 *  reply); the user's latest message always goes. */
async function context(model: ChatModel | undefined, history: WebMsg[], system: string): Promise<object[]> {
	const budget = Math.max(8_000, model?.window || DEFAULT_WINDOW) * 0.75 - estimate(system);
	const usable = history.filter((m) => (m.content.trim() || m.attachments.length) && m.status !== 'error' && m.kind === 'chat');
	const kept: object[] = [];
	let used = 0;
	for (let i = usable.length - 1; i >= 0; i--) {
		const m = usable[i]!;
		const cost = estimate(m.content) + (m.role === 'user' ? m.attachments.filter((a) => a.mime.startsWith('image/')).length * IMAGE_TOKENS : 0);
		if (used + cost > budget && kept.length) break;
		used += cost;
		kept.unshift(await wire(m));
	}
	return [{ role: 'system', content: system }, ...kept];
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
		const model = models.find(opts.model);
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
			const messages: object[] = await context(model, this.msgs.slice(0, -1), system);
			let thinkingSince = 0;
			for (let round = 0; ; round++) {
				const body = {
					model: opts.model,
					messages,
					stream: true,
					stream_options: { include_usage: true },
					...(opts.effort ? { reasoning_effort: opts.effort } : {}),
					...(opts.search && round < MAX_TOOL_ROUNDS ? { tools: WEB_TOOLS } : {})
				};
				const r = await streamRound(body, abort.signal, {
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
						input: (m.usage?.input ?? 0) + (r.usage.prompt_tokens ?? 0),
						output: (m.usage?.output ?? 0) + (r.usage.completion_tokens ?? 0),
						reasoning: (m.usage?.reasoning ?? 0) + (r.usage.completion_tokens_details?.reasoning_tokens ?? 0),
						cached: (m.usage?.cached ?? 0) + (r.usage.prompt_tokens_details?.cached_tokens ?? 0),
						cost: m.usage?.cost ?? '',
						currency: m.usage?.currency ?? ''
					};
					void this.#cost(m, r.requestId, convId, costs);
				}
				if (!r.toolCalls.length || round >= MAX_TOOL_ROUNDS) break;
				messages.push({
					role: 'assistant',
					content: r.content || null,
					tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }))
				});
				for (const c of r.toolCalls) messages.push({ role: 'tool', tool_call_id: c.id, content: await runTool(c, m, abort.signal) });
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

