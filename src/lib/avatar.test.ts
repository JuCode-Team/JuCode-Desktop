import { describe, it, expect } from 'vitest';
import { avatarSvg, newAvatarSeed } from './avatar';
import { sanitizeSvg } from './workbench/tabChrome';

describe('avatarSvg', () => {
	it('is the same for the same seed', () => {
		expect(avatarSvg('ops')).toBe(avatarSvg('ops'));
		expect(avatarSvg('ops', '#2563eb')).toBe(avatarSvg('ops', '#2563eb'));
	});

	it('differs between seeds', () => {
		const seeds = ['ops', 'web', 'ops2', 'a', 'b', ...Array.from({ length: 200 }, (_, i) => `agent-${i}`)];
		expect(new Set(seeds.map((s) => avatarSvg(s))).size).toBe(seeds.length);
	});

	it('takes its hue from a colour', () => {
		expect(avatarSvg('ops', '#dc2626')).toContain('hsl(0 52% 52%)');
		expect(avatarSvg('ops', '#2563eb')).not.toBe(avatarSvg('ops'));
	});

	it('is a plain svg the icon sanitizer accepts', () => {
		for (const seed of ['ops', 'web', '', newAvatarSeed()]) expect(sanitizeSvg(avatarSvg(seed))).not.toBeNull();
	});
});

describe('newAvatarSeed', () => {
	it('is 16 hex digits, new each time', () => {
		const seed = newAvatarSeed();
		expect(seed).toMatch(/^[0-9a-f]{16}$/);
		expect(newAvatarSeed()).not.toBe(seed);
	});
});
