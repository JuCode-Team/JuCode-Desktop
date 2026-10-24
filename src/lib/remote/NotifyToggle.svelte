<script lang="ts">
	// Turns on this phone's notifications (Web Push, registered with the
	// account) from every computer of the account: approvals that wait,
	// scheduled runs that fail or wait.
	import BellIcon from '@lucide/svelte/icons/bell';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { t } from '$lib/i18n';
	import { enablePush, pushOn, pushSupported } from './push';

	const supported = pushSupported();
	let notifying = $state(supported && pushOn());
	let error = $state('');
	async function turnOn() {
		error = '';
		try {
			await enablePush();
			notifying = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

{#if !supported}
	<p class="note">{t('shell.remote.notifyUnsupported')}</p>
{:else if notifying}
	<p class="note"><BellIcon size={14} /> {t('shell.remote.notifyOn')}</p>
{:else}
	<button class="notify" onclick={turnOn}>
		<BellIcon size={16} />
		<span class="notify-text">
			<span class="notify-title">{t('shell.remote.notify')}</span>
			<span class="notify-hint">{t('shell.remote.notifyHint')}</span>
		</span>
		<ChevronRightIcon size={12} />
	</button>
{/if}
{#if error}<p class="note err">{error}</p>{/if}

<style>
	.notify {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
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
