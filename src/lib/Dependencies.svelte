<script lang="ts">
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import {
		Check, X, Download, RefreshCw, LoaderCircle, Copy, ExternalLink,
		Hexagon, Film, Sparkles, SquareTerminal, Cpu
	} from 'lucide-svelte';
	import {
		checkDependencies, runInstall,
		type DepReport, type InstallOutputEvent, type InstallDoneEvent
	} from '$lib/protocol';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';

	const ICONS: Record<string, typeof Hexagon> = {
		node: Hexagon,
		ffmpeg: Film,
		claude: Sparkles,
		codex: SquareTerminal,
		jucode: Cpu
	};

	let deps = $state<DepReport[]>([]);
	let loading = $state(true);
	// Per-tool transient state, keyed by dep id.
	let installing = $state<Record<string, boolean>>({});
	let logs = $state<Record<string, string[]>>({});
	let msgs = $state<Record<string, { text: string; ok: boolean } | null>>({});
	let manualCmd = $state<Record<string, string>>({});
	let copied = $state<string | null>(null);

	let unlisteners: UnlistenFn[] = [];

	async function recheck() {
		loading = true;
		try {
			deps = await checkDependencies();
		} catch {
			/* ignore — leave the previous list */
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		recheck();
		(async () => {
			unlisteners.push(
				await listen<InstallOutputEvent>('install-output', (e) => {
					const { id, line } = e.payload;
					const prev = logs[id] ?? [];
					// Cap the buffer so a chatty installer can't grow it unbounded.
					logs[id] = [...prev, line].slice(-400);
				})
			);
			unlisteners.push(
				await listen<InstallDoneEvent>('install-done', (e) => {
					const { id, success, code } = e.payload;
					installing[id] = false;
					if (success) {
						msgs[id] = { text: t('setup.deps.doneOk'), ok: true };
						recheck();
					} else {
						msgs[id] = {
							text: t('setup.deps.doneFail', { code: code ?? -1 }),
							ok: false
						};
					}
				})
			);
		})();
		return () => {
			for (const u of unlisteners) u();
			unlisteners = [];
		};
	});

	async function install(dep: DepReport) {
		installing[dep.id] = true;
		logs[dep.id] = [];
		msgs[dep.id] = null;
		manualCmd[dep.id] = '';
		try {
			const start = await runInstall(dep.id);
			if (start.kind === 'running') return; // install-done event finishes it
			installing[dep.id] = false;
			if (start.kind === 'manual-command') {
				manualCmd[dep.id] = start.command;
			} else if (start.kind === 'open-url') {
				await openUrl(start.url);
			} else if (start.kind === 'needs-prereq') {
				msgs[dep.id] = { text: t('setup.deps.needsNode'), ok: false };
			}
		} catch (e) {
			installing[dep.id] = false;
			msgs[dep.id] = { text: t('setup.deps.startFailed', { e: String(e) }), ok: false };
		}
	}

	function copyCmd(id: string, cmd: string) {
		navigator.clipboard?.writeText(cmd).catch(() => {});
		copied = id;
		setTimeout(() => (copied = copied === id ? null : copied), 1400);
	}

	// The command a 'manual' plan wants shown (from the plan, or from run_install).
	function planCommand(dep: DepReport): string | null {
		if (manualCmd[dep.id]) return manualCmd[dep.id];
		if (dep.plan.kind === 'manual') return dep.plan.command;
		return null;
	}
</script>

<div class="deps">
	<div class="head">
		<div class="htext">
			<h3>{t('setup.deps.title')}</h3>
			<p class="sub">{t('setup.deps.sub')}</p>
		</div>
		<Button variant="ghost" size="sm" onclick={recheck} disabled={loading}>
			{#if loading}<LoaderCircle size={14} class="spin" />{:else}<RefreshCw size={14} />{/if}
			{t('setup.deps.recheck')}
		</Button>
	</div>

	<div class="list">
		{#each deps as dep (dep.id)}
			{@const Icon = ICONS[dep.id] ?? SquareTerminal}
			{@const cmd = planCommand(dep)}
			<div class="dep" class:on={dep.present}>
				<span class="dep-ico"><Icon size={17} /></span>
				<div class="dep-txt">
					<span class="dep-name">{t(`setup.deps.tools.${dep.id}.name`)}</span>
					<span class="dep-detail">
						{dep.present ? dep.detail : t(`setup.deps.tools.${dep.id}.desc`)}
					</span>
				</div>

				<div class="dep-action">
					{#if dep.present}
						<span class="badge ok"><Check size={14} /> {t('setup.deps.installed')}</span>
					{:else if installing[dep.id]}
						<Button variant="secondary" size="sm" disabled>
							<LoaderCircle size={14} class="spin" /> {t('setup.deps.installing')}
						</Button>
					{:else if dep.plan.kind === 'run'}
						<Button variant="primary" size="sm" onclick={() => install(dep)}>
							<Download size={14} /> {msgs[dep.id] && !msgs[dep.id]?.ok ? t('setup.deps.retry') : t('setup.deps.install')}
						</Button>
					{:else if dep.plan.kind === 'open-url'}
						<Button variant="secondary" size="sm" onclick={() => dep.plan.kind === 'open-url' && openUrl(dep.plan.url)}>
							<ExternalLink size={14} /> {t('setup.deps.openPage')}
						</Button>
					{:else if dep.plan.kind === 'needs-prereq'}
						<span class="badge warn">{t('setup.deps.needsNode')}</span>
					{:else}
						<span class="badge">{t('setup.deps.notInstalled')}</span>
					{/if}
				</div>
			</div>

			<!-- copyable command (Linux sudo) -->
			{#if !dep.present && cmd}
				<div class="cmdrow">
					<p class="hint">{t('setup.deps.manualHint')}</p>
					<div class="cmd">
						<code>{cmd}</code>
						<IconButton size="sm" onclick={() => copyCmd(dep.id, cmd)} label="copy" title={t('setup.deps.copy')}>
							{#if copied === dep.id}<Check size={14} />{:else}<Copy size={14} />{/if}
						</IconButton>
					</div>
				</div>
			{/if}

			<!-- live install log -->
			{#if logs[dep.id]?.length}
				<div class="logbox">
					<div class="log-head">{t('setup.deps.logTitle')}</div>
					<pre class="log">{logs[dep.id].join('\n')}</pre>
				</div>
			{/if}

			{#if msgs[dep.id]}
				<p class="donemsg" class:ok={msgs[dep.id]?.ok} class:bad={!msgs[dep.id]?.ok}>
					{msgs[dep.id]?.text}
				</p>
			{/if}
		{/each}
	</div>
</div>

<style>
	.deps {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.htext {
		flex: 1;
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 700;
	}
	.sub {
		margin: 4px 0 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--dim);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.dep {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.dep.on {
		background: color-mix(in oklab, var(--ok) 6%, var(--surface));
		border-color: color-mix(in oklab, var(--ok) 22%, var(--hairline));
	}
	.dep-ico {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.dep.on .dep-ico {
		color: var(--ok);
	}
	.dep-txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.dep-name {
		font-size: 13.5px;
		font-weight: 600;
	}
	.dep-detail {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dep-action {
		flex-shrink: 0;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--dim2);
	}
	.badge.ok {
		color: var(--ok);
	}
	.badge.warn {
		color: var(--warn);
		font-size: 11.5px;
	}
	.cmdrow {
		margin: -2px 0 2px;
		padding: 0 2px;
	}
	.hint {
		margin: 0 0 6px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--dim);
	}
	.cmd {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 8px 8px 12px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
	}
	.cmd code {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text);
		white-space: nowrap;
		overflow-x: auto;
	}
	.logbox {
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		overflow: hidden;
		background: var(--sidebar);
	}
	.log-head {
		padding: 6px 10px;
		font-size: 11px;
		font-weight: 600;
		color: var(--dim);
		border-bottom: 1px solid var(--hairline);
	}
	.log {
		margin: 0;
		padding: 8px 10px;
		max-height: 180px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
		color: var(--dim);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.donemsg {
		margin: 2px 2px 4px;
		font-size: 12px;
		line-height: 1.5;
	}
	.donemsg.ok {
		color: var(--ok);
	}
	.donemsg.bad {
		color: var(--err);
	}
</style>
