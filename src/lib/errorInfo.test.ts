import { describe, it, expect } from 'vitest';
import { describeError, stripEngineHint } from './errorInfo';

describe('describeError', () => {
	it('reads a gateway 401 as the session credential running out, not a codex login', () => {
		const raw =
			"unexpected status 401 Unauthorized: invalid token, url: https://api.jucode.net/v1/responses, request id: 2e5d62a1-6dfa-4d1b-8ce2-ef42f25ee84a (Codex needs to sign in again: run `codex login` in a terminal.)";
		expect(describeError(raw, 'codex')).toEqual({
			kind: 'jucodeAuth',
			action: 'restart',
			status: 401,
			requestId: '2e5d62a1-6dfa-4d1b-8ce2-ef42f25ee84a'
		});
		expect(stripEngineHint(raw)).not.toContain('codex login');
	});

	it('names the tool for a 401 from its own account', () => {
		expect(describeError('unexpected status 401 Unauthorized: invalid api key, url: https://api.openai.com/v1/responses', 'codex'))
			.toMatchObject({ kind: 'toolAuth', subject: 'Codex' });
	});

	it.each([
		['API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.1.content.0: Invalid `signature` in `thinking` block"}}', 'foreignHistory'],
		['failed to load configuration: Model provider `recodex` not found', 'providerMissing'],
		['JuCode session expired. Run /login to sign in again.', 'jucodeLogin'],
		['unexpected status 402 Payment Required: 余额不足', 'balance'],
		["This model's maximum context length is 258400 tokens. context_length_exceeded", 'context'],
		['prompt is too long: 212345 tokens > 200000 maximum', 'context'],
		['unexpected status 429 Too Many Requests: rate limit reached', 'rateLimit'],
		['API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', 'upstream'],
		['unexpected status 502 Bad Gateway', 'upstream'],
		['stream disconnected before completion: error sending request', 'network'],
		['model_not_found: The model `gpt-9` does not exist', 'model'],
		['API Error: 400 请求参数有误，请检查后重试', 'badRequest']
	])('%s → %s', (raw, kind) => {
		expect(describeError(raw)?.kind).toBe(kind);
	});

	it('leaves errors it does not know alone', () => {
		expect(describeError('the tool crashed in an odd way')).toBeNull();
	});
});
