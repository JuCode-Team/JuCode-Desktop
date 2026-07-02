// 本机每日 token 用量统计：由引擎 `usage` 事件累计，按天分桶持久化到
// localStorage（与 jucode-projects 相同的持久化方式），独立于 JuCode API。
const KEY = 'jucode-usage-daily';
const RETENTION_DAYS = 400;

export interface ProviderUsage {
	in: number;
	out: number;
}

export interface DayUsage {
	in: number;
	out: number;
	/** 按 provider 拆分的明细；顶层 in/out 恒为各 provider 之和（含旧版无明细的数据）。 */
	prov?: Record<string, ProviderUsage>;
}

let cache: Record<string, DayUsage> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function dayKey(d: Date): string {
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

function load(): Record<string, DayUsage> {
	if (cache) return cache;
	cache = {};
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			for (const [k, v] of Object.entries(parsed)) {
				const d = v as Partial<DayUsage> | null;
				if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
				const day: DayUsage = { in: Number(d?.in) || 0, out: Number(d?.out) || 0 };
				if (d?.prov && typeof d.prov === 'object') {
					day.prov = {};
					for (const [p, pv] of Object.entries(d.prov))
						day.prov[p] = { in: Number(pv?.in) || 0, out: Number(pv?.out) || 0 };
				}
				cache[k] = day;
			}
		}
	} catch {
		// 存储损坏或不可用：从空数据开始
	}
	return cache;
}

function persist() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		if (!cache) return;
		const cutoff = dayKey(new Date(Date.now() - RETENTION_DAYS * 86_400_000));
		for (const k of Object.keys(cache)) if (k < cutoff) delete cache[k];
		try {
			localStorage.setItem(KEY, JSON.stringify(cache));
		} catch {
			// 写入失败（配额等）：数据仍保留在内存中
		}
	}, 800);
}

export function recordUsage(inTokens: number, outTokens: number, provider?: string) {
	if (!inTokens && !outTokens) return;
	const map = load();
	const k = dayKey(new Date());
	const d = (map[k] ??= { in: 0, out: 0 });
	d.in += inTokens;
	d.out += outTokens;
	const pkey = provider?.trim() || 'other';
	const p = ((d.prov ??= {})[pkey] ??= { in: 0, out: 0 });
	p.in += inTokens;
	p.out += outTokens;
	persist();
}

export function getDailyUsage(): Record<string, DayUsage> {
	return load();
}

export const fmtTokens = (n: number) =>
	n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
