# JuCode Desktop 工作台架构规划（Workbench Plan）

> 基准代码：`main@6f83aa4`。定位声明：JuCode Desktop 是一个 **终端 / TUI 编码代理管理器**，不是完整的 AI IDE。本文给出从当前代码到北极星目标的架构方案。

## 1. 现状（已核实事实）

以下每条均在 `6f83aa4` 上核实过，附代码出处：

- **技术栈**：Tauri 2 + Svelte 5（runes）。前端入口 `src/routes/+page.svelte`，Rust 侧 `src-tauri/src/lib.rs`。
- **多引擎后端**：jucode / codex / claude 三个后端通过统一的 `EngineAdapter` 接口接入（`src/lib/backends/index.ts` 的 `createAdapter(id: BackendId)`，实现在 `src/lib/backends/{jucode,codex,claude}.ts`）。事件被归一化为 `NormalizedEvent` 流。
- **布局**：侧边栏（`src/lib/Sidebar.svelte`）+ 聊天主区 + 可选 CodeMirror 编辑器（`src/lib/editor/EditorPane.svelte`）+ 右侧 Dock。右侧 Dock 共 **9 种面板类型**（`src/lib/RightDock.svelte` 的 `ALL_PANELS`：plan / goal / changes / turns / files / git / term / browser / diag），同一时刻只有一个激活标签；标签持久化在 `localStorage`（key `jucode-dock-tabs`）。
- **项目 ⊃ 会话，但没有 Workspace**：`src/lib/session.svelte.ts` 的 `SavedProject` 持久化 `{id, name, path, tabs[], worktree?, lastBackend?}`，即一个 Project 已经容纳多个会话标签，但不存在跨项目的 Workspace 实体。
- **内嵌浏览器是原生子窗口**：`src-tauri/src/browser.rs` 用 `WebviewWindowBuilder` 创建原生子 `WebviewWindow`（非 DOM iframe），全局单例（`BROWSER_LABEL`），由前端 `src/lib/BrowserPanel.svelte` 定位覆盖到面板区域。带 DOM 元素拾取器（`src/lib/browser.svelte.ts`、`src-tauri/src/browser_init.js`）。
- **PTY 已存在但只跑用户 shell**：Rust 侧基于 `portable-pty`（`src-tauri/src/lib.rs` 中 `pty_open/pty_write/pty_resize/pty_close`），前端 `src/lib/TerminalPanel.svelte` 用 `@xterm/xterm` 渲染。当前 `pty_open` 启动的是用户默认 shell，**不是** agent 交互式 TUI。
- **没有任何 ACP**（Agent Client Protocol）代码。
- **模型选择器已存在**：`src/lib/Composer.svelte` 的 `modelRows/modelActive` 弹层，由各 adapter 的 `model_status` / `set_model` 驱动；支持自定义 OpenAI 兼容 provider（`src/lib/settings/CustomProviderForm.svelte`，字段 `id/base_url/api_key/models`）。**MiMo 是 ASR（语音输入），不是 LLM**（`src/lib/audio.ts`、`src/lib/protocol.ts`）。
- **MCP / 技能 UI 仅对 jucode 后端生效**：`src/lib/settings/McpSection.svelte`、`src/lib/Marketplace.svelte`（经 `/skills install` 命令下发），codex / claude 后端不接入这套 UI。
- **没有任何 IM 集成**。
- **已有的"偏 IDE"能力清单**：CodeMirror 编辑器（含 diff gutter / AI 高亮）、内嵌浏览器 + DOM 拾取器、屏幕捕获（`src-tauri/src/capture.rs`）、并行任务 worktree（`src/lib/gitops.ts` 的 `parseWorktreeList` 等）、Git 面板、GitHub PR 桥（`src/lib/gitops.ts` 封装 `gh pr view/create`，UI 在 `src/lib/GitPanel.svelte`）。

## 2. 北极星目标（用户输入）

1. 管理所有编码 agent：既提供 GUI 包装，也能直接跑 **原生 agent TUI**。
2. **马赛克（mosaic）标签布局**：多个标签同时可见、类 Windows Snap 的吸附分屏、双击最大化/还原、拖拽时显示分屏预览。
3. **Workspace 包含多个标签页**（跨项目）。
4. ACP 包装质量对标 VS Code agents UI / T3code。
5. MCP + 技能插件管理；官方 JuCode 技能 + Anthropic 技能（[anthropics/skills](https://github.com/anthropics/skills)；注意其中 docx/pdf/pptx/xlsx 四个文档技能是 **source-available 而非 OSS 许可**，且 Claude Code 无法使用这些预置文档技能）。
6. 模型切换四分组：Codex 官方 / Claude 官方 / JuCode 已配置全部模型；区分"官方 provider"与"内置 provider"。
7. 更多 LLM provider 通过 **复用** 接入，而不是写 10+ 个 adapter。
8. **不是完整 IDE**：不做 memory、不做 computer-use、不做 browser-use。
9. 唯一的第三方集成是 **IM**：微信（经腾讯 openclaw-weixin / iLink 插件接入——**不要**将其表述为"合法官方机器人 API"）、OpenClaw/Cloudbot、Telegram、Discord、飞书。
10. IM 是一个 **独立 agent**：可查询 workspace / 标签页结构化信息、推送进度与完成通知、把 prompt 指派到指定会话。

## 3. 架构建议

### 3.1 实体模型：Workspace ⊃ Project

在 `SavedProject` 之上加一层 Workspace，而不是重写会话层：

```
Workspace ─┬─ Project A ─┬─ Session(GUI, jucode)
           │             └─ Session(TUI, codex)   ← PTY 标签
           ├─ Project B ── Session(GUI, claude)
           └─ layout: TileTree                     ← 布局归 Workspace
```

- `SessionStore`（`src/lib/session.svelte.ts`）当前直接持有 `projects: Project[]`；新增 `WorkspaceStore` 持有 `workspaces: Workspace[]`，每个 Workspace 引用一组 project id + 一棵布局树。
- **迁移**：首次启动时把现有全部 `SavedProject[]` 包进一个名为"默认工作区"的 Workspace，序列化格式加 `version` 字段。现有 `serialize()/restore()`（`session.svelte.ts:459/482`）保持兼容读取。

### 3.2 布局：手写二叉平铺树（不引入 dockview）

- 数据结构：`TileNode = Leaf(tabStackId) | Split(dir, ratio, [TileNode, TileNode])`。纯函数操作（split / remove / resize / normalize），放 `src/lib/workbench/tiles.ts`，配单测（拆分、移除后归并、比例归一化）。
- 每个叶子是一个 **标签栈**（多个 tab，一个激活），tab 内容类型：GUI 会话 / TUI 会话 / 冻结的预览面板（见 3.6）。
- 交互：拖拽 tab 到叶子边缘 1/4 区域显示半透明 **分屏预览**（一个绝对定位 div，无需引擎支持）；**双击 tab 栏最大化/还原**（在树外记一个 `maximizedLeafId`，还原即清空，不改树）。
- 不用 dockview 的理由：它是 Vue/React/vanilla 面板框架，体积与抽象都超出需要，且与 Svelte 5 runes 响应式模型不贴合；本项目设计规则明确"性能与轻量优先、不引入重依赖"（AGENTS.md）。二叉树 + 少量 DOM 是可控且可测的。
- 现有 `RightDock.svelte` 的 9 面板可以先原样作为一种 tab 类型挂进叶子，逐步拆散。

### 3.3 原生 TUI 标签 = PTY 里跑交互式 CLI

- 复用现有 PTY 通道：给 `pty_open`（`src-tauri/src/lib.rs:2197`）加可选 `cmd/args` 参数，直接拉起 `jucode` / `codex` / `claude` 交互式 CLI，而不是用户 shell；前端复用 `TerminalPanel.svelte` 的 xterm 渲染。
- **v1：独立会话**。TUI 标签就是一个独立的 agent 会话，与 GUI 会话互不共享状态。这是零协议成本的正确起点。
- **v2（可选）：显式交接（handoff）**。GUI 会话可"转为 TUI"：GUI 侧关闭 adapter，拿会话/thread id，在 PTY 里以 resume 方式拉起 CLI（codex 有 `thread/resume`，claude 有 `--session-id` + 会话文件，见 `src/lib/backends/{codex,claude}.ts`）。反向同理。
- **永远不做"双活"**：同一引擎会话绝不同时被 GUI adapter 和 TUI 进程持有——两个客户端抢一个 stdio/会话文件没有可靠语义。

### 3.4 ACP：作为新增 BackendKind，不替换原生 adapter

- 在 `src/lib/backends/index.ts` 的 `BackendId` 上新增 `acp` 类别（一个 ACP adapter × N 个可执行配置），先藏在 feature flag 后面。
- **保留** codex / claude 原生 adapter：它们已实现 diff hunks、`resume`、`set_model`、command_list 等能力（见 `src/lib/backends/codex.test.ts`、`claude.test.ts` 中对 `caps.resume`、`set_model`、`command_list` 的断言），ACP v1 协议面覆盖不了这些，切 ACP 会是功能回退。
- ACP 的价值是**长尾**：任何实现了 ACP 的第三方 agent 一次接入，UI 质量对标 VS Code agents UI / T3code——即 plan、tool call、diff、权限请求都走已有的 `NormalizedEvent` 归一化渲染，而不是另做一套界面。

### 3.5 模型与 Provider

- 模型选择器改为四分组：**Codex 官方 / Claude 官方 / JuCode 内置 / 自定义**。数据源分别是 codex adapter 的 `model_status`、claude adapter 的 `list_models`、jucode 后端配置、`CustomProviderForm` 的 BYOK 条目。UI 上明确标注"官方 provider"与"内置 provider"。
- 扩展更多 provider 走 **目录 + BYOK 复用**，不写 10+ adapter：
  - 内置一份 [models.dev](https://models.dev) 目录快照（构建期生成的 JSON），提供 provider → base_url / 模型清单的预填；用户只填 API key，落到现有自定义 OpenAI 兼容 provider 通道。
  - OpenRouter 作为 featured 条目置顶（一个 key 覆盖长尾模型）。
  - **不在桌面端内嵌 LiteLLM**：那是一个 Python 代理服务，与"轻量桌面应用"冲突；聚合应发生在 jucode 后端或用户自己的网关。

### 3.6 收敛"IDE 化"能力（两种专家观点，需要拍板）

北极星明确"不是完整 IDE、不做 browser-use"，但代码里已有编辑器、内嵌浏览器 + DOM 拾取器、GitHub PR 桥。两种处理观点：

- **观点 A（冻结为预览面）**：保留 CodeMirror 编辑器和内嵌浏览器，但**冻结**——编辑器定位为"代码/diff 审阅面"（保留 diff gutter、AI 高亮），浏览器定位为"只读预览面"；不再投入 LSP、补全、调试等 IDE 方向的功能。理由：审阅 agent 产出的 diff、预览 agent 起的 dev server，是"管理 agent"闭环的一部分，不是 IDE 功能。
- **观点 B（移除/隐藏）**：编辑器、内嵌浏览器、GitHub PR 桥都移出主 UI（藏到设置开关或直接删）。理由：DOM 拾取器 + 截图回传（`browser_init.js` + `capture.rs`）事实上已经是半个 browser-use，与北极星直接冲突；留着就会被继续投喂功能。
- **本文建议**：取 A 的编辑器（冻结为审阅面）+ 介于 A/B 之间的浏览器（冻结为纯预览；**若用户确认严格执行北极星，则移除 DOM 拾取器**）。GitHub PR 桥保留（它服务于"agent 完成任务后交付"，不是 IDE 功能）。**明确不加 LSP**。最终需 owner 在 `docs/desktop-gap-checklist.md` 中逐项拍板。

### 3.7 IM：独立 agent + MCP 桥（详见 `docs/im-bridge.md`）

- IM agent 是独立进程/会话，不复用聊天会话。桌面端暴露一个 **仅监听 localhost、token 鉴权的 MCP server**，提供查询 workspace/标签结构、读取会话进度、指派 prompt 等工具。
- 渠道接入统一走 **OpenClaw 网关**（Telegram / Discord / 飞书官方 Bot API；微信经腾讯 openclaw-weixin / iLink 插件），**不要**上来就在应用内手写 5 套渠道 SDK。
- 默认 **confirm-before-assign**：IM 侧发来的 prompt 先进桌面确认队列，用户放行后才注入会话。

### 3.8 技能与 MCP 管理

- 现有 Marketplace（`src/lib/Marketplace.svelte`）与 MCP 设置（`McpSection.svelte`）是 jucode-only。规划为统一插件管理页：
  - **技能源**：官方 JuCode 技能 + [anthropics/skills](https://github.com/anthropics/skills)。展示时标注许可：anthropics/skills 中 docx / pdf / pptx / xlsx 为 source-available（非 OSS），且 **Claude Code 无法使用这些预置文档技能**，UI 需按后端做可用性过滤。
  - **MCP**：配置按后端能力分发（jucode 走现有 `/mcp` 命令通道；claude / codex 写各自配置文件）。
  - 技能获取路径（桌面直连 GitHub vs 经 jucode-backend 聚合）是待拍板项。

## 4. 分期

| 阶段 | 内容 | 涉及模块 |
| --- | --- | --- |
| M1 | 平铺树 + 多可见面板 + 双击最大化 + 分屏预览；Workspace 实体与迁移 | `src/lib/workbench/`（新）、`session.svelte.ts`、`+page.svelte` |
| M2 | 原生 TUI 标签（PTY 跑 jucode/codex/claude CLI，独立会话） | `src-tauri/src/lib.rs`（pty_open 扩展）、`TerminalPanel.svelte` |
| M3 | 模型选择器四分组；provider 目录 + BYOK 复用；serve/CLI 功能对齐残留（`/pin`、`command_list`） | `Composer.svelte`、`settings/`、`backends/` |
| M4 | ACP backend（flag 后）；技能/MCP 统一管理页 | `backends/acp.ts`（新）、`Marketplace.svelte`、`McpSection.svelte` |
| M5 | IM 桥（MCP server + OpenClaw 网关 + 确认队列） | 新 crate/模块，见 `docs/im-bridge.md` |
| 贯穿 | IDE 能力收敛（按 checklist 拍板结果执行） | `editor/`、`BrowserPanel`、`GitPanel` |

## 5. 不做的事

- 不做完整 IDE：无 LSP、无补全、无调试器。
- 不做 memory、computer-use、browser-use。
- 不在桌面端内嵌 LiteLLM 等聚合代理。
- 不为 IM 手写 5 套渠道 SDK。
- 不引入 dockview 等重型面板框架。
- 不做 GUI/TUI 同会话双活。
