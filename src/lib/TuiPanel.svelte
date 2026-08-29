<script lang="ts">
	// A native TUI tab: the real interactive CLI (jucode / codex / claude)
	// running in a pty, rendered by xterm. Independent of any GUI session —
	// closing the tab kills the process. The backend name is the only thing
	// sent to Rust; argv and binary resolution are validated there.
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import { ptyOpen, ptyWrite, ptyResize, ptyClose } from '$lib/protocol';
	import type { BackendId } from '$lib/backends/types';
	import { loadBackendSettings } from '$lib/backends/settings';
	import { themeState } from '$lib/theme.svelte';
	import { t } from '$lib/i18n';

	let {
		backend,
		cwd = '',
		onOpenSettings
	}: {
		backend: BackendId;
		cwd?: string;
		onOpenSettings?: () => void;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	let status = $state<'starting' | 'running' | 'exited' | 'missing' | 'error'>('starting');
	let errMsg = $state('');
	// One pty id per launch attempt; restart gets a fresh id so stale
	// pty-output/pty-exit events from the old process can't leak in.
	let id = newId();
	let cleanups: Array<() => void> = [];

	function newId() {
		return `tui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	function palette() {
		return themeState.value === 'light'
			? { background: '#ffffff', foreground: '#1b1a1f', cursor: '#6d3bd7', selectionBackground: 'rgba(109,59,215,0.18)' }
			: { background: '#1c1c1e', foreground: '#e5e2e3', cursor: '#b6a0ef', selectionBackground: 'rgba(182,160,239,0.22)' };
	}

	async function launch() {
		if (!term) return;
		status = 'starting';
		errMsg = '';
		try {
			fit?.fit();
			await ptyOpen(id, term.cols, term.rows, cwd || undefined, {
				command: backend,
				binOverride: loadBackendSettings().paths[backend]
			});
			status = 'running';
		} catch (e) {
			const msg = String(e);
			status = msg.includes('binary-missing:') ? 'missing' : 'error';
			errMsg = msg;
		}
	}

	function restart() {
		ptyClose(id).catch(() => {});
		id = newId();
		term?.reset();
		launch();
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			term = new Terminal({
				fontFamily:
					"'MesloLGL Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font', 'Hack Nerd Font', 'FiraCode Nerd Font', 'Symbols Nerd Font', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace, 'Apple Color Emoji'",
				fontSize: 12.5,
				cursorBlink: true,
				allowProposedApi: true,
				theme: palette()
			});
			fit = new FitAddon();
			term.loadAddon(fit);
			if (host) term.open(host);
			fit.fit();

			const unOut = await listen<{ id: string; data: string }>('pty-output', (e) => {
				if (e.payload.id === id) term?.write(e.payload.data);
			});
			const unExit = await listen<string>('pty-exit', (e) => {
				if (e.payload === id && status === 'running') status = 'exited';
			});
			cleanups.push(unOut, unExit);

			term.onData((d) => {
				ptyWrite(id, d).catch(() => {});
			});

			await launch();

			const ro = new ResizeObserver(() => {
				try {
					fit?.fit();
					if (term) ptyResize(id, term.cols, term.rows).catch(() => {});
				} catch {
					/* ignore */
				}
			});
			if (host) ro.observe(host);
			cleanups.push(() => ro.disconnect());

			if (disposed) cleanups.forEach((f) => f());
		})();
		return () => {
			disposed = true;
		};
	});

	$effect(() => {
		if (term) term.options.theme = palette();
	});

	onDestroy(() => {
		cleanups.forEach((f) => f());
		ptyClose(id).catch(() => {});
		term?.dispose();
	});
</script>

<div class="tui-wrap">
	<div class="term-host" bind:this={host}></div>
	{#if status === 'missing' || status === 'error'}
		<div class="notice">
			<p class="title">
				{status === 'missing' ? t('dock.tui.missing', { bin: backend }) : t('dock.tui.failed')}
			</p>
			{#if status === 'missing'}
				<p class="hint">{t('dock.tui.missingHint', { bin: backend })}</p>
			{:else}
				<p class="hint mono">{errMsg}</p>
			{/if}
			<div class="row">
				{#if status === 'missing' && onOpenSettings}
					<button class="btn" onclick={onOpenSettings}>{t('dock.tui.openSettings')}</button>
				{/if}
				<button class="btn" onclick={restart}>{t('dock.tui.retry')}</button>
			</div>
		</div>
	{:else if status === 'exited'}
		<div class="exitbar">
			<span>{t('dock.tui.exited')}</span>
			<button class="btn sm" onclick={restart}>{t('dock.tui.restart')}</button>
		</div>
	{/if}
</div>

<style>
	.tui-wrap {
		position: relative;
		height: 100%;
		width: 100%;
	}
	.term-host {
		height: 100%;
		width: 100%;
		padding: 8px 6px 6px 10px;
		background: var(--panel);
	}
	:global(.tui-wrap .xterm) {
		height: 100%;
	}
	:global(.tui-wrap .xterm-viewport) {
		background: transparent !important;
	}
	.notice {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 24px;
		text-align: center;
		background: var(--panel);
	}
	.notice .title {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
	}
	.notice .hint {
		margin: 0;
		max-width: 340px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--dim);
	}
	.notice .hint.mono {
		font-family: var(--font-mono);
		word-break: break-all;
	}
	.notice .row {
		display: flex;
		gap: 8px;
		margin-top: 6px;
	}
	.exitbar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 7px 12px;
		font-size: 12px;
		color: var(--dim);
		background: var(--surface);
		border-top: 1px solid var(--hairline);
	}
	.btn {
		padding: 5px 12px;
		font-size: 12.5px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		transition:
			border-color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
	}
	.btn:hover {
		background: var(--surface2);
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn.sm {
		padding: 3px 10px;
		font-size: 12px;
	}
</style>
