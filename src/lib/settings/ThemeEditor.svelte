<script lang="ts">
	// Settings → custom themes: the list, and the editor of one theme. Edits
	// apply and save at once; while a theme is open, the whole app shows it
	// (previewTheme), whatever the light / dark mode.
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Select from '$lib/ui/Select.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import {
		BACKGROUND_BLUR,
		BACKGROUND_OPACITY,
		clearThemeImage,
		createTheme,
		deleteTheme,
		previewTheme,
		setThemeImage,
		themeState,
		updateTheme,
		type CustomTheme,
		type ThemeBackground
	} from '$lib/theme.svelte';
	import { contrast, normalizeHex } from '$lib/themeColors';

	const COLORS = [
		{ key: 'bg', hint: '' },
		{ key: 'text', hint: '' },
		{ key: 'accent', hint: 'settings.themes.accentHint' },
		{ key: 'brand', hint: 'settings.themes.brandHint' }
	] as const;
	const BLUR_LABELS = ['blurNone', 'blurLight', 'blurMedium', 'blurStrong'];

	let editing = $state<string | null>(null);
	let picker = $state<HTMLInputElement>();
	let saving = $state(false);

	const label = (theme: CustomTheme) => theme.name || t('settings.themes.untitled');

	function edit(id: string | null) {
		editing = id;
		previewTheme(id);
	}
	onDestroy(() => previewTheme(null));

	function add() {
		edit(createTheme(t('settings.themes.newName', { n: themeState.custom.length + 1 })).id);
	}

	async function remove(theme: CustomTheme) {
		const ok = await confirm({
			title: t('settings.themes.deleteTitle', { name: label(theme) }),
			message: t('settings.themes.deleteMessage'),
			confirmLabel: t('settings.themes.delete'),
			danger: true
		});
		if (!ok) return;
		edit(null);
		deleteTheme(theme.id);
	}

	function setHex(theme: CustomTheme, key: (typeof COLORS)[number]['key'], input: HTMLInputElement) {
		const hex = normalizeHex(input.value);
		if (hex) updateTheme(theme.id, { [key]: hex });
		else input.value = theme[key];
	}

	function setBackground(theme: CustomTheme, patch: Partial<ThemeBackground>) {
		if (theme.background) updateTheme(theme.id, { background: { ...theme.background, ...patch } });
	}

	async function pickImage(theme: CustomTheme, input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		saving = true;
		try {
			await setThemeImage(theme.id, file);
		} catch (e) {
			toast.show('error', t('settings.themes.imageFailed', { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			saving = false;
		}
	}
</script>

<div class="themes">
	{#each themeState.custom as theme (theme.id)}
		{@const open = editing === theme.id}
		<div class="theme" class:open>
			<div class="head">
				<span class="swatches" aria-hidden="true">
					{#each COLORS as c (c.key)}<span style:background={theme[c.key]}></span>{/each}
				</span>
				<span class="name">{label(theme)}</span>
				<Button size="sm" variant={open ? 'secondary' : 'ghost'} onclick={() => edit(open ? null : theme.id)}>
					{open ? t('settings.themes.done') : t('settings.themes.edit')}
				</Button>
			</div>
			{#if open}
				<div class="editor">
					<div class="field">
						<span class="lbl">{t('settings.themes.name')}</span>
						<TextField bind:value={() => theme.name, (v) => updateTheme(theme.id, { name: String(v ?? '') })} />
					</div>
					{#each COLORS as c (c.key)}
						<div class="field">
							<span class="lbl">
								{t(`settings.themes.${c.key}`)}
								{#if c.hint}<small>{t(c.hint)}</small>{/if}
							</span>
							<span class="color">
								<input
									class="swatch"
									type="color"
									value={theme[c.key]}
									aria-label={t(`settings.themes.${c.key}`)}
									oninput={(e) => updateTheme(theme.id, { [c.key]: e.currentTarget.value })}
								/>
								<input class="hex" value={theme[c.key]} spellcheck="false" onchange={(e) => setHex(theme, c.key, e.currentTarget)} />
							</span>
						</div>
					{/each}
					{#if contrast(theme.text, theme.bg) < 4.5}
						<p class="warn">{t('settings.themes.lowContrastText', { ratio: contrast(theme.text, theme.bg).toFixed(1) })}</p>
					{/if}
					{#if contrast(theme.brand, theme.bg) < 3}
						<p class="warn">{t('settings.themes.lowContrastBrand', { ratio: contrast(theme.brand, theme.bg).toFixed(1) })}</p>
					{/if}

					<div class="field image">
						<span class="lbl">
							{t('settings.themes.image')}
							<small>{t('settings.themes.imageHint')}</small>
						</span>
						<span class="actions">
							{#if theme.background}
								<Button size="sm" variant="ghost" disabled={saving} onclick={() => clearThemeImage(theme.id)}>{t('settings.themes.removeImage')}</Button>
							{/if}
							<Button size="sm" disabled={saving} onclick={() => picker?.click()}>
								{theme.background ? t('settings.themes.replaceImage') : t('settings.themes.pickImage')}
							</Button>
						</span>
						<input bind:this={picker} type="file" accept="image/*" hidden onchange={(e) => pickImage(theme, e.currentTarget)} />
					</div>
					{#if theme.background}
						{@const bg = theme.background}
						<div class="field">
							<span class="lbl">{t('settings.themes.fit')}</span>
							<Segmented
								value={bg.fit}
								options={[
									{ value: 'cover', label: t('settings.themes.fitCover') },
									{ value: 'contain', label: t('settings.themes.fitContain') },
									{ value: 'tile', label: t('settings.themes.fitTile') }
								]}
								onChange={(v) => setBackground(theme, { fit: v as ThemeBackground['fit'] })}
							/>
						</div>
						<div class="field">
							<span class="lbl">{t('settings.themes.opacity')}</span>
							<Select
								value={String(bg.opacity)}
								options={BACKGROUND_OPACITY.map((n) => ({ value: String(n), label: `${n}%` }))}
								onChange={(v) => setBackground(theme, { opacity: Number(v) })}
							/>
						</div>
						<div class="field">
							<span class="lbl">{t('settings.themes.blur')}</span>
							<Segmented
								value={String(bg.blur)}
								options={BACKGROUND_BLUR.map((px, i) => ({ value: String(px), label: t(`settings.themes.${BLUR_LABELS[i]}`) }))}
								onChange={(v) => setBackground(theme, { blur: Number(v) })}
							/>
						</div>
					{/if}

					<div class="foot">
						<Button size="sm" variant="ghost" onclick={() => remove(theme)}>{t('settings.themes.delete')}</Button>
					</div>
				</div>
			{/if}
		</div>
	{/each}
	<div>
		<Button size="sm" onclick={add}>{t('settings.themes.new')}</Button>
	</div>
</div>

<style>
	.themes {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.theme {
		border-radius: var(--r);
		background: var(--surface);
		transition: background var(--t-fast) var(--ease-out);
	}
	.theme.open {
		background: var(--surface2);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 6px 6px 12px;
	}
	.swatches {
		display: flex;
	}
	.swatches span {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		/* The inner line keeps a dot the color of the panel visible. */
		box-shadow:
			0 0 0 1.5px var(--panel),
			inset 0 0 0 1px var(--border-strong);
	}
	.swatches span + span {
		margin-left: -4px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		color: var(--text);
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 6px 12px 12px;
	}
	.field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 34px;
	}
	.field > :global(.tf) {
		max-width: 240px;
	}
	.lbl {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		font-size: var(--fs-sm);
		color: var(--text);
	}
	.lbl small {
		max-width: 52ch;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.color,
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.swatch {
		width: 30px;
		height: 30px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: none;
		cursor: pointer;
	}
	.swatch::-webkit-color-swatch-wrapper {
		padding: 3px;
	}
	.swatch::-webkit-color-swatch {
		border: none;
		border-radius: calc(var(--r) - 4px);
	}
	.hex {
		width: 92px;
		padding: 6px 9px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		outline: none;
	}
	.hex:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.warn {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--warn);
	}
	.image {
		padding-top: 6px;
		border-top: 1px solid var(--hairline);
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		padding-top: 6px;
		border-top: 1px solid var(--hairline);
	}
</style>
