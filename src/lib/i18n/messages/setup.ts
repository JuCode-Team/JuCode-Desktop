// Setup area: the welcome page (sign-in and the Get Started walkthrough).
const setup = {
	zh: {
		welcome: {
			label: '欢迎使用 JuCode',
			login: {
				title: '登录 JuCode',
				sub: '登录后可使用 JuCode 账号下的模型。也可以填写自己的 API\u00a0Key，接入其他模型服务商。',
				apiKey: '使用自己的 API Key',
				later: '暂不登录，先完成设置'
			},
			guide: {
				title: '开始使用',
				sub: '以下各项之后都可以在设置页修改。',
				progress: '已完成 {done}/{total}',
				backToLogin: '返回登录'
			},
			account: {
				title: '账号',
				sub: '登录 JuCode 账号，或使用自己的 API Key。',
				loggedIn: '已登录 JuCode 账号。',
				byok: '已配置 API Key。',
				manage: '管理账号'
			},
			agent: {
				title: '编程智能体',
				sub: '选择新对话默认使用的智能体。每个对话也可以单独切换。',
				desc: {
					jucode: 'JuCode 自带引擎，可使用账号内的模型和自定义服务商。',
					claude: 'Anthropic 的 Claude Code，使用本机安装的 claude 命令。',
					codex: 'OpenAI 的 Codex CLI，使用本机安装的 codex 命令。'
				},
				more: '其他支持 ACP 协议的智能体可以在设置中添加。',
				moreLink: '添加 ACP 智能体'
			},
			model: {
				title: '模型',
				sub: '设置 JuCode 引擎的默认模型和思考强度。',
				otherBackend: '{name} 使用自己的模型设置，可在对话输入框的模型菜单中切换。以下设置只作用于 JuCode 引擎。',
				empty: '还没有可用的模型。登录 JuCode 账号，或在设置中添加模型服务商。',
				emptyLoggedIn: '还没有选择要显示的模型。',
				pick: '选择要显示的模型',
				providers: '模型服务商设置',
				defaultHint: '当前服务商：{provider}。新对话默认使用这个模型。'
			},
			env: {
				title: '运行环境',
				sub: 'JuCode 需要 Git 读取项目文件和管理版本。下面是本机的检测结果。'
			},
			appearance: {
				title: '外观',
				sub: '选择主题和界面语言。'
			},
			basics: {
				title: '基础操作',
				sub: '最常用的几个操作。',
				palette: '打开命令面板',
				newSession: '新建对话',
				slash: '在输入框中调用命令',
				mention: '在输入框中引用文件',
				all: '全部快捷键：'
			}
		},
		envCheck: {
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
			upgradeOk: '升级完成，新会话使用新版本',
			dialogOpened: '已打开系统安装窗口，装完后点「重新检测」',
			upgradeFail: '升级失败（退出码 {code}）',
			startFailed: '无法启动安装：{e}',
			tools: {
				node: { name: 'Node.js / npm', desc: 'codex、jucode 等 CLI 的运行时' },
				ffmpeg: { name: 'FFmpeg', desc: '录屏与视频关键帧提取' },
				git: { name: 'Git', desc: 'Git 面板、并行任务与引擎的代码仓库操作' },
				gh: { name: 'GitHub CLI', desc: '在 Git 面板查看和创建 Pull Request' },
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
			waiting: '等待浏览器授权…',
			loginBtn: '使用 JuCode 账号登录',
			browserOpened: '已在浏览器中打开授权页，完成后会自动识别。',
			agreeBefore: '继续使用即表示同意',
			agreeAnd: '和',
			agreeAfter: ''
		},
		nav: {
			recheck: '重新检查',
			next: '下一步',
			start: '开始使用'
		}
	},
	en: {
		welcome: {
			label: 'Welcome to JuCode',
			login: {
				title: 'Sign in to JuCode',
				sub: 'Sign in to use the models on your JuCode account, or connect another model provider with your own API key.',
				apiKey: 'Use my own API key',
				later: 'Skip sign-in and continue setup'
			},
			guide: {
				title: 'Get Started',
				sub: 'Everything here can be changed later in Settings.',
				progress: '{done} of {total} done',
				backToLogin: 'Back to sign-in'
			},
			account: {
				title: 'Account',
				sub: 'Sign in to a JuCode account, or use your own API key.',
				loggedIn: 'Signed in to JuCode.',
				byok: 'An API key is configured.',
				manage: 'Manage account'
			},
			agent: {
				title: 'Coding Agent',
				sub: 'The agent new sessions start with. Each session can still switch on its own.',
				desc: {
					jucode: 'The built-in JuCode engine, with your account models and custom providers.',
					claude: 'Anthropic Claude Code, using the claude command installed on this machine.',
					codex: 'OpenAI Codex CLI, using the codex command installed on this machine.'
				},
				more: 'Other agents that speak ACP can be added in Settings.',
				moreLink: 'Add an ACP agent'
			},
			model: {
				title: 'Model',
				sub: 'The JuCode engine\'s default model and reasoning effort.',
				otherBackend: '{name} keeps its own model settings; switch them from the model menu in the composer. The settings below apply to the JuCode engine only.',
				empty: 'No models yet. Sign in to JuCode, or add a model provider in Settings.',
				emptyLoggedIn: 'No models chosen to show yet.',
				pick: 'Choose models to show',
				providers: 'Model provider settings',
				defaultHint: 'Current provider: {provider}. New sessions start with this model.'
			},
			env: {
				title: 'Environment',
				sub: 'JuCode needs Git to read project files and manage versions. Here is what this machine has.'
			},
			appearance: {
				title: 'Appearance',
				sub: 'Theme and interface language.'
			},
			basics: {
				title: 'Basics',
				sub: 'The few you will use most.',
				palette: 'Command palette',
				newSession: 'New session',
				slash: 'Run a command in the composer',
				mention: 'Reference a file in the composer',
				all: 'All shortcuts:'
			}
		},
		envCheck: {
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
			upgradeOk: 'Upgraded; new sessions use the new version',
			dialogOpened: 'The system installer is open; click "Re-check" once it finishes',
			upgradeFail: 'Upgrade failed (exit code {code})',
			startFailed: 'Could not start install: {e}',
			tools: {
				node: { name: 'Node.js / npm', desc: 'Runtime for the codex / jucode CLIs' },
				ffmpeg: { name: 'FFmpeg', desc: 'Screen recording and video keyframes' },
				git: { name: 'Git', desc: 'The Git panel, parallel tasks and the engines’ repository work' },
				gh: { name: 'GitHub CLI', desc: 'View and create pull requests in the Git panel' },
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
			waiting: 'Waiting for browser authorization…',
			loginBtn: 'Sign in with JuCode account',
			browserOpened: 'The authorization page has been opened in your browser; it will be detected automatically once complete.',
			agreeBefore: 'By continuing you agree to the ',
			agreeAnd: ' and the ',
			agreeAfter: '.'
		},
		nav: {
			recheck: 'Re-check',
			next: 'Next',
			start: 'Get Started'
		}
	}
};
export default setup;
