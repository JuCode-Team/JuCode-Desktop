<script lang="ts">
	// The beta terms or the privacy policy, in a dialog (texts in legal.ts).
	import Modal from '$lib/ui/Modal.svelte';
	import { getLocale } from '$lib/i18n';
	import { LEGAL, type LegalDocId } from '$lib/legal';

	let { doc, onClose }: { doc: LegalDocId; onClose: () => void } = $props();
	const text = $derived(LEGAL[doc][getLocale() === 'zh' ? 'zh' : 'en']);
</script>

<Modal title={text.title} width={600} {onClose}>
	<div class="legal selectable">
		<p class="date">{text.updated}</p>
		{#each text.sections as section (section.heading)}
			<h3>{section.heading}</h3>
			{#each section.body as line (line)}
				<p>{line}</p>
			{/each}
		{/each}
	</div>
</Modal>

<style>
	.legal {
		max-height: 64vh;
		overflow: auto;
		color: var(--text);
		font-size: var(--fs-sm);
		line-height: 1.7;
	}
	.date {
		margin: 0 0 8px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	h3 {
		margin: 14px 0 4px;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	p {
		margin: 0 0 6px;
		color: var(--dim);
	}
</style>
