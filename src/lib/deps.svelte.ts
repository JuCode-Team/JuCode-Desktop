// Runtime tools (node, ffmpeg, the engine CLIs): detection and one-click
// install, shared so the settings engine rows and the tools list show the same
// install state and log. The install events are app-wide, so the listeners
// are registered once and stay.
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
	checkDependencies,
	runInstall,
	runUpgrade,
	type DepReport,
	type InstallStart,
	type InstallOutputEvent,
	type InstallDoneEvent
} from '$lib/protocol';
import { t } from '$lib/i18n';

export const deps = $state({
	list: [] as DepReport[],
	loading: false,
	installing: {} as Record<string, boolean>,
	/** The running install is an upgrade of an installed tool. */
	upgrading: {} as Record<string, boolean>,
	logs: {} as Record<string, string[]>,
	msgs: {} as Record<string, { text: string; ok: boolean } | null>,
	manualCmd: {} as Record<string, string>
});

let listening = false;
function listenOnce() {
	if (listening) return;
	listening = true;
	listen<InstallOutputEvent>('install-output', (e) => {
		const { id, line } = e.payload;
		// Cap the buffer so a chatty installer can't grow it unbounded.
		deps.logs[id] = [...(deps.logs[id] ?? []), line].slice(-400);
	});
	listen<InstallDoneEvent>('install-done', (e) => {
		const { id, success, code } = e.payload;
		deps.installing[id] = false;
		const upgrade = deps.upgrading[id];
		deps.upgrading[id] = false;
		if (success) {
			deps.msgs[id] = { text: t(upgrade ? 'setup.deps.upgradeOk' : 'setup.deps.doneOk'), ok: true };
			recheckDeps();
		} else {
			const key = upgrade ? 'setup.deps.upgradeFail' : 'setup.deps.doneFail';
			deps.msgs[id] = { text: t(key, { code: code ?? -1 }), ok: false };
		}
	});
}

// Pages mounting together share one probe instead of each running it.
let inflight: Promise<void> | null = null;
export function recheckDeps(): Promise<void> {
	listenOnce();
	inflight ??= (async () => {
		deps.loading = true;
		try {
			deps.list = await checkDependencies();
		} catch {
			/* ignore — leave the previous list */
		} finally {
			deps.loading = false;
			inflight = null;
		}
	})();
	return inflight;
}

export function installDep(dep: DepReport) {
	return runPlan(dep.id, () => runInstall(dep.id));
}

/** Upgrades the installed Claude Code / Codex (`binOverride`: the settings' pinned path). */
export function upgradeDep(id: string, binOverride?: string) {
	deps.upgrading[id] = true;
	return runPlan(id, () => runUpgrade(id, binOverride));
}

async function runPlan(id: string, run: () => Promise<InstallStart>) {
	listenOnce();
	deps.installing[id] = true;
	deps.logs[id] = [];
	deps.msgs[id] = null;
	deps.manualCmd[id] = '';
	try {
		const start = await run();
		if (start.kind === 'running') return; // install-done finishes it
		deps.installing[id] = false;
		deps.upgrading[id] = false;
		if (start.kind === 'system-dialog') deps.msgs[id] = { text: t('setup.deps.dialogOpened'), ok: true };
		else if (start.kind === 'manual-command') deps.manualCmd[id] = start.command;
		else if (start.kind === 'open-url') await openUrl(start.url);
		else if (start.kind === 'needs-prereq') deps.msgs[id] = { text: t('setup.deps.needsNode'), ok: false };
	} catch (e) {
		deps.installing[id] = false;
		deps.upgrading[id] = false;
		deps.msgs[id] = { text: t('setup.deps.startFailed', { e: String(e) }), ok: false };
	}
}

/** The command a 'manual' plan wants shown (from the plan, or from run_install). */
export function planCommand(dep: DepReport): string | null {
	if (deps.manualCmd[dep.id]) return deps.manualCmd[dep.id];
	if (dep.plan.kind === 'manual') return dep.plan.command;
	return null;
}
