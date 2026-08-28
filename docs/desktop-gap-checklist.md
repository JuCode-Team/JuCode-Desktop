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
| [x] | ACP 作为新增后端（先上 feature flag） | 新 `BackendId` 类别；保留 jucode/codex/claude 原生 adapter（hunks/resume/set_model 不回退） | `src/lib/backends/index.ts`、新 `backends/acp.ts` |
| [x] | 模型选择器四分组 | Codex 官方 / Claude 官方 / JuCode 内置 / 自定义（BYOK），标注官方 vs 内置 | `src/lib/Composer.svelte`、`src/lib/settings/CustomProviderForm.svelte` |
| [x] | serve/CLI 功能对齐残留 | 补齐 `/pin`、`command_list` 等 CLI 已有而桌面缺失/不完整的命令 | `src/lib/backends/{jucode,codex,claude}.ts` |
| [x] | CodeMirror 仅作 AUDIT/diff 审阅面 | 不扩展为编辑器、不加 LSP；默认隐藏，只能由用户交互打开 | `src/lib/editor/EditorPane.svelte` 等 |
| [x] | 内嵌浏览器保留元素拾取器 | 浏览器仅用于预览与用户主动 pick；不做 agent 浏览器自动化，不把 picker 定义为 browser-use | `src-tauri/src/browser.rs`、`src-tauri/src/browser_init.js`、`src/lib/BrowserPanel.svelte`、`src/lib/browser.svelte.ts` |
| [x] | GitHub PR 作为插件 | 保留 PR 交付能力，但从 core 边界移到插件，不作为桌面核心功能 | `src/lib/gitops.ts`、`src/lib/GitPanel.svelte` |
| [x] | 扩展 ASR 接入 | 保留 MiMo ASR，并扩展到更多 ASR 协议/provider；不将 ASR 归类为 LLM provider | `src/lib/audio.ts`、`src/lib/protocol.ts` |
| [x] | IM 独立 agent | OpenClaw 网关优先；默认 confirm-before-assign；v1 随桌面生命周期运行，不做 always-on daemon，后续有需要再评估 | 见 `docs/im-bridge.md` |
| [x] | 技能来源 | 同时支持官方 JuCode 技能与 [anthropics/skills](https://github.com/anthropics/skills)，并展示许可与后端兼容性 | `src/lib/Marketplace.svelte`、`src/lib/protocol.ts` |
| [x] | Provider 目录 | 内置 models.dev 快照 + 复用现有 BYOK 通道 + OpenRouter featured；不内嵌 LiteLLM | `src/lib/settings/`、`src/lib/pricing.ts` |
| [x] | 密钥存储 | 密钥继续存 JSON，以简单加密保护；不接 OS keychain | `src/lib/protocol.ts`（`writeConfig`） |
| [x] | Workspace 持久化 | 迁移到 app-data 文件并带版本；不使用 `localStorage` 作为 Workspace/布局持久层 | `src/lib/RightDock.svelte`、`src/lib/session.svelte.ts` |
| [x] | 产品能力边界 | 不做 memory、computer-use、内置 browser-use；元素拾取器仅是用户控制的 preview + pick | `src/lib/BrowserPanel.svelte`、`src-tauri/src/browser_init.js` |

## 后续项（不影响已锁定方向）

| 状态 | 事项 | 规划 | 相关代码 |
| --- | --- | --- | --- |
| [ ] | GUI/TUI 同会话交接（handoff） | v1 不做；v2 可做"显式关一侧、resume 另一侧"（codex `thread/resume`、claude 会话文件）。永不双活 | `src/lib/backends/{codex,claude}.ts` |
