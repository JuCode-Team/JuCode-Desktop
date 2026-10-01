// The beta terms and the privacy policy (LegalDoc.svelte shows them).

export type LegalDocId = 'terms' | 'privacy';

interface LegalText {
	title: string;
	updated: string;
	sections: { heading: string; body: string[] }[];
}

const CONTACT = 'contact@jucode.net';

export const LEGAL: Record<LegalDocId, Record<'zh' | 'en', LegalText>> = {
	terms: {
		zh: {
			title: '内测条款',
			updated: '更新于 2026 年 10 月 1 日',
			sections: [
				{
					heading: '内测版本',
					body: [
						'JuCode 由 Jucode Innovations INC. 提供，目前处于内测阶段。功能可能变化、出错或中断，请不要把它当作唯一的工作工具，重要代码请自行做好版本管理和备份。'
					]
				},
				{
					heading: '代码与操作',
					body: [
						'智能体会按你的指令读写本机文件、运行命令。审批模式决定哪些操作需要你确认。你对授权它执行的操作和产生的结果负责，模型输出也可能有错，请在使用前检查。'
					]
				},
				{
					heading: '账号与费用',
					body: [
						'使用 JuCode 托管的模型需要登录 JuCode 账号，费用按网站公布的价格从账户余额或套餐中扣除。请保管好账号和令牌，不要转借或用于违法用途。我们发现滥用时可以暂停或停止服务。'
					]
				},
				{
					heading: '第三方服务',
					body: [
						'你在本机登录的 Claude Code、Codex 等工具，以及你自己配置的 API，直接连接对应服务商，适用其各自的条款。'
					]
				},
				{
					heading: '许可与责任',
					body: [
						'JuCode 客户端以 Apache-2.0 许可证开源，按现状提供，不附带任何明示或默示的保证。在法律允许的范围内，我们不对因使用本软件造成的间接损失负责。',
						'条款更新后会在应用内展示，继续使用即视为同意。'
					]
				},
				{ heading: '联系我们', body: [CONTACT] }
			]
		},
		en: {
			title: 'Beta Terms',
			updated: 'Updated October 1, 2026',
			sections: [
				{
					heading: 'Beta software',
					body: [
						'JuCode is provided by Jucode Innovations INC. and is in beta. Features may change, break or stop working. Do not rely on it as your only tool, and keep your important code under version control with backups.'
					]
				},
				{
					heading: 'Your code and actions',
					body: [
						'Agents read and write files and run commands on your machine as you instruct; the approval mode decides what needs your confirmation. You are responsible for the actions you allow and their results. Model output can be wrong, so review it before use.'
					]
				},
				{
					heading: 'Account and charges',
					body: [
						'JuCode-hosted models require a JuCode account and are charged to your balance or plan at the prices published on our website. Keep your account and tokens safe and do not share them or use them unlawfully. We may suspend or end service in case of abuse.'
					]
				},
				{
					heading: 'Third-party services',
					body: [
						'Claude Code, Codex and other tools you sign in to on this machine, and APIs you configure yourself, connect directly to their providers under those providers’ terms.'
					]
				},
				{
					heading: 'License and liability',
					body: [
						'The JuCode client is open source under the Apache-2.0 license and provided as is, without warranties of any kind. To the extent permitted by law, we are not liable for indirect damages arising from its use.',
						'Updated terms are shown in the app; continuing to use JuCode means you accept them.'
					]
				},
				{ heading: 'Contact', body: [CONTACT] }
			]
		}
	},
	privacy: {
		zh: {
			title: '隐私政策',
			updated: '更新于 2026 年 10 月 1 日',
			sections: [
				{
					heading: '保存在本机的数据',
					body: [
						'会话记录、项目、文件和登录凭据保存在你的电脑上（~/.jucode 等目录）。应用不收集产品使用分析，也不上传崩溃报告。'
					]
				},
				{
					heading: '登录后同步到账号的数据',
					body: [
						'登录 JuCode 账号后，编码智能体每一轮对话的用量会上传到你的账号，用于在你的各台电脑上查看用量。内容包括：时间、后端、渠道、模型、各类 Token 数、请求次数、会话编号和所在电脑。使用你自己的密钥或账号时也会记录用量，但不上传密钥。对话内容、文件、项目名称和路径不上传，各项目的用量只保存在本机。',
						'语言、主题、默认后端、模型默认值、网络和语音设置会保存到账号，在你登录的电脑之间同步。密钥、自定义渠道、MCP、技能、Agent 和定时任务不上传。',
						'这些数据在账号存续期间保留。退出登录后，这台电脑不再上传。'
					]
				},
				{
					heading: '通过 JuCode 网关的请求',
					body: [
						'使用 JuCode 托管的模型时，请求内容经我们的服务器转发给相应的模型服务商处理。',
						'为排查故障、处理争议和满足合规要求，请求内容会加密存档，一般保留 14 天后删除；因违反使用规则被拦截的请求，相关记录保留时间更长。',
						'每次调用的模型、用量、费用和时间用于计费和账单查询，在账号存续期间保留。'
					]
				},
				{
					heading: '账号信息',
					body: [
						'注册和登录时提供的邮箱或手机号，以及充值订单信息，用于提供服务和处理付款。',
						'每台登录的电脑会显示在「授权设备管理」中，名称包括应用名、主机名、操作系统，以及由本机标识计算出的一段短代码，用于区分同名电脑。'
					]
				},
				{
					heading: '远程控制与更新',
					body: [
						'使用远程控制时，中转服务在桌面端和网页之间转发消息，并记录连接的 IP 地址，用于安全防护和排查问题。',
						'检查更新时，应用会访问 GitHub 和我们的服务器，对方可以看到你的 IP 地址。'
					]
				},
				{
					heading: '第三方',
					body: [
						'我们不出售你的数据。除转发给你所选的模型服务商和完成支付所需外，不向第三方提供你的数据，法律要求的情形除外。'
					]
				},
				{
					heading: '查询与删除',
					body: [`如需查询、导出或删除你的账号数据，请发邮件到 ${CONTACT}。`]
				}
			]
		},
		en: {
			title: 'Privacy Policy',
			updated: 'Updated October 1, 2026',
			sections: [
				{
					heading: 'Data on your machine',
					body: [
						'Sessions, projects, files and sign-in credentials are stored on your computer (in ~/.jucode and similar folders). The app collects no product analytics and sends no crash reports.'
					]
				},
				{
					heading: 'Data synced to your account when signed in',
					body: [
						'When you are signed in to JuCode, the usage of each coding agent turn is uploaded to your account so you can see it on all your computers: time, backend, channel, model, token counts, request count, session ID and the computer. Usage on your own keys or accounts is recorded too, but the keys are not uploaded. Conversation content, files, project names and paths are not uploaded; per-project usage stays on your computer.',
						'Language, theme, default backend, model defaults, network and voice settings are saved to your account and synced between the computers you sign in on. Keys, custom providers, MCP, skills, agents and schedules are not uploaded.',
						'This data is kept while your account exists. After you sign out, the computer stops uploading.'
					]
				},
				{
					heading: 'Requests through the JuCode gateway',
					body: [
						'When you use JuCode-hosted models, your requests pass through our servers to the corresponding model provider.',
						'To troubleshoot, resolve disputes and meet legal obligations, request content is archived encrypted and normally deleted after 14 days; records of requests blocked for breaking our usage rules are kept longer.',
						'The model, usage, cost and time of each call are kept while your account exists, for billing and your usage history.'
					]
				},
				{
					heading: 'Account information',
					body: [
						'The email address or phone number you sign up with, and your top-up orders, are used to provide the service and process payments.',
						'Each computer you sign in on is listed under authorized devices, named by the app, host name, operating system and a short code derived from the computer’s ID, so computers with the same name can be told apart.'
					]
				},
				{
					heading: 'Remote control and updates',
					body: [
						'With remote control, our relay forwards messages between the desktop app and the web page and records the IP addresses that connect, for security and troubleshooting.',
						'Update checks contact GitHub and our servers, which can see your IP address.'
					]
				},
				{
					heading: 'Third parties',
					body: [
						'We do not sell your data. We share it only with the model providers you choose and as needed to complete payments, or where the law requires.'
					]
				},
				{
					heading: 'Access and deletion',
					body: [`To access, export or delete your account data, email ${CONTACT}.`]
				}
			]
		}
	}
};
