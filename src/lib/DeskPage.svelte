<script lang="ts">
	import ActiveIcon from '$lib/icons/ActiveIcon.svelte';
	import { paneOut } from '$lib/ui/motion';
	// The workbench: a page over the content panel, like Settings. The nav
	// lists what waits for the user (approvals deferred while nobody watched)
	// and the scheduled tasks; the main column shows one of them.
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Notice from '$lib/ui/Notice.svelte';
	import DeskCard from '$lib/DeskCard.svelte';
	import DeskClosed from '$lib/DeskClosed.svelte';
	import ScheduleBoard from '$lib/ScheduleBoard.svelte';
	import { daemonState } from '$lib/daemonState.svelte';
	import { t } from '$lib/i18n';

	let {
		page = $bindable('pending'),
		navWidth,
		projects,
		onClose,
		onOpenSession
	}: {
		page?: 'pending' | 'schedules';
		navWidth: number;
		/** The open workspace's projects: scheduled tasks run in them. */
		projects: { id: string; path: string; name: string }[];
		onClose: () => void;
		onOpenSession: (session: string) => void;
	} = $props();

	const pending = $derived(daemonState.actions.length);
	const scheduleCount = $derived(daemonState.schedules.filter((s) => s.enabled).length);

	function openPage(p: typeof page) {
		page = p;
	}
</script>
<div class="desk-page" out:paneOut|global>
	<nav class="nav" style:width="{navWidth}px" aria-label={t('shell.desk.title')}>
		<div class="nav-head">
			<button class="back" title={t('shell.desk.back')} aria-label={t('shell.desk.back')} onclick={onClose}>
				<ArrowLeftIcon size={16} />
			</button>
			<h2>{t('shell.desk.title')}</h2>
		</div>
		<div class="nav-list">
			<button class="item" class:on={page === 'pending'} aria-current={page === 'pending' ? 'page' : undefined} onclick={() => openPage('pending')}>
				<ActiveIcon icon={InboxIcon} size={16} active={page === 'pending'} />
				<span class="label">{t('shell.desk.pending')}</span>
				{#if pending}<span class="badge">{pending}</span>{/if}
			</button>
			<button class="item" class:on={page === 'schedules'} aria-current={page === 'schedules' ? 'page' : undefined} onclick={() => openPage('schedules')}>
				<ActiveIcon icon={CalendarIcon} size={16} active={page === 'schedules'} />
				<span class="label">{t('shell.schedule.title')}</span>
				{#if scheduleCount}<span class="count">{scheduleCount}</span>{/if}
			</button>
		</div>
	</nav>
	<div class="main">
		{#if page === 'schedules'}
			<div class="col">
				<ScheduleBoard {projects} {onOpenSession} />
			</div>
		{:else}
			<div class="col">
				<h1>{t('shell.desk.pending')}</h1>
				<p class="lede">{t('shell.desk.subtitle')}</p>
				{#if daemonState.status === 'unreachable'}<Notice tone="warn">{t('shell.desk.unreachable')}</Notice>{/if}
				<section>
					{#if pending === 0}<p class="empty">{t('shell.desk.nothingPending')}</p>{/if}
					<div class="cards">
						{#each daemonState.actions as a (a.id)}
							<DeskCard action={a} {onOpenSession} />
						{/each}
					</div>
					<DeskClosed />
				</section>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Covers the content panel, as Settings does. */
	.desk-page {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		min-width: 0;
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.nav {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--sidebar);
	}
	:global(:root[data-vibrancy='on']) .nav {
		background: var(--vibrancy-tint);
	}
	.nav-head {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 40px;
		margin: 14px 12px 8px;
	}
	.nav-head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--text);
	}
	.back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.back:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.nav-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 12px 16px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 36px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.item > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.item:hover,
	.item.on {
		background: var(--surface2);
	}
	.item.on > :global(svg) {
		color: var(--text);
	}
	.label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		flex: none;
		min-width: 20px;
		padding: 0 6px;
		border-radius: var(--r);
		background: var(--accent);
		color: var(--on-accent);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 20px;
		text-align: center;
	}
	.count {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}

	.main {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		background: var(--bg);
	}
	.col {
		max-width: 760px;
		margin: 0 auto;
		padding: 56px 32px 80px;
		animation: rise var(--t-med) var(--ease-out);
	}
	h1 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
	}
	.lede {
		margin: 10px 0 22px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
</style>
