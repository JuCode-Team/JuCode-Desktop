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
				installFirst: '返回依赖安装，安装此智能体',
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
				sub: '必须选择使用的模型并保存，才能继续。',
				nativeHint: '选择 {name} 要使用的模型。登录 JuCode 后可使用账号内对应系列的模型。',
				chooseRequired: '请选择模型，再点击「确认模型」。预设默认值不会自动完成此步骤。',
				saving: '保存中…',
				confirm: '确认模型',
				confirmed: '模型已确认',
				empty: '还没有可用的模型。登录 JuCode 账号，或在设置中添加模型服务商。',
				emptyLoggedIn: '还没有选择要显示的模型。',
				pick: '选择要显示的模型',
				providers: '模型服务商设置',
				defaultHint: '当前服务商：{provider}。新对话默认使用这个模型。'
			},
			env: {
				title: '依赖安装',
				sub: '先安装运行所需的工具，再选择智能体和模型。',
				required: '必需工具',
				requiredHint: 'Node.js（含 npm）和 Git 必须安装并通过检测。',
				engines: '智能体安装',
				enginesHint: '至少准备一个要使用的智能体。JuCode 正式安装包已内置引擎。',
				optional: '可选工具',
				optionalHint: 'FFmpeg 用于录屏，GitHub CLI 用于 Pull Request；可以跳过。'
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
			manualInstall: '手动安装',
			logTitle: '安装输出',
			doneOk: '安装完成，已重新检测',
			doneFail: '安装失败（退出码 {code}）',
			upgradeOk: '升级完成，新会话使用新版本',
			dialogOpened: '已打开系统安装窗口，装完后点「重新检测」',
			upgradeFail: '升级失败（退出码 {code}）',
			startFailed: '无法启动安装：{e}',
			verifyFailed: '安装程序已退出，但 Claude Code 无法运行。请查看安装输出后重试。',
			verifyError: '无法验证安装结果：{e}',
			checkFailed: '依赖检测失败：{e}',
			notDetectedAfterInstall: '安装程序已退出，但仍未检测到此工具。请查看输出或手动安装后重新检测。',
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
				installFirst: 'Back to dependencies to install this agent',
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
				sub: 'Choose and save the model you will use before continuing.',
				nativeHint: 'Choose a model for {name}. Sign in to JuCode to use the matching model family on your account.',
				chooseRequired: 'Choose a model, then click "Confirm model". A preset default does not complete this step.',
				saving: 'Saving…',
				confirm: 'Confirm model',
				confirmed: 'Model confirmed',
				empty: 'No models yet. Sign in to JuCode, or add a model provider in Settings.',
				emptyLoggedIn: 'No models chosen to show yet.',
				pick: 'Choose models to show',
				providers: 'Model provider settings',
				defaultHint: 'Current provider: {provider}. New sessions start with this model.'
			},
			env: {
				title: 'Dependencies',
				sub: 'Install the required tools first, then choose your agent and model.',
				required: 'Required tools',
				requiredHint: 'Node.js (including npm) and Git must be installed and detected.',
				engines: 'Coding agents',
				enginesHint: 'Prepare at least one agent you will use. Official JuCode installers include the engine.',
				optional: 'Optional tools',
				optionalHint: 'FFmpeg enables recording; GitHub CLI enables pull requests. You can skip both.'
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
			manualInstall: 'Install manually',
			logTitle: 'Install output',
			doneOk: 'Installation complete; dependencies re-checked',
			doneFail: 'Install failed (exit code {code})',
			upgradeOk: 'Upgraded; new sessions use the new version',
			dialogOpened: 'The system installer is open; click "Re-check" once it finishes',
			upgradeFail: 'Upgrade failed (exit code {code})',
			startFailed: 'Could not start install: {e}',
			verifyFailed: 'The installer exited, but Claude Code cannot run. Check the install output and retry.',
			verifyError: 'Could not verify installation: {e}',
			checkFailed: 'Dependency check failed: {e}',
			notDetectedAfterInstall: 'The installer exited, but the tool was not detected. Check its output or install manually, then re-check.',
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
