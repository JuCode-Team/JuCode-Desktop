import { describe, expect, it } from 'vitest';
import { fmtBalance } from './money';

describe('fmtBalance', () => {
	it('cuts to two decimals', () => {
		expect(fmtBalance('123.456789')).toBe('123.45');
		expect(fmtBalance('0.29')).toBe('0.29');
		expect(fmtBalance('9.999')).toBe('9.99');
	});
	it('pads whole and short amounts', () => {
		expect(fmtBalance('100')).toBe('100.00');
		expect(fmtBalance('0.5')).toBe('0.50');
		expect(fmtBalance(undefined)).toBe('0.00');
	});
	it('keeps the sign only when something is left', () => {
		expect(fmtBalance('-3.141')).toBe('-3.14');
		expect(fmtBalance('-0.001')).toBe('0.00');
	});
});
