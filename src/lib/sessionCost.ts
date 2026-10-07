import { t } from './i18n';

/** Gateway points are settled amounts, already including the request's group rate. */
export interface BillingCost {
	gateway_cost: number | null;
	estimated_cost_usd: number | null;
	gateway_requests: number;
	pending_requests: number;
	unpriced_requests: number;
}

export function pendingCost(): BillingCost {
	return { gateway_cost: null, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 1, unpriced_requests: 0 };
}

export function sumCosts(rows: BillingCost[]): BillingCost {
	const sum = (key: 'gateway_cost' | 'estimated_cost_usd') => {
		const values = rows.flatMap(row => row[key] === null ? [] : [row[key] as number]);
		return values.length ? values.reduce((a, b) => a + b, 0) : null;
	};
	return {
		gateway_cost: sum('gateway_cost'), estimated_cost_usd: sum('estimated_cost_usd'),
		gateway_requests: rows.reduce((n, r) => n + r.gateway_requests, 0),
		pending_requests: rows.reduce((n, r) => n + r.pending_requests, 0),
		unpriced_requests: rows.reduce((n, r) => n + r.unpriced_requests, 0)
	};
}

export function costText(estimate: number, billing?: BillingCost | null): string {
	if (!billing) return estimate > 0 ? t('chat.costEstimate', { cost: estimate.toFixed(4) }) : '—';
	const parts: string[] = [];
	if (billing.gateway_cost !== null) parts.push(t('chat.costSettled', { cost: billing.gateway_cost.toFixed(4) }));
	if (billing.estimated_cost_usd !== null) parts.push(t('chat.costEstimate', { cost: billing.estimated_cost_usd.toFixed(4) }));
	if (billing.pending_requests) parts.push(t('chat.costPending'));
	if (billing.unpriced_requests) parts.push(t('chat.costUnknown'));
	return parts.join(' · ') || '—';
}
