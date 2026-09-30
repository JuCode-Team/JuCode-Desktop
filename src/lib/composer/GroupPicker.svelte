<script lang="ts" module>
	import { fetchJucodeGroups, type JucodeGroup } from '$lib/protocol';

	// Groups change rarely; fetch once per app run, again after a failure.
	let cached: Promise<JucodeGroup[]> | null = null;
	function loadGroups(): Promise<JucodeGroup[]> {
		cached ??= fetchJucodeGroups().catch((e) => {
			cached = null;
			throw e;
		});
		return cached;
	}
</script>

<script lang="ts">
	// Which JuCode group serves the current model. "Auto" leaves routing to
	// the gateway (lowest multiplier first, then the others); a group pins
	// requests for this model to it (`jucode_groups` in config.json, sent as
	// X-JuCode-Group by the engine from the next turn).
	import { onMount } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import { readConfig, writeConfig } from '$lib/protocol';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';

	let { model }: { model: string } = $props();

	let groups = $state<JucodeGroup[]>([]);
	let chosen = $state('');
	let open = $state(false);

	const served = $derived(
		groups.filter((g) => g.models?.includes(model)).sort((a, b) => a.rate_multiplier - b.rate_multiplier)
	);
	const current = $derived(served.find((g) => g.id === chosen));
	const mult = (n: number) => `×${Number(n.toFixed(3))}`;
	const billing = (g: JucodeGroup) =>
		g.billing_source === 'plan_only' ? t('chat.groupPlan') : g.billing_source === 'balance_only' ? t('chat.groupBalance') : '';

	onMount(() => {
		Promise.all([loadGroups(), readConfig()])
			.then(([list, cfg]) => {
				groups = list;
				const map = (cfg.jucode_groups ?? {}) as Record<string, string>;
				chosen = map[model] ?? '';
			})
			.catch(() => {});
	});

	async function pick(id: string) {
		const prev = chosen;
		chosen = id;
		open = false;
		try {
			const cfg = await readConfig();
			const map = { ...((cfg.jucode_groups ?? {}) as Record<string, string>) };
			if (id) map[model] = id;
			else delete map[model];
			await writeConfig({ jucode_groups: map });
		} catch (e) {
			chosen = prev;
			toast.error(t('chat.groupSaveFailed', { error: String(e) }));
		}
	}
</script>

<!-- Nothing to choose when one group (or none) serves the model. -->
{#if served.length > 1}
	<section class="groups">
		<button class="head" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="label">{t('chat.groupTitle')}</span>
			<span class="cur">{current ? current.name : t('chat.groupAuto')}</span>
			<span class="mult">{mult(current ? current.rate_multiplier : served[0].rate_multiplier)}</span>
			<span class="caret" class:open><CaretDownIcon size={13} /></span>
		</button>
		{#if open}
			<div class="list" role="listbox" aria-label={t('chat.groupTitle')}>
				<button class="pop-row" role="option" aria-selected={!current} onclick={() => pick('')}>
					<span class="pop-txt">
						<span class="pop-label">{t('chat.groupAuto')}</span>
						<span class="pop-desc">{t('chat.groupAutoDesc')}</span>
					</span>
					<span class="pop-check" class:off={!!current}><CheckIcon size={16} /></span>
				</button>
				{#each served as g (g.id)}
					{@const tag = billing(g)}
					<button class="pop-row" role="option" aria-selected={current?.id === g.id} onclick={() => pick(g.id)}>
						<span class="pop-txt">
							<span class="pop-label">{g.name}</span>
							{#if g.description || tag}
								<span class="pop-desc">{[tag, g.description].filter(Boolean).join(' · ')}</span>
							{/if}
						</span>
						<span class="mult">{mult(g.rate_multiplier)}</span>
						<span class="pop-check" class:off={current?.id !== g.id}><CheckIcon size={16} /></span>
					</button>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	.groups {
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.head:hover {
		background: var(--surface2);
	}
	.label {
		color: var(--dim2);
	}
	.cur {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text);
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mult {
		flex-shrink: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.caret {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(180deg);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 4px;
		animation: rise var(--t-fast) var(--ease-out);
	}
	.pop-check.off {
		visibility: hidden;
	}
</style>
