import { describe, expect, it } from 'vitest';
import { breakdownRows, categoryKey } from './contextBreakdown';

describe('context breakdown', () => {
	it('splits what is in use from deferred tools and the room left', () => {
		const b = breakdownRows({
			total: 13512,
			max: 1_000_000,
			categories: [
				{ name: 'System prompt', tokens: 2419, kind: 'used' },
				{ name: 'System tools (deferred)', tokens: 13927, kind: 'deferred' },
				{ name: 'Memory files', tokens: 1110, kind: 'used' },
				{ name: 'Messages', tokens: 0, kind: 'used' },
				{ name: 'Free space', tokens: 953488, kind: 'free' },
				{ name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' }
			],
			memoryFiles: []
		});
		expect(b.used.map((r) => [r.name, r.hue, r.pct])).toEqual([
			['System prompt', 0, 0.2],
			['Memory files', 1, 0.1]
		]);
		expect(b.deferred.map((r) => r.name)).toEqual(['System tools (deferred)']);
		expect(b.room.map((r) => r.kind)).toEqual(['buffer', 'free']);
	});

	it('without a window, shares are of what is in use', () => {
		const b = breakdownRows({ total: 30, max: 0, categories: [{ name: 'Skills', tokens: 30, kind: 'used' }], memoryFiles: [] });
		expect(b.used[0]!.pct).toBe(100);
	});

	it('labels the names engines send, and leaves others as they are', () => {
		expect(categoryKey('Tool results')).toBe('toolResults');
		expect(categoryKey('Something new')).toBeUndefined();
	});
});
