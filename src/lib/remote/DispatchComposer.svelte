<script lang="ts">
	// A new dispatch: the requests, whether to see the plan first, and the
	// permission mode every task runs in (dispatch.svelte.ts). The draft and
	// the choices are kept on this device. A page of its own on a phone; the
	// Dispatch tab's pane on a wide page. Also where notifications are turned
	// on, since they report on dispatches.
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import BellIcon from 'phosphor-svelte/lib/BellIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';
	import type { DispatchMode, DispatchView } from './dispatch.svelte';
	import { enablePush, pushOn, pushSupported } from './push';
	import RemoteScreen from './RemoteScreen.svelte';

	let {
		onBack,
		onSent
	}: {
		/** A page over the list (phone); none in the wide pane. */
		onBack?: () => void;
		onSent: (dispatch: DispatchView) => void;
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
			const dispatch = await conn.dispatches.send(request, plan, mode);
			text = '';
			onSent(dispatch);
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
</script>

<RemoteScreen title={t('shell.dispatch.new')} {onBack}>
	<div class="compose">
		<p class="hint">{t('shell.dispatch.newHint')}</p>
		<div class="box">
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				bind:value={text}
				placeholder={t('shell.dispatch.placeholder')}
				onkeydown={onKey}
				disabled={sending}
				autofocus={!!onBack}
			></textarea>
			<div class="options">
				<label class="option" title={t('shell.dispatch.planHint')}>
					<span class="option-text">
						<span class="option-label">{t('shell.dispatch.plan')}</span>
						<span class="option-hint">{t('shell.dispatch.planHint')}</span>
					</span>
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
				<span class="keys">⌘ / Ctrl + Enter</span>
				<Button variant="primary" disabled={!text.trim() || sending} onclick={send}>
					{#if sending}<CircleNotchIcon size={15} class="spin" />{:else}<PaperPlaneTiltIcon size={15} />{/if}
					{sending ? t('shell.dispatch.sending') : t('shell.dispatch.send')}
				</Button>
			</div>
		</div>

		{#if !supported}
			<p class="note">{t('shell.dispatch.notifyUnsupported')}</p>
		{:else if notifying}
			<p class="note"><BellIcon size={14} /> {t('shell.dispatch.notifyOn')}</p>
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
		{#if notifyError}<p class="note err">{notifyError}</p>{/if}
	</div>
</RemoteScreen>

<style>
	.compose {
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 760px;
		margin: 8px auto 0;
		animation: rise var(--t-med) var(--ease-out);
	}
	.hint {
		margin: 0 2px;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.55;
	}
	.box {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--surface);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.box:focus-within {
		border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
	}
	textarea {
		width: 100%;
		height: clamp(140px, 28vh, 320px);
		resize: none;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.6;
		outline: none;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
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
		min-height: 48px;
		padding: 6px 0;
		border-bottom: 1px solid var(--hairline);
	}
	.option:last-child {
		border-bottom: none;
	}
	label.option {
		cursor: pointer;
	}
	.option-text {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.option-label {
		font-size: var(--fs-sm);
		color: var(--text);
		white-space: nowrap;
	}
	.option-hint {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.mode {
		width: 140px;
		flex-shrink: 0;
	}
	.send {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
	}
	.keys {
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	@media (hover: none) {
		.keys {
			display: none;
		}
	}
	.notify {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 14px;
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
	.notify > :global(svg) {
		flex-shrink: 0;
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
	.note {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 4px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.5;
	}
	.note.err {
		color: var(--err);
	}
</style>
