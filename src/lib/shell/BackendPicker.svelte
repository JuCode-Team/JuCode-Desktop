<script lang="ts">
	// New-session backend picker: choose which agent engine backs the session.
	// Defaults to the project's last-used backend (falling back to the settings
	// default); codex/claude availability is probed best-effort via check_backend.
	import { onMount } from 'svelte';
	import { Check } from 'lucide-svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { t } from '$lib/i18n';
	import { checkBackend } from '$lib/protocol';
	import { BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import { defaultBackendFor, loadBackendSettings, versionLabel } from '$lib/backends/settings';
	import BackendIcon from '$lib/BackendIcon.svelte';

	let {
		lastUsed,
		onPick,
		onClose
	}: {
		/** The project's last-used backend (preselected). */
		lastUsed?: BackendId;
		onPick: (b: BackendId) => void;
		onClose: () => void;
	} = $props();

	const settings = loadBackendSettings();
	// Initial value only, by design: the modal is recreated on every open, and
	// the preselection must not jump around while the user arrows through it.
	// svelte-ignore state_referenced_locally
	let selected = $state<BackendId>(defaultBackendFor(lastUsed, settings));
	// null = probing / unknown; jucode is assumed present (it always was before).
	let available = $state<Partial<Record<BackendId, { found: boolean; version: string }>>>({});

	const DESC_KEY: Record<BackendId, string> = {
		jucode: 'shell.backend.descJucode',
		codex: 'shell.backend.descCodex',
		claude: 'shell.backend.descClaude'
	};

	onMount(() => {
		for (const id of BACKEND_IDS) {
			checkBackend(id, settings.paths[id])
				.then((s) => (available[id] = { found: s.found, version: versionLabel(s) }))
				.catch(() => {});
		}
	});

	function onKey(e: KeyboardEvent) {
		const i = BACKEND_IDS.indexOf(selected);
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = BACKEND_IDS[Math.min(i + 1, BACKEND_IDS.length - 1)];
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = BACKEND_IDS[Math.max(i - 1, 0)];
		} else if (e.key === 'Enter') {
			e.preventDefault();
			onPick(selected);
		}
	}
</script>

<svelte:window onkeydown={onKey} />
<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.backend.pickTitle')} use:focusTrap>
		<div class="head">{t('shell.backend.pickTitle')}</div>
		<div class="rows">
			{#each BACKEND_IDS as id (id)}
				{@const probe = available[id]}
				<button class="row" class:on={id === selected} onclick={() => onPick(id)} onmouseenter={() => (selected = id)}>
					<span class="ico"><BackendIcon backend={id} size={16} /></span>
					<span class="txt">
						<span class="name">{BACKEND_LABELS[id]}
							{#if probe && !probe.found}<span class="miss">{t('shell.backend.notFound')}</span>{/if}
						</span>
						<span class="desc">{probe?.found && probe.version ? probe.version : t(DESC_KEY[id])}</span>
					</span>
					{#if id === selected}<span class="check"><Check size={15} /></span>{/if}
				</button>
			{/each}
		</div>
		<div class="foot">{t('shell.backend.pickFoot')}</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.modal {
		width: min(400px, 92vw);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		animation: rise 0.14s ease;
	}
	.head {
		padding: 13px 16px;
		font-weight: 600;
		font-size: 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.rows {
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		text-align: left;
		padding: 10px 11px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.row.on {
		background: var(--surface2);
	}
	.ico {
		display: inline-flex;
		width: 30px;
		height: 30px;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.name {
		font-size: 13.5px;
		font-weight: 500;
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.miss {
		font-size: 10px;
		color: var(--warn);
		border: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
		border-radius: 4px;
		padding: 0 5px;
	}
	.desc {
		font-size: 11.5px;
		color: var(--dim);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.check {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--dim2);
		text-align: center;
	}
</style>
