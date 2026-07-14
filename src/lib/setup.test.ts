import { describe, expect, it } from 'vitest';
import { gitInstallUi } from './setup';
import type { InstallAdvice } from './protocol';

const advice = (a: Partial<InstallAdvice>): InstallAdvice => ({
	kind: 'open-url',
	command: null,
	url: 'https://git-scm.com/downloads',
	...a
});

describe('gitInstallUi', () => {
	it('macOS auto advice shows the one-click button with a brew command row', () => {
		const ui = gitInstallUi('macos', advice({ kind: 'auto', command: 'brew install git' }));
		expect(ui.auto).toBe(true);
		expect(ui.command).toBe('brew install git');
		expect(ui.tipKey).toBe('tipMac');
	});

	it('windows with winget is auto with the winget tip and copyable command', () => {
		const ui = gitInstallUi(
			'windows',
			advice({
				kind: 'auto',
				command: 'winget install --id Git.Git -e --source winget',
				url: 'https://git-scm.com/download/win'
			})
		);
		expect(ui.auto).toBe(true);
		expect(ui.tipKey).toBe('tipWinget');
		expect(ui.command).toContain('winget install');
	});

	it('windows without winget falls back to the download page', () => {
		const ui = gitInstallUi(
			'windows',
			advice({ kind: 'open-url', url: 'https://git-scm.com/download/win' })
		);
		expect(ui.auto).toBe(false);
		expect(ui.command).toBeNull();
		expect(ui.url).toBe('https://git-scm.com/download/win');
		expect(ui.tipKey).toBe('tipDownload');
	});

	it('linux manual-command never offers auto-install and shows the sudo command', () => {
		const ui = gitInstallUi(
			'linux',
			advice({
				kind: 'manual-command',
				command: 'sudo apt-get install -y git',
				url: 'https://git-scm.com/download/linux'
			})
		);
		expect(ui.auto).toBe(false);
		expect(ui.command).toBe('sudo apt-get install -y git');
		expect(ui.tipKey).toBe('tipLinux');
	});

	it('missing advice yields conservative per-OS defaults', () => {
		expect(gitInstallUi('macos', undefined)).toMatchObject({ auto: true, tipKey: 'tipMac' });
		expect(gitInstallUi('windows', undefined)).toMatchObject({
			auto: false,
			command: null,
			url: 'https://git-scm.com/download/win'
		});
		expect(gitInstallUi(undefined, undefined).url).toBe('https://git-scm.com/downloads');
	});
});
