<script lang="ts">
	// The web app (app.jucode.net): signed out, the sign-in page; signed in,
	// the conversations on the left and the open one on the right. On a
	// narrow screen the sidebar is a drawer.
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { auth, type Account } from '$lib/web/auth.svelte';
	import { json } from '$lib/web/api';
	import { models } from '$lib/web/models.svelte';
	import { chat } from '$lib/web/chat.svelte';
	import { t } from '$lib/i18n';
	import Sidebar from '$lib/web/Sidebar.svelte';
	import SignIn from '$lib/web/SignIn.svelte';
	import Toaster from '$lib/ui/Toaster.svelte';
	import ConfirmHost from '$lib/ui/ConfirmHost.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { shell } from '$lib/web/shell.svelte';

	let { children }: { children: Snippet } = $props();

	// Signed in (now or in another tab): who, what to chat with, the history.
	$effect(() => {
		if (!auth.signedIn) return;
		json<Account>('/v1/oauth/userinfo').then(
			(a) => (auth.account = a),
			() => {}
		);
		void models.load();
		chat.loadList().catch((e) => toast.error(t('web.chat.loadFailed', { msg: e instanceof Error ? e.message : String(e) })));
	});

	// A page opened from the drawer closes it.
	$effect(() => {
		void page.url.pathname;
		shell.drawer = false;
	});
</script>

<svelte:head><title>{chat.title || 'JuCode'}</title></svelte:head>

{#if !auth.signedIn}
	<SignIn />
{:else}
	<div class="web" class:collapsed={shell.collapsed}>
		{#if shell.drawer}<button class="scrim" aria-label={t('web.side.collapse')} onclick={() => (shell.drawer = false)}></button>{/if}
		<div class="side" class:open={shell.drawer} inert={shell.collapsed && !shell.drawer ? true : undefined}>
			<Sidebar />
		</div>
		<main class="main">
			{@render children()}
		</main>
	</div>
{/if}
<Toaster />
<ConfirmHost />

<style>
	.web {
		display: grid;
		grid-template-columns: 264px minmax(0, 1fr);
		height: 100dvh;
		background: var(--bg);
		color: var(--text);
		transition: grid-template-columns var(--t-med) var(--ease-out);
	}
	.web.collapsed {
		grid-template-columns: 0 minmax(0, 1fr);
	}
	.side {
		min-width: 0;
		overflow: hidden;
		border-right: 1px solid var(--hairline);
		background: var(--panel);
	}
	.web.collapsed .side {
		border-right: none;
	}
	.main {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.scrim {
		display: none;
	}
	@media (max-width: 760px) {
		.web,
		.web.collapsed {
			grid-template-columns: minmax(0, 1fr);
		}
		.side {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 40;
			width: min(300px, 86vw);
			transform: translateX(-100%);
			transition: transform var(--t-med) var(--ease-out);
			box-shadow: var(--shadow-pop);
		}
		.side.open {
			transform: none;
		}
		.web.collapsed .side {
			border-right: 1px solid var(--hairline);
		}
		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 39;
			border: none;
			background: var(--scrim);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.web,
		.side {
			transition: none;
		}
	}
</style>
