import { describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n';
import type { SessionOption } from '$lib/protocol';
import { choiceLabel, optionLabel } from './sessionOptions';

const mode = (choices: [string, string][]): SessionOption => ({
	id: 'mode',
	name: 'Session Mode',
	description: null,
	category: 'mode',
	type: 'select',
	value: choices[0][0],
	choices: choices.map(([value, name]) => ({ value, name, description: null }))
});

describe('ACP session option labels', () => {
	it("names the mode option and the app's modes in the app's words", () => {
		setLocale('zh');
		// OpenCode
		const opencode = mode([
			['build', 'Build'],
			['plan', 'Plan']
		]);
		expect(optionLabel(opencode)).toBe('模式');
		expect(opencode.type === 'select' && opencode.choices.map((c) => choiceLabel(opencode, c))).toEqual(['Build', '计划']);
		// oh-my-pi
		const omp = mode([
			['default', 'Default'],
			['plan', 'Plan']
		]);
		expect(omp.type === 'select' && omp.choices.map((c) => choiceLabel(omp, c))).toEqual(['默认', '计划']);
	});

	it('leaves other options as the agent names them', () => {
		const other: SessionOption = { id: 'x', name: 'Auto compact', description: null, category: null, type: 'boolean', value: true };
		expect(optionLabel(other)).toBe('Auto compact');
	});
});
