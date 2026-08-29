// 本机每日 token 用量统计：由引擎 `usage` 事件累计，按天分桶持久化到
// localStorage（与 jucode-projects 相同的持久化方式），独立于 JuCode API。
const KEY = 'jucode-usage-daily';
const RETENTION_DAYS = 400;

export interface DimUsage {
	in: number;
	out: number;
}

/** 可拆分的统计维度：渠道（provider）、模型、智能体。 */
export type UsageDimension = 'prov' | 'models' | 'agents';

export interface DayUsage {
	in: number;
	out: number;
	/** 按渠道（provider）拆分的明细；顶层 in/out 恒为总和（含旧版无明细的数据）。 */
	prov?: Record<string, DimUsage>;
	/** 按模型拆分的明细（旧数据没有，缺失属正常）。 */
	models?: Record<string, DimUsage>;
	/** 按智能体拆分的明细，key 为 jucode | claude | codex | acp | acp:<id>。 */
	agents?: Record<string, DimUsage>;
	/** agent key → 展示名（如 acp:<id> 对应的 ACP agent 名称），仅供 UI 使用。 */
	agentLabels?: Record<string, string>;
}

export interface UsageMeta {
	provider?: string;
	model?: string;
	agent?: string;
	/** agent key 的展示名；仅在 key 稳定但不适合直接展示时（acp:<id>）需要。 */
	agentLabel?: string;
}

let cache: Record<string, DayUsage> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function tokenCount(v: unknown): number {
	const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : 0;
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

function ownUsage(map: Record<string, DimUsage>, key: string): DimUsage {
	if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
	const usage = { in: 0, out: 0 };
	Object.defineProperty(map, key, { value: usage, enumerable: true, configurable: true, writable: true });
	return usage;
}

function setOwnLabel(map: Record<string, string>, key: string, label: string) {
	Object.defineProperty(map, key, { value: label, enumerable: true, configurable: true, writable: true });
}

export function dayKey(d: Date): string {
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

function readDim(v: unknown): Record<string, DimUsage> | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const out: Record<string, DimUsage> = {};
	for (const [rawKey, e] of Object.entries(v as Record<string, Partial<DimUsage> | null>)) {
		const key = rawKey.trim();
		if (!key) continue;
		const inTokens = tokenCount(e?.in);
		const outTokens = tokenCount(e?.out);
		if (!inTokens && !outTokens) continue;
		const usage = ownUsage(out, key);
		usage.in += inTokens;
		usage.out += outTokens;
	}
	return Object.keys(out).length ? out : undefined;
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
				const day: DayUsage = { in: tokenCount(d?.in), out: tokenCount(d?.out) };
				const prov = readDim(d?.prov);
				if (prov) day.prov = prov;
				const models = readDim(d?.models);
				if (models) day.models = models;
				const agents = readDim(d?.agents);
				if (agents) day.agents = agents;
				if (d?.agentLabels && typeof d.agentLabels === 'object') {
					const labels: Record<string, string> = {};
					for (const [rawKey, rawLabel] of Object.entries(d.agentLabels)) {
						const key = rawKey.trim();
						const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
						if (key && label) setOwnLabel(labels, key, label);
					}
					if (Object.keys(labels).length) day.agentLabels = labels;
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

/** 空白/缺失的 key 归入 'other' 桶。 */
function bump(map: Record<string, DimUsage>, key: string | undefined, inT: number, outT: number): string {
	const k = key?.trim() || 'other';
	const e = ownUsage(map, k);
	e.in += inT;
	e.out += outT;
	return k;
}

export function recordUsage(inTokens: number, outTokens: number, meta?: UsageMeta) {
	const inT = tokenCount(inTokens);
	const outT = tokenCount(outTokens);
	if (!inT && !outT) return;
	const map = load();
	const k = dayKey(new Date());
	const d = (map[k] ??= { in: 0, out: 0 });
	d.in += inT;
	d.out += outT;
	bump((d.prov ??= {}), meta?.provider, inT, outT);
	bump((d.models ??= {}), meta?.model, inT, outT);
	const agentKey = bump((d.agents ??= {}), meta?.agent, inT, outT);
	const label = meta?.agentLabel?.trim();
	if (label && agentKey !== 'other') setOwnLabel((d.agentLabels ??= {}), agentKey, label);
	persist();
}

export function getDailyUsage(): Record<string, DayUsage> {
	return load();
}

/** 将若干天在某一维度上的明细求和，按总量降序返回条目。 */
export function sumDimension(days: DayUsage[], dim: UsageDimension): [string, DimUsage][] {
	const acc: Record<string, DimUsage> = {};
	for (const d of days) {
		const m = d[dim];
		if (!m) continue;
		for (const [k, v] of Object.entries(m)) {
			const e = ownUsage(acc, k);
			e.in += v.in;
			e.out += v.out;
		}
	}
	return Object.entries(acc).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));
}

/** 汇总各天记录到的 agent 展示名（后出现的覆盖先出现的）。 */
export function collectAgentLabels(days: DayUsage[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const d of days) {
		if (!d.agentLabels) continue;
		for (const [key, label] of Object.entries(d.agentLabels)) setOwnLabel(out, key, label);
	}
	return out;
}

export const fmtTokens = (n: number) =>
	n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
