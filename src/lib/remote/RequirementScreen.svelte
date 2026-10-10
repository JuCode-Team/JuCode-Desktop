<script lang="ts">
	// One requirement on the remote page: its status, the latest reply and
	// what comes next on top (what the user looks at when notified), then a
	// reply (to the last session, or a new one with the progress), done and
	// park; below, the user's words, screenshots, project, full progress and
	// sessions. An agent's proposal is accepted or rejected here, and the
	// start's confirmation given. An idea starts here too: in its project or
	// another, on a chosen backend, with a plan first if the user wants.
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import RequirementTag from '$lib/requirements/RequirementTag.svelte';
	import { PROGRESS_SECTIONS, gateNext, type RequirementState } from '$lib/requirements.svelte';
	import { sessionStateLabel, statusLabel, when } from '$lib/requirements/labels';
	import { BACKEND_LABELS, normalizeBackendId } from '$lib/backends';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';
	import RemoteScreen from './RemoteScreen.svelte';

	let {
		id,
		onBack,
		onOpenSession
	}: {
		id: string;
		onBack?: () => void;
		onOpenSession: (session: string, title?: string) => void;
	} = $props();

	const conn = useHost();
	const r = $derived(conn.requirements.get(id));
	const DAY = 24 * 60 * 60 * 1000;

	let shots = $state<string[]>([]);
	$effect(() => {
		const count = r?.images.length ?? 0;
		Promise.all(Array.from({ length: count }, (_, i) => conn.requirements.image(id, i)))
			.then((list) => (shots = list))
			.catch(() => {});
	});

	const sessions = $derived(
		(r?.sessions ?? []).map((sid) => {
			const view = conn.agents.sessions.find((s) => s.session === sid);
			return {
				id: sid,
				title: view?.title || t('shell.agentPage.untitled'),
				engine: BACKEND_LABELS[normalizeBackendId(view?.engine ?? 'jucode')],
				at: view?.updated_at ?? view?.created_at,
				state: r?.session_states?.[sid]
			};
		})
	);
	const latest = $derived(sessions.at(-1));

	let error = $state('');
	let busy = $state(false);
	async function run(work: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
	const setState = (state: RequirementState) => run(() => conn.requirements.update(id, { state }));

	// The reply: to the last session while it is fresh, else to a new one.
	// svelte-ignore state_referenced_locally
	const KEY = `${conn.id}:requirement-again:${id}`;
	let notes = $state(loadComposerText(KEY));
	$effect(() => saveComposerText(KEY, notes));
	let chosenNew = $state<boolean | null>(null);
	const toNew = $derived(chosenNew ?? (!latest?.at || Date.now() - latest.at > DAY));
	/** A new session gives its plan for confirmation before it works. */
	let planFirst = $state(false);
	let sentTo = $state('');
	function send() {
		const text = notes.trim();
		if (!text) return;
		void run(async () => {
			sentTo = await conn.requirements.reply(id, { text, newSession: toNew, ...(toNew ? { plan: planFirst, mode: 'auto' } : {}) });
			notes = '';
			chosenNew = null;
		});
	}

	// Its project, and the computer's others.
	const projects = $derived.by(() => {
		const seen = new Set<string>();
		return conn.projects.workspaces.flatMap((w) => w.projects).filter((p) => !p.chats && !seen.has(p.id) && !!seen.add(p.id));
	});
	const projectOptions = $derived([
		{ value: '', label: t('shell.requirement.noProject') },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const setProject = (project: string) => run(() => conn.requirements.update(id, { project: project || null }));

	// What waits for the user: an agent's proposal, or the start's gate.
	const proposer = $derived(
		r?.proposal ? (conn.agents.agents.find((a) => a.id === r.proposal!.agent)?.name ?? r.proposal.agent) : ''
	);
	const answer = (accept: boolean) => run(() => conn.requirements.answerProposal(id, accept));
	const confirmGate = () => run(() => conn.requirements.confirm(id));

	// Starting an idea: where (its project first) and on which backend.
	const startOptions = $derived(
		[...projects]
			.sort((a, b) => Number(b.id === r?.project) - Number(a.id === r?.project))
			.map((p) => ({ value: p.path, label: p.name }))
	);
	let startProject = $state('');
	$effect(() => {
		if (!startProject && startOptions.length) startProject = startOptions[0].value;
	});
	let engine = $state('jucode');
	const engines = (['jucode', 'claude', 'codex'] as const).map((b) => ({ value: b, label: BACKEND_LABELS[b] }));
	function start() {
		if (!startProject) return;
		void run(async () => {
			const session = await conn.requirements.reply(id, {
				cwd: startProject,
				engine,
				newSession: true,
				plan: planFirst,
				mode: 'auto'
			});
			onOpenSession(session);
		});
	}

	const SECTION_LABEL: Record<(typeof PROGRESS_SECTIONS)[number], string> = {
		decided: 'shell.requirement.decided',
		done: 'shell.requirement.doneItems',
		doing: 'shell.requirement.doing',
		blocked: 'shell.requirement.blocked',
		next: 'shell.requirement.next',
		files: 'shell.requirement.files'
	};
</script>

<RemoteScreen title={r?.title ?? id} subtitle={r ? statusLabel(r.status) : undefined} {onBack}>
	{#if r}
		<div class="page">
			<div class="head">
				<RequirementTag id={r.id} />
				<span class="status {r.status}">{statusLabel(r.status)}</span>
			</div>

			{#if r.proposal || r.state === 'proposed'}
				<section class="waiting">
					<p class="w-title">
						{r.proposal?.kind === 'close'
							? t('shell.requirement.proposalClose', { agent: proposer, outcome: statusLabel(r.proposal.outcome ?? 'done') })
							: t('shell.requirement.proposalCreate', { agent: proposer || t('shell.requirement.fromAgent') })}
					</p>
					{#if r.proposal?.reason}<p class="w-sub">{r.proposal.reason}</p>{/if}
					<div class="actions">
						<Button size="sm" variant="primary" disabled={busy} onclick={() => answer(true)}>{t('shell.requirement.accept')}</Button>
						<Button size="sm" variant="ghost" disabled={busy} onclick={() => answer(false)}>{t('shell.requirement.reject')}</Button>
					</div>
				</section>
			{:else if r.status === 'confirm' && r.gate}
				{@const gate = r.gate}
				<section class="waiting">
					<p class="w-title">{gate.stage === 'plan' ? t('shell.requirement.gatePlan') : t('shell.requirement.gateUnderstand')}</p>
					<p class="w-sub">{t('shell.requirement.confirmHint')}</p>
					<div class="actions">
						<Button size="sm" variant="primary" disabled={busy} onclick={confirmGate}>{t(`shell.requirement.${gateNext(gate)}`)}</Button>
						<Button size="sm" variant="ghost" onclick={() => onOpenSession(gate.session)}>{t('shell.requirement.openSession')}</Button>
					</div>
				</section>
			{/if}

			{#if r.last_reply && latest}
				<section>
					<h5>{t('shell.requirement.lastReply')} · {latest.title}</h5>
					<div class="quote">{r.last_reply}</div>
				</section>
			{/if}
			{#if r.progress?.next.length}
				<section>
					<h5>{t('shell.requirement.next')}</h5>
					<ul>{#each r.progress.next as item, i (i)}<li>{item}</li>{/each}</ul>
				</section>
			{/if}

			{#if sessions.length}
				<section class="reply">
					<textarea bind:value={notes} rows="3" placeholder={t('shell.requirement.againPlaceholder')}></textarea>
					<div class="reply-foot">
						<span>{toNew ? t('shell.requirement.againNew') : t('shell.requirement.againTo')}</span>
						<button class="link" onclick={() => (chosenNew = !toNew)}>{toNew ? t('shell.requirement.toLatest') : t('shell.requirement.toNew')}</button>
						<span class="grow"></span>
						{#if toNew}
							<label class="plan"><Switch bind:checked={planFirst} label={t('shell.requirement.planFirst')} />{t('shell.requirement.planFirst')}</label>
						{/if}
						<Button size="sm" variant="primary" disabled={!notes.trim() || busy} onclick={send}>
							{#if busy}<CircleNotchIcon size={13} class="spin" />{:else}<PaperPlaneTiltIcon size={13} />{/if}{t('shell.requirement.send')}
						</Button>
					</div>
					{#if sentTo}
						<div class="sent">
							<span>{t('shell.requirement.sent')}</span>
							<button class="link" onclick={() => onOpenSession(sentTo)}>{t('shell.requirement.open')}</button>
						</div>
					{/if}
				</section>
			{:else if r.state !== 'done' && r.state !== 'parked'}
				<section class="start">
					{#if startOptions.length}
						<Select bind:value={startProject} options={startOptions} />
						<Select bind:value={engine} options={engines} />
						<label class="plan"><Switch bind:checked={planFirst} label={t('shell.requirement.planFirst')} />{t('shell.requirement.planFirst')}</label>
						<Button variant="primary" full disabled={busy || !startProject} onclick={start}>
							{#if busy}<CircleNotchIcon size={15} class="spin" />{/if}{t('shell.requirement.start')}
						</Button>
					{:else}
						<p class="muted">{t('shell.requirement.pickProject')}</p>
					{/if}
				</section>
			{/if}

			{#if error}<Notice tone="error">{error}</Notice>{/if}

			<div class="actions">
				{#if r.state === 'done' || r.state === 'parked'}
					<Button size="sm" onclick={() => setState(r.sessions.length ? 'open' : 'idea')}>{t('shell.requirement.reopen')}</Button>
				{:else}
					<Button size="sm" onclick={() => setState('done')}><CheckIcon size={13} />{t('shell.requirement.done')}</Button>
					<Button size="sm" variant="ghost" onclick={() => setState('parked')}>{t('shell.requirement.park')}</Button>
				{/if}
			</div>

			<section>
				<h5>{t('shell.requirement.words')} · {when(r.created_at)}</h5>
				<p class="words">{r.text}</p>
				{#if shots.length}
					<div class="shots">
						{#each shots as src, i (i)}<a class="shot" href={src} target="_blank" rel="noreferrer"><img {src} alt="" /></a>{/each}
					</div>
				{/if}
				{#if projects.length}
					<div class="project"><Select value={r.project ?? ''} options={projectOptions} onChange={setProject} /></div>
				{/if}
			</section>

			<section>
				<h5>{t('shell.requirement.progress')}{r.progress_at ? ` · ${when(r.progress_at)}` : ''}</h5>
				{#if r.progress}
					{#if r.progress.goal}<p class="goal">{r.progress.goal}</p>{/if}
					{#each PROGRESS_SECTIONS as key (key)}
						{#if key !== 'next' && r.progress[key]?.length}
							<div class="sec">
								<span class="k">{t(SECTION_LABEL[key])}</span>
								<ul class:mono={key === 'files'}>{#each r.progress[key] as item, i (i)}<li>{item}</li>{/each}</ul>
							</div>
						{/if}
					{/each}
				{:else}
					<p class="muted">{t('shell.requirement.progressEmpty')}</p>
				{/if}
			</section>

			{#if sessions.length}
				<section>
					<h5>{t('shell.requirement.sessionList')}</h5>
					{#each [...sessions].reverse() as s (s.id)}
						<button class="sess" onclick={() => onOpenSession(s.id, s.title)}>
							<span class="sess-title">{s.title}</span>
							<span class="sess-sub">{[s.engine, sessionStateLabel(s.state), s.at ? when(s.at) : ''].filter(Boolean).join(' · ')}</span>
						</button>
					{/each}
				</section>
			{/if}
		</div>
	{:else}
		<p class="muted pad">{t('shell.requirement.empty')}</p>
	{/if}
</RemoteScreen>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 720px;
		margin: 0 auto;
		padding: 16px 16px calc(env(safe-area-inset-bottom) + 24px);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.status {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.status.review,
	.status.confirm,
	.status.proposed,
	.status.proposal {
		color: var(--warn);
	}
	.status.approval,
	.status.failed {
		color: var(--err);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h5 {
		margin: 0;
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--dim2);
	}
	.quote {
		font-size: var(--fs-sm);
		line-height: 1.6;
		color: var(--text);
		white-space: pre-wrap;
	}
	ul {
		margin: 0;
		padding-left: 18px;
		font-size: var(--fs-sm);
		line-height: 1.6;
	}
	ul.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		overflow-wrap: anywhere;
	}
	textarea {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.55;
		resize: vertical;
		outline: none;
	}
	.reply-foot,
	.sent {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.grow {
		flex: 1;
	}
	.link {
		flex-shrink: 0;
		white-space: nowrap;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.start {
		gap: 10px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.words {
		margin: 0;
		font-size: var(--fs-md);
		line-height: 1.6;
		white-space: pre-wrap;
	}
	.shots {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.shot {
		width: 96px;
		height: 64px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.shot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.waiting {
		gap: 6px;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--panel);
		box-shadow: var(--shadow-sm);
	}
	.w-title {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.w-sub {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.55;
		color: var(--dim);
		white-space: pre-wrap;
	}
	.plan {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.project {
		max-width: 280px;
	}
	.goal {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.sec {
		display: grid;
		grid-template-columns: 60px minmax(0, 1fr);
		gap: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--hairline);
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--dim2);
		padding-top: 3px;
	}
	.sess {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.sess-title {
		font-size: var(--fs-sm);
	}
	.sess-sub {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.muted {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.pad {
		padding: 16px;
	}
	.reply-foot {
		flex-wrap: wrap;
		row-gap: 6px;
	}
</style>
