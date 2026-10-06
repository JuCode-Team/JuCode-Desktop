<script lang="ts">
	// One long-lived agent on the workbench: who it is and whether it is
	// working, a box to give it a task, and tabs for its tasks (one per
	// session), brief and memory, and settings (scheduled tasks have their
	// own page).
	import { onMount } from 'svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import ShuffleIcon from 'phosphor-svelte/lib/ShuffleIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import PaperPlaneRightIcon from 'phosphor-svelte/lib/PaperPlaneRightIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import { open } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import AgentActivity from '$lib/AgentActivity.svelte';
	import SettingsSection from '$lib/settings/SettingsSection.svelte';
	import SettingsRow from '$lib/settings/SettingsRow.svelte';
	import TabChromePopover from '$lib/workbench/TabChromePopover.svelte';
	import { newAvatarSeed } from '$lib/avatar';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import {
		agentDirectory,
		agentWorkspace,
		type AgentChanges,
		type AgentDetail,
		type AgentView
	} from '$lib/agents.svelte';
	import { t } from '$lib/i18n';

	let {
		agentId,
		projects = [],
		onDeleted,
		onOpenSession,
		onOpenAgent,
		onNewSession
	}: {
		agentId: string;
		/** The open workspace's projects, for 所属项目. */
		projects?: { id: string; name: string }[];
		onDeleted: () => void;
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
		onNewSession: () => void;
	} = $props();

	type Tab = 'activity' | 'brief' | 'settings';
	let tab = $state<Tab>('activity');
	/** The broadcast copy: live name, status and running sessions. */
	const live = $derived(agentDirectory.agents.find((a) => a.id === agentId));

	let detail = $state<AgentDetail | null>(null);
	let error = $state('');

	// The agent's modes under the labels the composer uses for the same ones.
	const MODES = $derived(
		(
			[
				['manual', 'Ask'],
				['auto-edit', 'Edits'],
				['auto', 'Auto'],
				['full-access', 'All']
			] as const
		).map(([value, key]) => ({
			value,
			label: t(`chat.approval${key}`),
			desc: t(`chat.approval${key}Desc`)
		}))
	);
	const sessions = $derived(
		agentDirectory.sessions
			.filter((s) => s.agent === agentId)
			.sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at))
	);
	/** Sessions running right now. */
	const working = $derived(sessions.filter((s) => live?.running?.includes(s.session)));
	const nextRun = $derived(
		agentDirectory.schedules
			.filter((s) => s.agent === agentId && s.enabled && s.next_run_at)
			.map((s) => ({ at: s.next_run_at! * 1000, name: s.name }))
			.sort((a, b) => a.at - b.at)[0]
	);
	const lastActive = $derived(sessions[0] ? (sessions[0].updated_at ?? sessions[0].created_at) : 0);
	const pending = $derived(agentDirectory.pendingFor(agentId));

	async function load() {
		try {
			detail = await agentDirectory.detail(agentId);
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
	onMount(() => {
		void load();
	});

	async function change(changes: AgentChanges) {
		if (!detail) return;
		try {
			detail.agent = await agentDirectory.update(agentId, changes);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			await load();
		}
	}

	const SANDBOXES = $derived([
		{ value: 'read-only', label: t('shell.agentPage.sandboxReadOnly') },
		{ value: 'workspace-write', label: t('shell.agentPage.sandboxWorkspace') },
		{ value: 'full-access', label: t('shell.agentPage.sandboxFull') }
	]);
	const DIR_MODES = $derived([
		{ value: 'ro', label: t('shell.agentPage.readOnly') },
		{ value: 'rw', label: t('shell.agentPage.readWrite') }
	]);
	const ACTIONS = $derived([
		{ value: 'allow', label: t('shell.agentPage.allow') },
		{ value: 'ask', label: t('shell.agentPage.ask') },
		{ value: 'forbid', label: t('shell.agentPage.forbid') }
	]);

	// Rules are edited locally and saved when a complete one changes, so a
	// half-typed prefix is never sent.
	let rules = $state<AgentView['command_rules']>([]);
	$effect(() => {
		if (detail) rules = detail.agent.command_rules.map((rule) => ({ ...rule }));
	});
	function saveRules() {
		const complete = rules.filter((rule) => rule.prefix.trim());
		void change({ command_rules: complete.map((r) => ({ prefix: r.prefix.trim(), action: r.action })) });
	}

	async function addDirectory() {
		if (!detail) return;
		const path = await open({ directory: true, title: t('shell.agentPage.addDirectory') });
		if (!path || Array.isArray(path)) return;
		await change({ directories: [...detail.agent.directories, { path, mode: 'ro' }] });
	}

	// Clicking the avatar opens the icon picker; with no icon the generated
	// avatar shows, and 「换一个」 gives it a new seed.
	let picker = $state<{ x: number; y: number } | null>(null);
	function openPicker(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		picker = { x: r.left, y: r.bottom + 6 };
	}

	function when(ms: number): string {
		return new Date(ms).toLocaleString(undefined, {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function rename(e: Event & { currentTarget: HTMLInputElement }) {
		const name = e.currentTarget.value.trim();
		if (name && name !== detail?.agent.name) void change({ name });
		else e.currentTarget.value = detail?.agent.name ?? '';
	}

	// role.md is the user's to edit; the other brief files are the agent's.
	let role = $state<string | null>(null);
	async function saveRole() {
		if (!detail || role === null) return;
		const text = role.trim();
		error = '';
		await change({ role: text });
		if (!error) {
			detail.brief['role.md'] = text;
			role = null;
		}
	}

	let memoryOpen = $state('');
	/** null while it loads. */
	let memoryText = $state<string | null>(null);
	async function showMemory(file: string) {
		if (memoryOpen === file) return void (memoryOpen = '');
		memoryOpen = file;
		memoryText = null;
		try {
			memoryText = await agentDirectory.readMemory(agentId, file);
		} catch (e) {
			memoryText = e instanceof Error ? e.message : String(e);
		}
	}

	// A task starts a new session; while the agent is working, what is typed
	// goes to that work instead unless the user detaches it. The activity tab
	// shows it arrive.
	let taskText = $state('');
	let detached = $state(false);
	const followUp = $derived(detached ? undefined : working[0]);
	let sending = $state(false);
	let taskError = $state('');
	async function assign() {
		const body = taskText.trim();
		if (!body || sending) return;
		sending = true;
		taskError = '';
		try {
			await agentDirectory.message(agentId, body, followUp?.session);
			taskText = '';
			detached = false;
			tab = 'activity';
		} catch (e) {
			taskError = e instanceof Error ? e.message : String(e);
		} finally {
			sending = false;
		}
	}

	let deleteError = $state('');
	async function deleteAgent() {
		const ok = await confirm({
			title: t('shell.agentPage.deleteTitle', { name: detail?.agent.name ?? agentId }),
			message: t('shell.agentPage.deleteHint'),
			confirmLabel: t('shell.agentPage.deleteAgent'),
			danger: true
		});
		if (!ok) return;
		try {
			await agentDirectory.remove(agentId);
			onDeleted();
		} catch (e) {
			deleteError = e instanceof Error ? e.message : String(e);
		}
	}
</script>

{#if picker && detail}
	{@const agent = detail.agent}
	<TabChromePopover
		x={picker.x}
		y={picker.y}
		name={agent.name}
		color={agent.color ?? null}
		icon={agent.icon ?? null}
		onColor={(color) => change({ color })}
		onIcon={(icon) => change({ icon })}
		onClose={() => (picker = null)}
	>
		{#snippet defaultIcon()}<AgentAvatar agent={{ ...agent, icon: null }} size={16} />{/snippet}
		<div class="avatar-pick">
			<Button size="sm" onclick={() => change({ icon: null, avatar_seed: newAvatarSeed() })}>
				<ShuffleIcon size={12} />{t('shell.chrome.shuffle')}
			</Button>
		</div>
	</TabChromePopover>
{/if}

<div class="page">
	{#if error}<div class="err"><Notice>{error}</Notice></div>{/if}
	{#if !detail}
		{#if !error}<div class="loading"><CircleNotchIcon size={18} class="spin" /></div>{/if}
	{:else}
		{@const agent = live ?? detail.agent}
		<header class="head">
			<button class="avatar-btn" onclick={openPicker} aria-label={t('shell.chrome.avatar')} title={t('shell.chrome.avatar')}>
				<AgentAvatar {agent} size={44} />
			</button>
			<div class="ident">
				<h1>{agent.name}</h1>
				{#if live?.summary}<p class="summary">{live.summary}</p>{/if}
				<p class="facts">
					{#if !agent.enabled}
						<span class="state">{t('shell.desk.statusOff')}</span>
					{:else if working.length}
						<span class="state live"><CircleNotchIcon size={13} class="spin" />{t('shell.desk.statusWorking')}</span>
						{#each working as s (s.session)}
							<button class="fact-link" onclick={() => onOpenSession(s.session)}>{s.title || t('shell.agentPage.untitled')}</button>
						{/each}
					{:else}
						<span class="state">{t('shell.desk.statusIdle')}</span>
					{/if}
					{#if agent.enabled && nextRun}
						<span class="fact">{t('shell.agentPage.nextRun', { time: when(nextRun.at), name: nextRun.name })}</span>
					{/if}
					{#if lastActive}<span class="fact">{t('shell.agentPage.lastActive', { time: when(lastActive) })}</span>{/if}
				</p>
				<p class="where"><code>{agent.cwd}</code></p>
			</div>
			<label class="enable">
				<span>{t('shell.agentPage.enabled')}</span>
				<Switch checked={agent.enabled} label={t('shell.agentPage.enabled')} onChange={(enabled) => change({ enabled })} />
			</label>
		</header>

		{#if !agent.enabled}
			<div class="err"><Notice tone="warn">{t('shell.agentPage.stopped')}</Notice></div>
		{:else}
			<div class="task">
				{#if followUp}
					<div class="follow">
						<span>{t('shell.agentPage.followUp', { title: followUp.title || t('shell.agentPage.untitled') })}</span>
						<button onclick={() => (detached = true)} title={t('shell.agentPage.followUpDetach')} aria-label={t('shell.agentPage.followUpDetach')}>
							<XIcon size={12} />
						</button>
					</div>
				{/if}
				<textarea
					rows="3"
					bind:value={taskText}
					placeholder={followUp ? t('shell.agentPage.followUpPlaceholder') : t('shell.agentPage.taskPlaceholder')}
					onkeydown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && (e.preventDefault(), assign())}
				></textarea>
				<div class="task-foot">
					<span class="hint-inline">{followUp ? '' : t('shell.agentPage.taskNewHint')}</span>
					<span class="grow"></span>
					<Button variant="primary" size="sm" disabled={!taskText.trim() || sending} onclick={assign}>
						{#if sending}<CircleNotchIcon size={13} class="spin" />{:else}<PaperPlaneRightIcon size={13} />{/if}
						{t('shell.agentPage.taskSend')}
					</Button>
				</div>
				{#if taskError}<Notice>{taskError}</Notice>{/if}
			</div>
		{/if}

		<div class="tabs" role="tablist">
			{#each [['activity', t('shell.agentPage.tabActivity'), pending], ['brief', t('shell.agentPage.tabBrief'), 0], ['settings', t('shell.agentPage.tabSettings'), 0]] as const as [key, label, count] (key)}
				<button role="tab" class:on={tab === key} aria-selected={tab === key} onclick={() => (tab = key)}>
					{label}{#if count}<span class="count" class:alert={key === 'activity'}>{count}</span>{/if}
				</button>
			{/each}
		</div>

		<div class="tab-body">
			{#if tab === 'activity'}
				<AgentActivity {agent} {onOpenSession} {onOpenAgent} {onNewSession} />
			{:else if tab === 'brief'}
				<section>
					<h3>{t('shell.agentPage.brief')}</h3>
					<p class="hint">{t('shell.agentPage.roleHint')}</p>
					{#each Object.entries(detail.brief) as [file, text] (file)}
						<div class="file">
							<div class="file-name">
								{file}
								{#if file === 'role.md' && role === null}
									<button class="link" onclick={() => (role = text)}>{t('shell.agentPage.edit')}</button>
								{/if}
							</div>
							{#if file === 'role.md' && role !== null}
								<textarea class="file-text" rows="6" bind:value={role}></textarea>
								<div class="file-actions">
									<Button size="sm" onclick={() => (role = null)}>{t('common.cancel')}</Button>
									<Button size="sm" variant="primary" disabled={!role.trim()} onclick={saveRole}>
										{t('shell.agentPage.save')}
									</Button>
								</div>
							{:else}
								<div class="file-text" class:none={!text.trim()}>
									{text.trim() || t('shell.agentPage.empty')}
								</div>
							{/if}
						</div>
					{/each}
				</section>

				<section>
					<h3>{t('shell.agentPage.memory')}</h3>
					{#if detail.memory.length === 0}
						<p class="empty">{t('shell.agentPage.noMemory')}</p>
					{:else}
						<p class="hint">{t('shell.agentPage.memoryHint')}</p>
						<div class="memory">
							{#each detail.memory as file (file)}
								<button class:on={memoryOpen === file} onclick={() => showMemory(file)}>{file}</button>
							{/each}
						</div>
						{#if memoryOpen}
							<div class="file-text memory-text">
								{#if memoryText === null}<CircleNotchIcon size={14} class="spin" />{:else}{memoryText.trim() || t('shell.agentPage.empty')}{/if}
							</div>
						{/if}
					{/if}
				</section>
			{:else}
				<SettingsSection>
					<SettingsRow title={t('shell.agentPage.name')}>
						<input class="name" value={detail.agent.name} onchange={rename} />
					</SettingsRow>
					<SettingsRow title={t('shell.agentPage.workspace')} description={t('shell.agentPage.workspaceHint')}>
						<div class="pick">
							<Select
								value={agentWorkspace(detail.agent, workspaces.workspaces)}
								options={workspaces.workspaces.map((w) => ({ value: w.id, label: w.name }))}
								onChange={(workspace) => change({ workspace })}
							/>
						</div>
					</SettingsRow>
					<SettingsRow title={t('shell.agentPage.project')} description={t('shell.agentPage.projectHint')}>
						<div class="pick">
							<Select
								value={detail.agent.project ?? ''}
								options={[
									{ value: '', label: t('shell.agents.noProject') },
									...projects.map((p) => ({ value: p.id, label: p.name })),
									...(detail.agent.project && !projects.some((p) => p.id === detail!.agent.project)
										? [{ value: detail.agent.project, label: detail.agent.project }]
										: [])
								]}
								onChange={(project) => change({ project: project || null })}
							/>
						</div>
					</SettingsRow>
					<SettingsRow
						title={t('shell.agentPage.approvalMode')}
						description={MODES.find((m) => m.value === detail!.agent.approval_mode)?.desc ?? ''}
					>
						<div class="pick">
							<Select value={detail.agent.approval_mode} options={MODES} onChange={(approval_mode) => change({ approval_mode })} />
						</div>
					</SettingsRow>
					<SettingsRow title={t('shell.agentPage.sandbox')} description={t('shell.agentPage.sandboxHint')}>
						<div class="pick">
							<Select
								value={detail.agent.sandbox}
								options={SANDBOXES}
								onChange={(sandbox) => change({ sandbox: sandbox as AgentView['sandbox'] })}
							/>
						</div>
					</SettingsRow>
					<SettingsRow title={t('shell.agentPage.network')}>
						<Switch checked={detail.agent.network} label={t('shell.agentPage.network')} onChange={(network) => change({ network })} />
					</SettingsRow>
				</SettingsSection>

				<SettingsSection title={t('shell.agentPage.directories')} description={t('shell.agentPage.directoriesHint')}>
					{#snippet action()}
						<Button size="sm" onclick={addDirectory}><FolderPlusIcon size={13} /> {t('shell.agentPage.addDirectory')}</Button>
					{/snippet}
					{#each detail.agent.directories as dir, index (dir.path)}
						<div class="item">
							<code class="grow" title={dir.path}>{dir.path}</code>
							<div class="pick sm">
								<Select
									value={dir.mode}
									options={DIR_MODES}
									onChange={(mode) =>
										change({
											directories: detail!.agent.directories.map((d, i) => (i === index ? { ...d, mode: mode as 'ro' | 'rw' } : d))
										})}
								/>
							</div>
							<IconButton
								label={t('shell.agentPage.remove')}
								onclick={() => change({ directories: detail!.agent.directories.filter((_, i) => i !== index) })}
							>
								<XIcon size={13} />
							</IconButton>
						</div>
					{:else}
						<p class="none">{t('shell.agentPage.noDirectories')}</p>
					{/each}
				</SettingsSection>

				<SettingsSection title={t('shell.agentPage.rules')} description={t('shell.agentPage.rulesHint')}>
					{#snippet action()}
						<Button size="sm" onclick={() => (rules = [...rules, { prefix: '', action: 'ask' }])}>
							<PlusIcon size={13} /> {t('shell.agentPage.addRule')}
						</Button>
					{/snippet}
					{#each rules as rule, index (index)}
						<div class="item">
							<input class="grow" bind:value={rule.prefix} placeholder={t('shell.agentPage.rulePrefix')} onchange={saveRules} />
							<div class="pick sm">
								<Select
									value={rule.action}
									options={ACTIONS}
									onChange={(action) => {
										rule.action = action as typeof rule.action;
										saveRules();
									}}
								/>
							</div>
							<IconButton
								label={t('shell.agentPage.remove')}
								onclick={() => {
									rules = rules.filter((_, i) => i !== index);
									saveRules();
								}}
							>
								<XIcon size={13} />
							</IconButton>
						</div>
					{:else}
						<p class="none">{t('shell.agentPage.noRules')}</p>
					{/each}
				</SettingsSection>

				<SettingsSection>
					<SettingsRow title={t('shell.agentPage.deleteAgent')} description={t('shell.agentPage.deleteHint')}>
						<Button size="sm" variant="danger" onclick={deleteAgent}>
							<TrashIcon size={13} /> {t('shell.agentPage.deleteAgent')}
						</Button>
					</SettingsRow>
				</SettingsSection>
				{#if deleteError}<div class="err"><Notice>{deleteError}</Notice></div>{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}
	.ident {
		flex: 1;
		min-width: 0;
	}
	h1 {
		margin: 2px 0 0;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
	}
	.summary {
		margin: 8px 0 0;
		font-size: var(--fs-sm);
		line-height: 1.55;
		color: var(--dim);
	}
	.where {
		margin: 6px 0 0;
		color: var(--dim2);
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 14px;
		margin: 10px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.fact-link {
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.fact-link:hover {
		text-decoration: underline;
	}
	.enable {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-top: 8px;
		font-size: var(--fs-xs);
		color: var(--dim);
		cursor: pointer;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
	}
	.state.live {
		color: var(--accent-bright);
	}
	.avatar-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.avatar-btn:hover {
		background: var(--surface2);
	}
	.avatar-pick {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		font-size: var(--fs-sm);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}

	/* The task box: the one place on the page that asks for input. */
	.task {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 24px;
		padding: 12px 12px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--surface);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.task:focus-within {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.task textarea {
		border: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-md);
		line-height: 1.55;
		padding: 2px 4px;
		outline: none;
		resize: none;
	}
	.task textarea::placeholder {
		color: var(--dim2);
	}
	.follow {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: 4px;
		max-width: 100%;
		padding: 2px 4px 2px 10px;
		border-radius: var(--r-full);
		background: var(--accent-soft);
		color: var(--text);
		font-size: var(--fs-xs);
	}
	.follow span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.follow button {
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.follow button:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.hint-inline {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.task-foot {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.grow {
		flex: 1;
	}

	.tabs {
		display: flex;
		gap: 22px;
		margin-top: 28px;
		border-bottom: 1px solid var(--hairline);
	}
	.tabs button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: -1px;
		padding: 0 0 10px;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.tabs button:hover {
		color: var(--text);
	}
	.tabs button.on {
		color: var(--text);
		border-bottom-color: var(--text);
	}
	.count {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
	}
	.count.alert {
		background: var(--accent);
		color: var(--on-accent);
	}
	.tab-body {
		padding-top: 6px;
	}
	section {
		margin-top: 16px;
	}
	h3 {
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
	}
	.hint {
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		line-height: 1.5;
	}
	/* A list row inside a SettingsSection card, padded like a SettingsRow. */
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px 10px 18px;
	}
	.none {
		margin: 0;
		padding: 16px 18px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.item .grow {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item input {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		padding: 6px 9px;
		outline: none;
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.file {
		margin-bottom: 10px;
	}
	.file-name {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		margin-bottom: 4px;
	}
	.file-text {
		padding: 9px 11px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--fs-sm);
		line-height: 1.55;
		white-space: pre-wrap;
		color: var(--text);
	}
	.file-text.none {
		color: var(--dim2);
	}
	.memory {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.memory button {
		padding: 2px 8px;
		border: 1px solid transparent;
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.memory button:hover,
	.memory button.on {
		border-color: var(--border);
	}
	.memory-text {
		margin-top: 8px;
		max-height: 260px;
		overflow-y: auto;
	}
	textarea.file-text {
		width: 100%;
		box-sizing: border-box;
		font-family: var(--font-sans);
		outline: none;
		resize: vertical;
	}
	textarea.file-text:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.file-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 6px;
	}
	.link {
		margin-left: 8px;
		padding: 0;
		border: none;
		background: none;
		color: var(--accent-bright);
		font: inherit;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.pick {
		width: 180px;
	}
	.pick.sm {
		flex: none;
		width: 120px;
	}
	input.name {
		width: 180px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-sm);
		padding: 6px 9px;
		outline: none;
	}
	input.name:focus,
	.item input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.err {
		margin-bottom: 16px;
	}
	.loading {
		display: flex;
		justify-content: center;
		padding: 40px;
		color: var(--dim);
	}
</style>
