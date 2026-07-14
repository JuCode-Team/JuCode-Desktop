// Pure presentation logic for the setup wizard's "install git" block, derived
// from the backend's platform-aware InstallAdvice (see check_environment).
// Kept out of Setup.svelte so it stays unit-testable.

import type { InstallAdvice } from './protocol';

export interface GitInstallUi {
	/** Show the one-click auto-install button (macOS CLT dialog / Windows winget). */
	auto: boolean;
	/** Copyable command row (null → hidden). Never executed GUI-side on Linux. */
	command: string | null;
	/** Official download page for the fallback button. */
	url: string;
	/** i18n key (under setup.installGit.*) for the explanatory tip line. */
	tipKey: 'tipMac' | 'tipWinget' | 'tipLinux' | 'tipDownload';
}

const GENERIC_URL = 'https://git-scm.com/downloads';

export function gitInstallUi(os: string | undefined, advice: InstallAdvice | undefined): GitInstallUi {
	if (!advice) {
		// Report not loaded yet — conservative defaults per known OS.
		const isMac = os === 'macos';
		return {
			auto: isMac,
			command: isMac ? 'brew install git' : null,
			url:
				os === 'windows'
					? 'https://git-scm.com/download/win'
					: os === 'linux'
						? 'https://git-scm.com/download/linux'
						: GENERIC_URL,
			tipKey: isMac ? 'tipMac' : 'tipDownload'
		};
	}
	const tipKey =
		advice.kind === 'auto'
			? os === 'windows'
				? 'tipWinget'
				: 'tipMac'
			: advice.kind === 'manual-command'
				? 'tipLinux'
				: 'tipDownload';
	return {
		auto: advice.kind === 'auto',
		command: advice.command,
		url: advice.url || GENERIC_URL,
		tipKey
	};
}
