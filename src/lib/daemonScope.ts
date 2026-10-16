// Which daemon a component follows. The desktop has one daemon; the remote
// page has one per paired computer and gives each computer's view its own
// through context.

import { getContext, setContext } from 'svelte';
import { daemonState, type DaemonState } from './daemonState.svelte';

const KEY = Symbol('daemon-state');

/** Makes `state` the one components below this one follow. */
export function provideDaemonState(state: DaemonState) {
	setContext(KEY, state);
}

/** The state provided above, else the app's own daemon's. */
export function useDaemonState(): DaemonState {
	return getContext<DaemonState | undefined>(KEY) ?? daemonState;
}
