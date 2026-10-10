import { describe, expect, it } from 'vitest';
import { when } from './time';

describe('when', () => {
	const now = new Date(2026, 9, 10, 15, 0);
	it('is 24-hour, with the date only when it is not today', () => {
		expect(when(new Date(2026, 9, 10, 0, 4).getTime(), now)).toBe('00:04');
		expect(when(new Date(2026, 9, 9, 13, 30).getTime(), now)).toBe('10/9 13:30');
		expect(when(new Date(2025, 0, 2, 9, 5).getTime(), now)).toBe('2025/1/2 09:05');
	});
});
