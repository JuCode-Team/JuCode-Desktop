<script lang="ts">
	// Welcome → 运行环境: Git and the bundled engine, with the install help for a
	// missing Git, then the non-engine runtime tools (the engines are on the
	// 编程智能体 step).
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { installDependency, type EnvReport } from '$lib/protocol';
	import { gitInstallUi } from '$lib/setup';
	import Dependencies from '$lib/Dependencies.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

	let { env, checking, onRecheck }: { env: EnvReport | null; checking: boolean; onRecheck: () => void } = $props();

	const gitOk = $derived(env?.git.present ?? false);
	const engineOk = $derived(env?.engine.present ?? false);

	// Platform-aware install presentation from the backend's advice (auto
	// button / copyable command / download page); install_dependency may answer
	// with a manual command that overrides the advised one.
	const installUi = $derived(gitInstallUi(env?.os, env?.git_install));
	let cmdOverride = $state<string | null>(null);
	const installCmd = $derived(cmdOverride ?? installUi.command);
	let installing = $state(false);
	let installMsg = $state('');
	let copied = $state(false);

	async function autoInstall() {
		installing = true;
		installMsg = '';
		try {
			const outcome = await installDependency('git');
			installMsg = outcome.message;
			if (outcome.kind === 'manual-command') cmdOverride = outcome.command;
			else if (outcome.kind === 'open-url') await openUrl(outcome.url);
			else if (outcome.kind === 'installed') onRecheck();
		} catch (e) {
			installMsg = t('setup.installGit.autoInstallFailed', { e: String(e) });
		} finally {
			installing = false;
		}
	}
	function copyCmd() {
		if (installCmd) navigator.clipboard?.writeText(installCmd).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
</script>

<div class="checks">
	<div class="dep">
		<span class="dep-ico"><GitBranchIcon size={17} /></span>
		<div class="dep-txt">
			<span class="dep-name">Git</span>
			<span class="dep-detail">{gitOk ? env?.git.detail : t('setup.envCheck.notDetected')}</span>
		</div>
		<span class="dep-state" class:ok={gitOk} class:bad={!gitOk && !checking}>
			{#if checking}<CircleNotchIcon size={15} class="spin" />{:else if gitOk}<CheckIcon size={16} />{:else}<XIcon size={16} />{/if}
		</span>
	</div>
	<div class="dep">
		<span class="dep-ico"><CpuIcon size={17} /></span>
		<div class="dep-txt">
			<span class="dep-name">{t('setup.envCheck.engineName')}</span>
			<span class="dep-detail">{engineOk ? env?.engine.detail : t('setup.envCheck.engineNotFound')}</span>
		</div>
		<span class="dep-state" class:ok={engineOk} class:bad={!engineOk && !checking}>
			{#if checking}<CircleNotchIcon size={15} class="spin" />{:else if engineOk}<CheckIcon size={16} />{:else}<XIcon size={16} />{/if}
		</span>
	</div>
</div>

<div class="recheck">
	<Button variant="ghost" size="sm" onclick={onRecheck} disabled={checking}><ArrowsClockwiseIcon size={14} /> {t('setup.nav.recheck')}</Button>
</div>

{#if !checking && !gitOk}
	<div class="fix">
		<div class="fix-head">{t('setup.installGit.head')}</div>
		<p class="fix-tip">{t(`setup.installGit.${installUi.tipKey}`)}</p>
		{#if installUi.auto}
			<div class="fix-row">
				<Button variant="primary" size="sm" disabled={installing} onclick={autoInstall}>
					{#if installing}<CircleNotchIcon size={14} class="spin" /> {t('setup.installGit.starting')}{:else}<DownloadSimpleIcon size={14} /> {t('setup.installGit.autoInstall')}{/if}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => openUrl(installUi.url)}><ArrowSquareOutIcon size={14} /> {t('setup.installGit.downloadPage')}</Button>
			</div>
		{/if}
		{#if installMsg}<p class="fix-msg">{installMsg}</p>{/if}
		{#if installCmd}
			<div class="cmd"><code>{installCmd}</code><IconButton size="sm" onclick={copyCmd} label="copy" title={t('common.copy')}>{#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}</IconButton></div>
		{/if}
		{#if !installUi.auto}
			<Button variant="ghost" size="sm" onclick={() => openUrl(installUi.url)}><ArrowSquareOutIcon size={14} /> {t('setup.installGit.officialDownloadPage')}</Button>
		{/if}
	</div>
{/if}

{#if !checking && !engineOk}
	<div class="fixnote">
		<Notice tone="warn">
			<div class="fix-head">{t('setup.engineMissing.head')}</div>
			<p class="fix-tip">{@html t('setup.engineMissing.tip', { bin: '<code>JUCODE_BIN</code>' })}</p>
		</Notice>
	</div>
{/if}

<div class="deps-block"><Dependencies ids={['node', 'ffmpeg']} /></div>

<style>
	.checks {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.dep {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.dep-ico {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.dep-txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.dep-name {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.dep-detail {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dep-state {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
	}
	.dep-state.ok {
		color: var(--ok);
	}
	.dep-state.bad {
		color: var(--err);
	}
	.recheck {
		margin-top: 8px;
	}
	.fix {
		margin-top: 14px;
		padding: 14px;
		border: 1px solid color-mix(in oklab, var(--accent) 25%, var(--border));
		border-radius: var(--r-md);
		background: var(--accent-soft);
	}
	.fixnote {
		margin-top: 14px;
	}
	.fixnote .fix-head {
		margin-bottom: 2px;
	}
	.fixnote .fix-tip {
		margin: 0;
		font-size: inherit;
	}
	.fix-head {
		font-size: var(--fs-sm);
		font-weight: 600;
		margin-bottom: 6px;
	}
	.fix-tip {
		margin: 0 0 10px;
		font-size: var(--fs-sm);
		line-height: 1.55;
		color: var(--dim);
	}
	.fix-tip :global(code) {
		font-family: var(--font-mono);
		font-size: 0.9em;
		background: var(--surface2);
		border-radius: var(--r-xs);
		padding: 1px 5px;
	}
	.fix-row {
		display: flex;
		gap: 8px;
		margin-bottom: 8px;
	}
	.fix-msg {
		margin: 4px 0 10px;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--ok);
	}
	.cmd {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		padding: 8px 8px 8px 12px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
	}
	.cmd code {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
		white-space: nowrap;
		overflow-x: auto;
	}
	.deps-block {
		margin-top: 24px;
		padding-top: 18px;
		border-top: 1px solid var(--hairline);
	}
</style>
