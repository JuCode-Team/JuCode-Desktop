<script lang="ts" module>
	import type PlusIcon from 'phosphor-svelte/lib/PlusIcon';

	export interface TrayItem {
		id: string;
		title: string;
		desc?: string | null;
		icon?: typeof PlusIcon;
		/** Render the title in mono (commands). */
		mono?: boolean;
		/** Short mono hint after the title (command args). */
		hint?: string | null;
		/** Small trailing tag (command source). */
		marker?: string | null;
		/** Leading checkbox (multi-select); `checked` fills it. */
		box?: boolean;
		/** On/off state: fills the box, or shows a trailing check when there's no box. */
		checked?: boolean;
		disabled?: boolean;
		onSelect: () => void;
	}
	export interface TraySection {
		label?: string;
		items: TrayItem[];
	}
</script>

<script lang="ts">
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import { trayNav, type TrayTab } from './tray';

	// The composer's in-box selection list, shared by the "+" menu, "/" command
	// completion and agent questions. It renders inside the composer card above
	// the editor; focus stays in the editor, which forwards keys to handleKey().
	let {
		label,
		heading = '',
		meta = '',
		sections,
		selected = $bindable(0),
		tab = 'none',
		onClose
	}: {
		label: string;
		/** Tray-level heading (e.g. the question being asked). */
		heading?: string;
		/** Dim text beside the heading (progress, header chip). */
		meta?: string;
		sections: TraySection[];
		selected?: number;
		tab?: TrayTab;
		onClose?: () => void;
	} = $props();

	const flat = $derived(sections.flatMap((s) => s.items));
	const offsets = $derived(sections.map((_, i) => sections.slice(0, i).reduce((n, s) => n + s.items.length, 0)));

	// Keep the cursor on a real, enabled row when the list changes under it.
	$effect.pre(() => {
		if (selected >= flat.length || flat[selected]?.disabled) {
			const first = flat.findIndex((it) => !it.disabled);
			selected = first < 0 ? 0 : first;
		}
	});

	let listEl = $state<HTMLDivElement>();
	$effect(() => {
		listEl?.querySelector(`#cmp-tray-opt-${selected}`)?.scrollIntoView({ block: 'nearest' });
	});

	function pick(i: number) {
		const it = flat[i];
		if (!it || it.disabled) return;
		selected = i;
		it.onSelect();
	}

	/** Route an editor keydown; true when the tray consumed it. */
	export function handleKey(e: KeyboardEvent): boolean {
		const nav = trayNav(e.key, selected, flat.map((it) => !!it.disabled), tab);
		if (!nav) return false;
		e.preventDefault();
		if (nav.kind === 'move') selected = nav.index;
		else if (nav.kind === 'pick') pick(selected);
		else onClose?.();
		return true;
	}
</script>

<div class="tray">
	{#if heading || meta}
		<div class="tray-head">
			{#if heading}<span class="heading">{heading}</span>{/if}
			{#if meta}<span class="meta">{meta}</span>{/if}
		</div>
	{/if}
	<div class="list" id="cmp-tray" role="listbox" aria-label={label} bind:this={listEl}>
		{#each sections as s, si (si)}
			<div class="sec" role="group" aria-label={s.label}>
				{#if s.label}<div class="sec-label">{s.label}</div>{/if}
				{#each s.items as item, ii (item.id)}
					{@const i = offsets[si] + ii}
					{@const Icon = item.icon}
					<button
						class="row"
						class:sel={i === selected}
						id="cmp-tray-opt-{i}"
						role="option"
						aria-selected={i === selected}
						aria-checked={item.checked}
						aria-disabled={item.disabled}
						tabindex="-1"
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => !item.disabled && (selected = i)}
						onclick={() => pick(i)}
					>
						{#if item.box}
							<span class="box" class:on={item.checked}>{#if item.checked}<CheckIcon size={11} />{/if}</span>
						{:else if Icon}
							<span class="ico"><Icon size={16} /></span>
						{/if}
						<span class="txt">
							<span class="ttl-line">
								<span class="ttl" class:mono={item.mono}>{item.title}</span>
								{#if item.hint}<span class="hint">{item.hint}</span>{/if}
								{#if item.desc}<span class="desc">{item.desc}</span>{/if}
							</span>
						</span>
						{#if item.marker}<span class="marker">{item.marker}</span>{/if}
						{#if item.checked && !item.box}<span class="trail"><CheckIcon size={14} /></span>{/if}
					</button>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.tray {
		margin: -4px -6px 8px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--hairline);
		animation: rise var(--t-med) var(--ease-out);
	}
	.tray-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 2px 8px 6px;
	}
	.heading {
		flex: 1;
		min-width: 0;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
		line-height: 1.45;
	}
	.meta {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.list {
		max-height: min(300px, 40vh);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.sec + .sec {
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid var(--hairline);
	}
	.sec-label {
		padding: 4px 8px 3px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 34px;
		padding: 4px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		text-align: left;
		cursor: pointer;
		outline: none;
		transition: background var(--t-fast) var(--ease-out);
	}
	.row.sel {
		background: var(--surface2);
	}
	.row[aria-disabled='true'] {
		opacity: 0.45;
		cursor: default;
	}
	.ico {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.row.sel .ico {
		color: var(--text);
	}
	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		margin: 0 1px;
		flex-shrink: 0;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		color: var(--panel);
	}
	.box.on {
		background: var(--text);
		border-color: var(--text);
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}
	.ttl-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.ttl {
		flex-shrink: 0;
		max-width: 60%;
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ttl.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.desc {
		min-width: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.marker {
		flex-shrink: 0;
		font-size: var(--fs-2xs);
		color: var(--dim);
		border: 1px solid var(--border);
		border-radius: var(--r-xs);
		padding: 1px 5px;
	}
	.trail {
		display: inline-flex;
		color: var(--text);
		flex-shrink: 0;
	}
</style>
