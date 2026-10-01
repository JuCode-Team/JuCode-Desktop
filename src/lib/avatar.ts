// Generated agent avatars: a seed string → an inline SVG, the same every time.
// A rounded square tinted in the seed's hue holds a 4×4 grid, mirrored left
// to right, of simple shapes (square, quarter circle, half-diagonal triangle,
// dot) in two colours. The tint is translucent, so the tile sits on the light
// and the dark theme alike.

/** mulberry32 seeded from an FNV-1a hash of the string. */
function random(seed: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
	return () => {
		h = (h + 0x6d2b79f5) | 0;
		let t = Math.imul(h ^ (h >>> 15), 1 | h);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Hue of a `#rrggbb` colour, in degrees. */
function hueOf(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	if (!d) return 0;
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return h * 60;
}

const GRID = 4;
const CELL = 8;
const PAD = 4;
/** Corners TL, TR, BR, BL as [x, y] offsets, and their left-right mirrors. */
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const MIRROR = [1, 0, 3, 2];

/** One cell's shape with its right-angle (or arc centre) at `corner`. */
function shape(kind: number, corner: number, x: number, y: number, fill: string): string {
	const [cx, cy] = CORNERS[corner];
	const px = x + cx * CELL;
	const py = y + cy * CELL;
	const ax = px + (cx ? -CELL : CELL); // along the row
	const by = py + (cy ? -CELL : CELL); // along the column
	switch (kind) {
		case 1:
			return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${fill}"/>`;
		case 2: {
			const sweep = cx === cy ? 1 : 0;
			return `<path d="M${px} ${py}L${ax} ${py}A${CELL} ${CELL} 0 0 ${sweep} ${px} ${by}Z" fill="${fill}"/>`;
		}
		case 3:
			return `<path d="M${px} ${py}L${ax} ${py}L${px} ${by}Z" fill="${fill}"/>`;
		case 4:
			return `<circle cx="${x + CELL / 2}" cy="${y + CELL / 2}" r="${CELL * 0.32}" fill="${fill}"/>`;
		default:
			return '';
	}
}

/** The avatar for `seed`; `color` (`#rrggbb`) sets its hue. */
export function avatarSvg(seed: string, color?: string | null): string {
	const rand = random(seed || '?');
	const hue = color ? hueOf(color) : Math.floor(rand() * 360);
	// The second colour sits 40–80° along the wheel: related, never clashing.
	const hue2 = (hue + 40 + Math.floor(rand() * 40)) % 360;
	const fills = [`hsl(${hue} 52% 52%)`, `hsl(${hue2} 46% 64%)`];
	const cells: { kind: number; corner: number; fill: string }[] = [];
	for (let i = 0; i < GRID * (GRID / 2); i++) {
		const r = rand();
		// Empty a quarter of the time; the other shapes share the rest.
		const kind = r < 0.25 ? 0 : 1 + Math.floor(((r - 0.25) / 0.75) * 4);
		cells.push({ kind, corner: Math.floor(rand() * 4), fill: fills[rand() < 0.68 ? 0 : 1] });
	}
	if (cells.every((c) => !c.kind)) cells[0].kind = 1;
	let body = '';
	for (let row = 0; row < GRID; row++) {
		for (let col = 0; col < GRID / 2; col++) {
			const c = cells[row * (GRID / 2) + col];
			const y = PAD + row * CELL;
			body += shape(c.kind, c.corner, PAD + col * CELL, y, c.fill);
			body += shape(c.kind, MIRROR[c.corner], PAD + (GRID - 1 - col) * CELL, y, c.fill);
		}
	}
	const size = PAD * 2 + GRID * CELL;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
		`<rect width="${size}" height="${size}" rx="9" fill="${fills[0]}" fill-opacity="0.16"/>${body}</svg>`
	);
}

/** A fresh random seed (a new agent, or 「换一个」). */
export function newAvatarSeed(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}
