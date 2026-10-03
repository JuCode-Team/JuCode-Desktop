import { describe, it, expect, beforeEach } from 'vitest';
import { parseDelivery } from './delivery';
import { setLocale } from './i18n';

describe('parseDelivery', () => {
	beforeEach(() => setLocale('zh'));

	it('shows a ran deferred action as its tool call, multi-line summary and all', () => {
		const output = '{"command":"python3 - <<\'PY\'\\nprint(1)\\nPY","exit_code":1}';
		const text = `[deferred action act-1 approved and executed, failed]\n\`bash\` (python3 - <<'PY'\nprint(1)\nPY)\nresult:\n${output}`;
		expect(parseDelivery(text)).toEqual({
			kind: 'action',
			label: '待确认动作已批准并执行',
			name: 'bash',
			output,
			failed: true
		});
		// No summary: the parentheses are left out.
		const bare = parseDelivery('[deferred action act-2 approved and executed]\n`write_stdin`\nresult:\n{}');
		expect(bare).toMatchObject({ kind: 'action', name: 'write_stdin', output: '{}', failed: false });
	});

	it('names the declined tool', () => {
		const text = "[deferred action act-3 declined]\nThe user declined `bash` (rm -rf build). Do not retry it; continue with a different approach or ask how to proceed.";
		expect(parseDelivery(text)).toEqual({ kind: 'declined', label: '待确认动作已拒绝：bash' });
	});

	it('labels daemon deliveries and keeps their body', () => {
		const answer = '[answer to your question q-1 · m-8]\nQ: 开放给 ops?\nA: 不开放';
		expect(parseDelivery(answer)).toEqual({ kind: 'message', label: '提问已答复', body: 'Q: 开放给 ops?\nA: 不开放' });
		expect(parseDelivery('[message from agent ops · m-1]\n你好')).toMatchObject({ label: '来自 ops 的消息', body: '你好' });
		expect(parseDelivery('[message from relay · m-1]\nhi')).toMatchObject({ label: '来自 relay 的消息' });
		expect(parseDelivery('[timer t-1 fired · m-2]\n')).toMatchObject({ label: '定时器触发', body: '' });
		expect(parseDelivery('[scheduled task sch-1 · m-3]\n每日巡检')).toMatchObject({ label: '定时任务' });
		expect(parseDelivery('[task tk-1 update · m-4]\ndone')).toMatchObject({ label: '任务进展' });
	});

	it('leaves what the user wrote alone', () => {
		expect(parseDelivery('修复登录跳转')).toBeNull();
		expect(parseDelivery('[图片 #1] 看看这个')).toBeNull();
		expect(parseDelivery('[deferred action x approved] 我自己写的')).toBeNull();
	});
});
