// The three wire formats the web chat speaks, each to the models whose groups
// serve it natively: Anthropic Messages for Claude, OpenAI Responses for GPT,
// Chat Completions for the rest. Each one's request, stream and tool round.

import { ApiError, request } from './api';

export type Proto = 'messages' | 'responses' | 'chat';

export function protoOf(model: string): Proto {
	const name = model.trim();
	if (/^(claude|anthropic)([-.]|$)/i.test(name)) return 'messages';
	if (/^(gpt|o[134]|chatgpt|codex)([-.]|$)/i.test(name)) return 'responses';
	return 'chat';
}

const PATHS: Record<Proto, string> = {
	messages: '/v1/oauth/chat/llm/anthropic/messages',
	responses: '/v1/oauth/chat/llm/responses',
	chat: '/v1/oauth/chat/llm/chat/completions'
};

/** Room for a Claude reply, thinking included (Messages requires a cap). */
const MESSAGES_MAX_TOKENS = 32_000;

const TOOLS = [
	{
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
	},
	{
		name: 'web_fetch',
		description: 'Read the text of a web page by URL.',
		parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
	}
];

function toolDefs(proto: Proto): object[] {
	if (proto === 'messages') return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
	if (proto === 'responses') return TOOLS.map((t) => ({ type: 'function', ...t }));
	return TOOLS.map((t) => ({ type: 'function', function: t }));
}

// ── messages ──

/** A message's parts in the protocol's shape: text, and images as data URLs. */
export function wireMessage(proto: Proto, role: 'user' | 'assistant', text: string, images: string[] = []): object {
	if (!images.length) return { role, content: text };
	const parts: object[] = images.map((url) => {
		if (proto === 'chat') return { type: 'image_url', image_url: { url } };
		if (proto === 'responses') return { type: 'input_image', image_url: url };
		const [head, data] = url.split(',', 2);
		return { type: 'image', source: { type: 'base64', media_type: head!.slice(5).replace(';base64', ''), data } };
	});
	if (text) parts.push(proto === 'responses' ? { type: 'input_text', text } : { type: 'text', text });
	return { role, content: parts };
}

export interface RequestOptions {
	model: string;
	system: string;
	/** The conversation, in the protocol's shape (wireMessage, then tool rounds). */
	input: object[];
	effort: string;
	/** Offer the web tools. */
	tools: boolean;
	/** The tools stay (the history holds calls to them) but may not be called. */
	answerOnly: boolean;
}

export function requestBody(proto: Proto, o: RequestOptions): object {
	const tools = o.tools ? { tools: toolDefs(proto) } : {};
	const none = o.tools && o.answerOnly;
	if (proto === 'messages')
		return {
			model: o.model,
			max_tokens: MESSAGES_MAX_TOKENS,
			stream: true,
			system: o.system,
			messages: o.input,
			...tools,
			...(none ? { tool_choice: { type: 'none' } } : {}),
			...(o.effort ? { output_config: { effort: o.effort } } : {})
		};
	if (proto === 'responses')
		return {
			model: o.model,
			stream: true,
			store: false,
			instructions: o.system,
			input: o.input,
			...tools,
			...(none ? { tool_choice: 'none' } : {}),
			...(o.effort ? { reasoning: { effort: o.effort } } : {})
		};
	return {
		model: o.model,
		stream: true,
		stream_options: { include_usage: true },
		messages: [{ role: 'system', content: o.system }, ...o.input],
		...tools,
		...(none ? { tool_choice: 'none' } : {}),
		...(o.effort ? { reasoning_effort: o.effort } : {})
	};
}

// ── streaming ──

export interface StreamEvents {
	onReasoning(text: string): void;
	onContent(text: string): void;
}
export interface ToolCall {
	/** The id its result answers to (Responses: the call_id). */
	id: string;
	name: string;
	args: string;
}
export interface RoundUsage {
	input: number;
	output: number;
	reasoning: number;
	cached: number;
}
type Block = Record<string, unknown>;
export interface Round {
	content: string;
	toolCalls: ToolCall[];
	/** Messages: the reply's content blocks, so thinking signatures go back with tool results. */
	blocks: Block[];
	usage: RoundUsage | null;
	requestId: string;
}

type Frame = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One model call, streamed: its text and thinking as they come, then its tool calls and usage. */
export async function streamRound(proto: Proto, body: object, signal: AbortSignal, on: StreamEvents): Promise<Round> {
	const res = await request(PATHS[proto], { body, signal });
	const round: Round = { content: '', toolCalls: [], blocks: [], usage: null, requestId: res.headers.get('X-Request-Id') ?? '' };
	const calls = new Map<number, ToolCall>();
	const fail = (message: string) => new ApiError(502, message, round.requestId);
	const text = (t: string) => {
		round.content += t;
		on.onContent(t);
	};
	const reader = res.body!.getReader();
	const dec = new TextDecoder();
	let buf = '';
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
			let j: Frame;
			try {
				j = JSON.parse(data);
			} catch {
				continue;
			}
			if (j.error) throw fail(typeof j.error === 'string' ? j.error : (j.error.message ?? 'stream error'));
			if (proto === 'messages') messagesFrame(j, round, calls, on, text);
			else if (proto === 'responses') responsesFrame(j, round, calls, on, text, fail);
			else chatFrame(j, round, calls, on, text);
		}
	}
	round.toolCalls = [...calls.values()].filter((c) => c.name);
	return round;
}

function chatFrame(j: Frame, round: Round, calls: Map<number, ToolCall>, on: StreamEvents, text: (t: string) => void) {
	if (j.usage)
		round.usage = {
			input: j.usage.prompt_tokens ?? 0,
			output: j.usage.completion_tokens ?? 0,
			reasoning: j.usage.completion_tokens_details?.reasoning_tokens ?? 0,
			cached: j.usage.prompt_tokens_details?.cached_tokens ?? 0
		};
	const delta = j.choices?.[0]?.delta;
	if (!delta) return;
	const thinking = delta.reasoning_content ?? delta.reasoning;
	if (typeof thinking === 'string' && thinking) on.onReasoning(thinking);
	if (typeof delta.content === 'string' && delta.content) text(delta.content);
	for (const tc of delta.tool_calls ?? []) {
		const i = tc.index ?? 0;
		const call = calls.get(i) ?? { id: '', name: '', args: '' };
		if (tc.id) call.id = tc.id;
		if (tc.function?.name) call.name += tc.function.name;
		if (tc.function?.arguments) call.args += tc.function.arguments;
		calls.set(i, call);
	}
}

function messagesFrame(j: Frame, round: Round, calls: Map<number, ToolCall>, on: StreamEvents, text: (t: string) => void) {
	const i: number = j.index ?? 0;
	if (j.type === 'message_start') {
		const u = j.message?.usage ?? {};
		const cached = u.cache_read_input_tokens ?? 0;
		round.usage = { input: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, reasoning: 0, cached };
	} else if (j.type === 'message_delta') {
		if (j.usage?.output_tokens !== undefined && round.usage) round.usage.output = j.usage.output_tokens;
	} else if (j.type === 'content_block_start' && j.content_block) {
		const b = { ...j.content_block };
		if (b.type === 'tool_use') calls.set(i, { id: String(b.id ?? ''), name: String(b.name ?? ''), args: '' });
		round.blocks[i] = b;
	} else if (j.type === 'content_block_delta' && j.delta) {
		const d = j.delta;
		const b = round.blocks[i] ?? (round.blocks[i] = {});
		if (d.type === 'text_delta' && d.text) {
			b.text = String(b.text ?? '') + d.text;
			text(d.text);
		} else if (d.type === 'thinking_delta' && d.thinking) {
			b.thinking = String(b.thinking ?? '') + d.thinking;
			on.onReasoning(d.thinking);
		} else if (d.type === 'signature_delta' && d.signature) {
			b.signature = String(b.signature ?? '') + d.signature;
		} else if (d.type === 'input_json_delta' && d.partial_json) {
			const call = calls.get(i);
			if (call) call.args += d.partial_json;
		}
	}
}

function responsesFrame(
	j: Frame,
	round: Round,
	calls: Map<number, ToolCall>,
	on: StreamEvents,
	text: (t: string) => void,
	fail: (message: string) => ApiError
) {
	const i: number = j.output_index ?? 0;
	switch (j.type) {
		case 'response.output_text.delta':
			if (typeof j.delta === 'string') text(j.delta);
			break;
		case 'response.reasoning_summary_text.delta':
		case 'response.reasoning_text.delta':
			if (typeof j.delta === 'string') on.onReasoning(j.delta);
			break;
		case 'response.output_item.added':
		case 'response.output_item.done':
			if (j.item?.type === 'function_call') {
				const call = calls.get(i) ?? { id: '', name: '', args: '' };
				call.id = j.item.call_id || call.id;
				call.name = j.item.name || call.name;
				// The finished item carries the whole arguments.
				if (j.type === 'response.output_item.done' && typeof j.item.arguments === 'string') call.args = j.item.arguments;
				calls.set(i, call);
			}
			break;
		case 'response.function_call_arguments.delta': {
			const call = calls.get(i);
			if (call && typeof j.delta === 'string') call.args += j.delta;
			break;
		}
		case 'response.completed':
		case 'response.incomplete': {
			const u = j.response?.usage;
			if (u)
				round.usage = {
					input: u.input_tokens ?? 0,
					output: u.output_tokens ?? 0,
					reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
					cached: u.input_tokens_details?.cached_tokens ?? 0
				};
			break;
		}
		case 'response.failed':
			throw fail(j.response?.error?.message ?? 'response failed');
		case 'error':
			throw fail(j.message ?? 'stream error');
	}
}

// ── tool rounds ──

/** The conversation after a round that called tools: the call, then the results. */
export function withToolRound(proto: Proto, input: object[], r: Round, results: { id: string; out: string }[]): object[] {
	if (proto === 'messages') {
		const content: Block[] = [];
		for (const b of r.blocks) {
			if (!b) continue;
			if (b.type === 'thinking' && b.signature) content.push({ type: 'thinking', thinking: b.thinking ?? '', signature: b.signature });
			else if (b.type === 'redacted_thinking') content.push(b);
			else if (b.type === 'text' && String(b.text ?? '').trim()) content.push({ type: 'text', text: b.text });
			else if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: parseArgs(r.toolCalls.find((c) => c.id === b.id)?.args) });
		}
		return [
			...input,
			{ role: 'assistant', content },
			{ role: 'user', content: results.map((x) => ({ type: 'tool_result', tool_use_id: x.id, content: x.out })) }
		];
	}
	if (proto === 'responses')
		return [
			...input,
			...(r.content ? [{ role: 'assistant', content: r.content }] : []),
			...r.toolCalls.map((c) => ({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.args || '{}' })),
			...results.map((x) => ({ type: 'function_call_output', call_id: x.id, output: x.out }))
		];
	return [
		...input,
		{
			role: 'assistant',
			content: r.content || null,
			tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }))
		},
		...results.map((x) => ({ role: 'tool', tool_call_id: x.id, content: x.out }))
	];
}

export function parseArgs(args: string | undefined): Record<string, unknown> {
	try {
		const v = JSON.parse(args || '{}');
		return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}
