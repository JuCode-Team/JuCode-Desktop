import { invoke } from '@tauri-apps/api/core';
import { git } from '$lib/protocol';
import type { PluginManifest } from './registry';

export const githubPrManifest = {
	id: 'github-pr',
	name: 'GitHub Pull Requests',
	commands: ['check', 'view', 'create'],
	bin: 'gh',
	defaultEnabled: true
} as const satisfies PluginManifest;

export type GitHubPrState = 'checking' | 'missing' | 'unauthed' | 'noRemote' | 'ready';

export interface PrInfo {
	url: string;
	title: string;
	state: string;
	isDraft: boolean;
}

export interface CreatePrInput {
	title: string;
	body: string;
	base?: string;
	draft?: boolean;
}

function gh(args: string[], cwd?: string): Promise<string> {
	return invoke('gh', { args, cwd });
}

export function parseGhVersion(out: string): string | null {
	return out.match(/gh version (\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function hasGitHubRemote(out: string): boolean {
	return out.split('\n').some((line) => /\bgithub\.com[/:]/.test(line));
}

export function parsePrView(out: string): PrInfo | null {
	try {
		const value = JSON.parse(out) as Record<string, unknown>;
		if (value && typeof value.url === 'string' && value.url) {
			return {
				url: value.url,
				title: String(value.title ?? ''),
				state: String(value.state ?? ''),
				isDraft: value.isDraft === true
			};
		}
	} catch {
		// A failed `gh pr view` is represented as no PR for the current branch.
	}
	return null;
}

export function extractPrUrl(out: string): string | null {
	return out.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/)?.[0] ?? null;
}

export async function checkGitHubPr(cwd?: string): Promise<GitHubPrState> {
	try {
		if (!parseGhVersion(await gh(['--version'], cwd))) return 'missing';
	} catch {
		return 'missing';
	}
	try {
		if (!hasGitHubRemote(await git(['remote', '-v'], cwd))) return 'noRemote';
	} catch {
		return 'noRemote';
	}
	try {
		await gh(['auth', 'status'], cwd);
	} catch {
		return 'unauthed';
	}
	return 'ready';
}

export async function viewGitHubPr(cwd?: string): Promise<PrInfo | null> {
	try {
		return parsePrView(await gh(['pr', 'view', '--json', 'url,title,state,isDraft'], cwd));
	} catch {
		return null;
	}
}

export async function createGitHubPr(input: CreatePrInput, cwd?: string): Promise<PrInfo | null> {
	const args = ['pr', 'create', '--title', input.title.trim(), '--body', input.body];
	if (input.base) args.push('--base', input.base);
	if (input.draft) args.push('--draft');
	const url = extractPrUrl(await gh(args, cwd));
	return url ? { url, title: input.title.trim(), state: 'OPEN', isDraft: !!input.draft } : null;
}
