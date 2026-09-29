<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { confirmQueue } from './confirm.svelte';
	import { t } from '$lib/i18n';
</script>

{#if confirmQueue.current}
	{@const req = confirmQueue.current}
	<Modal title={req.title} width={420} onClose={() => confirmQueue.answer(false)}>
		{#if req.message}<p class="msg">{req.message}</p>{/if}
		{#snippet footer()}
			<Button variant="ghost" onclick={() => confirmQueue.answer(false)}>{req.cancelLabel ?? t('common.cancel')}</Button>
			<Button variant={req.danger ? 'danger' : 'primary'} autofocus onclick={() => confirmQueue.answer(true)}>{req.confirmLabel ?? t('common.confirm')}</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.msg {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.55;
		white-space: pre-wrap;
	}
</style>
