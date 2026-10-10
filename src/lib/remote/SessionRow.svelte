<script lang="ts">
	// One session in a remote list: its title, when it last changed, and
	// whether the daemon is running it now.
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';

	let {
		title,
		detail,
		at,
		open,
		onOpen,
		archived = false,
		onRename,
		onArchive
	}: {
		title: string;
		detail?: string;
		at: number;
		open: boolean;
		onOpen: () => void;
		archived?: boolean;
		onRename?: () => void;
		onArchive?: () => void;
	} = $props();

</script>

<div class="row">
	<button class="main" onclick={onOpen}>
		<span class="title">{#if open}<span class="dot"></span>{/if}{title}</span>
		<span class="meta">{when(at)}{#if detail} · {detail}{/if}</span>
	</button>
	{#if onRename}
		<button class="mini" onclick={onRename} aria-label={t('shell.remote.rename')}><PencilSimpleIcon size={15} /></button>
	{/if}
	{#if onArchive}
		<button class="mini" onclick={onArchive} aria-label={archived ? t('shell.remote.unarchive') : t('shell.remote.archive')}>
			<ArchiveIcon size={15} weight={archived ? 'fill' : 'regular'} />
		</button>
	{/if}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		border-bottom: 1px solid var(--hairline);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 4px;
		border: none;
		background: none;
		color: var(--text);
		text-align: left;
	}
	.title {
		font-size: var(--fs-md);
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.mini {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: none;
		background: none;
		color: var(--dim);
	}
	.dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		margin: 0 6px 1px 0;
		border-radius: 50%;
		background: var(--ok);
	}
	.meta {
		font-size: var(--fs-xs);
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
