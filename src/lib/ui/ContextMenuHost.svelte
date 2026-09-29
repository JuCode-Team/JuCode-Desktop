<script lang="ts">
	// Replaces the WebView's native context menu. Components with their own
	// menu (sessions, tabs, workspaces) call preventDefault first and are left
	// alone; elsewhere the native menu is suppressed, and text fields or a text
	// selection get Cut / Copy / Paste / Select all in the app's menu.
	// Dev builds: Shift+right-click still opens the native menu (Inspect).
	import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
	import PopMenu, { type PopMenuItem } from './PopMenu.svelte';
	import { t } from '$lib/i18n';

	const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
	const mod = mac ? '⌘' : 'Ctrl+';

	let menu = $state<{ x: number; y: number; items: PopMenuItem[] } | null>(null);
	let target: HTMLElement | null = null;
	let wrap = $state<HTMLDivElement>();
	let pos = $state({ x: 0, y: 0 });

	type Field = HTMLInputElement | HTMLTextAreaElement;
	const TEXT_INPUT = /^(text|search|url|email|password|tel|number)$/;
	function editableOf(el: Element | null): HTMLElement | null {
		const f = el?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') as HTMLElement | null;
		if (!f) return null;
		if (f instanceof HTMLInputElement && !TEXT_INPUT.test(f.type)) return null;
		if ((f as Field).readOnly || (f as Field).disabled) return null;
		return f;
	}
	function selectedText(field: HTMLElement | null): string {
		if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
			const { selectionStart: a, selectionEnd: b } = field;
			return a != null && b != null ? field.value.slice(a, b) : '';
		}
		return window.getSelection()?.toString() ?? '';
	}

	function onContextMenu(e: MouseEvent) {
		if (e.defaultPrevented) return;
		if (import.meta.env.DEV && e.shiftKey) return;
		e.preventDefault();
		const field = editableOf(e.target as Element);
		const sel = selectedText(field);
		const items: PopMenuItem[] = [];
		if (field) items.push({ key: 'cut', label: t('common.cut'), hint: `${mod}X`, disabled: !sel });
		if (field || sel) items.push({ key: 'copy', label: t('common.copy'), hint: `${mod}C`, disabled: !sel });
		if (field) items.push({ key: 'paste', label: t('common.paste'), hint: `${mod}V` });
		if (field) items.push({ key: 'selectAll', label: t('common.selectAll'), hint: `${mod}A` });
		if (!items.length) {
			menu = null;
			return;
		}
		target = field;
		pos = { x: e.clientX, y: e.clientY };
		menu = { x: e.clientX, y: e.clientY, items };
	}

	// Keep the menu inside the window once its size is known.
	$effect(() => {
		if (!menu || !wrap) return;
		const r = wrap.firstElementChild?.nextElementSibling?.getBoundingClientRect();
		if (!r) return;
		pos = {
			x: Math.min(menu.x, window.innerWidth - r.width - 8),
			y: menu.y + r.height + 8 > window.innerHeight ? Math.max(8, menu.y - r.height) : menu.y
		};
	});

	async function run(key: string) {
		const field = target;
		const sel = selectedText(field);
		menu = null;
		field?.focus();
		if (key === 'copy' || key === 'cut') {
			if (!sel) return;
			await writeText(sel);
			// execCommand keeps the field's undo history intact.
			if (key === 'cut') document.execCommand('delete');
		} else if (key === 'paste') {
			const text = await readText().catch(() => '');
			if (text) document.execCommand('insertText', false, text);
		} else if (key === 'selectAll') {
			if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
			else document.execCommand('selectAll');
		}
	}
</script>

<svelte:window oncontextmenu={onContextMenu} onblur={() => (menu = null)} />

{#if menu}
	<div class="ctx" bind:this={wrap} style:left="{pos.x}px" style:top="{pos.y}px">
		<PopMenu items={menu.items} placement="down-left" onSelect={run} onClose={() => (menu = null)} />
	</div>
{/if}

<style>
	.ctx {
		position: fixed;
		z-index: 300;
		width: 0;
		height: 0;
	}
	.ctx :global(.pm) {
		top: 0;
		min-width: 180px;
	}
</style>
