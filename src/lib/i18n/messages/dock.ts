// Right-dock area: RightDock, GitPanel, ChangesPanel, FilesPanel, PlanPanel,
// GoalPanel, TerminalPanel. Populated during the dock-area i18n migration.
const dock = {
	zh: {
		tabs: {
			plan: '计划',
			goal: '目标',
			changes: '改动',
			files: '文件',
			git: 'Git',
			term: '终端',
			browser: '浏览器'
		},
		dock: {
			empty: '没有打开的面板',
			hint: '选一个面板打开，或点右上角'
		},
		browser: {
			urlPlaceholder: '输入网址，回车打开',
			back: '后退',
			forward: '前进',
			reload: '刷新',
			pick: '选择页面元素，引用到对话',
			pickHint: '在页面中点击要引用的元素（Esc 取消）',
			empty: '输入网址开始浏览',
			emptyHint: 'AI 也可以通过 browser_open 工具在这里打开页面'
		},
		git: {
			notRepo: '不是 Git 仓库',
			changes: '改动',
			stageAll: '全部暂存',
			clean: '工作区干净',
			history: '提交历史',
			unstage: '取消暂存',
			stage: '暂存',
			discard: '丢弃改动',
			discardConfirm: '丢弃「{path}」的改动？此操作不可撤销。',
			discardTitle: '丢弃改动',
			commitPlaceholder: '提交信息…',
			commit: '提交 {n}',
			closeHint: '点击关闭',
			untrackedDiff: '（未跟踪的新文件，暂存后可查看 diff）',
			noDiff: '（没有可显示的改动）'
		},
		changes: {
			title: '本会话改动',
			empty: '本会话暂无文件改动',
			emptyHint: 'AI 编辑文件后会在此列出',
			revert: '还原',
			revertFile: '还原此文件',
			revertConfirm: '还原「{path}」到改动前？此操作不可撤销。',
			revertTitle: '还原文件',
			newFileDiff: '（新文件或无可显示的 diff）'
		},
		files: {
			empty: '空目录'
		},
		plan: {
			title: '任务计划',
			empty: '暂无计划',
			emptyHint: '多步任务时 AI 会在此列出步骤'
		},
		goal: {
			active: '进行中',
			activeHint: '正在朝目标推进。',
			paused: '已暂停',
			pausedHint: '已暂停，/goal resume 继续。',
			blocked: '受阻',
			blockedHint: '需要你补充信息或外部变更后才能继续。',
			complete: '已完成',
			completeHint: '目标已达成。',
			noBudget: '无预算',
			timeUsed: '用时',
			tokenBudget: 'token 预算',
			empty: '暂无目标',
			emptyHintPre: '用',
			emptyHintPost: '设置一个',
			goalPlaceholder: '目标'
		}
	},
	en: {
		tabs: {
			plan: 'Plan',
			goal: 'Goal',
			changes: 'Changes',
			files: 'Files',
			git: 'Git',
			term: 'Terminal',
			browser: 'Browser'
		},
		dock: {
			empty: 'No open panels',
			hint: 'Pick a panel to open, or click the top-right'
		},
		browser: {
			urlPlaceholder: 'Enter a URL and press Enter',
			back: 'Back',
			forward: 'Forward',
			reload: 'Reload',
			pick: 'Pick a page element to reference in chat',
			pickHint: 'Click the element to reference (Esc to cancel)',
			empty: 'Enter a URL to start browsing',
			emptyHint: 'The AI can also open pages here via the browser_open tool'
		},
		git: {
			notRepo: 'Not a Git repository',
			changes: 'Changes',
			stageAll: 'Stage all',
			clean: 'Working tree clean',
			history: 'Commit history',
			unstage: 'Unstage',
			stage: 'Stage',
			discard: 'Discard changes',
			discardConfirm: 'Discard changes to "{path}"? This cannot be undone.',
			discardTitle: 'Discard changes',
			commitPlaceholder: 'Commit message…',
			commit: 'Commit {n}',
			closeHint: 'Click to dismiss',
			untrackedDiff: '(Untracked new file — stage it to view the diff)',
			noDiff: '(No changes to display)'
		},
		changes: {
			title: 'Changes this session',
			empty: 'No file changes this session',
			emptyHint: 'Files the AI edits will appear here',
			revert: 'Revert',
			revertFile: 'Revert this file',
			revertConfirm: 'Revert "{path}" to before the changes? This cannot be undone.',
			revertTitle: 'Revert file',
			newFileDiff: '(New file or no diff to display)'
		},
		files: {
			empty: 'Empty directory'
		},
		plan: {
			title: 'Task plan',
			empty: 'No plan yet',
			emptyHint: 'For multi-step tasks the AI will list steps here'
		},
		goal: {
			active: 'Active',
			activeHint: 'Working toward the goal.',
			paused: 'Paused',
			pausedHint: 'Paused — /goal resume to continue.',
			blocked: 'Blocked',
			blockedHint: 'Needs more info from you or an external change to continue.',
			complete: 'Complete',
			completeHint: 'Goal achieved.',
			noBudget: 'no budget',
			timeUsed: 'time used',
			tokenBudget: 'token budget',
			empty: 'No goal yet',
			emptyHintPre: 'Use',
			emptyHintPost: 'to set one',
			goalPlaceholder: 'goal'
		}
	}
};
export default dock;
