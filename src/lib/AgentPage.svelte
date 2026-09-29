<script lang="ts">
	// One long-lived agent: its settings, brief, memory and sessions.
	import { onMount } from 'svelte';
	import { X, Bot, Plus, LoaderCircle, FolderPlus } from 'lucide-svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { agentDirectory, type AgentChanges, type AgentDetail, type AgentView } from '$lib/agents.svelte';
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

	const MODES = ['manual', 'auto-edit', 'auto', 'full-access'];
	const sessions = $derived(
		[...(detail?.sessions ?? [])].sort((a, b) => b.created_at - a.created_at)
	);

	async function load() {
		try {
			detail = await agentDirectory.detail(agentId);
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
	onMount(load);

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

	function when(ms: number): string {
		return new Date(ms).toLocaleString();
	}
</script>

<Modal label={agentId} width={720} padded={false} {onClose}>
	<div class="sheet">
		<div class="head">
			<div>
				<h2><Bot size={18} /> {detail?.agent.name ?? agentId}</h2>
				<p><code>{agentId}</code>{#if detail} · <code>{detail.agent.cwd}</code>{/if}</p>
			</div>
			<IconButton onclick={onClose} label="close"><X size={18} /></IconButton>
		</div>

		<div class="body">
			{#if error}<div class="err"><Notice>{error}</Notice></div>{/if}
			{#if !detail}
				{#if !error}<div class="loading"><LoaderCircle size={18} class="spin" /></div>{/if}
			{:else}
				<section>
					<h3>{t('shell.agentPage.settings')}</h3>
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
						<Select
							value={detail.agent.approval_mode}
							options={MODES.map((m) => ({ value: m, label: m }))}
							onChange={(approval_mode) => change({ approval_mode })}
						/>
					</div>
				</section>

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
						<Button size="sm" onclick={addDirectory}><FolderPlus size={13} /> {t('shell.agentPage.addDirectory')}</Button>
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
								<X size={13} />
							</IconButton>
						</div>
					{/each}

					<div class="section-head sub">
						<span>{t('shell.agentPage.rules')}</span>
						<Button size="sm" onclick={() => (rules = [...rules, { prefix: '', action: 'ask' }])}>
							<Plus size={13} /> {t('shell.agentPage.addRule')}
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
								<X size={13} />
							</IconButton>
						</div>
					{/each}
				</section>

				<section>
					<div class="section-head">
						<h3>{t('shell.agentPage.sessions')}</h3>
						<Button size="sm" onclick={onNewSession}><Plus size={13} /> {t('shell.agentPage.newSession')}</Button>
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
					{#each Object.entries(detail.brief) as [file, text] (file)}
						<div class="file">
							<div class="file-name">{file}</div>
							<div class="file-text" class:none={!text.trim()}>
								{text.trim() || t('shell.agentPage.empty')}
							</div>
						</div>
					{/each}
				</section>

				<section>
					<h3>{t('shell.agentPage.memory')}</h3>
					{#if detail.memory.length === 0}
						<p class="empty">{t('shell.agentPage.noMemory')}</p>
					{:else}
						<div class="memory">
							{#each detail.memory as file (file)}<code>{file}</code>{/each}
						</div>
					{/if}
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
		font-family: var(--font-serif);
		font-size: var(--fs-xl);
		font-weight: 500;
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
	.memory code {
		padding: 2px 8px;
		border-radius: var(--r-sm);
		background: var(--surface2);
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
