<script lang="ts">
	// The Dispatch tab on the remote page: hand this computer a batch of
	// requests without picking a project or session (dispatch.svelte.ts), see
	// how each dispatch is going, confirm a plan, and open the sessions its
	// tasks run in.
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import BellIcon from 'phosphor-svelte/lib/BellIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';
	import { baseName } from './store.svelte';
	import type { DispatchMode, DispatchTask, DispatchView } from './dispatch.svelte';
	import { enablePush, pushOn, pushSupported } from './push';

	let {
		onOpenSession,
		onOpenDispatch
	}: {
		/** A task's session. */
		onOpenSession: (session: string, title: string) => void;
		/** The dispatcher's own conversation. */
		onOpenDispatch: (dispatch: DispatchView) => void;
	} = $props();

	const conn = useHost();
	const DRAFT = `jucode-dispatch-draft:${conn.id}`;
	const SETTINGS = 'jucode-dispatch-settings';

	function load<T>(key: string, fallback: T): T {
		try {
			const raw = localStorage.getItem(key);
			return raw ? (JSON.parse(raw) as T) : fallback;
		} catch {
			return fallback;
		}
	}
	function keep(key: string, value: unknown) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			/* private mode: kept for this visit only */
		}
	}

	let text = $state(load(DRAFT, ''));
	const saved = load<{ plan: boolean; mode: DispatchMode }>(SETTINGS, { plan: false, mode: 'auto' });
	let plan = $state(saved.plan);
	let mode = $state<DispatchMode>(saved.mode);
	let sending = $state(false);
	let error = $state('');
	$effect(() => keep(DRAFT, text));
	$effect(() => keep(SETTINGS, { plan, mode }));

	const modes = $derived(
		(['manual', 'auto-edit', 'auto', 'full-access'] as const).map((value) => ({
			value,
			label: t(`shell.dispatch.modes.${value}`)
		}))
	);

	async function send() {
		const request = text.trim();
		if (!request || sending) return;
		sending = true;
		error = '';
		try {
			await conn.dispatches.send(request, plan, mode);
			text = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			sending = false;
		}
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void send();
		}
	}

	let deciding = $state<Record<string, boolean>>({});
	async function decide(d: DispatchView, approve: boolean) {
		deciding[d.id] = true;
		error = '';
		try {
			await conn.dispatches.confirm(d.id, approve);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			deciding[d.id] = false;
		}
	}

	const supported = pushSupported();
	let notifying = $state(supported && pushOn());
	let notifyError = $state('');
	async function turnOnNotifications() {
		notifyError = '';
		try {
			await enablePush([conn.daemon]);
			notifying = true;
		} catch (e) {
			notifyError = e instanceof Error ? e.message : String(e);
		}
	}

	function when(ms: number): string {
		return new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
	const where = (task: DispatchTask) => baseName(task.project) || task.project;
</script>

<div class="dispatch">
	<div class="composer">
		<textarea
			bind:value={text}
			rows="4"
			placeholder={t('shell.dispatch.placeholder')}
			onkeydown={onKey}
			disabled={sending}
		></textarea>
		<div class="options">
			<label class="option" title={t('shell.dispatch.planHint')}>
				<span class="option-label">{t('shell.dispatch.plan')}</span>
				<Switch bind:checked={plan} label={t('shell.dispatch.plan')} />
			</label>
			<div class="option">
				<span class="option-label">{t('shell.dispatch.mode')}</span>
				<div class="mode"><Select bind:value={mode} options={modes} /></div>
			</div>
		</div>
		{#if mode === 'full-access'}<Notice tone="warn">{t('shell.dispatch.fullAccess')}</Notice>{/if}
		{#if error}<Notice tone="error">{error}</Notice>{/if}
		<div class="send">
			<Button variant="primary" size="sm" disabled={!text.trim() || sending} onclick={send}>
				{#if sending}<CircleNotchIcon size={15} class="spin" />{:else}<PaperPlaneTiltIcon size={15} />{/if}
				{sending ? t('shell.dispatch.sending') : t('shell.dispatch.send')}
			</Button>
		</div>
	</div>

	{#if !supported}
		<p class="notify-note">{t('shell.dispatch.notifyUnsupported')}</p>
	{:else if notifying}
		<p class="notify-note"><BellIcon size={14} /> {t('shell.dispatch.notifyOn')}</p>
	{:else}
		<button class="notify" onclick={turnOnNotifications}>
			<BellIcon size={16} />
			<span class="notify-text">
				<span class="notify-title">{t('shell.dispatch.notify')}</span>
				<span class="notify-hint">{t('shell.dispatch.notifyHint')}</span>
			</span>
			<CaretRightIcon size={12} />
		</button>
	{/if}
	{#if notifyError}<p class="err">{notifyError}</p>{/if}

	{#if conn.dispatches.list.length === 0}
		<p class="empty">{t('shell.dispatch.empty')}</p>
	{/if}
	{#each conn.dispatches.list as d (d.id)}
		<article class="card" class:awaiting={d.status === 'awaiting'}>
			<header>
				<span class="status {d.status}">
					{#if d.status === 'planning' || d.status === 'running'}<CircleNotchIcon size={12} class="spin" />{/if}
					{t(`shell.dispatch.status.${d.status}`)}
				</span>
				<span class="time">{when(d.created_at)}</span>
			</header>
			<p class="request">{d.text}</p>
			{#if d.tasks.length}
				<ul class="tasks">
					{#each d.tasks as task (task.id)}
						<li>
							<button
								class="task"
								disabled={!task.session}
								onclick={() => task.session && onOpenSession(task.session, task.title)}
							>
								<span class="dot {task.status}"></span>
								<span class="name">{task.title}</span>
								<span class="where">{where(task)}{task.session ? '' : ` · ${t('shell.dispatch.newSession')}`}</span>
								<span class="task-status">{t(`shell.dispatch.task.${task.status}`)}</span>
								{#if task.session}<CaretRightIcon size={12} />{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if d.status === 'awaiting'}
				<div class="decide">
					<Button size="sm" variant="ghost" disabled={deciding[d.id]} onclick={() => decide(d, false)}>{t('shell.dispatch.cancel')}</Button>
					<Button size="sm" variant="primary" disabled={deciding[d.id]} onclick={() => decide(d, true)}>{t('shell.dispatch.confirm')}</Button>
				</div>
			{/if}
			{#if d.summary}
				<div class="summary"><Markdown text={d.summary} /></div>
			{/if}
			<button class="process" onclick={() => onOpenDispatch(d)}>{t('shell.dispatch.process')} <CaretRightIcon size={12} /></button>
		</article>
	{/each}
</div>

<style>
	.dispatch {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 4px 0 24px;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--surface);
	}
	textarea {
		width: 100%;
		height: 104px;
		resize: none;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.55;
		outline: none;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	/* Label on the left, control on the right, one line each. */
	.options {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--hairline);
	}
	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 40px;
		border-bottom: 1px solid var(--hairline);
	}
	.option:last-child {
		border-bottom: none;
	}
	label.option {
		cursor: pointer;
	}
	.option-label {
		font-size: var(--fs-sm);
		color: var(--text);
		white-space: nowrap;
	}
	.mode {
		width: 132px;
	}
	.send {
		display: flex;
		justify-content: flex-end;
	}
	.notify {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.notify:hover {
		background: var(--surface);
	}
	.notify-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.notify-title {
		font-size: var(--fs-sm);
		color: var(--text);
	}
	.notify-hint {
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.notify-note,
	.err {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 4px;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim);
	}
	.err {
		color: var(--err);
	}
	.empty {
		margin: 4px 4px 0;
		font-size: var(--fs-xs);
		line-height: 1.6;
		color: var(--dim2);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
	}
	.card.awaiting {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: var(--r-full);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.status.awaiting {
		background: color-mix(in oklab, var(--accent) 16%, transparent);
		color: var(--text);
	}
	.status.done {
		color: var(--text);
	}
	.time {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.request {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.55;
		color: var(--text);
		white-space: pre-wrap;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tasks {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.task {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 4px;
		border: none;
		border-top: 1px solid var(--hairline);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.task:disabled {
		cursor: default;
	}
	.task:not(:disabled):hover {
		background: var(--surface);
	}
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
	}
	.dot.running,
	.dot.sent {
		background: var(--accent);
	}
	.dot.waiting {
		background: var(--warn);
	}
	.dot.done {
		background: var(--ok);
	}
	.dot.failed {
		background: var(--err);
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.where {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.task-status {
		flex: none;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.decide {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.summary {
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--fs-sm);
	}
	.process {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.process:hover {
		color: var(--text);
	}
	:global(.dispatch .spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
