/** A balance to two decimals, cut rather than rounded so it never reads higher
 *  than it is. Amounts spent are shown as the server sends them. */
export function fmtBalance(v?: string | null): string {
	const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec((v ?? '').trim() || '0');
	if (!m) return v ?? '';
	const frac = (m[3] ?? '').padEnd(2, '0').slice(0, 2);
	const int = m[2] || '0';
	const sign = m[1] && /[1-9]/.test(int + frac) ? '-' : '';
	return `${sign}${int}.${frac}`;
}
