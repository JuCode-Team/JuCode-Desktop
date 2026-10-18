<script lang="ts">
	// Settings → 后台服务 → JuCode 工具: the tools the daemon gives every
	// agent (present_files, propose_schedule, the session tools), switched in
	// groups. The daemon keeps the switches (`app_tools` / `app_tools_set`)
	// and applies them to engines it starts afterwards.
	import { onMount } from 'svelte';
	import { daemon } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import Switch from '$lib/ui/Switch.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import SettingsSection from './SettingsSection.svelte';

	type Key = 'present_files' | 'propose_schedule' | 'sessions';
	const ROWS: { key: Key; id: string; title: string; hint: string }[] = [
		{ key: 'present_files', id: 'app-tools-present', title: 'settings.appTools.presentFiles', hint: 'settings.appTools.presentFilesHint' },
		{ key: 'propose_schedule', id: 'app-tools-schedule', title: 'settings.appTools.proposeSchedule', hint: 'settings.appTools.proposeScheduleHint' },
		{ key: 'sessions', id: 'app-tools-sessions', title: 'settings.appTools.sessions', hint: 'settings.appTools.sessionsHint' }
	];

	let on = $state<Record<Key, boolean> | null>(null);
	let error = $state('');

	function take(reply: Record<string, unknown>) {
		on = { present_files: reply.present_files !== false, propose_schedule: reply.propose_schedule !== false, sessions: reply.sessions !== false };
		error = '';
	}

	async function load() {
		try {
			take(await daemon.request({ op: 'app_tools' }));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function set(key: Key, on: boolean) {
		try {
			take(await daemon.request({ op: 'app_tools_set', [key]: on }));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			await load();
		}
	}

	onMount(load);
</script>

<SettingsSection title={t('settings.appTools.title')} description={t('settings.appTools.hint')}>
	{#if on}
		{#each ROWS as row (row.key)}
			<SettingsRow id={row.id} title={t(row.title)} description={t(row.hint)}>
				<Switch checked={on[row.key]} label={t(row.title)} onChange={(value) => set(row.key, value)} />
			</SettingsRow>
		{/each}
	{/if}
	{#if error}
		<SettingsRow description={t('settings.appTools.loadFailed', { msg: error })} />
	{/if}
</SettingsSection>
