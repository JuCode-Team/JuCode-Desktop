<script lang="ts">
	// The control at the end of a runtime-tool row: installed / install / open
	// the download page / needs Node. State lives in deps.svelte.ts.
	import { openUrl } from '@tauri-apps/plugin-opener';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import type { DepReport } from '$lib/protocol';
	import { deps, installDep } from '$lib/deps.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';

	let { dep }: { dep: DepReport } = $props();
	const manualUrls: Record<string, string> = {
		node: 'https://nodejs.org/en/download',
		git: 'https://git-scm.com/downloads'
	};
</script>

{#if dep.present}
	<span class="badge ok"><CheckIcon size={13} /> {t('setup.deps.installed')}</span>
{:else if deps.installing[dep.id]}
	<Button variant="secondary" size="sm" disabled>
		<CircleNotchIcon size={14} class="spin" /> {t('setup.deps.installing')}
	</Button>
{:else if dep.plan.kind === 'run' || dep.plan.kind === 'system-dialog'}
	<Button variant="primary" size="sm" onclick={() => installDep(dep)}>
		<DownloadSimpleIcon size={14} /> {deps.msgs[dep.id] && !deps.msgs[dep.id]?.ok ? t('setup.deps.retry') : t('setup.deps.install')}
	</Button>
{:else if dep.plan.kind === 'open-url'}
	<Button variant="secondary" size="sm" onclick={() => dep.plan.kind === 'open-url' && openUrl(dep.plan.url)}>
		<ArrowSquareOutIcon size={14} /> {t('setup.deps.openPage')}
	</Button>
{:else if dep.plan.kind === 'needs-prereq'}
	<span class="badge warn">{t('setup.deps.needsNode')}</span>
{:else}
	<span class="badge">{t('setup.deps.notInstalled')}</span>
{/if}

{#if !dep.present && manualUrls[dep.id]}
	<Button variant="ghost" size="sm" onclick={() => openUrl(manualUrls[dep.id])}>
		<ArrowSquareOutIcon size={14} /> {t('setup.deps.manualInstall')}
	</Button>
{/if}

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
	}
	.badge.ok {
		color: var(--ok);
	}
	.badge.warn {
		color: var(--warn);
	}
</style>
