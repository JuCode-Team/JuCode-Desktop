<script lang="ts">
	// Settings → 导入: one scan over the other coding agents on this machine
	// (Claude Code, Codex, opencode, zcode, omp), a checklist of what they
	// have, and one button that brings the picked items over. Conversations
	// and skills are imported on the Rust side (agent_import); MCP servers go
	// to the daemon with `mcp_set`, the way Settings → MCP adds one.
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import {
		changeMcpServers,
		importApply,
		importScan,
		readConfig,
		type ImportMcp,
		type ImportScan,
		type ImportSession,
		type ImportSkill,
		type ImportSource
	} from '$lib/protocol';
	import { parseConfigServers } from '$lib/mcp';
	import {
		SOURCE_LABELS,
		byProject,
		bySource,
		defaultPicks,
		folderName,
		importedFolders,
		mcpKey,
		planMcp,
		sessionKey,
		skillKey,
		summarize,
		type McpResult,
		type RunSummary
	} from '$lib/agentImport';
	import Button from '$lib/ui/Button.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let { onAddFolders }: { onAddFolders?: (paths: string[]) => number } = $props();

	let found = $state<ImportScan | null>(null);
	let scanning = $state(false);
	let scanError = $state('');
	let picks = $state<Record<string, boolean>>({});
	/** Expanded tool groups, by `<kind>:<source>`. */
	let open = $state<Record<string, boolean>>({});
	let running = $state(false);
	let runError = $state('');
	let summary = $state<RunSummary | null>(null);
	let folders = $state<string[]>([]);
	let foldersAdded = $state(false);

	const sessionGroups = $derived(found ? bySource(found.sessions) : []);
	const skillGroups = $derived(found ? bySource(found.skills) : []);
	const mcpGroups = $derived(found ? bySource(found.mcp) : []);
	const empty = $derived(!!found && !found.sessions.length && !found.skills.length && !found.mcp.length);

	// Skills and servers JuCode already has cannot be picked.
	const sessionKeys = (list: ImportSession[]) => list.map(sessionKey);
	const skillKeys = (list: ImportSkill[]) => list.filter((s) => !s.present).map(skillKey);
	const mcpKeys = (list: ImportMcp[]) => list.filter((m) => !m.present).map(mcpKey);

	const count = (keys: string[]) => keys.filter((k) => picks[k]).length;
	const allOn = (keys: string[]) => keys.length > 0 && keys.every((k) => picks[k]);
	function setAll(keys: string[], on: boolean) {
		for (const k of keys) picks[k] = on;
	}

	const pickedTotal = $derived(
		found
			? count(sessionKeys(found.sessions)) + count(skillKeys(found.skills)) + count(mcpKeys(found.mcp))
			: 0
	);

	async function scan(keepResult = false) {
		scanning = true;
		scanError = '';
		if (!keepResult) summary = null;
		try {
			found = await importScan();
			picks = defaultPicks(found);
		} catch (e) {
			scanError = t('settings.import.scanFailed', { msg: String(e) });
		} finally {
			scanning = false;
		}
	}

	/** Adds the picked servers JuCode has no server of that name for. */
	async function addServers(picked: ImportMcp[]): Promise<McpResult[]> {
		if (!picked.length) return [];
		const configured = parseConfigServers(await readConfig().catch(() => ({}))).map((e) => e.name);
		const plan = planMcp(picked, configured);
		const results: McpResult[] = plan.skip.map((server) => ({ server, status: 'existing' }));
		for (const server of plan.add) {
			try {
				await changeMcpServers({ op: 'mcp_set', server: server.entry });
				results.push({ server, status: 'imported' });
			} catch (e) {
				results.push({ server, status: 'failed', error: String(e) });
			}
		}
		return results;
	}

	async function run() {
		if (!found || running) return;
		const scanned = found;
		running = true;
		runError = '';
		summary = null;
		foldersAdded = false;
		try {
			const sessions = scanned.sessions
				.filter((s) => picks[sessionKey(s)])
				.map((s) => ({ source: s.source, id: s.id, cwd: s.cwd }));
			const skills = scanned.skills
				.filter((s) => !s.present && picks[skillKey(s)])
				.map((s) => ({ source: s.source, path: s.path }));
			const outcomes = sessions.length || skills.length ? await importApply({ sessions, skills }) : [];
			const servers = await addServers(scanned.mcp.filter((m) => !m.present && picks[mcpKey(m)]));
			summary = summarize(outcomes, servers);
			folders = importedFolders(outcomes);
		} catch (e) {
			runError = String(e);
		} finally {
			running = false;
		}
		// Fresh marks (imported, already added) for another round.
		await scan(true);
	}

	function addFolders() {
		onAddFolders?.(folders);
		foldersAdded = true;
	}

	const date = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : '');
	const label = (source: ImportSource) => SOURCE_LABELS[source];
</script>

<SettingsSection id="import-scan">
	<SettingsRow title={t('settings.import.title')} description={t('settings.import.intro')}>
		<Button size="sm" disabled={scanning || running} onclick={() => scan()}>
			{#if scanning}
				<CircleNotchIcon size={14} class="spin" />
				{t('settings.import.scanning')}
			{:else}
				{found ? t('settings.import.rescan') : t('settings.import.scan')}
			{/if}
		</Button>
	</SettingsRow>
	{#if scanError}
		<div class="pad"><Notice>{scanError}</Notice></div>
	{:else if empty}
		<SettingsRow description={t('settings.import.nothing')} />
	{/if}
</SettingsSection>

{#snippet groupHead(kind: string, source: ImportSource, keys: string[], total: number)}
	{@const id = `${kind}:${source}`}
	<div class="ghead">
		<Checkbox checked={allOn(keys)} disabled={!keys.length || running} onchange={(on) => setAll(keys, on)} />
		<button class="gtoggle" aria-expanded={!!open[id]} onclick={() => (open[id] = !open[id])}>
			<span class="gname">{label(source)}</span>
			<span class="gcount">{t('settings.import.selected', { n: count(keys), total })}</span>
			<span class="chev" class:on={open[id]}><CaretRightIcon size={12} /></span>
		</button>
	</div>
{/snippet}

{#snippet selectAll(keys: string[])}
	{#if keys.length}
		<Checkbox checked={allOn(keys)} disabled={running} onchange={(on) => setAll(keys, on)}>
			<span class="all">{t('settings.import.selectAll')} · {t('settings.import.selected', { n: count(keys), total: keys.length })}</span>
		</Checkbox>
	{/if}
{/snippet}

{#if found && found.sessions.length}
	<SettingsSection title={t('settings.import.sessions')} description={t('settings.import.sessionsHint')}>
		{#snippet action()}{@render selectAll(sessionKeys(found!.sessions))}{/snippet}
		{#each sessionGroups as g (g.source)}
			<div class="group">
				{@render groupHead('session', g.source, sessionKeys(g.items), g.items.length)}
				<Collapse open={!!open[`session:${g.source}`]}>
					{#each byProject(g.items) as p (p.cwd)}
						<div class="proj" title={p.cwd}>
							<span class="pname">{folderName(p.cwd)}</span>
							<span class="ppath">{p.cwd}</span>
						</div>
						{#each p.sessions as s (s.id)}
							{@const key = sessionKey(s)}
							<div class="item">
								<Checkbox checked={!!picks[key]} disabled={running} onchange={(on) => (picks[key] = on)}>
									<span class="iname">{s.title || t('settings.import.untitled')}</span>
								</Checkbox>
								<span class="imeta">
									{#if s.imported}<span class="tag">{t('settings.import.imported')}</span>{/if}
									{t('settings.import.prompts', { n: s.messages })} · {date(s.updated_at_ms)}
								</span>
							</div>
						{/each}
					{/each}
				</Collapse>
			</div>
		{/each}
	</SettingsSection>
{/if}

{#if found && found.skills.length}
	<SettingsSection title={t('settings.import.skills')} description={t('settings.import.skillsHint')}>
		{#snippet action()}{@render selectAll(skillKeys(found!.skills))}{/snippet}
		{#each skillGroups as g (g.source)}
			<div class="group">
				{@render groupHead('skill', g.source, skillKeys(g.items), g.items.length)}
				<Collapse open={!!open[`skill:${g.source}`]}>
					{#each g.items as s (s.path)}
						{@const key = skillKey(s)}
						<div class="item" title={s.path}>
							<Checkbox checked={!s.present && !!picks[key]} disabled={s.present || running} onchange={(on) => (picks[key] = on)}>
								<span class="iname mono">{s.name}</span>
							</Checkbox>
							{#if s.plugin}<span class="chip">{t('settings.import.plugin', { name: s.plugin })}</span>{/if}
							<span class="idesc">{s.description}</span>
							{#if s.present}<span class="tag">{t('settings.import.present')}</span>{/if}
						</div>
					{/each}
				</Collapse>
			</div>
		{/each}
	</SettingsSection>
{/if}

{#if found && found.mcp.length}
	<SettingsSection title={t('settings.import.mcp')} description={t('settings.import.mcpHint')}>
		{#snippet action()}{@render selectAll(mcpKeys(found!.mcp))}{/snippet}
		{#each mcpGroups as g (g.source)}
			<div class="group">
				{@render groupHead('mcp', g.source, mcpKeys(g.items), g.items.length)}
				<Collapse open={!!open[`mcp:${g.source}`]}>
					{#each g.items as m (mcpKey(m))}
						{@const key = mcpKey(m)}
						{@const what = m.transport === 'http' ? m.url : [m.command, ...(m.args ?? [])].join(' ')}
						<div class="item" title={what}>
							<Checkbox checked={!m.present && !!picks[key]} disabled={m.present || running} onchange={(on) => (picks[key] = on)}>
								<span class="iname mono">{m.name}</span>
							</Checkbox>
							<span class="chip">{m.transport}</span>
							{#if m.from}<span class="chip">{m.from.startsWith('/') ? folderName(m.from) : t('settings.import.plugin', { name: m.from })}</span>{/if}
							<span class="idesc mono">{what}</span>
							{#if !m.entry.enabled}<span class="tag">{t('settings.import.off')}</span>{/if}
							{#if m.present}<span class="tag">{t('settings.import.present')}</span>{/if}
						</div>
					{/each}
				</Collapse>
			</div>
		{/each}
	</SettingsSection>
{/if}

{#if found && !empty}
	<SettingsSection>
		<SettingsRow description={pickedTotal ? undefined : t('settings.import.pickSome')}>
			<Button variant="primary" disabled={!pickedTotal || running || scanning} onclick={run}>
				{#if running}
					<CircleNotchIcon size={14} class="spin" />
					{t('settings.import.running')}
				{:else}
					{t('settings.import.run')}{pickedTotal ? ` (${pickedTotal})` : ''}
				{/if}
			</Button>
		</SettingsRow>
		{#if runError}
			<div class="pad"><Notice>{runError}</Notice></div>
		{/if}
		{#if summary}
			<div class="pad result">
				<Notice tone={summary.failures.length ? 'warn' : 'info'}>
					<div class="rtitle">{t('settings.import.resultTitle')}</div>
					{#if summary.sessions.imported + summary.sessions.existing + summary.sessions.failed}
						<div>{t('settings.import.resultSessions', { ...summary.sessions })}</div>
					{/if}
					{#if summary.skills.imported + summary.skills.existing + summary.skills.failed}
						<div>{t('settings.import.resultSkills', { ...summary.skills })}</div>
					{/if}
					{#if summary.mcp.imported + summary.mcp.existing + summary.mcp.failed}
						<div>{t('settings.import.resultMcp', { ...summary.mcp })}</div>
					{/if}
					{#if summary.failures.length}
						<div class="rfail">{t('settings.import.failedCount', { n: summary.failures.length })}</div>
						<ul class="flist">
							{#each summary.failures as f, i (i)}
								<li><span class="mono">{f.label}</span> {f.error}</li>
							{/each}
						</ul>
					{/if}
					{#if summary.sessions.imported + summary.sessions.existing}
						<div class="rwhere">{t('settings.import.where')}</div>
					{/if}
				</Notice>
				{#if folders.length && onAddFolders}
					<div class="folders">
						{#if foldersAdded}
							<span class="done">{t('settings.import.foldersAdded')}</span>
						{:else}
							<Button size="sm" onclick={addFolders}>{t('settings.import.addFolders', { n: folders.length })}</Button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</SettingsSection>
{/if}

<style>
	.pad {
		padding: 14px 0;
	}
	.all {
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.group {
		padding: 4px 0;
	}
	.ghead {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
	}
	.gtoggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 0;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.gname {
		font-size: var(--fs-sm);
	}
	.gcount {
		margin-left: auto;
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
	}
	.chev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.on {
		transform: rotate(90deg);
	}
	.proj {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
		padding: 10px 0 4px 26px;
	}
	.pname {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--text);
		flex-shrink: 0;
	}
	.ppath {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 5px 0 5px 26px;
	}
	.item :global(.cb) {
		min-width: 0;
		flex-shrink: 1;
	}
	.iname {
		display: block;
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mono {
		font-family: var(--font-mono);
	}
	.imeta {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
	}
	.idesc {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip {
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-full);
		padding: 1px 8px;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.tag {
		font-size: var(--fs-2xs);
		color: var(--accent);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.result {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.rtitle {
		font-weight: 600;
		margin-bottom: 2px;
	}
	.rfail {
		margin-top: 6px;
	}
	.flist {
		margin: 4px 0 0;
		padding-left: 18px;
	}
	.rwhere {
		margin-top: 6px;
		color: var(--dim);
	}
	.folders {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.done {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
</style>
