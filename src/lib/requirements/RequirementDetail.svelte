<script lang="ts">
	// One requirement on the workbench. Left: the user's words (editable), its
	// screenshots and projects, and the progress the daemon keeps after each
	// turn. Right: its sessions, the latest one's last reply, and 再改 (the
	// user's notes, sent together to the last session, or to a new one that
	// starts from the progress). The user changes its state by hand; while it
	// is open, its status follows the sessions.
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowBendDownRightIcon from 'phosphor-svelte/lib/ArrowBendDownRightIcon';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import Button from '$lib/ui/Button.svelte';
	import RequirementTag from './RequirementTag.svelte';
	import ProjectPick from './ProjectPick.svelte';
	import StartButton, { type StartHow } from './StartButton.svelte';
	import { PROGRESS_SECTIONS, gateNext, useRequirements, type Requirement, type RequirementState } from '$lib/requirements.svelte';
	import { useAgents } from '$lib/agentScope';
	import { BACKEND_LABELS, normalizeBackendId } from '$lib/backends';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import { sessionStateLabel, sourceLabel, statusLabel, when } from './labels';
	import { t } from '$lib/i18n';

	let {
		requirement: r,
		projects,
		onBack,
		onStart,
		onOpenSession
	}: {
		requirement: Requirement;
		projects: { id: string; path: string; name: string }[];
		onBack: () => void;
		onStart: (r: Requirement, how: StartHow) => void;
		onOpenSession: (session: string) => void;
	} = $props();

	const reqs = useRequirements();
	const agents = useAgents();
	const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
	const DAY = 24 * 60 * 60 * 1000;

	// Screenshots, fetched from the daemon.
	let shots = $state<string[]>([]);
	$effect(() => {
		const id = r.id;
		const count = r.images.length;
		shots = [];
		Promise.all(Array.from({ length: count }, (_, i) => reqs.image(id, i)))
			.then((list) => (shots = list))
			.catch(() => {});
	});

	// The words, edited in place.
	let editing = $state(false);
	let draftWords = $state('');
	function edit() {
		draftWords = r.text;
		editing = true;
	}
	async function saveWords() {
		const words = draftWords.trim();
		if (!words) return;
		await run(() => reqs.update(r.id, { text: words }));
		editing = false;
	}

	async function run(work: () => Promise<unknown>) {
		try {
			await work();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	const setState = (state: RequirementState) => run(() => reqs.update(r.id, { state }));
	let stateOpen = $state(false);
	const STATES: RequirementState[] = ['idea', 'open', 'done', 'parked'];
	const stateItems = $derived<PopMenuItem[]>(
		STATES.map((s) => ({ key: s, label: statusLabel(s), checked: r.state === s }))
	);

	async function remove() {
		const ok = await confirm({
			title: t('shell.requirement.delete'),
			message: t('shell.requirement.deleteConfirm', { title: r.title }),
			confirmLabel: t('shell.requirement.delete'),
			danger: true
		});
		if (ok) await run(async () => (await reqs.remove(r.id), onBack()));
	}

	const setProject = (project: string) => run(() => reqs.update(r.id, { project: project || null }));
	// One of another workspace keeps its name in the list.
	const pickable = $derived(
		r.project && !projects.some((p) => p.id === r.project) ? [...projects, { id: r.project, path: '', name: r.project }] : projects
	);

	// What waits for the user: an agent's proposal, or the start's gate.
	const proposer = $derived(
		r.proposal ? (agents.agents.find((a) => a.id === r.proposal!.agent)?.name ?? r.proposal.agent) : ''
	);
	const proposed = $derived(!!r.proposal || r.state === 'proposed');
	const answer = (accept: boolean) => run(() => reqs.answerProposal(r.id, accept));
	const confirmGate = () => run(() => reqs.confirm(r.id));

	// Its sessions, newest last as linked.
	const sessions = $derived(
		r.sessions.map((id) => {
			const view = agents.sessions.find((s) => s.session === id);
			return {
				id,
				title: view?.title || t('shell.agentPage.untitled'),
				engine: BACKEND_LABELS[normalizeBackendId(view?.engine ?? 'jucode')],
				at: view?.updated_at ?? view?.created_at,
				project: view ? base(view.cwd) : '',
				state: r.session_states?.[id]
			};
		})
	);
	const latest = $derived(sessions.at(-1));

	// 再改: to the last session while it is fresh, else to a new one.
	// The page shows one requirement per instance (keyed by id).
	// svelte-ignore state_referenced_locally
	let notes = $state(loadComposerText(`requirement-again:${r.id}`));
	$effect(() => saveComposerText(`requirement-again:${r.id}`, notes));
	let chosenNew = $state<boolean | null>(null);
	const stale = $derived(!latest?.at || Date.now() - latest.at > DAY);
	const toNew = $derived(chosenNew ?? stale);
	let sending = $state(false);
	async function sendNotes() {
		const text = notes.trim();
		if (!text || sending) return;
		sending = true;
		try {
			const session = await reqs.reply(r.id, { text, newSession: toNew });
			notes = '';
			chosenNew = null;
			toast.success(t('shell.requirement.sent'), {
				action: { label: t('shell.requirement.open'), run: () => onOpenSession(session) }
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			sending = false;
		}
	}
	function onNotesKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void sendNotes();
		}
	}

	const SECTION_LABEL: Record<(typeof PROGRESS_SECTIONS)[number], string> = {
		decided: 'shell.requirement.decided',
		done: 'shell.requirement.doneItems',
		doing: 'shell.requirement.doing',
		blocked: 'shell.requirement.blocked',
		next: 'shell.requirement.next',
		files: 'shell.requirement.files'
	};
	const closed = $derived(r.state === 'done' || r.state === 'parked');
</script>

<div class="detail">
	<header>
		<button class="back" onclick={onBack} aria-label={t('shell.desk.back')} title={t('shell.desk.back')}><ArrowLeftIcon size={17} /></button>
		<div class="heading">
			<RequirementTag id={r.id} />
			<h1>{r.title}</h1>
		</div>
		<div class="actions">
			<span class="state">
				<button class="state-btn" onclick={() => (stateOpen = !stateOpen)} aria-haspopup="menu" aria-expanded={stateOpen}>
					<span class="dot {r.status}"></span>{statusLabel(r.status)}<CaretDownIcon size={11} />
				</button>
				{#if stateOpen}
					<PopMenu items={stateItems} placement="down-left" onSelect={(k) => ((stateOpen = false), setState(k as RequirementState))} onClose={() => (stateOpen = false)} />
				{/if}
			</span>
			{#if closed}
				<Button size="sm" onclick={() => setState(r.sessions.length ? 'open' : 'idea')}>{t('shell.requirement.reopen')}</Button>
			{:else}
				<Button size="sm" variant="ghost" onclick={() => setState('parked')}>{t('shell.requirement.park')}</Button>
				<Button size="sm" variant="primary" onclick={() => setState('done')}><CheckIcon size={13} />{t('shell.requirement.done')}</Button>
			{/if}
			<button class="icon" onclick={remove} aria-label={t('shell.requirement.delete')} title={t('shell.requirement.delete')}><TrashIcon size={15} /></button>
		</div>
	</header>

	{#if proposed}
		<div class="waiting">
			<div class="w-text">
				<span class="w-title">
					{r.proposal?.kind === 'close'
						? t('shell.requirement.proposalClose', { agent: proposer, outcome: statusLabel(r.proposal.outcome ?? 'done') })
						: t('shell.requirement.proposalCreate', { agent: proposer || t('shell.requirement.fromAgent') })}
				</span>
				{#if r.proposal?.reason}<span class="w-sub">{r.proposal.reason}</span>{/if}
			</div>
			<Button size="sm" variant="ghost" onclick={() => answer(false)}>{t('shell.requirement.reject')}</Button>
			<Button size="sm" variant="primary" onclick={() => answer(true)}>{t('shell.requirement.accept')}</Button>
		</div>
	{:else if r.status === 'confirm' && r.gate}
		{@const gate = r.gate}
		<div class="waiting">
			<div class="w-text">
				<span class="w-title">{gate.stage === 'plan' ? t('shell.requirement.gatePlan') : t('shell.requirement.gateUnderstand')}</span>
				<span class="w-sub">{t('shell.requirement.confirmHint')}</span>
			</div>
			<Button size="sm" variant="ghost" onclick={() => onOpenSession(gate.session)}>{t('shell.requirement.openSession')}</Button>
			<Button size="sm" variant="primary" onclick={confirmGate}>{t(`shell.requirement.${gateNext(gate)}`)}</Button>
		</div>
	{/if}

	<div class="cols">
		<div class="left">
			<h5>
				<span>{t('shell.requirement.words')}</span>
				<span>{sourceLabel(r.source)} · {when(r.created_at)}</span>
			</h5>
			{#if editing}
				<textarea class="words-edit" bind:value={draftWords} rows="4"></textarea>
				<div class="row-actions">
					<Button size="sm" variant="ghost" onclick={() => (editing = false)}>{t('shell.requirement.cancel')}</Button>
					<Button size="sm" variant="primary" onclick={saveWords}>{t('shell.requirement.save')}</Button>
				</div>
			{:else}
				<button class="words" onclick={edit} title={t('shell.requirement.edit')}>{r.text}</button>
			{/if}
			{#if shots.length}
				<div class="shots">
					{#each shots as src, i (i)}
						<a class="shot" href={src} target="_blank" rel="noreferrer"><img {src} alt="" /></a>
					{/each}
				</div>
			{/if}
			<div class="projects">
				<ProjectPick value={r.project ?? ''} projects={pickable} onChange={setProject} />
			</div>

			<div class="progress">
				<h5>
					<span>{t('shell.requirement.progress')}</span>
					{#if r.progress_at}<span>{t('shell.requirement.progressAt', { time: when(r.progress_at) })}</span>{/if}
				</h5>
				{#if r.progress}
					{#if r.progress.goal}
						<div class="sec"><span class="k">{t('shell.requirement.goal')}</span><div>{r.progress.goal}</div></div>
					{/if}
					{#each PROGRESS_SECTIONS as key (key)}
						{#if r.progress[key]?.length}
							<div class="sec">
								<span class="k">{t(SECTION_LABEL[key])}</span>
								<ul class:mono={key === 'files'}>
									{#each r.progress[key] as item, i (i)}<li>{item}</li>{/each}
								</ul>
							</div>
						{/if}
					{/each}
				{:else}
					<p class="muted">{t('shell.requirement.progressEmpty')}</p>
				{/if}
			</div>
		</div>

		<div class="right">
			<h5><span>{t('shell.requirement.sessionList')}</span></h5>
			{#if sessions.length}
				<div class="sessions">
					{#each [...sessions].reverse() as s (s.id)}
						<button class="sess" onclick={() => onOpenSession(s.id)}>
							<span class="mark {s.state ?? 'idle'}">
								{#if s.state === 'running'}<CircleNotchIcon size={12} class="spin" />{/if}
							</span>
							<span class="sess-main">
								<span class="sess-title">{s.title}</span>
								<span class="sess-sub">{[s.project, s.engine, sessionStateLabel(s.state), s.at ? when(s.at) : ''].filter(Boolean).join(' · ')}</span>
								{#if s.id === latest?.id && r.last_reply}
									<span class="tail">{r.last_reply}</span>
								{/if}
							</span>
						</button>
					{/each}
				</div>
				<h5 class="gap"><span>{t('shell.requirement.again')}</span></h5>
				<div class="again">
					<textarea bind:value={notes} rows="3" placeholder={t('shell.requirement.againPlaceholder')} onkeydown={onNotesKey}></textarea>
					<div class="again-foot">
						<ArrowBendDownRightIcon size={13} />
						<span class="target">{toNew ? t('shell.requirement.againNew') : t('shell.requirement.againTo')}</span>
						<button class="link" onclick={() => (chosenNew = !toNew)}>{toNew ? t('shell.requirement.toLatest') : t('shell.requirement.toNew')}</button>
						<span class="grow"></span>
						<Button size="sm" variant="primary" disabled={!notes.trim() || sending} onclick={sendNotes}>{t('shell.requirement.send')}</Button>
					</div>
				</div>
			{:else}
				<p class="muted">{t('shell.requirement.noSessions')}</p>
				<StartButton requirement={r} {projects} size="md" primary onStart={(how) => onStart(r, how)} />
			{/if}
		</div>
	</div>
</div>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.back,
	.icon {
		display: inline-flex;
		flex: none;
		padding: 6px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.back:hover,
	.icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.heading {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	h1 {
		margin: 0;
		min-width: 0;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.2;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.state {
		position: relative;
	}
	.state-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.dot.review,
	.dot.confirm,
	.dot.proposed,
	.dot.proposal {
		background: var(--warn);
	}
	.dot.approval,
	.dot.failed {
		background: var(--err);
	}
	.dot.running,
	.dot.open {
		background: var(--ok);
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 28px;
		align-items: start;
	}
	@media (max-width: 900px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	h5 {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--dim2);
	}
	h5.gap {
		margin-top: 22px;
	}
	.words {
		display: block;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.6;
		text-align: left;
		white-space: pre-wrap;
		cursor: text;
	}
	.words-edit,
	.again textarea {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 1.6;
		resize: vertical;
		outline: none;
	}
	.row-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 8px;
	}
	.shots {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}
	.shot {
		width: 120px;
		height: 76px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.shot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.projects {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}
	.waiting {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-sm);
	}
	.w-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.w-title {
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text);
	}
	.w-sub {
		font-size: var(--fs-xs);
		line-height: 1.55;
		color: var(--dim);
		white-space: pre-wrap;
	}
	.progress {
		margin-top: 22px;
		padding: 12px 14px 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--panel);
	}
	.sec {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--hairline);
		font-size: var(--fs-sm);
		line-height: 1.55;
		color: var(--text);
	}
	.sec:first-of-type {
		border-top: none;
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--dim2);
		padding-top: 2px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	ul.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.muted {
		margin: 4px 0 12px;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.sessions {
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--panel);
		overflow: hidden;
	}
	.sess {
		display: flex;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border: none;
		border-top: 1px solid var(--hairline);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.sess:first-child {
		border-top: none;
	}
	.sess:hover {
		background: var(--surface);
	}
	.mark {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 18px;
		color: var(--ok);
	}
	.mark.idle::before,
	.mark.waiting::before,
	.mark.failed::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.mark.waiting::before,
	.mark.failed::before {
		background: var(--err);
	}
	.sess-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sess-title {
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess-sub {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.tail {
		margin-top: 4px;
		font-size: var(--fs-xs);
		line-height: 1.55;
		color: var(--dim);
		white-space: pre-wrap;
		display: -webkit-box;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.again-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.grow {
		flex: 1;
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
</style>
