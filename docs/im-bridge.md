# IM 桥设计（IM Bridge）

> 配套阅读：`docs/workbench-plan.md` §3.7。定位：IM 是 JuCode Desktop 唯一的第三方集成方向。

## 1. 形态：独立 IM agent

IM 桥是一个 **独立 agent**，不是聊天会话里的一个功能：

- 它不复用 `src/lib/session.svelte.ts` 里的任何会话；它通过桌面端暴露的 MCP server 与工作台交互。
- 职责只有三类：**查询**（workspace / 项目 / 标签页 / 会话的结构化状态）、**通知**（会话进度与完成事件推送到 IM 渠道）、**指派**（把 IM 侧收到的 prompt 提交给指定会话，经确认队列）。
- 它不直接持有任何引擎 adapter，也不读写用户文件系统。

```
IM 渠道 ── OpenClaw 网关 ── IM agent ── MCP(localhost+token) ── JuCode Desktop
 (微信/TG/Discord/飞书)                                          (workspace/会话)
```

## 2. 桌面端 MCP 工具清单

桌面端内置一个仅监听 `127.0.0.1` 的 MCP server（streamable HTTP），供 IM agent 调用：

| 工具 | 类型 | 说明 |
| --- | --- | --- |
| `list_workspaces` | 查询 | 返回 workspace → project → 标签页树（id、名称、路径、后端、布局摘要） |
| `get_session_status` | 查询 | 指定会话的状态：引擎、模型、运行/空闲/等待批准、当前 plan 步骤、最近一条消息摘要 |
| `get_session_transcript_tail` | 查询 | 会话最近 N 条消息的脱敏文本（不含文件内容附件） |
| `list_pending_approvals` | 查询 | 各会话待批准的工具调用摘要 |
| `assign_prompt` | 指派 | 向指定会话提交 prompt；**默认进入确认队列**，返回 queue id |
| `get_assignment_status` | 查询 | 查询指派的状态（排队 / 已放行 / 已拒绝 / 已完成） |
| `subscribe_events` | 通知 | 订阅进度事件流：turn 开始/结束、plan 更新、会话完成、错误、待批准出现 |

**刻意不提供**：文件读写、shell 执行、批准/拒绝工具调用、修改配置——IM 侧永远拿不到直接改动本机的能力。

## 3. 安全模型

1. **仅 localhost**：MCP server 绑定 `127.0.0.1`，不监听外网；与外部渠道的连接由 IM agent 经 OpenClaw 网关向外发起（出站连接），桌面端不开公网入站端口。
2. **Token 鉴权**：桌面端启动时生成随机 token，IM agent 必须携带；token 不落 IM 渠道，只存在于本机配置。
3. **确认队列（confirm-before-assign，默认开启）**：`assign_prompt` 不直接注入会话，而是进入桌面 UI 的确认队列，用户看到"来自 <渠道>/<发送者> 的 prompt → 目标会话"后手动放行。可按渠道+会话粒度选择"信任后自动放行"，默认不信任。
4. **无文件系统工具**：见上表；即使 IM agent 被劫持，攻击面也止于"读会话摘要 + 排队一条待确认的 prompt"。
5. **发送者白名单**：渠道侧只响应绑定过的账号/群。

## 4. 渠道接入

统一经 **OpenClaw / Cloudbot 网关** 接入，不在应用内手写 5 套渠道 SDK（待拍板项见 `docs/desktop-gap-checklist.md`）：

| 渠道 | 接入方式 | 说明 |
| --- | --- | --- |
| Telegram | 官方 Bot API | 经 OpenClaw 渠道插件 |
| Discord | 官方 Bot API（Gateway） | 经 OpenClaw 渠道插件 |
| 飞书 | 官方开放平台机器人 API | 经 OpenClaw 渠道插件 |
| 微信 | **腾讯 openclaw-weixin / iLink 插件** | 走腾讯提供的插件通道，而非第三方协议 hook / 逆向方案。注意：不要将其宣传为"合法官方机器人 API"之类的合规背书；本文档不做任何法律层面的声明，接入前请自行确认适用条款 |

## 5. 边界与后续

- **应用退出后 IM 是否在线**：当前设计下 MCP server 随桌面应用生命周期存在，应用退出即离线；若要求 always-on，需要独立 daemon（待拍板，见 checklist）。
- v1 通知走轮询/事件订阅二选一实现即可，不引入消息队列等重依赖（遵循 AGENTS.md 轻量原则）。
