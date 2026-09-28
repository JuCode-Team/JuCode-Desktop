<script lang="ts">
	// The desk sheet on the desktop; its content is DeskContent.
	import { X } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import DeskContent from '$lib/DeskContent.svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { t } from '$lib/i18n';

	let {
		onClose,
		onOpenSession
	}: {
		onClose: () => void;
		/** Show a daemon session in a tab. */
		onOpenSession: (session: string) => void;
	} = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="sheet" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.desk.title')} use:focusTrap>
		<div class="head">
			<div>
				<h2>{t('shell.desk.title')}</h2>
				<p>{t('shell.desk.subtitle')}</p>
			</div>
			<IconButton onclick={onClose} label="close"><X size={18} /></IconButton>
		</div>
		<div class="body">
			<DeskContent {onOpenSession} />
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
	}
	.sheet {
		width: min(760px, 94vw);
		height: min(720px, 90vh);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 18px 20px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 800;
	}
	.head p {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--dim);
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 20px 20px;
	}
</style>
