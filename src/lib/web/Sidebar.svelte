<script lang="ts">
	// The web app's left column: a new chat, the remote computers, the
	// conversations by date (searchable, each renamed or deleted from its
	// menu), and the account at the bottom.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import DesktopTowerIcon from 'phosphor-svelte/lib/DesktopTowerIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { setTheme, themeState } from '$lib/theme.svelte';
	import { API, auth } from './auth.svelte';
	import { chat, type ConversationInfo } from './chat.svelte';
	import { shell } from './shell.svelte';

	let query = $state('');
	let menuFor = $state<string | null>(null);
	let accountMenu = $state(false);
	let renaming = $state<string | null>(null);
	let renameText = $state('');

	const activeId = $derived(page.params.id ?? null);

	// Conversations by how long ago they changed, newest first.
	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = q ? chat.conversations.filter((c) => (c.title || t('web.chat.untitled')).toLowerCase().includes(q)) : chat.conversations;
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		const day = 86_400_000;
		const bounds: [string, number][] = [
			['today', start.getTime()],
			['yesterday', start.getTime() - day],
			['week', start.getTime() - 7 * day],
			['month', start.getTime() - 30 * day],
			['older', -Infinity]
		];
		const out = new Map<string, ConversationInfo[]>();
		for (const c of rows) {
			const at = Date.parse(c.updatedAt);
			const key = bounds.find(([, from]) => at >= from)![0];
			out.set(key, [...(out.get(key) ?? []), c]);
		}
		return bounds.map(([key]) => ({ key, rows: out.get(key) ?? [] })).filter((g) => g.rows.length);
	});

	function newChat() {
		chat.fresh();
		void goto('/chat');
	}

	function startRename(c: ConversationInfo) {
		menuFor = null;
		renaming = c.id;
		renameText = c.title;
	}
	async function finishRename(id: string) {
		const title = renameText.trim();
		renaming = null;
		if (!title) return;
		try {
			await chat.rename(id, title);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}
	async function remove(c: ConversationInfo) {
		menuFor = null;
		const ok = await confirm({
			title: t('web.side.deleteTitle'),
			message: t('web.side.deleteBody', { title: c.title || t('web.chat.untitled') }),
			confirmLabel: t('web.side.delete'),
			danger: true
		});
		if (!ok) return;
		try {
			await chat.remove(c.id);
			if (activeId === c.id) void goto('/chat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	const money = (v: string | number | undefined, currency = 'CNY') => {
		const n = Number(v ?? 0);
		const symbol = currency === 'USD' ? '$' : '¥';
		return `${symbol}${Number.isFinite(n) ? n.toFixed(2) : '—'}`;
	};
	const account = $derived(auth.account);
	const initial = $derived((account?.nickname || account?.email || '?').slice(0, 1).toUpperCase());

	function accountPick(key: string) {
		accountMenu = false;
		if (key === 'light' || key === 'dark' || key === 'system') setTheme(key);
		else if (key === 'console') window.open(`${API}/me`, '_blank', 'noopener');
		else if (key === 'signout') void auth.signOut();
	}
</script>

<nav class="sidebar" aria-label={t('web.brand')}>
	<div class="top">
		<a class="brand" href="/chat" onclick={(e) => (e.preventDefault(), newChat())}>{t('web.brand')}</a>
		<span class="grow"></span>
		<button class="icon" onclick={() => shell.toggle()} title={t('web.side.collapse')} aria-label={t('web.side.collapse')}><SidebarSimpleIcon size={18} /></button>
	</div>

	<div class="actions">
		<button class="row strong" onclick={newChat}><NotePencilIcon size={17} /><span>{t('web.side.newChat')}</span></button>
		<a class="row" href="/remote" title={t('web.side.remoteHint')}><DesktopIcon size={17} /><span>{t('web.side.remote')}</span></a>
		<label class="search">
			<MagnifyingGlassIcon size={15} />
			<input type="search" bind:value={query} placeholder={t('web.side.search')} aria-label={t('web.side.search')} />
		</label>
	</div>

	<div class="list">
		{#each groups as g (g.key)}
			<div class="group">{t(`web.side.${g.key}`)}</div>
			{#each g.rows as c (c.id)}
				<div class="conv" class:on={c.id === activeId} class:menu={menuFor === c.id}>
					{#if renaming === c.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="rename"
							bind:value={renameText}
							autofocus
							onkeydown={(e) => {
								if (e.key === 'Enter') void finishRename(c.id);
								else if (e.key === 'Escape') renaming = null;
							}}
							onblur={() => void finishRename(c.id)}
						/>
					{:else}
						<a class="title" href="/c/{c.id}" title={c.title}>{c.title || t('web.chat.untitled')}</a>
						<span class="more-anchor">
							<button class="more" onclick={() => (menuFor = menuFor === c.id ? null : c.id)} aria-label={t('web.side.rename')}><DotsThreeIcon size={16} weight="bold" /></button>
							{#if menuFor === c.id}
								<PopMenu
									placement="down-right"
									items={[
										{ key: 'rename', label: t('web.side.rename'), icon: PencilSimpleIcon },
										{ key: 'delete', label: t('web.side.delete'), icon: TrashIcon, tone: 'warn' }
									]}
									onSelect={(k) => (k === 'rename' ? startRename(c) : remove(c))}
									onClose={() => (menuFor = null)}
								/>
							{/if}
						</span>
					{/if}
				</div>
			{/each}
		{:else}
			{#if chat.listLoaded}<p class="empty">{query ? t('web.side.noMatch') : t('web.side.empty')}</p>{/if}
		{/each}
		{#if chat.hasMore && !query}
			<button class="loadmore" onclick={() => chat.loadList(true)}>{t('web.side.more')}</button>
		{/if}
	</div>

	<div class="foot">
		<span class="acct-anchor">
			<button class="acct" onclick={() => (accountMenu = !accountMenu)} aria-haspopup="menu" aria-expanded={accountMenu}>
				<span class="avatar">{initial}</span>
				<span class="who">
					<span class="email">{account?.nickname || account?.email || ''}</span>
					{#if account}<span class="bal">{t('web.account.balance')} {money(account.balance, account.currency)}{#if account.active_plan?.name} · {account.active_plan.name}{/if}</span>{/if}
				</span>
			</button>
			{#if accountMenu}
				<PopMenu
					placement="up-left"
					title={t('web.account.theme')}
					items={[
						{ key: 'light', label: t('web.account.themeLight'), icon: SunIcon, checked: themeState.pref === 'light' },
						{ key: 'dark', label: t('web.account.themeDark'), icon: MoonIcon, checked: themeState.pref === 'dark' },
						{ key: 'system', label: t('web.account.themeSystem'), icon: DesktopTowerIcon, checked: themeState.pref === 'system' },
						{ key: 'console', label: t('web.account.console'), icon: ArrowSquareOutIcon },
						{ key: 'signout', label: t('web.account.signOut'), icon: SignOutIcon }
					]}
					onSelect={accountPick}
					onClose={() => (accountMenu = false)}
				/>
			{/if}
		</span>
	</div>
</nav>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		width: 264px;
		max-width: 100%;
		height: 100%;
		color: var(--text);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 12px 10px 6px 16px;
	}
	.brand {
		font-size: var(--fs-md);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		text-decoration: none;
	}
	.grow {
		flex: 1;
	}
	.icon {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 8px 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 36px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		text-decoration: none;
		cursor: pointer;
	}
	.row :global(svg) {
		flex: none;
		color: var(--dim);
	}
	.row:hover {
		background: var(--surface2);
	}
	.row.strong {
		font-weight: 500;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		margin-top: 4px;
		padding: 0 10px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 8px 12px;
	}
	.group {
		padding: 14px 10px 6px;
		font-size: var(--fs-2xs);
		font-weight: 500;
		color: var(--dim2);
	}
	.conv {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--r-md);
	}
	.conv:hover,
	.conv.menu {
		background: var(--surface2);
	}
	.conv.on {
		background: var(--surface2);
		font-weight: 500;
	}
	.title {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-size: var(--fs-sm);
		text-decoration: none;
	}
	.more-anchor {
		position: relative;
		display: inline-flex;
	}
	.more {
		display: inline-flex;
		margin-right: 4px;
		padding: 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		opacity: 0;
		cursor: pointer;
	}
	.conv:hover .more,
	.conv.menu .more,
	.conv.on .more,
	.more:focus-visible {
		opacity: 1;
	}
	.more:hover {
		color: var(--text);
	}
	@media (hover: none) {
		.more {
			opacity: 1;
		}
	}
	.rename {
		flex: 1;
		min-width: 0;
		margin: 3px;
		padding: 5px 7px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		outline: none;
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
	}
	.empty {
		margin: 16px 10px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.loadmore {
		display: block;
		width: 100%;
		margin-top: 8px;
		padding: 8px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.loadmore:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.foot {
		padding: 8px;
		border-top: 1px solid var(--hairline);
	}
	.acct-anchor {
		position: relative;
		display: block;
	}
	.acct {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.acct:hover {
		background: var(--surface2);
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: var(--r-full);
		background: var(--surface2);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.email,
	.bal {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.email {
		font-size: var(--fs-sm);
	}
	.bal {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.row:focus-visible,
	.icon:focus-visible,
	.acct:focus-visible,
	.title:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
</style>
