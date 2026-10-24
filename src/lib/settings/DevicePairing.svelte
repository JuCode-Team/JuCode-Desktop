<script lang="ts">
	// Settings → 智能体 → 远程访问 (rows inside a SettingsSection). Remote
	// access is part of the JuCode account: signed out (relay_status
	// `signed_in: false`), a sign-in prompt; signed in, the relay switch and
	// status (relay_status / relay_set), "add device" with a QR code of a
	// one-time pairing link (pair_link), and the paired devices with their
	// kind (phone app, web, desktop) and revoke.
	import { onDestroy, onMount } from 'svelte';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import XIcon from '@lucide/svelte/icons/x';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import { renderSVG } from 'uqr';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { daemon } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import { clientKind } from '$lib/connectRequests.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let {
		onLogin,
		loggingIn = false
	}: {
		/** The app's JuCode sign-in (the daemon reads the same account). */
		onLogin: () => void;
		loggingIn?: boolean;
	} = $props();

	/** `client`: the OAuth client it connected with (older daemons leave it out). */
	type Device = { id: string; name: string; paired_at: number; client?: string };
	/** `signed_in` undefined: a daemon from before account remote access
	 *  (unknown, so the controls show). */
	type RelayStatus = { enabled: boolean; connected: boolean; signed_in?: boolean; host?: string; url?: string };
	let devices = $state<Device[]>([]);
	/** The pairing on show: its code, expiry and what the QR code holds. */
	let pairing = $state<{ code: string; expires_at: number; link: string } | null>(null);
	let relay = $state<RelayStatus | null>(null);
	let relayError = $state('');
	let relayOn = $state(false);
	let error = $state('');
	let copied = $state(false);
	let now = $state(Date.now());
	let poll: ReturnType<typeof setInterval> | null = null;
	let tick: ReturnType<typeof setInterval> | null = null;
	let statusPoll: ReturnType<typeof setInterval> | null = null;

	const signedOut = $derived(relay?.signed_in === false);
	const qr = $derived(pairing?.link ? renderSVG(pairing.link) : '');
	const remaining = $derived.by(() => {
		if (!pairing) return '';
		const s = Math.max(0, Math.round((pairing.expires_at - now) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	function message(e: unknown) {
		return e instanceof Error ? e.message : String(e);
	}

	async function loadRelay() {
		try {
			const reply = await daemon.request({ op: 'relay_status' });
			relay = {
				enabled: Boolean(reply.enabled),
				connected: Boolean(reply.connected),
				signed_in: typeof reply.signed_in === 'boolean' ? reply.signed_in : undefined,
				host: typeof reply.host === 'string' ? reply.host : undefined,
				url: typeof reply.url === 'string' ? reply.url : undefined
			};
			relayOn = relay.enabled;
			relayError = '';
		} catch (e) {
			relay = null;
			relayError = message(e);
		}
	}

	async function setRelay(enabled: boolean) {
		try {
			await daemon.request({ op: 'relay_set', enabled });
		} catch (e) {
			relayError = message(e);
		}
		await loadRelay();
	}

	async function refresh() {
		try {
			const reply = await daemon.request({ op: 'device_list' });
			const next = (reply.devices as Device[]) ?? [];
			// A new device means the shown code was just used.
			if (pairing && next.length > devices.length) stopPairing();
			devices = next;
			error = '';
		} catch (e) {
			error = message(e);
		}
	}

	async function addDevice() {
		try {
			const reply = await daemon.request({ op: 'pair_link' });
			pairing = { code: String(reply.code), expires_at: Number(reply.expires_at), link: String(reply.link) };
			now = Date.now();
			copied = false;
			poll = setInterval(() => {
				if (pairing && Date.now() > pairing.expires_at) stopPairing();
				else void refresh();
			}, 3000);
			tick = setInterval(() => (now = Date.now()), 1000);
		} catch (e) {
			error = message(e);
		}
	}

	function stopPairing() {
		pairing = null;
		if (poll) clearInterval(poll);
		if (tick) clearInterval(tick);
		poll = tick = null;
	}

	async function copyLink() {
		if (!pairing?.link) return;
		try {
			await navigator.clipboard.writeText(pairing.link);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (e) {
			error = message(e);
		}
	}

	async function revoke(device: Device) {
		try {
			await daemon.request({ op: 'device_revoke', device: device.id });
			await refresh();
		} catch (e) {
			error = message(e);
		}
	}

	onMount(() => {
		void refresh();
		void loadRelay();
		// The relay connects in the background; keep the status line current.
		statusPoll = setInterval(() => void loadRelay(), 5000);
	});
	onDestroy(() => {
		stopPairing();
		if (statusPoll) clearInterval(statusPoll);
	});
</script>

{#if signedOut}
	<SettingsRow id="relay" title={t('settings.backend.signInPrompt')}>
		<Button size="sm" variant="primary" disabled={loggingIn} onclick={onLogin}><LogInIcon size={14} /> {loggingIn ? t('settings.account.authorizing') : t('settings.backend.signIn')}</Button>
	</SettingsRow>
{:else}
	<SettingsRow id="relay" title={t('settings.backend.relayToggle')} description={t('settings.backend.relayHint')}>
		{#snippet detail()}
			<span class="status">
				{#if relayError}
					<span class="warn">{t('settings.backend.relayUnavailable', { error: relayError })}</span>
				{:else if relay?.enabled && relay.connected}
					<span class="dot ok"></span>{t('settings.backend.relayConnected', { host: relay.host ?? '' })}
				{:else if relay?.enabled}
					<span class="dot wait pulse"></span>{t('settings.backend.relayConnecting')}
				{:else if relay}
					<span class="dot"></span>{t('settings.backend.relayOff')}
				{/if}
			</span>
		{/snippet}
		<Switch bind:checked={relayOn} label={t('settings.backend.relayToggle')} onChange={setRelay} />
	</SettingsRow>

	<SettingsRow id="devices" title={t('settings.backend.devices')} description={t('settings.backend.devicesHint')}>
		{#if !pairing && relay?.enabled}
			<Button size="sm" onclick={addDevice}><SmartphoneIcon size={14} /> {t('settings.backend.addDevice')}</Button>
		{/if}
	</SettingsRow>

	{#if pairing}
		<SettingsRow stacked>
			<div class="code">
				{#if qr}
					<!-- SVG generated locally from the daemon's pairing link, no outside input. -->
					<div class="qr">{@html qr}</div>
				{/if}
				<div class="code-text">
					<strong>{t('settings.backend.addDevice')}</strong>
					<span>{t('settings.backend.pairLinkScan')}</span>
					<span class="expires">{t('settings.backend.pairExpires', { time: remaining })}</span>
					{#if pairing.link}
						<div class="link-row">
							<code class="link" title={pairing.link}>{pairing.link}</code>
							<Button size="sm" onclick={copyLink}>
								{#if copied}<CheckIcon size={14} /> {t('settings.backend.copied')}{:else}<CopyIcon size={14} /> {t('settings.backend.copyLink')}{/if}
							</Button>
						</div>
					{/if}
				</div>
				<span class="close"><IconButton onclick={stopPairing} label={t('common.close')}><XIcon size={14} /></IconButton></span>
			</div>
		</SettingsRow>
	{/if}

	<SettingsRow stacked>
		<div class="devices">
			{#if devices.length === 0}
				<span class="none">{t('settings.backend.noDevices')}</span>
			{/if}
			{#each devices as device (device.id)}
				<div class="device">
					<SmartphoneIcon size={14} />
					<span class="name">{device.name}</span>
					{#if clientKind(device.client)}<span class="kind">{t(clientKind(device.client))}</span>{/if}
					<span class="when">{new Date(device.paired_at).toLocaleDateString()}</span>
					<Button size="sm" variant="ghost" onclick={() => revoke(device)}>{t('settings.backend.revoke')}</Button>
				</div>
			{/each}
			{#if error}<Notice>{error}</Notice>{/if}
		</div>
	</SettingsRow>

{/if}

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim);
	}
	.warn {
		color: var(--warn);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.dot.ok {
		background: var(--ok);
	}
	.dot.wait {
		background: var(--accent-bright);
	}
	.code {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}
	.qr {
		width: 156px;
		height: 156px;
		padding: 8px;
		border-radius: var(--r);
		/* QR codes need a light background to scan reliably in dark themes. */
		background: #fff;
		flex-shrink: 0;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
	}
	.code-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim);
	}
	.code-text strong {
		font-size: var(--fs-sm);
		color: var(--text);
		font-weight: 600;
	}
	.expires {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.link-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
		min-width: 0;
	}
	.link {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: var(--surface2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.devices {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--fs-sm);
	}
	.none {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.device {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 32px;
		color: var(--dim);
	}
	.name {
		flex: 1;
		color: var(--text);
	}
	.kind {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.when {
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
	}
	.close {
		display: inline-flex;
		align-self: flex-start;
	}
	/* macOS: close first, as the window's own close button. */
	:global(:root[data-os='macos']) .close {
		order: -1;
	}
</style>
