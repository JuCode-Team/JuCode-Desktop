<script lang="ts" module>
	import { startDraft } from '$lib/backends/router';
	import { workMode } from '$lib/requirements.svelte';
	import type { Session } from '$lib/types';

	/** Starts a draft made for a requirement, with the user's `text`: the
	 *  daemon begins the requirement on it once it is up (SessionStore
	 *  #spawn), in the composer's mode once confirmed. */
	export function beginRequirement(session: Session, text: string) {
		const start = session.requirementStart;
		if (!start) return;
		session.requirementStart = { plan: start.plan, text: text.trim(), mode: workMode(session.chat.approvalMode) };
		startDraft(session.id);
	}
</script>

<script lang="ts">
	// A draft made for a requirement, before it starts: the requirement (its
	// title, words and screenshots), the user's notes to go with it, whether
	// a plan comes first, and the button that starts it. The agent first
	// says how it understands the requirement and waits.
	import Button from '$lib/ui/Button.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import RequirementTag from './RequirementTag.svelte';
	import { useRequirements, type Requirement } from '$lib/requirements.svelte';
	import { t } from '$lib/i18n';

	let { requirement: r, session }: { requirement: Requirement; session: Session } = $props();

	const reqs = useRequirements();
	let notes = $state('');
	let shots = $state<string[]>([]);
	$effect(() => {
		const id = r.id;
		Promise.all(r.images.map((_, i) => reqs.image(id, i)))
			.then((list) => (shots = list))
			.catch(() => {});
	});
</script>

<div class="start">
	<div class="head">
		<RequirementTag id={r.id} />
		<span class="title">{r.title}</span>
	</div>
	<p class="words">{r.text}</p>
	{#if shots.length}
		<div class="shots">
			{#each shots as src, i (i)}<img {src} alt="" />{/each}
		</div>
	{/if}
	<textarea bind:value={notes} rows="2" placeholder={t('shell.requirement.supplement')}></textarea>
	{#if session.requirementStart}
		<label class="plan">
			<Switch bind:checked={session.requirementStart.plan} label={t('shell.requirement.planFirst')} />
			<span>{t('shell.requirement.planFirst')}</span>
		</label>
	{/if}
	<div class="foot">
		<span class="hint">{t('shell.requirement.beginHint')}</span>
		<Button size="sm" variant="primary" onclick={() => beginRequirement(session, notes)}>{t('shell.requirement.begin')}</Button>
	</div>
</div>

<style>
	.start {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: min(560px, 100%);
		margin: auto;
		padding: 16px 18px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-sm);
		text-align: left;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.title {
		min-width: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.words {
		margin: 0;
		max-height: 30vh;
		overflow-y: auto;
		font-size: var(--fs-sm);
		line-height: 1.6;
		color: var(--dim);
		white-space: pre-wrap;
	}
	.shots {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.shots img {
		width: 96px;
		height: 62px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		object-fit: cover;
	}
	textarea {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 1.5;
		resize: vertical;
		outline: none;
	}
	textarea:focus {
		border-color: var(--text);
	}
	.plan {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: var(--fs-sm);
		color: var(--text);
		cursor: pointer;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hint {
		flex: 1;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim2);
	}
</style>
