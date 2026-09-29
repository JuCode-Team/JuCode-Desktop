<script lang="ts" module>
	import type { Plus } from 'lucide-svelte';

	export interface AddMenuItem {
		id: string;
		icon: typeof Plus;
		title: string;
		desc: string;
		/** Toggle items (modes) show a check when on. */
		checked?: boolean;
		onSelect: () => void;
	}
	export interface AddMenuSection {
		label: string;
		items: AddMenuItem[];
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Check } from 'lucide-svelte';

	// The composer's "+" menu: a popover anchored above the trigger. Escape is
	// handled by the composer's capture-phase window handler; outside clicks
	// hit the backdrop.
	let {
		anchor,
		label,
		sections,
		onClose
	}: {
		anchor?: HTMLElement;
		label: string;
		sections: AddMenuSection[];
		onClose: () => void;
	} = $props();

	let popEl = $state<HTMLDivElement>();
	let popTop = $state(0);
	let popLeft = $state(0);
	function position() {
		if (!anchor || !popEl) return;
		const trigger = anchor.getBoundingClientRect();
		const margin = 12;
		const top = trigger.top - popEl.offsetHeight - 8;
		popLeft = Math.min(Math.max(trigger.left, margin), window.innerWidth - popEl.offsetWidth - margin);
		popTop = top >= margin ? top : Math.min(trigger.bottom + 8, window.innerHeight - popEl.offsetHeight - margin);
	}
	const rows = () => [...(popEl?.querySelectorAll<HTMLButtonElement>('.row') ?? [])];
	onMount(() => {
		tick().then(() => {
			position();
			rows()[0]?.focus();
		});
	});

	function onKey(e: KeyboardEvent) {
		const all = rows();
		const i = all.indexOf(document.activeElement as HTMLButtonElement);
		let next = -1;
		if (e.key === 'ArrowDown') next = (i + 1) % all.length;
		else if (e.key === 'ArrowUp') next = (i - 1 + all.length) % all.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = all.length - 1;
		else if (e.key === 'Tab') {
			onClose();
			return;
		} else return;
		e.preventDefault();
		all[next]?.focus();
	}
	function pick(item: AddMenuItem) {
		onClose();
		item.onSelect();
	}
</script>

<svelte:window onresize={position} />

<button class="pop-backdrop" aria-label="close" tabindex="-1" onclick={onClose}></button>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="add-pop" role="menu" aria-label={label} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px" onkeydown={onKey}>
	{#each sections as s (s.label)}
		<div class="sec" role="group" aria-label={s.label}>
			<div class="sec-label">{s.label}</div>
			{#each s.items as item (item.id)}
				{@const Icon = item.icon}
				<button
					class="row"
					role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
					aria-checked={item.checked}
					onclick={() => pick(item)}
				>
					<span class="ico"><Icon size={16} strokeWidth={1.5} /></span>
					<span class="txt">
						<span class="ttl">{item.title}</span>
						<span class="desc">{item.desc}</span>
					</span>
					{#if item.checked}<Check size={14} strokeWidth={1.5} class="add-check" />{/if}
				</button>
			{/each}
		</div>
	{/each}
</div>

<style>
	.pop-backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 20;
		cursor: default;
	}
	.add-pop {
		position: fixed;
		z-index: 21;
		width: 272px;
		max-width: calc(100vw - 24px);
		padding: 6px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-pop);
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.sec + .sec {
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid var(--hairline);
	}
	.sec-label {
		padding: 6px 10px 4px;
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
		padding: 7px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		outline: none;
	}
	.row:hover,
	.row:focus-visible {
		background: var(--surface2);
	}
	.ico {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}
	.ttl {
		font-size: var(--fs-sm);
	}
	.desc {
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	:global(.add-check) {
		color: var(--text);
		flex-shrink: 0;
	}
</style>
