// 应用自动更新状态（tauri-plugin-updater）。模块级 runes 单例：设置页的更新卡片
// 与侧栏设置入口的小圆点共享同一份状态，启动时的静默检查也写到这里。
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';

class UpdaterState {
	phase = $state<UpdatePhase>('idle');
	/** 可用的新版本号（phase 为 available/downloading/ready 时有效）。 */
	version = $state('');
	/** 下载进度 0–100。 */
	progress = $state(0);
	error = $state('');
	#update: Update | null = null;

	/** 是否有可用更新（侧栏小圆点据此显示）。 */
	get available() {
		return this.phase === 'available' || this.phase === 'downloading' || this.phase === 'ready';
	}

	/** 检查更新。`silent` 用于启动时的后台检查：失败/无更新都保持安静。 */
	async check(silent = false) {
		if (this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'ready') return;
		if (!silent) this.phase = 'checking';
		try {
			const u = await check();
			if (u) {
				this.#update = u;
				this.version = u.version;
				this.phase = 'available';
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
		const u = this.#update;
		if (!u || this.phase === 'downloading' || this.phase === 'ready') return;
		this.phase = 'downloading';
		this.progress = 0;
		let total = 0;
		let received = 0;
		try {
			await u.downloadAndInstall((ev) => {
				if (ev.event === 'Started') {
					total = ev.data.contentLength ?? 0;
				} else if (ev.event === 'Progress') {
					received += ev.data.chunkLength;
					if (total > 0) this.progress = Math.min(100, Math.round((received / total) * 100));
				} else if (ev.event === 'Finished') {
					this.progress = 100;
				}
			});
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
