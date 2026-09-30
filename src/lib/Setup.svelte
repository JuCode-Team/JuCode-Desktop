<script lang="ts">
	import { onMount } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import ConfettiIcon from 'phosphor-svelte/lib/ConfettiIcon';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { checkEnvironment, installDependency, type EnvReport } from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import { gitInstallUi } from '$lib/setup';
	import Dependencies from '$lib/Dependencies.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

	let {
		sessionId,
		chat,
		loggedIn,
		onRefreshAuth,
		onOpenSettings,
		onClose
	}: {
		sessionId: string;
		/** The session the /login runs in, to catch a failed login. */
		chat?: ChatState;
		loggedIn: boolean;
		onRefreshAuth: () => void;
		onOpenSettings: () => void;
		onClose: () => void;
	} = $props();

	const STEPS = $derived([t('setup.steps.env'), t('setup.steps.login'), t('setup.steps.start')]);
	let step = $state(0);
	let env = $state<EnvReport | null>(null);
	let checking = $state(true);
	let installing = $state(false);
	let installMsg = $state('');
	let copied = $state(false);
	let loggingIn = $state(false);

	const gitOk = $derived(env?.git.present ?? false);
	const engineOk = $derived(env?.engine.present ?? false);

	// Platform-aware install presentation, driven by the backend's advice
	// (auto button / copyable command / download page).
	const installUi = $derived(gitInstallUi(env?.os, env?.git_install));
	// install_dependency may answer with a manual command (e.g. after a partial
	// probe); it overrides the advice-derived command row.
	let cmdOverride = $state<string | null>(null);
	const installCmd = $derived(cmdOverride ?? installUi.command);

	async function runCheck() {
		checking = true;
		try {
			env = await checkEnvironment();
		} catch {
			/* ignore */
		} finally {
			checking = false;
		}
	}
	onMount(runCheck);

	async function autoInstall() {
		installing = true;
		installMsg = '';
		try {
			const outcome = await installDependency('git');
			installMsg = outcome.message;
			if (outcome.kind === 'manual-command') cmdOverride = outcome.command;
			else if (outcome.kind === 'open-url') await openUrl(outcome.url);
			else if (outcome.kind === 'installed') await runCheck();
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

	let loginError = $state('');
	let loginMark = 0;
	function login() {
		loginError = '';
		loginMark = chat?.messages.length ?? 0;
		dispatch(sessionId, { op: 'command', input: '/login jucode' });
		loggingIn = true;
	}
	$effect(() => {
		if (!loggingIn) return;
		const failed = loginErrorSince(chat, loginMark);
		if (failed) {
			loginError = failed;
			loggingIn = false;
		}
	});
	// Poll auth.json while waiting for the OAuth round-trip to land.
	$effect(() => {
		if (!loggingIn || loggedIn) return;
		const t = setInterval(onRefreshAuth, 2000);
		return () => clearInterval(t);
	});
	$effect(() => {
		if (loggedIn && loggingIn) {
			loggingIn = false;
			modelSetup.open = true;
		}
	});

	function finish() {
		localStorage.setItem('jucode-setup-done', '1');
		onClose();
	}
	import { modelSetup } from '$lib/modelSetupState.svelte';
	import { loginErrorSince } from '$lib/loginWatch';
	import type { ChatState } from '$lib/chat.svelte';
</script>

<Modal label={t('setup.wizardLabel')} width={560} padded={false} dismissible={false} onClose={finish}>
	<div class="wiz">
		<button class="skip" onclick={finish} aria-label="skip" title={t('setup.skip')}><XIcon size={18} /></button>

		<div class="brand">JuCode</div>
		<div class="steps">
			{#each STEPS as s, i (s)}
				<div class="stepdot" class:on={i === step} class:done={i < step}>
					<span class="num">{#if i < step}<CheckIcon size={13} />{:else}{i + 1}{/if}</span>
					<span class="slabel">{s}</span>
				</div>
				{#if i < STEPS.length - 1}<span class="bar" class:done={i < step}></span>{/if}
			{/each}
		</div>

		<div class="body">
			{#if step === 0}
				<h2>{t('setup.envCheck.title')}</h2>
				<p class="sub">{t('setup.envCheck.sub')}</p>

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

				<div class="deps-block"><Dependencies /></div>
			{:else if step === 1}
				<h2>{t('setup.loginOauth.title')}</h2>
				<p class="sub">{t('setup.loginOauth.sub')}</p>

				{#if loggedIn}
					<div class="loginok"><span class="loginok-ico"><CheckIcon size={18} /></span> {t('setup.loginOauth.loggedIn')}</div>
				{:else}
					<div class="loginbox">
						<Button variant="primary" full onclick={login} disabled={loggingIn}>
							{#if loggingIn}<CircleNotchIcon size={15} class="spin" /> {t('setup.loginOauth.waiting')}{:else}<SignInIcon size={15} /> {t('setup.loginOauth.loginBtn')}{/if}
						</Button>
						{#if loggingIn}<p class="hint center">{t('setup.loginOauth.browserOpened')}</p>{/if}
						{#if loginError}<Notice onDismiss={() => (loginError = '')}>{loginError}</Notice>{/if}
						<div class="or"><span>{t('setup.loginOauth.or')}</span></div>
						<Button variant="secondary" full onclick={onOpenSettings}><KeyIcon size={15} /> {t('setup.loginOauth.apiKeyBtn')}</Button>
					</div>
				{/if}
			{:else}
				<div class="done">
					<span class="done-ico"><ConfettiIcon size={30} /></span>
					<h2>{t('setup.done.title')}</h2>
					<p class="sub center">
						{gitOk ? t('setup.done.gitReady') : t('setup.done.gitMissing')} ·
						{loggedIn ? t('setup.done.loggedIn') : t('setup.done.notLoggedIn')}
					</p>
					<p class="hint center">{@html t('setup.done.hint', { cmdk: '<kbd>⌘K</kbd>', slash: '<kbd>/</kbd>', at: '<kbd>@</kbd>' })}</p>
				</div>
			{/if}
		</div>

		<div class="foot">
			{#if step === 0}
				<Button variant="ghost" size="sm" onclick={runCheck} disabled={checking}><ArrowsClockwiseIcon size={14} /> {t('setup.nav.recheck')}</Button>
				<div class="spacer"></div>
				<Button variant="ghost" size="sm" onclick={finish}>{t('setup.nav.skip')}</Button>
				<Button variant="primary" size="sm" onclick={() => (step = 1)}>{t('setup.nav.next')}</Button>
			{:else if step === 1}
				<Button variant="ghost" size="sm" onclick={() => (step = 0)}>{t('setup.nav.prev')}</Button>
				<div class="spacer"></div>
				<Button variant="ghost" size="sm" onclick={() => (step = 2)}>{t('setup.nav.skipLogin')}</Button>
				<Button variant="primary" size="sm" onclick={() => (step = 2)} disabled={!loggedIn}>{t('setup.nav.next')}</Button>
			{:else}
				<Button variant="ghost" size="sm" onclick={() => (step = 1)}>{t('setup.nav.prev')}</Button>
				<div class="spacer"></div>
				<Button variant="primary" onclick={finish}><ShieldCheckIcon size={15} /> {t('setup.nav.start')}</Button>
			{/if}
		</div>
	</div>
</Modal>

<style>
	.wiz {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.skip {
		position: absolute;
		top: 12px;
		right: 12px;
		display: inline-flex;
		padding: 6px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: var(--r-sm);
		cursor: pointer;
		z-index: 1;
	}
	.skip:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.brand {
		font-family: var(--font-sans);
		font-weight: 600;
		font-size: var(--fs-xl);
		letter-spacing: -0.005em;
		padding: 22px 24px 0;
	}
	.steps {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 16px 24px 18px;
	}
	.stepdot {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.stepdot .num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1px solid var(--border);
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.stepdot.on {
		color: var(--text);
	}
	.stepdot.on .num {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.stepdot.done .num {
		border-color: color-mix(in oklab, var(--ok) 50%, transparent);
		background: color-mix(in oklab, var(--ok) 16%, transparent);
		color: var(--ok);
	}
	.slabel {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.bar {
		flex: 1;
		height: 1px;
		background: var(--border);
	}
	.bar.done {
		background: color-mix(in oklab, var(--ok) 45%, transparent);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 24px 8px;
	}
	h2 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.sub {
		margin: 6px 0 16px;
		font-size: var(--fs-sm);
		line-height: 1.55;
		color: var(--dim);
	}
	.sub.center {
		text-align: center;
	}
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
	.loginbox {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px 0 6px;
	}
	.or {
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		margin: 2px 0;
	}
	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--hairline);
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.55;
	}
	.hint.center {
		text-align: center;
	}
	.hint :global(kbd) {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-xs);
		padding: 1px 5px;
	}
	.loginok {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px;
		border: 1px solid color-mix(in oklab, var(--ok) 35%, transparent);
		background: color-mix(in oklab, var(--ok) 12%, transparent);
		border-radius: var(--r-md);
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.loginok-ico {
		display: inline-flex;
		color: var(--ok);
	}
	.done {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 18px 0 8px;
		text-align: center;
	}
	.done-ico {
		display: inline-flex;
		color: var(--accent-bright);
		margin-bottom: 4px;
	}
	.done :global(kbd) {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-xs);
		padding: 1px 5px;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 24px;
		border-top: 1px solid var(--hairline);
	}
	.spacer {
		flex: 1;
	}
	.deps-block {
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px solid var(--hairline);
	}
</style>
