# AGENTS.md — 协作与维护指南

> 目标：人或大模型在 5 分钟内回答三个问题——**代码在哪、怎么复现、改完怎么验**。
> 阅读顺序：本文件 → [`specs/code-map.md`](specs/code-map.md)（人工维护的模块地图）→ [`specs/code-index.generated.md`](specs/code-index.generated.md)（自动导出符号索引，`npm run code:index -- --write` 刷新）。

## 1. 项目是什么

MultiAgent Memory：Electron 45 + React 19 + Vite 的本地优先「多 Agent 记忆」桌面应用（19 个 HTML 入口）。
数据与审计全部落本机，无云依赖；未接线的能力会显式报错，绝不伪造数据。

| 层 | 目录 | 职责 |
|---|---|---|
| 记忆内核 | `src/core/memagent/` | 存储（FileStorage/PGlite）、召回、合并、遗忘、审计、MCP、webhook、sync |
| 桌面主进程 | `src/electron/` | bootstrap、静态服务、数据根、备份、IPC、悬浮窗、动作日志 |
| 本机后端 | `src/home/`、`src/agentOnboard/`、`src/auth/` | 登录/会话/账号角色/审计镜像、Agent 接入、密码哈希与锁定 |
| 渲染页面 | `src/web/` | 19 个页面（Home/Overview/Memory/Write/Audit/…/Security/Params） |
| 渲染基座 | `src/desktop/`、`src/shared/` | 宿主桥（iframe 代理）、IPC 存储适配、跨端日志格式 |
| 端壳/验收 | `src/electron/`、`e2e/` | Playwright 点击级 E2E（真构建产物 + 真后端） |

本机端口（不要硬编码，渲染层统一走 `src/web/backend.ts`）：静态页随机端口、home `8201`、agentOnboard `8200`、MCP `8202`/`8204`、webhook `8203`。

### 1.1 Agent 先查记忆库（MCP）

桌面端在 `127.0.0.1:8204/mcp` 暴露标准 MCP 服务 `multiagent_memory`（`recall_memory` / `write_memory` / `list_projects` / `get_user_preferences`）。**接入 Agent 回答本仓库实现、架构、历史决策、踩坑、偏好类问题前，优先调用 `recall_memory`（query = 用户问题关键词，project_id 可省略），并在回答末尾原样输出返回的 `display.markdown`**（🧠 Memory 提示行 + 四段明细：项目背景 / 命中记忆 / Token / 省钱与费用）。**批次29 起服务端按调用方客户端自动适配格式**（实测支持 HTML 的客户端如 Qoder 得 `<details>` 折叠版；其余客户端得纯 Markdown 四小节，零 HTML 标签），原样输出即可，不要自行改写格式或添加 HTML 标签；客户端连 Markdown 都渲染不了时改为输出 `display.line` 单行。**回退规则**：本库未命中或工具不可用时，才回退读代码/工作区笔记/客户端自带 memory 文件——Qoder 等客户端的本地 memory 不是本记忆库，不能替代首选检索；形成新结论时用 `write_memory` 落库。

- 桌面端未运行则 8204 不可达：如实说明，不编造记忆、不假装检索过。
- Qoder 等客户端可能不注入 MCP `initialize.instructions`，本文件是其触发规则的兜底（新会话生效）；是否真的检索过，以数据根 `memories.db.json` 的 `recall` 审计为准（批次15 起审计 `detail.client` 记录调用方，如 `Qoder/9.9.9`）。
- **客户端接入推广（批次15）**：同一份提示/折叠明细对所有客户端生效（服务端返回），差异只在客户端注册与触发规则。Agent 接入配置页新增「MCP 客户端接入状态」面板：真实读取 `~/.qoder-cn/settings.json`、`~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json` 等，按内容判定「已接入 / 缺令牌 / 未配置 / 冲突 / 无配置 / 需手工」；含令牌片段与一键写入仅管理员，写入前备份原文件，冲突/无法解析一律拒绝。Claude Code 另有根目录 `CLAUDE.md`（`@AGENTS.md` + 本触发规则）。

## 2. 常用命令

```bash
npm run verify:fast     # typecheck + oxlint + 索引新鲜度 + vitest 覆盖率（改完必跑）
npm run verify          # 上面 + Electron 构建 + E2E（交付前必跑）
npm run dev             # 一键开发：自动拉起本机登录后端 + Vite 127.0.0.1:5180（登录开箱可用；默认端口已有兼容后端时复用，被桌面端占用且不授信时自动换备用端口并带 ?backend= 打开）
npm run dev:backend     # 仅本机登录/mirror 服务（默认 8201，可 PORT=8211 另起），供 npm run dev 复用或单独联调
npm run package         # NSIS 安装包 → release/installer/（打包前自动刷新索引；只留最新）
npm run code:index -- --write   # 刷新 specs/code-index.generated.md（每完成一个功能必跑）
npm run code:index:check        # 只检查索引是否过期（verify:fast 已包含）
```

## 3. 改哪里（任务 → 文件）

| 我要…… | 先看 |
|---|---|
| 改某个页面的行为 | `src/web/<页面>/`；入口 `*Entry.tsx`，业务 `use*Mirror/use*.ts`，UI 组件同级 |
| 新增页面 | 根目录 `<page>.html` + `src/web/<页面>/*Entry.tsx` + `vite.config.ts` 的 `build.rollupOptions.input` |
| 新增 IPC | `src/electron/ipcChannels.ts`（常量）→ `src/electron/main.ts` §8 `handleIpc` → `src/electron/preload.ts` → `src/desktop/hostBridge.ts`（`HostMethod` + `CHANNEL_TO_NATIVE`）→ 页面调用 |
| 改记忆内核 | `src/core/memagent/`；先看同目录 `__tests__` 的契约，再改实现 |
| 改登录/账号/权限 | `src/auth/loginService.ts`（规则）→ `src/home/server.ts`（HTTP）→ `src/web/security/`、`src/web/Home/`（UI）；登录失败原因判定在 `src/web/Home/useLoginMirror.ts`（`origin_blocked` 走 `mode:'no-cors'` 探针 `/api/health`），文案在 `LoginModal.tsx` |
| 改首页 L1–L6 图谱 | `src/web/Home/layerGraph.ts`（账本→图数据，含 G3 遮罩）→ `layerGraphLayout.ts`（确定性布局）→ `LayerGraphPanel.tsx` + `layerGraph.css`（SVG 交互）；数据入口 `coreHome.ts` 的 `getHomeFeed().graph` |
| 推广/修复 MCP 客户端接入 | `src/agentOnboard/mcpClients.ts`（端点/客户端配方/`connectHint`/探测/JSON+TOML 合并，纯函数）→ `src/electron/mcpClients.ts`（真扫 + 备份写入）→ `src/electron/main.ts` §6c（管理员 IPC）→ `src/web/AgentOnboard/McpClientsPanel.tsx`（行内「一键接入」+ 面板级「⚡ 一键适配全部」+ 逐客户端「接通指引」）；Claude Code 触发规则在根目录 `CLAUDE.md` |
| 改登录自动接入本机 Agent | 三路真扫 `src/web/AgentOnboard/autoDiscovery.ts`（`hostScan:run` + `hostAgentDetect:run` + `mcp:clients`，MCP 自动写入 JSON/TOML）→ 登录/启动补扫/手动/重接流水线 `src/web/AgentOnboard/autoOnboard.ts` → 页面 `AgentOnboardPage.tsx`；登录触发在 `src/web/Home/LoginModal.tsx`，启动补扫在 `AgentOnboardPage.tsx` 挂载副作用（60s 复用窗口）；卡片指标来自 `/agents` + `/audit`（`useBackendMirror.ts` 的 `computeAgentStats` / `normalizeAgentKey` / `statsForAgent`） |
| 改数据根/备份 | `src/electron/dataRoot.ts` + `src/electron/main.ts` §2/§5/§6 + `src/web/memory/dataRoot.ts`、`backup.ts` |
| 改程序运行日志窗口（日志记录页） | `src/web/Home/ProgramLogPanel.tsx`（「人话/原文」切换 + 50 行常驻滚动窗口）+ `programLog.ts`（解析/时区/诊断复制）+ `programLogLabels.ts`（`scope:action`/IPC 通道 → 中文标题与关键字段摘要，批次24），由 `src/web/Logs/LogsPage.tsx` 顶部渲染，样式在 `Logs/extras.css`；数据经 `src/electron/actionLog.ts` 的 `tailActionLog`（上限 50 条）→ `IPC.logTail`（`ipcChannels.ts` → `main.ts` `registerLogIpc` → `preload.ts` → `desktop/hostBridge.ts` 的 `log:tail`） |
| 改列表分页 / 表头列宽固化 | 分页 `src/web/shared/paginate.ts`（每页档位 10/20/50/100，默认 10）+ `src/web/shared/PageNav.tsx`（首页/上一页/跳页/下一页/尾页）；列宽 `src/web/shared/useColWidths.tsx`（拖把手调宽 + localStorage 固化 + 恢复默认）+ 样式 `src/web/shared/tableResize.css`，日志键 `logsColWidths`、审计键 `auditColWidths`、记忆库沿用原键 |
| 清理遗留账本（批次9 前 stub 层级） | 纯函数 `src/core/memagent/legacyLayers.ts`（`scanStubLayers` 只读预览 / `demoteStubLayers` 降级回真实 L1，向量原样保留）→ `src/electron/main.ts` §6c `registerLegacyIpc`（`legacy:scan` 需会话、`legacy:demote` 需管理员 + 强制先备份）→ `preload.ts` / `desktop/hostBridge.ts` → 卡片 `src/web/security/LegacyLedgerCard.tsx`；回执落内核审计 `security_change` + `detail.op='legacy_layer_demote'` |
| 改打包产物清理 | `tools/package-builder.cjs`（先把 `release/installer` 重命名为 `installer-<UTC>-stale`，成功后删旧 `release/installer-*`、旧便携包 `release/win-unpacked` 与 `release/builder`；重命名 3 次重试，仍占用则先输出时间戳目录、构建成功后自动收口回 `release/installer`；收口优先 rename，持续 EPERM 时改为复制+删除） |
| 排查线上问题 | `<数据根>/actions.log`（先按 scope/action 或 request_id 过滤）→ `main.log` → 对应模块测试 |

## 4. 动作日志（排查第一入口）

- **位置**：数据根下 `actions.log`（设置页「数据目录」卡片与 `dataRoot:get` 返回的 `actionsLogPath` 可查）。超过 5 MiB 轮转为 `actions.log.1` / `actions.log.2`（keep=3 → 当前文件 + 2 份历史，最旧的后移删除）。
- **格式**（一行一个动作，可直接 grep）：
  `[2026-10-30T08:00:00.000Z] [info] [ipc:storage:putMemory] [req_ab12] {"mem_id":"m1","ms":3}`
- **scope**：`app`（启动/退出）、`ui`（点击/提交/页面进入/脚本错误）、`host`（宿主桥调用）、`ipc`（主进程通道）、`home`（登录后端 HTTP 与账号事件）、`onboarding`（接入服务 HTTP）、`backup`、`dataRoot`、`kernel`、`mcp`、`webhook`。
- **写入路径**：页面入口 `import '../shared/actionLog.ts'`（自动安装全局捕获）→ `uiLog()` → `hostLog()` → preload `window.api.log.write`（`ipcRenderer.send`，不阻塞）→ 主进程 `registerLogIpc` → `actionLog()`；iframe 子页经宿主桥转发。HTTP 服务通过 `onLog` 回调写入同一文件。
- **脱敏**：`src/shared/actionLog.ts` 对 key 命中 `password|secret|token|authorization|api_key|credential|cookie|session_id` 的字段整体写 `***`；字符串截断 500 字、数组 20 项、深度 4。**绝不记录输入框明文值**。
- **其它日志**：`main.log`（启动/迁移诊断）、`float.log`（悬浮窗）、`home-audit.json`（登录/角色/改密审计）、`home-mirror.json`（页面动作上抛账本）、内核审计（`audit` 表，随 `memories.db.json`）。
- **程序运行日志窗口（日志记录页，批次17 建 / 批次19 迁 / 批次24 人话化）**：日志记录页顶部常驻，一次取最近 **50** 条真实 `actions.log`（`tailActionLog` 尾读，跨 `.1..N` 轮转回退；`TAIL_MAX_LINES=50`，渲染层传更大值也被钳到 50），全部渲染在**固定高度、常驻上下滚动条**的正文区内可回看整段（用户滚上去看历史时不再被新日志拽回底部；重新滚回底部即恢复自动跟随，没有单独按钮）。默认**人话视图**：`scope:action` 与 IPC 通道翻译成中文标题 + 关键字段摘要（`src/web/Home/programLogLabels.ts`），原始 `scope:action` 同行保留可 grep；「原文」视图按原样显示。时间统一 UTC+08:00。窗口内出现 `[error]` 时提示「复制诊断信息反馈给维护者」。`log:tail` 与 `log:write` 一样**不写自身调用日志**，防止轮询观测把日志刷屏；纯浏览器如实显示不可用。
- **排查示例**：`rg "req_ab12" actions.log`；`rg "\[error\]" actions.log`；`rg "\[home:login" actions.log`。

新增日志点：主进程用 `actionLog(scope, action, detail)`（`src/electron/actionLog.ts`），渲染层用 `uiLog(scope, action, detail)`（`src/web/shared/actionLog.ts`）。日志失败绝不影响业务。

## 5. 权限模型（批次7）

- 账号角色 `admin | member`，随登录会话下发（`TenantContext.role`）。
- 内置管理员：`admin` / 初始密码 `Admin@123456`（首次启动播种，登录后请在「账号与安全」页立即修改；已有 admin 绝不被覆盖/重置）。
- **仅管理员**：修改数据根/恢复默认、备份配置与立即备份、密码策略、成员/密钥管理、账号角色与团队分配。
- **三层强制**（缺一不可）：
  1. 后端：`src/home/server.ts` 对 `/api/accounts*`、`/api/password` 校验会话角色；
  2. 主进程：`main.ts` §6 `requireAdmin` 用 `homeServerRef.getSessionContext(sid)` 校验（不信任渲染层自报）；
  3. UI：`useSessionContext()` 只读展示 + 禁用控件并提示「需管理员」（`src/web/shared/session.ts`）。
- 普通用户可用其余页面；未登录/无后端时敏感区一律只读，不伪造成功。

## 6. 数据根（用户选定，默认 `%APPDATA%/MultiAgent Memory`）

`memories.db.json`（记忆+内核审计）、`actions.log`、`main.log`、`float.log`、`collector-cursor.json`、`backup-config.json`、`mcp-token.txt`、`home-audit.json`、`home-locks.json`、`home-accounts.json`、`home-mirror.json`、`agent-onboard.json`、`backups/`、`memories-export/`。
切换数据根只复制白名单文件，不覆盖、不删源；指针固定 `%APPDATA%/MultiAgent Memory/data-root.json`。

## 7. 编码约定（评审会按此检查）

1. **诚实化**：没有真实实现就报错/标注未实现（如 `sync()` 抛 `E_NOT_IMPLEMENTED`），严禁 seed 假数据、造假回执。
2. **可定位**：新文件首行写职责；大文件用 `§` 区块（见 `src/electron/main.ts` 文件地图）；导出符号语义化。
3. **有动作就有日志**：新增交互/IPC/HTTP/后台任务必须落一条动作日志，带 scope/action/关键参数/耗时（错误带 error）。
4. **敏感信息零落盘**：密码、令牌、密钥不进日志/审计/URL；审计只记动作与目标。
5. **审计成对**：成功的写操作要能在内核账本或 home 审计中查到（`request_id` 可回查）。
6. **测试同步**：修 bug 先写失败用例；新能力至少覆盖正常/拒绝/边界三条路径；E2E 断言打到真实后端。
7. **外科手术式修改**：只改必要文件，不动无关代码；不引入无需求的抽象/兼容层。

## 8. 门禁与交付

- 合入门槛：`npm run verify` 全绿（typecheck → oxlint → 索引新鲜度 → 覆盖率阈值 → Electron 构建 → E2E）。
- **功能完成即建索引**：每完成一个功能/修复批次，先 `npm run code:index -- --write` 刷新 `specs/code-index.generated.md`，并同步 `specs/code-map.md`、`AGENTS.md` 的相关条目；索引过期视为功能未完成。`verify:fast` 内置 `code:index:check`（过期直接失败），`npm run package` 打包前自动刷新索引。
- 每次用户可感知的改动：`npm run package` 重新打包，并在 `specs/MANUAL-TEST-FIX-BATCH-<n>.md` 写手动测试报告（安装包路径/大小/SHA256、改动清单、管理员与日志验证步骤）。
- 未完成/已知限制必须写进报告与本节，不留给用户猜。

## 9. 当前已知边界

- `sync()` 未接线：显式返回 `E_NOT_IMPLEMENTED`；页面同步入口标注「未实现」。
- 浏览器纯前端模式（`npm run dev`）没有 Electron 主进程：日志仅控制台、L0 写密钥不可解锁（写入一律 `E_L0_LOCKED`）、宿主扫描不可用，页面如实提示。**批次23 起 `npm run dev` 自动拉起本机登录后端 8201**（`tools/dev.mjs`；8201 已有允许 5180 来源的后端时复用，否则另起 `dev-backend` 进程），浏览器登录开箱可用；若默认端口被不允许 5180 来源的安装版桌面端占用，**批次24 起自动改用备用端口（8211 起顺延）另起一份受信后端，并以 `?backend=` / `?agentBackend=` 直接打开页面**，不再要求先关桌面端（详见 §9 批次24）。即便如此仍不具备桌面宿主能力（MCP 客户端扫描、数据根 IPC 等不可用），需要时可单独 `npm run dev:backend`。
- **L0 是密文落盘层**：不参与检索/查重；写入需管理员在安全页解锁写密钥（只加密，不能解密）；查阅需管理密码，或被授权账号凭 `grant_id + 一次性密码`，会话 5 分钟中断即锁定并作废授权（§4.4）。旧明文 `content_orig` 需管理员在安全页迁移（迁移前自动备份）。
- 成员/API 密钥表暂无内核域模型：真实空表，不展示演示行。
- **MCP 聊天窗口提示（批次11/12/13/14/15，批次29 按客户端适配格式）**：
  - 提示由 `recall_memory` 返回；`initialize.instructions` 是建议性的（Qoder 实测未注入模型 → 工具未被调用、账本无召回审计），因此工具描述、HTTP 结果末块「展示要求」与 `AGENTS.md §1.1`/`CLAUDE.md` 重复约束「优先调用 + 回显提示」，仍不保证所有客户端照做。
  - 批次13/14 的回显物：`display.markdown`（外层 summary = 提示行，内层四段 `<details>` 可各自收起/展开，HTML 转义 + 120 字截断），不渲染 HTML 时回退 `display.line`。批次14 措辞改为「优先用本库、未命中/不可用再回退」。`token` 为字符启发式 `ceil(字符数/2)`；单价未设置时 `display.money=null`，绝不使用默认价格；旧召回审计无省量字段 → 只计调用次数并追加「旧记录」告警。
  - **批次29 按客户端分发展示格式（实测 DSH 只渲染 Markdown，`<details>` 原样露出）**：`mcpRecall.clientSupportsHtmlDetails(client)` 白名单——仅实测支持 HTML 的客户端（当前 `qoder/*`）得到 `<details>` 折叠版；**其余一律纯 Markdown 四小节**（`**标题**` + 正文，零 HTML 标签、不做 HTML 转义以免 `&lt;` 原样露出）；无 clientInfo（TCP 8202、无会话 HTTP）恒为纯 Markdown fail-safe。`recallEchoNote(htmlDetails)` 与 `MCP_INSTRUCTIONS`/工具描述同步改为格式中立措辞（「服务端已按客户端适配格式，原样输出即可，不要自行添加 HTML 标签」）。`buildRecallMarkdown` 第 4 参 `{htmlDetails}`，两变体数字完全同源。
  - 批次15 推广边界：服务端提示对所有客户端一致；能否自动写入取决于客户端配置格式——Qoder CN / Claude Code / Cursor / WorkBuddy（`~/.workbuddy/mcp.json`，批次28-D）走 JSON（可备份后合并），Codex 是 TOML（可合并），**批次27 起 Trae CN 也确认稳定配置 `%APPDATA%/Trae CN/User/mcp.json`（JSON，可合并）**；Zcode 配置存应用内部存储（表单/JSON 两种方式，无文件路径）不代写，**批次28-E 起「复制片段」输出与 WorkBuddy 同构的 mcpServers JSON（可直接粘贴进其 JSON 标签页）**，deepseek harness 随宿主 Qoder 下发（对宿主一键接入即自动接通）。接入状态按真实文件内容判定，绝不伪造「已接入」；`~/.claude.json` 曾出现「条目存在但缺 Authorization → 401」，面板显示「缺令牌」并可一键补齐。令牌只在片段/写入时一次性传给受信渲染层，绝不进日志。
- **L0→L1 质量门无旁路（批次10）**：手动编辑（`coreMemoryOps.coreUpdateContent`）与自动摘要（`forgetting.buildSummary`）都走同一 `checkL0ToL1Quality`。元对话（寒暄/身份询问/助手自述与能力清单）采用保守子句启发式：任一子句含数字、代码符号、文件扩展名或非停用英文技术词即整条放行；规则变更须同步 `qualityGate.test.ts` 正反例。
- **登录即自动接入（批次16）**：登录成功后在后台执行三路真扫并写持久化状态（跨 iframe 共享），不再等用户切页；发现新 Agent 自动建卡并写后端 `auto_bind` 审计，连通（后端 CONNECTED 或宿主真扫命中）的可写 JSON 客户端由管理员会话自动写入 MCP（先备份；冲突/无法解析拒绝；TOML/未知格式只给手工说明）。任何一路扫描失败不影响其它路，失败原因原样展示；纯浏览器无宿主能力时**明确失败**并提示点「🔍 手动检测」，绝不用内核模拟冒充本机命中。卡片成功率/平均延时来自 `/audit`（含 `auto_bind` 的 `durationMs`），熔断来自 `/agents`，租户来自 `/api/me`，首次挂载即回填；旧审计无耗时样本时延时显「—」。
- **L1 脱敏覆盖**：任意协议 URL（ftp/ssh/ldap 等）、`Authorization/Proxy-Authorization/Cookie/Set-Cookie` 头、`curl -u`、扩展 `key=value`、Bearer/JWT/常见厂商密钥前缀、18/15 位证件号、裸 IPv4(可带端口)/IPv6；版本号（`v1.2.3.4`）与订单号等业务数字不误伤，但**不是语义理解**——换行拼接后的畸形敏感串可能漏网。
- **程序运行日志（批次17 建、批次19 迁至日志记录页、批次24 人话化）**：只读 `actions.log` 最近 **50** 条（`TAIL_MAX_LINES=50`，渲染层传更大值也被钳到 50），错误提示复制诊断；无桌面壳能力时明确不可用。`tailActionLog` 单次最多读尾部 128 KiB + 50 行，跨轮转回退；日志正文已脱敏，但复制诊断仍由用户主动触发，不自动上传。
- **接入页启动补扫（批次18）**：自动接入原先只挂在表单登录成功事件上；应用重启恢复会话（`session:realpage`）或直接打开接入页时没有登录事件。现接入页挂载后若存在真实会话且 `session.loading=false`，并且近 60s 内既无成功状态也无失败快照，自动补跑同一三路扫描与接入（审计 `onboarding:scan` 的 `trigger=auto`）。`useRef` 保证单次挂载只触发一次，`inFlight` 与登录触发互斥；近 60s 内已有结果直接复用，避免登录后 iframe 加载重复扫描；无会话仍走登录门禁，绝不匿名扫描。
- **接入页指标与 MCP 面板（批次21）**：卡片成功率/平均延时只来自真实审计 `/audit`（`test`/`auto_bind` 的 `status/result/durationMs`），审计不可读时用 `/agents` 的 `lastTest`（含服务端真实耗时）兜底；两者都无样本时显「—」并注明「暂无连通样本」，不估算。页面在自动接入/测试/轮换/新增卡片/窗口聚焦后立即并延迟重拉（800/2400ms）；并发重拉只认最后一次。接入测试面板只有拿到真实 `request_id` 才显示为可点；未测试显示「尚未测试」、后端不可达显示「本次未验证 + 原因」，绝不出现「本地校验（未上后端）」这类含混回执。MCP 客户端面板只显示本机真实检出（配置文件存在或安装痕迹命中）的客户端，未安装的不占位；「刷新状态」有扫描中状态与「上次扫描 HH:mm:ss（UTC+08:00）」回显；每个状态都有「建议」处理指引。浏览器模式无宿主能力，不列客户端、不显示「已接入」。
- **卡片指标样本口径（批次22）**：成功率分母只含带结果字段（`status`/`result`）的样本——旧版 `auto_bind` 审计无结果字段，已被排除（否则会被当成失败）；`durationMs` 缺失不计入延时。统计键用 `normalizeAgentKey()`（去首尾空白 + 压缩空白 + 小写）归并宿主扫描名与后端卡片名，名字大小写/空格差异不再导致静默「—」；完全无统计时卡片显示 `[data-metric-missing]`「指标未加载…」，页面顶部有统一说明条。测试面板 `[data-test-hint]` 明示：测试=真实拨测写审计，登录自动接入已自动拨测，**不必逐张手点**，不点不影响接入与指标。
- **MCP 一键适配（批次22）**：面板级「⚡ 一键适配全部（N）」仅管理员、扫描完成后可用，对全部可写 JSON 客户端顺序执行 `mcp:clientWire`（逐行进度 + 「写入/已是最新/失败」汇总 + 自动刷新）；行内「一键接入」保留用于个别重试。仍只覆盖 JSON 客户端（Qoder CN / Claude Code / Cursor 等），Codex（TOML）与无稳定配置路径的客户端只给复制片段/手工说明；写入前备份，冲突/坏文件拒绝覆盖。MCP 行卡片改为网格等高布局（`minmax(340px,1fr)`、`min-height:172px`、按钮底部对齐）。
- **登录后端诊断（批次22）**：`GET /api/health` 提供探活；登录失败时 `mode:'no-cors'` 探针能区分「服务在线但页面来源未受信（`origin_blocked`）」与「服务未响应（`backend_unreachable`）」，文案分别给出修复指引；home/onboarding 拒绝 Origin 时写 `origin_rejected` 动作日志。开发态 `npm run dev:backend` 监听 **8201**（对齐 `HOME_BASE`），`npm run dev` 固定 `127.0.0.1:5180`+`strictPort`（不再漂移到白名单外端口）；未打包 Electron 传 `allowDevOrigins: !app.isPackaged`（安装包仍按白名单拒绝未知来源）。`/api/health` 只证明服务在听，不代表会话有效。
- **开发态一键启动（批次23，端口回退见批次24）**：`npm run dev` 改为 `node tools/dev.mjs`——先探活 `http://127.0.0.1:8201/api/health`（带 `Origin: http://127.0.0.1:5180`），已有且允许该来源则复用，未监听则自动 `spawn` `tools/dev-backend.mjs`（演示账号 `user_001 / demo1234`），再启动 Vite；Vite 退出时一并结束后端。`dev-backend` 的 EADDRINUSE 提示占用进程与 `PORT=` 用法，不再无声挂起。
- **效果证据迁首页（批次23）**：Token 节省 / 效率提升 / 跨 Agent 复用 / 模型成本四卡从 Agent 接入页移到首页**关系图谱卡片上方**（`Dashboard.tsx` 的 `#effectEvidence` 区块，`Gains id="effectGains"`），数据由 `getHomeFeed` 新增的 `effectGains`（`computeOnboardGains(audits, memories)`）真实聚合，随登录/刷新/`refreshGraph` 更新；接入页不再渲染四卡，避免同一数据两处维护。无样本仍显示「—」，未设单价不估算成本。
- **MCP 一键适配全覆盖（批次23）**：`⚡ 一键适配全部` 不再因「只有 JSON 客户端可写」而禁用——只要扫描到已安装客户端就可点击：对全部可写客户端（JSON + **TOML/Codex**）顺序备份并写入，对不可自动写入/冲突/无法解析/已接入但未接通的客户端**自动生成含令牌片段**；按钮文案回显「自动 N + 片段 K」。新增 `mergeMcpTomlConfig`（保留其它段/请求头、支持 `http_headers` 子表与内联表、冲突拒绝、幂等、保留 CRLF）；Gemini/Qwen 配方改为可写。每个客户端行新增 `接通指引`：按状态（缺令牌/缺条目/冲突/无法解析/需手工）和 `connectHint` 给出具体菜单路径、配置文件、serverKey、端点与修复步骤，而不是只显示「未连通/需配置」。浏览器模式仍不列客户端、不伪造接入。
- **打包清理（批次17/18/19）**：`npm run package` 开始先把 `release/installer` 原子重命名为 `installer-<UTC 时间戳>-stale`（不边删边失败），构建成功后再删除旧 `release/installer-*`，并同时删除旧便携包 `release/win-unpacked` 与 `release/builder` 残留（避免用户误启动旧版本）；**批次19 起打包前先强制结束本仓库 `release/` 下运行中的旧实例进程**（用户要求，避免目录被占用）；重命名带 3 次重试，仍被占用则先输出时间戳目录，**构建成功后自动重试收口回 `release/installer`**；**批次21 起收口优先 rename，若该环境 rename 持续 EPERM（宿主/索引器持有目录句柄），改用复制+删除完成收口**（实测本机 rename 对新建目录同样被拒，复制/删除正常）。构建失败会把腾空的旧目录改回 `release/installer`，且不清理旧便携包；清理失败只警告，不影响打包结果。需要便携目录时单独执行 `npm run package:win`。
- **遗留账本清理（批次24，回答「没接大模型为什么 L2–L6 有数据」）**：批次9 起「无真实大模型只落 L1」是硬规则，但**规则落地前的历史行**是当年 stub 精炼器编满 L2–L6 留下的（本机数据根实测：1642 行中 L2/L3/L4/L5/L6 各有 986 行有内容，且这 986 行都不是真实 LLM 产物；`refined_by` 分布为 987 行缺失 + 655 行 stub + **0 行 llm**），所以记忆层级管理页会看到「L2–L6 都有数据」。安全页新增「遗留账本清理」卡：管理员进入即只读预览（`legacy:scan`，统计扫描/命中/缺 L1/按原 layer 的命中分布；本机实测 `scanned=1642 hits=986 missing_l1=0 by_layer={L2:986}`），点「执行清理」二次确认后才 `legacy:demote` 把这些行降级回真实的 L1（`layer=L1`、`content=content_l1`、清空 stub 的 L2–L6 与 `layer_specs`、重算 `sha256`，**向量原样保留**——实测这批历史行的向量与 `embedSync(content_l1)` 余弦 = 1.000（与 stub L2 正文只有 0.69~0.95），说明旧向量本来就是按 L1 算的，降级后仍然有效）。判定口径是 `isStubDeepLayered`：**带任一 L2–L6 正文且 `refined_by !== 'llm'`**（缺失或 stub 都算无效产物），不做语义猜测。边界：① 真实 LLM 产物与缺 L1 的行（计入 `missing_l1` 跳过）一律不碰；② 执行前强制备份，备份失败直接拒绝改写；③ 回执（扫描/命中/已降级/跳过/样本 id）+ 备份目录 + 内核审计 `security_change`（`detail.op='legacy_layer_demote'`）可回查；④ 降级不可逆，只能从备份文件恢复；⑤ 纯浏览器无主进程 IPC，卡片如实显示不可用。
- **层级生成时间（批次24，拍板口径2）**：每条记忆只带**一个** `layers_generated_at`（本组层内容生成时刻，内核毫秒 / 页面 ISO），不逐层记时间。入库时间是 `created_at`，两者分列展示（记忆库行、层级列表、抽屉、层级详情页）；**批次24 之前的历史行没有这个字段，UI 一律显示「层级生成未记录」，绝不拿 `created_at` 冒充层级生成时间**。写入落层与合并摘要都会打戳，手动改写内容视为重新生成层级 → 时间刷新为本次操作时刻。若将来要「每层各自的时间」，需要新的内核字段与迁移，不能靠现有字段推断。
- **列表分页与列宽固化（批次24）**：日志记录页与审计日志页从「卡片流」改为**带表头的表格 + 分页**，与记忆库管理页共用 `src/web/shared/paginate.ts`（每页 10/20/50/100，**默认 10**）与 `PageNav.tsx`（首页/上一页/跳页输入/下一页/尾页 + 条数说明）；过滤命中不足一页时自动回到有效页，不再停在空页。列宽用 `useColWidths`（拖把手调宽、`MIN_COL_WIDTH=30`、localStorage 固化，键 `logsColWidths`/`auditColWidths`）——**刷新与重新登录都保持上次宽度**，每页有「恢复默认」。**限制**：宽度按列序号保存，将来加减列需重置；jsdom 无真实布局，拖宽由单测覆盖、视觉效果需手动看。
- **开发态端口回退（批次24，回答「web 端登录显示来源未被信任」）**：`npm run dev` 探活默认登录后端端口；若该端口**有服务但不信任 `http://127.0.0.1:5180`**（实测是安装版桌面端自带的登录后端返回 403 且无 `Access-Control-Allow-Origin`），不再要求用户先关桌面端，而是**自动改用备用端口（8211→8215 顺延）另起一份 `allowDevOrigins` 的登录服务**，同时置 `DEV_NO_OPEN=1` 让 Vite 用 `--open /overview.html?backend=<备用地址>&agentBackend=…` 打开受信地址；全部端口被占则如实声明「本次不起登录后端」，不静默假装可用。登录失败文案同步改为这个真实指引（不再硬编码端口，端口字面量仍受 `src/web/__tests__/backend.test.ts` 扫描约束）。**限制**：备用端口只解决登录/镜像服务，接入服务 8200 若同样被桌面端占用仍会拒绝来源；纯浏览器模式仍无宿主能力（MCP 客户端扫描、数据根 IPC 等）。
- **批次25「假展示与静默丢失」收口（P0-1/2/3/6/7）**：① 层级管理页「保存修改」真正写回内核账本（`coreUpdateContent`，含 L0→L1 质量门 + version+1 + `memory_op` 审计），被拒时显示内核原因，不再 `dispatchEvent` 空发；② 日志页「查阅审计」按 `request_id` 真查内核审计，零行显示「该 request_id 无审计行」而非「真实审计记录」；③ 写页查重卡从「五维假刻度 + 三模式按钮」收缩为**本地词面相似度单值预览**（判重由内核写路径真实执行），三模式按钮移除；④ **内核读不到不再冒充「账本为空」**：新增共享件 `src/web/shared/kernelLoad.tsx`（`useKernelLoad` 三态 loading/ok/error + `KernelLoadError` 错误卡，错误态显示内核原因 + 重试 + 落 `ui:kernel_load_error` 日志），记忆管理/写页/参数/监控/裁决/接入演示/首页七处统一接入；首页 `coreHome.storageError` 透传到 Dashboard 横幅「内核账本没读到（不是账本为空）」；⑤ FileStorage `commitBatch` 只在 persist 成功后清 `batching/dirty`，`putMemory/appendAudit` 先写盘成功再提交内存，`close()` 落 `storage:close-commit` 审计，写盘失败不再静默丢整批。
- **本机信任边界批次26-A（P0-4/P0-5）**：① Webhook 8203 收口为独立 `src/electron/webhookServer.ts`：**所有**请求（含无 Origin 的本机调用）一律校验 mcp-token（`Authorization: Bearer` / `x-mcp-token`，timingSafeEqual；拒绝日志不含令牌值），body 上限 1 MiB（413），`/ingest/status` 与 `/ingest/hash` 只回 id+状态/hash（不再外泄 l2_preview），`n` 钳 1..100；旧调用方不带令牌会得到 401（采集指南已同步）。② 接入服务 8200 写端点（configure/test/rotate-key/revoke-key/discover/DELETE）要求真实会话：`x-session-id` 经 `getSession`（主进程 = `homeServerRef.getSessionContext`）校验，**未接会话真源=全部拒绝（fail-closed）**；密钥轮换/撤销与删除卡片需管理员角色（403），拒绝写 `auth_rejected` 动作日志；GET /agents、GET /audit 保持只读开放，但 `/audit` 出站前把 Windows/Unix 本机安装路径替换为 `<本机路径>`；CORS Allow-Headers 加 `x-session-id`。UI 客户端（`AgentOnboardClient` 第三参传会话读取器，`useBackendMirror`/`autoOnboard` 接 `currentSessionId`）自动带头；E2E `e2e/app.spec.ts` 起真实 home 后端并以内置 admin 真实登录取 sessionId（不再用伪造会话串）。Origin 白名单不是鉴权：同源无会话同样 401。
- **本机信任边界批次26-B（P1-1/2/3/9/10/11 + P2-14~17）**：
  ① **P1-1 `?backend=` 回环白名单**：`src/web/backend.ts` sanitizeBase 只接受 `http://(localhost|127.0.0.1|[::1]):<显式端口>` 且无路径/查询/凭据（不限定 82xx——E2E 随机端口与 8211-8215 备用端口都要用）；白名单外回落默认值。
  ② **P1-2 数据面 IPC 门禁**：`storage:deleteMemory / storage:appendAudit / hostScan:run / hostAgentDetect:run` 四条通道在 preload 尾参自动附带 `SESSION_STORAGE_KEY` 会话 id（`src/shared/sessionKey.ts` 单一真源；隔离世界与页面共享 localStorage），主进程 `requireDataPlaneSession` 兜底校验，失败**抛错**（内核 StorageBackend 以 promise rejection 表达失败）；appendAudit 另做形状校验（action≤40 字符、request_id 仅 `[A-Za-z0-9_-]{1,64}`、ts 为有限数字）——**诚实偏差**：审计报告写「拒绝调用方自报 request_id」，但 P0-2 日志页按 request_id 真查内核审计依赖内核合法自报的关联键，故只挡非法/超长 id，不做语义猜测。putMemory/queryAudit 未加门禁（审计证据链只有删除+伪造审计写）。
  ③ **P1-3 租户主进程下发**：新增 `tenant:get` IPC（会话校验），`kernel.ts syncTenantFromHost()` 模块加载即拉取并覆盖 `mam.tenant.v1`；渲染层自报只作浏览器降级（无宿主能力时显式本地身份）。
  ④ **P1-9 变更吊销会话**：home server `revokeSessionsOfUser(userId)`——role_change / team_assign 吊销目标账号全部会话，password_change 连当前会话一并吊销（必须重新登录）。
  ⑤ **P1-10 MCP 令牌项目作用域**：`McpAccount.scope_project_ids`（默认 `['*']` 全放行），`projectInScope()` 在 recall/write_memory/list_projects 三工具统一校验（HTTP 8204 + TCP 8202 同源）；作用域外项目一律 McpToolError 拒绝。**残留风险（诚实声明）**：默认仍 `['*']`——本机账本混住多租户身份（页面写 kernelAccount、采集器与 MCP 写 u1/t1/e1），按 team/enterprise 硬过滤会打破 AGENTS §1.1 的召回承诺；要真正收紧需先做账本租户归一，且单令牌仍是机器级凭据（拿到即全库）。
  ⑥ **P1-11 L0 查阅门禁与 KDF**：`l0:unlock` 无 grant_id（管理员密码直阅）分支改 `requireAdmin`；`crypto.ts` pbkdf2Sync 改异步 `pbkdf2`（libuv 线程池），主进程解锁不再整停。
  ⑦ **P2-14 本机凭据面**：home server 登录内存滑动窗口限速（每账号 10 次/分钟，429 `rate_limited`——锁定文件可被删除复位，内存计数删不掉，同时约束 scrypt 触发频率）；admin 登录仍在用初始口令时每次登录记 `home:default_password_active` 告警（不落口令）。**残留**：默认口令 `Admin@123456` 仍随首启播种（AGENTS §5 已提示登录后立即修改）；scryptSync 保持同步（改异步要动 login() 同步签名、波及十余个测试文件，登录路径 50ms 阻塞在本机单用户服务上接受）。
  ⑧ **P2-15 令牌副本清理**：`electron/mcpClients.ts` 写入失败清 `.tmp-` 半成品；成功后按文件名时间戳保留最新 3 份 `.bak-`（含明文令牌的备份不再无限累积）。
  ⑨ **P2-16 Host 头绑定**：`shared/localOrigin.ts` 新增 `rejectUntrustedHost`——Host 必须恰为 `127.0.0.1|localhost|[::1]:<本服务实际端口>`，否则 403 `host_not_allowed`（防 DNS rebinding）；home 8201 与 onboard 8200 均已接线。无 Host（HTTP/1.0 CLI）放行，浏览器请求必带 Host。
  ⑩ **P2-17 验证码/注册**：captcha 存量上限 256（超出淘汰最早）+ 签发 30 次/分钟、注册 10 次/分钟限速（429）；登录「账号不存在」与「密码错误」返回同一响应（401 `wrong`，防用户名枚举；真实原因只在服务端日志/审计）。**残留（诚实声明）**：验证码 code 仍直出给调用方——本机无短信/邮件通道，这是设计取舍而非遗忘；注册/账号持久化仍是全文件 JSON 写（与全应用存储模式一致，P1-5 单独立项）。
- **MCP 一键适配接真（批次27-F，回答「一键适配全部只出片段没真接入」）**：① 实机排查把「没真接入」拆成两类真因——可写客户端其实已写入成功（本机 qoder-cn/claude-code/codex 令牌比对一致），而 trae-cn/workbuddy/zcode/deepseek-harness 当时全部 `writable=false` 只能出片段；② **Trae CN 升级为可自动写入**：实机确认其稳定配置 `%APPDATA%/Trae CN/User/mcp.json`（`mcpServers` JSON，含 stdio 条目 mcp-obsidian），`expandHome` 支持 `%APPDATA%/` 前缀，合并写入保留其它条目；③ **「已接入」不再只看 Bearer 格式**：扫描/写入传 `currentToken`（mcp-token.txt 当前值），配置内令牌与当前不一致（轮换/迁移后）降级 `missing_auth` 并提示「一键适配可自动补齐」，一键写入把旧令牌替换为当前值——过期配置不再假报已接入后静默 401；④ 仍不可自动写入的客户端给出精确原因（Zcode 配置存应用内部存储无文件路径、deepseek harness 的 MCP 由宿主下发），一键适配完成的汇总消息点名「仅生成片段」的客户端，不再含混。（批次28-D 起 WorkBuddy 确认 `~/.workbuddy/mcp.json` 后已升级可写，不再在此列。）
- **登录自动切受信 dev 后端（批次27-G，回答「每次都要手动重跑 npm run dev」）**：① 页面侧记住本次会话真实后端（`sessionStorage` 键 `mam.backend.session.v1`，含 backend/agentBackend），登录失败且上次有记录时先按记录自动重试，不再每次都让用户手工带 `?backend=`；② 记录缺失/失效时自动探测备用端口 8211–8215（`discoverTrustedDevBackend`，CORS 探活 `/api/health` + ACAO 精确匹配 5180 来源），发现受信 dev 后端即自动重试登录并写入记录；③ `origin_blocked` 文案改为如实说明「已自动探测 8211–8215 未发现受信后端，请启动/重跑 npm run dev」。**边界（诚实声明）**：浏览器页面无法替用户拉起进程——若 `npm run dev` 根本没跑（8211–8215 全无服务），页面只能报错指路，不能自动启动后端；`npm run dev`（批次27 P3-9 起）在备用端口启动失败（TOCTOU 竞速）会自动顺延下一端口重试，且不再硬编码拼接 `agentBackend=8200`（8200 被桌面端占用时如实说明接入页在开发态不可用）。
- **批次27 P2/P3 内核与壳层卫生（摘要）**：P2 八项（refined_by 三态 `llm/llm_partial/stub`、写页项目 ID 真源、动作日志值形态脱敏与注入归一、L1 脱敏正则补 `sk-proj-` 形态、脱敏对抗样本边界测试固化、文档计数实测校正、索引指纹门禁）；P3 十一项（`l0:seal`/`mcp:clients` IPC 会话闸门、宿主桥去重键含 method+args、Windows `file:` 信任分支修复（`fileURLToPath` + 目录边界）、日志轮转口径 `.1/.2` 对齐、打包杀旧实例先礼后兵（CloseMainWindow 3s → 强杀）、package.json `engines.node>=22`、floatattribution 入口冒烟测试）。**已知边界**：脱敏是正则/值形态兜底而非语义识别（跨行拼接畸形串可能漏网，测试固化了已知边界）；宿主桥去重 TTL 内同 id+同 args 重发仍共享首次结果（幂等保护，非缺陷）。
- **批次28 web 端连接桌面数据库（28-A 浏览器数据面接真）**：纯浏览器（`npm run dev`）下打开页面不再是空账本——① `FileStorage` 新增**建议性写锁**（`<db>.lock` O_EXCL + pid 存活探测）：桌面端运行时持写锁（唯一写者），第二个进程自动降级**只读镜像**（`StorageLockedError`，文案指向桌面端/MCP 写入；陈旧锁自动回收；`readonly` 选项永不抢锁），`reloadOnMtime` 让镜像随 mtime 变化自动重载；② home server 新增内核数据面 `POST /api/kernel/invoke`（会话门禁 + 六方法白名单 putMemory/getMemory/listMemories/deleteMemory/appendAudit/queryAudit，appendAudit 走 `validateAuditRecord` 形状校验）与 `GET /api/kernel/info`（账本可用性/只读态/路径），结果统一 `{ok,result|error}` 信封；③ 渲染层 `src/web/httpStorage.ts`（HttpStorageBackend）+ `kernel.ts` 三态选择：Electron 壳内=IPC 数据面（不变）、纯浏览器+已登录=HTTP 数据面直连真实账本、未登录=进程内空账本（登录成功 `rebuildKernelForDataPlane()` 切换）；④ `npm run dev` 的 dev-backend 自动以只读镜像挂上真实数据根的 `memories.db.json`（data-root.json 指针定位，绝不抢桌面端写锁）。**边界（诚实声明）**：浏览器 dev 模式登录后是**只读镜像**——能看真实数据，写入会得到诚实 `E_STORAGE_LOCKED` 提示（写入请用桌面端或 MCP）；桌面端未运行时 dev 后端直接挂账本（无锁竞争），写入可用；页面测试用 `setKernelStorageForTests` 注入内存账本（mock 会话不再误走 HTTP 数据面）。
- **MCP 面板审计证据升级（批次30，回答「Zcode 明明接入了却显示未接入」）**：MCP 面板原只凭**读配置文件**判定接入状态，而 Zcode 配置存应用内部存储（IndexedDB，无文件面）→ 文件扫永远 `manual`「需手工」。现 `mcp:clients` 扫描时主进程把 **recall 审计**（`detail.client`）作为接入证据传入：`applyRecallEvidence`（`src/electron/mcpClients.ts`）按 `spec.id`（或显式 `auditClientIds`，如 deepseek harness 的 `dsh-mcp-client`）匹配调用方首段，对 `manual/no_config/missing_entry/missing_auth` 四态升级为 wired，note 注明「审计检测到真实调用 N 次（最近 <时间>，UTC+08:00）——配置存应用内部无法读取文件，以审计为准」。**conflict/invalid 不升级**（文件真实存在但有错，审计不能替代修复）；UA 兜底串（`Cursor (UA)`）不匹配任何 id（调用方身份不可证）；审计读不到时退回纯文件口径。能带有效令牌成功召回 = 真接通，这是服务端账本上的事实而非推断。
- **批次28-B 三客户端自动接入再审查（28-D 修正）**：① **deepseek harness 升级为「宿主继承可写」**（`inheritsFrom: 'qoder-cn'`）：无独立 MCP 配置面、MCP 随宿主 Qoder 下发——扫描时接入状态如实取宿主结果（宿主 wired 即本客户端 wired，note 注明来源；宿主未接入提示「对宿主一键接入后自动接通」），一键接入委托 `wireMcpClient('qoder-cn')` 真实写入宿主配置后本客户端自动生效（本机实测 recall_memory 走通）；② **WorkBuddy 升级为可自动写入（28-D）**：用户实测确认稳定配置 `~/.workbuddy/mcp.json`（`mcpServers` JSON，`type+url+headers`，应用内编辑器直显该路径）→ `configPath` 直连该文件，一键写入备份+合并保留其它条目（28-B 曾按 `connectors/*/mcp.json` 推断为「应用托管不可写」，该 glob 基础设施已随实机结论移除）；③ **Zcode 保持手工（28-D 更新原因；28-E 片段升级）**：配置走应用内「表单 / JSON」两种方式、存内部存储（IndexedDB）无稳定文件路径可合并——28-E 起 `format` 改 `json`，**「复制片段」输出与 WorkBuddy 同构的 `mcpServers` JSON（可直接整段粘贴进其 JSON 标签页，保存即接通）**；`configPath` 仍 null（electron 扫描层无路径一律 manual）、`writable` 仍 false（不代写），只升级片段不改变自动写入边界。面板 gating 不变：`writable && state!=='wired'` 才出「一键接入」。
- **批次28-C 无 LLM 的 L2–L6 历史脏数据自动清理**：批次24 的手动「遗留账本清理」卡升级为**启动自动执行**（`main.ts` bootstrap 调 `autoDemoteLegacyLayers`：备份 → 降级 → 内核审计 `security_change`/`op='legacy_layer_demote'`）；判定口径扩展 `isMislabeledLayer`（layer 标了 L2–L6 但无深层正文且 `refined_by` 非 llm/llm_partial——批次28 修复 `buildSummary` 摘要行误标 L3 的入口后新产生的形态）；`coreUpdateContent` 手动改写时把 stub 行归一回真实 L1。真实 LLM 产物与缺 L1 的行一律不碰。
