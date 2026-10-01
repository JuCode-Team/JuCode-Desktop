<script lang="ts">
	// Create or edit one of an agent's scheduled tasks. 立即运行 saves first,
	// then runs the saved task, so a new task can be tried right away.
	import { onMount, tick, untrack } from 'svelte';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import { toDraft, validate, WEEK, type Repeat, type Schedule, type ScheduleDraft } from '$lib/schedules';
	import { t } from '$lib/i18n';

	let {
		agent,
		schedule,
		onClose
	}: {
		agent: string;
		/** The task to edit; omitted for a new one. */
		schedule?: Schedule;
		onClose: () => void;
	} = $props();

	const pad = (n: number) => String(n).padStart(2, '0');
	const tomorrow = new Date(Date.now() + 86_400_000);
	// The dialog edits a copy taken when it opens.
	const initial: ScheduleDraft = untrack(() =>
		schedule
			? toDraft(schedule)
			: { agent, name: '', prompt: '', enabled: true, repeat: 'daily', time: '09:00', days: [1], date: '', new_session: true }
	);
	// Every run is a new session, told what the last run concluded.
	let draft = $state<ScheduleDraft>({
		...initial,
		new_session: true,
		date: initial.date || `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
	});
	// The frequency is kept while repeat is off, so turning it back on restores it.
	let repeating = $state(initial.repeat !== 'once');
	let frequency = $state<Repeat>(initial.repeat === 'once' ? 'daily' : initial.repeat);
	let busy = $state(false);
	let error = $state('');
	let nameEl = $state<HTMLInputElement | null>(null);

	onMount(() => {
		tick().then(() => nameEl?.focus());
	});

	const FREQUENCIES = $derived(
		(['hourly', 'daily', 'weekdays', 'weekly'] as const).map((value) => ({ value, label: t(`shell.schedule.${value}`) }))
	);
	const dayNames = $derived(t('shell.schedule.dayNames').split(','));
	const minute = $derived(Number(draft.time.split(':')[1] ?? 0));

	function setMinute(value: number) {
		const m = Math.min(59, Math.max(0, Math.round(value) || 0));
		draft.time = `${draft.time.slice(0, 2)}:${pad(m)}`;
	}

	function toggleDay(day: number) {
		draft.days = draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day];
	}

	async function save(run: boolean) {
		const next = { ...draft, repeat: repeating ? frequency : ('once' as const) };
		error = validate(next) ?? '';
		if (error) return;
		busy = true;
		try {
			const saved = await agentDirectory.saveSchedule(next);
			if (run) {
				await agentDirectory.runSchedule(saved.id);
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
	{#snippet icon()}<ClockIcon size={15} />{/snippet}
	<label class="field">
		<span>{t('shell.schedule.name')}</span>
		<input bind:this={nameEl} bind:value={draft.name} placeholder={t('shell.schedule.namePlaceholder')} />
	</label>
	<label class="field">
		<span>{t('shell.schedule.prompt')}</span>
		<textarea bind:value={draft.prompt} rows="4" placeholder={t('shell.schedule.promptPlaceholder')}></textarea>
	</label>

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
			{#if busy}<CircleNotchIcon size={13} class="spin" />{/if}
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
		border-radius: var(--r-sm);
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
</style>
