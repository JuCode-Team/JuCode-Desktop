// A tool call's one-line summary — icon, verb and target — shared by the tool
// card and the header of a run of calls (which shows the latest one).
import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FilePlusIcon from '@lucide/svelte/icons/file-plus';
import PencilIcon from '@lucide/svelte/icons/pencil';
import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
import SearchIcon from '@lucide/svelte/icons/search';
import ListIcon from '@lucide/svelte/icons/list';
import GlobeIcon from '@lucide/svelte/icons/globe';
import LinkIcon from '@lucide/svelte/icons/link';
import AppWindowMacIcon from '@lucide/svelte/icons/app-window-mac';
import BotIcon from '@lucide/svelte/icons/bot';
import ListChecksIcon from '@lucide/svelte/icons/list-checks';
import PlugIcon from '@lucide/svelte/icons/plug';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import ImageIcon from '@lucide/svelte/icons/image';

const VERBS: Record<string, string> = {
	read: 'Read',
	write: 'Wrote',
	str_replace: 'Edited',
	hashline_edit: 'Edited',
	apply_patch: 'Edited',
	bash: 'Ran',
	exec_command: 'Ran',
	write_stdin: 'Wrote stdin',
	ls: 'Listed',
	ripgrep: 'Searched',
	outline: 'Outlined',
	web_search: 'Searched web',
	web_fetch: 'Fetched',
	generate_image: 'Generated image',
	spawn_agent: 'Started subagent',
	wait_agent: 'Waited for subagents',
	list_agents: 'Listed subagents',
	send_message: 'Messaged subagent',
	close_agent: 'Closed subagent',
	agent_wait: 'Waited for subagents',
	agent_sendInput: 'Messaged subagent',
	agent_sendMessage: 'Messaged subagent',
	agent_closeAgent: 'Closed subagent',
	agent_interruptAgent: 'Interrupted subagent',
	agent_resumeAgent: 'Resumed subagent',
	agent_listAgents: 'Listed subagents',
	start_session: 'Started session',
	wait_session: 'Waited for session',
	send_session: 'Messaged session'
};

// One glyph per kind of tool, so a run of calls scans at a glance.
const ICONS: Record<string, typeof WrenchIcon> = {
	bash: SquareTerminalIcon,
	exec_command: SquareTerminalIcon,
	write_stdin: SquareTerminalIcon,
	read: FileTextIcon,
	write: FilePlusIcon,
	str_replace: PencilIcon,
	hashline_edit: PencilIcon,
	apply_patch: PencilIcon,
	ls: FolderOpenIcon,
	ripgrep: SearchIcon,
	outline: ListIcon,
	web_search: GlobeIcon,
	web_fetch: LinkIcon,
	generate_image: ImageIcon,
	Task: BotIcon,
	Agent: BotIcon,
	spawn_agent: BotIcon,
	wait_agent: BotIcon,
	list_agents: BotIcon,
	send_message: BotIcon,
	close_agent: BotIcon,
	agent_wait: BotIcon,
	TodoWrite: ListChecksIcon,
	update_plan: ListChecksIcon,
	start_session: BotIcon,
	wait_session: BotIcon,
	send_session: BotIcon
};

export const toolVerb = (name: string) => VERBS[name] ?? name;

export function toolIcon(name: string): typeof WrenchIcon {
	return (
		ICONS[name] ??
		(name.startsWith('browser_') ? AppWindowMacIcon : name.startsWith('mcp__') || name.includes('.') ? PlugIcon : WrenchIcon)
	);
}

/** Codex reports commands as run: `/bin/zsh -lc '<command>'`. The command. */
export function unwrapShell(c: string): string {
	const m = /^\/bin\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/.exec(c.trim());
	if (!m) return c;
	return m[1] === '"' ? m[2]!.replace(/\\(["\\$`])/g, '$1') : m[2]!;
}

export function parseToolOutput(output: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(output);
		return v && typeof v === 'object' ? v : null;
	} catch {
		return null;
	}
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** What a call does, for counting a run's work (workSummary). */
export type ToolKind = 'command' | 'edit' | 'read' | 'search' | 'web' | 'other';
const KINDS: Record<string, ToolKind> = {
	bash: 'command',
	exec_command: 'command',
	write: 'edit',
	str_replace: 'edit',
	hashline_edit: 'edit',
	apply_patch: 'edit',
	read: 'read',
	outline: 'read',
	ls: 'search',
	ripgrep: 'search',
	web_search: 'web',
	web_fetch: 'web'
};
// ACP agents name a call by its title ("Edit a.rs"); what it does is the
// ACP kind the daemon puts in its card.
const ACP_KINDS: Record<string, ToolKind> = {
	execute: 'command',
	edit: 'edit',
	delete: 'edit',
	move: 'edit',
	read: 'read',
	search: 'search',
	fetch: 'web'
};
export function toolKind(name: string, parsed: Record<string, unknown> | null): ToolKind {
	return KINDS[name] ?? ACP_KINDS[str(parsed?.kind)] ?? 'other';
}

/** A call that edits or writes files. */
export const isEdit = (name: string, parsed: Record<string, unknown> | null) => toolKind(name, parsed) === 'edit';

/** The files an edit call touched. */
export function editedPaths(parsed: Record<string, unknown> | null): string[] {
	if (!parsed) return [];
	return [parsed.path, ...(Array.isArray(parsed.paths) ? parsed.paths : [])].filter((p): p is string => typeof p === 'string' && !!p);
}

/** Lines an edit added and removed, from its diff, or the counts an edit
 *  still streaming reports (null: neither). */
export function diffStat(parsed: Record<string, unknown> | null): { add: number; del: number } | null {
	const diff = str(parsed?.diff);
	if (!diff) {
		const { add, del } = parsed ?? {};
		return typeof add === 'number' && typeof del === 'number' ? { add, del } : null;
	}
	let add = 0;
	let del = 0;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) add++;
		else if (line.startsWith('-') && !line.startsWith('---')) del++;
	}
	return { add, del };
}

/** What the call acted on: the command, search, file name or query. */
export function toolTarget(name: string, parsed: Record<string, unknown> | null): string {
	if (!parsed) return '';
	if (name === 'bash' || name === 'exec_command' || name === 'ripgrep') {
		const cmd = unwrapShell(str(parsed.command) || str(parsed.pattern)).replace(/\s+/g, ' ');
		return cmd.length > 64 ? cmd.slice(0, 64) + '…' : cmd;
	}
	if (typeof parsed.path === 'string') return parsed.path.split('/').pop() || parsed.path;
	if (name === 'web_search') return str(parsed.query);
	if (name === 'start_session') return str(parsed.title);
	if (name === 'wait_session') return str(parsed.status);
	if (name === 'generate_image' && Array.isArray(parsed.paths)) return parsed.paths.map(String).join(', ');
	return '';
}
