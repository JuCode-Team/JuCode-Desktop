<script lang="ts">
	// Create or edit a scheduled task: what to send, where and on which
	// engine it runs, in which permission mode, and when. 立即运行 saves
	// first, then runs the saved task, so a new task can be tried right away.
	import { onMount, tick, untrack } from 'svelte';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { daemonState } from '$lib/daemonState.svelte';
	import { toDraft, validate, WEEK, type Repeat, type Schedule, type ScheduleDraft, type ScheduleEngine, type ScheduleMode } from '$lib/schedules';
	import { BACKEND_LABELS } from '$lib/backends/types';
	import { buildBackendOpts } from '$lib/backends/settings';
	import { acpPresets, type AcpPreset } from '$lib/protocol';
	import { t } from '$lib/i18n';

	let {
		schedule,
		preset,
		projects,
		onClose
	}: {
		/** The task to edit; omitted for a new one. */
		schedule?: Schedule;
		/** A new task's fields filled in beforehand (an agent's proposal). */
		preset?: Partial<ScheduleDraft>;
		/** The folders offered to run in. */
		projects: { id: string; path: string; name: string }[];
		onClose: () => void;
	} = $props();

	const pad = (n: number) => String(n).padStart(2, '0');
	const tomorrow = new Date(Date.now() + 86_400_000);
	// The dialog edits a copy taken when it opens.
	const initial: ScheduleDraft = untrack(() =>
		schedule
			? toDraft(schedule)
			: {
					name: '',
					prompt: '',
					cwd: projects[0]?.path ?? '',
					engine: 'jucode',
					mode: 'auto',
					options: {},
					enabled: true,
					repeat: 'daily',
					time: '09:00',
					days: [1],
					date: '',
					...preset
				}
	);
	let draft = $state<ScheduleDraft>({
		...initial,
		date: initial.date || `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
	});
	// The frequency is kept while repeat is off, so turning it back on restores it.
	let repeating = $state(initial.repeat !== 'once');
	let frequency = $state<Repeat>(initial.repeat === 'once' ? 'daily' : initial.repeat);
	/** Claude Code / Codex / an ACP preset with a gateway mode: through the
	 *  JuCode gateway, as a session can. */
	let gateway = $state(initial.options.jucode_gateway === true);
	/** The engine picked: `jucode`, `claude`, `codex` or `acp:<preset>`. */
	let pick = $state(initial.engine === 'acp' ? `acp:${String(initial.options.agent ?? '')}` : initial.engine);
	/** The daemon's built-in ACP agents (its own request; none if it fails). */
	let presets = $state<AcpPreset[]>([]);
	const agentPreset = $derived(pick.startsWith('acp:') ? presets.find((p) => `acp:${p.id}` === pick) : undefined);
	let busy = $state(false);
	let error = $state('');
	let nameEl = $state<HTMLInputElement | null>(null);

	onMount(() => {
		tick().then(() => nameEl?.focus());
		acpPresets().then((list) => (presets = list), () => {});
	});

	const FREQUENCIES = $derived(
		(['hourly', 'daily', 'weekdays', 'weekly'] as const).map((value) => ({ value, label: t(`shell.schedule.${value}`) }))
	);
	/** The open workspace's projects, and the task's own folder if it is not one. */
	const FOLDERS = $derived([
		...projects.map((p) => ({ value: p.path, label: p.name })),
		...(initial.cwd && !projects.some((p) => p.path === initial.cwd) ? [{ value: initial.cwd, label: initial.cwd }] : [])
	]);
	/** The native engines, then the ready presets (and the task's own, so
	 *  it still shows when it is no longer ready). */
	const ENGINES = $derived([
		...(['jucode', 'claude', 'codex'] as const).map((value) => ({ value, label: BACKEND_LABELS[value] })),
		...presets
			.filter((p) => p.status === 'ready' || `acp:${p.id}` === pick)
			.map((p) => ({ value: `acp:${p.id}`, label: p.name }))
	]);
	/** ACP agents have no 自动 mode. */
	const MODES = $derived(
		([
			['ask', 'chat.approvalAsk'],
			['edits', 'chat.approvalEdits'],
			['auto', 'chat.approvalAuto'],
			['all', 'chat.approvalAll']
		] as const)
			.filter(([value]) => draft.engine !== 'acp' || value !== 'auto')
			.map(([value, key]) => ({ value, label: t(key) }))
	);

	function pickEngine(value: string) {
		pick = value;
		draft.engine = value.startsWith('acp:') ? 'acp' : (value as ScheduleEngine);
		if (draft.engine === 'acp' && draft.mode === 'auto') draft.mode = 'edits';
	}
	const dayNames = $derived(t('shell.schedule.dayNames').split(','));
	const minute = $derived(Number(draft.time.split(':')[1] ?? 0));

	function setMinute(value: number) {
		const m = Math.min(59, Math.max(0, Math.round(value) || 0));
		draft.time = `${draft.time.slice(0, 2)}:${pad(m)}`;
	}

	function toggleDay(day: number) {
		draft.days = draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day];
	}

	/** How its runs start the engine: this desktop's program settings for
	 *  it, and the gateway choice. */
	function options(engine: ScheduleEngine): Record<string, unknown> {
		if (engine === 'jucode') return {};
		// A built-in agent: the daemon resolves what it runs from the id.
		if (engine === 'acp') return { agent: pick.slice(4), jucode_gateway: !!agentPreset?.gateway && gateway };
		const base = buildBackendOpts(engine);
		return {
			jucode_gateway: gateway,
			...(base?.bin_override ? { bin: base.bin_override } : {}),
			...(base?.env ? { env: base.env } : {})
		};
	}

	async function save(run: boolean) {
		const next = {
			...draft,
			repeat: repeating ? frequency : ('once' as const),
			// Pi never asks: its runs are saved as 询问, which it ignores.
			mode: agentPreset?.approvals === false ? ('ask' as const) : draft.mode,
			options: options(draft.engine)
		};
		error = validate(next) ?? '';
		if (error) return;
		busy = true;
		try {
			const saved = await daemonState.saveSchedule(next);
			// Saved: trying again changes this task rather than adding one.
			draft.id = saved.id;
			if (run) {
				await daemonState.runSchedule(saved.id);
				toast.success(t('shell.schedule.started', { name: saved.name }));
			}
			onClose();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}
</script>

<Modal
	title={schedule ? t('shell.schedule.editTitle') : t('shell.schedule.newTitle')}
	width={500}
	dismissible={!busy}
	{onClose}
>
	{#snippet icon()}<ClockIcon size={16} />{/snippet}
	<label class="field">
		<span>{t('shell.schedule.name')}</span>
		<input bind:this={nameEl} bind:value={draft.name} placeholder={t('shell.schedule.namePlaceholder')} />
	</label>
	<label class="field">
		<span>{t('shell.schedule.prompt')}</span>
		<textarea bind:value={draft.prompt} rows="4" placeholder={t('shell.schedule.promptPlaceholder')}></textarea>
	</label>
	<div class="field">
		<span>{t('shell.schedule.cwd')}</span>
		<Select value={draft.cwd} options={FOLDERS} placeholder={t('shell.schedule.noCwd')} onChange={(v) => (draft.cwd = v)} />
	</div>
	<div class="pair">
		<div class="field">
			<span>{t('shell.schedule.engine')}</span>
			<Select value={pick} options={ENGINES} onChange={pickEngine} />
		</div>
		<div class="field">
			<span>{t('shell.schedule.mode')}</span>
			{#if agentPreset?.approvals === false}
				<span class="noapproval" title={t('chat.noApprovalHint')}>{t('chat.noApproval')}</span>
			{:else}
				<Select value={draft.mode} options={MODES} onChange={(v) => (draft.mode = v as ScheduleMode)} />
			{/if}
		</div>
	</div>
	{#if draft.engine === 'claude' || draft.engine === 'codex' || agentPreset?.gateway}
		<div class="row">
			<span>{t('shell.schedule.gateway')}</span>
			<Switch bind:checked={gateway} label={t('shell.schedule.gateway')} />
		</div>
	{/if}
	{#if draft.engine !== 'jucode' && draft.mode === 'ask' && agentPreset?.approvals !== false}
		<Notice tone="warn">{t('shell.schedule.askWaits')}</Notice>
	{/if}

	<div class="row">
		<span>{t('shell.schedule.repeat')}</span>
		<Switch bind:checked={repeating} label={t('shell.schedule.repeat')} />
	</div>
	{#if repeating}
		<div class="pair">
			<div class="field">
				<span>{t('shell.schedule.frequency')}</span>
				<Select value={frequency} options={FREQUENCIES} onChange={(v) => (frequency = v as Repeat)} />
			</div>
			{#if frequency === 'hourly'}
				<label class="field">
					<span>{t('shell.schedule.minute')}</span>
					<input type="number" min="0" max="59" value={minute} onchange={(e) => setMinute(e.currentTarget.valueAsNumber)} />
				</label>
			{:else}
				<label class="field">
					<span>{t('shell.schedule.time')}</span>
					<input type="time" bind:value={draft.time} />
				</label>
			{/if}
		</div>
		{#if frequency === 'weekly'}
			<div class="field">
				<span>{t('shell.schedule.days')}</span>
				<div class="days">
					{#each WEEK as day (day)}
						<Chip selected={draft.days.includes(day)} onclick={() => toggleDay(day)}>{dayNames[day]}</Chip>
					{/each}
				</div>
			</div>
		{/if}
	{:else}
		<div class="pair">
			<label class="field">
				<span>{t('shell.schedule.date')}</span>
				<input type="date" bind:value={draft.date} />
			</label>
			<label class="field">
				<span>{t('shell.schedule.time')}</span>
				<input type="time" bind:value={draft.time} />
			</label>
		</div>
	{/if}


	{#if error}<Notice>{error}</Notice>{/if}
	{#snippet footer()}
		<Button size="sm" disabled={busy} onclick={() => save(true)}>{t('shell.schedule.runNow')}</Button>
		<span class="grow"></span>
		<Button size="sm" onclick={onClose} disabled={busy}>{t('common.cancel')}</Button>
		<Button size="sm" variant="primary" disabled={busy} onclick={() => save(false)}>
			{#if busy}<LoaderCircleIcon size={14} class="spin" />{/if}
			{t('shell.schedule.save')}
		</Button>
	{/snippet}
</Modal>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.field input,
	.field textarea {
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
		padding: 7px 10px;
		outline: none;
		resize: vertical;
		min-width: 0;
	}
	.field input:focus,
	.field textarea:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: var(--fs-sm);
	}
	.days {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.grow {
		flex: 1;
	}
	.noapproval {
		padding: 7px 0;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
</style>
