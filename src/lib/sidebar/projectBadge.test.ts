import { describe, expect, it } from 'vitest';
import { badgeColor, initials } from './projectBadge';

describe('initials', () => {
	it('takes the first and last words, else the first and last letters', () => {
		expect(initials('jucode')).toBe('JE');
		expect(initials('JuCode-Desktop')).toBe('JD');
		expect(initials('my app v2')).toBe('MV');
		expect(initials('a')).toBe('A');
	});
});

describe('badgeColor', () => {
	it('keeps the project colour, else picks one from the name', () => {
		expect(badgeColor('x', '#123456')).toBe('#123456');
		expect(badgeColor('lumi')).toBe(badgeColor('lumi'));
	});
});
