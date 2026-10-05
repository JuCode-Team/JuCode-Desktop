import { describe, it, expect } from 'vitest';
import { caps, CAPS, normalizeBackendId, isBackendId, BACKEND_IDS } from './index';
import { ChatState } from '$lib/chat.svelte';

describe('caps() gating helper', () => {
	it('defaults to the native backend for missing/unknown input', () => {
		expect(caps(undefined)).toBe(CAPS.jucode);
		expect(caps(null)).toBe(CAPS.jucode);
		expect(caps({})).toBe(CAPS.jucode);
		expect(caps({ backendId: 'weird' })).toBe(CAPS.jucode);
	});

	it('resolves the backend from a ChatState', () => {
		const chat = new ChatState();
		expect(caps(chat)).toBe(CAPS.jucode);
		chat.backendId = 'claude';
		expect(caps(chat)).toBe(CAPS.claude);
		chat.backendId = 'codex';
		expect(caps(chat)).toBe(CAPS.codex);
	});

	it('gates the UI surfaces the design calls out', () => {
		// jucode: everything on.
		expect(caps({ backendId: 'jucode' }).approvalModes).toBe(true);
		expect(caps({ backendId: 'jucode' }).goals).toBe(true);
		// claude: approval picker, stop button, context ring, model picker
		// (list_models/set_model control requests), /compact (stream-json slash
		// text) and the resume picker (the daemon's session history, with transcript
		// replay) and rewind (reopened with --resume-session-at) are live;
		// so are subagents and background tasks (system/task_*), the CLI's own
		// slash commands, and its MCP servers (switch / reconnect, not edit);
		// steer (stdin is already a queue), plan/goal tabs, tree and skills stay
		// hidden.
		const cl = caps({ backendId: 'claude' });
		expect(cl.approvalModes).toBe(true);
		expect(cl.interrupt).toBe(true);
		expect(cl.contextUsage).toBe(true);
		expect(cl.steer).toBe(false);
		expect(cl.goals).toBe(false);
		expect(cl.branchTree).toBe(false);
		expect(cl.checkpoints).toBe(true); // conversation rewind via --resume-session-at respawn
		expect(cl.resume).toBe(true);
		expect(cl.skills).toBe(false);
		expect(cl.mcpManage).toBe(true);
		expect(cl.mcpEngineOwned).toBe(true);
		expect(cl.ruleScopes).toBe(true);
		expect(cl.subagents).toBe(true);
		expect(cl.modelPicker).toBe(true);
		expect(cl.slashCommands).toBe(true);
		expect(cl.compact).toBe(true);
		expect(cl.transcriptReplay).toBe(true);
		// jucode: manual /compact stays available.
		expect(caps({ backendId: 'jucode' }).compact).toBe(true);
		// codex: model picker, resume picker, compaction and goals are wired
		// (model/list, thread/list + thread/resume, thread/compact/start,
		// thread/goal/*); generic slash commands stay off.
		const cx = caps({ backendId: 'codex' });
		expect(cx.modelPicker).toBe(true);
		expect(cx.resume).toBe(true);
		expect(cx.compact).toBe(true);
		expect(cx.goals).toBe(true);
		expect(cx.transcriptReplay).toBe(true);
		expect(cx.slashCommands).toBe(false);
		expect(cx.checkpoints).toBe(true); // conversation rewind via thread/revert
		// steering, plan / auto modes, subagents with the agent trace and its
		// own MCP servers are wired too.
		expect(cx.steer).toBe(true);
		expect(cx.extendedApprovalModes).toBe(true);
		expect(cx.agentTrace).toBe(true);
		expect(cx.mcpEngineOwned).toBe(true);
	});

	it('every backend declares the full flag set', () => {
		const keys = Object.keys(CAPS.jucode).sort();
		for (const id of BACKEND_IDS) {
			expect(Object.keys(CAPS[id]).sort()).toEqual(keys);
		}
	});
});

describe('backend id helpers', () => {
	it('normalizeBackendId maps unknown values to jucode (restore path)', () => {
		expect(normalizeBackendId(undefined)).toBe('jucode');
		expect(normalizeBackendId('claude')).toBe('claude');
		expect(normalizeBackendId('codex')).toBe('codex');
		expect(normalizeBackendId('gpt')).toBe('jucode');
		expect(normalizeBackendId(42)).toBe('jucode');
		expect(isBackendId('claude')).toBe(true);
		expect(isBackendId('x')).toBe(false);
	});
});
