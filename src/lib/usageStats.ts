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

export function dayKey(d: Date): string {
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

function readDim(v: unknown): Record<string, DimUsage> | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const out: Record<string, DimUsage> = {};
	for (const [k, e] of Object.entries(v as Record<string, Partial<DimUsage> | null>))
		out[k] = { in: Number(e?.in) || 0, out: Number(e?.out) || 0 };
	return out;
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
				const prov = readDim(d?.prov);
				if (prov) day.prov = prov;
				const models = readDim(d?.models);
				if (models) day.models = models;
				const agents = readDim(d?.agents);
				if (agents) day.agents = agents;
				if (d?.agentLabels && typeof d.agentLabels === 'object') {
					day.agentLabels = {};
					for (const [ak, al] of Object.entries(d.agentLabels))
						if (typeof al === 'string' && al) day.agentLabels[ak] = al;
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
	const e = (map[k] ??= { in: 0, out: 0 });
	e.in += inT;
	e.out += outT;
	return k;
}

export function recordUsage(inTokens: number, outTokens: number, meta?: UsageMeta) {
	if (!inTokens && !outTokens) return;
	const map = load();
	const k = dayKey(new Date());
	const d = (map[k] ??= { in: 0, out: 0 });
	d.in += inTokens;
	d.out += outTokens;
	bump((d.prov ??= {}), meta?.provider, inTokens, outTokens);
	bump((d.models ??= {}), meta?.model, inTokens, outTokens);
	const agentKey = bump((d.agents ??= {}), meta?.agent, inTokens, outTokens);
	const label = meta?.agentLabel?.trim();
	if (label && agentKey !== 'other') (d.agentLabels ??= {})[agentKey] = label;
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
			const e = (acc[k] ??= { in: 0, out: 0 });
			e.in += v.in;
			e.out += v.out;
		}
	}
	return Object.entries(acc).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));
}

/** 汇总各天记录到的 agent 展示名（后出现的覆盖先出现的）。 */
export function collectAgentLabels(days: DayUsage[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const d of days) if (d.agentLabels) Object.assign(out, d.agentLabels);
	return out;
}

export const fmtTokens = (n: number) =>
	n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
