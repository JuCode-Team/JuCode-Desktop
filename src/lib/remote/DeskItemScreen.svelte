<script lang="ts">
	// One deferred approval as a page of the remote app (DeskCard). One
	// decided or closed meanwhile (here or on another device) says so.
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import Button from '$lib/ui/Button.svelte';
	import DeskCard from '$lib/DeskCard.svelte';
	import { useDaemonState } from '$lib/daemonScope';
	import { t } from '$lib/i18n';
	import RemoteScreen from './RemoteScreen.svelte';

	let {
		id,
		onBack,
		onOpenSession
	}: {
		/** The action's id. */
		id: string;
		onBack: () => void;
		onOpenSession: (session: string) => void;
	} = $props();

	const daemon = useDaemonState();
	const action = $derived(daemon.actions.find((a) => a.id === id));
</script>

<RemoteScreen title={t('shell.desk.action')} {onBack}>
	<div class="item">
		{#if action}
			<DeskCard {action} {onOpenSession} />
		{:else}
			<div class="gone">
				<CircleCheckIcon size={28} />
				<p>{t('shell.desk.handled')}</p>
				<Button size="sm" onclick={onBack}>{t('shell.desk.back')}</Button>
			</div>
		{/if}
	</div>
</RemoteScreen>

<style>
	.item {
		max-width: 760px;
		margin: 8px auto 0;
		animation: rise var(--t-med) var(--ease-out);
	}
	.gone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 48px 0;
		color: var(--dim2);
		text-align: center;
	}
	.gone p {
		margin: 0;
		font-size: var(--fs-sm);
	}
</style>
