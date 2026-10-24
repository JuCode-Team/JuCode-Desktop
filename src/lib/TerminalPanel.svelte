<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import { terminalLook, useTerminalInput, useWebgl } from './terminal';
	import { ptyOpen, ptyWrite, ptyResize, ptyClose } from '$lib/protocol';
	import { dropTerminal, ownTerminal } from '$lib/terminals.svelte';

	let {
		cwd = '',
		run,
		onRan,
		owner
	}: {
		cwd?: string;
		/** The session and tool tab it belongs to (the sidebar marks a session
		 *  whose terminal runs something). */
		owner?: { session: string; tab: string };
		/** A command the shell runs once it is up (a worktree's setup script). */
		run?: string;
		onRan?: () => void;
	} = $props();
	let host = $state<HTMLDivElement | null>(null);
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	let cleanups: Array<() => void> = [];
	/** Unmounted: the setup below may still be awaiting. */
	let disposed = false;
	const runCleanups = () => cleanups.splice(0).forEach((f) => f());

	/** Fit the grid to the panel and tell the shell its new size. */
	function refit() {
		try {
			fit?.fit();
		} catch {
			/* ignore */
		}
	}

	onMount(() => {
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
			if (disposed) return runCleanups();

			term.onData((d) => ptyWrite(id, d));
			term.onResize(({ cols, rows }) => ptyResize(id, cols, rows).catch(() => {}));
			await ptyOpen(id, term.cols, term.rows, cwd || undefined);
			// Closed while the shell was starting: onDestroy's close came
			// before the shell existed, so it is closed here.
			if (disposed) {
				ptyClose(id);
				return runCleanups();
			}
			if (owner) ownTerminal(id, owner);
			if (run) {
				ptyWrite(id, run + '\r');
				onRan?.();
			}

			const ro = new ResizeObserver(refit);
			if (host) ro.observe(host);
			cleanups.push(() => ro.disconnect());
		})();
	});

	// Theme and font changes; a new font size changes the grid.
	$effect(() => {
		const look = terminalLook();
		if (!term) return;
		Object.assign(term.options, look);
		refit();
	});

	onDestroy(() => {
		disposed = true;
		runCleanups();
		dropTerminal(id);
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
