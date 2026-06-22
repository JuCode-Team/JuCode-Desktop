<script lang="ts">
	let { pct, label = '' }: { pct: number; label?: string } = $props();

	const R = 13;
	const C = 2 * Math.PI * R;
	const dash = $derived((Math.max(0, Math.min(100, pct)) / 100) * C);
	const stroke = $derived(pct >= 90 ? 'var(--err)' : pct >= 75 ? 'var(--warn)' : 'var(--accent-bright)');
</script>

<span class="ring" title={label}>
	<svg viewBox="0 0 32 32" width="30" height="30">
		<circle cx="16" cy="16" r={R} fill="none" stroke="var(--surface2)" stroke-width="3" />
		<circle
			cx="16"
			cy="16"
			r={R}
			fill="none"
			stroke={stroke}
			stroke-width="3"
			stroke-linecap="round"
			stroke-dasharray="{dash} {C}"
			transform="rotate(-90 16 16)"
		/>
	</svg>
	<span class="num">{pct}</span>
</span>

<style>
	.ring {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.num {
		position: absolute;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--text);
	}
</style>
