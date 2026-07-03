<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ArrowLeft, ArrowRight, RotateCw, Globe, SquareDashedMousePointer } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { browser } from '$lib/browser.svelte';
	import { t } from '$lib/i18n';

	let placeholder = $state<HTMLElement | null>(null);
	let urlInput = $state(browser.url);

	// Follow real navigation in the URL bar (typing wins until nav happens
	// because this only rewrites when browser.url itself changes).
	$effect(() => {
		urlInput = browser.url;
	});

	function go(e: Event) {
		e.preventDefault();
		const u = urlInput.trim();
		if (u) browser.open(u);
	}

	// The native webview overlays this placeholder: keep its bounds synced.
	// ResizeObserver covers size changes (dock resize, tab hide via display:none
	// → 0×0, which hides the webview); a slow poll catches pure position shifts.
	$effect(() => {
		const el = placeholder;
		if (!el) return;
		const sync = () => {
			const r = el.getBoundingClientRect();
			browser.syncBounds({ x: r.left, y: r.top, w: r.width, h: r.height });
		};
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		window.addEventListener('resize', sync);
		const poll = setInterval(sync, 600);
		sync();
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', sync);
			clearInterval(poll);
		};
	});

	// Closing the tab destroys the webview.
	onDestroy(() => {
		browser.close();
	});
</script>

<div class="bp">
	<form class="bar" onsubmit={go}>
		<IconButton size="sm" type="button" onclick={() => browser.goBack()} label="back" title={t('dock.browser.back')}><ArrowLeft size={14} /></IconButton>
		<IconButton size="sm" type="button" onclick={() => browser.goForward()} label="forward" title={t('dock.browser.forward')}><ArrowRight size={14} /></IconButton>
		<IconButton size="sm" type="button" onclick={() => browser.reload()} label="reload" title={t('dock.browser.reload')}>
			<span class="spin" class:on={browser.loading}><RotateCw size={13} /></span>
		</IconButton>
		<input
			class="url"
			bind:value={urlInput}
			placeholder={t('dock.browser.urlPlaceholder')}
			spellcheck="false"
			autocomplete="off"
			onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
		/>
		<button
			type="button"
			class="pick"
			class:on={browser.picking}
			disabled={!browser.created}
			title={t('dock.browser.pick')}
			onclick={() => browser.setPicking(!browser.picking)}
		>
			<SquareDashedMousePointer size={14} />
		</button>
	</form>
	{#if browser.picking}
		<div class="pickhint">{t('dock.browser.pickHint')}</div>
	{/if}
	<div class="ph" bind:this={placeholder}>
		{#if !browser.created}
			<div class="empty">
				<Globe size={22} />
				<p>{t('dock.browser.empty')}</p>
				<span>{t('dock.browser.emptyHint')}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.bp {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 7px 8px;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.url {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 5px 8px;
		outline: none;
	}
	.url:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		flex-shrink: 0;
	}
	.pick:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.pick.on {
		color: var(--accent-bright);
		background: var(--accent-soft);
	}
	.pick:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.spin {
		display: inline-flex;
	}
	.spin.on {
		animation: rot 0.9s linear infinite;
	}
	@keyframes rot {
		to {
			transform: rotate(360deg);
		}
	}
	.pickhint {
		font-size: 11px;
		color: var(--accent-bright);
		background: var(--accent-soft);
		padding: 5px 10px;
		flex-shrink: 0;
	}
	.ph {
		flex: 1;
		min-height: 0;
		position: relative;
		background: var(--bg);
	}
	.empty {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 20px;
		color: var(--dim2);
		text-align: center;
	}
	.empty p {
		margin: 0;
		font-size: 13px;
		color: var(--dim);
	}
	.empty span {
		font-size: 11.5px;
	}
</style>
