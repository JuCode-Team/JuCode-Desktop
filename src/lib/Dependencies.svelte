<script lang="ts">
	// Runtime tools with detection and one-click install. `ids` limits the list
	// (settings shows only the non-engine tools; the engine rows carry their
	// own install button).
	import { onMount } from 'svelte';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import DepAction from '$lib/DepAction.svelte';
	import DepDetails from '$lib/DepDetails.svelte';
	import { deps, recheckDeps } from '$lib/deps.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';

	let { ids }: { ids?: string[] } = $props();

	// Brand marks (Simple Icons, CC0) for the tools that are not engines.
	const MARKS: Record<string, string> = {
		git: 'M13.09 23.549a1.54 1.54 0 0 1-2.18 0L.451 13.089a1.54 1.54 0 0 1 0-2.179l7.191-7.19 2.733 2.733a1.85 1.85 0 0 0 .964 2.326v6.66a1.849 1.849 0 1 0 1.54 0V8.957l2.508 2.508a1.85 1.85 0 1 0 1.09-1.09l-2.634-2.634a1.85 1.85 0 0 0-2.378-2.377L8.73 2.63 10.91.451a1.54 1.54 0 0 1 2.179 0l10.459 10.46a1.54 1.54 0 0 1 0 2.179z',
		gh: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
		node: 'M11.998,24c-0.321,0-0.641-0.084-0.922-0.247l-2.936-1.737c-0.438-0.245-0.224-0.332-0.08-0.383 c0.585-0.203,0.703-0.25,1.328-0.604c0.065-0.037,0.151-0.023,0.218,0.017l2.256,1.339c0.082,0.045,0.197,0.045,0.272,0l8.795-5.076 c0.082-0.047,0.134-0.141,0.134-0.238V6.921c0-0.099-0.053-0.192-0.137-0.242l-8.791-5.072c-0.081-0.047-0.189-0.047-0.271,0 L3.075,6.68C2.99,6.729,2.936,6.825,2.936,6.921v10.15c0,0.097,0.054,0.189,0.139,0.235l2.409,1.392 c1.307,0.654,2.108-0.116,2.108-0.89V7.787c0-0.142,0.114-0.253,0.256-0.253h1.115c0.139,0,0.255,0.112,0.255,0.253v10.021 c0,1.745-0.95,2.745-2.604,2.745c-0.508,0-0.909,0-2.026-0.551L2.28,18.675c-0.57-0.329-0.922-0.945-0.922-1.604V6.921 c0-0.659,0.353-1.275,0.922-1.603l8.795-5.082c0.557-0.315,1.296-0.315,1.848,0l8.794,5.082c0.57,0.329,0.924,0.944,0.924,1.603 v10.15c0,0.659-0.354,1.273-0.924,1.604l-8.794,5.078C12.643,23.916,12.324,24,11.998,24z M19.099,13.993 c0-1.9-1.284-2.406-3.987-2.763c-2.731-0.361-3.009-0.548-3.009-1.187c0-0.528,0.235-1.233,2.258-1.233 c1.807,0,2.473,0.389,2.747,1.607c0.024,0.115,0.129,0.199,0.247,0.199h1.141c0.071,0,0.138-0.031,0.186-0.081 c0.048-0.054,0.074-0.123,0.067-0.196c-0.177-2.098-1.571-3.076-4.388-3.076c-2.508,0-4.004,1.058-4.004,2.833 c0,1.925,1.488,2.457,3.895,2.695c2.88,0.282,3.103,0.703,3.103,1.269c0,0.983-0.789,1.402-2.642,1.402 c-2.327,0-2.839-0.584-3.011-1.742c-0.02-0.124-0.126-0.215-0.253-0.215h-1.137c-0.141,0-0.254,0.112-0.254,0.253 c0,1.482,0.806,3.248,4.655,3.248C17.501,17.007,19.099,15.91,19.099,13.993z',
		ffmpeg: 'M21.72 17.91V6.5l-.53-.49L9.05 18.52l-1.29-.06L24 1.53l-.33-.95-11.93 1-5.75 6.6v-.23l4.7-5.39-1.38-.77-9.11.77v2.85l1.91.46v.01l.19-.01-.56.66v10.6c.609-.126 1.22-.241 1.83-.36L14.12 5.22l.83-.04L0 21.44l9.67.82 1.35-.77 6.82-6.74v2.15l-5.72 5.57 11.26.95.35-.94v-3.16l-3.29-.18c.434-.403.858-.816 1.28-1.23z'
	};
	const ENGINES = new Set(['jucode', 'claude', 'codex']);

	const shown = $derived(ids ? deps.list.filter((d) => ids.includes(d.id)) : deps.list);

	onMount(recheckDeps);
</script>

<div class="deps">
	<div class="head">
		<div class="htext">
			<h3>{t('setup.deps.title')}</h3>
			<p class="sub">{t('setup.deps.sub')}</p>
		</div>
		<Button variant="ghost" size="sm" onclick={recheckDeps} disabled={deps.loading}>
			{#if deps.loading}<CircleNotchIcon size={14} class="spin" />{:else}<ArrowsClockwiseIcon size={14} />{/if}
			{t('setup.deps.recheck')}
		</Button>
	</div>

	{#if shown.length}
		<div class="list">
			{#each shown as dep (dep.id)}
				<div class="item">
					<div class="dep">
						<span class="tile">
							{#if ENGINES.has(dep.id)}
								<BackendIcon backend={dep.id as 'jucode' | 'claude' | 'codex'} size={16} />
							{:else if MARKS[dep.id]}
								<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d={MARKS[dep.id]} /></svg>
							{/if}
						</span>
						<div class="dep-txt">
							<span class="dep-name">{t(`setup.deps.tools.${dep.id}.name`)}</span>
							<span class="dep-detail" class:mono={dep.present} title={dep.present ? dep.detail : undefined}>
								{dep.present ? dep.detail : t(`setup.deps.tools.${dep.id}.desc`)}
							</span>
						</div>
						<DepAction {dep} />
					</div>
					<DepDetails {dep} />
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.deps {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.head {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		margin: 0 2px;
	}
	.htext {
		flex: 1;
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
	}
	.sub {
		margin: 3px 0 0;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	/* One card with hairline-divided rows, like a settings section. */
	.list {
		background: var(--panel);
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
	}
	:global([data-theme='light']) .list {
		background: var(--surface);
		border-color: var(--border);
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 18px;
	}
	.item + .item {
		border-top: 1px solid var(--hairline);
	}
	.dep {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--r-sm);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		color: var(--text);
		flex-shrink: 0;
	}
	.dep-txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.dep-name {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.dep-detail {
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dep-detail.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
</style>
