<script lang="ts">
	import { onMount } from 'svelte';
	import { X, LogIn, Check } from 'lucide-svelte';
	import { readConfig, writeConfig, readAuthProviders, setAuthKey, sendOp } from '$lib/protocol';

	let { sessionId, onClose }: { sessionId: string; onClose: () => void } = $props();

	interface ModelCfg {
		name: string;
		context_window?: number;
		reasoning_efforts?: string[];
	}
	let cfg = $state<Record<string, any>>({});
	let providers = $state<string[]>([]);
	let newProvider = $state('');
	let newKey = $state('');
	let saved = $state(false);

	const models = $derived<ModelCfg[]>(Array.isArray(cfg.models) ? cfg.models : []);
	const efforts = $derived(models.find((m) => m.name === cfg.model)?.reasoning_efforts ?? []);

	onMount(async () => {
		cfg = await readConfig();
		providers = await readAuthProviders();
		newProvider = String(cfg.provider ?? 'jucode');
	});

	async function save() {
		await writeConfig({
			model: cfg.model,
			reasoning_effort: cfg.reasoning_effort,
			compact_model: cfg.compact_model,
			compaction_threshold_tokens: Number(cfg.compaction_threshold_tokens) || 0,
			retry_attempts: Number(cfg.retry_attempts) || 0,
			connect_timeout_seconds: Number(cfg.connect_timeout_seconds) || 0,
			read_timeout_seconds: Number(cfg.read_timeout_seconds) || 0,
			include_project_instructions: !!cfg.include_project_instructions
		});
		saved = true;
		setTimeout(() => (saved = false), 1500);
	}

	async function saveKey() {
		if (!newProvider.trim() || !newKey.trim()) return;
		await setAuthKey(newProvider.trim(), newKey.trim());
		providers = await readAuthProviders();
		newKey = '';
	}

	function login() {
		sendOp(sessionId, { op: 'command', input: '/login' });
		onClose();
	}
</script>

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="sheet" role="dialog" tabindex="-1" aria-label="Settings">
		<div class="head">
			<span>Settings</span>
			<button class="x" onclick={onClose} aria-label="close"><X size={16} /></button>
		</div>

		<div class="scroll">
			<section>
				<h3>Model</h3>
				<p class="hint">Default for new sessions. Switch the current session live from the header.</p>
				<label class="field">
					<span>Model</span>
					<select bind:value={cfg.model}>
						{#each models as m (m.name)}<option value={m.name}>{m.name}</option>{/each}
					</select>
				</label>
				{#if efforts.length}
					<div class="field">
						<span>Reasoning effort</span>
						<div class="chips">
							{#each efforts as ef (ef)}
								<button class="chip" class:on={cfg.reasoning_effort === ef} onclick={() => (cfg.reasoning_effort = ef)}>{ef}</button>
							{/each}
						</div>
					</div>
				{/if}
				<label class="field">
					<span>Compaction model</span>
					<select bind:value={cfg.compact_model}>
						{#each models as m (m.name)}<option value={m.name}>{m.name}</option>{/each}
					</select>
				</label>
			</section>

			<section>
				<h3>Account & API keys</h3>
				<button class="btn primary wide" onclick={login}><LogIn size={15} /> Login with JuCode (OAuth)</button>
				<p class="hint">Stored providers: {providers.length ? providers.join(', ') : 'none'}</p>
				<label class="field">
					<span>Provider</span>
					<input bind:value={newProvider} placeholder="jucode / openai" />
				</label>
				<label class="field">
					<span>API key</span>
					<input type="password" bind:value={newKey} placeholder="sk-…" />
				</label>
				<button class="btn" onclick={saveKey} disabled={!newProvider.trim() || !newKey.trim()}>Save key</button>
			</section>

			<section>
				<h3>Behavior</h3>
				<label class="field">
					<span>Compaction threshold (tokens)</span>
					<input type="number" bind:value={cfg.compaction_threshold_tokens} />
				</label>
				<label class="field">
					<span>Retry attempts</span>
					<input type="number" bind:value={cfg.retry_attempts} />
				</label>
				<label class="field">
					<span>Connect timeout (s)</span>
					<input type="number" bind:value={cfg.connect_timeout_seconds} />
				</label>
				<label class="field">
					<span>Read timeout (s)</span>
					<input type="number" bind:value={cfg.read_timeout_seconds} />
				</label>
				<label class="field row">
					<input type="checkbox" bind:checked={cfg.include_project_instructions} />
					<span>Include project instructions (AGENTS.md, etc.)</span>
				</label>
			</section>
		</div>

		<div class="foot">
			<span class="hint">Changes apply to new sessions.</span>
			<button class="btn primary" onclick={save}>{#if saved}<Check size={15} /> Saved{:else}Save{/if}</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
	}
	.sheet {
		width: min(560px, 94vw);
		max-height: 84vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		font-weight: 600;
		font-size: 15px;
		border-bottom: 1px solid var(--border);
	}
	.x {
		display: inline-flex;
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
	}
	.x:hover {
		color: var(--text);
	}
	.scroll {
		overflow-y: auto;
		padding: 6px 18px 18px;
	}
	section {
		padding: 16px 0;
		border-bottom: 1px solid var(--border);
	}
	section:last-child {
		border-bottom: none;
	}
	h3 {
		margin: 0 0 4px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--dim);
	}
	.field {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 10px;
		font-size: 13px;
	}
	.field > span {
		flex: 1;
		color: var(--text);
	}
	.field.row {
		justify-content: flex-start;
		gap: 9px;
	}
	.field.row > span {
		flex: none;
	}
	select,
	input {
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 7px 10px;
		font-size: 13px;
		font-family: var(--font-sans);
		min-width: 200px;
		outline: none;
	}
	input[type='number'] {
		min-width: 110px;
		font-family: var(--font-mono);
	}
	input[type='checkbox'] {
		min-width: auto;
		accent-color: var(--accent);
	}
	select:focus,
	input:focus {
		border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
	}
	.chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chip {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 4px 11px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--dim);
		cursor: pointer;
	}
	.chip.on {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		padding: 8px 14px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
	}
	.btn:hover {
		border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
	.btn.wide {
		width: 100%;
		justify-content: center;
		margin-bottom: 10px;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 18px;
		border-top: 1px solid var(--border);
	}
</style>
