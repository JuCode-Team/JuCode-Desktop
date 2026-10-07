<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import { terminalLook, useTerminalInput, useWebgl } from './terminal';
	import { ptyOpen, ptyWrite, ptyResize, ptyClose } from '$lib/protocol';

	let { cwd = '' }: { cwd?: string } = $props();
	let host = $state<HTMLDivElement | null>(null);
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	let cleanups: Array<() => void> = [];

	/** Fit the grid to the panel and tell the shell its new size. */
	function refit() {
		try {
			fit?.fit();
		} catch {
			/* ignore */
		}
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			term = new Terminal({ ...terminalLook(), cursorBlink: true, allowProposedApi: true });
			fit = new FitAddon();
			term.loadAddon(fit);
			if (host) term.open(host);
			cleanups.push(useTerminalInput(term));
			useWebgl(term);
			fit.fit();

			const unOut = await listen<{ id: string; data: string }>('pty-output', (e) => {
				if (e.payload.id === id) term?.write(e.payload.data);
			});
			const unExit = await listen<string>('pty-exit', (e) => {
				if (e.payload === id) term?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
			});
			cleanups.push(unOut, unExit);

			term.onData((d) => ptyWrite(id, d));
			term.onResize(({ cols, rows }) => ptyResize(id, cols, rows).catch(() => {}));
			await ptyOpen(id, term.cols, term.rows, cwd || undefined);

			const ro = new ResizeObserver(refit);
			if (host) ro.observe(host);
			cleanups.push(() => ro.disconnect());

			if (disposed) cleanups.forEach((f) => f());
		})();
		return () => {
			disposed = true;
		};
	});

	// Theme and font changes; a new font size changes the grid.
	$effect(() => {
		const look = terminalLook();
		if (!term) return;
		Object.assign(term.options, look);
		refit();
	});

	onDestroy(() => {
		cleanups.forEach((f) => f());
		ptyClose(id);
		term?.dispose();
	});
</script>

<div class="term-host" bind:this={host}></div>

<style>
	.term-host {
		height: 100%;
		width: 100%;
		background: var(--panel);
	}
	:global(.term-host .xterm) {
		height: 100%;
		padding: 8px 6px 6px 10px;
	}
	:global(.term-host .xterm-viewport) {
		background: transparent !important;
	}
</style>
