<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { X, Save, Sparkles, PanelRightClose } from 'lucide-svelte';
	import { ask } from '@tauri-apps/plugin-dialog';
	import {
		EditorView,
		keymap,
		lineNumbers,
		highlightActiveLine,
		highlightActiveLineGutter,
		drawSelection,
		dropCursor
	} from '@codemirror/view';
	import { EditorState, Compartment } from '@codemirror/state';
	import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
	import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
	import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	import { themeState } from '$lib/theme.svelte';
	import { editorStore, type EditorTab } from './editorStore.svelte';
	import { languageFor } from './language';
	import { editorTheme } from './cmTheme';
	import { diffGutter, setDiffMarks } from './diffGutter';
	import { aiHighlight, setAiRange } from './aiHighlight';
	import { lineDiff, gutterMarks } from './lineDiff';

	// ⌘K sends a structured instruction to the active session (wired by the page).
	let { onAiSend }: { onAiSend?: (content: string) => boolean } = $props();

	const store = editorStore;

	let host = $state<HTMLElement | null>(null);
	let view: EditorView | null = null;
	// Per-tab EditorState cache — one EditorView reused across tabs.
	const states = new Map<string, { state: EditorState; rev: number; lang: boolean }>();
	let shownPath = '';
	let shownRev = -1;

	let line = $state(1);
	let col = $state(1);
	let langLabel = $state('');
	let aiPrompt = $state<{ top: number; left: number; fromLine: number; toLine: number } | null>(null);
	let aiInput = $state('');
	let aiInputEl = $state<HTMLInputElement | null>(null);

	const langCompartment = new Compartment();
	const themeCompartment = new Compartment();

	let syncTimer: ReturnType<typeof setTimeout> | null = null;
	let diffTimer: ReturnType<typeof setTimeout> | null = null;

	function extensions() {
		return [
			lineNumbers(),
			diffGutter(),
			highlightActiveLineGutter(),
			highlightActiveLine(),
			history(),
			drawSelection(),
			dropCursor(),
			indentOnInput(),
			indentUnit.of('\t'),
			bracketMatching(),
			closeBrackets(),
			autocompletion(),
			highlightSelectionMatches(),
			aiHighlight(),
			keymap.of([
				{
					key: 'Mod-s',
					preventDefault: true,
					run: () => {
						void saveActive();
						return true;
					}
				},
				{
					key: 'Mod-k',
					preventDefault: true,
					run: (v) => {
						openAiPrompt(v);
						return true;
					}
				},
				...closeBracketsKeymap,
				...defaultKeymap,
				...searchKeymap,
				...historyKeymap,
				...completionKeymap,
				indentWithTab
			]),
			langCompartment.of([]),
			themeCompartment.of(editorTheme(themeState.value === 'dark')),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					const path = shownPath;
					store.markDirty(path);
					if (syncTimer) clearTimeout(syncTimer);
					syncTimer = setTimeout(() => {
						if (view && shownPath === path) store.syncDoc(path, view.state.doc.toString());
					}, 250);
					if (diffTimer) clearTimeout(diffTimer);
					diffTimer = setTimeout(() => {
						const tab = store.tab(path);
						if (view && tab && shownPath === path) refreshDiff(view, tab);
					}, 350);
				}
				if (update.selectionSet || update.docChanged) {
					const head = update.state.selection.main.head;
					const l = update.state.doc.lineAt(head);
					line = l.number;
					col = head - l.from + 1;
				}
			})
		];
	}

	function refreshDiff(v: EditorView, tab: EditorTab) {
		let marks: ReturnType<typeof gutterMarks> = [];
		if (tab.headText != null) {
			const chunks = lineDiff(tab.headText, v.state.doc.toString());
			if (chunks) marks = gutterMarks(chunks, v.state.doc.lines);
		}
		v.dispatch({ effects: setDiffMarks.of(marks) });
	}

	function applyAiRange(v: EditorView, tab: EditorTab) {
		v.dispatch({ effects: setAiRange.of(tab.aiRange) });
	}

	async function applyLanguage(v: EditorView, tab: EditorTab, entry: { lang: boolean }) {
		const { label, support } = await languageFor(tab.name);
		if (shownPath !== tab.path || view !== v) return; // switched away meanwhile
		langLabel = label;
		if (!entry.lang) {
			v.dispatch({ effects: langCompartment.reconfigure(support ?? []) });
			entry.lang = true;
		}
	}

	// Attach the active tab's EditorState to the (single, reused) view. Reruns
	// when the active path changes or the tab's content is replaced from outside
	// the editor (rev bump: open / reload / AI auto-reload).
	$effect(() => {
		const tab = store.active;
		const path = tab?.path ?? '';
		const rev = tab?.rev ?? 0;
		const h = host;
		untrack(() => {
			if (!tab || !h) return;
			if (!view) view = new EditorView({ parent: h });
			const v = view;
			if (shownPath === path && shownRev === rev) return;
			// Stash the outgoing tab's live state (keeps undo history + cursor).
			if (shownPath && shownPath !== path) {
				const prev = states.get(shownPath);
				if (prev) prev.state = v.state;
				// Flush any pending doc sync for the outgoing tab.
				if (syncTimer) {
					clearTimeout(syncTimer);
					syncTimer = null;
					store.syncDoc(shownPath, v.state.doc.toString());
				}
			}
			let entry = states.get(path);
			if (!entry || entry.rev !== rev) {
				entry = { state: EditorState.create({ doc: tab.doc, extensions: extensions() }), rev, lang: false };
				states.set(path, entry);
			}
			shownPath = path;
			shownRev = rev;
			v.setState(entry.state);
			// Theme compartment content may be stale on a cached state (theme
			// changed while another tab was showing) — reassert it.
			v.dispatch({ effects: themeCompartment.reconfigure(editorTheme(themeState.value === 'dark')) });
			void applyLanguage(v, tab, entry);
			refreshDiff(v, tab);
			applyAiRange(v, tab);
			aiPrompt = null;
			const head = v.state.selection.main.head;
			const l = v.state.doc.lineAt(head);
			line = l.number;
			col = head - l.from + 1;
		});
	});

	// Re-theme on app theme change.
	$effect(() => {
		const dark = themeState.value === 'dark';
		untrack(() => view?.dispatch({ effects: themeCompartment.reconfigure(editorTheme(dark)) }));
	});

	// Reflect async headText arrival and AI-range changes onto the live view.
	$effect(() => {
		const tab = store.active;
		tab?.headText;
		untrack(() => {
			if (view && tab && shownPath === tab.path) refreshDiff(view, tab);
		});
	});
	$effect(() => {
		const tab = store.active;
		tab?.aiRange;
		untrack(() => {
			if (view && tab && shownPath === tab.path) applyAiRange(view, tab);
		});
	});

	// Drop cached states for closed tabs.
	$effect(() => {
		const open = new Set(store.tabs.map((x) => x.path));
		untrack(() => {
			for (const p of [...states.keys()]) if (!open.has(p)) states.delete(p);
			if (shownPath && !open.has(shownPath)) {
				shownPath = '';
				shownRev = -1;
			}
		});
	});

	onDestroy(() => {
		if (syncTimer) clearTimeout(syncTimer);
		if (diffTimer) clearTimeout(diffTimer);
		view?.destroy();
		view = null;
	});

	/** Live document for a tab: the view when showing, else the cached state/store. */
	function liveDoc(path: string): string {
		if (view && shownPath === path) return view.state.doc.toString();
		const cached = states.get(path);
		return cached ? cached.state.doc.toString() : (store.tab(path)?.doc ?? '');
	}

	async function saveActive() {
		const tab = store.active;
		if (!tab) return;
		await store.save(tab.path, liveDoc(tab.path));
		if (view && shownPath === tab.path) refreshDiff(view, tab);
	}

	async function closeTab(tab: EditorTab) {
		if (!store.close(tab.path)) {
			const ok = await ask(t('editor.unsavedClose', { name: tab.name }), {
				title: t('editor.unsavedTitle'),
				kind: 'warning'
			});
			if (!ok) return;
			store.close(tab.path, true);
		}
	}

	async function overwriteConflict(tab: EditorTab) {
		await store.save(tab.path, liveDoc(tab.path), true);
		if (view && shownPath === tab.path) refreshDiff(view, tab);
	}

	function openAiPrompt(v: EditorView) {
		const tab = store.active;
		if (!tab || !host) return;
		const sel = v.state.selection.main;
		const fromLine = v.state.doc.lineAt(sel.from).number;
		const toLine = v.state.doc.lineAt(sel.to).number;
		const coords = v.coordsAtPos(v.state.doc.line(fromLine).from);
		const rect = host.getBoundingClientRect();
		const top = coords ? Math.max(6, coords.top - rect.top - 42) : 8;
		aiPrompt = { top, left: 14, fromLine, toLine };
		aiInput = '';
		aiError = '';
		tick().then(() => aiInputEl?.focus());
	}

	let aiError = $state('');
	async function submitAi() {
		const tab = store.active;
		const v = view;
		const p = aiPrompt;
		const instruction = aiInput.trim();
		if (!tab || !v || !p || !instruction) return;
		aiError = '';
		// The agent edits the on-disk file — unsaved buffer changes must land first.
		if (tab.dirty) {
			const res = await store.save(tab.path, liveDoc(tab.path));
			if (res !== 'saved') return; // conflict banner / error strip takes over
		}
		const from = v.state.doc.line(Math.min(p.fromLine, v.state.doc.lines)).from;
		const to = v.state.doc.line(Math.min(p.toLine, v.state.doc.lines)).to;
		const selText = v.state.sliceDoc(from, to);
		const content = [
			`请只修改 ${tab.rel} 的第 ${p.fromLine}-${p.toLine} 行选区，完成后无需解释。`,
			'',
			'选区内容：',
			'```',
			selText,
			'```',
			'',
			`修改要求：${instruction}`
		].join('\n');
		if (onAiSend?.(content) === false) {
			aiError = t('editor.aiNoSession');
			return;
		}
		store.beginAiEdit(tab.path, p.fromLine, p.toLine);
		aiPrompt = null;
	}
	function aiKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void submitAi();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			aiPrompt = null;
			view?.focus();
		}
	}

	const active = $derived(store.active);
</script>

<div class="editor">
	<div class="etabbar">
		<div class="etabs">
			{#each store.tabs as tab (tab.path)}
				<div
					class="etab"
					class:on={tab.path === store.activePath}
					role="tab"
					tabindex="0"
					aria-selected={tab.path === store.activePath}
					title={tab.rel}
					onclick={() => store.activate(tab.path)}
					onkeydown={(e) => e.key === 'Enter' && store.activate(tab.path)}
					onauxclick={(e) => {
						if (e.button === 1) {
							e.preventDefault();
							void closeTab(tab);
						}
					}}
				>
					<span class="edot" class:dirty={tab.dirty} class:conflict={tab.conflict}></span>
					<span class="ename">{tab.name}</span>
					<IconButton
						size="sm"
						label={t('editor.closeTab')}
						onpointerdown={(e: PointerEvent) => e.stopPropagation()}
						onclick={(e: MouseEvent) => {
							e.stopPropagation();
							void closeTab(tab);
						}}><X size={12} /></IconButton>
				</div>
			{/each}
		</div>
		<div class="eactions">
			<IconButton size="sm" label={t('editor.save')} title="{t('editor.save')} ⌘S" disabled={!active?.dirty} onclick={saveActive}><Save size={14} /></IconButton>
			<IconButton size="sm" label={t('editor.closePane')} title={t('editor.closePane')} onclick={() => (store.visible = false)}><PanelRightClose size={14} /></IconButton>
		</div>
	</div>

	{#if active}
		{#if active.conflict}
			<div class="conflict">
				<div class="conflict-text">
					<b>{t('editor.conflictTitle')}</b>
					<span>{t('editor.conflictBody')}</span>
				</div>
				<div class="conflict-actions">
					<Button size="sm" variant="secondary" onclick={() => store.reload(active.path)}>{t('editor.reloadFile')}</Button>
					<Button size="sm" variant="danger" onclick={() => overwriteConflict(active)}>{t('editor.overwrite')}</Button>
				</div>
			</div>
		{/if}
		{#if active.error}
			<div class="eerr" role="button" tabindex="0" onclick={() => (active.error = '')} onkeydown={(e) => e.key === 'Enter' && (active.error = '')}>{active.error}</div>
		{/if}
		<div class="ehost" bind:this={host}>
			{#if aiPrompt}
				<div class="ai-prompt" style:top="{aiPrompt.top}px" style:left="{aiPrompt.left}px">
					<Sparkles size={13} class="ai-ico" />
					<input
						bind:this={aiInputEl}
						bind:value={aiInput}
						placeholder={t('editor.aiPlaceholder')}
						onkeydown={aiKey}
					/>
					<span class="ai-range">L{aiPrompt.fromLine}{aiPrompt.toLine !== aiPrompt.fromLine ? `-${aiPrompt.toLine}` : ''}</span>
					<button class="ai-send" onclick={submitAi}>{active.dirty ? t('editor.aiSaveSend') : t('editor.aiSend')}</button>
					{#if aiError}<span class="ai-err">{aiError}</span>{/if}
				</div>
			{/if}
		</div>
		<div class="estatus">
			<span class="spath" title={active.path}>{active.rel}</span>
			{#if active.aiRange}
				<span class="sai"><Sparkles size={11} /> {t('editor.aiPending')}</span>
			{/if}
			<span class="sflex"></span>
			{#if active.dirty}
				<button class="ssave" onclick={saveActive}>{t('editor.save')} ⌘S</button>
			{/if}
			<span class="sitem">{langLabel}</span>
			<span class="sitem">{line}:{col}</span>
			<span class="sitem">{t('editor.utf8')}</span>
		</div>
	{:else}
		<div class="eempty">
			<p>{t('editor.empty')}</p>
			<span>{t('editor.emptyHint')}</span>
		</div>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg);
	}
	.etabbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 7px 8px 6px;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.etabs {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}
	.etabs::-webkit-scrollbar {
		height: 0;
	}
	.etab {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 4px 5px 4px 10px;
		border-radius: var(--r-sm);
		font-size: 12px;
		color: var(--dim);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.etab:hover {
		background: var(--surface);
		color: var(--text);
	}
	.etab.on {
		background: var(--surface2);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.etab :global(.ib) {
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.etab:hover :global(.ib),
	.etab.on :global(.ib) {
		opacity: 1;
	}
	.edot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.edot.dirty {
		background: var(--warn);
	}
	.edot.conflict {
		background: var(--err);
	}
	.ename {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.eactions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}
	.conflict {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
		background: color-mix(in oklab, var(--warn) 10%, var(--panel));
		border-bottom: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
		flex-shrink: 0;
	}
	.conflict-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.conflict-text b {
		font-size: 12.5px;
		color: var(--warn);
	}
	.conflict-text span {
		font-size: 11.5px;
		color: var(--dim);
	}
	.conflict-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.eerr {
		padding: 6px 12px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 10%, transparent);
		border-bottom: 1px solid color-mix(in oklab, var(--err) 28%, transparent);
		cursor: pointer;
		flex-shrink: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.ehost {
		flex: 1;
		min-height: 0;
		position: relative;
		overflow: hidden;
	}
	.ehost :global(.cm-editor) {
		height: 100%;
	}
	.ai-prompt {
		position: absolute;
		z-index: 20;
		right: 14px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		background: var(--panel);
		border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--border));
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
	}
	.ai-prompt :global(.ai-ico) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.ai-prompt input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font-size: 12.5px;
		outline: none;
	}
	.ai-range {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.ai-send {
		flex-shrink: 0;
		border: none;
		border-radius: 6px;
		padding: 4px 10px;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 11.5px;
		font-weight: 600;
		cursor: pointer;
	}
	.ai-err {
		font-size: 11px;
		color: var(--err);
		flex-shrink: 0;
	}
	.estatus {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 5px 12px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.spath {
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.sai {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--accent-bright);
		flex-shrink: 0;
		animation: pulse 1.2s ease-in-out infinite;
	}
	.sflex {
		flex: 1;
	}
	.ssave {
		border: none;
		background: none;
		color: var(--warn);
		font-size: 11px;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.sitem {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.eempty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		color: var(--dim2);
	}
	.eempty p {
		margin: 0;
		font-size: 13.5px;
		color: var(--dim);
	}
	.eempty span {
		font-size: 12px;
	}
</style>
