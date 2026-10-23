# 开发计划：项目、工作树、diff 评论、会话分叉、内置浏览器

2026-10-23 制定。参照 T3Code（`pingdotgg/t3code`）的实现，结合 JuCode 现有代码。路径前缀：`D/` 为 JuCode-Desktop，`C/` 为 JuCode-CLI，`T/` 为 T3Code。

## 总体顺序

| 阶段 | 内容 | 依赖 | 估计工作量 |
|---|---|---|---|
| 一 | 项目设置与项目脚本 | 无 | 1 周 |
| 二 | 工作树移到后台服务，新建会话时选择环境 | 阶段一（setup 脚本） | 2 周 |
| 三 | diff 行级评论与分支审阅 | 无，可与阶段二并行 | 1.5 周 |
| 四 | 会话分叉 | 阶段二（分叉到新工作树） | 2 周 |
| 五 | 智能体操作内置浏览器 | 无 | 3 周 |

阶段一、二是后续功能的基础：分叉、多模型并行都需要"一个会话一个工作树"。阶段三、五与其他阶段互不依赖，可按人力穿插。

每个阶段都按 CLI → Desktop → PWA/安卓 的顺序发版。后台服务比 Desktop 活得久，新字段缺失时一律按"未知"处理（见 `D/AGENTS.md`）。

---

## 阶段一：项目设置与项目脚本

### 现状

- `Project`（`D/src/lib/types.ts:87`）只有名称、路径、附加目录、会话、工作树元数据、图标颜色等字段，没有项目级设置。
- 项目存在后台服务的 `~/.jucode/daemon/workspaces.json`，改动走 `workspaces_set`（带 `rev` 防覆盖，`C/crates/daemon/src/projects.rs:71`）。
- 后台服务能识别智能体启动的 dev server（`C/crates/daemon/src/devservers.rs`），但用户无法预先登记常用命令。

### 目标

1. 每个项目可设置默认后端、默认模型、默认审批模式、新会话默认环境（本地目录或新工作树）。
2. 每个项目可登记若干脚本（如 `pnpm dev`、`pnpm test`），在项目页和命令面板一键运行，输出进终端面板。
3. 脚本可标记"创建工作树后自动运行"，供阶段二使用。

### 方案

- 项目设置放在 `workspaces.json` 的项目条目里，新增 `settings` 字段；不写入仓库，避免污染用户代码。
- 仓库内可选的 `.jucode/project.json` 作为团队共享配置，只含脚本列表。读取顺序为：仓库文件 → 用户在 JuCode 中的修改。T3 的 `t3.json` 用的是同样的分层（`T/packages/contracts/src/t3ProjectFile.ts`）。
- 脚本在终端面板里运行，复用现有 PTY（`D/src-tauri/src/lib.rs` 的 terminal 部分）。不新建后台进程管理。
- 脚本字段：`id`、`name`、`command`、`cwd`（相对项目根目录）、`runOnWorktreeCreate`、`shortcut`（可选，加入 `D/src/lib/shortcuts.ts` 的快捷键表，可在快捷键面板里修改）。

### 步骤

1. CLI：`workspaces.json` schema 加 `settings`；`project_set_settings` 操作；读取 `.jucode/project.json`。
2. Desktop：项目设置页（项目页右上角入口），脚本列表编辑。
3. Desktop：项目页和命令面板的脚本按钮，运行时打开终端面板。
4. 新建会话时按项目默认值预填后端、模型、审批模式。

### 验收

- 在 A 电脑设置项目默认模型，B 电脑新建会话时自动带上（经后台服务同步）。
- 仓库有 `.jucode/project.json` 时，项目脚本列表自动出现。
- 旧后台服务不认识 `settings` 字段时，Desktop 保持当前行为，不清空设置。

---

## 阶段二：工作树

### 现状

- 工作树全部在 Desktop 端处理：
  - 创建：`TaskDialog.svelte`，执行 `git worktree add`，分支名 `task/<slug>`；
  - 打开为项目：`+page.svelte` 的 `openTaskProject`；
  - 合并与清理：`ParallelTasks.svelte`。
- git 参数经 Tauri 白名单校验（`validate_worktree_args`，只放行 add/list/remove/prune）。
- 手机和定时任务无法创建工作树，也没有 setup 脚本和自动清理。
- 每个工作树都是一个独立项目，侧栏里与主项目并列，关系不直观。

### 目标

1. 新建会话时直接选"本地目录"或"新工作树"，选工作树时可选基础分支。
2. 工作树会话归属原项目，侧栏显示为原项目下的会话，带分支标记，不再单独成项目。
3. 创建后自动运行项目里标记了 `runOnWorktreeCreate` 的脚本（如 `pnpm install`、复制 `.env`）。
4. 会话归档或删除时提示是否删除工作树；工作树有未合并提交时默认保留。
5. 手机、网页、定时任务都能创建工作树会话。

### 方案

- 工作树操作移到后台服务：新增 `worktree_create`、`worktree_remove`、`worktree_list` 操作，Desktop 的 Tauri 命令只保留给旧后台服务兼容期使用，之后删除。
- 会话元数据加 `worktree`（路径、分支、基础分支）。项目的 `worktree` 字段保留，用于读取已有数据。迁移时，把现有工作树项目下的会话挂回主项目。
- 新会话选择器（本次已改为单一"位置"选择）增加环境项：`本地` / `新工作树 · 基于 <分支>`。
- 分支名由首条消息生成（复用现有 commit 信息生成接口），用户可改。
- setup 脚本在工作树创建后、引擎启动前运行；失败时会话照常创建，在对话顶部显示脚本输出和失败原因，不阻塞。
- 清理规则参考 T3（`T/apps/server/src/storageCleanup.ts`）：只自动清理"已合并且无未提交改动"的工作树，其余只提示。

### 步骤

1. CLI：worktree 三个操作，路径约定沿用 `<仓库父目录>/.jucode-worktrees/<仓库>/<slug>`。
2. CLI：会话元数据加 `worktree`；`for_new_session` 支持在工作树里启动。
3. CLI：setup 脚本执行，输出作为会话事件下发。
4. Desktop：新会话选择器的环境项、基础分支选择；侧栏分支标记。
5. Desktop：合并/放弃面板改为调用后台服务；数据迁移。
6. PWA/安卓：新会话面板加环境项。

### 验收

- 手机上选"新工作树"发出任务，电脑上看到对应分支和会话，依赖已安装。
- 同一项目下三个工作树会话并行，互不影响文件。
- 合并后归档会话，工作树和分支被清理；未合并的保留并提示。

### 风险

- 子模块和大仓库创建工作树慢。T3 有 `worktreeSubmodules` 开关，可在阶段一的项目设置里加同类选项。
- 现有工作树项目的迁移需在测试数据上验证，迁移前备份 `workspaces.json`。

---

## 阶段三：diff 行级评论与分支审阅

### 现状

- 本轮改动：`EditedFiles.svelte` 列出文件；编辑器对比模式支持"本轮"和"HEAD"（`D/src/lib/editor/EditorPane.svelte`、`turnBase.ts`）。
- 分支审阅：`GitPanel.svelte` 有 `base...HEAD` 的文件统计和单文件 diff。
- 选区"让 AI 改"（⌘K）一次只能发一处，发出后立刻开始一轮。
- 没有行级评论，也不能把多处意见攒起来一起发。

### 目标

1. 在任一 diff（本轮、HEAD、分支对比）里选中行写评论，评论显示在行旁。
2. 评论先进入输入框上方的"待发送评论"区，可继续写多条，再连同文字一起发出。
3. 分支审阅视图：列出当前分支相对基础分支的全部改动文件，逐个看 diff 并评论。

### 方案

- 评论数据：文件路径、行范围、对比基准（turn/head/branch）、选中的 diff 片段、评论文字。只存在当前会话的草稿里，发送后清空，不做持久化。
- 发送格式：在消息正文后附加结构化文本块，每条评论一段，包含文件、行号、diff 片段和意见。各引擎都只收纯文本，不需要协议改动。T3 的旧版发送格式（`T/packages/shared/src/composerContextLegacySend.ts`）也是这样做的。
- 分支审阅复用 `GitPanel` 的 numstat 和单文件 diff，改为全屏审阅视图；基础分支取工作树会话的 `baseBranch`，普通会话取默认分支的 merge-base。
- ⌘K"让 AI 改"保留，改为"加入评论"或"立即发送"二选一。

### 步骤

1. Desktop：diff 视图行选择与评论气泡。
2. Desktop：输入框上方的待发送评论区，发送时拼接。
3. Desktop：分支审阅视图。
4. PWA：只读显示评论内容（作为普通消息文字即可，无额外工作）。

### 验收

- 在两份文件的三处 diff 上各写一条评论，一次发出，智能体能按文件和行号逐条处理。
- 切换会话再回来，未发送的评论仍在。

---

## 阶段四：会话分叉

### 现状

- 回退已支持：
  - Claude：`resume-session-at` 重新拉起（`rewindClaudeSession`）；
  - Codex：`thread/revert`；
  - 文件：由检查点恢复。
- 分叉：只有 JuCode 自己的引擎有会话树（`C/crates/agent-core/src/session.rs` 的 `fork`）。Claude 引擎在 `claude.rs` 里显式拒绝 `/fork`；Codex 未接 `thread/fork`。

### 目标

1. 在任一轮的消息上选"从这里分叉"，生成一个新会话，带着到该轮为止的对话；原会话不受影响。
2. 分叉时可选"在新工作树中继续"，两边改文件互不干扰（依赖阶段二）。
3. 分叉出的会话在侧栏显示来源；可选"把结论带回原会话"，在原会话插入一段由模型生成的分叉摘要。

### 方案

- Claude：拉起参数加 `--fork-session`，配合已有的 `--resume-session-at` 定位到指定轮；去掉对 `/fork` 的拒绝。
- Codex：调用 app-server 的 `thread/fork`。
- JuCode 引擎：复用 `Session::fork`。
- ACP：协议有 `session/fork` 时接入，否则该项在界面上置灰。
- 文件状态：分叉到当前目录时不动文件；分叉到新工作树时，用该轮的检查点（本次已改为 git 引用 `refs/jucode/checkpoints/<会话>/<轮次>`）检出工作树，保证文件与对话一致。
- 带回结论：在分叉会话里让模型生成摘要，作为一条用户消息发到原会话。T3 的 `merge_back`（`T/apps/server/src/orchestration-v2/ContextHandoffService.ts`）做法相同。

### 步骤

1. CLI：各引擎的分叉操作 `session_fork { from, turn, cwd }`，返回新会话 id。
2. CLI：会话元数据加 `forked_from`（会话 id 与轮次）。
3. Desktop：消息菜单"从这里分叉"，分叉对话框（当前目录 / 新工作树）。
4. Desktop：侧栏来源标记，"带回结论"按钮。

### 验收

- Claude 与 Codex 会话都能从第 3 轮分叉，新会话里第 4 轮之后的内容不存在，原会话完整。
- 分叉到新工作树时，工作树里的文件等于第 3 轮开始前的状态。

---

## 阶段五：智能体操作内置浏览器

### 现状

- 内置浏览器是 Tauri 子 WebviewWindow（`D/src-tauri/src/browser.rs`），支持导航、后退、刷新、元素拾取（把元素发进对话）。
- 智能体可用的应用工具只有 `present_files`、`propose_schedule` 和三个子会话工具（`C/crates/agent-core/src/user_tools.rs`）。这些工具经 Claude 的进程内 MCP、Codex 的 `dynamicTools` 暴露，由后台服务的 `host_call` 执行。
- 浏览器在 Desktop 进程里，后台服务没有通道调用它。

### 目标

智能体能自己打开页面、读取页面结构、点击、输入、截图、读取控制台报错，用来验证自己改的界面。用户在浏览器面板里实时看到操作过程，可随时接管。

### 方案

- 通道：后台服务新增"转发给 Desktop"的工具调用路由。Desktop 连接后台服务时声明 `browser` 能力；无 Desktop 在线时（如仅手机），工具返回"浏览器不可用"。
- 驱动方式：Tauri WebView 不支持 CDP，改用注入脚本：
  - 读取页面：返回可访问性树的精简文本，每个可交互元素一个编号，供后续点击、输入引用；
  - 交互：点击、输入、选择、按键、滚动，在页面内用 DOM 事件实现；
  - 截图：用 WebView 原生截图接口（macOS `WKWebView.takeSnapshot`，Windows `CapturePreview`）；
  - 控制台：注入时挂钩 `console.error` 和 `window.onerror`，缓存最近的条目。
- 工具清单（第一批）：`browser_open`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_press`、`browser_screenshot`、`browser_console`、`browser_wait_for`。T3 的 19 个工具（`T/apps/server/src/mcp/toolkits/preview/tools.ts`）中，录屏、拖拽、上传、设备尺寸放到第二批。
- 权限：浏览器工具进入现有的应用工具开关（`app_tools`），默认开启；只允许访问 localhost 和用户当前打开的域名，访问其他域名需要审批。
- dev server 识别（`devservers.rs`）结果提供给 `browser_open` 作为默认地址。

### 步骤

1. CLI：工具调用转发到 Desktop 的路由和能力声明。
2. Desktop：注入脚本（页面快照、交互、控制台缓存），Rust 侧截图命令。
3. CLI：`user_tools` 加浏览器工具组，接入 Claude MCP 与 Codex dynamicTools。
4. Desktop：浏览器面板显示智能体的当前操作（高亮被点击的元素），提供"接管"按钮暂停智能体操作。
5. 第二批工具。

### 验收

- 让智能体"改完登录页后打开验证"，它能自己打开 dev server 页面、填表单、截图，并根据控制台报错继续修改。
- 关闭 Desktop 后，同一会话调用浏览器工具得到明确的不可用提示，不卡住。

### 风险

- 注入脚本在跨域 iframe、Shadow DOM 内无法操作。第一批只保证同源页面。
- Windows 与 macOS 截图接口不同，需分别实现和测试。

---

## 待决定

1. 项目设置是否随账号云同步（当前设置同步只覆盖部分 UI 偏好）。
2. 工作树会话迁移后，现有"工作树即项目"的入口是否保留一个版本作为过渡。
3. 浏览器工具对非 localhost 域名的默认策略：每次审批，或按域名记住。
