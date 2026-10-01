// Which agent directory a component lists. The desktop has one daemon and
// one directory; the remote page has one per paired computer and gives each
// computer's view its own through context.

import { getContext, setContext } from 'svelte';
import { agentDirectory, type AgentDirectory } from './agents.svelte';

const KEY = Symbol('agent-directory');

/** Makes `directory` the one components below this one list. */
export function provideAgents(directory: AgentDirectory) {
	setContext(KEY, directory);
}

/** The directory provided above, else the app's shared one. */
export function useAgents(): AgentDirectory {
	return getContext<AgentDirectory | undefined>(KEY) ?? agentDirectory;
}
