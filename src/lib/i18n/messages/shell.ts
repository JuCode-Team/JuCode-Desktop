// Shell area: +page, Sidebar, CommandPalette, session/protocol runtime messages.
// Populated during the shell-area i18n migration.
const shell = {
	zh: {
		// notifications / runtime
		notifyDone: '对话完成：{title}',
		untitled: '未命名',

		// agent lifecycle status
		agentStatus: {
			started: '已启动',
			running: '运行中',
			completed: '已完成',
			interrupted: '已中断',
			closed: '已关闭'
		},

		// pickers
		picker: {
			tree: '对话分支树',
			model: '选择模型',
			resume: '恢复历史会话',
			checkpoint: '回退到历史回合'
		},
		notConfigured: '未配置',
		pickerSearchPlaceholder: '筛选…',
		empty: '(empty)',
		noMatch: '无匹配',
		noOptions: '暂无可选项',
		pickerFoot: '↑↓ 选择 · Enter 确认 · Esc 关闭',

		// header / panel
		togglePanel: '侧边面板 · ⌘B',

		// find bar
		findPlaceholder: '在对话中查找…',
		findNoResult: '无结果',
		findPrev: '上一个',
		findNext: '下一个',

		// welcome / empty states
		welcomeTip: '给 JuCode 指派一个任务，开始新对话',
		hintCommand: '命令',
		hintRef: '引用文件',
		hintPalette: '命令面板',
		hintImage: '拖入 / 粘贴图片',
		noChat: '没有打开的对话',
		startFromProject: '选择项目，开始对话',

		// engine
		engineDown: '引擎已停止运行',
		restartEngine: '重启引擎',

		// approval
		approveCommand: '允许执行命令',
		approveFile: '允许修改文件',
		allowOnce: '允许一次',
		allowAlways: '本会话始终允许',
		deny: '拒绝',
		allowAll: '全部允许',
		allowSelected: '允许选中 ({n})',
		hunkCount: '{n} 个改动块',
		noneSelectedHint: '未勾选任何改动块 — 等同于拒绝',
		toggleDiff: '展开 / 收起差异',

		// trust
		trustLabel: '信任项目',
		trustQuestion: '信任此项目？',
		trustBody: '该项目包含可执行代码的本地技能或 hooks。信任后 JuCode 才会加载它们。',
		distrust: '不信任',
		trustRepo: '信任整个仓库',
		trust: '信任',

		// rewind
		rewindLabel: '回退确认',
		rewindQuestion: '回退到这一轮并重写？',
		rewindBody: '对话会回退到这条消息发出前，<b>此后的文件改动也会一并还原</b>。原消息已填入输入框，可修改后重新发送。此操作不可撤销。',
		rewindConfirm: '回退并重写',

		// dialogs (page)
		pickDirTitle: '选择项目目录',
		closeProjectConfirm: '关闭「{name}」会结束其下 {count} 个对话，确定吗？',
		closeProjectTitle: '关闭项目',
		attachTitle: 'Attach files',

		// sidebar
		theme: {
			system: '主题：跟随系统',
			light: '主题：浅色',
			dark: '主题：深色'
		},
		market: '市场',
		sessionsByProject: '对话 · 按项目',
		newProjectTitle: '新建项目（选择目录）',
		history: '历史对话',
		newSessionInProject: '在此项目下新建对话',
		closeProject: '关闭项目',
		awaitConfirm: '等待你的确认',
		newSession: '+ 新建对话',
		newTask: '新建并行任务',
		task: {
			dialogTitle: '新建并行任务',
			dialogHint: '在独立的 git worktree 中并行开工，不影响当前工作区。',
			nameLabel: '任务名',
			namePlaceholder: '例如 fix-login-bug',
			slugPreview: '目录 / 分支预览',
			slugInvalid: '任务名需含字母或数字（将转为小写字母、数字、连字符）',
			baseLabel: '基于分支',
			descLabel: '任务描述（可选）',
			descPlaceholder: '填写后将作为第一条消息自动发给 AI…',
			create: '创建任务',
			creating: '创建中…',
			worktreeTip: 'worktree: {branch} ← {base}',
			stale: '目录已删除',
			staleRemove: '从列表移除'
		},
		accountSettings: '账户与设置',
		notLoggedIn: '未登录',
		settings: '设置',
		updateAvailable: '有新版本可用',
		deepLinkBadPath: '路径不存在或无法访问：{path}',
		commandPalette: '命令面板',
		toggleTheme: '切换主题',

		// command palette
		paletteLabel: '命令面板',
		paletteSearch: '搜索命令或操作…',
		paletteEmpty: '没有匹配的命令',
		paletteFoot: '↑↓ 选择 · Enter 执行 · Esc 关闭',
		cmd: {
			newSession: '新建对话',
			newSessionKw: 'new session 对话',
			newProject: '新建项目',
			newProjectKw: 'new project 项目 目录',
			newTask: '新建并行任务',
			newTaskHint: '独立 worktree 分支',
			newTaskKw: 'worktree task parallel branch 并行 任务 工作树 分支',
			model: '切换模型 / 推理强度',
			modelKw: 'model effort 模型',
			rewind: '回退到历史回合',
			rewindHint: '会还原文件改动',
			rewindKw: 'rewind undo 回退 撤销',
			resume: '恢复历史会话',
			resumeKw: 'resume history 历史 恢复',
			tree: '对话分支树',
			treeKw: 'tree branch 分支 树',
			compact: '压缩上下文',
			compactKw: 'compact 压缩',
			context: '上下文用量',
			contextKw: 'context usage 上下文',
			stats: '会话统计',
			statsKw: 'stats 统计',
			doctor: '环境诊断',
			doctorKw: 'doctor 诊断',
			market: '扩展市场',
			marketKw: 'market skills 市场 技能 扩展',
			settings: '设置',
			settingsKw: 'settings 设置 provider',
			setup: '安装向导 / 环境检查',
			setupHint: 'git、登录',
			setupKw: 'setup wizard env git login 安装 向导 环境 登录',
			panel: '切换右侧面板',
			panelKw: 'panel dock 面板',
			theme: '切换主题',
			themeKw: 'theme dark light 主题'
		},

		// session runtime (session.svelte.ts)
		// 引擎后端（多后端支持）
		backend: {
			pickTitle: '选择引擎后端',
			pickFoot: '↑↓ 选择 · Enter 确认 · Esc 关闭',
			notFound: '未检测到',
			descJucode: '原生引擎 · 完整功能',
			descCodex: 'OpenAI Codex CLI',
			descClaude: 'Claude Code CLI',
			opUnsupported: '当前引擎后端不支持该操作：{op}',
			codexAuthHint: 'Codex 认证已失效：请在终端运行 `codex login` 重新登录后重试。',
			codexUnsupportedRequest: '已拒绝引擎的一个不支持的请求：{method}',
			codexCmdGoal: '设置或查看会话目标（/goal <目标>，/goal clear 清除）',
			claudeAuthHint:
				'Claude Code 认证已失效：请在终端运行 `claude` 并执行 /login 重新登录（或运行 `claude setup-token`）后重试。',
			claudeUnsupportedRequest: '已拒绝引擎的一个不支持的请求：{subtype}',
			claudeHistoryFail: '读取 Claude Code 历史会话失败：{msg}'
		},

		startFail: '无法启动引擎：{msg}',
		restarting: '正在重启引擎…',
		autoRestarting: '引擎已退出，正在自动重启…',
		restartExhausted: '引擎多次退出，已暂停自动重启。点「重启引擎」重试。',
		switchingTo: '正在切换到 {provider} · {model}…'
	},
	en: {
		// notifications / runtime
		notifyDone: 'Conversation done: {title}',
		untitled: 'Untitled',

		// agent lifecycle status
		agentStatus: {
			started: 'Started',
			running: 'Running',
			completed: 'Completed',
			interrupted: 'Interrupted',
			closed: 'Closed'
		},

		// pickers
		picker: {
			tree: 'Conversation branches',
			model: 'Select model',
			resume: 'Resume a session',
			checkpoint: 'Rewind to a turn'
		},
		notConfigured: 'not configured',
		pickerSearchPlaceholder: 'Filter…',
		empty: '(empty)',
		noMatch: 'No matches',
		noOptions: 'No options available',
		pickerFoot: '↑↓ Navigate · Enter Select · Esc Close',

		// header / panel
		togglePanel: 'Side panel · ⌘B',

		// find bar
		findPlaceholder: 'Find in conversation…',
		findNoResult: 'No results',
		findPrev: 'Previous',
		findNext: 'Next',

		// welcome / empty states
		welcomeTip: 'Assign JuCode a task to start a new conversation',
		hintCommand: 'Commands',
		hintRef: 'Reference files',
		hintPalette: 'Command palette',
		hintImage: 'Drop / paste images',
		noChat: 'No open conversation',
		startFromProject: 'Pick a project to start',

		// engine
		engineDown: 'Engine has stopped',
		restartEngine: 'Restart engine',

		// approval
		approveCommand: 'Allow running command',
		approveFile: 'Allow file changes',
		allowOnce: 'Allow once',
		allowAlways: 'Always allow this session',
		deny: 'Deny',
		allowAll: 'Allow all',
		allowSelected: 'Allow selected ({n})',
		hunkCount: '{n} hunks',
		noneSelectedHint: 'No hunks selected — same as deny',
		toggleDiff: 'Expand / collapse diff',

		// trust
		trustLabel: 'Trust project',
		trustQuestion: 'Trust this project?',
		trustBody: 'This project contains local skills or hooks with executable code. JuCode loads them only after you trust it.',
		distrust: "Don't trust",
		trustRepo: 'Trust whole repo',
		trust: 'Trust',

		// rewind
		rewindLabel: 'Confirm rewind',
		rewindQuestion: 'Rewind to this turn and rewrite?',
		rewindBody: 'The conversation rewinds to before this message, <b>and file changes made after it are reverted too</b>. The original message is placed in the input box so you can edit and resend. This cannot be undone.',
		rewindConfirm: 'Rewind and rewrite',

		// dialogs (page)
		pickDirTitle: 'Select project directory',
		closeProjectConfirm: 'Closing "{name}" will end its {count} conversation(s). Continue?',
		closeProjectTitle: 'Close project',
		attachTitle: 'Attach files',

		// sidebar
		theme: {
			system: 'Theme: follow system',
			light: 'Theme: light',
			dark: 'Theme: dark'
		},
		market: 'Market',
		sessionsByProject: 'Conversations · by project',
		newProjectTitle: 'New project (pick a directory)',
		history: 'History',
		newSessionInProject: 'New conversation in this project',
		closeProject: 'Close project',
		awaitConfirm: 'Awaiting your confirmation',
		newSession: '+ New conversation',
		newTask: 'New parallel task',
		task: {
			dialogTitle: 'New parallel task',
			dialogHint: 'Work in an isolated git worktree without touching the current working tree.',
			nameLabel: 'Task name',
			namePlaceholder: 'e.g. fix-login-bug',
			slugPreview: 'Directory / branch preview',
			slugInvalid: 'Task name must contain letters or digits (converted to lowercase letters, digits, hyphens)',
			baseLabel: 'Base branch',
			descLabel: 'Task description (optional)',
			descPlaceholder: 'If filled, it is sent to the AI as the first message…',
			create: 'Create task',
			creating: 'Creating…',
			worktreeTip: 'worktree: {branch} ← {base}',
			stale: 'Directory deleted',
			staleRemove: 'Remove from list'
		},
		accountSettings: 'Account & settings',
		notLoggedIn: 'Not signed in',
		settings: 'Settings',
		updateAvailable: 'Update available',
		deepLinkBadPath: 'Path does not exist or is not accessible: {path}',
		commandPalette: 'Command palette',
		toggleTheme: 'Toggle theme',

		// command palette
		paletteLabel: 'Command palette',
		paletteSearch: 'Search commands or actions…',
		paletteEmpty: 'No matching commands',
		paletteFoot: '↑↓ Navigate · Enter Run · Esc Close',
		cmd: {
			newSession: 'New conversation',
			newSessionKw: 'new session',
			newProject: 'New project',
			newProjectKw: 'new project directory',
			newTask: 'New parallel task',
			newTaskHint: 'isolated worktree branch',
			newTaskKw: 'worktree task parallel branch',
			model: 'Switch model / reasoning effort',
			modelKw: 'model effort',
			rewind: 'Rewind to a turn',
			rewindHint: 'Reverts file changes',
			rewindKw: 'rewind undo',
			resume: 'Resume a session',
			resumeKw: 'resume history',
			tree: 'Conversation branches',
			treeKw: 'tree branch',
			compact: 'Compact context',
			compactKw: 'compact',
			context: 'Context usage',
			contextKw: 'context usage',
			stats: 'Session stats',
			statsKw: 'stats',
			doctor: 'Diagnose environment',
			doctorKw: 'doctor',
			market: 'Extension market',
			marketKw: 'market skills',
			settings: 'Settings',
			settingsKw: 'settings provider',
			setup: 'Setup wizard / env check',
			setupHint: 'git, sign-in',
			setupKw: 'setup wizard env git login',
			panel: 'Toggle right panel',
			panelKw: 'panel dock',
			theme: 'Toggle theme',
			themeKw: 'theme dark light'
		},

		// session runtime (session.svelte.ts)
		// engine backends (multi-backend support)
		backend: {
			pickTitle: 'Choose engine backend',
			pickFoot: '↑↓ select · Enter confirm · Esc close',
			notFound: 'not found',
			descJucode: 'Native engine · full feature set',
			descCodex: 'OpenAI Codex CLI',
			descClaude: 'Claude Code CLI',
			opUnsupported: 'The current engine backend does not support this action: {op}',
			codexAuthHint: 'Codex authentication is invalid: run `codex login` in a terminal, then retry.',
			codexUnsupportedRequest: 'Declined an unsupported engine request: {method}',
			codexCmdGoal: 'Set or view the session goal (/goal <objective>, /goal clear)',
			claudeAuthHint:
				'Claude Code authentication is invalid: run `claude` in a terminal and sign in with /login (or run `claude setup-token`), then retry.',
			claudeUnsupportedRequest: 'Declined an unsupported engine request: {subtype}',
			claudeHistoryFail: 'Failed to read Claude Code session history: {msg}'
		},

		startFail: 'Failed to start engine: {msg}',
		restarting: 'Restarting engine…',
		autoRestarting: 'Engine exited, auto-restarting…',
		restartExhausted: 'Engine exited repeatedly; auto-restart paused. Click "Restart engine" to retry.',
		switchingTo: 'Switching to {provider} · {model}…'
	}
};
export default shell;
