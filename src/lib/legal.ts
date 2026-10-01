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
						'会话记录、设置和登录凭据保存在你的电脑上（~/.jucode 等目录）。应用不收集使用统计，也不上传崩溃报告。'
					]
				},
				{
					heading: '通过 JuCode 网关的请求',
					body: [
						'使用 JuCode 托管的模型时，请求内容经我们的服务器转发给相应的模型服务商处理。我们记录每次调用的模型、用量、费用和时间，用于计费和账单查询，账号存续期间保留。'
					]
				},
				{
					heading: '账号信息',
					body: ['注册和登录时提供的邮箱或手机号，以及充值订单信息，用于提供服务和处理付款。']
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
						'Sessions, settings and sign-in credentials are stored on your computer (in ~/.jucode and similar folders). The app collects no usage analytics and sends no crash reports.'
					]
				},
				{
					heading: 'Requests through the JuCode gateway',
					body: [
						'When you use JuCode-hosted models, your requests pass through our servers to the corresponding model provider. We record the model, usage, cost and time of each call for billing and your usage history, and keep these records while your account exists.'
					]
				},
				{
					heading: 'Account information',
					body: [
						'The email address or phone number you sign up with, and your top-up orders, are used to provide the service and process payments.'
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
