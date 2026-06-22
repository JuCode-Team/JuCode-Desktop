<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import { ptyOpen, ptyWrite, ptyResize, ptyClose } from '$lib/protocol';
	import { themeState } from '$lib/theme.svelte';

	let host = $state<HTMLDivElement | null>(null);
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	let cleanups: Array<() => void> = [];

	function palette() {
		return themeState.value === 'light'
			? { background: '#ffffff', foreground: '#1b1a1f', cursor: '#6d3bd7', selectionBackground: 'rgba(109,59,215,0.18)' }
			: { background: '#1c1c1e', foreground: '#e5e2e3', cursor: '#b6a0ef', selectionBackground: 'rgba(182,160,239,0.22)' };
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			term = new Terminal({
				fontFamily:
					"'JetBrainsMono Nerd Font', 'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'Symbols Nerd Font', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace, 'Apple Color Emoji'",
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
				if (e.payload === id) term?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
			});
			cleanups.push(unOut, unExit);

			term.onData((d) => ptyWrite(id, d));
			await ptyOpen(id, term.cols, term.rows);

			const ro = new ResizeObserver(() => {
				try {
					fit?.fit();
					if (term) ptyResize(id, term.cols, term.rows);
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
		ptyClose(id);
		term?.dispose();
	});
</script>

<div class="term-host" bind:this={host}></div>

<style>
	.term-host {
		height: 100%;
		width: 100%;
		padding: 8px 6px 6px 10px;
		background: var(--panel);
	}
	:global(.term-host .xterm) {
		height: 100%;
	}
	:global(.term-host .xterm-viewport) {
		background: transparent !important;
	}
</style>
