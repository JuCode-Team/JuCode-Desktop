<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
	import { t } from '$lib/i18n';
	import { editors } from '$lib/editors.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import PopMenu from '$lib/ui/PopMenu.svelte';

	// The title bar's 在 VS Code 中打开: the project folder opens in the
	// editor last chosen; the arrow lists the other installed ones. Nothing
	// shows when no editor is installed.
	let { path }: { path: string } = $props();

	let menuOpen = $state(false);
	onMount(() => void editors.load());

	const editor = $derived(editors.preferred);

	async function open(id: string) {
		menuOpen = false;
		const name = editors.list.find((e) => e.id === id)?.name ?? id;
		await editors.open(id, path).catch((e) => toast.error(t('editor.external.failed', { name, error: String(e) })));
	}
	function toggleMenu() {
		menuOpen = !menuOpen;
		if (menuOpen) void editors.load();
	}
</script>

{#if editor}
	<div class="oie">
		<button class="main" title={t('editor.external.openIn', { name: editor.name })} aria-label={t('editor.external.openIn', { name: editor.name })} onclick={() => open(editor.id)}>
			{#if editor.icon}<img src={editor.icon} alt="" width="18" height="18" />{:else}<CodeXmlIcon size={16} />{/if}
		</button>
		<button class="more" title={t('editor.external.choose')} aria-label={t('editor.external.choose')} aria-expanded={menuOpen} onclick={toggleMenu}>
			<ChevronDownIcon size={12} />
		</button>
		{#if menuOpen}
			<PopMenu
				title={t('editor.external.choose')}
				items={editors.list.map((e) => ({ key: e.id, label: e.name, img: e.icon ?? undefined, icon: e.icon ? undefined : CodeXmlIcon, checked: e.id === editor.id }))}
				onSelect={open}
				onClose={() => (menuOpen = false)}
			/>
		{/if}
	</div>
{/if}

<style>
	.oie {
		position: relative;
		display: inline-flex;
		align-items: center;
		border-radius: var(--r);
	}
	.oie:hover {
		background: var(--surface2);
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 34px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.main {
		width: 34px;
	}
	.more {
		width: 18px;
		margin-left: -4px;
	}
	button:hover {
		color: var(--text);
	}
</style>
