// 应用自动更新状态。模块级 runes 单例：设置页的更新卡片
// 与侧栏设置入口的小圆点共享同一份状态，启动时的静默检查也写到这里。
// 检查和下载在 Rust 侧（src-tauri/src/app_update.rs）：先走 GitHub，
// 不通或太慢时换 JuCode 服务器上的同一份签名安装包。
import { Channel, invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';

type Progress =
	| { event: 'Started'; data: { contentLength?: number | null } }
	| { event: 'Progress'; data: { chunkLength: number } }
	| { event: 'Finished' };

export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';

export class UpdaterState {
	phase = $state<UpdatePhase>('idle');
	/** 可用的新版本号（phase 为 available/downloading/ready 时有效）。 */
	version = $state('');
	/** 下载进度 0–100。 */
	progress = $state(0);
	error = $state('');
	/** 这次更新从哪里下载：GitHub 或 JuCode 服务器。 */
	source = $state<'github' | 'jucode' | ''>('');

	/** 是否有可用更新（侧栏小圆点据此显示）。 */
	get available() {
		return this.phase === 'available' || this.phase === 'downloading' || this.phase === 'ready';
	}

	/**
	 * Check for updates. Startup checks can pass `autoInstall` to download and
	 * install immediately. Relaunch stays user-controlled to avoid lost work.
	 */
	async check(silent = false, autoInstall = false) {
		if (this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'ready') return;
		this.phase = 'checking';
		try {
			const u = await invoke<{ version: string; notes: string | null; source: 'github' | 'jucode' } | null>(
				'update_check'
			);
			if (u) {
				this.version = u.version;
				this.source = u.source;
				this.phase = 'available';
				if (autoInstall) await this.download();
			} else {
				this.phase = silent ? 'idle' : 'latest';
			}
		} catch (e) {
			// 开发环境 / 离线时 endpoint 不可达属于常态，静默检查直接忽略。
			if (silent) {
				this.phase = 'idle';
				return;
			}
			this.error = String(e);
			this.phase = 'error';
		}
	}

	/** 下载并安装更新，完成后进入 ready（由「重启并安装」按钮触发 relaunch）。 */
	async download() {
		// The check that found it holds the update on the Rust side.
		if (this.phase !== 'available') return;
		this.phase = 'downloading';
		this.progress = 0;
		let total = 0;
		let received = 0;
		try {
			const onEvent = new Channel<Progress>();
			onEvent.onmessage = (ev) => {
				if (ev.event === 'Started') {
					total = ev.data.contentLength ?? 0;
				} else if (ev.event === 'Progress') {
					received += ev.data.chunkLength;
					if (total > 0) this.progress = Math.min(100, Math.round((received / total) * 100));
				} else if (ev.event === 'Finished') {
					this.progress = 100;
				}
			};
			await invoke('update_install', { onEvent });
			this.phase = 'ready';
		} catch (e) {
			this.error = String(e);
			this.phase = 'error';
		}
	}

	/** 重启应用以应用已安装的更新。 */
	async restart() {
		await relaunch();
	}
}

export const updater = new UpdaterState();
