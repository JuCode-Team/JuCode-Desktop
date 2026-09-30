<script lang="ts">
	// Full-screen camera QR scanner for the phone PWA. A home-screen app on iOS
	// never receives links scanned by the system camera (they open in Safari),
	// so pairing from inside the installed app needs its own scanner.
	import { onMount } from 'svelte';
	import jsQR from 'jsqr';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

	let { onResult, onClose }: { onResult: (text: string) => void; onClose: () => void } = $props();

	let video = $state<HTMLVideoElement>();
	let error = $state('');

	onMount(() => {
		let stream: MediaStream | null = null;
		let frame = 0;
		let stopped = false;
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		function tick() {
			if (stopped || !video || !ctx) return;
			if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
				// Decode a downscaled frame: plenty for a QR code, cheap on phones.
				const scale = Math.min(1, 640 / video.videoWidth);
				canvas.width = Math.round(video.videoWidth * scale);
				canvas.height = Math.round(video.videoHeight * scale);
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
				const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
				if (hit?.data) {
					stopped = true;
					onResult(hit.data);
					return;
				}
			}
			frame = requestAnimationFrame(tick);
		}

		navigator.mediaDevices
			?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
			.then((s) => {
				stream = s;
				if (!video) return;
				video.srcObject = s;
				video.play().catch(() => {});
				frame = requestAnimationFrame(tick);
			})
			.catch(() => (error = t('shell.remote.cameraDenied')));
		if (!navigator.mediaDevices) error = t('shell.remote.cameraDenied');

		return () => {
			stopped = true;
			cancelAnimationFrame(frame);
			stream?.getTracks().forEach((track) => track.stop());
		};
	});
</script>

<div class="scanner" role="dialog" aria-label={t('shell.remote.scanQr')}>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted></video>
	<div class="frame" aria-hidden="true"></div>
	<button class="close" aria-label={t('common.close')} onclick={onClose}><XIcon size={22} /></button>
	<p class="hint">{t('shell.remote.scanAim')}</p>
	{#if error}<div class="err"><Notice>{error}</Notice></div>{/if}
</div>

<style>
	.scanner {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
		animation: fade var(--t-med) var(--ease-out);
	}
	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.frame {
		position: relative;
		width: min(68vw, 280px);
		aspect-ratio: 1;
		border-radius: var(--r-xl);
		box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
		outline: 2px solid rgba(255, 255, 255, 0.85);
	}
	.close {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 14px);
		right: 14px;
		display: inline-flex;
		padding: 10px;
		border: none;
		border-radius: var(--r-full);
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		cursor: pointer;
	}
	.hint {
		position: absolute;
		bottom: calc(env(safe-area-inset-bottom) + 48px);
		margin: 0;
		padding: 0 24px;
		color: #fff;
		font-size: var(--fs-md);
		text-align: center;
	}
	.err {
		position: absolute;
		bottom: calc(env(safe-area-inset-bottom) + 100px);
		left: 16px;
		right: 16px;
	}
</style>
