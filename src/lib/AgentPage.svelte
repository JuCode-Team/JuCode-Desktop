<script lang="ts">
	// One long-lived agent: its settings, scheduled tasks, brief, memory and
	// sessions.
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
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import AgentSchedules from '$lib/AgentSchedules.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import TabChromePopover from '$lib/workbench/TabChromePopover.svelte';
	import { newAvatarSeed } from '$lib/avatar';
	import {
		agentDirectory,
		type AgentChanges,
		type AgentDetail,
		type AgentView,
		type TimerView
	} from '$lib/agents.svelte';
	import { t } from '$lib/i18n';

	let {
		agentId,
		onClose,
		onOpenSession,
		onNewSession
	}: {
		agentId: string;
		onClose: () => void;
		onOpenSession: (session: string) => void;
		onNewSession: () => void;
	} = $props();

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
		[...(detail?.sessions ?? [])].sort((a, b) => b.created_at - a.created_at)
	);

	let timers = $state<TimerView[]>([]);
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
		agentDirectory.timers(agentId).then((list) => (timers = list), () => {});
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
		return new Date(ms).toLocaleString();
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

	let messageText = $state('');
	let messageState = $state<'' | 'sending' | 'sent'>('');
	let messageError = $state('');
	async function sendMessage() {
		const body = messageText.trim();
		if (!body || messageState === 'sending') return;
		messageState = 'sending';
		messageError = '';
		try {
			await agentDirectory.message(agentId, body);
			messageText = '';
			messageState = 'sent';
		} catch (e) {
			messageError = e instanceof Error ? e.message : String(e);
			messageState = '';
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
			onClose();
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
		<div class="avatar-pick">
			<button class="avatar-btn" class:on={!agent.icon} onclick={() => change({ icon: null })}>
				<AgentAvatar agent={{ ...agent, icon: null }} size={22} />{t('shell.chrome.randomAvatar')}
			</button>
			<Button size="sm" onclick={() => change({ icon: null, avatar_seed: newAvatarSeed() })}>
				<ShuffleIcon size={12} />{t('shell.chrome.shuffle')}
			</Button>
		</div>
	</TabChromePopover>
{/if}

<Modal label={agentId} width={720} padded={false} {onClose}>
	<div class="sheet">
		<div class="head">
			<div>
				<h2>
					{#if detail}
						<button class="avatar-btn" onclick={openPicker} aria-label={t('shell.chrome.avatar')} title={t('shell.chrome.avatar')}>
							<AgentAvatar agent={detail.agent} size={28} />
						</button>
					{/if}
					{detail?.agent.name ?? agentId}
				</h2>
				<p><code>{agentId}</code>{#if detail} · <code>{detail.agent.cwd}</code>{/if}</p>
			</div>
			<IconButton onclick={onClose} label={t('common.close')}><XIcon size={18} /></IconButton>
		</div>

		<div class="body">
			{#if error}<div class="err"><Notice>{error}</Notice></div>{/if}
			{#if !detail}
				{#if !error}<div class="loading"><CircleNotchIcon size={18} class="spin" /></div>{/if}
			{:else}
				{#if !detail.agent.enabled}<div class="err"><Notice tone="warn">{t('shell.agentPage.stopped')}</Notice></div>{/if}
				<section>
					<h3>{t('shell.agentPage.settings')}</h3>
					<div class="row">
						<span>{t('shell.agentPage.name')}</span>
						<input class="name" value={detail.agent.name} onchange={rename} />
					</div>
					<div class="row">
						<span>{t('shell.agentPage.enabled')}</span>
						<Switch
							checked={detail.agent.enabled}
							label={t('shell.agentPage.enabled')}
							onChange={(enabled) => change({ enabled })}
						/>
					</div>
					<div class="row">
						<span>{t('shell.agentPage.approvalMode')}</span>
						<div class="pick">
							<Select
								value={detail.agent.approval_mode}
								options={MODES}
								onChange={(approval_mode) => change({ approval_mode })}
							/>
						</div>
					</div>
					<p class="hint">{MODES.find((m) => m.value === detail!.agent.approval_mode)?.desc ?? ''}</p>
				</section>

				<section>
					<h3>{t('shell.agentPage.message')}</h3>
					<p class="hint">{t('shell.agentPage.messageHint')}</p>
					<div class="item">
						<input
							class="grow msg"
							bind:value={messageText}
							placeholder={t('shell.agentPage.messagePlaceholder')}
							oninput={() => (messageState = '')}
							onkeydown={(e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), sendMessage())}
						/>
						<Button size="sm" disabled={!messageText.trim() || messageState === 'sending'} onclick={sendMessage}>
							{#if messageState === 'sending'}<CircleNotchIcon size={13} class="spin" />{:else}<PaperPlaneRightIcon size={13} />{/if}
							{messageState === 'sent' ? t('shell.agentPage.sent') : t('shell.agentPage.send')}
						</Button>
					</div>
					{#if messageError}<Notice>{messageError}</Notice>{/if}
				</section>

				<AgentSchedules {agentId} {onOpenSession} />

				{#if timers.length}
					<section>
						<h3>{t('shell.agentPage.timers')}</h3>
						{#each timers as timer (timer.timer)}
							<div class="timer">
								<span class="when">{when(timer.fire_at)}</span>
								<span class="timer-body">{timer.body}</span>
							</div>
						{/each}
					</section>
				{/if}

				<section>
					<h3>{t('shell.agentPage.sandbox')}</h3>
					<p class="hint">{t('shell.agentPage.sandboxHint')}</p>
					<div class="row">
						<span>{t('shell.agentPage.sandbox')}</span>
						<Select
							value={detail.agent.sandbox}
							options={SANDBOXES}
							onChange={(sandbox) => change({ sandbox: sandbox as AgentView['sandbox'] })}
						/>
					</div>
					<div class="row">
						<span>{t('shell.agentPage.network')}</span>
						<Switch
							checked={detail.agent.network}
							label={t('shell.agentPage.network')}
							onChange={(network) => change({ network })}
						/>
					</div>

					<div class="section-head sub">
						<span>{t('shell.agentPage.directories')}</span>
						<Button size="sm" onclick={addDirectory}><FolderPlusIcon size={13} /> {t('shell.agentPage.addDirectory')}</Button>
					</div>
					<p class="hint">{t('shell.agentPage.directoriesHint')}</p>
					{#each detail.agent.directories as dir, index (dir.path)}
						<div class="item">
							<code class="grow">{dir.path}</code>
							<Select
								value={dir.mode}
								options={DIR_MODES}
								onChange={(mode) =>
									change({
										directories: detail!.agent.directories.map((d, i) =>
											i === index ? { ...d, mode: mode as 'ro' | 'rw' } : d
										)
									})}
							/>
							<IconButton
								label={t('shell.agentPage.remove')}
								onclick={() =>
									change({ directories: detail!.agent.directories.filter((_, i) => i !== index) })}
							>
								<XIcon size={13} />
							</IconButton>
						</div>
					{/each}

					<div class="section-head sub">
						<span>{t('shell.agentPage.rules')}</span>
						<Button size="sm" onclick={() => (rules = [...rules, { prefix: '', action: 'ask' }])}>
							<PlusIcon size={13} /> {t('shell.agentPage.addRule')}
						</Button>
					</div>
					<p class="hint">{t('shell.agentPage.rulesHint')}</p>
					{#each rules as rule, index (index)}
						<div class="item">
							<input
								class="grow"
								bind:value={rule.prefix}
								placeholder={t('shell.agentPage.rulePrefix')}
								onchange={saveRules}
							/>
							<Select
								value={rule.action}
								options={ACTIONS}
								onChange={(action) => {
									rule.action = action as typeof rule.action;
									saveRules();
								}}
							/>
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
					{/each}
				</section>

				<section>
					<div class="section-head">
						<h3>{t('shell.agentPage.sessions')}</h3>
						<Button size="sm" disabled={!detail.agent.enabled} onclick={onNewSession}><PlusIcon size={13} /> {t('shell.agentPage.newSession')}</Button>
					</div>
					{#if sessions.length === 0}
						<p class="empty">{t('shell.agentPage.noSessions')}</p>
					{/if}
					{#each sessions as s (s.session)}
						<button class="session" onclick={() => onOpenSession(s.session)}>
							<code>{s.session}</code>
							<span class="when">{when(s.created_at)}</span>
							{#if s.open}<span class="open">{t('shell.agentPage.open')}</span>{/if}
						</button>
					{/each}
				</section>

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

				<section class="danger">
					<div class="row">
						<span class="col">
							{t('shell.agentPage.deleteAgent')}
							<small>{t('shell.agentPage.deleteHint')}</small>
						</span>
						<Button size="sm" variant="danger" onclick={deleteAgent}>
							<TrashIcon size={13} /> {t('shell.agentPage.deleteAgent')}
						</Button>
					</div>
					{#if deleteError}<Notice>{deleteError}</Notice>{/if}
				</section>
			{/if}
		</div>
	</div>
</Modal>

<style>
	/* Fixed height so the sheet doesn't resize as the detail loads. */
	.sheet {
		height: min(720px, 84vh);
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 18px 20px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.avatar-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.avatar-btn:hover,
	.avatar-btn.on {
		background: var(--surface2);
	}
	.avatar-pick {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		font-size: var(--fs-sm);
	}
	.avatar-pick .avatar-btn {
		padding: 3px 8px 3px 3px;
	}
	.head p {
		margin: 4px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 4px 20px 20px;
	}
	section {
		margin-top: 16px;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
	.section-head.sub {
		margin-top: 12px;
		font-size: var(--fs-sm);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
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
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 0;
		font-size: var(--fs-sm);
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.session {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.session:hover {
		background: var(--surface);
	}
	.when {
		flex: 1;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.open {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--accent-bright);
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
	.item input.msg {
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
	}
	input.name:focus,
	.item input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.timer {
		display: flex;
		gap: 10px;
		padding: 4px 0;
		font-size: var(--fs-sm);
	}
	.timer .when {
		flex: none;
	}
	.timer-body {
		flex: 1;
		min-width: 0;
		color: var(--text);
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.col small {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.danger {
		margin-top: 24px;
		padding-top: 12px;
		border-top: 1px solid var(--hairline);
	}
	.err {
		margin-top: 12px;
	}
	.loading {
		display: flex;
		justify-content: center;
		padding: 40px;
		color: var(--dim);
	}
</style>
