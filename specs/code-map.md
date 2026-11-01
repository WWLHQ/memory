---
status: draft
---

# 代码映射（REQ → 原型 / 文件 → 测试）

> 可追溯性基石：BUG 出现时，凭 REQ / TC 或红测试即可定位程序段。真实项目编码阶段按此结构为每个 REQ 维护「文件 → 函数 → 测试命令」。
> 首版仅映射「需求 → 原型 HTML / 规格文件」，代码段待编码阶段填充。

| REQ | 需求规格文件 | 对应原型 HTML | 代码段（文件 : 导出） |
|------|--------------|---------------|----------------------|
| REQ-001 | [需求规格书.md](需求规格书.md) | - | - |
| REQ-002 | [需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) / [需求规格书_新增章节_十八_ID字段整理.md](需求规格书_新增章节_十八_ID字段整理.md) | - | - |
| REQ-003 | [需求规格书_Agent接入页字段级交互规格.md](需求规格书_Agent接入页字段级交互规格.md) | [Agent接入页_原型.html](design/ui/Agent接入页_原型.html) | 原子任务：[AGENT-ONBOARD.md](tasks/AGENT-ONBOARD.md)；**已全量跑通（T2+T9 逻辑 + T3~T8/T10 渲染 + T11 集成 + T12 E2E）**：
- 状态机 `src/agentOnboard/stateMachine.ts`(`transition`)
- 校验器 `src/agentOnboard/validators.ts`(`validateOnboard` R1–R10)
- 按端矩阵 `src/agentOnboard/formMatrix.ts`(`signalSourcesForForm`)
- UI 组件 `src/web/AgentOnboard/*.tsx`（AgentCard/OneClickOnboard/McpToolConfig/ChannelConfig/KeyMgmt/TestPanel/FormBadge/Gains）+ `theme.css`（逐条抄自原型）
- 服务层 `src/agentOnboard/service.ts`(`AgentOnboardService`：configure/testConnect/rotateKey/revokeKey/oneClickOnboard/revokeBind + 审计)
- 页面装配 `src/web/AgentOnboard/AgentOnboardPage.tsx` + `src/web/main.tsx` + `index.html`（Vite 构建，`npm run dev/build`）
- 测试 `src/**/__tests__/*.test.ts(x)`；命令 `npm run typecheck`（tsc strict）+ `npm run lint`（oxlint）+ `npm test`（vitest 117 文件 / 1248 例）+ `npm run test:e2e`（Playwright 21 个 spec / 94 例） |
| REQ-004 | [需求规格书_Agent界面内联记忆标识.md](需求规格书_Agent界面内联记忆标识.md) | [Agent界面内联标识_原型.html](design/ui/Agent界面内联标识_原型.html) | - |
| REQ-005 | [需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) | [登录与首页_原型.html](design/ui/登录与首页_原型.html) / [index.html](design/ui/index.html) | 已落地（T1–T12）：`src/auth/hash.ts`（scrypt+防时序）/ `src/auth/login.ts`（锁定）/ `src/home/server.ts`（登录/注册/captcha/镜像审计）/ `src/home/dashboard.ts`（聚合）/ `src/web/Home/*`（TenantProvider/TopBar/Dashboard/LoginModal/HomePage）/ `src/web/Home/coreHome.ts`（内核账本实时四卡、真实同步态）/ `src/web/Home/useLoginMirror.ts`（后端镜像） |
| REQ-006 | [需求规格书_其余页面字段级交互规格.md](需求规格书_其余页面字段级交互规格.md) | [冲突裁决页_原型.html](design/ui/冲突裁决页_原型.html) | - |
| REQ-007 | [需求规格书_内核API契约.md](需求规格书_内核API契约.md) | - | 原子任务：[CORE-AGENT.md](tasks/CORE-AGENT.md)。桌面主进程实际注入 **[fileStorage.ts](../../src/core/memagent/fileStorage.ts) FileStorage**（原子写 + fsync + 损坏 `.corrupt` 备份），见 `src/electron/main.ts`；`sqliteStorage.ts`（node:sqlite）保留为同接口实现但当前未注入。 |
| REQ-008 | [需求规格书_同步机制详细设计.md](需求规格书_同步机制详细设计.md) | - | 原子任务：[SYNC.md](tasks/SYNC.md)（[sync.ts](../../src/core/memagent/sync.ts) 内存 SyncHub + [pgSyncHub.ts](../../src/core/memagent/pgSyncHub.ts) PgSyncHub（pglite Postgres 中枢，§2 五表账本））。**引擎已完成并单测全绿，但未接入生产（本版本明确不提供云端同步）**：`MemAgent.sync()` 抛 `E_NOT_IMPLEMENTED` 并写 `implemented:false` 审计；首页顶栏/仪表盘显式「同步未实现（本版本不提供云端同步）」。 |
| REQ-009 | [需求规格书_大模型与净化生长页字段级交互规格.md](需求规格书_大模型与净化生长页字段级交互规格.md) | [净化生长与大模型_原型.html](design/ui/净化生长与大模型_原型.html) | - |
| REQ-010 | [需求规格书_新增章节_十七_遗忘机制与用户体验设计.md](需求规格书_新增章节_十七_遗忘机制与用户体验设计.md) | [故事线_原型.html](design/ui/故事线_原型.html) / [机制演示_原型.html](design/ui/机制演示_原型.html) | - |
| REQ-011 | [需求规格书_日志记录页字段级交互规格.md](需求规格书_日志记录页字段级交互规格.md) | [日志记录页_原型.html](design/ui/日志记录页_原型.html) / [审计日志页_原型.html](design/ui/审计日志页_原型.html) | - |
| REQ-012 | [需求规格书_检索页字段级交互规格.md](需求规格书_检索页字段级交互规格.md) | [检索页_原型.html](design/ui/检索页_原型.html) | - |

> 用法：测试红 → 查本表对应行 → 直抵原型/规格/代码段；或凭报错中的 REQ/TC 注释反查。

---

## 批次7：管理员权限 + 全链路动作日志（2026-10-30）

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 账号角色 / 内置 admin / 改密 / 团队分配 | `src/auth/loginService.ts`（`ADMIN_ACCOUNT`、`DEFAULT_ADMIN_PASSWORD`、`seedAdminAccount`、`listAccounts`、`setAccountRole`、`assignAccountTeam`、`changePassword`） | `src/auth/__tests__/admin.test.ts` |
| 管理 API + 会话角色 | `src/home/server.ts`（`/api/accounts`、`/api/accounts/update`、`/api/password`、`getSessionContext`、启动播种 `admin_seed` 审计） | `src/home/__tests__/admin.test.ts` |
| 敏感 IPC 管理员门禁 | `src/electron/main.ts` §6 `requireAdmin`（数据根变更/恢复、备份配置/选目录/立即备份）；`src/electron/ipcChannels.ts` 通道常量 | `npm run typecheck` + E2E（管理员/成员两态） |
| 渲染层会话与 UI 门禁 | `src/web/shared/session.ts`（`useSessionContext`）、`src/web/security/AccountAdminCard.tsx`、`src/web/security/accountsClient.ts`、`src/web/params/KbManagementCard.tsx`、`src/web/security/PwdPolicyCard.tsx`（`readOnly`） | `src/web/security/__tests__/SecurityPage.test.tsx` + `e2e/security.spec.ts` |
| 动作日志（格式/脱敏） | `src/shared/actionLog.ts`（`sanitizeActionDetail` / `createActionLogEntry` / `formatActionLine`） | `src/shared/__tests__/actionLog.test.ts` |
| 动作日志（主进程落盘/轮转） | `src/electron/actionLog.ts`（`initActionLog` / `actionLog` / `actionLogError` / `actionLogPath`）；`main.ts` §8 `registerLogIpc` | `src/electron/__tests__/actionLog.test.ts` |
| 动作日志（渲染层/宿主桥） | `src/web/shared/actionLog.ts`（`uiLog` + 自动捕获 click/submit/change/error/page_view；由 19 个页面入口 `import '../shared/actionLog.ts'` 安装）、`src/desktop/hostBridge.ts`（`hostLog` / `log:write`）、`src/electron/preload.ts` | `src/desktop/__tests__/hostBridge.test.ts` + E2E |
| 服务端动作日志 | `src/agentOnboard/server.ts`、`src/home/server.ts` 的 `onLog`（HTTP method/path/status/ms + 账号事件） | `src/home/__tests__/admin.test.ts`（home:http 断言） |
| 维护索引 | 根 `AGENTS.md`；`tools/code-index.mjs`（`npm run code:index -- --write`）→ `specs/code-index.generated.md`；`src/electron/main.ts` 顶部「文件地图」 | `npm run lint`（脚本本身）+ 人工核对 |


---

## 批次8：首页 L1–L6 关系图谱（2026-10-30）

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 图数据模型（账本 → 六层中心 + 记忆节点 + 成员/合并/冲突边） | `src/web/Home/layerGraph.ts`（`GRAPH_LAYERS`、`GRAPH_CATEGORIES`、`deriveLayerGraph`、`emptyLayerGraph`、`memoryLayerText`） | `src/web/Home/__tests__/layerGraph.test.ts`（15 例） |
| G3 隐私遮罩 | 同上 `privacyKind` / `masked`：cold/dormant 仅「冷记忆 · 尾号」，archived 仅「归档记忆 · 尾号」，不输出任何层原文 | 同上（冷/休眠/归档三态 + JSON 不含密文断言） |
| 确定性布局（黄金角环绕、稳定不抖动） | `src/web/Home/layerGraphLayout.ts`（`layoutLayerGraph`：六 hub 轨道 + 中央账本核 + 卫星 + spokes/edges） | `src/web/Home/__tests__/layerGraphLayout.test.ts`（7 例：确定性/边界/端点一致） |
| 交互面板（Obsidian 风格深色画布） | `src/web/Home/LayerGraphPanel.tsx` + `layerGraph.css`：六层筛选、搜索（仅匹配可见标签）、Ctrl/⌘+滚轮缩放、拖拽平移、双击复位、节点详情抽屉、刷新 | `src/web/Home/__tests__/LayerGraphPanel.test.tsx`（13 例） |
| 首页接线 | `src/web/Home/coreHome.ts`（`HomeFeedResult.graph`）、`src/web/main.tsx`（`loadFeed`/`refreshGraph`）、`HomePage.tsx`、`Dashboard.tsx`（登录后渲染，未登录不渲染） | `coreHome.test.ts` + `Dashboard.test.tsx` + `e2e/home.spec.ts` ⑦ |
| 动作日志（scope `home`） | `graph_zoom` / `graph_pan` / `graph_reset_view` / `graph_filter_layer` / `graph_node_open` / `graph_search`（只记 `query_len`+`hits`）/ `graph_search_clear` / `graph_refresh[_failed]` | 面板用例 + 手测 grep `actions.log` |

> 诚实边界：图只由真实内核 `Memory` 派生（无节点即六 hub 空态「内核账本暂无记忆 · 无演示节点」）；未接 LLM 时无 L2–L6 内容，节点只挂 L1，边仅来自真实 `merged_from/merged_into` 与 `conflict_id`；`truncated` 明确显示被裁节点数。

---

## 批次9：L0 加密授权查阅 + L1–L6 逐层生成/查重/嫁接（2026-10-30）

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 规则单一真源 | `src/core/memagent/layerRules.ts`：`LAYER_ORDER`、`LAYER_SPECS`、`DEDUP_THRESHOLDS`、`DEDUP_WEIGHTS[_NO_LLM]`、`L0_POLICY`、`MIN_MEANINGFUL_CHARS`、`sanitizeL1`、`meaningfulLength`、`checkLayerSpec` | `src/core/memagent/__tests__/qualityGate.test.ts`（脱敏/门禁/规格） |
| L0→L1 质量门 | `src/core/memagent/qualityGate.ts`（`checkL0ToL1Quality`：空/占位/无信息量/过短拦截，规则引用 layerRules） | 同上 |
| 逐层生成 → 校验 → 查重 → 嫁接停止 | `src/core/memagent/memories.ts`（`coreWrite`：L0 seal 前置、L1 本地脱敏、`makeLayerGenerator` 逐层、命中即 `graft_to/graft_layer` 并停止；目标只刷新 `grafted_from/confidence/version`） | `src/core/memagent/__tests__/refine.test.ts`、`contract.test.ts` |
| 五维查重与逐层阈值 | `src/core/memagent/dedup.ts`（`findDuplicate`、权重归一化、`DEDUP_THRESHOLDS`） | `refine.test.ts` |
| L0 密钥环与连续会话 | `src/core/memagent/l0vault.ts`（`L0Vault`：v2 信封、`admin_wrap`、一次性 grant、5min 空闲 + 60s 心跳、5 次错误 15min 锁、启动/锁屏/休眠/退出清理、全有或全无解密、幂等迁移 `sweep/onAppRestart/onSecurityLock/onExit`） | `src/core/memagent/__tests__/l0vault.test.ts` + `l0Kit.ts` |
| 加解密与包裹 | `src/core/memagent/crypto.ts`（`encryptL0WithKey/decryptL0WithKey`、`wrapSecret/unwrapSecret`、`deriveKek`、`generateDek`、`MASK`）；`types.ts`（L0 端壳端口/审计类型、graft 字段） | `l0vault.test.ts` + `qualityGate.test.ts` |
| 端壳 IPC（18 通道） | `src/electron/ipcChannels.ts`（`IPC.l0*`）→ `preload.ts`（`window.api.l0`）→ `src/desktop/hostBridge.ts`（`HostMethod`/`CHANNEL_TO_NATIVE`）→ `src/web/shared/l0Port.ts`（`HostL0Port/HostL0Admin`）→ `src/web/kernel.ts`（注入 MemAgent `l0*`） | `src/electron/__tests__/ipcChannels.test.ts`、`src/desktop/__tests__/hostBridge.test.ts` |
| 主进程编排 | `src/electron/main.ts`：`registerL0Ipc`（管理操作 `requireAdmin` + 会话归属校验）、`l0-keyring.json` 原子写、`onAppRestart`、30s `sweep`、`powerMonitor` 锁屏/休眠、退出清理、迁移前备份 `backups/l0-migrate-<ts>/` | 手测 + `npm run typecheck` |
| 管理 UI | `src/web/security/L0AdminCard.tsx`（状态/设置/轮换/写密钥/申请审批/发放/撤销/迁移）、`SecurityPage.tsx`、`coreSecurity.ts` | `src/web/security/__tests__/SecurityPage.test.tsx` |
| 查阅 UI（连续会话） | `src/web/shared/useL0Session.ts`（解锁/1s 倒计时/60s 心跳仅可见+聚焦/到期自锁/`formatRemaining`）、`src/web/logs/LogCards.tsx`（`L0AuthCard`）、`src/web/memory/MemoryLayeredPage.tsx`（`l0-bar`） | `src/web/logs/__tests__/LogsPage.test.tsx`、`logic.test.ts` |
| 嫁接可视化 | `src/web/Home/layerGraph.ts`（`GraphEdgeKind='graft'`、`stats.grafts`）、`LayerGraphPanel.tsx`（橙色点线边/图例/抽屉/底部统计）、`layerGraph.css` | `src/web/Home/__tests__/layerGraph.test.ts` |
| 审计动作登记 | `src/web/audit/types.ts`、`logic.ts`（`ACTION_LABEL`）、`FilterBar.tsx`：`graft`、`memory_op`、`l0_view`、`l0_auth_*`、`security_change` | `src/web/audit/__tests__/*` |

> 诚实边界：L0 恒密文且不参与检索/查重；未接 LLM 只生成 L1（`refined_by=stub`）；纯浏览器无主进程 → 写入 `E_L0_LOCKED`；旧明文 L0 需管理员迁移（迁移前自动备份）。

---

## 批次10：噪声规则扩展 + 脱敏补齐 + 质量门旁路收口（2026-10-30）

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 元对话噪声（寒暄/询问/自述） | `src/core/memagent/qualityGate.ts`：`metaReplyReason`（按子句分类 + `hasTechEvidence` 实质证据放行）、`GREETING_RE`/`POLITE_RE`/`META_QUESTION_RE`/`IDENTITY_RE`/`CAPABILITY_*`/`EN_*`、`checkL0ToL1Quality` 在 `NOISE_PATTERNS` 之后调用 | `src/core/memagent/__tests__/qualityGate.test.ts`（批次10 describe）、`forgetting.test.ts` |
| 脱敏补齐（裸 IP/证件号/协议/认证） | `src/core/memagent/layerRules.ts`：`sanitizeL1` 九条按序规则——任意协议 URL、`Authorization/Proxy-Authorization/Cookie/Set-Cookie` 头、`curl -u/--user`、扩展 key=value（含 `session_id`/`client_secret`/`x-api-key`）、Bearer/JWT/`sk-`/`ghp_`/`xox`/`AKIA`、18/15 位证件号、电话/邮箱、IPv4(可带端口)/IPv6、姓名启发式；`crypto.ts`：`MASK.idcard`/`MASK.ip` | `refine.test.ts`（L1 清洗脱敏 describe） |
| 旁路收口①：手动编辑 | `src/web/memory/coreMemoryOps.ts`：`coreUpdateContent` 先过 `checkL0ToL1Quality`；拒绝时审计 `memory_op`(`filtered_l0_to_l1`,`source=manual_edit`)；通过时写脱敏文本 + 重算 `sha256`/`content_l{k}`/L1 `embedding`，L0 不动 | `src/web/memory/__tests__/coreMemoryOps.test.ts`、`MemoryPage.test.tsx` |
| 旁路收口②：自动摘要 | `src/core/memagent/forgetting.ts`：`buildSummary` 校验每个成员与聚合文本，`SummaryBuildResult = {ok:true} | {ok:false,reason} | null`；`runForgettingCycle` 统计 `summaries_filtered` 并在 `gc` 审计记 `summary_filter_reasons` | `src/core/memagent/__tests__/forgetting.test.ts` |

> 诚实边界（批次10）：元对话检测采用**保守子句启发式**——任一子句含实质证据（数字/代码符号/文件扩展名/非停用英文技术词）即整条放行，因此「你好，部署前请检查 nginx 超时配置」不会被误杀；不依赖 LLM，规则改动必须同步 `qualityGate.test.ts` 的正/反例。

---

## 批次11：MCP 聊天窗口记忆提示 + 成本单价（2026-10-30）

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 项目背景摘要 + 省量账 | `src/core/memagent/recallInsight.ts`：`selectRecallBackground`（pinned→类别→updated_at，≤5 条/160 字/300t）、`corpusTokens`、`computeRecallSavings`、`estTokens`（ceil(chars/2)） | `src/core/memagent/__tests__/recallInsight.test.ts` |
| 召回结果扩展 | `src/core/memagent/agent.ts`：`consideredIds` 防命中/背景重复；`preCapTokens` 硬熔断前快照；`RecallResult` 增 `scanned_memories/background/savings`；recall 审计记 `injected_tokens/saved_tokens/budget_trimmed_tokens` | 契约测试 + `recallInsight.test.ts`（含 budget-trim、空账本） |
| 累计与金额 | `recallInsight.ts`：`rollupRecalls`（本地零点今日 + 全部；旧审计只计次数并告警）、`formatCny`、`normalizeUnitPrice`、`buildRecallHint`（单行提示） | `recallInsight.test.ts` |
| MCP 指令下发 + 工具 | `src/core/memagent/mcpSchema.ts`：`MCP_INSTRUCTIONS` + 4 工具（recall/write/list_projects/get_user_preferences）；`mcpRecall.ts`：`resolveProjectId`（显式→唯一项目自动→0/多项目报错）、`runRecallTool`、`runListProjectsTool`（排除 P_SYSTEM/墓碑/合并影子） | `mcpHttp.test.ts`、`mcp.test.ts`（含空账本/多项目/非字符串 project_id/单价/累计） |
| 两条传输接线 | `mcpHttp.ts`：`initialize.instructions`、`tools/call` 返回 `content[0]=display.line` + `structuredContent`（数组工具包 `items`）；`mcp.ts`：TCP 结果同 payload | 同上 |
| 参数页成本单价 | `src/web/params/types.ts`（`cost_cny_per_mtok: number \| null`）、`defaults.ts`、`NormalConfigCard.tsx`（`cost-price`）、`logic.ts`（`validateUnitPrice`）、`coreParams.ts`（旧快照归一 null）、`src/core/memagent/paramsSnapshot.ts`（类型扩展） | `src/web/params/__tests__/*`（设置/清空/负数拦截/旧快照） |
| 内联页省量诚实化 | `src/web/InlineAttribution/useInlineReal.ts`：`tokenSavingFromMarks(injections, mems)` 基线 = 同批记忆全文（estTokens），无对照 → saved 0（不再 ×2 虚构） | `src/web/InlineAttribution/__tests__/useInlineReal.test.ts` |

> 诚实边界（批次11）：token 为字符启发式估算（`ceil(字符数/2)`），不是真实 tokenizer；单价未设置（默认）时 `display.money=null`，提示写「金额未开」；旧召回审计无省量字段只计调用次数并追加告警；`instructions` 是**建议性**契约，第三方客户端可能忽略（`structuredContent` 仍完整）；MCP HTTP 拒绝任何带 `Origin` 请求，token 必填（≥32 字符）。

---

## 批次12：MCP 触发与回显加固（2026-10-30）

> 起因：Qoder 实测能连上 8204、工具可调用，但聊天里只读代码、不调 `recall_memory`（账本 `recall` 审计为 0），提示行无从出现 → 客户端未把 `initialize.instructions` 注入模型。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 工具描述强制触发 | `src/core/memagent/mcpSchema.ts`：「回答本项目相关问题前应先调用，不要只读代码或凭印象」+ 「调用后必须最后一行原样输出 display.line」 | `mcpHttp.test.ts`（tools/list 描述） |
| 结果末块回显约束 | `src/core/memagent/mcpHttp.ts`：`recallEchoNote(htmlDetails)` 作为 recall 结果第 4 个 content 块（批次29 起按客户端分 HTML 折叠 / 纯 Markdown 两种措辞） | `mcpHttp.test.ts`（content 长度 4、无会话不回显 `<details>` 断言） |
| 指令去歧义 | `mcpSchema.ts`：`MCP_INSTRUCTIONS` 规则 5 改为「不要展示 MCP 认证令牌」，明确提示行中的 token 数字/金额**必须保留**（原「不要展示内部 token」与回显规则冲突） | 指令包含 `display.line` 断言 |
| 客户端兜底触发 | `AGENTS.md §1.1`：接入 Agent 回答仓库问题前先调 `recall_memory`、最后一行回显；工具不可用如实说明；以 `recall` 审计核验是否真的检索 | 人工（Qoder 新会话） |

> 诚实边界（批次12）：三处重复约束只提高**概率**，MCP 无法强制客户端调用或强制模型回显；核验一律看数据根 `memories.db.json` 的 `recall` 审计（`request_id`/`query`/`hits`），不信模型自称。

---

## 批次13：提示可折叠明细（2026-10-30）

> 起因：用户确认 Qoder 已能召回并展示提示行后，要求「项目内容 / 记忆 / token / 省钱」四段可收起-展开，便于查阅。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 四段折叠明细 | `src/core/memagent/recallInsight.ts` 的 `buildRecallMarkdown`：HTML 版外层 `<details>`（summary = 提示行）+ 内层四段；**批次29 纯 Markdown 版**（`htmlDetails:false`，`**小节标题**` + 正文，零 HTML 标签、不转义）给只渲染 Markdown 的客户端（如 DSH 实测） | `recallInsight.test.ts`（5 对 `<details>`、转义、纯 Markdown 无标签断言、转义差异对照） |
| 数据同源 | `mcpRecall.ts`：`display.markdown` 与 `display.line` 由同一次 recall + 同一份 `recall` 审计累计生成；批次29 `clientSupportsHtmlDetails(client)` 白名单（仅 `qoder/*` → HTML 版，其余 fail-safe 纯 Markdown）；**批次32 起非 HTML 客户端默认只给一行摘要**（见批次32 段） | `mcpHttp.test.ts`（无会话紧凑档 / Qoder 会话 `<details>`）、`recallInsight.test.ts`（白名单 + 档位矩阵用例） |
| 传输下发 | `mcpHttp.ts`：`tools/call` 内容块 = `[display.line, 完整 JSON, display.markdown, recallEchoNote(mode)]`；批次32 起 `mode` 从**本次 payload 自己的 `display.mode`** 取（单一真源），TCP 8202 无 clientInfo → fail-safe 紧凑档 | `mcpHttp.test.ts`（长度 4、末块文案与档位一致）、`mcp.test.ts` |
| 回显策略 | `mcpSchema.ts`：`MCP_INSTRUCTIONS` 规则 2 与 `recall_memory` 描述改为格式中立——「服务端已按客户端适配格式（HTML 折叠或纯 Markdown），原样输出即可，不要自行添加 HTML 标签」 | 指令含 `display.markdown`/`display.line` 断言 |

> 诚实边界（批次13）：折叠依赖客户端渲染 HTML `<details>`（Qoder 基于 VS Code，预期支持；未渲染时模型按指令回退单行）。明细里的记忆内容为截断摘要（≤120 字/条），完整内容仍以 `structuredContent.hits` 为准。

---

## 批次14：触发措辞改为「优先」，保留回退（2026-10-30）

> 起因：Qoder 一轮提问（本地 23:31）有工具清单但只做了 7 次 Read/Grep——读的是 Qoder 自带 `~/.qoder-cn/projects/.../memory/*.md` 与仓库代码，账本无 `recall` 审计。用户要求不硬禁用本地检索，改为「优先使用我们的」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 指令改优先级 | `src/core/memagent/mcpSchema.ts`：`MCP_INSTRUCTIONS` 规则 1「优先调用 recall_memory；本库未命中或工具不可用时再回退读代码/工作区笔记/客户端自带 memory」 | `mcpHttp.test.ts`/`mcp.test.ts`（指令含 `优先调用`、`回退`） |
| 工具描述改优先级 | 同上：`recall_memory` 描述「优先使用本工具…未命中或工具不可用时再回退读代码或客户端本地笔记（本地 memory 文件不是本记忆库）」 | `mcpHttp.test.ts`（tools/list 描述含 `优先使用本工具`、`回退`） |
| 客户端兜底同步 | `AGENTS.md §1.1`：优先调用 + 回退规则 + Qoder 本地 memory 不是本库 | 人工（Qoder 新会话） |

> 诚实边界（批次14）：优先级仍是建议性约束；模型偶发忽略时以 `recall` 审计判定（无审计 = 未调用），可按提示词显式点名工具。

---

## 批次15：MCP 客户端接入推广（2026-10-30）

> 起因：Qoder 实机已能回显「提示行 + 四段折叠」（批次13/14），用户要求把同一经验推广到其它已连接 Agent。结论：提示由服务端统一返回，客户端只差「注册端点 + 加载触发规则」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 客户端配方单一真源 | `src/agentOnboard/mcpClients.ts`：端点 `127.0.0.1:8204/mcp`；10 家客户端的 serverKey/格式/条目风格/配置路径/触发规则/可写性；未知格式 `configPath=null` | `src/agentOnboard/__tests__/mcpClients.test.ts` |
| 真实状态探测 | 同上 `probeJsonConfig`/`probeTomlConfig`/`probeClientConfig`：`wired/missing_auth/missing_entry/conflict/invalid/no_config/manual`；TOML 支持 `[mcp_servers.<key>.http_headers]` 子表 | 同上（正常/冲突/坏文件/大小写头/子表） |
| 安全写入 | `mergeMcpJsonConfig`：保留其它服务器/字段/请求头，只补本条目；`conflict`/`invalid` 抛错；未变化 `changed=false`。`src/electron/mcpClients.ts` `wireMcpClient`：备份 `.bak-<ISO>` + tmp + rename；`scanMcpClients` 只读扫描不返回令牌 | `src/electron/__tests__/mcpClients.test.ts`（临时 home 真读真写） |
| IPC + 权限 | `src/electron/main.ts §6c`：`mcp:clients` 只读；`mcp:clientSnippet`/`mcp:clientWire` 走 `requireAdmin`；`mcp:client-wire` 动作日志不含令牌 | `ipcChannels.test.ts`（自检覆盖）+ E2E 启动 |
| 宿主桥 | `src/electron/preload.ts` 暴露 `api.mcpClients.{list,snippet,wire}`；`src/desktop/hostBridge.ts` 加 `mcp:clients/clientSnippet/clientWire` | 面板测试（native 直调） |
| UI | `src/web/AgentOnboard/McpClientsPanel.tsx`：真实状态徽标、复制片段、一键接入/补齐、刷新、管理员门禁、浏览器降级说明；复用原型类名，不新增 CSS | `src/web/AgentOnboard/__tests__/McpClientsPanel.test.tsx` |
| 调用方归因 | `RecallReq.client` + `agent.ts` 审计 `detail.client`；`mcpHttp.ts` 用 `initialize.clientInfo`（优先）/`User-Agent` 识别，`Mcp-Session-Id` 关联 | `mcpHttp.test.ts`（`Qoder/9.9.9`、`Cursor (UA)`） |
| 客户端触发规则 | 根目录 `CLAUDE.md`（`@AGENTS.md` + 优先调用/回显）；`AGENTS.md §1.1/§9` 同步 | 人工（Claude Code 新会话） |
| 审计证据升级（批次30） | `src/electron/mcpClients.ts` `applyRecallEvidence` + `scanMcpClients({recallEvidence})`：recall 审计 `detail.client` 按 `spec.id`/`auditClientIds` 匹配，manual/no_config/missing_entry/missing_auth → wired（note 注明「以审计为准」）；conflict/invalid 不升级；`main.ts §6c` 扫描时真查 `storage.queryAudit({action:'recall'})`（失败退回纯文件口径）；`McpClientSpec.auditClientIds`（deepseek-harness → `dsh-mcp-client`） | `src/electron/__tests__/mcpClients.test.ts`（批次30 五例：升级/不匹配不升级/conflict 保持/DSH 命中/空证据无影响） |
| LLM 精炼网关（批次31 建 → 批次32 多引擎 → 批次34 拨测与启用解耦，详见对应批次段） | `src/electron/llmGateway.ts`：批次31 建「主进程网关 + `llm:refine` 代理 + 层级提示词 + 密钥 0600」，批次32 把「双引擎分层互备」换成「N 引擎按最近拨测延时排队、逐个回退」 | `src/electron/__tests__/llmGateway.test.ts`（批次32 重写为 25 例）+ 实机 Ollama 验证（见批次32 手测报告） |

> 诚实边界（批次15，28-D 更新）：自动写入只覆盖结构稳定的 JSON 客户端（含 Trae CN、WorkBuddy `~/.workbuddy/mcp.json`）与 Codex（TOML）；Zcode（应用内表单/JSON，无文件路径）与 deepseek harness（随宿主 Qoder 下发）给手工说明/宿主委托；28-E 起 Zcode「复制片段」输出与 WorkBuddy 同构的 mcpServers JSON（可直接粘贴）。状态扫描按文件内容判定，不保证客户端进程已重载配置（需重启客户端）。提示能否被普通成员复制（含令牌）由管理员门禁控制；令牌绝不进日志。

---

## 批次16：登录即自动接入本机 Agent（2026-10-31）

> 起因：用户确认「登录后要第一时间扫描 Agent 并接入本机；异常时可点手动检测；接入成功自动加卡并写入 MCP；卡片要显示成功率/熔断/平均延时/租户」。批次16 把自动接入做成真实链路，移除内核模拟兜底。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 三路真扫合并 | `src/web/AgentOnboard/autoDiscovery.ts`：`hostScan:run`（进程/配置/MCP 注册表）+ `hostAgentDetect:run`（CLI/安装目录/开始菜单/配置/注册表卸载项）+ `mcp:clients`（客户端配置文件真读）；`Promise.allSettled` 允许单路失败，错误原文带出；同名 Agent 去重并保留两路证据 | `src/web/AgentOnboard/__tests__/autoDiscovery.test.ts` |
| 登录即接入流水线 | `src/web/AgentOnboard/autoOnboard.ts`：`runAutoOnboardOnLogin`（登录触发）/`runAutoOnboard`（手动检测/撤销重接）；自动建卡 → 后端 `/discover`（`auto_bind` 审计）→ MCP 自动写入 → 写 `agentOnboardState`（含 `discovered/installed/mcp/backendOk/seq`）；失败写 `agentOnboardFailure` 快照；同刻只跑一轮 | 页面测试（宿主 mock）+ 单测 |
| MCP 自动写入 | `autoDiscovery.ts` `autoWireMcpForAgents`：仅后端 CONNECTED（后端拨测未成功时以宿主命中为准）且 `writable && format=json`；管理员会话经 `mcp:clientWire`（主进程 `requireAdmin` 二次校验）；已 wired 计「已写入」，冲突/无法解析/无会话/非管理员如实记失败，TOML/未知格式记「需手工」 | `autoDiscovery.test.ts`（管理员/成员/无会话/冲突/TOML/去重） |
| 登录触发 | `src/web/Home/LoginModal.tsx`：登录成功传 `{role, sid, form}` 后台执行；结果写 localStorage，接入页经 `storage` 事件即时恢复 | `LoginModal.test.tsx` + 页面 storage 恢复测试 |
| 接入页接线 | `src/web/AgentOnboard/AgentOnboardPage.tsx`：自动接入徽章/撤销重接、失败提示 `data-testid="onboard-failure"` 指向「🔍 手动检测」、已安装列表、MCP 摘要 `data-testid="mcp-wire-summary"`、自动新增卡片、跨 iframe storage 同步 | `AgentOnboardPage.test.tsx` |
| 卡片真实指标 | `useBackendMirror.ts` `computeAgentStats`：`test` + `auto_bind` 计成功率；审计 `durationMs` 聚合 `avgRtt/lastRtt`；`refresh()` 在自动接入/测试/轮换后重拉 `/agents` + `/audit`；`AgentCard` 显示成功率/熔断/平均延时/租户（租户来自 `useSessionContext` 的 `/api/me`） | `coreReal.test.ts` + `AgentOnboardPage.test.tsx`（50% / OPEN / 200ms / ent/team） |

> 诚实边界（批次16）：纯浏览器/无宿主桥时自动接入**明确失败**（提示用桌面应用或手动检测），绝不使用内核模拟或伪造发现行；后端不可达时卡片指标显「—」，不估算；自动写 MCP 只覆盖已连通且结构稳定的 JSON 客户端，写入前备份，冲突/坏文件拒绝覆盖；`deepseek harness` 等无稳定配置路径的客户端只给手工说明。

---

## 批次17：打包清理 + 首页程序运行日志窗口（2026-10-31）

> 起因：用户要求「每次打包把上次的打包删除，别越攒越多占硬盘；找个页面加程序输出日志窗口，显示 3–5 行，有问题提示用户反馈」。日志窗口放首页（未登录也可见），数据来自真实 `actions.log` 尾读，不伪造行。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 打包清理旧产物 | `tools/package-builder.cjs`：构建前先把 `release/installer` 原子重命名为 `installer-<UTC 时间戳>-stale`（被占用则改用 `installer-<UTC 时间戳>` 输出，不动原目录）；**成功退出后**清理 `release/installer-*` 旧目录，保留本次产物（批次18 起同时清理旧便携包 `release/win-unpacked` 与 `release/builder`）；失败时把腾空的旧目录改回 `release/installer`；删除失败只告警不掩盖构建结果 | 人工（打包后 `release/` 只剩一份产物） |
| 日志尾读（主进程） | `src/electron/actionLog.ts` `tailActionLog(limit)`：默认 5、上限 50（`TAIL_MAX_LINES=50`，渲染层传更大值也被钳到 50）；从文件尾读 ≤128 KiB 块，按行切分；当前文件不足时回溯 `actions.log.1..N`；未初始化返回 `ok:false` 与原因 | `src/electron/__tests__/actionLog.test.ts`（未初始化/空文件/顺序/轮转/限幅） |
| 静默 IPC + 宿主桥 | `src/electron/ipcChannels.ts` `logTail='log:tail'`；`preload.ts` `api.log.tail`；`main.ts` `QUIET_IPC_CHANNELS`（尾读轮询不写一条 IPC 动作日志，避免刷盘挤掉真实错误）；`src/desktop/hostBridge.ts` `HostMethod='log:tail'` + `QUIET_METHODS` | `ipcChannels.test.ts` + `hostBridge` 相关测试 |
| 纯函数 | `src/web/Home/programLog.ts`：`parseProgramLogLine`（ISO/level/scope:action/rid/JSON）、`formatLogClock`（固定 UTC+08:00）、`countErrors`、`buildDiagnostics`、`copyText`（Clipboard API → execCommand 回退） | `src/web/Home/__tests__/programLog.test.ts` |
| 程序日志面板 | `src/web/Home/ProgramLogPanel.tsx`：固定高度常驻滚动窗口 + 「人话/原文」切换 + 刷新 + `⚠ N 条错误 + 📋 复制诊断信息` + 日志路径；无宿主桥时显示「非桌面壳环境」，绝不造行；批次17 在 `HomePage.tsx` 登录前后渲染，**批次19 起改由 `src/web/Logs/LogsPage.tsx` 顶部渲染**，样式从 `Home/theme.css` 迁至 `Logs/extras.css`；**批次24 起一次取最近 50 条真实 `actions.log`（`TAIL_MAX_LINES=50`）、默认人话视图**（`scope:action`/IPC 通道 → 中文标题与关键字段摘要，`programLogLabels.ts`），时间统一 UTC+08:00 | `src/web/Home/__tests__/ProgramLogPanel.test.tsx` + `HomePage.test.tsx`（首页不再渲染）+ `LogsPage.test.tsx` + `e2e/home.spec.ts` + `e2e/logs.spec.ts` |
| 规格/协作文档 | `specs/需求规格书.md §19.13`；`AGENTS.md §2/§3/§4/§9` | — |

> 诚实边界（批次17）：面板只展示真实 `actions.log`（含已轮转分片）；浏览器/无宿主桥时显式「不可用」，不 mock。尾读本身不写动作日志（`log:tail` 静默），刷新/复制仍记 `ui:*`。批次17 的清理范围仅 `release/installer-*`；**批次18 起成功打包同时删除旧便携包 `release/win-unpacked` 与 `release/builder` 残留**（见下节）。若安装包目录被运行中程序占用则重命名失败、保留原目录并改用时间戳输出，清理失败只告警。

---

## 批次18：接入页启动自动补扫 + 只保留最新程序（2026-10-31）

> 起因：用户反馈「agent 接入配置页启动后不会自动扫描并接入」与「只保留最新程序，容易引起误导」。前者因自动接入只挂在**表单登录成功**事件上，应用重启恢复会话或直接打开接入页时没有登录事件；后者因 `release/win-unpacked`（旧便携包）与 `release/builder` 残留长期留存，用户误启动旧版后看不到首页 L1–L6 图谱/程序日志。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 接入页启动补扫 | `src/web/AgentOnboard/AgentOnboardPage.tsx`：挂载后若 `session.sid` 存在且 `session.loading=false`，且本次登录会话还没扫过，自动执行 `runPipeline('auto')`；`useRef` 保证单次；`inFlight` 与登录触发互斥。**批次33-A 去重口径**：`autoOnboard.ts` 的 `ONBOARD_AUTOSCAN_KEY='agentOnboardAutoScanSid'` + `hasAutoScannedSession/markAutoScannedSession/clearAutoScannedSession`（`sessionStorage`，无则退回 `localStorage`）；`runAutoOnboard` 对 `trigger=login/auto` **起扫即标记**（失败也标），`resetAutoOnboardState()` 三清；「手动检测 / 撤销重接」不受标记约束 | `AgentOnboardPage.test.tsx`（补扫成功 / 已扫过不重扫 / 换 sid 仍扫且起扫即记账 / 无会话门禁）+ `__tests__/autoScanSession.test.ts`（标记落 sessionStorage、按 sid 判定、清除、reset 三清） |
| 触发来源 | `src/web/AgentOnboard/autoOnboard.ts`：`trigger` 增加 `'auto'`，审计 `onboarding:scan` 的 `trigger=auto` 区分登录/手动/重接 | 同页测试 + `autoOnboard` 单测 |
| 只保留最新程序 | `tools/package-builder.cjs`：成功打包后除 `release/installer-*` 外，同时删除旧便携包 `release/win-unpacked` 与 `release/builder` 残留；删除失败只告警，不影响本次产物 | 人工（打包后 `release/` 只剩 `installer/`） |
| 规格/协作文档 | `specs/需求规格书.md §19.14`、`§19.9`、`§19.13`；`AGENTS.md §9` | — |

> 诚实边界（批次18，批次33-A 更新）：补扫只在本机有真实会话时执行（`session:realpage`），无会话仍走登录门禁，绝不匿名扫描；「本次登录已扫」标记落在 sessionStorage，因此同一窗口切页不再重扫，**关掉窗口/重启后标记消失 → 恢复会话仍补扫一轮**；标记为「起扫即记」，本轮失败也只给一次原因，重扫请点「🔍 手动检测」。纯浏览器/无宿主桥仍如实失败并提示「🔍 手动检测」。清理只发生在**打包成功后**，构建失败保留可回退产物；运行中的旧实例目录若被占用，删除失败只告警。

---

## 批次19：接入卡片统一格式 + 程序运行日志迁至日志记录页（2026-10-31）

> 起因：用户反馈扫描卡片的状态/撤销按钮在卡片底部、与 badge/名称不在同一行，要求所有接入卡片统一格式；同时要求把首页的程序运行日志卡片移到日志记录页。另按用户要求：打包前强制关闭已打开的旧实例，保证只留最新程序。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 发现/已安装卡片统一格式 | `src/web/AgentOnboard/OneClickOnboard.tsx`：`.found.found-card` 两行结构 —— `.found-head`（badge + 名称 + 右侧 `.found-actions`：状态 pill / 撤销 / 新增接入卡片）与 `.found-meta`（信号 / 来源 / 版本）；`theme.css` 新增 `.found-card/.found-head/.found-actions/.found-meta`（仅作用域内，MCP 客户端行 `#mcp-client-rows .found` 保持原单行） | `components.test.tsx`（首行含 badge/名称/状态、撤销按钮在首行、已安装卡片同构） |
| 程序运行日志迁移 | `src/web/Home/HomePage.tsx` 移除 `ProgramLogPanel`；`src/web/Logs/LogsPage.tsx` 在标题下方渲染；`.program-log*` 样式从 `Home/theme.css` 迁到 `Logs/extras.css` | `HomePage.test.tsx`（首页无 `#programLog`）+ `LogsPage.test.tsx` + `ProgramLogPanel.test.tsx` + `e2e/home.spec.ts` + `e2e/logs.spec.ts` |
| 打包前强制关闭旧实例 | `tools/package-builder.cjs` `killReleaseProcesses()`：匹配 `ExecutablePath` 位于本仓库 `release/` 下的进程并 `Stop-Process -Force`，失败只告警；旧目录重命名 3 次重试，仍占用则先输出时间戳目录，**构建成功后自动收口回 `release/installer`** | 人工（打包后 `release/` 只剩本次 `installer`） |
| 规格/协作文档 | `specs/需求规格书.md §19.13/§19.15`；`AGENTS.md §3/§4/§9` | — |

> 诚实边界（批次19）：卡片只调整布局，数据与交互（`onUnbind` / `onAddCardForInstalled`）不变；日志面板逻辑不动，仅更换渲染页面与 CSS 归属；纯浏览器仍如实显示「非桌面壳环境」。强制关闭只针对本仓库 `release/` 内的进程，不碰系统安装版与其它应用；瞬时 EPERM 若在构建后仍存在，才保留时间戳目录并告警。

---

## 批次20：可读可维护性收口 + 索引门禁（2026-10-31）

> 起因：用户要求「程序的可读可维护性做优化；程序每做完一个功能都要建索引」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 接入卡片单一外壳 | `src/web/AgentOnboard/OneClickOnboard.tsx` 提取内部 `FoundCard`：首行 badge + 名称 + 右侧操作、次行元信息；发现卡片与已安装卡片共用，避免格式漂移；DOM 类名与 `data-*` 不变 | `components.test.tsx`（既有两行结构与同构断言） |
| 索引新鲜度门禁 | `tools/code-index.mjs` 新增 `--check`（索引与源码不一致退出码 1）；`package.json` 新增 `code:index:check`，`verify:fast` 内置检查；`prepackage` / `prepackage:win` 打包前自动 `--write` | `npm run code:index:check`；`npm run verify:fast` |
| 规格/协作文档 | `AGENTS.md §2/§8`「功能完成即建索引」；`specs/需求规格书.md §19.15`；`specs/MANUAL-TEST.md §3.8/§7` | — |

> 诚实边界（批次20）：本批次只收敛结构并增加索引门禁，不改任何可见行为与数据路径；索引检查失败只表示文档过期，需运行 `npm run code:index -- --write`，不代表业务失败。

---

## 批次21：接入指标可解释 + 测试回执诚实化 + MCP 面板收敛（2026-10-31）

> 起因：用户反馈「接入卡片要输出连通成功率/平均延时」「测试显示『本地校验（未上后端）』是什么意思」「MCP 刷新状态无效果、各状态怎么处理、复制片段与一键接入怎么用、未扫描到的 Cursor/Gemini CLI 不要显示」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 指标稳定输出 | `src/agentOnboard/service.ts`：真实拨测 `card.lastTest` 与 `test` 审计带 `durationMs`；`auto_bind` 已带 `durationMs`。`useBackendMirror.ts` `computeAgentStats(entries, cards)`：审计不可读时用 `/agents` 卡片 `lastTest`（含真实耗时）兜底，全部后端卡片建条目（0 样本可区分）；并发重拉用 `loadSeq` 只认最后一次。`AgentOnboardPage.tsx` `refreshStats()` 在自动接入/测试/轮换/新增卡片/窗口聚焦后立即并延迟重拉（800/2400ms），覆盖审计落盘竞态 | `coreReal.test.ts`（兜底/0 样本/不重复计数）+ 页面测试 |
| 指标来源可解释 | `AgentCard.tsx`：成功率 `title` 给出「N 次尝试 / M 次通过」；新增 `[data-metric-src]` 说明「指标来源：接入审计 …」或「暂无连通样本：接入后自动拨测或点测试」；`theme.css` `.metric-src` | `AgentCard.test.tsx`（既有）+ 页面渲染 |
| 测试回执诚实化 | `TestPanel.tsx`：未测试 → `尚未测试 · 点「▶ 测试接入」`；后端不可达 → `后端不可达 · 本次未验证`；失败/无回执 → `未生成审计回执 · 本次未验证` 并展示真实原因；只有真实 `request_id` 才可点开审计。`AgentOnboardPage.tsx` 证据补 `ok/reason` | `components.test.tsx` + `AgentOnboardPage.test.tsx` |
| MCP 刷新反馈 | `McpClientsPanel.tsx`：扫描中按钮显示「扫描中…」并禁用；扫描成功回显「已重新扫描：检出 N 个已安装客户端 · HH:mm:ss（UTC+08:00）」；顶部增加「上次扫描」时间 pill；扫描失败如实报错 | `McpClientsPanel.test.tsx` |
| 只显示已安装客户端 | 同上：`rows = scan.clients.filter(r => r.installed)`；扫描成功但为空 → 诚实空态；浏览器模式不列任何客户端（无法扫描），不再用配置清单占位 | 同上（含 Cursor 未安装不显示） |
| 状态处理与操作说明 | 同上：每个状态给出「建议：…」处理指引（已接入/缺令牌/未配置/冲突/无法解析/无配置/需手工）；面板明示「复制片段=含令牌片段手工粘贴」「一键接入=管理员备份后合并写入，仅 JSON」；JSON 客户端才显示一键写入 | 同上（状态标签/按钮禁用保持不变） |
| 打包收口兜底 | `tools/package-builder.cjs`：新增 `moveDir()`，rename 3 次重试仍失败则退化为复制+删除（本机宿主句柄使目录 rename 恒 EPERM，实测复制/删除正常）；用于构建成功收口与失败恢复两条路径 | 人工（打包后 `release/` 只剩 `installer/`）；批次21 实测走复制分支成功 |

> 诚实边界（批次21）：指标仍只来自真实审计 `/audit` 或 `/agents.lastTest`，无样本一律「—」并解释原因，不做估算；延迟为服务端真实拨测耗时（`Date.now` 差值），不含客户端排队。测试未拿到后端回执时不显示可点击的 request_id。MCP 面板只扫描已知客户端配方（10 家），未安装的不显示也不代表不存在其它客户端；浏览器模式无法扫描，如实说明。打包收口若复制也失败（如磁盘不足），产物仍留在时间戳目录并告警，不会静默丢包。

---

## 批次22：卡片指标样本纠偏 + 测试说明 + MCP 一键适配 + 登录后端诊断（2026-10-31）

> 起因：用户反馈「DeepSeek harness / Claude Code / Codex 连通成功率一直出不来」「测试接入要不要逐个手点、不点有没有影响」「MCP 客户端能否一键适配、卡片大小统一」「Web 端登录提示登录后端未启动（localhost:8201）」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 指标样本纠偏 | `useBackendMirror.ts`：旧版 `auto_bind` 审计没有 `status/result`，过去被当作失败尝试拉低成功率——现只有带结果字段的样本才计入 `tests/passed`；`durationMs` 缺失时不计入延时均值。新增 `normalizeAgentKey()`（去首尾空白、压缩连续空白、小写）与 `statsForAgent()`，把宿主扫描名（`deepseek harness`）与后端卡片名（`DeepSeek harness`/`deepseek-harness`）归并到同一统计键，避免名字大小写/空格差异导致静默「—」 | `coreReal.test.ts`（旧样本排除 / lastTest 补样本 / 名字归一合并 / 延时补齐） |
| 指标兜底 | 同一函数：后端卡片 `lastTest`（含服务端真实耗时）在审计缺样本时补齐一次「测试/通过/延时」；`AgentOnboardPage.tsx` 的 `failureReasons`、`stats` 查找统一走 `normalizeAgentKey` | 同上 + `AgentOnboardPage.test.tsx` |
| 指标未加载说明 | `AgentCard.tsx`：完全拿不到统计时不再只显示「—」，改为 `[data-metric-missing]`「指标未加载：本机接入后端未返回该 Agent 的审计样本…」；0 样本文案改为「登录自动接入会自动拨测一次；也可点『▶ 测试接入』立即生成」。页面顶部新增 `data-testid="card-metric-note"` 说明 | `AgentCard.test.tsx` + 页面渲染 |
| 测试用途说明 | `TestPanel.tsx` 新增 `[data-test-hint]`：测试=真实拨测并写审计（生成 request_id 与耗时）；登录自动接入已自动拨测，不必逐张手点；手动测试用于复查/排障，不点不影响接入与指标 | `components.test.tsx` |
| MCP 一键适配 | `McpClientsPanel.tsx`：面板级 `⚡ 一键适配全部（N）`（仅管理员、扫描完成后可用）对全部可写 JSON 客户端顺序 `mcp:clientWire`，逐个进度提示，结束汇总「写入 N / 已是最新 M / 失败 …」并自动刷新；单行「一键接入」保留用于个别重试 | `McpClientsPanel.test.tsx`（批量写入 + 已是最新计数） |
| MCP 卡片统一尺寸 | `theme.css`：`#mcp-client-rows` 改为 `repeat(auto-fill,minmax(340px,1fr))` 网格，行卡片 `min-height:172px`、按钮组 `margin-top:auto` 底部对齐；路径右对齐换行 | 页面渲染（人工） |
| 登录后端诊断 | `src/home/server.ts`：新增 `GET /api/health`；Origin 拒绝时写 `origin_rejected` 日志（home/onboarding 两个服务都记，含 origin/method/path）。`useLoginMirror.ts` 新增 `probeBackendReachable()`（`mode:'no-cors'` 探测：403 也 resolve，只有服务真的不可达才 reject），失败原因新增 `origin_blocked`；`LoginModal.tsx` 分文案提示「后端在线但来源不被信任」vs「后端未响应」 | `server.test.ts`（health + 日志）+ `useLoginMirror.test.tsx`（origin_blocked） |
| 开发态端口对齐 | `tools/dev-backend.mjs` 默认端口 8200 → 8201（对齐 `HOME_BASE`）；`package.json` 新增 `npm run dev:backend`；`vite.config.ts` 固定 `127.0.0.1:5180` + `strictPort`（不再静默漂移到白名单外端口）；`src/electron/main.ts` 未打包态传 `allowDevOrigins: !app.isPackaged`（仅开发调试放行，安装包不放宽） | 人工（`npm run dev` + `npm run dev:backend`） |

> 诚实边界（批次22）：成功率/延时仍只统计真实样本（`test` + 有结果的 `auto_bind` + 卡片 `lastTest`），不做估算；名字归一只做大小写/空白容错，不跨 Agent 猜测。手动测试仍是唯一能立即补样本的入口，自动拨测只在登录自动接入/重接时发生。`⚡ 一键适配全部` 仍只处理可写 JSON 客户端（Qoder CN / Claude Code / Cursor 等），TOML（Codex）与无稳定配置的客户端只给复制片段/手工说明；写入前备份，冲突/坏文件拒绝覆盖。`/api/health` 只证明本机 8201 有服务响应，不代表账号会话有效；`origin_blocked` 提示不等于放行，安装包仍按白名单拒绝未知来源。

---

## 批次23：开发态登录一键启动 + 效果证据迁首页 + MCP 一键适配全覆盖（2026-10-31）

> 起因：用户反馈 ① Web 端登录提示「登录后端未响应（localhost:8201）」；② 效果证据四卡应从 Agent 接入页移到首页关系图谱上方；③ MCP「一键适配全部」不可点击，要求真正一键自动适配，并给无法接入的客户端具体设置指引。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 开发态一键启动 | 新增 `tools/dev.mjs`：探活 8201（`Origin: http://127.0.0.1:5180`）→ 兼容则复用，否则拉起 `tools/dev-backend.mjs` → 启动 Vite（`vite/package.json` 定位 bin）；Vite 退出统一收尾。`tools/dev-backend.mjs` 默认 8201、监听 127.0.0.1、EADDRINUSE 明示占用进程；`package.json` 的 `dev` 指向 `node tools/dev.mjs` | 人工（dev-origin 200 / 其它来源 403；8201 被桌面端占用时当时提示关闭，**批次24 已改为自动换备用端口**，见下一节）|
| 效果证据迁首页 | `coreHome.ts` 的 `HomeFeedResult` 新增 `effectGains`（`computeOnboardGains` 真实聚合，存储不可用时 `emptyOnboardGains`）；`main.tsx` 状态与三处刷新回填；`Dashboard.tsx` 在 `#layerGraph` 前渲染 `#effectEvidence`（`Gains id="effectGains"`）；`AgentOnboardPage.tsx` 移除四卡与 gains 状态；`Gains.tsx` 支持 `id` 避免重复；`AgentOnboard/theme.css` 删除失效 `.gains/.gain` | `coreHome.test.ts`（真实值/空账本/损坏存储）、`Dashboard.test.tsx`（四卡在 `#gains` 与 `#effectGains` 独立、位于 `#layerGraph` 之前）、`AgentOnboardPage.test.tsx`（接入页无 `#gains`）、E2E `home.spec.ts` / `app.spec.ts` |
| MCP 配置合并扩展 | `src/agentOnboard/mcpClients.ts`：新增 `mergeMcpTomlConfig`（新建段 / 保留其它段 / `http_headers` 子表与内联表 / 缺令牌补齐 / 冲突拒绝 / 幂等 / 保留 CRLF）；`connectHint` 覆盖 10 个客户端；Codex/Gemini/Qwen 改为 `writable`；`src/electron/mcpClients.ts` 按 `format` 分派 JSON/TOML 合并 | `agentOnboard/__tests__/mcpClients.test.ts`（TOML 6 例 + 配方可写性）、`electron/__tests__/mcpClients.test.ts`（Codex 新建/幂等/保留/冲突/手工客户端拒绝） |
| 一键适配真正可用 | `McpClientsPanel.tsx`：按钮只在无管理员/扫描中/浏览器模式/无已安装客户端时禁用；`wireAll` 先顺序自动写入全部可写客户端，再为未接通的其余客户端调用 `mcp:clientSnippet` 生成片段；文案回显「自动 N + 片段 K」与逐项失败原因；`canWire` 排除 wired/conflict/invalid；行内按钮覆盖 TOML | `McpClientsPanel.test.tsx`（批量自动 3 + 片段 1 / 全部已接入仍可生成片段 / 成员禁用）、`autoDiscovery.test.ts`（TOML 自动写入、冲突拒绝、无路径转手工） |
| 接通指引 | `McpClientsPanel.tsx` 的 `guideFor(row, endpoint)`：按状态给出具体菜单路径/配置文件、serverKey、端点、当前 URL 与修复步骤（冲突→改指端点或删条目→刷新→一键接入；无法解析→先修语法；手工→按 `connectHint` 添加 HTTP MCP）；行内 `data-testid="guide-<id>"` 展示 | `McpClientsPanel.test.tsx`（Codex 路径、Trae 菜单、Cursor 冲突、WorkBuddy 解析错误 + 刷新） |

> 诚实边界（批次23）：`npm run dev` 只解决浏览器开发态登录；8201 被安装版桌面端占用且来源不允许 5180 时**批次24 起自动改用备用端口**（不再需要关闭桌面端）。效果证据四卡只统计真实召回审计与记忆主表，无样本「—」、无单价不估算。MCP 自动写入覆盖结构稳定的 JSON/TOML 客户端（28-D 起含 WorkBuddy `~/.workbuddy/mcp.json`）；Zcode（应用内部存储）与 deepseek harness（宿主下发）只给手工指引/宿主委托（28-E 起 Zcode 片段为可粘贴 mcpServers JSON）；冲突/无法解析/超 8 MiB 一律拒绝覆盖；令牌只在片段中一次性下发，绝不进日志/审计。

---

## 批次24：日志人话化 + 列表分页/列宽固化 + 遗留账本清理 + 层级生成时间 + 开发态端口回退（2026-10-31）

> 起因：用户 5 条反馈 —— ① 没接大模型为何 L2–L6 有数据；② 每条记忆要不要带入库日期与每层生成日期（拍板：口径2，单个层级生成时间）；③ 程序运行日志全是代码看不懂的，需要上下滚动条；④ 日志记录页/审计日志页要分页 + 可调表头宽度并固化；⑤ Web 端登录报「本机登录后端在线，但当前页面来源未被信任」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 程序运行日志人话化（③） | 新增 `src/web/Home/programLogLabels.ts`（`SCOPE_LABEL`/`ACTION_LABEL`/`CHANNEL_LABEL`/`NOTE_KEYS` → `actionTitle`、`detailNote`、`humanizeProgramLog`）；`ProgramLogPanel.tsx` 默认「人话」视图 + 「原文」切换（`pl-mode-human`/`pl-mode-raw`），中文标题后同排保留原始 `scope:action` 便于 grep；正文区固定 240px **常驻上下滚动条**（`Logs/extras.css` 的 `.pl-body{overflow-y:scroll}`），用户上滚看历史时不被新日志拽走（重新滚回底部恢复自动跟随，无单独按钮）；主进程 `tailActionLog` 窗口 20 → **50** 条（`src/electron/actionLog.ts` 的 `TAIL_MAX_LINES`，`main.ts` §7 注释同步） | `programLogLabels.test.ts`（动作/通道翻译、未收录动作回落、字段优先级与截断、脱敏字段不显示）、`ProgramLogPanel.test.tsx`（一次取 50、人话/原文切换、上滚不抢回底部、空/读失败/刷新/诊断复制）、`actionLog.test.ts`（`limit` 钳制 1..50） |
| 分页 + 列宽固化（④） | 新增 `src/web/shared/paginate.ts`（10/20/50/100，默认 10，越界钳制）、`src/web/shared/PageNav.tsx`、`src/web/shared/useColWidths.tsx`（拖把手 + localStorage 固化 + 恢复默认，`MIN_COL_WIDTH=30`）、`src/web/shared/tableResize.css`；`LogsPage.tsx`/`LogCards.tsx`（键 `logsColWidths`，7 列）与 `AuditPage.tsx`/`AuditTable.tsx`（键 `auditColWidths`，9 列）卡片流改表格 + 表头 + 分页；链式视图进入时重置到第 1 页 | `paginate.test.ts`（默认档位/越界钳制/空列表/偏移连续）、`useColWidths.test.tsx`（缺键/坏 JSON/短数组/非法项回落、写盘异常吞掉、拖拽固化、重挂载保持、恢复默认、只动目标列）、`LogsPage.test.tsx`（每页 10 行 + 翻页行号连续 + 跳页/档位 + 过滤后回有效页 + 列宽固化与恢复）、`AuditPage.test.tsx`（分页、链式视图分页、表头宽度固化） |
| 遗留账本清理（①） | 新增 `src/core/memagent/legacyLayers.ts`（`isStubDeepLayered` 判定「带任一 L2–L6 正文且 `refined_by!=='llm'`」/`scanStubLayers` 只读预览/`demoteStubLayers` 降级回真实 L1：清空 stub 的 L2–L6 与 `layer_specs`、重算 sha256、**向量原样保留**（本机 986 条脏行实测 `cosine(embedding, embedSync(content_l1)) = 1.000`，旧向量本就按 L1 生成）、写 `security_change` 审计 `detail.op='legacy_layer_demote'`）→ `ipcChannels.ts` `legacyScan/legacyDemote` → `main.ts` §6c `registerLegacyIpc`（scan 需会话、demote 需管理员 + `backupBeforeKernelChange` 强制先备份）→ `preload.ts` / `desktop/hostBridge.ts` → 新增 `src/web/security/LegacyLedgerCard.tsx`（管理员进入自动预览、二次确认、回执与样本 id） | `legacyLayers.test.ts`（只命中非 llm 的深层行、真实 LLM 产物与纯 L1 行不碰、缺 L1 跳过、向量原样保留且无向量行不新建、重跑幂等、审计成对）、`LegacyLedgerCard.test.tsx`（浏览器不可用/非管理员不扫/预览回执/确认执行/取消/干净账本/主进程拒绝/IPC 未注册）、`SecurityPage.test.tsx`（第五区块挂载） |
| 层级生成时间（②口径2） | 内核 `types.ts` `Memory.layers_generated_at?: number`，写入落层（`memories.ts`）、合并摘要（`forgetting.ts`）、手动改写（`coreMemoryOps.ts` 视为重新生成层级）打戳；页面 `types.ts` `MemoryRecord.layers_generated_at?: string`（`toRecord` 转 ISO，**缺字段不拿 `created_at` 冒充**）；新增 `src/web/shared/layerTime.ts`（`fmtLayerGen` / `LAYER_GEN_UNRECORDED`），记忆行、层级列表、抽屉、层级详情页展示；抽屉「创建/更新」也改走本地时区（`MemoryDrawer.tsx` 的 `localTime()`），不再直接显示账本里的 UTC ISO | `layerTime.test.ts`（未记录/整档/日档/畸形串原样）、`refine.test.ts`（只落 L1 与全合规都打戳）、`forgetting.test.ts`（AC-09 摘要打戳）、`coreMemoryOps.test.ts`（映射与改写刷新） |
| 开发态端口回退（⑤） | `tools/dev.mjs`：探活默认端口→兼容则复用；**有服务但不信 5180 来源**时改用备用端口（8211→8215，`net` 真探空闲）另起 `allowDevOrigins` 登录服务，置 `DEV_NO_OPEN=1` 并 `vite --open /overview.html?backend=…&agentBackend=…` 直接开受信地址；无可用端口如实声明不起后端。`tools/dev-backend.mjs` 支持 `PORT=` 并提示非默认端口需带 `?backend=`；`vite.config.ts` 的 `server.open` 尊重 `DEV_NO_OPEN`；`LoginModal.tsx` 两条失败文案改为真实指引（不硬编码端口，仍过 `backend.test.ts` 字面量扫描） | `backend.test.ts`（src/web 端口字面量扫描，含新文案）；实测：桌面端占用 8201（403 无 ACAO）→ `npm run dev` 落到 8211，`/api/health` 200 且 `ACAO=http://127.0.0.1:5180`，`/api/login` 真实返回会话 |

> 诚实边界（批次24）：① L2–L6 的数据来自批次9 规则落地**之前**的 stub 账本，清理只降级「能被证明是 stub」的行、不可逆（执行前强制备份，只能从备份恢复），纯浏览器无 IPC 时卡片如实显示不可用；② 只记「本组层级生成时间」一个时刻，历史行显示「层级生成未记录」，不做逐层时间推断；③ 列宽按列序号保存，将来加减列需「恢复默认」；④ 端口回退只覆盖登录/镜像服务，接入服务 8200 若同样被桌面端占用仍会拒绝来源，纯浏览器仍无宿主能力。

---

## 批次25：全量审核「假展示与静默丢失」五条收口（2026-10-31）

> 起因：2026-10-31 全量只读审核（`specs/AUDIT-FULL-REVIEW-2026-10-31.md`）列出 9 条 P0。本批按报告 §6 先收「用户会据此做出错误判断/数据丢失」的五条：P0-1（层级页假保存）、P0-2（日志页假审计链）、P0-3（写页假五维）、P0-7（内核不可达当空账本）、P0-6（FileStorage 写盘失败静默丢批）。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| P0-1 层级页保存真写回 | `src/web/memory/MemoryLayeredPage.tsx`：`save()` 改调 `coreUpdateContent`（复用 P8 同一路径，含 L0→L1 质量门 + version+1 + `memory_op` 审计），不再 `window.dispatchEvent('layered-memory-save')`（全仓无监听）；失败显示内核原因 | `MemoryLayeredPage.test.tsx`（点保存 → 内核收到 content 且 version+1、被质量门拒绝可见） |
| P0-2 日志页真查审计 | `src/web/logs/LogCards.tsx` `AuditModal`：按 `request_id` 真查内核审计（`storage.queryAudit({ request_id })`），零行显示「该 request_id 无审计行」而非「真实审计记录」；移除硬编码占位 | `LogCards.test.tsx`（真查命中/零行诚实空态） |
| P0-3 写页查重诚实化 | `src/web/write/logic.ts` `scoreDedup` 收缩为**本地词面相似度单值**（Jaccard 分词重合度）+ 对照层 L1 阈值；删除旧五维（同一 Jaccard 的五次仿射变换 + 未接 LLM 却展示的 `llm_judge`）；`DedupCard.tsx` 去掉五进度条与三模式按钮（合并/覆盖/保留未接入写路径），判重由内核 `dedup.ts` 提交时真实执行 | `logic.test.ts` + `DedupCard.test.tsx` + `WritePage.test.tsx`（不再声称六维/五维、无三模式按钮） |
| P0-7 内核不可达不再冒充空账本 | 新增共享件 `src/web/shared/kernelLoad.tsx`：`useKernelLoad<T>(label, load)` 三态 loading/ok/error + `kernelErrorText(e)` 保留 E_XXX 码 + `KernelLoadError` 错误卡（原因 + 重试 + `ui:kernel_load_error` 动作日志）；记忆管理/写页/参数/监控/裁决/接入演示六页统一接入；首页 `src/web/Home/coreHome.ts` 新增 `storageError` → `Dashboard.tsx` 横幅「内核账本没读到（不是账本为空）」 | `kernelLoad` 相关页测试（内核不可达 → kernel-error + 原因 + 重试；真空账本 → 诚实空态不报错）+ `coreHome.test.ts`/`Dashboard.test.tsx`（storageError 横幅） |
| P0-6 FileStorage 写盘失败不再静默丢批 | `src/core/memagent/fileStorage.ts`：`commitBatch` 只在 `persist()` 成功后清 `batching/dirty`；`putMemory/appendAudit` 先写盘成功再提交内存（失败回滚 doc 浅拷贝）；`close()` 落 `storage:close-commit` 审计（成功/失败都记） | `fileStorage.test.ts`（persist 抛错 → dirty 保留、close 前重试、内存与磁盘一致） |

> 诚实边界（批次25）：① P0-7 是「读不到」与「真空账本」的区分，不改变内核判重逻辑；② 写页词面预览只是输入过程中的提示，不是入库判定；③ P0-4/P0-5（本机 8200/8203 无鉴权）、P0-8（未提交）、P0-9（CI 红）按报告 §6 留待批次 26/27 与用户授权；④ `tools/code-index.mjs` 新鲜度门禁仍只比符号与行数，单行改动照样通过（P2-18，批次 27 处理）。

---

## 批次26-A：本机信任边界 P0-4/P0-5（2026-10-31）

> 起因：批次25 遗留 P0-4（Webhook 8203 无鉴权）与 P0-5（AgentOnboard 8200 写端点无会话校验）。原则：Origin 白名单不是鉴权；未接会话真源一律拒绝（fail-closed）。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| P0-4 Webhook 令牌闸门 | 新增 `src/electron/webhookServer.ts`：`createWebhookHttpServer` —— 所有请求（含无 Origin）校验 mcp-token（timingSafeEqual；`Authorization: Bearer` / `x-mcp-token`）；拒绝写 `webhook:token_rejected` 动作日志（不含令牌值）；body 上限 1 MiB → 413；`/ingest/status`、`/ingest/hash` 只回 id+状态（去 l2_preview），`n` 钳 1..100；`main.ts` 改用该工厂（原内联 handler 退役） | `src/electron/__tests__/webhookServer.test.ts`（10 例：401/403/413/脱敏/钳位/404/日志脱敏） |
| P0-5 会话闸门（8200） | `src/agentOnboard/server.ts`：POST/DELETE 全量要求 `x-session-id` 经 `getSession` 校验（缺省提供方=全拒）；rotate-key/revoke-key/DELETE 需 `role==='admin'`（403）；拒绝落 `auth_rejected`；GET /audit 出站脱敏本机路径（`sanitizeAuditEntries`：Windows 盘符路径与 /home、/Users 等替换 `<本机路径>`）；CORS Allow-Headers 加 `x-session-id` | `server.test.ts`（fail-closed / member 403 / admin 放行 / 伪造 sid / 路径脱敏）+ `origin.test.ts`（同源无会话 401） |
| P0-5 UI 带会话头 | `src/agentOnboard/client.ts`：构造第三参 `getSession`，`_headers()` 自动附 `x-session-id`；`src/web/AgentOnboard/useBackendMirror.ts`（createService）与 `autoOnboard.ts`（auto_bind 客户端）传 `currentSessionId`；`src/electron/main.ts` 传 `homeServerRef.getSessionContext` | `client.test.ts`（带头 / 无会话 401 透传） |
| P0-5 E2E 真会话 | `e2e/servers.ts`：`startHomeBackend` 暴露 `homeServer` 句柄；`e2e/app.spec.ts`：起真实 home 后端 → `POST /api/login` 内置 admin（Admin@123456）→ 真实 sessionId 注入 `session:realpage` + `createBackend({ getSession })`，不再用伪造会话串 | `npm run test:e2e`（app.spec 7 例全绿） |

> 诚实边界（批次26-A）：① 8200 的 GET（/agents、/audit）仍只读开放（读不算敏感面）；② 8203 沿用 mcp-token.txt 单令牌，尚无按源限速；③ webhook 旧调用方（无令牌）会 401，采集指南 §0.1/排障已同步；④ P0-8（git 提交）与 P0-9（CI）仍留待用户授权/批次 27；⑤ P1/P2 清单在 `specs/AUDIT-FULL-REVIEW-2026-10-31.md` §6（26-B 待做）。

## 批次26-B：本机信任边界 P1/P2（2026-10-31）

> 起因：审计 §6 P1-1/2/3/9/10/11 + P2-14/15/16/17。原则同 26-A；每项的**诚实偏差与残留风险**见 `AGENTS.md` §9 批次26-B 条目（本表只记落点）。

| 项 | 代码落点 | 测试 |
|---|---|---|
| P1-1 `?backend=` 回环白名单 | `src/web/backend.ts` sanitizeBase（http + 回环主机 + 显式端口 + 无路径/查询/凭据；不限定 82xx——E2E 随机端口与 8211-8215 备用端口复用） | `src/web/__tests__/backend.test.ts` |
| P1-2 数据面 IPC 门禁 | `src/shared/sessionKey.ts`（会话键单一真源）；`src/electron/preload.ts` 四通道尾参自动附会话 id；`src/electron/main.ts` `requireDataPlaneSession` + `validateAuditRecord`（形状校验，request_id 诚实偏差见 AGENTS §9） | `src/web/__tests__/kernelTenant.test.ts` 之外，门禁走主进程（无独立单测，E2E 覆盖登录路径） |
| P1-3 租户主进程下发 | `src/electron/ipcChannels.ts` `tenant:get` → `main.ts`（requireSession 回三元组）→ `preload.ts` → `desktop/hostBridge.ts`；`src/web/kernel.ts` `syncTenantFromHost()` 模块加载覆盖 mam.tenant.v1 | `src/web/__tests__/kernelTenant.test.ts`（4 例：降级/覆盖/失败保持） |
| P1-9 变更吊销会话 | `src/home/server.ts` `revokeSessionsOfUser`（role_change/team_assign 吊销目标账号；password_change 连当前会话） | `src/home/__tests__/admin.test.ts`（3 例） |
| P1-10 MCP 令牌项目作用域 | `src/core/memagent/mcpAuth.ts`（`scope_project_ids` + `projectInScope`）→ `mcpRecall.ts`（recall/list 过滤与拒绝）→ `mcpHttp.ts` + `mcp.ts`（双传输 write 前置校验；默认 `['*']`，残留风险见 AGENTS §9） | `src/core/memagent/__tests__/mcpScope.test.ts`（8 例） |
| P1-11 L0 门禁与 KDF | `src/electron/main.ts` l0Unlock 无 grant 分支 `requireAdmin`；`src/core/memagent/crypto.ts` pbkdf2 异步化 | 既有 crypto/l0vault 套件回归 |
| P2-14 凭据面 | `src/home/server.ts` 登录内存限速（10/min/账号 → 429）+ `default_password_active` 告警；`src/auth/loginService.ts` `isDefaultAdminPasswordInUse()` | `server.test.ts` 批次26-B describe |
| P2-15 令牌副本清理 | `src/electron/mcpClients.ts`：写入失败清 `.tmp-`；成功后 `.bak-` 保留最新 3 份 | `mcpClients.test.ts`（备份清理例） |
| P2-16 Host 头绑定 | `src/shared/localOrigin.ts` `rejectUntrustedHost` → home/onboard server 接线（403 `host_not_allowed` + `host_rejected` 日志） | `localOrigin.test.ts` + `server.test.ts`（恶意 Host 例） |
| P2-17 验证码/注册 | `src/home/server.ts`：captcha 上限 256 + 30/min、注册 10/min 限速；登录 no_account 与 wrong 同响应（401） | `server.test.ts`（限速/防枚举例） |

## 批次27：全量审计收口 P0-8/9 + 27-F + 27-G + P2/P3（2026-10-31）

> 起因：`specs/AUDIT-FULL-REVIEW-2026-10-31.md` 剩余全部条目。诚实偏差与残留见 `AGENTS.md` §9 批次27 条目与 `specs/MANUAL-TEST-FIX-BATCH-27.md` §5。

| 项 | 代码落点 | 测试 |
|---|---|---|
| 27-F MCP 一键适配接真 | `src/agentOnboard/mcpClients.ts`（Trae CN 配方 + `expandHome %APPDATA%/` + `currentToken` 过期降级）；`src/electron/mcpClients.ts` 真写 | `agentOnboard/mcpClients` 既有套件回归 |
| 27-G 登录自动切受信后端 | `src/web/Home/useLoginMirror.ts`（sessionStorage `mam.backend.session.v1` + `discoverTrustedDevBackend` 8211–8215 + 自动重试）；`LoginModal.tsx` 文案 | `useLoginMirror.test.tsx` |
| P2-1 查重阈值单一真源 | `src/core/memagent/layerRules.ts` 常量 → `src/web/write/spec.ts`、MemoryLayeredPage 导出引用 | 既有 layerRules/write 套件回归 |
| P2-2 coreBrowse 层校验 | `src/core/memagent/memories.ts` 非法 layer → `E_BAD_LAYER`（不再记成功审计） | `memories.test.ts` |
| P2-3 webhook 降级契约 | `src/core/memagent/webhook.ts` 未注入 pipeline 如实报错、不记幂等 hash | `webhook.test.ts` |
| P2-4 refined_by 三态 | `src/core/memagent/memories.ts`（`llm`/`llm_partial`/`stub`） | `merge.test.ts`（2 例改期望） |
| P2-5 脱敏对抗样本 | `layerRules.ts` 正则补 `sk-proj-` 形态；边界固化为测试 | `refine.test.ts` 对抗样本 describe（4 例） |
| P2-7 项目 ID 真源 | `src/web/memory/coreMemoryOps.ts`、`WritePage.tsx`、`logs/LogCards.tsx` 项目来自真实清单 | 既有套件回归 |
| P2-10 动作日志加固 | `src/shared/actionLog.ts`（值形态脱敏 + `safeLogToken` 归一 40/80/80） | `actionLog.test.ts` 值形态 describe（5 例） |
| P2-18 索引指纹门禁 | `tools/code-index.mjs`（每文件 12 位 sha256 指纹入 markdown，`--check` 单行改动即失败） | 门禁本身（`verify:fast`） |
| P3-1 种子钩子收口 | `src/core/memagent/types.ts` `MemAgentSeedHooks`；`src/web/kernel.ts` `getKernelWithSeed()` | 7 个测试文件换用（12 处） |
| P3-2 审计零会话键 | `src/core/memagent/memories.ts`（5 处）、`l0vault.ts`（4 处）detail 移除 `l0_session_id` | 既有套件回归 |
| P3-3 降级打生成时间 | `src/core/memagent/legacyLayers.ts` 降级时 `layers_generated_at=now`（grafted_from 保留，理由见代码注释） | `legacyLayers.test.ts:84` |
| P3-4 IPC 会话闸门 | `src/electron/main.ts` `l0:seal`（IpcResult 化）/`mcp:clients`（闸门失败抛错）；`preload.ts`；`src/web/shared/l0Port.ts`；`autoDiscovery.ts`、`McpClientsPanel.tsx` 带会话 | 既有套件回归（E2E 覆盖登录路径） |
| P3-5 宿主桥去重键 | `src/desktop/hostBridge.ts` `dedupeKey`（id+method+args） | `hostBridge.test.ts` +1 例 |
| P3-6 Windows file: 信任 | `src/electron/main.ts` `isTrustedUrl` `fileURLToPath` + 目录边界 | 门禁回归（主进程无单测，E2E 覆盖） |
| P3-7 日志轮转口径 | `src/electron/actionLog.ts` 尾读循环 `keep-1`；AGENTS §4 文案纠正 | 既有 actionLog 套件回归 |
| P3-8 先礼后兵 | `tools/package-builder.cjs` `killReleaseProcesses`（CloseMainWindow 3s → Stop-Process -Force） | 实机打包验证（本报告 §4.8） |
| P3-9 dev 端口健壮化 | `tools/dev.mjs`（TOCTOU 顺延重试 + `agentBackend` 探活后才拼参） | 实机 dev 验证 |
| P3-10 engines | `package.json` `engines.node>=22` | npm 安装警告 |
| P3-11 悬浮层冒烟 | `src/web/InlineAttribution/__tests__/floatEntry.test.tsx`（新，4 例） | vitest |


---

## 桌面安装包（Electron 壳 · 2026-10-30 更新）

- 目标：把已落地的 19 个 Vite HTML 入口 + FileStorage 本地库打包为可双击安装的 `.exe`（正式安装包）与便携目录。
- 存储注入点（零改页面）：`src/core/memagent/storage.ts` 的 `InMemoryStorage` 构造在 Electron 渲染进程下返回 `IpcStorageBackend`（`src/desktop/ipcStorage.ts`），经 preload 的 `window.api.storage` 转发到主进程 **FileStorage**（`userData/memories.db.json`，原子写 + fsync + 损坏备份 `.corrupt`）；浏览器/测试仍走原生内存。
- 主进程 `src/electron/main.ts`：BrowserWindow + 主进程持有 FileStorage + 启动本机服务 + 静态服务 `dist/`（`listen(0)` 随机端口）+ 注册 `storage:*` / `hostScan:run` / `float:*` IPC；入口 `overview.html?backend=http://127.0.0.1:8201&agentBackend=http://127.0.0.1:8200`。
- 本机服务端口（固定）：agentOnboard 8200、home/mirror 8201、MCP TCP 8202、Webhook 8203、MCP HTTP 8204。
- preload `src/electron/preload.ts`：contextIsolation 开、nodeIntegration 关，经 contextBridge 暴露 `window.api.storage`、`window.api.hostScan` 与 `window.__ELECTRON__`；IPC 只信任静态服务实际端口 + `dist` 下的 `file:` 页面。
- **宿主真扫（discover 真实化）**：`src/desktop/hostScan.ts`（纯匹配，可进浏览器包）+ `src/electron/hostScan.ts`（node IO，Windows `wmic` / Unix `ps`）+ MCP 配置检测；渲染层 Electron 下走宿主真扫（`source='host'`）。**批次16 起纯浏览器不再降级内核模拟**：`scanLocalAgents()` 返回明确失败原因（非桌面壳环境），页面提示改用桌面应用或点「🔍 手动检测」，绝不伪造发现行。
- **遗忘调度（批次 4）**：主进程 6h 周期执行 `runForgettingCycle`（首跑 10min），读取参数页 `auto_organize` 开关；`MAM_FORGETTING_DISABLED=1` 可关闭，`MAM_FORGETTING_INTERVAL_MS` / `MAM_FORGETTING_FIRST_DELAY_MS` 可调；整轮 `beginBatch/commitBatch`，审计 `forgetting:cycle:*`。
- 构建：`npm run build:electron`（esbuild 打包 main+preload → `dist-electron/*.cjs`，electron 留外部）；`npm run package`（vite build + esbuild + prepare-electron-dist + electron-builder → `release/installer` NSIS 安装包；**批次17 起成功后自动删除旧的 `release/installer-*`，批次18 起同时删除旧便携包 `release/win-unpacked` 与 `release/builder` 残留，批次19 起打包前强制结束 `release/` 下旧实例并在构建成功后把时间戳产物收口回固定目录，批次21 起该收口在 rename 持续 EPERM 时改用复制+删除**，`tools/package-builder.cjs`）；`npm run package:win`（vite build + esbuild + `tools/package-win.cjs` → `release/win-unpacked` 便携目录）。配置 `electron-builder.config.cjs`。
- **数据根目录（批次 6）**：`src/electron/dataRoot.ts`（纯 Node，指针读写/校验/可写探测/旧数据探测/白名单迁移）+ `src/electron/main.ts`（`resolveDataRootAtStartup` / `prepareDataRoot` / `applyDataRootMigration` / `importLegacyDbDir`）。指针固定 `%APPDATA%\MultiAgent Memory\data-root.json`；安装后**首次启动**弹「选择数据存放位置」（默认位置 / 选择文件夹… / 退出），选定后写指针并重启一次，此后 `setPath('userData')` 在 ready 前生效——记忆库、采集游标、main.log/float.log、mcp-token.txt、备份配置、home-audit.json、agent-onboard.json、`backups/`、`memories-export/` 与 Chromium 缓存全部落在该目录。迁移只复制白名单文件、不删除源；目标冲突默认跳过，显式「更改位置」且目标已有数据时按 `migrateOverwrite` 先备份为 `*.bak-<时间戳>` 再覆盖。旧版 P8 `dbDir`/`pendingMove` 已退役（一次性导入旧库后从配置中清除）。IPC：`dataRoot:get/open/change/restoreDefault`；参数页「数据存放位置」卡片展示/更改/恢复默认。旧开发态目录 `%APPDATA%\multi-agent-memory` 仅作为迁移源被探测，不会自动迁移。
- 注意：Electron ≥34（内置 Node ≥22.13）；打包需能访问 Electron/NSIS CDN。
- **首页真实可算**：`src/web/Home/coreHome.ts` 的 `getHomeFeed` 从内核账本（storage）实时聚合——四卡（累计记忆/累计动作/近1h调用/待裁决）+ 异常速览 + 近1h 召回 Top3 + 待裁决；`SyncState.wired` 显式为 `false`（同步未实现），`lastReconcileAt` 只认真实 `sync_*` 审计，`pendingSync` 为真实 `pending_sync` 计数。

---

## REQ-003 任务级代码映射（T1–T15，TS+React 实现）

> 编码阶段所有原子任务已落地。**2026-10-07 起实现与规格完全对齐**（TS 内核 + React 组件），此前的"纯 ESM JS"方案级差异已消除。
> UI 硬约束：结构/样式/文案/交互以 `design/ui/Agent接入页_原型.html` 为唯一事实来源，各组件内均标注对齐声明。

| 任务 | 规格职责 | 实际落点（文件 : 导出） | 验收命令 |
|------|----------|---------------------------|----------|
| T1 | 接入卡片数据模型 / 类型定义 | `src/types/agentOnboard.ts` : `AgentStatus`/`PriorityBadge`/`CircuitState`、`AgentCard`/`AgentCardInput`/`AgentCardCandidate`、`UiAgentCard`（对齐原型）、`assertShape` | `npm run typecheck` + `vitest run src/types` |
| T2 | 页面状态机 + 熔断任意态降级 | `src/agentOnboard/stateMachine.ts` : `TRANSITIONS`、`transition()` | `vitest run stateMachine.test.ts` |
| T3 | 接入卡片渲染（卡片头 + 单 Agent 操作） | `src/web/AgentOnboard/AgentCard.tsx` : `AgentCard` | `vitest run AgentCard.test.tsx` |
| T4 | 一键全量接入（发现→打标→绑→验 + 进度条） | `src/web/AgentOnboard/OneClickOnboard.tsx` : `OneClickOnboard`（四段 `.stages` + `#found` + 撤销） | `vitest run components.test.tsx` |
| T5 | MCP 工具配置 + project_id 红线(R2) | `src/web/AgentOnboard/McpToolConfig.tsx` : `McpToolConfig`、`toolRef`（布尔归一化）；`validators.ts` : `checkR2_projectIdRequired` | 同上 + `validators.test.ts` |
| T6 | 双通道 + 熔断降级(R4/R5) + SHA-256 幂等 | `src/web/AgentOnboard/ChannelConfig.tsx` : `ChannelConfig`；`stateMachine.ts` : 熔断→`DEGRADED`；`validators.ts` : `checkR4`/`checkR5`/`checkR6` | 同上 |
| T7 | 密钥脱敏 + 轮换宽限(R6) | `src/web/AgentOnboard/KeyMgmt.tsx` : `KeyMgmt`；`service.ts` : `rotateKey`/`revokeKey` | 同上 + `service.test.ts` |
| T8 | 测试面板 + request_id 审计(R7) | `src/web/AgentOnboard/TestPanel.tsx` : `TestPanel`；`service.ts` : 审计写入 | 同上 |
| T9 | 校验 R1–R10 统一收敛 | `src/agentOnboard/validators.ts` : `validateOnboard` + `checkR1`…`checkR10` | `vitest run validators.test.ts` |
| T10 | 按端置灰 / 部署端字段(R10) | `src/agentOnboard/formMatrix.ts` : `signalSourcesForForm`/`isSourceGrayed`；`src/web/AgentOnboard/FormBadge.tsx` : `FormBadge`、`GRAYED_BY_FORM` | `components.test.tsx` + `e2e.test.ts` |
| T11 | 集成（卡片→接口→审计链路） | `src/agentOnboard/service.ts` : `AgentOnboardService<B>`（泛型：内存同步 / 注入后端异步） | `vitest run service.test.ts` |
| T12 | 端到端验收（含按端置灰/同步） | `src/agentOnboard/__tests__/e2e.test.ts`；页面装配 `src/web/AgentOnboard/AgentOnboardPage.tsx` | `npm test`（117 文件 / 1248 例全绿，2026-10-31） |
| T13 | 真实后端 HTTP 服务 | `src/agentOnboard/server.ts` : `createServer`（node:http + JSON 持久化 + CORS + 批次26 写端点会话闸门：x-session-id 经 getSession 校验，密钥轮换/撤销/删除需 admin；GET /audit 出站脱敏本机路径） | `server.test.ts` / `client.test.ts` |
| T14 | HTTP 客户端 | `src/agentOnboard/client.ts` : `AgentOnboardClient`（批次26：有会话时自动带 `x-session-id` 头）；`src/web/AgentOnboard/useBackendMirror.ts`、`autoOnboard.ts` | `client.test.ts` |
| T15 | 真实链路 E2E + 真浏览器点击级 | `e2e/app.spec.ts`（Playwright，指向 `dist/` 真实构建产物；批次26 起起真实 home 后端 + admin 登录） | `npm run test:e2e`（21 个 spec，`workers=1`） |
| T16 | Webhook 入口 HTTP 服务 | `src/electron/webhookServer.ts` : `createWebhookHttpServer`（批次26 P0-4：全请求 mcp-token 鉴权、1 MiB body 上限、status/hash 只回 id+状态） | `src/electron/__tests__/webhookServer.test.ts` |

> 全量命令：`npm run verify` = `verify:fast`（`typecheck` → `lint` → `test:coverage`，121 文件 / 1320 例）→ `build:electron` → `test:e2e`（先 `vite build`，再 Playwright 21 个 spec / 94 例；静态服务与后端均用系统分配端口）。
> 只跑快闸：`npm run verify:fast`（不含 E2E）。

## 批次28（2026-10-31）

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 28-A 内核账本写锁与只读镜像 | `src/core/memagent/fileStorage.ts`：`<db>.lock` O_EXCL + pid 存活探测（陈旧锁自动回收）、`StorageLockedError`（E_STORAGE_LOCKED）、`readonly`/`reloadOnMtime` 选项、`readOnly/lockedBy` getter | `fileStorage.test.ts`「写锁与只读镜像」6 例（同进程第二实例降级只读/锁释放/陈旧锁回收/只读构造/镜像重载/无 reload 快照） |
| 28-A 内核数据面 HTTP 端点 | `src/home/server.ts`：`POST /api/kernel/invoke`（会话门禁 + 六方法白名单 + appendAudit 形状校验 + `{ok,result|error}` 信封）、`GET /api/kernel/info`；`ServerOptions.kernelStorage/kernelInfo` 接线 | `server.test.ts`「批次28-A 内核数据面端点」4 例（501/401+400/审计校验/只读镜像） |
| 28-A 浏览器三态账本 | `src/web/httpStorage.ts`（HttpStorageBackend：会话/可达性/401/501 四类 KernelUnavailableError + `fetchKernelInfo`）；`src/web/kernel.ts` 三态选择 + `rebuildKernelForDataPlane()` + `setKernelStorageForTests`；LoginModal/main.tsx 登录后重建 | `src/web/__tests__/httpStorage.test.ts`（9 例）；mock 会话页面测试注入内存账本（SecurityPage/LogsPage/AgentOnboardPage） |
| 28-A dev 后端只读镜像 | `tools/dev-backend.mjs`：data-root.json 指针定位真实 `memories.db.json`，`FileStorage{readonly:true,reloadOnMtime:true}` 挂上 `/api/kernel/invoke`；绝不抢桌面端写锁 | verify:fast 覆盖（脚本不进 typecheck，人工启动验证） |
| 28-B/28-D 宿主继承 + WorkBuddy 可写 | `src/agentOnboard/mcpClients.ts`：`inheritsFrom`（deepseek harness ← qoder-cn，状态如实取宿主）+ WorkBuddy `configPath '~/.workbuddy/mcp.json'`（28-D 实机确认，可备份+合并写入；28-B 的 `dynamicConfigGlob` 基础设施随实机结论移除）；`src/electron/mcpClients.ts`：扫描宿主继承状态推导、`wireMcpClient` 委托写入；Zcode 保持手工（应用内表单/JSON，无文件路径） | `agentOnboard/__tests__/mcpClients.test.ts`（配方常量/片段/探测更新）、`electron/__tests__/mcpClients.test.ts`「批次28-B/28-D 三客户端再审查」4 例 |
| 28-E Zcode 片段升级 | `src/agentOnboard/mcpClients.ts`：Zcode `format` unknown→`json`（`renderMcpSnippet` 输出与 WorkBuddy 同构的 mcpServers JSON，可直接粘贴进其 JSON 标签页）；`configPath` 仍 null（扫描层无路径 manual）、`writable` 仍 false（不代写）——只升级片段不改自动写入边界；`McpClientsPanel.tsx` 安全说明同步 | `agentOnboard/__tests__/mcpClients.test.ts`（片段 JSON.parse+同构断言、探测 no_config 断言） |
| 28-C 遗留层自动清理 | `src/core/memagent/legacyLayers.ts`：`isMislabeledLayer`（标了 L2–L6 但无深层正文且非 llm/llm_partial）；`main.ts` bootstrap `autoDemoteLegacyLayers()`；`forgetting.ts` `buildSummary` 摘要行不再误标 L3；`coreMemoryOps.coreUpdateContent` 归一 stub 行 | `legacyLayers.test.ts`、`forgetting.test.ts`、`LegacyLedgerCard.test.tsx`、`coreMemoryOps.test.ts` |

---

## 批次32（2026-11-01）：LLM 多引擎 + 按延时路由 + DSH 明细默认收起

> 起因：用户两条要求——①「LLM 精炼引擎增加第三方大模型，不区分简单和深入，哪个能用哪个快用哪个」；②「DSH 中记忆库信息要折叠起来，需要看的时候点击展开查看详细信息，不是直接展示详细，这样太占页面空间了」。
> 拍板：接入 = 通用 OpenAI 兼容 + 预设快选；路由 = 按最近拨测延时自动排序；DSH 折叠 = 先实测渲染能力（批次29 已实测 DSH 只渲染 Markdown、`<details>` 原样露出，故走「默认一行摘要 + 按需再取明细」）。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 32-A 多引擎配置 | `src/electron/llmGateway.ts`：`LlmEngineConfig` 增 `needsKey/lastLatencyMs/lastProbeAt/lastProbeOk`；`LLM_PRESETS` 预设快选（Ollama/DeepSeek/Kimi/智谱GLM/通义/OpenRouter）；`mergeLlmConfig`（补丁式：改引擎 / `add.preset` / `add` 自定义（id `custom_*`）/ `remove` / `key:{id,value}`）幂等 + 钳制（非布尔 enabled→false、缺或重复 id 丢弃、空列表回默认）；`chatEndpoint(base)`：`/v\d+` 结尾接 `/chat/completions`，否则接 `/v1/chat/completions` | `llmGateway.test.ts`（config 往返、钳制四条、`chatEndpoint` 单元 + 真实请求路径 `/api/paas/v4/chat/completions`、mergeLlmConfig 五类动作） |
| 32-A 密钥面收口 | 同文件：`llm-keys.json`（0600，`{引擎id: 密钥}`）`loadLlmKeys/saveLlmKey/keyExists`，空值=清除；配置文件 `llm-config.json` **绝不含密钥**（`llmEngineViews` 只出 `keySet`）；legacy `llm-deepseek-key.txt` 仅作 `deepseek` 只读兜底（`llm-keys.json` 优先；清除不删用户遗留文件）；`isLocalBase()` 按 `new URL().hostname` 判回环 → 本机引擎 `needsKey=false` 且**永不带 Authorization**；`safeErrorText` 截 200 字，密钥绝不进 `refine_error` | 同上（「配置文件永不含密钥」断言、Authorization 只给 needsKey 引擎、legacy 兜底优先级、错误文案不含 KEY、`listModels` 本地/远端 tier 混合） |
| 32-B 按延时路由 | 同文件：`LlmGatewayProvider.callOrder()` = 可运行引擎（`enabled && model && (!needsKey || 有密钥)`）按 `lastLatencyMs` 升序（未拨测 → `MAX_SAFE_INTEGER`，同值按列表顺序稳定并列），**逐个顺序回退，首个成功即用**；L2–L6 同一口径，**删除厂商↔层级绑定**；`applyProbeResult` 只在拨测成功时记延时（失败不顶队首）；都失败抛聚合错误（内核记 `refine_error`，该层留空） | 同上（延时排序、未拨测排后 + 并列顺序、三引擎顺序回退捕获 `['kimi','deepseek','ollama']`、聚合错误含各引擎原因且无密钥、可运行性三条跳过） |
| 32-B 主进程/IPC | `src/electron/main.ts` §6d：`llm:configSet` 走 `mergeLlmConfig` + `saveLlmKey`；`llm:test` 真拨测后 `applyProbeResult` 写回配置（延时即下次排队依据）并重载网关；日志只记 id/模型/延时，不含密钥 | `verify:fast` + 实机拨测（见手测报告）；E2E 覆盖启动与配置通道 |
| 32-B 渲染层 | `src/web/hostLlm.ts`：快照改 `{usable, engines: LlmEngineView[], presets}`，`isStub` 仍为 getter（保存即热生效）；导出 `isLocalBase` 供参数页标注本地/云端；`modelsFromSnapshot` 按回环给 `{free,0}`、远端 `{cheap,0.01}`（仅路由记账） | `hostLlm` 相关页面测试 + typecheck |
| 32-B 引擎管理卡 | `src/web/params/LlmEngineCard.tsx`：预设快选 + 自定义 OpenAI 兼容引擎（名称/baseURL/模型/密钥）+ 逐引擎「测试连通」+ 排队顺序徽标 + 本地/云端标注；**拨测前先保存当前草稿**（主进程按落盘配置拨测），拨测后重拉快照刷新顺序 | typecheck/oxlint；E2E 启动冒烟；视觉需手动（jsdom 无布局） |
| 32-C 明细默认收起 | `src/core/memagent/recallInsight.ts`：新增 `buildRecallCompactMarkdown(hint)`（一行加粗摘要 + 「再调一次并置 `detail=true`」指引，零 HTML）；`buildRecallMarkdown(...,{htmlDetails:false})` 保留作明细档 | `recallInsight.test.ts`（紧凑档无 `<details>`/无小节标题/含 `detail=true`；档位矩阵） |
| 32-C 三档下发 | `src/core/memagent/mcpRecall.ts`：`RecallDisplayMode = 'html-details' | 'markdown-full' | 'markdown-compact'`，`recallDisplayMode(client, detail)`（HTML 白名单优先且忽略 detail；其余 detail→full、默认→compact）；`display.mode` 随结果下发；`detail` 非布尔 → `McpToolError(-32602)` | `mcp.test.ts`（TCP 默认紧凑 / `detail=true` 四小节 / `detail:'yes'` 报错）、`mcpHttp.test.ts`（无会话紧凑、detail=true 明细、Qoder 会话仍 `<details>`） |
| 32-C 回显口径 | `src/core/memagent/mcpHttp.ts`：`recallEchoNote(mode)` 由**本次 payload 的 `display.mode`** 选文案（单一真源）；`src/core/memagent/mcpSchema.ts`：`recall_memory` 增 `detail` 参数与三档描述，`MCP_INSTRUCTIONS` 规则 2 改三档口径 | `mcpHttp.test.ts`（末块含「默认收起」/「detail=true 的明细返回」且与 content[2] 同档） |
| 32-C 触发规则同步 | `AGENTS.md §1.1`、`CLAUDE.md`（Claude Code 落紧凑档） | 人工（新会话生效） |

> 诚实边界（批次32）：① DSH 里「展开」是 Agent **再调一次 `recall_memory(detail=true)`**，不是可点击的 UI 控件——字面点击折叠只在 HTML 客户端（Qoder 系）成立；② 排队依据是**最近一次成功拨测**的延时，不是实时健康度：长期不点「测试连通」则按列表顺序，某引擎中途挂掉仍会先被尝试再回退（一次写入最多损耗一轮超时）；③ 远端第三方引擎需要用户自填 API Key 并自行确认其计费，`{cheap,0.01}` 只是 routeProxy 的记账元数据，**不代表厂商账单**；④ 自定义引擎按 OpenAI 兼容 `chat/completions` 调用，非该协议的端点（如纯 Anthropic 格式）不在支持范围。

---

## 批次33（2026-11-01）：接入页一次登录一扫 + LLM 自定义厂商入口 + DSH 明细改道本机可点页

> 起因（用户三条反馈）：①「agent 接入配置页首次登录扫一次即可，不需要每次切页面扫」；②「LLM 精炼引擎厂商要可自定义其他厂商」→ 澄清为「你只有预设厂商没有自定义厂商，我需要添加其他厂商 API」；③「dsh 还是没有改，禁止自动上细节，只有点击的时候才可显示细节，不点击只显示前 2 行」+「DSH 看能不能有其他方式实现」。
> 拍板：①去重从 60s 窗口改按登录会话记账；②把「添加其他厂商」入口显性化并扩预设；③**DSH 气泡内联折叠实测做不到**（2026-11-01 复测 `<details>` 原样露出、连 `▶` 都没有）→ 改「聊天 2 行摘要 + 一条可点链接，点开是本机 8204 上的真折叠页」。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 33-A 扫描按登录会话记账 | `src/web/AgentOnboard/autoOnboard.ts`：`ONBOARD_AUTOSCAN_KEY='agentOnboardAutoScanSid'` + `hasAutoScannedSession/markAutoScannedSession/clearAutoScannedSession`（`autoScanStore()` 优先 sessionStorage，无则退回 localStorage）；`runAutoOnboard` 对 `trigger=login/auto` 且有 `sid` 时**起扫即标记**（失败也标）；`resetAutoOnboardState()` 三清（状态/失败快照/标记）。`AgentOnboardPage.tsx` 挂载补扫改为 `if (hasAutoScannedSession(session.sid)) return;`，删除 `AUTO_SCAN_REUSE_MS=60_000` | `__tests__/autoScanSession.test.ts`（标记落 sessionStorage、按 sid 判定、清除、reset 三清）、`AgentOnboardPage.test.tsx`（已扫过 → 宿主扫描 0 次且回填完成态；换 sid → 扫 1 次且**起扫即记账**；无会话 → 门禁不扫） |
| 33-B 预设扩到 13 家 | `src/electron/llmGateway.ts` `LLM_PRESETS`：本机 `ollama/vllm/lmstudio`（`needsKey=false`）+ 云端 `deepseek/kimi/zhipu/qwen/siliconflow/minimax/stepfun/spark/groq/openrouter`；`llmEngineViews` 原样下发给渲染层做快选下拉 | `llmGateway.test.ts`（13 个 id 顺序 + `needsKey=false` 恰为本机三家 + 序列化不含密钥） |
| 33-B 自定义厂商入口 | `src/web/params/LlmEngineCard.tsx`：卡尾「添加其他厂商 API」区（`llm-add-section` / `llm-add-custom-*`），名称+baseURL 必填才可点，提交 `llmSaveConfig({add:{name,baseURL,model}})` → 主进程 `mergeLlmConfig` 生成 `custom_*` 引擎并回默认（enabled/model/baseURL），成功后清空输入并提示可点「测试连通」真拨测；纯浏览器/无宿主 IPC 时**不渲染添加入口**并如实说明；`llm-load-failed`（主进程未返回引擎列表）带「重新读取」 | `src/web/params/__tests__/LlmEngineCard.test.tsx`（9 例：浏览器诚实态 / `{ok:false}` 错误+重载 / 抛错后重拉 / add 载荷逐字断言 / 必填门 / 预设下拉 / 空列表指引 / member 只读禁用 / 排队徽标只给可调用引擎 / remove） |
| 33-C 一次性明细票据 | **新文件** `src/core/memagent/recallDetailTickets.ts`：`RecallDetailTickets<T>`（`issue/take/size/clear`），id=`randomBytes(16).toString('base64url')`（22 字符，不可枚举），`RECALL_DETAIL_TTL_MS=30min`、`RECALL_DETAIL_MAX_TICKETS=200`；`evict()` 先清过期再按插入序淘汰最早；`take()` 不消费（TTL 内可重复打开），过期当场回收；**纯内存，明细正文不进数据根** | `__tests__/recallDetailTickets.test.ts`（id 形态/唯一性、TTL 边界含 `=TTL` 判过期、重复打开与 clear 不可恢复、上限淘汰、泛型 payload） |
| 33-C 明细页渲染 | `src/core/memagent/recallInsight.ts`：`buildRecallSections(result, hint, price, clip, maxChars=120)` 成为四段**唯一生产者**（聊天 Markdown 与页面同源）；`buildRecallDetailPage(sections, meta)` → 真 `<details>`（`summary{list-style:disclosure-closed}` + `details[open]…disclosure-open` = 黑三角）+「全部展开/收起」+ 深浅色 `prefers-color-scheme`，正文按 `clipChars`（默认 400）截断并 `htmlEscape`，页脚写有效期/同源/金额非厂商账单/令牌不出现在 URL；`buildRecallDetailExpiredPage()` 给诚实 404；`buildRecallCompactMarkdown(hint, detailUrl?)` 有链接时输出 `▶ [展开本次召回明细（…）](url)` 且**不再**要求调 `detail=true`；摘要 `hint.shortLine` ≤2 行（今日/全部金额明细移到页面，`hint.line` 保留全量） | `recallInsight.test.ts`（shortLine 两行结构与 priced/未定价文案、`detail=true` 兜底档、带链接档、旧记录告警行、档位矩阵；明细页 4 段/无 `open`/展开按钮/`sum` 两行逐字/截断转义/sections 标题与金额口径/过期页） |
| 33-C HTTP 路由 | `src/core/memagent/mcpHttp.ts`：8204 同一监听器新增 `GET /recall/<id>`（白名单正则 `/^[A-Za-z0-9_-]{16,32}$/`），仍过 `rejectUntrustedHost`；命中→`text/html` + `Cache-Control: no-store` + `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` + CSP `default-src 'none'; style/script 'unsafe-inline'; img/frame-ancestors/form-action none`；未知/过期→404 失效页；`opts.onViewDetail('ok'|'miss')`。`mcpRecall.ts` 在 `markdown-compact` 档签票据并下发 `display.detail_url`（TCP 8202 无 base → `null`）；`main.ts` 把观测落 `mcp:recall_detail_view` 动作日志（只记 outcome） | `mcpHttp.test.ts`（摘要含 `/recall/` 链接 + `detail_url` 一致、真 GET → 200 与加固头、伪造 id → 404、带 `Origin` → 403、伪造 `Host` → 403、页面与摘要 `not.toContain(TOKEN)`） |
| 33-C 口径同步 | `src/core/memagent/mcpSchema.ts`（三档指令 + `detail` 参数描述）、`mcpHttp.recallEchoNote('markdown-compact')`（「默认收起 + 点击展开 / URL 必须逐字保留 / 禁止自行补写 / 不要因为觉得更完整就调 detail=true」）、`AGENTS.md §1.1/§3/§9`、`CLAUDE.md` | 人工（新会话生效）+ `mcpHttp.test.ts` 末块文案断言 |

> 诚实边界（批次33）：① 33-C 的「点击展开」发生在**系统浏览器/新窗口**，不是 DSH 气泡内联——内联黑三角在该客户端做不到；② 明细页只在内存票据里，**30 分钟后链接失效且不可恢复**，届时退回 `detail=true`；应用重启后旧链接必失效；③ TCP 8202 与无 base 地址场景 `detail_url=null`，仍是「摘要 + 再调一次工具」；④ 纯文本渲染客户端链接不可点但 URL 逐字可见可复制；⑤ 33-A 标记「起扫即记」，本轮失败后切页不再自动重试，需点「🔍 手动检测」；关掉窗口/重启后标记清空，恢复会话仍补扫一轮；⑥ 33-B 的新增引擎仅管理员（`llm:configSet` 主进程校验），添加后必须点「测试连通」才有延时参与排队；⑦ 明细页正文截断长度默认 400 字，长记忆看聊天 `detail=true` 档或原记忆条目。

## 批次34（2026-11-01）：「测试连通」与「启用」解耦 + LLM 动作日志落对文件

> 起因（用户反馈）：「LLM精炼引擎配置key后测试连通都连不通，本地OLLAMA也连不通」。真因不是网络：`llm-config.json` 四个引擎全部 `enabled:false`，而 `testEngine()` 第一条检查就返回「X 未启用」，**一条 HTTP 都不发**（动作日志 `[ipc:llm:test]` 只有 `ms:7~11`；`curl 127.0.0.1:11434/api/tags` 200 且列出 `qwen2.5:7b`）。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 34-A 拨测不再要求启用 | `src/electron/llmGateway.ts` `testEngine`：删除 `if (!eng.enabled) return 'X 未启用'`；其余前提保持（未找到引擎 / 未填模型名 / `needsKey` 且无密钥 → 快速诚实失败、不发请求）；`EngineTestResult` 增 `enabled?: boolean` 回显。**精炼语义不变**：`callOrder()` 仍要求 `enabled`，不勾启用绝不参与 L2–L6 | `llmGateway.test.ts`（未启用照样真拨测：`ok=true` + 有延时 + mock 服务器确实收到该引擎请求 / 三条快速失败仍不发请求 / 其它前提不放宽） |
| 34-B 结果与文案打通到参数页 | `src/electron/preload.ts`、`src/web/params/llmEngine.ts` 的 `LlmTestResult` 带上 `enabled`；`src/web/params/LlmEngineCard.tsx`：连通但未启用时结果写「✅ 连通（Nms）—— 但尚未勾选「启用」，勾选后才会参与精炼排队」，卡片说明改为「测试连通不要求先勾选启用」 | `LlmEngineCard.test.tsx`（未启用引擎的按钮仍可点且不误写草稿 / `enabled:false` 回显含「尚未勾选」/ `enabled:true` 不回显） |
| 34-C LLM 事件落 `actions.log` | `src/electron/main.ts` §6d：`llm:configSet` 与 `llm:test` 由「只 `mlog()`（落 `main.log`）」改为 `mlog()` + `actionLog('llm', …)` 双写；`src/web/Home/programLogLabels.ts` 补 `llm:config-saved` / `llm:test-engine` 中文标签 | **无单测**（`main.ts` 的 IPC handler 不在 vitest 覆盖内，依赖真 Electron 宿主）；验证方式=装完后在参数页点保存/拨测，再 `rg "\[llm:test-engine\]" <数据根>/actions.log` 与日志记录页看中文行（见批次34 手测报告步骤） |

> 诚实边界（批次34）：① 解耦只针对**拨测**，不改变精炼门槛——未勾选启用的引擎即使连通也不参与 L2–L6；② 拨测成功但没勾选启用时，排序徽标仍不出现（这是 `callOrder` 的既有口径，非缺陷）；③ 批次31/32/33 手测报告曾写「`actions.log` 有 `llm:config-saved` / `llm:test-engine`」，实测当时 0 命中（只落 `main.log`），已在各报告原位标注校正；④ 本机 `zhipu` 的 `baseURL` 被用户手工填成 `https://open.bigmodel.cn/api/v1`（正确预设值 `https://open.bigmodel.cn/api/paas/v4`），`deepseek`/`openrouter` 尚无密钥——这些是配置数据问题，代码不做语义猜测、不代改；⑤ 毫秒级返回的拨测结果等于「本地校验挡的、没发请求」，排障先看动作日志 `ms`。

