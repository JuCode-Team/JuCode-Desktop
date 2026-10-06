<script lang="ts">
	// All first-run installations live here; agent/model steps only choose settings.
	import Dependencies from '$lib/Dependencies.svelte';
	import { deps } from '$lib/deps.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
</script>

<div class="group">
	<h3>{t('setup.welcome.env.required')}</h3>
	<p>{t('setup.welcome.env.requiredHint')}</p>
	<Dependencies ids={['node', 'git']} heading={false} />
</div>
<div class="group">
	<h3>{t('setup.welcome.env.engines')}</h3>
	<p>{t('setup.welcome.env.enginesHint')}</p>
	<Dependencies ids={['jucode', 'claude', 'codex']} heading={false} />
</div>
<div class="group">
	<h3>{t('setup.welcome.env.optional')}</h3>
	<p>{t('setup.welcome.env.optionalHint')}</p>
	<Dependencies ids={['ffmpeg', 'gh']} heading={false} />
</div>
{#if deps.error}<Notice>{deps.error}</Notice>{/if}

<style>
	.group + .group { margin-top: 24px; }
	h3 { margin: 0; font-size: var(--fs-sm); font-weight: 600; }
	p { margin: 4px 0 10px; font-size: var(--fs-xs); color: var(--dim); line-height: 1.5; }
</style>
