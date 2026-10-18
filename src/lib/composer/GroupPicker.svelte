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

	export type ToolProvider = {
		/** "Claude Code" / "Codex", named in the local row. */
		name: string;
		/** The model runs on this machine / on the gateway. */
		local: boolean;
		jucode: boolean;
		onJucode: boolean;
		/** On this machine through one of the tool's custom providers (set in
		 *  Settings): its name. */
		custom?: string;
		group: string;
		/** The session's group reaches its requests (it runs in the daemon). */
		groups: boolean;
		onPick: (choice: { local: true } | { group: string }) => void;
	};
</script>

<script lang="ts">
	import { overBrowser } from '$lib/browser.svelte';
	// Which JuCode group serves the current model. "Auto" leaves routing to
	// the gateway (lowest multiplier first, then the others); a group pins
	// requests for this model to it (`jucode_groups` in config.json, sent as
	// X-JuCode-Group by the engine from the next turn). With `tool` it is the
	// provider of one Claude Code / Codex session instead: this machine (the
	// tool's own login or config) or the gateway, on a group of its own that
	// the daemon's local gateway applies to its next request.
	import { onMount } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { readConfig, writeConfig } from '$lib/protocol';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { fmtContext } from './modelRows';

	let {
		model,
		tool
	}: {
		/** The gateway's name for the model. */
		model: string;
		tool?: ToolProvider;
	} = $props();

	let groups = $state<JucodeGroup[]>([]);
	let configured = $state('');
	// Claude Code reports a long-context model as `name[1m]`.
	const base = $derived(model.replace(/\[[^\]]*\]$/, ''));
	let open = $state(false);

	const served = $derived(
		!tool || (tool.jucode && tool.groups)
			? groups.filter((g) => g.models?.includes(base)).sort((a, b) => a.rate_multiplier - b.rate_multiplier)
			: []
	);
	const chosen = $derived(tool ? tool.group : configured);
	const local = $derived(!!tool && !tool.onJucode);
	const current = $derived(local ? undefined : served.find((g) => g.id === chosen));
	// One group is what "auto" picks anyway: no rows of its own.
	const listed = $derived(served.length > 1 ? served : []);
	// A custom provider is named even with nothing else to choose.
	const custom = $derived(local ? (tool?.custom ?? '') : '');
	const shown = $derived(
		tool ? !!custom || (tool.local ? 1 : 0) + (tool.jucode ? 1 : 0) + listed.length > 1 : listed.length > 0
	);
	const mult = (n: number) => `×${Number(n.toFixed(3))}`;
	const billing = (g: JucodeGroup) =>
		g.billing_source === 'plan_only' ? t('chat.groupPlan') : g.billing_source === 'balance_only' ? t('chat.groupBalance') : '';
	const autoLabel = $derived(tool ? t('chat.providerAuto') : t('chat.groupAuto'));
	const localLabel = $derived(custom ? t('chat.providerCustom', { name: custom }) : t('chat.providerLocal'));
	const currentLabel = $derived(local ? localLabel : current ? current.name : autoLabel);

	onMount(() => {
		Promise.all([loadGroups(), tool ? null : readConfig()])
			.then(([list, cfg]) => {
				groups = list;
				const map = (cfg?.jucode_groups ?? {}) as Record<string, string>;
				configured = map[model] ?? '';
			})
			.catch(() => {});
	});

	async function pick(id: string) {
		open = false;
		if (tool) {
			tool.onPick({ group: id });
			return;
		}
		const prev = configured;
		configured = id;
		try {
			const cfg = await readConfig();
			const map = { ...((cfg.jucode_groups ?? {}) as Record<string, string>) };
			if (id) map[model] = id;
			else delete map[model];
			await writeConfig({ jucode_groups: map });
		} catch (e) {
			configured = prev;
			toast.error(t('chat.groupSaveFailed', { error: String(e) }));
		}
	}
	function pickLocal() {
		open = false;
		tool?.onPick({ local: true });
	}
</script>

<!-- Nothing to choose when one option (or none) serves the model. -->
{#if shown}
	<section class="groups">
		<button class="head" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="label">{tool ? t('chat.provider') : t('chat.groupTitle')}</span>
			<span class="cur">{currentLabel}</span>
			{#if !local && served.length}
				<span class="mult">{mult(current ? current.rate_multiplier : served[0].rate_multiplier)}</span>
			{/if}
			<span class="caret" class:open><ChevronDownIcon size={14} /></span>
		</button>
		{#if open}
			<div use:overBrowser class="list" role="listbox" aria-label={tool ? t('chat.provider') : t('chat.groupTitle')}>
				{#if tool?.local || custom}
					<button class="pop-row" role="option" aria-selected={local} onclick={pickLocal}>
						<span class="pop-txt">
							<span class="pop-label">{localLabel}</span>
							<span class="pop-desc">{t(custom ? 'chat.providerCustomDesc' : 'chat.providerLocalDesc', { tool: tool?.name ?? '' })}</span>
						</span>
						<span class="pop-check" class:off={!local}><CheckIcon size={16} /></span>
					</button>
				{/if}
				{#if !tool || tool.jucode}
					<button class="pop-row" role="option" aria-selected={!local && !current} onclick={() => pick('')}>
						<span class="pop-txt">
							<span class="pop-label">{autoLabel}</span>
							<span class="pop-desc">{tool ? t('chat.groupSessionAutoDesc') : t('chat.groupAutoDesc')}</span>
						</span>
						<span class="pop-check" class:off={local || !!current}><CheckIcon size={16} /></span>
					</button>
				{/if}
				{#each listed as g (g.id)}
					{@const tag = billing(g)}
					{@const win = fmtContext(g.context_windows?.[base]?.context_window)}
					<button class="pop-row" role="option" aria-selected={current?.id === g.id} onclick={() => pick(g.id)}>
						<span class="pop-txt">
							<span class="pop-label">{g.name}</span>
							{#if g.description || tag || win}
								{@const desc = [win, tag, g.description].filter(Boolean).join(' · ')}
								<span class="pop-desc" title={desc}>{desc}</span>
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
		border-radius: var(--r);
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
	/* Group names and descriptions are admin-written and can be long. WebKit
	   (the macOS app) does not wrap them inside the row button and lets them
	   run past the menu over the multiplier, so they stay on one line and
	   truncate; the full description is the row's tooltip. */
	.pop-label,
	.pop-desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
