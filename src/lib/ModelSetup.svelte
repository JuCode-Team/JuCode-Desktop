<script lang="ts">
	// "Models to show": the JuCode account reaches every model in every group
	// it may use, far more than a model menu can hold. The user checks the ones
	// they want; they become `jucode_models` in config.json (and `models` while
	// JuCode is the provider), which the engine's model menu lists. Each row
	// also takes a context window (`context_window_overrides`): it fills in one
	// the gateway has not configured, or raises the advertised (smallest-account)
	// window up to the gateway's largest.
	import { onMount } from 'svelte';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { fetchJucodeModels, readConfig, writeConfig, type JucodeModel } from '$lib/protocol';
	import { fmtContext } from '$lib/composer/modelRows';
	import { savedModel } from '$lib/jucodeModels';
	import { DEFAULT_MODELS } from '$lib/defaultModels';
	import { t } from '$lib/i18n';

	let { onClose }: { onClose: () => void } = $props();

	let models = $state<JucodeModel[]>([]);
	let picked = $state<string[]>([]);
	let query = $state('');
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);
	let cfg: Record<string, unknown> = {};
	/** Typed window per model id ("" = use the gateway's). */
	let windows = $state<Record<string, string>>({});

	/** "400000", "272k", "1m" → tokens; "" → 0; garbage → NaN. */
	function parseWindow(raw: string | undefined): number {
		const v = (raw ?? '').trim().toLowerCase();
		if (!v) return 0;
		const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(v);
		if (!m) return NaN;
		return Math.round(parseFloat(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1));
	}
	/** Largest window the gateway can serve; 0 when it configured none. */
	const maxWindow = (m: JucodeModel) => m.max_context_window || m.context_window || 0;
	function windowProblem(m: JucodeModel): string {
		const n = parseWindow(windows[m.id]);
		if (Number.isNaN(n)) return t('shell.modelSetup.windowInvalid', { model: m.id });
		const max = maxWindow(m);
		if (max && n > max) return t('shell.modelSetup.windowTooLarge', { model: m.id, max: fmtContext(max) });
		return '';
	}
	const problems = $derived(models.map(windowProblem).filter(Boolean));

	// Curated menu defaults are shared; actual account availability stays authoritative.

	const FAMILIES: [string, RegExp][] = [
		['OpenAI', /^(gpt|o\d|chatgpt|codex)/i],
		['Anthropic', /^claude/i],
		['Google', /^(gemini|gemma)/i],
		['DeepSeek', /^deepseek/i],
		['Qwen', /^(qwen|qwq)/i],
		['GLM', /^(glm|chatglm)/i],
		['Kimi', /^(kimi|moonshot)/i],
		['xAI', /^grok/i],
		['Doubao', /^(doubao|seed)/i],
		['MiniMax', /^(minimax|abab)/i]
	];
	const familyOf = (id: string) => FAMILIES.find(([, re]) => re.test(id))?.[0] ?? t('shell.modelSetup.other');
	const rank = (f: string) => {
		const i = FAMILIES.findIndex(([name]) => name === f);
		return i < 0 ? FAMILIES.length : i;
	};

	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const map = new Map<string, JucodeModel[]>();
		for (const m of models) {
			if (q && !m.id.toLowerCase().includes(q)) continue;
			const f = familyOf(m.id);
			map.set(f, [...(map.get(f) ?? []), m]);
		}
		return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const [list, config] = await Promise.all([fetchJucodeModels(), readConfig()]);
			cfg = config;
			models = list;
			const names = (v: unknown) =>
				Array.isArray(v) ? v.map((m) => (m as { name?: string }).name).filter((n): n is string => !!n) : [];
			const overrides = (config.context_window_overrides ?? {}) as Record<string, unknown>;
			windows = Object.fromEntries(
				Object.entries(overrides)
					.filter(([, v]) => typeof v === 'number' && v > 0)
					.map(([k, v]) => [k, String(v)])
			);
			const prev = names(config.jucode_models);
			const current = prev.length ? prev : DEFAULT_MODELS;
			picked = current.filter((n) => list.some((m) => m.id === n));
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function toggle(id: string, on: boolean) {
		picked = on ? [...picked, id] : picked.filter((p) => p !== id);
	}
	function toggleGroup(list: JucodeModel[]) {
		const ids = list.map((m) => m.id);
		const all = ids.every((id) => picked.includes(id));
		picked = all ? picked.filter((p) => !ids.includes(p)) : [...new Set([...picked, ...ids])];
	}

	async function save() {
		saving = true;
		// Saved grouped by vendor, as shown, so the model menu reads the same way.
		const order = groups.length && !query ? groups.flatMap(([, list]) => list) : models;
		const chosen = order
			.filter((m) => picked.includes(m.id))
			.map(savedModel);
		// Windows for models outside this account's list (another login) stay.
		const overrides: Record<string, number> = {};
		for (const [k, v] of Object.entries((cfg.context_window_overrides ?? {}) as Record<string, unknown>)) {
			if (typeof v === 'number' && v > 0 && !models.some((m) => m.id === k)) overrides[k] = v;
		}
		for (const m of models) {
			const n = parseWindow(windows[m.id]);
			if (n > 0) overrides[m.id] = n;
		}
		const patch: Record<string, unknown> = { jucode_models: chosen, context_window_overrides: overrides };
		if (cfg.provider === 'jucode') {
			patch.models = chosen;
			if (!chosen.some((m) => m.name === cfg.model)) patch.model = chosen[0].name;
		}
		try {
			await writeConfig(patch);
			toast.success(t('shell.modelSetup.saved'));
			onClose();
		} catch (e) {
			toast.error(String(e));
		} finally {
			saving = false;
		}
	}
</script>

<Modal title={t('shell.modelSetup.title')} width={600} dismissible={!saving} {onClose}>
	{#if loading}
		<div class="state"><CircleNotchIcon size={22} class="spin" /></div>
	{:else if error}
		<Notice>{t('shell.modelSetup.loadFailed', { error })}</Notice>
		<div><Button size="sm" onclick={load}>{t('shell.modelSetup.retry')}</Button></div>
	{:else}
		<p class="intro">{t('shell.modelSetup.intro', { n: models.length })} {t('shell.modelSetup.windowHint')}</p>
		{#if problems.length}<Notice>{problems[0]}</Notice>{/if}
		<label class="search">
			<MagnifyingGlassIcon size={16} />
			<input bind:value={query} placeholder={t('shell.modelSetup.search')} />
		</label>
		<div class="list">
			{#each groups as [family, list] (family)}
				{@const all = list.every((m) => picked.includes(m.id))}
				<section>
					<div class="ghead">
						<span class="gname"><Vendor model={list[0].id} size={15} />{family}</span>
						<span class="gcount">{list.filter((m) => picked.includes(m.id)).length}/{list.length}</span>
						<button class="gtoggle" onclick={() => toggleGroup(list)}>{all ? t('shell.modelSetup.selectNone') : t('shell.modelSetup.selectAll')}</button>
					</div>
					{#each list as m (m.id)}
						{@const max = maxWindow(m)}
						<div class="row">
							<Checkbox checked={picked.includes(m.id)} onchange={(on) => toggle(m.id, on)}>
								<span class="name" title={m.id}>{m.display_name || m.id}</span>
							</Checkbox>
							{#if max > (m.context_window ?? 0) && m.context_window}
								<span class="ctx">{t('shell.modelSetup.windowMax', { max: fmtContext(max) })}</span>
							{/if}
							<input
								class="win"
								class:bad={!!windowProblem(m)}
								bind:value={windows[m.id]}
								placeholder={fmtContext(m.context_window) || t('shell.modelSetup.windowUnset')}
								aria-label={m.id}
								spellcheck="false"
							/>
						</div>
					{/each}
				</section>
			{/each}
		</div>
	{/if}
	{#snippet footer()}
		{#if !loading && !error}<span class="count">{t('shell.modelSetup.selected', { n: picked.length })}</span>{/if}
		<Button variant="ghost" disabled={saving} onclick={onClose}>{t('shell.modelSetup.later')}</Button>
		<Button variant="primary" disabled={saving || loading || !!error || picked.length === 0 || problems.length > 0} onclick={save}>{t('shell.modelSetup.done')}</Button>
	{/snippet}
</Modal>

<style>
	.state {
		display: flex;
		justify-content: center;
		padding: 40px 0;
		color: var(--dim);
	}
	.intro {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.55;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 12px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: 48vh;
		margin: 0 -8px;
		padding: 0 8px;
		overflow-y: auto;
	}
	.ghead {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 4px 4px 6px;
	}
	.gname {
		display: inline-flex;
		align-self: center;
		align-items: center;
		gap: 8px;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.gcount {
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.gtoggle {
		margin-left: auto;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.gtoggle:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 36px;
		padding: 0 4px;
		border-radius: var(--r-sm);
	}
	.row:hover {
		background: var(--surface2);
	}
	.row :global(.cb) {
		flex: 1;
		min-height: 36px;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.ctx {
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.win {
		width: 76px;
		height: 26px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-xs);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		text-align: right;
		outline: none;
	}
	.win::placeholder {
		color: var(--dim2);
	}
	.win:focus {
		border-color: var(--accent);
	}
	.win.bad {
		border-color: var(--err);
	}
	.count {
		margin-right: auto;
		align-self: center;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
</style>
