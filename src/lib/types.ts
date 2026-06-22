import type { ChatState } from './chat.svelte';

export interface Session {
	id: string;
	chat: ChatState;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	sessions: Session[];
}
