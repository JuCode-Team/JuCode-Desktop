<script lang="ts">
	// A native TUI panel: the real interactive CLI (jucode / codex / claude)
	// running in a pty, rendered by xterm. Two uses: a standalone `tui:*` tab
	// (a local pty, independent of any GUI session) and a session handoff,
	// where the chat tile's conversation moves into its engine's TUI on a
	// daemon terminal (`session`, `onBackToGui`). Closing the panel kills the
	// process. Only the backend name reaches Rust; binary resolution is
	// validated there.
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import { terminalLook, useWebgl } from './terminal';
	import { ptyOpen, ptyWrite, ptyResize, ptyClose, daemon } from '$lib/protocol';
	import type { BackendId } from '$lib/backends/types';
	import { loadBackendSettings } from '$lib/backends/settings';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

	let {
		backend,
		cwd = '',
		session,
		onBackToGui,
		onOpenSettings
	}: {
		backend: BackendId;
		/** A daemon-hosted conversation: the daemon stops its engine and runs
		 *  the engine's own TUI on a terminal (`session_tui`), with the session's
		 *  gateway; the engine resumes when the TUI exits. */
		session?: string;
		cwd?: string;
		/** Present only for session handoffs: hand the conversation back to
		 *  the GUI chat (shows the "back to GUI" bar). */
		onBackToGui?: () => void | Promise<void>;
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
	let disposed = false;
	let closing = $state(false);
	let launchTask: Promise<void> | undefined;

	function newId() {
		return `tui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	/** Fit the grid to the panel and tell the process its new size. */
	function refit() {
		try {
			fit?.fit();
			if (term) resize(term.cols, term.rows);
		} catch {
			/* ignore */
		}
	}

	// The daemon's terminal for a hosted session: its id, and the exit it
	// reports once the TUI is gone (the engine starts again after it).
	let daemonTerm = '';
	let daemonExit: Promise<void> = Promise.resolve();
	const encoder = new TextEncoder();
	const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
	const unbase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

	function write(data: string) {
		if (session) {
			if (daemonTerm) daemon.post({ op: 'term_input', term: daemonTerm, data: base64(encoder.encode(data)) }).catch(() => {});
		} else ptyWrite(id, data).catch(() => {});
	}
	function resize(cols: number, rows: number) {
		if (session) {
			if (daemonTerm) daemon.post({ op: 'term_resize', term: daemonTerm, cols, rows }).catch(() => {});
		} else ptyResize(id, cols, rows).catch(() => {});
	}

	async function launchDaemon() {
		if (!term || !session) return;
		status = 'starting';
		errMsg = '';
		try {
			fit?.fit();
			let exited: () => void = () => {};
			daemonExit = new Promise((resolve) => (exited = resolve));
			const reply = await daemon.request({ op: 'session_tui', session, cols: term.cols, rows: term.rows });
			daemonTerm = String(reply.term ?? '');
			const off = daemon.onTerm(daemonTerm, (frame) => {
				if (frame.type === 'term_output') term?.write(unbase64(String(frame.data ?? '')));
				else {
					exited();
					// The TUI ended (the user quit it): the conversation is the
					// GUI's again, its engine already resuming.
					if (!closing && onBackToGui) void backToGui();
					else status = 'exited';
				}
			});
			cleanups.push(off);
			// Closed while the TUI was starting: nothing could end it then.
			if (disposed || closing) {
				daemon.post({ op: 'term_close', term: daemonTerm }).catch(() => {});
				if (disposed) off();
				return;
			}
			status = 'running';
		} catch (e) {
			if (disposed || closing) return;
			status = 'error';
			errMsg = String(e);
		}
	}

	async function launch() {
		if (!term) return;
		if (session) return launchDaemon();
		const launchId = id;
		status = 'starting';
		errMsg = '';
		try {
			fit?.fit();
			await ptyOpen(launchId, term.cols, term.rows, cwd || undefined, {
				command: backend,
				binOverride: loadBackendSettings().paths[backend]
			});
			// An unmount/back-to-GUI request may race an in-flight ptyOpen. Close
			// the child it just created before allowing any GUI owner to start.
			if (disposed || closing || launchId !== id) {
				await ptyClose(launchId);
				return;
			}
			status = 'running';
		} catch (e) {
			if (disposed || closing || launchId !== id) return;
			const msg = String(e);
			status = msg.includes('binary-missing:') ? 'missing' : 'error';
			errMsg = msg;
		}
	}

	function restart() {
		// A hosted session's TUI ending hands the conversation back instead.
		if (disposed || closing || session) return;
		ptyClose(id).catch(() => {});
		id = newId();
		term?.reset();
		launchTask = launch();
	}

	/** Establish exclusive ownership in the other direction too: the callback
	 *  flips the session to GUI and respawns its engine, so it must not run
	 *  until the current (or still-opening) pty has definitely been reaped. */
	async function backToGui() {
		if (!onBackToGui || closing) return;
		closing = true;
		if (session) {
			// Quitting the TUI hands the conversation back: the daemon starts
			// the engine again once the TUI has exited.
			try {
				if (daemonTerm) await daemon.post({ op: 'term_close', term: daemonTerm });
				await daemonExit;
				await onBackToGui();
			} catch (e) {
				if (disposed) return;
				closing = false;
				status = 'error';
				errMsg = String(e);
			}
			return;
		}
		const ptyId = id;
		try {
			await ptyClose(ptyId);
			await launchTask;
			// If ptyOpen was still crossing the IPC boundary, the first close
			// may have found nothing. launch() also closes in that case; this is
			// a final idempotent barrier before the GUI process can start.
			await ptyClose(ptyId);
			await onBackToGui();
		} catch (e) {
			if (disposed) return;
			closing = false;
			status = 'error';
			errMsg = String(e);
		}
	}

	onMount(() => {
		(async () => {
			term = new Terminal({ ...terminalLook(), cursorBlink: true, allowProposedApi: true });
			fit = new FitAddon();
			term.loadAddon(fit);
			if (host) term.open(host);
			useWebgl(term);
			fit.fit();
			// Moved here from the chat: the keys go to the TUI at once.
			if (session) term.focus();

			const unOut = await listen<{ id: string; data: string }>('pty-output', (e) => {
				if (e.payload.id === id) term?.write(e.payload.data);
			});
			const unExit = await listen<string>('pty-exit', (e) => {
				if (e.payload === id && status === 'running') status = 'exited';
			});
			cleanups.push(unOut, unExit);

			term.onData(write);

			if (disposed || closing) {
				cleanups.forEach((f) => f());
				return;
			}
			launchTask = launch();
			await launchTask;

			const ro = new ResizeObserver(refit);
			if (host) ro.observe(host);
			cleanups.push(() => ro.disconnect());

			if (disposed) cleanups.forEach((f) => f());
		})();
		return () => {
			disposed = true;
			closing = true;
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
		disposed = true;
		closing = true;
		cleanups.forEach((f) => f());
		if (session) {
			if (daemonTerm) daemon.post({ op: 'term_close', term: daemonTerm }).catch(() => {});
		} else ptyClose(id).catch(() => {});
		term?.dispose();
	});
</script>

<div class="tui-wrap">
	{#if onBackToGui}
		<div class="handoffbar">
			<span class="hb-text">{t('dock.tui.handoff')}</span>
			<Button size="sm" disabled={closing} onclick={backToGui}>{t('dock.tui.backToGui')}</Button>
		</div>
	{/if}
	<div class="term-host" bind:this={host}></div>
	{#if status === 'missing' || status === 'error'}
		<div class="failed">
			<p class="title">
				{status === 'missing' ? t('dock.tui.missing', { bin: backend }) : t('dock.tui.failed')}
			</p>
			{#if status === 'missing'}
				<p class="hint">{t('dock.tui.missingHint', { bin: backend })}</p>
			{:else}
				<div class="err"><Notice mono>{errMsg}</Notice></div>
			{/if}
			<div class="row">
				{#if status === 'missing' && onOpenSettings}
					<Button size="sm" onclick={onOpenSettings}>{t('dock.tui.openSettings')}</Button>
				{/if}
				<Button size="sm" onclick={restart}>{t('dock.tui.retry')}</Button>
			</div>
		</div>
	{:else if status === 'exited'}
		<div class="exitbar">
			<span>{t('dock.tui.exited')}</span>
			<Button size="sm" onclick={restart}>{t('dock.tui.restart')}</Button>
			{#if onBackToGui}
				<Button size="sm" disabled={closing} onclick={backToGui}>{t('dock.tui.backToGui')}</Button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tui-wrap {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
	}
	.handoffbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 4px 10px;
		font-size: var(--fs-xs);
		color: var(--dim);
		background: var(--surface);
		border-bottom: 1px solid var(--hairline);
	}
	.hb-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.term-host {
		flex: 1;
		min-height: 0;
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
	/* Launch failure: covers the (empty) terminal. */
	.failed {
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
	.failed .title {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.failed .hint {
		margin: 0;
		max-width: 340px;
		font-size: var(--fs-sm);
		line-height: 1.5;
		color: var(--dim);
	}
	.failed .err {
		width: min(420px, 100%);
		text-align: left;
	}
	.failed .row {
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
		font-size: var(--fs-xs);
		color: var(--dim);
		background: var(--surface);
		border-top: 1px solid var(--hairline);
	}
</style>
