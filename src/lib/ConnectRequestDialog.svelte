<script lang="ts">
	// 「<device> 请求连接这台电脑」 with 允许 / 拒绝, over whatever the window
	// shows, for the oldest open connect request. It goes when decided here,
	// or when the daemon closes the request (decided elsewhere, expired, or
	// the device gave up).
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { clientKind, connectRequests } from '$lib/connectRequests.svelte';
	import { t } from '$lib/i18n';

	const request = $derived(connectRequests.open[0]);
	const kind = $derived(clientKind(request?.client));

	// A second click (or an Enter) meant for this request must not answer the
	// next one, which takes this one's place under the pointer.
	let deciding = $state(false);

	function decide(allow: boolean) {
		if (!request || deciding) return;
		deciding = true;
		connectRequests
			.decide(request.id, allow)
			.catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
			.finally(() => setTimeout(() => (deciding = false), 400));
	}
</script>

{#if request}
	<!-- No closing it without an answer: the request stays open on the computer.
	     Keyed so each request opens afresh, focus back on 拒绝. -->
	{#key request.id}
	<Modal label={t('shell.connectRequest.label')} width={420} dismissible={false} onClose={() => {}}>
		<h2>{t('shell.connectRequest.title', { name: request.name || (kind ? t(kind) : t('shell.connectRequest.device')) })}</h2>
		<p>{kind ? `${t(kind)} · ` : ''}{t('shell.connectRequest.hint')}</p>
		<!-- No autofocus on 允许: the dialog can open while the user is typing,
		     and an Enter meant for the composer must not let a device in. -->
		{#snippet footer()}
			<Button variant="ghost" disabled={deciding} onclick={() => decide(false)}>{t('shell.connectRequest.deny')}</Button>
			<Button variant="primary" disabled={deciding} onclick={() => decide(true)}>{t('shell.connectRequest.allow')}</Button>
		{/snippet}
	</Modal>
	{/key}
{/if}

<style>
	h2 {
		margin: 0 0 8px;
		font-size: var(--fs-lg);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.55;
	}
</style>
