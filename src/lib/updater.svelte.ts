// 应用自动更新状态。模块级 runes 单例：设置页的更新卡片
// 与侧栏设置入口的小圆点共享同一份状态，启动时的静默检查也写到这里。
// 检查和下载在 Rust 侧（src-tauri/src/app_update.rs）：先走 GitHub，
// 不通或太慢时换 JuCode 服务器上的同一份签名安装包。
import { Channel, invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { workspaces } from '$lib/workbench/workspaceStore.svelte';

type Progress =
	| { event: 'Started'; data: { contentLength?: number | null } }
	| { event: 'Progress'; data: { chunkLength: number } }
	| { event: 'Finished' };

export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';

/** `a` is an older version than `b` ("0.4.0" < "0.4.10"; a pre-release is
 *  older than its release). Unparsable versions compare as not older. */
export function olderThan(a: string, b: string): boolean {
	const parse = (v: string) => {
		const m = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(v.trim());
		return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' } : null;
	};
	const x = parse(a);
	const y = parse(b);
	if (!x || !y) return false;
	for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i];
	return !!x.pre && !y.pre;
}

export class UpdaterState {
	phase = $state<UpdatePhase>('idle');
	/** 可用的新版本号（phase 为 available/downloading/ready 时有效）。 */
	version = $state('');
	/** 下载进度 0–100。 */
	progress = $state(0);
	error = $state('');
	/** 这次更新从哪里下载：GitHub 或 JuCode 服务器。 */
	source = $state<'github' | 'jucode' | ''>('');
	/** 新版本的更新说明。 */
	notes = $state('');
	/** 服务器要求的最低版本，当前版本低于它时（必须更新）才有值。 */
	required = $state('');
	/** 用户对这个版本的「已就绪」弹窗点了「稍后」。 */
	dismissed = $state('');

	/** 是否有可用更新（侧栏小圆点据此显示）。 */
	get available() {
		return this.phase === 'available' || this.phase === 'downloading' || this.phase === 'ready';
	}

	/**
	 * Check for updates. Startup checks can pass `autoInstall` to download and
	 * install immediately. Relaunch stays user-controlled to avoid lost work.
	 */
	async check(silent = false, autoInstall = false) {
		await this.#checkRequired();
		if (this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'ready') return;
		this.phase = 'checking';
		try {
			const u = await invoke<{ version: string; notes: string | null; source: 'github' | 'jucode' } | null>(
				'update_check'
			);
			if (u) {
				this.version = u.version;
				this.source = u.source;
				this.notes = u.notes ?? '';
				this.phase = 'available';
				if (autoInstall || this.required) await this.download();
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

	/** The server's lowest accepted version; an unreachable server requires nothing. */
	async #checkRequired() {
		const [min, current] = await Promise.all([
			invoke<string>('update_policy').catch(() => ''),
			getVersion().catch(() => '')
		]);
		this.required = min && current && olderThan(current, min) ? min : '';
	}

	/** 「已就绪」弹窗：稍后再说（这次运行内不再弹出这个版本）。 */
	dismiss() {
		this.dismissed = this.version;
	}

	/** 重启应用以应用已安装的更新。 */
	async restart() {
		// The relaunch does not wait for the half-second save of the workspaces.
		await workspaces.flush();
		await relaunch();
	}
}

export const updater = new UpdaterState();
