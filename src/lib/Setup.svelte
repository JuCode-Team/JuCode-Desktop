<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Check, X, RefreshCw, Download, ExternalLink, GitBranch, Cpu,
		LogIn, LoaderCircle, Copy, ShieldCheck, KeyRound, PartyPopper
	} from 'lucide-svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { sendOp, checkEnvironment, installDependency, type EnvReport } from '$lib/protocol';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { focusTrap } from '$lib/focusTrap';

	let {
		sessionId,
		loggedIn,
		onRefreshAuth,
		onOpenSettings,
		onClose
	}: {
		sessionId: string;
		loggedIn: boolean;
		onRefreshAuth: () => void;
		onOpenSettings: () => void;
		onClose: () => void;
	} = $props();

	const STEPS = ['环境检查', '登录账号', '开始使用'];
	let step = $state(0);
	let env = $state<EnvReport | null>(null);
	let checking = $state(true);
	let installing = $state(false);
	let installMsg = $state('');
	let copied = $state(false);
	let loggingIn = $state(false);

	const gitOk = $derived(env?.git.present ?? false);
	const engineOk = $derived(env?.engine.present ?? false);

	// Platform-specific manual install command (macOS has a one-click button instead).
	const installCmd = $derived(
		env?.os === 'windows'
			? 'winget install --id Git.Git -e'
			: env?.os === 'linux'
				? 'sudo apt install git    # Fedora: sudo dnf install git · Arch: sudo pacman -S git'
				: 'brew install git'
	);

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
			installMsg = await installDependency('git');
		} catch (e) {
			installMsg = `自动安装不可用：${e}。请用下方命令手动安装。`;
		} finally {
			installing = false;
		}
	}
	function copyCmd() {
		navigator.clipboard?.writeText(installCmd).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}

	function login() {
		sendOp(sessionId, { op: 'command', input: '/login' });
		loggingIn = true;
	}
	// Poll auth.json while waiting for the OAuth round-trip to land.
	$effect(() => {
		if (!loggingIn || loggedIn) return;
		const t = setInterval(onRefreshAuth, 2000);
		return () => clearInterval(t);
	});
	$effect(() => {
		if (loggedIn) loggingIn = false;
	});

	function finish() {
		localStorage.setItem('jucode-setup-done', '1');
		onClose();
	}
</script>

<div class="overlay" role="presentation">
	<div class="wiz" role="dialog" aria-modal="true" tabindex="-1" aria-label="安装向导" use:focusTrap>
		<button class="skip" onclick={finish} aria-label="skip" title="跳过"><X size={18} /></button>

		<div class="brand">JuCode</div>
		<div class="steps">
			{#each STEPS as s, i (s)}
				<div class="stepdot" class:on={i === step} class:done={i < step}>
					<span class="num">{#if i < step}<Check size={13} />{:else}{i + 1}{/if}</span>
					<span class="slabel">{s}</span>
				</div>
				{#if i < STEPS.length - 1}<span class="bar" class:done={i < step}></span>{/if}
			{/each}
		</div>

		<div class="body">
			{#if step === 0}
				<h2>检查运行环境</h2>
				<p class="sub">JuCode 需要 git 来读取项目文件与版本管理。下面是检测结果。</p>

				<div class="checks">
					<div class="dep">
						<span class="dep-ico"><GitBranch size={17} /></span>
						<div class="dep-txt">
							<span class="dep-name">Git</span>
							<span class="dep-detail">{gitOk ? env?.git.detail : '未检测到'}</span>
						</div>
						<span class="dep-state" class:ok={gitOk} class:bad={!gitOk && !checking}>
							{#if checking}<LoaderCircle size={15} class="spin" />{:else if gitOk}<Check size={16} />{:else}<X size={16} />{/if}
						</span>
					</div>
					<div class="dep">
						<span class="dep-ico"><Cpu size={17} /></span>
						<div class="dep-txt">
							<span class="dep-name">JuCode 引擎</span>
							<span class="dep-detail">{engineOk ? env?.engine.detail : '未找到引擎二进制'}</span>
						</div>
						<span class="dep-state" class:ok={engineOk} class:bad={!engineOk && !checking}>
							{#if checking}<LoaderCircle size={15} class="spin" />{:else if engineOk}<Check size={16} />{:else}<X size={16} />{/if}
						</span>
					</div>
				</div>

				{#if !checking && !gitOk}
					<div class="fix">
						<div class="fix-head">安装 Git</div>
						{#if env?.os === 'macos'}
							<p class="fix-tip">点下方按钮触发系统「命令行工具」安装（含 git），在弹出的对话框中完成后点「重新检查」。</p>
							<div class="fix-row">
								<Button variant="primary" size="sm" disabled={installing} onclick={autoInstall}>
									{#if installing}<LoaderCircle size={14} class="spin" /> 启动安装…{:else}<Download size={14} /> 自动安装{/if}
								</Button>
								<Button variant="ghost" size="sm" onclick={() => openUrl('https://git-scm.com/downloads')}><ExternalLink size={14} /> 下载页</Button>
							</div>
							{#if installMsg}<p class="fix-msg">{installMsg}</p>{/if}
							<div class="cmd"><code>{installCmd}</code><IconButton size="sm" onclick={copyCmd} label="copy" title="复制">{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}</IconButton></div>
						{:else}
							<p class="fix-tip">在终端执行以下命令安装，完成后点「重新检查」。</p>
							<div class="cmd"><code>{installCmd}</code><IconButton size="sm" onclick={copyCmd} label="copy" title="复制">{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}</IconButton></div>
							<Button variant="ghost" size="sm" onclick={() => openUrl('https://git-scm.com/downloads')}><ExternalLink size={14} /> 官方下载页</Button>
						{/if}
					</div>
				{/if}

				{#if !checking && !engineOk}
					<div class="fix warn">
						<div class="fix-head">未找到 JuCode 引擎</div>
						<p class="fix-tip">正式安装包内置引擎；若你在开发环境，请设置 <code>JUCODE_BIN</code> 或在同级目录构建 JuCode-CLI。</p>
					</div>
				{/if}
			{:else if step === 1}
				<h2>登录 JuCode</h2>
				<p class="sub">登录后即可使用 JuCode 托管的模型；也可以用自己的 API Key 接入任意兼容端点。</p>

				{#if loggedIn}
					<div class="loginok"><span class="loginok-ico"><Check size={18} /></span> 已登录，可继续下一步。</div>
				{:else}
					<div class="loginbox">
						<Button variant="primary" full onclick={login} disabled={loggingIn}>
							{#if loggingIn}<LoaderCircle size={15} class="spin" /> 等待浏览器授权…{:else}<LogIn size={15} /> 使用 JuCode 账号登录{/if}
						</Button>
						{#if loggingIn}<p class="hint center">已在浏览器中打开授权页，完成后会自动识别。</p>{/if}
						<div class="or"><span>或</span></div>
						<Button variant="secondary" full onclick={onOpenSettings}><KeyRound size={15} /> 使用 API Key / 自定义 Provider</Button>
					</div>
				{/if}
			{:else}
				<div class="done">
					<span class="done-ico"><PartyPopper size={30} /></span>
					<h2>一切就绪</h2>
					<p class="sub center">
						{gitOk ? 'Git 已就绪' : 'Git 仍缺失（部分功能受限）'} ·
						{loggedIn ? '已登录' : '未登录（可稍后在设置中配置）'}
					</p>
					<p class="hint center">提示：<kbd>⌘K</kbd> 打开命令面板，<kbd>/</kbd> 唤起命令，<kbd>@</kbd> 引用文件。</p>
				</div>
			{/if}
		</div>

		<div class="foot">
			{#if step === 0}
				<Button variant="ghost" size="sm" onclick={runCheck} disabled={checking}><RefreshCw size={14} /> 重新检查</Button>
				<div class="spacer"></div>
				<Button variant="ghost" size="sm" onclick={finish}>跳过</Button>
				<Button variant="primary" size="sm" onclick={() => (step = 1)}>下一步</Button>
			{:else if step === 1}
				<Button variant="ghost" size="sm" onclick={() => (step = 0)}>上一步</Button>
				<div class="spacer"></div>
				<Button variant="ghost" size="sm" onclick={() => (step = 2)}>暂不登录</Button>
				<Button variant="primary" size="sm" onclick={() => (step = 2)} disabled={!loggedIn}>下一步</Button>
			{:else}
				<Button variant="ghost" size="sm" onclick={() => (step = 1)}>上一步</Button>
				<div class="spacer"></div>
				<Button variant="primary" onclick={finish}><ShieldCheck size={15} /> 开始使用</Button>
			{/if}
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 80;
		animation: fade 0.16s ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.wiz {
		position: relative;
		width: min(560px, 94vw);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		animation: pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
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
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 18px;
		letter-spacing: -0.01em;
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
		font-size: 12px;
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
		font-size: 12.5px;
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
		overflow-y: auto;
		padding: 4px 24px 8px;
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 700;
	}
	.sub {
		margin: 6px 0 16px;
		font-size: 13px;
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
	.fix.warn {
		border-color: color-mix(in oklab, var(--warn) 35%, transparent);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
	}
	.fix-head {
		font-size: 13px;
		font-weight: 600;
		margin-bottom: 6px;
	}
	.fix-tip {
		margin: 0 0 10px;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--dim);
	}
	.fix-tip code {
		font-family: var(--font-mono);
		font-size: 0.9em;
		background: var(--surface2);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.fix-row {
		display: flex;
		gap: 8px;
		margin-bottom: 8px;
	}
	.fix-msg {
		margin: 4px 0 10px;
		font-size: 12px;
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
		font-size: 12px;
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
		font-size: 12px;
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
		font-size: 12px;
		color: var(--dim);
		line-height: 1.55;
	}
	.hint.center {
		text-align: center;
	}
	.hint kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 5px;
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
		font-size: 13.5px;
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
	.done kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 5px;
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
</style>
