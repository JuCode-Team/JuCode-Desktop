<script lang="ts">
	// Settings → Appearance: the color scheme as three preview cards, the themes
	// as a gallery (the built-in one and the user's), the editor of the open
	// theme, and the interface rows (frosted sidebar, fonts, terminal).
	import { onDestroy } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { t } from '$lib/i18n';
	import { prefs, vibrancySupported } from '$lib/prefs.svelte';
	import { FONT_CHOICES, type FontChoice, type FontSlot } from '$lib/fonts';
	import FontPicker from './FontPicker.svelte';
	import { createTheme, previewTheme, setTheme, setThemeSlot, themeState, type CustomTheme, type ThemePref } from '$lib/theme.svelte';
	import { BUILTIN_SEEDS, isDark, type ThemeSeeds } from '$lib/themeColors';
	import Button from '$lib/ui/Button.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import ThemeEditor from './ThemeEditor.svelte';

	type Mode = 'light' | 'dark';
	const MODES: Mode[] = ['light', 'dark'];
	const SCHEMES: ThemePref[] = ['system', 'light', 'dark'];

	// The colors each mode shows: its custom theme, else the built-in one.
	const seedsOf = (mode: Mode): ThemeSeeds => themeState.custom.find((c) => c.id === themeState[mode]) ?? BUILTIN_SEEDS[mode];
	const vars = (s: ThemeSeeds) => `--m-bg:${s.bg};--m-text:${s.text};--m-brand:${s.brand}`;
	const label = (theme: CustomTheme) => theme.name || t('settings.themes.untitled');

	// A custom theme goes into the mode on screen when that is fixed; following
	// the system, into the mode matching its background.
	const slotFor = (theme: CustomTheme): Mode => (themeState.pref === 'system' ? (isDark(theme.bg) ? 'dark' : 'light') : themeState.pref);

	let editing = $state<string | null>(null);
	const editingTheme = $derived(themeState.custom.find((c) => c.id === editing));

	function edit(id: string | null) {
		editing = id;
		previewTheme(id);
	}
	onDestroy(() => previewTheme(null));

	function add() {
		edit(createTheme(t('settings.themes.newName', { n: themeState.custom.length + 1 })).id);
	}

	const fontLabel = (slot: FontSlot, c: FontChoice) =>
		c.id === 'system'
			? t('settings.behavior.fontSystem')
			: c.id === 'serif'
				? t('settings.behavior.fontSerif')
				: t(slot === 'chat' ? 'settings.behavior.fontFollowUi' : 'settings.behavior.fontDefault');
</script>

{#snippet mock(mode: Mode)}
	<div class="mock" style={vars(seedsOf(mode))}>
		<div class="m-side"><i></i><i></i><i></i></div>
		<div class="m-main">
			<i class="m-line"></i>
			<i class="m-line short"></i>
			<div class="m-input"><b></b></div>
		</div>
	</div>
{/snippet}

{#snippet orb(seeds: ThemeSeeds)}
	<span class="orb" style={vars(seeds)}></span>
{/snippet}

<section class="block" id="set-theme">
	<h3>{t('settings.themes.scheme')}</h3>
	<div class="schemes" role="radiogroup" aria-label={t('settings.themes.scheme')}>
		{#each SCHEMES as pref (pref)}
			<button class="scheme" class:on={themeState.pref === pref} role="radio" aria-checked={themeState.pref === pref} onclick={() => setTheme(pref)}>
				<span class="frame">
					{#if pref === 'system'}
						{@render mock('light')}
						<span class="half">{@render mock('dark')}</span>
					{:else}
						{@render mock(pref)}
					{/if}
				</span>
				<span class="cap">{t(`settings.theme${pref[0].toUpperCase()}${pref.slice(1)}`)}</span>
			</button>
		{/each}
	</div>
</section>

<section class="block" id="set-custom-themes">
	<div class="head">
		<div class="txt">
			<h3>{t('settings.themes.gallery')}</h3>
			<p>{t('settings.themes.customHint')}</p>
		</div>
		<Button size="sm" onclick={add}><PlusIcon size={14} /> {t('settings.themes.new')}</Button>
	</div>
	<div class="gallery">
		<div class="tcard">
			<div class="orbs">
				{#each MODES as mode (mode)}
					<button
						class="pick"
						class:on={!themeState[mode]}
						title={t(mode === 'light' ? 'settings.themes.builtinLight' : 'settings.themes.builtinDark')}
						aria-label={t(mode === 'light' ? 'settings.themes.builtinLight' : 'settings.themes.builtinDark')}
						aria-pressed={!themeState[mode]}
						onclick={() => setThemeSlot(mode, '')}
					>
						{@render orb(BUILTIN_SEEDS[mode])}
					</button>
				{/each}
			</div>
			<div class="tfoot"><span class="tname">JuCode</span></div>
		</div>
		{#each themeState.custom as theme (theme.id)}
			{@const slots = MODES.filter((m) => themeState[m] === theme.id)}
			<div class="tcard" class:editing={editing === theme.id}>
				<div class="orbs">
					<button
						class="pick"
						class:on={slots.length > 0}
						title={label(theme)}
						aria-label={label(theme)}
						aria-pressed={slots.length > 0}
						onclick={() => setThemeSlot(slotFor(theme), theme.id)}
					>
						{@render orb(theme)}
					</button>
					{#if slots.length}
						<span class="slots">
							{#each slots as m (m)}
								<span title={t(`settings.themes.${m}Slot`)}>
									{#if m === 'light'}<SunIcon size={11} />{:else}<MoonIcon size={11} />{/if}
								</span>
							{/each}
						</span>
					{/if}
				</div>
				<div class="tfoot">
					<span class="tname">{label(theme)}</span>
					<button
						class="tedit"
						title={t('settings.themes.edit')}
						aria-label={t('settings.themes.edit')}
						aria-pressed={editing === theme.id}
						onclick={() => edit(editing === theme.id ? null : theme.id)}
					>
						<PencilIcon size={14} />
					</button>
				</div>
			</div>
		{/each}
	</div>
	{#if editingTheme}
		<div class="editor-card">
			<ThemeEditor theme={editingTheme} onDone={() => edit(null)} />
		</div>
	{/if}
</section>

<SettingsSection title={t('settings.page.interface')}>
	{#if vibrancySupported()}
		<SettingsRow id="vibrancy" title={t('settings.behavior.vibrancy')} description={t('settings.behavior.vibrancyHint')}>
			<Switch checked={prefs.sidebarVibrancy} label={t('settings.behavior.vibrancy')} onChange={(on) => prefs.setSidebarVibrancy(on)} />
		</SettingsRow>
	{/if}
	<SettingsRow id="session-agent-icon" title={t('settings.behavior.sessionAgentIcon')} description={t('settings.behavior.sessionAgentIconHint')}>
		<Switch checked={prefs.sessionAgentIcon} label={t('settings.behavior.sessionAgentIcon')} onChange={(on) => prefs.setFlag('sessionAgentIcon', on)} />
	</SettingsRow>
</SettingsSection>

<SettingsSection title={t('settings.page.fonts')}>
	{#each [['ui', 'ui-font', 'uiFont'], ['chat', 'chat-font', 'chatFont'], ['code', 'code-font', 'codeFont']] as const as [slot, id, key] (slot)}
		<SettingsRow {id} title={t(`settings.behavior.${key}`)} description={t(`settings.behavior.${key}Hint`)}>
			<FontPicker
				value={prefs[key]}
				generic={FONT_CHOICES[slot].map((c) => ({ id: c.id, label: fontLabel(slot, c) }))}
				mono={slot === 'code'}
				onChange={(v) => prefs.setFont(slot, v)}
			/>
		</SettingsRow>
	{/each}
	<SettingsRow id="terminal-font" title={t('settings.behavior.terminalFont')} description={t('settings.behavior.terminalFontHint')}>
		<FontPicker value={prefs.terminalFont} generic={[{ id: '', label: t('settings.behavior.fontDefault') }]} mono onChange={(v) => prefs.setTerminalFont(v)} />
	</SettingsRow>
	<SettingsRow id="terminal-font-size" title={t('settings.behavior.terminalFontSize')}>
		<Select
			value={String(prefs.terminalFontSize)}
			options={[10, 11, 12, 12.5, 13, 14, 15, 16, 18, 20].map((n) => ({ value: String(n) }))}
			onChange={(v) => prefs.setTerminalFontSize(Number(v))}
		/>
	</SettingsRow>
</SettingsSection>

<style>
	.block {
		margin-top: 28px;
		scroll-margin: 24px;
		border-radius: var(--r);
	}
	.block:global(.flash) {
		animation: flash 1.6s var(--ease-out);
	}
	@keyframes flash {
		0%,
		40% {
			box-shadow: 0 0 0 3px var(--accent-soft);
		}
		100% {
			box-shadow: 0 0 0 3px transparent;
		}
	}
	h3 {
		margin: 0 2px 10px;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		margin: 0 2px 10px;
	}
	.head h3 {
		margin: 0;
	}
	.head p {
		margin: 3px 0 0;
		max-width: 64ch;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.head > :global(:not(.txt)) {
		flex-shrink: 0;
	}

	/* ---------- color scheme ---------- */
	.schemes {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	.scheme {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 8px 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition:
			border-color var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.scheme:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.scheme.on {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
		color: var(--text);
	}
	.frame {
		position: relative;
		display: block;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: calc(var(--r) - 3px);
	}
	/* Outline above the miniature, so a dark one still shows on a dark page. */
	.frame::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px var(--border);
		pointer-events: none;
	}
	.half {
		position: absolute;
		inset: 0;
		clip-path: inset(0 0 0 50%);
	}
	/* A miniature window in the mode's own colors (--m-*). */
	.mock {
		position: absolute;
		inset: 0;
		display: flex;
		background: var(--m-bg);
	}
	.mock i,
	.mock b {
		display: block;
	}
	.m-side {
		display: flex;
		flex-direction: column;
		gap: 5px;
		width: 24%;
		padding: 10% 5%;
		background: color-mix(in srgb, var(--m-text) 4%, var(--m-bg));
		border-right: 1px solid color-mix(in srgb, var(--m-text) 8%, var(--m-bg));
	}
	.m-side i {
		height: 5px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--m-text) 12%, var(--m-bg));
	}
	.m-side i:first-child {
		width: 70%;
	}
	.m-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12% 8% 8%;
	}
	.m-line {
		width: 75%;
		height: 6px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--m-text) 16%, var(--m-bg));
	}
	.m-line.short {
		width: 48%;
	}
	.m-input {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		height: 16%;
		margin-top: auto;
		padding: 0 4px;
		border: 1px solid color-mix(in srgb, var(--m-text) 14%, var(--m-bg));
		border-radius: 6px;
	}
	.m-input b {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--m-brand);
	}
	.cap {
		text-align: center;
	}

	/* ---------- themes ---------- */
	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 12px;
	}
	.tcard {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: var(--panel);
	}
	.tcard.editing {
		border-color: var(--border-strong);
	}
	:global([data-theme='light']) .tcard,
	:global([data-theme='light']) .scheme,
	:global([data-theme='light']) .editor-card {
		background: var(--surface);
		border-color: var(--border);
	}
	.orbs {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 18px 12px 10px;
	}
	.pick {
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: 50%;
		background: none;
		box-shadow: 0 0 0 1.5px transparent;
		cursor: pointer;
		transition: box-shadow var(--t-fast) var(--ease-out);
	}
	.pick:hover {
		box-shadow: 0 0 0 1.5px var(--border-strong);
	}
	.pick.on {
		box-shadow: 0 0 0 1.5px var(--accent);
	}
	.orb {
		display: block;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 32% 28%,
			color-mix(in srgb, white 70%, var(--m-brand)) 0%,
			var(--m-brand) 45%,
			color-mix(in srgb, var(--m-bg) 55%, var(--m-brand)) 100%
		);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 14%, transparent);
	}
	.slots {
		position: absolute;
		top: 8px;
		right: 8px;
		display: flex;
		gap: 2px;
		color: var(--dim);
	}
	.slots span {
		display: inline-flex;
	}
	.tfoot {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		padding: 0 6px 6px 12px;
	}
	.tname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		color: var(--text);
	}
	.tedit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tedit:hover,
	.tedit[aria-pressed='true'] {
		background: var(--surface2);
		color: var(--text);
	}
	.editor-card {
		margin-top: 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: var(--panel);
	}
</style>
