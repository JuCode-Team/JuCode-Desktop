// A project's badge when it has no icon of its own: two letters of its name
// (of its first and last words, else its first and last letters) on a tint
// of its colour, or of one its name picks from the tag colours.
import { TAB_COLORS } from '$lib/workbench/tabChrome';

export function initials(name: string): string {
	const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
	if (!words.length) return '?';
	const first = words[0]!;
	const last = words.length > 1 ? words[words.length - 1]![0]! : first.length > 1 ? first[first.length - 1]! : '';
	return (first[0]! + last).toUpperCase();
}

export function badgeColor(name: string, color?: string): string {
	if (color) return color;
	let h = 0;
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return TAB_COLORS[h % TAB_COLORS.length]!;
}
