<script lang="ts">
	// Every keyboard shortcut (⌘/), grouped as in shortcuts.ts. Clicking one's
	// keys records new ones; a rebound shortcut can go back to its default.
	import Modal from '$lib/ui/Modal.svelte';
	import { SHORTCUTS, FIXED, binding, bindingOf, conflictOf, isRebound, keysLabel, resetBindings, setBinding, type ShortcutId } from '$lib/shortcuts';
	import { t } from '$lib/i18n';

	let { onClose }: { onClose: () => void } = $props();

	const groups = (['general', 'session', 'composer'] as const).map((group) => ({
		group,
		ids: (Object.keys(SHORTCUTS) as ShortcutId[]).filter((id) => SHORTCUTS[id].group === group)
	}));

	/** The shortcut whose keys are being recorded. */
	let recording = $state<ShortcutId | null>(null);
	/** Why the last keys were not taken. */
	let note = $state('');
	// Bumped on every change: the labels read the module's bindings.
	let version = $state(0);
	const keys = (id: ShortcutId) => {
		void version;
		return keysLabel(binding(id));
	};
	const rebound = (id: ShortcutId) => {
		void version;
		return isRebound(id);
	};
	const anyRebound = $derived.by(() => {
		void version;
		return (Object.keys(SHORTCUTS) as ShortcutId[]).some(isRebound);
	});

	function record(id: ShortcutId) {
		note = '';
		recording = recording === id ? null : id;
	}
	function reset(id: ShortcutId) {
		setBinding(id, null);
		note = '';
		version++;
	}
	function resetAll() {
		resetBindings();
		recording = null;
		note = '';
		version++;
	}

	// While recording, the key press is the new shortcut, and no other
	// handler (the app's shortcuts, the dialog's Escape) sees it.
	function onKey(e: KeyboardEvent) {
		const id = recording;
		if (!id) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
			recording = null;
			note = '';
			return;
		}
		const next = bindingOf(e);
		if (!next) {
			if (!['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) note = t('shell.shortcuts.needsModifier');
			return;
		}
		const other = conflictOf(id, next);
		if (other) {
			note = t('shell.shortcuts.taken', { keys: keysLabel(next), name: t(`shell.shortcuts.${other}`) });
			return;
		}
		setBinding(id, next);
		recording = null;
		note = '';
		version++;
	}
</script>

<svelte:window onkeydowncapture={onKey} />

<Modal label={t('shell.shortcuts.title')} width={480} {onClose}>
	<h2>{t('shell.shortcuts.title')}</h2>
	<p class="hint">{note || (recording ? t('shell.shortcuts.recording') : t('shell.shortcuts.editHint'))}</p>
	{#each groups as g (g.group)}
		<section>
			<h3>{t(`shell.shortcuts.${g.group}`)}</h3>
			{#each g.ids as id (id)}
				<div class="row">
					<span>{t(`shell.shortcuts.${id}`)}</span>
					<span class="keys">
						{#if rebound(id) && recording !== id}
							<button class="reset" onclick={() => reset(id)}>{t('shell.shortcuts.reset')}</button>
						{/if}
						{#if FIXED.has(id)}
							<kbd>{keys(id)}</kbd>
						{:else}
							<button class="kbd" class:on={recording === id} onclick={() => record(id)} aria-label={t('shell.shortcuts.change', { name: t(`shell.shortcuts.${id}`) })}>
								{recording === id ? t('shell.shortcuts.pressKeys') : keys(id)}
							</button>
						{/if}
					</span>
				</div>
			{/each}
		</section>
	{/each}
	{#if anyRebound}
		<button class="reset all" onclick={resetAll}>{t('shell.shortcuts.resetAll')}</button>
	{/if}
</Modal>

<style>
	h2 {
		margin: 0 0 4px;
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.hint {
		margin: 0 0 12px;
		color: var(--dim);
		font-size: var(--fs-xs);
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
		padding: 3px 0;
		font-size: var(--fs-sm);
	}
	.keys {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	kbd,
	.kbd {
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
		color: var(--dim);
		font-family: inherit;
		font-size: var(--fs-xs);
	}
	.kbd {
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.kbd:hover {
		color: var(--text);
	}
	.kbd.on {
		border-color: var(--brand);
		color: var(--text);
	}
	.kbd:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.reset {
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.reset:hover {
		color: var(--text);
	}
	.reset.all {
		margin-top: 14px;
	}
</style>
