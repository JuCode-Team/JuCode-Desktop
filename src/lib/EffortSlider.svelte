<script lang="ts">
	let {
		efforts,
		current,
		onChange
	}: { efforts: string[]; current: string; onChange: (e: string) => void } = $props();

	let track = $state<HTMLElement | null>(null);
	const idx = $derived(Math.max(0, efforts.indexOf(current)));
	const last = $derived(Math.max(1, efforts.length - 1));
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

	function pick(i: number) {
		const ef = efforts[Math.max(0, Math.min(efforts.length - 1, i))];
		if (ef && ef !== current) onChange(ef);
	}
	function at(e: PointerEvent) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
		pick(Math.round(ratio * last));
	}
	function startDrag(e: PointerEvent) {
		e.preventDefault();
		at(e);
		const move = (ev: PointerEvent) => at(ev);
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') pick(idx - 1);
		else if (e.key === 'ArrowRight') pick(idx + 1);
	}
</script>

<div class="effort">
	<div class="ehead">
		<span>Effort <b>{cap(current)}</b></span>
		<span class="help" title="Higher effort = deeper reasoning, slower replies">?</span>
	</div>
	<div class="elabels"><span>Faster</span><span>Smarter</span></div>
	<div
		class="etrack"
		bind:this={track}
		onpointerdown={startDrag}
		onkeydown={onKey}
		role="slider"
		tabindex="0"
		aria-label="thinking effort"
		aria-valuemin={0}
		aria-valuemax={last}
		aria-valuenow={idx}
	>
		<div class="eline"></div>
		<div class="efill" style:width="{(idx / last) * 100}%"></div>
		{#each efforts as ef, i (ef)}
			<button
				class="edot"
				class:done={i < idx}
				class:cur={i === idx}
				style:left="{(i / last) * 100}%"
				onclick={(e) => {
					e.stopPropagation();
					pick(i);
				}}
				aria-label={ef}
			></button>
		{/each}
	</div>
</div>

<style>
	.effort {
		padding: 12px 14px 16px;
		min-width: 232px;
	}
	.ehead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 13px;
		color: var(--dim);
	}
	.ehead b {
		color: var(--text);
		font-weight: 600;
	}
	.help {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--border);
		color: var(--dim2);
		font-size: 11px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: help;
	}
	.elabels {
		display: flex;
		justify-content: space-between;
		margin: 14px 0 8px;
		font-size: 12px;
		color: var(--dim2);
	}
	.etrack {
		position: relative;
		height: 18px;
		cursor: pointer;
		outline: none;
	}
	.eline {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 4px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--surface2);
	}
	.efill {
		position: absolute;
		top: 50%;
		left: 0;
		height: 4px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--accent);
	}
	.edot {
		position: absolute;
		top: 50%;
		width: 8px;
		height: 8px;
		padding: 0;
		border-radius: 50%;
		border: none;
		background: var(--dim2);
		transform: translate(-50%, -50%);
		cursor: pointer;
	}
	.edot.done {
		background: var(--accent);
	}
	.edot.cur {
		width: 16px;
		height: 16px;
		background: var(--accent-bright);
		box-shadow: 0 0 0 4px var(--accent-soft);
	}
</style>
