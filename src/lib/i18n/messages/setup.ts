// Setup area: the first-run Setup wizard.
const setup = {
	zh: {
		steps: {
			env: '环境检查',
			login: '登录账号',
			start: '开始使用'
		},
		wizardLabel: '安装向导',
		skip: '跳过',
		envCheck: {
			title: '检查运行环境',
			sub: 'JuCode 需要 git 来读取项目文件与版本管理。下面是检测结果。',
			engineName: 'JuCode 引擎',
			notDetected: '未检测到',
			engineNotFound: '未找到引擎二进制'
		},
		installGit: {
			head: '安装 Git',
			tipMac: '点下方按钮触发系统「命令行工具」安装（含 git），在弹出的对话框中完成后点「重新检查」。',
			tipWinget: '点下方按钮通过 winget 自动安装 Git（可能弹出系统授权窗口），完成后点「重新检查」。',
			tipLinux: '出于安全考虑，应用不会自动执行 sudo。请复制以下命令到终端运行，完成后点「重新检查」。',
			tipDownload: '未检测到可用的自动安装方式，请前往官方下载页安装 Git，完成后点「重新检查」。',
			starting: '启动安装…',
			autoInstall: '自动安装',
			downloadPage: '下载页',
			officialDownloadPage: '官方下载页',
			autoInstallFailed: '自动安装不可用：{e}。请用下方命令手动安装。'
		},
		deps: {
			title: '运行工具',
			sub: '这些外部工具支持不同引擎与录屏等功能，可一键自动安装。',
			recheck: '重新检测',
			installed: '已安装',
			notInstalled: '未安装',
			install: '安装',
			installing: '安装中…',
			retry: '重试',
			needsNode: '需先安装 Node.js（提供 npm）',
			manualHint: '出于安全考虑不会自动执行 sudo，请复制命令到终端运行，完成后点「重新检测」。',
			copy: '复制命令',
			openPage: '打开下载页',
			logTitle: '安装输出',
			doneOk: '安装完成，正在重新检测…',
			doneFail: '安装失败（退出码 {code}）',
			startFailed: '无法启动安装：{e}',
			tools: {
				node: { name: 'Node.js / npm', desc: 'codex、jucode 等 CLI 的运行时' },
				ffmpeg: { name: 'FFmpeg', desc: '录屏与视频关键帧提取' },
				claude: { name: 'Claude Code', desc: 'Anthropic Claude Code 引擎' },
				codex: { name: 'Codex', desc: 'OpenAI Codex CLI 引擎' },
				jucode: { name: 'JuCode CLI', desc: '默认引擎（@jucode/cli）' }
			}
		},
		engineMissing: {
			head: '未找到 JuCode 引擎',
			tip: '正式安装包内置引擎；若你在开发环境，请设置 {bin} 或在同级目录构建 JuCode-CLI。'
		},
		loginOauth: {
			title: '登录 JuCode',
			sub: '登录后即可使用 JuCode 托管的模型；也可以用自己的 API Key 接入任意兼容端点。',
			loggedIn: '已登录，可继续下一步。',
			waiting: '等待浏览器授权…',
			loginBtn: '使用 JuCode 账号登录',
			browserOpened: '已在浏览器中打开授权页，完成后会自动识别。',
			or: '或',
			apiKeyBtn: '使用 API Key / 自定义 Provider'
		},
		done: {
			title: '一切就绪',
			gitReady: 'Git 已就绪',
			gitMissing: 'Git 仍缺失（部分功能受限）',
			loggedIn: '已登录',
			notLoggedIn: '未登录（可稍后在设置中配置）',
			hint: '提示：{cmdk} 打开命令面板，{slash} 唤起命令，{at} 引用文件。'
		},
		nav: {
			recheck: '重新检查',
			skip: '跳过',
			next: '下一步',
			prev: '上一步',
			skipLogin: '暂不登录',
			start: '开始使用'
		}
	},
	en: {
		steps: {
			env: 'Check Environment',
			login: 'Sign In',
			start: 'Get Started'
		},
		wizardLabel: 'Setup Wizard',
		skip: 'Skip',
		envCheck: {
			title: 'Check Runtime Environment',
			sub: 'JuCode needs git to read project files and manage versions. Here are the detection results.',
			engineName: 'JuCode Engine',
			notDetected: 'Not detected',
			engineNotFound: 'Engine binary not found'
		},
		installGit: {
			head: 'Install Git',
			tipMac: 'Click the button below to trigger the system "Command Line Tools" install (includes git). After completing it in the dialog, click "Re-check".',
			tipWinget: 'Click the button below to install Git automatically via winget (a system elevation prompt may appear), then click "Re-check".',
			tipLinux: 'For safety the app never runs sudo itself. Copy the command below into a terminal, then click "Re-check".',
			tipDownload: 'No automatic install method was detected. Install Git from the official download page, then click "Re-check".',
			starting: 'Starting install…',
			autoInstall: 'Auto Install',
			downloadPage: 'Download page',
			officialDownloadPage: 'Official download page',
			autoInstallFailed: 'Auto install unavailable: {e}. Please install manually using the command below.'
		},
		deps: {
			title: 'CLI Tools',
			sub: 'These external tools power the different engines and screen recording — install them with one click.',
			recheck: 'Re-check',
			installed: 'Installed',
			notInstalled: 'Not installed',
			install: 'Install',
			installing: 'Installing…',
			retry: 'Retry',
			needsNode: 'Install Node.js first (provides npm)',
			manualHint: 'For safety the app never runs sudo itself. Copy the command into a terminal, then click "Re-check".',
			copy: 'Copy command',
			openPage: 'Open download page',
			logTitle: 'Install output',
			doneOk: 'Install complete, re-checking…',
			doneFail: 'Install failed (exit code {code})',
			startFailed: 'Could not start install: {e}',
			tools: {
				node: { name: 'Node.js / npm', desc: 'Runtime for the codex / jucode CLIs' },
				ffmpeg: { name: 'FFmpeg', desc: 'Screen recording and video keyframes' },
				claude: { name: 'Claude Code', desc: 'Anthropic Claude Code engine' },
				codex: { name: 'Codex', desc: 'OpenAI Codex CLI engine' },
				jucode: { name: 'JuCode CLI', desc: 'Default engine (@jucode/cli)' }
			}
		},
		engineMissing: {
			head: 'JuCode Engine Not Found',
			tip: 'The official installer bundles the engine; if you are in a development environment, set {bin} or build JuCode-CLI in a sibling directory.'
		},
		loginOauth: {
			title: 'Sign in to JuCode',
			sub: 'Sign in to use JuCode-hosted models; you can also connect any compatible endpoint with your own API Key.',
			loggedIn: 'Signed in, you can continue to the next step.',
			waiting: 'Waiting for browser authorization…',
			loginBtn: 'Sign in with JuCode account',
			browserOpened: 'The authorization page has been opened in your browser; it will be detected automatically once complete.',
			or: 'or',
			apiKeyBtn: 'Use API Key / Custom Provider'
		},
		done: {
			title: 'All Set',
			gitReady: 'Git ready',
			gitMissing: 'Git still missing (some features limited)',
			loggedIn: 'Signed in',
			notLoggedIn: 'Not signed in (configure later in Settings)',
			hint: 'Tip: {cmdk} opens the command palette, {slash} invokes commands, {at} references files.'
		},
		nav: {
			recheck: 'Re-check',
			skip: 'Skip',
			next: 'Next',
			prev: 'Back',
			skipLogin: 'Skip for now',
			start: 'Get Started'
		}
	}
};
export default setup;
