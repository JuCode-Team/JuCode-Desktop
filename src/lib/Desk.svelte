<script lang="ts">
	// The desk sheet on the desktop; its content is DeskContent.
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import DeskContent from '$lib/DeskContent.svelte';
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

<Modal label={t('shell.desk.title')} width={760} padded={false} {onClose}>
	<div class="sheet">
		<div class="head">
			<div>
				<h2>{t('shell.desk.title')}</h2>
				<p>{t('shell.desk.subtitle')}</p>
			</div>
			<IconButton onclick={onClose} label="close"><XIcon size={18} /></IconButton>
		</div>
		<div class="body">
			<DeskContent {onOpenSession} />
		</div>
	</div>
</Modal>

<style>
	/* Fixed height so the sheet doesn't resize as its content loads. */
	.sheet {
		height: min(720px, 84vh);
		display: flex;
		flex-direction: column;
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
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.head p {
		margin: 4px 0 0;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 20px 20px;
	}
</style>
