# JuCode Desktop 差距清单（Gap Checklist）

> 基准：`main@6f83aa4`。配套阅读：`docs/workbench-plan.md`。
> 已勾选（[x]）= 方向已确认、直接排期实施；未勾选（[ ]）= 存在分歧或多方案，需要 owner 拍板后才能动工。

## 已确认（直接实施）

| 状态 | 事项 | 说明 | 相关代码 |
| --- | --- | --- | --- |
| [x] | 马赛克平铺树 + 多面板同时可见 | 手写二叉 TileTree，叶子为标签栈；替代"右 Dock 单激活面板"模型 | `src/lib/RightDock.svelte`、新 `src/lib/workbench/tiles.ts` |
| [x] | 双击最大化/还原 | 树外记 `maximizedLeafId`，不改布局树 | 新 `src/lib/workbench/` |
| [x] | 拖拽分屏落点预览 | 叶子边缘 1/4 命中区 + 半透明预览层 | 新 `src/lib/workbench/` |
| [x] | Workspace 实体 + 从 Project 迁移 | Workspace ⊃ Project；首启把现有 `SavedProject[]` 包进默认工作区，序列化加 `version` | `src/lib/session.svelte.ts`（`SavedProject`、`serialize/restore`） |
| [x] | 原生 TUI 标签 | `pty_open` 增加 cmd/args，直接跑 jucode/codex/claude 交互式 CLI；v1 为独立会话 | `src-tauri/src/lib.rs`（`pty_open`）、`src/lib/TerminalPanel.svelte` |
| [x] | ACP 作为新增后端（先上 feature flag） | 新 `BackendId` 类别；保留 codex/claude 原生 adapter（hunks/resume/set_model 不回退） | `src/lib/backends/index.ts`、新 `backends/acp.ts` |
| [x] | 模型选择器四分组 | Codex 官方 / Claude 官方 / JuCode 内置 / 自定义（BYOK），标注官方 vs 内置 | `src/lib/Composer.svelte`、`src/lib/settings/CustomProviderForm.svelte` |
| [x] | serve/CLI 功能对齐残留 | 补齐 `/pin`、`command_list` 等 CLI 已有而桌面缺失/不完整的命令 | `src/lib/backends/{jucode,codex,claude}.ts` |

## 待拍板（需 owner 决策）

| 状态 | 事项 | 选项与倾向 | 相关代码 |
| --- | --- | --- | --- |
| [ ] | CodeMirror 编辑器：保留 vs 隐藏 | A=冻结为 diff/代码审阅面（本文倾向）；B=移出主 UI。任一选项均不加 LSP | `src/lib/editor/EditorPane.svelte` 等 |
| [ ] | 内嵌浏览器 + DOM 拾取器：保留 vs 隐藏 | A=冻结为只读预览、移除 DOM 拾取器（倾向）；B=整体移除。拾取器+截图回传已近似 browser-use，与北极星冲突 | `src-tauri/src/browser.rs`、`src-tauri/src/browser_init.js`、`src/lib/BrowserPanel.svelte`、`src/lib/browser.svelte.ts` |
| [ ] | GitHub PR 创建：保留 vs 隐藏 | 倾向保留（属"交付"而非 IDE 功能），但需与北极星裁剪口径一致 | `src/lib/gitops.ts`（`gh pr view/create` 封装）、`src/lib/GitPanel.svelte` |
| [ ] | MiMo ASR 语音输入：保留 vs 隐藏 | MiMo 是 ASR 不是 LLM；与"管理 agent"主线无关但成本低 | `src/lib/audio.ts`、`src/lib/protocol.ts` |
| [ ] | 布局引擎：手写 vs dockview | 本文强烈倾向手写二叉树（轻量、可测、贴合 Svelte 5）；dockview 是重依赖 | 新 `src/lib/workbench/tiles.ts` |
| [ ] | GUI/TUI 同会话交接（handoff） | v1 不做；v2 可做"显式关一侧、resume 另一侧"（codex `thread/resume`、claude 会话文件）。永不双活 | `src/lib/backends/{codex,claude}.ts` |
| [ ] | IM 在应用退出后保持在线 | 需要独立守护进程（daemon）或系统服务；否则 IM 仅在桌面运行时可用 | 新模块，见 `docs/im-bridge.md` |
| [ ] | IM 渠道：仅走 OpenClaw 网关 vs 应用内原生 Rust 渠道实现 | 倾向 OpenClaw-only 起步；原生实现 = 5 套 SDK 维护成本 | 见 `docs/im-bridge.md` |
| [ ] | 技能来源：桌面直连 GitHub vs jucode-backend 聚合 | 直连（anthropics/skills raw）简单但无审计；后端聚合可做许可/兼容性过滤 | `src/lib/Marketplace.svelte`、`src/lib/protocol.ts`（`fetchMarketplace`） |
| [ ] | Provider 目录数据源 | models.dev 快照 vs OpenRouter 目录 vs 仅 JuCode `/v1/models` | `src/lib/settings/`、`src/lib/pricing.ts` |
| [ ] | 密钥存储：沿用 JSON vs OS 钥匙串 | 现状明文写 `~/.jucode/{config.json,auth.json}`；钥匙串更安全但跨平台成本高 | `src/lib/protocol.ts`（`writeConfig`） |
| [ ] | Workspace 持久化位置 | 现状会话/布局大量依赖 `localStorage`（如 `jucode-dock-tabs`）；建议迁 app-data 文件（可备份、可被 IM 桥读取） | `src/lib/RightDock.svelte`、`src/lib/session.svelte.ts` |
