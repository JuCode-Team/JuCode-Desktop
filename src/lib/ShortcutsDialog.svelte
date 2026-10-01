<script lang="ts">
	// Every keyboard shortcut (⌘/), grouped as in shortcuts.ts.
	import Modal from '$lib/ui/Modal.svelte';
	import { SHORTCUTS, shortcutLabel, type ShortcutId } from '$lib/shortcuts';
	import { t } from '$lib/i18n';

	let { onClose }: { onClose: () => void } = $props();

	const groups = (['general', 'session', 'composer'] as const).map((group) => ({
		group,
		ids: (Object.keys(SHORTCUTS) as ShortcutId[]).filter((id) => SHORTCUTS[id].group === group)
	}));
</script>

<Modal label={t('shell.shortcuts.title')} width={460} {onClose}>
	<h2>{t('shell.shortcuts.title')}</h2>
	{#each groups as g (g.group)}
		<section>
			<h3>{t(`shell.shortcuts.${g.group}`)}</h3>
			{#each g.ids as id (id)}
				<div class="row">
					<span>{t(`shell.shortcuts.${id}`)}</span>
					<kbd>{shortcutLabel(id)}</kbd>
				</div>
			{/each}
		</section>
	{/each}
</Modal>

<style>
	h2 {
		margin: 0 0 12px;
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	section + section {
		margin-top: 14px;
	}
	h3 {
		margin: 0 0 4px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 5px 0;
		font-size: var(--fs-sm);
	}
	kbd {
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--dim);
		font-family: inherit;
		font-size: var(--fs-xs);
	}
</style>
