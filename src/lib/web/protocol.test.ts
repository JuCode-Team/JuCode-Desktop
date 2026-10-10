import { describe, expect, it } from 'vitest';
import { protoOf, requestBody, withToolRound, wireMessage, type Round } from './protocol';

const base = { model: 'm', system: 'sys', input: [{ role: 'user', content: 'hi' }], effort: 'high', tools: true, answerOnly: false };

describe('protoOf', () => {
	it('picks each family its own protocol', () => {
		expect(protoOf('claude-opus-5-5')).toBe('messages');
		expect(protoOf('gpt-6.1-sol')).toBe('responses');
		expect(protoOf('o3')).toBe('responses');
		expect(protoOf('deepseek-v4.1-flash')).toBe('chat');
		expect(protoOf('gptoss')).toBe('chat');
	});
});

describe('requestBody', () => {
	it('keeps the tools but forbids calls once answers are due', () => {
		expect(requestBody('messages', { ...base, answerOnly: true })).toMatchObject({ tool_choice: { type: 'none' }, system: 'sys', output_config: { effort: 'high' } });
		expect(requestBody('responses', { ...base, answerOnly: true })).toMatchObject({ tool_choice: 'none', instructions: 'sys', reasoning: { effort: 'high' } });
		const chat = requestBody('chat', { ...base, answerOnly: true }) as { tool_choice: string; tools: unknown[]; messages: { role: string }[] };
		expect(chat.tool_choice).toBe('none');
		expect(chat.tools).toHaveLength(2);
		expect(chat.messages[0]).toEqual({ role: 'system', content: 'sys' });
	});
	it('sends no tools when search is off', () => {
		for (const p of ['messages', 'responses', 'chat'] as const) expect(requestBody(p, { ...base, tools: false, answerOnly: true })).not.toHaveProperty('tools');
	});
});

describe('withToolRound', () => {
	const round: Round = {
		content: 'let me look',
		toolCalls: [{ id: 'c1', name: 'web_search', args: '{"query":"x"}' }],
		blocks: [
			{ type: 'thinking', thinking: 't', signature: 's' },
			{ type: 'text', text: 'let me look' },
			{ type: 'tool_use', id: 'c1', name: 'web_search' }
		],
		usage: null,
		requestId: ''
	};
	const results = [{ id: 'c1', out: 'found' }];
	it('messages: thinking with its signature, the call, then its result', () => {
		const out = withToolRound('messages', [], round, results);
		expect(out).toEqual([
			{
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 't', signature: 's' },
					{ type: 'text', text: 'let me look' },
					{ type: 'tool_use', id: 'c1', name: 'web_search', input: { query: 'x' } }
				]
			},
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'found' }] }
		]);
	});
	it('responses: function_call items and their outputs by call_id', () => {
		expect(withToolRound('responses', [], round, results)).toEqual([
			{ role: 'assistant', content: 'let me look' },
			{ type: 'function_call', call_id: 'c1', name: 'web_search', arguments: '{"query":"x"}' },
			{ type: 'function_call_output', call_id: 'c1', output: 'found' }
		]);
	});
	it('chat: tool_calls then tool messages', () => {
		expect(withToolRound('chat', [], round, results)).toEqual([
			{ role: 'assistant', content: 'let me look', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }] },
			{ role: 'tool', tool_call_id: 'c1', content: 'found' }
		]);
	});
});

describe('wireMessage', () => {
	it('puts images in each protocol shape', () => {
		const url = 'data:image/png;base64,AAA';
		expect(wireMessage('messages', 'user', 'q', [url])).toEqual({
			role: 'user',
			content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'q' }]
		});
		expect(wireMessage('responses', 'user', 'q', [url])).toEqual({
			role: 'user',
			content: [{ type: 'input_image', image_url: url }, { type: 'input_text', text: 'q' }]
		});
		expect(wireMessage('chat', 'user', 'q', [url])).toEqual({
			role: 'user',
			content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: 'q' }]
		});
	});
});
