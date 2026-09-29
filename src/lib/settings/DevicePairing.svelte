<script lang="ts">
	// Pair a phone with the local jucode daemon: a one-time code (and a QR
	// code of the phone address + code), and the paired devices with revoke.
	import { onDestroy, onMount } from 'svelte';
	import { Smartphone, X } from 'lucide-svelte';
	import { renderSVG } from 'uqr';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { daemon } from '$lib/protocol';
	import { t } from '$lib/i18n';

	let {
		address = $bindable(),
		onAddressChange
	}: { address: string; onAddressChange: () => void } = $props();

	type Device = { id: string; name: string; paired_at: number };
	let devices = $state<Device[]>([]);
	let code = $state<{ code: string; expires_at: number } | null>(null);
	let error = $state('');
	let poll: ReturnType<typeof setInterval> | null = null;

	const base = $derived(address.trim().replace(/\/+$/, ''));
	const qr = $derived(code && base ? renderSVG(`${base}/remote?pair=${code.code}`) : '');

	async function refresh() {
		try {
			const reply = await daemon.request({ op: 'device_list' });
			const next = (reply.devices as Device[]) ?? [];
			// A new device means the shown code was just used.
			if (code && next.length > devices.length) stopPairing();
			devices = next;
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function addDevice() {
		try {
			const reply = await daemon.request({ op: 'pair_start' });
			code = { code: String(reply.code), expires_at: Number(reply.expires_at) };
			poll = setInterval(() => {
				if (code && Date.now() > code.expires_at) stopPairing();
				else void refresh();
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function stopPairing() {
		code = null;
		if (poll) clearInterval(poll);
		poll = null;
	}

	async function revoke(device: Device) {
		try {
			await daemon.request({ op: 'device_revoke', device: device.id });
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(refresh);
	onDestroy(stopPairing);
</script>

<div class="pairing">
	<label class="field">
		<span>{t('settings.backend.remoteLabel')}</span>
		<input
			bind:value={address}
			placeholder={t('settings.backend.remotePlaceholder')}
			onchange={onAddressChange}
		/>
	</label>
	<p class="hint">{t('settings.backend.remoteHint')}</p>

	{#if code}
		<div class="code">
			{#if qr}
				<!-- SVG generated locally from the address and code, no outside input. -->
				<div class="qr">{@html qr}</div>
			{/if}
			<div class="code-text">
				<strong>{t('settings.backend.pairCode', {
					code: code.code,
					minutes: String(Math.max(1, Math.round((code.expires_at - Date.now()) / 60000)))
				})}</strong>
				<span>{base ? t('settings.backend.pairScan', { address: base }) : t('settings.backend.pairNoAddress')}</span>
			</div>
			<IconButton onclick={stopPairing} label="close"><X size={14} /></IconButton>
		</div>
	{:else}
		<Button size="sm" onclick={addDevice}><Smartphone size={13} /> {t('settings.backend.addDevice')}</Button>
	{/if}

	<div class="devices">
		<span class="label">{t('settings.backend.devices')}</span>
		{#if devices.length === 0}
			<span class="none">{t('settings.backend.noDevices')}</span>
		{/if}
		{#each devices as device (device.id)}
			<div class="device">
				<Smartphone size={13} />
				<span class="name">{device.name}</span>
				<span class="when">{new Date(device.paired_at).toLocaleDateString()}</span>
				<Button size="sm" onclick={() => revoke(device)}>{t('settings.backend.revoke')}</Button>
			</div>
		{/each}
	</div>
	{#if error}<Notice>{error}</Notice>{/if}
</div>

<style>
	.pairing {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.field input {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		padding: 7px 10px;
		outline: none;
	}
	.field input::placeholder {
		color: var(--dim2);
	}
	.field input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim2);
		line-height: 1.5;
	}
	.code {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.qr {
		width: 148px;
		height: 148px;
		padding: 6px;
		border-radius: var(--r-sm);
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
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.code-text strong {
		font-family: var(--font-mono);
		color: var(--text);
		font-weight: 600;
	}
	.devices {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-sm);
	}
	.label {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.none {
		color: var(--dim2);
	}
	.device {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.name {
		flex: 1;
	}
	.when {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
</style>
