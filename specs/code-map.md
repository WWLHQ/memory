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
- 测试 `src/**/__tests__/*.test.ts(x)`；命令 `npm run typecheck`（tsc strict）+ `npm run lint`（oxlint）+ `npm test`（vitest **149 文件 / 1754 例**，2026-11-04 41-T 轮实测；每批都变，以 `npm run verify:fast` 输出为准）+ `npm run test:e2e`（Playwright **22 个 spec / 106 例**，`ls e2e/*.spec.ts` 现查） |
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
| 动作日志（渲染层/宿主桥） | `src/web/shared/actionLog.ts`（`uiLog` + 自动捕获 click/submit/change/error/page_view；由 20 个页面入口 `import '../shared/actionLog.ts'` 安装）、`src/desktop/hostBridge.ts`（`hostLog` / `log:write`）、`src/electron/preload.ts` | `src/desktop/__tests__/hostBridge.test.ts` + E2E |
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
| 规则单一真源 | `src/core/memagent/layerRules.ts`：`LAYER_ORDER`、`LAYER_SPECS`、`DEDUP_THRESHOLDS`、`DEDUP_WEIGHTS[_NO_LLM]`、`L0_POLICY`、`MIN_MEANINGFUL_CHARS`、`sanitizeL1`、`meaningfulLength`、`checkLayerSpec`（**批次40 起另加 `DEPTH_CAP_BANDS`/`depthCapFor`/`targetLayers`/`layerBand`/`checkLayerSpecDetailed`/`headlineLayer`/`MIN_MEANINGFUL_WITHOUT_FACTS`，见批次40 小节**） | `src/core/memagent/__tests__/qualityGate.test.ts`（脱敏/门禁/规格）、`refine.test.ts`「每层生成规格」describe |
| L0→L1 质量门 | `src/core/memagent/qualityGate.ts`（`checkL0ToL1Quality`：空/占位/无信息量/过短拦截，规则引用 layerRules；**批次40-B 起 `QUALITY_GATE_VERSION=3` + 码 `short_low_signal`：有效字 <30 且无硬事实且无技术证据 → 入库即拒**） | 同上 |
| 逐层生成 → 校验 → 查重 → 嫁接停止 | `src/core/memagent/memories.ts`（`coreWrite`：L0 seal 前置、L1 本地脱敏、`makeLayerGenerator` 逐层、命中即 `graft_to/graft_layer` 并停止；目标只刷新 `grafted_from/confidence/version`） | `src/core/memagent/__tests__/refine.test.ts`、`contract.test.ts` |
| 五维查重与逐层阈值 | `src/core/memagent/dedup.ts`（`findDuplicate`、权重归一化、`DEDUP_THRESHOLDS`） | `refine.test.ts` |
| L0 密钥环与连续会话 | `src/core/memagent/l0vault.ts`（`L0Vault`：v2 信封、`admin_wrap`、一次性 grant、5min 空闲 + 60s 心跳、5 次错误 15min 锁、启动/锁屏/休眠/退出清理、全有或全无解密、幂等迁移 `sweep/onAppRestart/onSecurityLock/onExit`） | `src/core/memagent/__tests__/l0vault.test.ts` + `l0Kit.ts` |
| 加解密与包裹 | `src/core/memagent/crypto.ts`（`encryptL0WithKey/decryptL0WithKey`、`wrapSecret/unwrapSecret`、`deriveKek`、`generateDek`、`MASK`）；`types.ts`（L0 端壳端口/审计类型、graft 字段） | `l0vault.test.ts` + `qualityGate.test.ts` |
| 端壳 IPC（18 通道） | `src/electron/ipcChannels.ts`（`IPC.l0*`）→ `preload.ts`（`window.api.l0`）→ `src/desktop/hostBridge.ts`（`HostMethod`/`CHANNEL_TO_NATIVE`）→ `src/web/shared/l0Port.ts`（`HostL0Port/HostL0Admin`）→ `src/web/kernel.ts`（注入 MemAgent `l0*`） | `src/electron/__tests__/ipcChannels.test.ts`、`src/desktop/__tests__/hostBridge.test.ts` |
| 主进程编排 | `src/electron/main.ts`：`registerL0Ipc`（管理操作 `requireAdmin` + 会话归属校验）、`l0-keyring.json` 原子写、`onAppRestart`、30s `sweep`、`powerMonitor` 锁屏/休眠、退出清理、迁移前备份 `backups/l0-migrate-<ts>/` | 手测 + `npm run typecheck` |
| 管理 UI | `src/web/security/L0AdminCard.tsx`（状态/设置/轮换/写密钥/申请审批/发放/撤销）、`src/web/security/L0MigrateCard.tsx`（批次38：§4.4.6 旧数据迁移从管理卡拆出单独成卡）、`SecurityPage.tsx`、`coreSecurity.ts` | `src/web/security/__tests__/SecurityPage.test.tsx`、`__tests__/L0MigrateCard.test.tsx` 8 例 |
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
| MCP 指令下发 + 工具 | `src/core/memagent/mcpSchema.ts`：`MCP_INSTRUCTIONS` + 4 工具（recall/write/list_projects/get_preferences）；`mcpRecall.ts`：`resolveProjectId`（显式→唯一项目自动→0/多项目报错）、`runRecallTool`、`runListProjectsTool`（排除 P_SYSTEM/墓碑/合并影子） | `mcpHttp.test.ts`、`mcp.test.ts`（含空账本/多项目/非字符串 project_id/单价/累计） |
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
| 数据同源 | `mcpRecall.ts`：`display.markdown` 与 `display.line` 由同一次 recall + 同一份 `recall` 审计累计生成；批次29 `clientSupportsHtmlDetails(client)` 白名单（批次41-Q 扩为 `{qoder, qoder-desktop-mcp-host}` → HTML 版，其余 fail-safe 纯 Markdown）；**批次32 起非 HTML 客户端默认只给一行摘要**（见批次32 段） | `mcpHttp.test.ts`（无会话紧凑档 / Qoder 会话 `<details>`）、`recallInsight.test.ts`（白名单含 41-Q 正反例 + 档位矩阵用例） |
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
| T15 | 真实链路 E2E + 真浏览器点击级 | `e2e/app.spec.ts`（Playwright，指向 `dist/` 真实构建产物；批次26 起起真实 home 后端 + admin 登录） | `npm run test:e2e`（**22** 个 spec，`workers=1`） |
| T16 | Webhook 入口 HTTP 服务 | `src/electron/webhookServer.ts` : `createWebhookHttpServer`（批次26 P0-4：全请求 mcp-token 鉴权、1 MiB body 上限、status/hash 只回 id+状态） | `src/electron/__tests__/webhookServer.test.ts` |

> 全量命令：`npm run verify` = `verify:fast`（`typecheck` → `lint` → `test:coverage`，**149 文件 / 1754 例**，2026-11-04 41-T 轮实测）→ `build:electron` → `test:e2e`（先 `vite build`，再 Playwright 22 个 spec / 106 例；静态服务与后端均用系统分配端口）。
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

## 批次35（2026-11-01）：无意义会话禁止入库（质量门收紧 + 采集器只采用户 + 整库清空重采）

> 起因（用户反馈 + 10 张截图）：「这些没有意义的会话记录怎么都放行入库了」。本机账本 1642 行逐条回放实测：
> **助手自述/能力清单/过程旁白**共 22 条以「带产品名/版本号就算有技术证据」的旧口径漏网，另有裸 IPv4、单个 emoji 等 13 条形态问题。
> 结论分三层：判定层（质量门规则本身有漏网口径）、结构层（采集器把助手消息一起入库）、历史层（已落库的行收不回来）——本批次三层各收一次。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 35-A 判定前先剥 Markdown 装饰 | `src/core/memagent/qualityGate.ts`：新增 `DECOR_RE`/`stripDecoration(text)`（`**`/`__`/`~~`/行内反引号/`#` 标题/`>` 引用/表格竖线/`—–` 破折号 → 空格；`[文案](链接)` → 文案；只压水平空白，保留换行给清单判定）。旧漏网头号原因：`**需求分析**` 里的 `*` 自己充当了「代码符号证据」 | `qualityGate.test.ts`（批次35 describe：`**Claude Code** + Haiku 4.5 + 模型 ID` 三行整段拦 / 能力清单原样拦） |
| 35-B 证据判定去停用词后再看符号 | `TECH_STOP` 扩厂商与通用 IT 词（`anthropic/openai/haiku/…/code/cli/api/sdk/ide/ui/app/web/tool/official/version/flash/pro/max/mini`）；`hasTechEvidence` 先把停用词从文本里摘掉，再用 `LOOSE_SYM_RE`（**只匹配两侧空白的排版符号**，贴着字的 `E_AUTH`、`D:\tmp` 仍算证据）；扩展名表补 `kts/html?/css/scss/svg`。「网站 / 桌面应用」的斜杠不再是证据 | `qualityGate.test.ts`（能力清单段 / 身份自述段 / 11 条硬事实正例必须放行） |
| 35-C 硬事实豁免（段级） | 新增 `HARD_FACT_RES`+`hasHardFacts`：错误码 `E_AUTH`、`key=0.767` 实测数值、带单位数值/端口/条数、函数调用 `apiData()`、命令行、带扩展名的文件名/路径、状态码；**刻意不含裸版本号与裸产品名**（「我是 Claude Haiku 4.5」里的 `4.5` 是自述不是事实）。身份段/清单段/旁白段只有在**全段无硬事实**时才整段拦 | `qualityGate.test.ts`（`T15 PASS … a=0.767 b=0` / `L6 14/14 … EXIT=0` / `build.bat 的 for 循环 %%i` / `SolidWorks 版本是 2020 SP5（内部版本 28.5.0）` 全部放行） |
| 35-D 过程旁白按整句判 | `NARRATION_RE`（我先看/接下来检查/现在写/我换用 X 工具/让我先…）+ `NARRATION_STATE_RE`（能用了/跑通了/已就绪/报错是噪音）+ `NARRATION_DONE_RE`（X 完成）+ `NARRATION_SELFOP_RE`（更新记忆/HANDOVER/跑 selftest/标记待办）+ `NARRATION_REMARK_RE`（≤24 字的「输出捕获有点问题」）；口径 = **同一行每个句子都是元信息**才拦（`sentences.every(isMetaSentence)`），`NARRATION_GUARD_RE` 认出「请/务必/不要/必须/确保/尽量…」是**要求**而非旁白，直接放行 | `qualityGate.test.ts`（16 条旁白必须拦 + 「Token 硬上限…一定要保证效果」「测试已补喵~」等指令句必须放行） |
| 35-E 采集器只采用户消息 | `src/core/memagent/sessionCollector.ts`：`SessionLogSource.roles?` + `DEFAULT_COLLECT_ROLES=['user']`（缺省白名单，源不声明就只采 user）；`ScanResult.roleSkipped` 可观测计数；jsonl/zstd 循环在算哈希前跳过非白名单角色；分块解析源先 `parse` 再按角色过滤（**游标 `msgIndex` 索引的是过滤后数组**）；`parseClaudeJsonl` 对 `isMeta:true` 直接返回 null；`defaultAgentSources` 里 **WorkBuddy 显式 `roles:['assistant']`**（其日志整篇是 `##` 任务分块，按用户口径保留） | `sessionCollector.test.ts`（30 例：首次全量只采 user + `roleSkipped=1` / `isMeta` 跳过 / 预设源缺省 undefined 且实测只采 user / workbuddy 声明与反证「不给 roles 则 collected=0」）、`dshZstdCollector.test.ts`（端到端 `collected=1 roleSkipped=1`，显式放开 roles 才两条都采） |
| 35-F 拦下有计数不静默 | `ApplyScanResult` 增 `filtered`（`dedup.action==='filtered'` 单列）；`main.ts` 采集回执 `console.log`/`collectorStatus` 带 `filtered`，`lastApply` 经 IPC 暴露 | `sessionCollector.test.ts`（new/duplicate/filtered 三态计数 + 三类都写审计） |
| 35-G 整库清空重采 | **新文件** `src/core/memagent/ledgerReset.ts`：`scanLedgerForReset`（只读：条数/层级/来源/L0 密文数/真实 LLM 产物数/墓碑数/样本 id）+ `purgeLedger`（逐行 `deleteMemory` + 向量 `remove`，一批一次落盘，单行失败不中断并计数，写 `security_change/op='ledger_purge'`；**强制 `backup_confirmed:true` 且要求 `admin_user_id`，缺任一抛错且不动数据**）→ `ipcChannels.ts` `ledgerResetPreview/ledgerResetRecollect` → `main.ts` §采集区（顺序=**备份 → 清空 → 游标归零 → 后台追采**；`backupBeforeKernelChange('ledger-reset')` 另拷 `collector-cursor.json`；确认口令必须逐字 `RESET`；`runRecollectCatchUp` 最多 80 轮、单轮仍钳 50 条、轮间让出 300ms）→ `preload.ts` `ledgerReset.{preview,run}`（`collector.status` 返回值补 `last/apply/recollecting`）→ `desktop/hostBridge.ts` 两条通道 → 新卡片 `src/web/security/LedgerResetCard.tsx`（预览/口令门禁/回执/游标写失败警告/追采进度轮询）挂在 `SecurityPage.tsx` | `ledgerReset.test.ts`（6 例：预览不改数据不写审计、删光含墓碑+向量摘除+审计成对、无管理员/无备份拒绝且不删一行、单行失败回显 `failed_ids`、空库幂等）、`LedgerResetCard.test.tsx`（9 例：浏览器诚实不可用/非管理员不预览/口令禁用/逐字断言 `('RESET','s_test')`/回执含备份路径与 `security_change`/游标失败警告/拒绝无成功回执/空库无按钮/IPC 抛错不装干净） |
| 35-H 日志标签 | `src/web/Home/programLogLabels.ts`：`kernel:ledger:reset-backup`/`-backup-fail`/`-rejected`/`-recollect` 四条中文标题 + `ledger:resetPreview`/`ledger:resetRecollect` 通道说明 | `programLogLabels.test.ts`（既有 10 例仍绿；新标签为纯映射，人工按手测报告在日志页核对） |

> 诚实边界（批次35）：① **质量门无法凭措辞区分用户与助手**——「让我先看一下配置」既可能是助手旁白也可能是用户的要求，所以结构性修复是采集器角色白名单，旁白规则主要保护 MCP `write_memory` 与手动改写这两条没有角色信息的入口；② 判定仍是启发式，接受少量漏网（实测「collect 幂等通过…」「A5 全绿。标记任务完成。」因带硬事实/指令语气仍会入库），取向是**宁可放过不可错杀**，不做语义猜测；③ WorkBuddy 例外是显式声明的（`roles:['assistant']`），若不接受该源噪声，最小裁剪=删掉这三行声明，其 323 条日志即整体不再入库；④ 整库清空**不可逆**，唯一退路是执行前自动备份目录（回执原样给出路径），真实 LLM 精炼产物删了不会自动重生成，预览会点名条数；⑤ 追采单轮 50 条、最多 80 轮（≈4000 条），历史会话超出部分由 5 分钟周期继续补齐，不是丢数据；⑥ 游标文件写失败时内存游标已归零、本次重采照常，但**应用重启后会退回旧游标**，卡片会显式警告；⑦ 清空只动 `memories.db.json` 的记忆行与进程内向量索引，不动 L0 密钥环、审计历史与账号数据。

## 批次36（2026-11-01）：入库规则更新后的存量处置（规则版本戳 + 只读回放 + 存量重判）

> 起因（用户追问）：「以后入库规则有更新后应该怎么处理？」以及「我说的删除库只是删除 L1–L6 的库，不用重新读，直接从 L0 重新生成」。
> 回放本机账本得到的硬事实决定了技术路线：**1642 行里带 `content_orig` 的有 1641 行，而且是明文原文（5.78 MB / 全库 21.15 MB，其中 684 行与脱敏后的 L1 不同）；`content_l0_enc`（v2 信封）0 行、真实 LLM 精炼产物 0 行、缺 L1 0 行**，
> ~~数据根没有 `l0-keyring.json`（L0 从未初始化）~~ → **（2026-11-02 再校正）**本机实测：`l0-keyring.json` **存在**（2026-11-01 17:06 UTC+08:00 由批次37 之前的 `l0:setup` 建好，`v:2`、`admin_wrap` 有、`grants`/`requests` 各 0、**`recovery_wrap` 没有**），但 `memories.l0.json` **不存在**、全库 v2 信封 **0 行** → L0 键环立着了、可它保护的密文一份都还没有。结论不变：**重新入库要先解锁 L0 写密钥（§4.4.4）**，存量搬家要先封存。
> **（2026-11-02 校正）**本段原写「`content_orig` 0 行」是错的，实测 1641 行；所以「从 L0 重新生成」**原料是在的**（明文原文），当时选「按当前规则重判」是因为它**不需要 L0 密钥、不需要 LLM、不动游标**，不是因为没料。
> 「按 L0 重建 L1–L6」随批次37（拆库 + L0 密钥初始化）一并落地。
> 用户当时拍板：写入**保持现状**（不解锁就拒写），存量走「不需要解锁、不需要 LLM」的**按当前规则重判**，并把它做成常态能力。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 36-A 规则版本戳 + 稳定拦截码 | `src/core/memagent/qualityGate.ts`：`QUALITY_GATE_VERSION = 2`（**改判定口径必须 +1**）+ `QualityBlockCode`（`empty/thin/greeting/separator/empty_heading/decoration/bare_link/bare_json/bare_number/comment_only/import_only/require_only/meta_question/identity/capability_list/disclaimer/narration`，中文 `reason` 可随版本改写、码不动）；`QualityCheckResult.code`、`NOISE_PATTERNS` 每条带码、`metaReplyReason` 返回 `{code,reason}`、`filteredAuditDetail(raw, result)` 输出 `filter_code` + `gate_version`。`types.ts` 新增 `Memory.quality_gate_v?: number`，由 `memories.ts`（写入）、`coreMemoryOps.coreUpdateContent`（手动改写）、`forgetting.buildSummary`（摘要行）三处盖章；**历史行无字段一律按 v1** | `qualityGate.test.ts` 34 → 37 例（码稳定性表 `empty/bare_number/bare_link/comment_only/import_only/bare_json/meta_question/narration/identity`、`unspecified` 兜底、放行不发码；并固化「短寒暄先撞上 `thin`，不是 `greeting`」的真实顺序） |
| 36-B 只读回放器 | **新文件** `tools/rejudge-dry.mjs`（`package.json` 的 `npm run rejudge`）：全程 `readFileSync`、零写操作，末尾原样声明「本次只读，未写任何文件」；数据根解析 `--file > --root > data-root.json 指针 > 默认根`；**直接 `import()` 生产 `qualityGate.ts`**（Node ≥ 24 原生跑 `.ts`），回放与入库同一份规则；只喂 `content_l1`（缺失才退 `content`），不解密 L0；输出总数/墓碑/缺 L1/按行版本戳/放行/拦下/受保护/可删/码分布/层级分布/样本，`--code` `--limit` `--json` 可控 | 本机实测（2026-11-01 17:40 UTC+08:00）：`1642 / 墓碑 0 / 缺 L1 0 / v1:1642 → 放行 1585、拦下 57`，码分布 `narration 36 · thin 17 · identity 3 · capability_list 1`（全部原 L1），受保护 0，**可删 57** |
| 36-C 存量重判（内核 + IPC + UI） | **新文件** `src/core/memagent/rejudge.ts`：`scanRowsForRejudge`（只读预览：应删/受保护/需重盖戳/码分布/行戳分布/样本）与 `rejudgeRows`（应删行 `deleteMemory` + 向量 `remove` + **每行** `memory_op/op='rejudge_purge'`；放行行只重盖 `quality_gate_v`，正文/层级/`version`/向量不动；`pinned`/`locked` 命中也不删只计数；缺 L1 不判定不删；单行失败不中断并回显 `failed_ids`；整轮 `security_change/op='rules_rejudge'`；**强制 `backup_confirmed` + `admin_user_id`**）。预览与执行共用同一 `decide()`，回执数字与预览必然一致 → `ipcChannels.ts` `rules:rejudgePreview`（需会话）/ `rules:rejudgeRun`（需管理员 + 逐字 `REJUDGE`）→ `main.ts` §采集区（`backupBeforeKernelChange('rules-rejudge')`，备份失败直接拒绝；`actionLog('kernel','rules:rejudge-run',…)`）→ `preload.ts` `rulesRejudge.{preview,run}` → `desktop/hostBridge.ts` 两条通道 → 新卡片 `src/web/security/RulesRejudgeCard.tsx` 挂 `SecurityPage.tsx` | `rejudge.test.ts`（11 例：预览不改数据不写审计 / v1 归因 / 缺 `content_l1` 退回正文 / 删行+摘向量+双份审计 / 放行只盖戳且 `version` 不变 / pinned+locked 保留 / 缺管理员拒绝 / 缺备份拒绝且零审计 / 单行失败回显 `failed_ids` / 幂等且预览数字与回执一致 / `filter` 只作用指定项目）、`RulesRejudgeCard.test.tsx`（9 例：浏览器诚实不可用并指路 `npm run rejudge` / 非管理员不预览 / 真值回显含码分布与「受保护」 / `REJUDGE` 口令门禁 / 回执含备份路径与两类审计 / 备份失败原样显示无成功回执 / 干净态无按钮 / 只剩盖戳仍可执行 / IPC 抛错不装干净） |
| 36-D 日志标签 | `src/web/Home/programLogLabels.ts`：`kernel:rules:rejudge-backup`/`-backup-fail`/`-rejected`/`-run` 四条中文标题 + `rules:rejudgePreview`/`rules:rejudgeRun` 通道说明 | 纯映射；手测报告要求在日志页按中文标题核对 |

> 诚实边界（批次36）：① **口径分工要记牢**——判定规则变→重判（本节，不需 L0 写密钥、不调 LLM、不动采集游标）；采集规则变（角色白名单那类）→清空重采（批次35）；两者都变→先重判再补采；② 重判**不产生新 L0、不改 L1–L6 正文**，所以它不会把「助手侧结论」补回来，删除不可逆，唯一退路是回执里的备份目录；③ 预览与执行之间若有新写入仍会有差，卡片每次执行前重拉预览；④ `pinned`/`locked` 与缺 L1 行一律保留（后者是批次24/28-C 遗留账本清理的职责，本模块不猜）；⑤ 回放器依赖 Node ≥ 24 直接跑 `.ts`，纯浏览器模式无主进程 IPC，卡片如实不可用；⑥ 用户提的「L0 与 L1–L6 拆两个文件存储」是独立改造，**本批次未做**，已立项为批次37（拆库 + 首启强制选两个库位置 + L0 管理密码 + 双库备份 + 按 L0 重建 L1–L6）——**批次37 已于 2026-11-02 落地，见下一节**。

---

## 批次37（2026-11-02）：L0 与 L1–L6 拆成两个库文件 + 首启强制选位置 + 双库备份 + 恢复码找回 + 按 L0 重建

> 起因（用户原话）：「执行36-D「L0 与 L1–L6 拆两个库文件」，软件首次启动需强制用户指定L0库和L1-L6库位置，并且L0库和L1-L6库要增加备份功能」；追问「原数据库最好搞成密码忘记可找回的渠道，数据是宝贵的万一忘记密码数据就废了损失比较大」；加上批次36 就挂在那儿的口径「我说的删除库只是删除 L1–L6 的库，不用重新读，直接从 L0 重新生成」。
> 五项拍板（AskUserQuestion）：① 升级上来的老指针**也走强制向导**；② 粒度=**原数据库与记忆库各自选目录，可同目录也可分开**；③ 首启**强制先设 L0 管理密码**；④ 按 L0 重建的入口**一起做**；⑤ 找回机制=**恢复码 + 恢复卡**，码**一次性**（用过即当场换新码、新卡必须重新导出），且**必须先导出一张卡才算走完向导**。
> 拆库前本机账本的硬事实（决定了技术路线，2026-11-02 实测）：`memories.db.json` 1642 行里 **1641 行带明文 `content_orig`（≈5.78 MB）**、`content_l0_enc`（v2 信封）**0 行**、`has_l0` **0 行**、**没有 `memories.l0.json`**；`l0-keyring.json` **已存在**（2026-11-01 17:06 UTC+08:00 由批次37 之前的 `l0:setup` 建好：`v:2`、`admin_wrap` 有、`grants`/`requests` 各 0、**`recovery_wrap` 没有**）→ 键环立着了、它保护的密文一份都还没有，所以**存量搬家必须先解锁 L0 写密钥**，而本机向导的「设 L0 管理密码」这一步会按真值回显成「已设过」，只剩「重新发码 + 导出这张卡」。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 37-A L0 独立库文件（真正的「拆库」） | **新文件** `src/core/memagent/l0Store.ts`：`L0BlobStore` 接口 + `FileL0BlobStore`（文件格式 `{version,items:{[mem_id]:{envelope,sealed_at}}}`、0600、`isSealedL0` **只放行 v2/v1 信封，明文写入直接抛 `L0NotSealedError`**；文件读不动抛 `L0StoreCorruptError`（原件改名隔离 + 落 `kernel:l0:store-corrupt`，绝不静默当空库）；被别的进程持有抛 `L0StoreLockedError`）+ `InMemoryL0BlobStore`（单测/纯浏览器）。`fileStorage.ts` 新增 `l0?: L0BlobStore` 选项与 `l0Store` getter：写入时把行上的 `content_l0_enc` 搬进 L0 库、行上只留 `has_l0: true`；删行/清 L0 时同步删密文不留孤儿；**行说有自己的 L0 而库里没有 → 显式断链错误，绝不当空正文返回**。IPC `l0:blobs`（需会话）批量回读密文，解密仍只走 `l0:unlock` + `l0:decrypt`（浏览/检索路径永远拿不到明文）；渲染层只读门面 **新** `src/web/shared/l0BlobStore.ts`（`getAll` 一次取完整库、不解密不缓存正文，写/删/枚举一律显式 `E_NOT_IMPLEMENTED`——渲染层永远不是 L0 库的写者），由 `src/web/kernel.ts` 注入内核 browse | `l0Store.test.ts` 27 例（三条红线逐一钉死：只收密文 / 两库都不静默空库 / 断链显式报错，另含 browse 双源信封）、`l0BlobStore.test.ts` 6 例（渲染层只读、写删显式拒绝） |
| 37-B 首启强制向导（第 20 个入口） | 新入口 `setup.html` + `src/web/setup/SetupPage.tsx`/`setupEntry.tsx`。**门禁判据在主进程，页面只是载体**：`main.ts:276` `isWizardIncomplete()` = `!isSetupComplete(pointer)`（指针里的 `ledgerDir` + `l0Dir` + `setupDone`），`main.ts:281` `mainWindowUrl(staticPort, wizardFirst)` 向导没走完直接进 `setup.html`；`chooseLibraryDir(s)` 用原生对话框分别选两个库的目录（**取消 = 诚实退出，不塞默认值、不带半配置继续启动**）。`registerSetupIpc`（`main.ts:1967`）六条通道 `setup:state / reselectDirs / setL0Password / regenCode / exportCard / finish`：不设会话，换成更硬的本机判据——设密码只在**密钥环尚无 `admin_wrap`** 时允许、`finish` 只在**本次真导出过一张恢复卡**才落 `setupDone`、卡面走主进程原生「另存为」（不落数据根）。改选目录后由 `adoptLibraryFilesIntoPlace` 把库文件核对/补送到新目录（不删源），**路径在 `app ready` 前解析，改完要重启才生效**。preload `setup.*`（`preload.ts:171-176`）→ `hostBridge.ts` 六条通道 | `SetupPage.test.tsx` 14 例（进度一律按 `setup:state` 真值回显；恢复码明文只在发码那一次显示，主进程说不回显时页面绝不编一个；三步没走完「完成设置」不可点；主进程拒绝就原样显示原因、绝不跳主界面）、`setupEntry.test.tsx` 2 例、`dataRoot.test.ts` 20 例（`resolveLibraryPaths` / `isSetupComplete` / 老指针兼容读取）、**`e2e/setup.spec.ts` 12 例（批次37-H 补记：跑真 dist 产物——不打桩验诚实降级，打桩 `window.api.setup.*` 验三步闸门/发码只显一次/导出/finish 真导航，桩逐条镜像 `main.ts` §6e 的返回与拒绝文案；已用变异验证过它不是永远绿）** |
| 37-C 存量搬家（明文 `content_orig` → L0 库） | **新文件** `src/core/memagent/l0Split.ts`：`scanLedgerForSplit`（只读预览）/ `splitLedger`（执行）——**明文必须先经 L0 写密钥封存成 v2 信封才许搬**，没解锁就整轮拒绝；行上已有的 v1/v2 信封原样搬家（**不重封**，重封要旧密码，那是 `l0:migrate` 的活）；解析不出的既不搬也不删；完整性核对（孤儿/断链）如实点名，单行失败不中断整轮，再跑一遍幂等零写盘，审计成对且不含正文。IPC `l0:splitPreview`（需会话）/ `l0:splitRun`（需管理员 + 逐字 `SPLIT` + `backupBeforeKernelChange('l0-split')`）→ 卡片 `src/web/security/L0SplitCard.tsx` | `l0Split.test.ts` 9 例、`l0SplitFile.test.ts` 4 例（跑在**真实两个文件**上：拆完的记忆库文件里搜不到一个字节原文 / 行只留 `has_l0` 可检索正文不动 / v1 信封原样搬家 / 重开两文件后查阅能取回原文）、`L0SplitCard.test.tsx` 11 例 |
| 37-D 双库备份 | **新文件** `src/electron/backupFiles.ts`（纯函数配方，主进程与单测同一真源）：三前缀 `memories-`（记忆库）/ `meml0-`（L0 原库）/ `l0key-`（密钥环）+ 同一时间戳；`planBackupFiles` 只收真实存在的源、缺哪个就在回执里明说缺哪个；`selectBackupsToDelete` **每个前缀各留 keep 份**（互不挤占）；`tsOfBackupName` / `sortBackupsNewestFirst` 按时间戳段排序（三类前缀长度不同，整串排会让一个库独占榜单）。接线：`main.ts:624` `backupPaths()`、`:640` `runBackupOnce`、`:982` `backupBeforeKernelChange(dirPrefix)`（重判 / 清空重采 / 存量拆分 / 按 L0 重建 / L0 迁移全部先备份，**备份失败直接拒绝**）；参数页 `KbManagementCard.tsx` 显示两个库的真实路径与三类备份历史 | `backupFiles.test.ts` 10 例（只备记忆库 = 不完整备份 / 份数按库分算 / 历史按时间戳段排） |
| 37-E 按 L0 重建 L1–L6（「删的只是 L1–L6 那份库」） | **新文件** `src/core/memagent/rebuild.ts`：`makeL0Reader`（原文**只有两条来源**——行上历史明文，或经**管理员的 L0 查阅会话**解密；四类取不到原因码 `no_source / broken_link / view_locked / bad_envelope`）、`scanRowsForRebuild`（预览）、`rebuildLayersFromL0`（执行：原文 → `checkL0ToL1Quality` → 新 L1 →（可选）逐层 L2–L6 过 `checkLayerSpec` → 重算 `sha256` / `embedSync(L1)` 向量 / `layer_specs` / `layers_generated_at` / `quality_gate_v`）。管道函数 `makeLayerGenerator` / `buildL6Input` / `layerSpecsFrom` 由 `memories.ts` 导出复用，**与正常写入同一条管道，不复制实现**。IPC `l0:rebuildPreview`（需会话）/ `l0:rebuildRun`（需管理员 + 逐字 `REBUILD` + `view_locked > 0` 时在**备份之前**整轮拒绝 + 双库备份）→ 卡片 `src/web/security/RebuildFromL0Card.tsx`（卡内解锁/锁上查阅会话走 `l0:unlock`/`l0:lock`，解锁后带 `l0_session_id` 重拉预览） | `rebuild.test.ts` 12 例（预览只读但真读原文 / 执行覆盖正文并重算指纹·向量·戳 / 按当前质量门删应删行 / pinned+locked 与取不到原文的行一律不碰 / 缺管理员·缺备份拒绝 / LLM 可用才炼深层、残缺如实 `llm_partial` / 四类原因码各一条 / L0 原文绝不进审计）、`RebuildFromL0Card.test.tsx` 12 例（回执 `not.toContain` 任何原文） |
> **适用边界（批次41-O 补）**：37-E「按 L0 重建」救的是**整份 L1–L6 库丢了 / 要整库重造**（原文还留在 L0 库里或行上）；它**救不回逐行删除**——`ledgerReset`（清空重采）/ `rejudge`（规则重判）/ 手动删某行时，其 L0 密文被**同步销毁**，重建对那行只能按「取不到原文」跳过。逐行删除的唯一退路是执行前落的那份备份目录，故批次41-O 在 `RulesRejudgeCard`/`LedgerResetCard` 的预览/回执里都明写「连带销毁 N 条 L0 原文」（`with_l0_cipher`，见批次41-O 节）。
| 37-G L0 忘记管理密码找回（恢复码 + 恢复卡） | **新文件** `src/core/memagent/l0Recovery.ts`：`generateRecoveryCode`（32 字节 = 256bit 随机数，**不是密码的衍生物**）、`normalizeRecoveryCode`（只归一空白，不给别的宽容）、`wrapDekWithRecovery` / `unwrapDekWithRecovery`、`createKeyringSecrets`（**同一个 DEK 包两份**：`admin_wrap` 用管理密码派生 KEK、`recovery_wrap` 用恢复码派生 KEK）、`keyringFingerprint`、`buildRecoveryCard`（纯文本卡：码 + 库指纹 + 对应文件路径 + 红线，**绝不含管理密码**）、`RECOVERY_BAD_CODE`。`l0vault.ts` 新增 `initL0WithRecovery` / `rotateRecoveryCode` / `recoverWithCode` / `recoveryStatus`（恢复成功当场作废旧码换新码；**码错算进同一套 5 次锁定链路**；DEK 不变 → 恢复前封的信封用新密码照样解得开；状态接口只回「有没有 / 指纹 / 时间」）。IPC `l0:recoveryStatus / recoveryInit / recoveryIssue / recover / recoveryExport` + `l0:changePassword`（**全部仅管理员**），卡面导出走主进程原生「另存为」 | `l0Recovery.test.ts` 8 例、`l0VaultRecovery.test.ts` 13 例、`L0RecoveryCard.test.tsx` 13 例 |
| 37-日志标签 | `src/web/Home/programLogLabels.ts`：`dataRoot:setup:*` 八条（两库目录已指定 / 未选即退出 / 库文件已核对补送 / 首启已设 L0 密码 / 设密码被拒 / 进入首启向导 / 已完成跳过 / 向导完成含恢复卡已导出）、`kernel:l0:split-*` 四条、`kernel:l0:rebuild-*` 四条、`kernel:l0:recovery-*` 四条、`kernel:l0:store-corrupt`，加 `setup:*` 与新增 `l0:*` 通道的中文说明 | 纯映射；手测报告要求在日志页按中文标题逐条核对 |

> 诚实边界（批次37）：① **「拆库」不等于「换个地方躺明文」**——`isSealedL0` 只放行 v2/v1 信封，明文进不了 L0 库，所以 1641 行存量必须先解锁 L0 写密钥才能搬（`l0:splitRun` 没解锁就整轮拒绝，不解锁就保持现状不写）；② 向导的门禁是主进程的 `isSetupComplete` + 各条 IPC 自己的本机判据，**绕过页面也进不了数据面**；向导内改选两库位置**要重启才生效**；升级上来的老指针没有 `setupDone`，**照样进向导**；③ 恢复码**一次性**：用过即作废并当场换新码，**新卡必须重新导出**；码明文只在发码那一次的返回值里出现一次，绝不进日志与审计。**红线（卡面、恢复卡正文、AGENTS §9 三处都写了）：管理密码与恢复码同时丢失 = L0 原数据库不可恢复**，解密能力没有任何服务端兜底；④ 重建**不开新的解密口子**：`view_locked` 行在备份之前整轮拒绝，取不到原文与 `pinned`/`locked` 一行不碰（重建不是顺手清理，没有证据就删等于凭空丢数据），不勾「同时用 LLM 重炼」就把 L2–L6 清空并记 `refined_by=stub`（预览用 `rebuild_deep_cleared` 提前告知会清多少行）；⑤ 纯浏览器（`npm run dev`）无主进程 → 向导与五张 L0 卡（管理 / 拆分 / 旧数据迁移 / 恢复 / 重建）如实显示不可用，绝不用页面内存对象冒充真文件；`setup.html` **已有点击级 E2E**（`e2e/setup.spec.ts` 12 例，见批次37 报告 §8），但 E2E 栈里同样没有主进程 → **`setupDone` 落盘、主窗口真被拦在向导、原生选目录/另存为、真密钥环与 DEK 封装、SPLIT/REBUILD 路径仍不在 E2E 覆盖内**（由 `dataRoot.test.ts` + `SetupPage.test.tsx` + 各卡单测覆盖），首次真机走查见 `specs/MANUAL-TEST-FIX-BATCH-37.md` §4.1；⑥ 拆完库后 `memories.l0.json` 是**唯一的原件副本**，双库备份只保证「这台机器上三个文件都有退路」，**不能替代离线副本**——请与密钥环、恢复卡分开存放。

---

## 批次38（2026-11-02）：§4.4.6 旧数据迁移拆成独立卡片 + 实机执行台账校正

> 起因（用户原话）：「**旧数据迁移请单独拆出一个卡片**，点击迁移旧数据后显示：扫描 1642 · 明文迁移 0 · v1 迁移 0 · 待处理 0 · 跳过 1642 · 备份 …`backups/l0-migrate-2026-11-02T13-03-23-744Z`」。
> 顺带一条实机事实校正：批次37 交付时文档写着「真实账本 1641 行明文存量**一行未搬**」，用户截图 + 本机内核审计证明**已经搬完**（见下表「实机台账」）。文档失真就改文档，不留给用户猜（AGENTS §8）。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 38-A 旧数据迁移独立卡 | **新文件** `src/web/security/L0MigrateCard.tsx`：把 §4.4.6 那段从 `L0AdminCard.tsx` 整块拆出（管理卡删掉 `l0-migrate-form` / `l0-mig-report` 与 `doMigrate`、`migOldPw/migReport/migBackup` 三个 state 与 `coreL0Migrate`/`L0MigrationReport` 两个 import，只留密钥环本体），挂在 `SecurityPage.tsx` 的 `L0SplitCard` 之后。通道不变（`coreL0Migrate` → `l0:migrate`，仅管理员 + 迁移前 `backupBeforeKernelChange('l0-migrate')`）。三条口径：① **写密钥未解锁不给点**，且 `l0:status` 读不到时按「未确认」处理（同样禁用并明说「本机读不到密钥环状态」）——**绝不凭空重加密**；② 新增独立的「刷新写密钥状态」按钮：解锁动作发生在上方管理卡，本卡原来只在挂载时拉一次状态，导致「解完回来按钮还是灰的」，现在点一下即重判、不必刷新整页；③ 回执只报计数与备份目录，`pending > 0` 写明**这些行一行没动**（迁移不是顺手清理），全零时如实说「本轮无事可做：行上已没有明文，也没有遗留 v1 信封」。卡尾固定说明**先换封法（本卡）、后换地方（37-C 拆分卡）**的分工，避免用户在拆完库后再点 SPLIT 却看到「本轮搬入 0」以为没生效 | `L0MigrateCard.test.tsx` 8 例（非管理员不给入口且不拉状态 / 未解锁禁用且点了不发 / 状态读不到仍禁用 / 逐字回显实机那条 no-op 回执与备份目录 / 旧密码原样下传并当场清空输入框且不出现在回执 / `pending>0` 警告含「一行没动」 / 内核抛错只显示原因不显示成功回执 / 点刷新后放行）+ `SecurityPage.test.tsx` 10 例（含新加的「迁移表单不在 `l0-admin-card` 里」的归属断言）。**已做变异验证**：把禁用条件改成只剩 `busy` → 3 例失败，确认这三条门禁不是空断言 |
| 38-B 实机台账（本机数据根实测，UTC+08:00） | 内核 `security_change` / `memory_op` + `actions.log`：20:36:48 `l0_recovery_rotated`（指纹 `4f433527`，`user=setup:first-run`）→ 20:38:52 `l0:recovery-exported` `L0恢复卡-4f433527.txt`（1179 字节）→ 指针 `setupDone:true`；20:57:52 `l0_migrate` `scanned 1642 · migrated_orig 1641`（明文全封 v2，经 37-A「写入即搬」进 L0 库，行上只留 `has_l0`）→ 21:03:23 第二次 `migrated_orig 0 · 跳过 1642`（用户截图那条）；21:25:19 `rules_rejudge` `total 1642 · purge 57 · restamped 1585 · by_code {narration 36, thin 17, identity 3, capability_list 1}`，**与批次36 只读回放预测逐字一致**；`l0_split` 审计 **0 条** = `l0:splitRun`（逐字 `SPLIT`）从未真机执行，因为已无事可做。当前库面：记忆库 1585 行 / `has_l0` 1584 / 明文 0 / 行上信封 0 / `quality_gate_v` 全 2；`memories.l0.json` 1584 条 · 9.52 MB；密钥环顶层键是 `recovery`（不是 `recovery_wrap`）。**仍未真机执行**：`REBUILD`（按 L0 重建）、`RESET`（清空重采） | 台账来自命令行实测，非推断；手测报告 `specs/MANUAL-TEST-FIX-BATCH-38.md` §3 |

> 诚实边界（批次38）：① 本批**只动渲染层卡片编排**，`l0:migrate` 的内核实现、备份前置与审计字段一个都没改，所以旧数据迁移的行为与批次37 完全一致（回执数字对得上实机）；② 独立卡挂在 `L0SplitCard` 之后是**顺序即分工**的表达（先重封、再搬家），不是新的执行依赖——两卡各自独立可用；③ 38-B 的台账说明批次37 文档里的「一行未搬」已失真，该句已在 `specs/需求规格书.md` §19.22（批次37 小节）诚实边界③⑦ 就地校正，`specs/MANUAL-TEST-FIX-BATCH-37.md` 的历史快照表述（§2「拆库前本机账本的硬事实」）保留不改，因为那写的是**动手之前**的状态；④ 纯浏览器（`npm run dev`）下本卡与其余 L0 卡一样没有主进程数据面：`l0:status` 读不到就按未解锁处理、按钮禁用，绝不假装迁移成功。

## 批次39（2026-11-02）：重新设计精炼器 —— 写入只落 L0+L1，L2–L6 交给后台补炼队列

> 起因（用户原话）：「**重新设计精炼器生成L2-L6**」，前一条是「L2-L6是怎么生成的？怎么没有数据？」。
> 实测的账本硬事实（2026-11-02，本机数据根）：`memories.db.json` **1585 行全部** `layer=L1` / `refined_by=stub`，带任一 L2–L6 正文的行 **0**；而 LLM 网关是健康的——`llm-config.json` 6 个引擎里 **5 个已启用且拨测成功**（ollama 352ms / custom agnes 475ms / custom agnes 1608ms / openrouter 2058ms / zhipu 2497ms；deepseek 未启用）。
> **真因不是模型、不是密钥、不是网络**：`main.ts` 采集器构造 `WriteCtx` 时**不传 `llm`/`llmModel`**（同一文件里批次37-E 的 rebuild 通道是传 `llmGateway` 的），`mcp.ts` / `mcpHttp.ts` 又硬编码 `new FakeLlmProvider()` → `makeLayerGenerator` 的 `canLlm` 为假，阶梯第一步就停在 L1。**MCP 那两个桩是用户明确要求保留的设计（「MCP HTTP 写入只落 L0，脱敏后才能产出L1」），不是待修的 bug。**

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 39-A 队列纯函数与落盘 | **新文件** `src/core/memagent/refineQueue.ts`：`refine-queue.json`（0600，`{version,enabled,day,dayRows,items:{[mem_id]:{state,reason?,layers?,refined_by?,llm_calls?,at}}}`，**只有 mem_id 与状态，正文/密文一个字不落**）、`clampRefineQueue`（坏文件按空队列起，不炸启动）、`enqueueRows` 幂等入队（`added/already_queued/settled/protected_skipped/not_eligible` 五计数）、`nextPending` 内含**未启用 + 当日额度**两道闸门、`markRefined`/`markRefineFailed` 计当日额度、`markRefineSkipped` **不计**（没有真实产出就不烧额度）、`settleRowOutcome` 把单行结果映射成 done/skipped/failed、`retryFailed` 手动放回失败行、`summarizeRefineQueue` 出 UI 进度。三条拍板常量：`REFINE_MAX_ENGINES_PER_CALL=3`、`REFINE_MAX_ROWS_PER_DAY=500`、`dayKey` 按 **UTC+08:00** 记自然日。**〔41-I 后续：每日额度改运行时可调〕** `RefineQueueState` 新增 `cap_enabled`/`cap_rows`，`effectiveCap()`（限额→`cap_rows`，不限额→`Infinity`）取代常量做闸门，`setRefineCap` 纯函数 + `refine:setCap` IPC（仅管理员）+ 卡片「限额/不限额」开关与数字框（不限额时数字框灰）；`REFINE_MAX_ROWS_PER_DAY=500` 降为「默认值 + 坏值回落」，`summarizeRefineQueue` 的 `day_limit`/`day_left` 不限额时回 `null`（绝不上线 `Infinity`） | `refineQueue.test.ts` 19 例：跨日计数（**这一例抓出真 bug**：跨日后新日第一行的额度被算成 0，日额度形同虚设）、额度只由 done/failed 消耗、skipped 不消耗、`enabled=false` 直接不出队、落盘重载续炼、文件不含正文、受保护/不合格行不入队、`settleRowOutcome` 四种映射、`retryFailed` 计数 |
| 39-B 单条引擎预算 ≤3 | `LlmGatewayProvider` 第 4 个构造参 `maxEnginesPerCall`（缺省取核心的 `REFINE_MAX_ENGINES_PER_CALL`）：`race()` 只取 `callOrder()` 前 N 台，全失败时错误里写明「本条引擎预算 N 个已用完，还有 K 个未试」。**方向是 electron→core**（主进程 import 核心常量，不复制数字） | `llmGateway.test.ts` 新增一例：预算 2 时第 3 台引擎**绝不发起请求**（捕获调用序列恰好 `['deepseek','kimi']`），缺省预算 3 则三台全试 |
| 39-C 后台 worker + 两处入队 | `main.ts` **§6f**（注意与批次37-B 首启向导的 §6e 是两个区块）：`REFINE_TICK_MS=15_000` 定时 `runRefineTick` + `refineInFlight` 防重入；**`llmGateway.usable()` 为假时直接 return——不起活、不把行判死、不消耗额度**（没有真实调用就没有失败）；启动 `startRefineQueue` 扫全量存量入队并落 `refine:backfill-scan`；采集器每写完一批把新 `mem_id` 入队（`refine:enqueue-collected`）。`refineRowLayers` **只有产出至少一层才改行**：改行时重算 `sha256`/`layer_specs`/`layers_generated_at`、`version+1`、向量按新 `layer` 重 upsert 而 `content_l1` 与 embedding 不动；每行审计 `memory_op/op='layer_refine'` + `actor='refine_queue'`，**只有层名与计数** | 单行精炼 7 例并入 `refineQueue.test.ts`：五层全产出且审计不含正文、中途违规→`llm_partial`、L2 就违规→**整行一字不改**、无 LLM/`deleted`/缺 L1/`pinned`/`locked`/幽灵 id 全部拒动、LLM 抛错只记 `refine_error`、向量 layer 元数据前进且与 L1 余弦≈1 |
| 39-D IPC + 参数页卡 | `ipcChannels.ts` 四条：`refine:state`（需会话）/ `refine:setEnabled` / `refine:backfill` / `refine:retryFailed`（三条均**仅管理员**）→ `preload.ts` `refineQueue` 命名空间 → `desktop/hostBridge.ts`；渲染层桥 `src/web/params/refineQueue.ts`（把主进程回执收成 `RefineResult{ok,view,error,report?,retried?}`，浏览器模式如实「不是桌面宿主环境」）+ 卡片 `RefineQueueCard.tsx`（挂在 `ParamsPage.tsx` 紧跟 LLM 引擎卡；20s 轮询；进度 / `今日 X/500 还剩 Y` / 队列文件路径 / 三条口径写在卡面 / 引擎不可用时「只排不炼」告警 / 失败行为 0 时禁用重试） | `RefineQueueCard.test.tsx` 8 例（浏览器降级 / 管理员按主进程数字原样显示含 UTC+08:00 时刻 / 成员三控件禁用但刷新可用 / 入队四计数回执 / 开关把布尔值真传主进程 / `failed=0` 禁用重试、有失败才回显行数 / 引擎不可用文案 / 主进程拒绝只显示原因不假装 0 待炼） |

> 诚实边界（批次39）：① **补炼会真调引擎、真花钱**——今日拨测延时序下，单条 3 台预算恰好是 ollama + 两个 agnes 云端引擎，openrouter/zhipu 排第 4/5 因而在补炼里不会被调用；不想花云端钱就停用引擎或关掉「开启后台补炼」，`price:0.01` 价档仍是 §19.8 的记账口径、**不是厂商账单**；② 本机 7B 单次精炼实测 ~28s → 一行五层约两分钟，**500 行/日是上限不是目标**，实际吞吐由模型速度决定；③ 层级规格违规判废 → 该层留空、整行按已产出层收尾标 `llm_partial`，本机小模型概率不低，这是如实记账不是失败；④ `main.ts` §6f 的定时与入队接线**没有自动化测试**（纯函数 19 + 卡片 8 + 网关预算 1），需按手测报告在实机核对 `refine-queue.json` 与 `actions.log`；⑤ 队列文件不在数据根迁移白名单——丢了等价于重新扫存量入队，不丢数据；⑥ **与批次37-E 的分工**：补炼只**加**深层、不动 L1；REBUILD 是整行重造（新 L1 + 深层）且需要 L0 查阅会话解密原文。删库要恢复→REBUILD，想让存量长出 L2–L6→本队列；⑦ 纯浏览器模式没有主进程 → 卡片如实显示不可用，绝不用页面内存对象冒充队列。

---

## 批次40（2026-11-03）：短料在入库那一步就拦掉 + L2–L6 规格重新梳理（绝对字数 → 按源文相对）

> 起因（用户原话）：「**在L0清洗脱敏生成L1的时候就要把字数少的过滤掉，不是等到精炼才过滤**」+「**L2-L6精炼逻辑重新在梳理下**」。
> 批次39 队列真跑之后的实测（本机数据根，2026-11-03）：`refine-queue.json` 入队 **1584 行 = done 262 · failed 238 · pending 1084**，当日 **500 行额度用满**；238 条失败的原因**全是同一句**「首层（L2）就没有产出：模型答复不合规格或为空」。
> 追下去不是模型的锅，是**规格结构性不可能**：批次39 的层级规格是绝对字数下限（L2 ≥50 字），而真实账本的 L1 就是短——1585 行（缺 L1 **0** 行）按有效字分布 **<30 字 422（26.6%）· 30–59 字 493（31.1%）· 60–119 字 459（29.0%）· 120–239 字 150（9.5%）· ≥240 字 61（3.8%）**。对着 18 字的源要求写 50 字摘要，唯一「达标」办法就是编料——那正是批次24 整批清掉的 stub 幻觉产物的来源。
> 用户拍板（AskUserQuestion）：入库门槛用**双条件**（短 **且** 无事实才拦，不做纯字数一刀）；改动范围**五条一起改**。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 40-A 规格相对化 + 格式契约 | `src/core/memagent/layerRules.ts`：`LayerSpec` 新增 `minRatio`（L2 0.4 / L3 0.35 / L4 0.3 / L5 0.25）与 `mustStartWith`，`minChars` **语义降为「没有源文时的兜底地板」**。新函数 `layerBand(spec, source?)` 三条夹逼：① 下限 = 源文字数 × `minRatio` 且不低于地板；② 相对下限**最多吃掉本层上限的 80%**（`Math.floor(maxChars*0.8)`，否则 5000 字长源把下限顶穿上限，变成写不进去的死规格）；③ **上限同时受源文约束** `min(maxChars, 源文长度)`——摘要是压缩不是扩写，产物比源长直接判废。`mustInclude` 全文 `text.includes(k)` 扫描 → `mustStartWith` 查开头（L4「适用场景」/ L5「边界条件」），旧口径实测把 L4 全灭（库面 L3 116 行 vs L4 1 行，模型换个说法就判废）；标准没放宽，只是**变成可达成**，因为契约同时被写进了提示词的输出格式。`checkLayerSpecDetailed(spec, text, source)` 返回 `LayerViolation[]`（`{layer, code, reason}`），`LayerViolationCode` = `empty / too_short / too_long / missing_keyword / bad_prefix / bad_json`；`checkLayerSpec` 保留为「只要中文清单」的薄封装 | `refine.test.ts`「每层生成规格（§2.1 / §16.1）」describe：`layerBand(l2)` 无源=`{12,300}`、18 字源=`{12,18}`、200 字源=`{80,200}`、5000 字源=`{240,300}`（上限夹住）、4 字源的 L5=`{10,10}` 不死规格；`depthCapFor` 逐档边界 29/30/59/60/119/120/240 |
| 40-B 短料在入库那步就拦 | `src/core/memagent/qualityGate.ts`：`QUALITY_GATE_VERSION` **2→3** + `QualityBlockCode` 新码 `short_low_signal` + `layerRules.ts` 新常量 `MIN_MEANINGFUL_WITHOUT_FACTS = 30`。判定放在**所有具体噪声码之后**（保证旁白/身份仍记它们自己的码）：`meaningful < 30 && !hasHardFacts && !hasTechEvidence` 才拒。**三道豁免而不是两道**——`hasTechEvidence` 沿用批次35 已拍板口径，否则「请帮我做一个SolidWorks插件,要求:批量转换文件格式」「优化 PostgreSQL 索引」这类批次35 明确放行过的短料会被重新杀掉（口径冲突优先于字数门槛）。分工：`MIN_MEANINGFUL_CHARS=10` 管空串/纯符号兜底，`30` 管「没有信号就不配占记忆位」。写页 / MCP / 采集器 / 补炼队列四处同一份 `checkL0ToL1Quality`，不再有「入库放行、精炼才发现」 | `qualityGate.test.ts` 34→**42** 例，新增 describe「批次40 短且无信号门」：拦「开始实施。先创建解决方案和项目文件。」这类纯短句；带硬事实（错误码 / `40001` / `pool_size=5`）或带具体技术名词的短句必须放行；`code` 逐条断言且**不与 `thin`/`narration`/`identity` 串码** |
| 40-C 深度按料给 + L6 独立通道 + 停在哪儿记哪儿 | `layerRules.ts`：`DEPTH_CAP_BANDS`（≥240→L5 / ≥120→L4 / ≥60→L3 / ≥30→L2 / `<30`→**null，不炼深层停在 L1**）+ `depthCapFor` + `targetLayers(meaningful)`（叙事层按档位给，**L6 恒追加**——它是检索索引 `keywords/projections`，不是压缩摘要，任何深度都能单独产出）+ `isFullyRefined(produced, targets)`（`llm_partial` 的唯一依据，不再拿 `LAYER_ORDER.length` 硬比）+ **`headlineLayer(produced, targets)`**：只有叙事层（本行该炼的 L2–L5）一层不缺时 L6 才算最深层，否则回落到最后一个连续层——**绝不用索引冒充深度**。`refined_by` 语义随之变更：**炼满本行该炼的层 = `llm`**，缺层才是 `llm_partial`。阶梯（`memories.ts` 写入 / `refineQueue.ts` 补炼 / `rebuild.ts` 重建**三条管道同源**）：中间层判废时**跳过 L6 再试它一次**，代价是深度不能再由「有没有 L6」倒推 → 由 `headlineLayer` 补齐。队列侧：`RefineRowResult.to_layer`、每行 `stop_layer`/`stop_code`、`settle()` 在 done 时**清掉上一轮的旧码**（旧结论不能留着冒充本次）、`retryFailed` 清码、`summarizeRefineQueue` 汇总 `stop_codes` | `refineQueue.test.ts` 19→**25** 例，新增 describe「批次40-C：深度按料给 + L6 独立通道 + 停在哪儿记哪儿」：短料行 `targets=['L1']` 且整行拒炼（`code='thin'`）、L4 判废但 L2/L3/L6 到手 → `layer='L3'` + `content_l6` 照常落 + `refined_by='llm_partial'` + `stop_layer='L3'`/`stop_code='empty'`、done 后旧 `stop_code` 被清、`retryFailed` 清码、`summarizeRefineQueue.stop_codes` 聚合。`refine.test.ts` 50 例含「RAW 脱敏后有效字 50 → `depthCapFor=L2`，料不够就不硬凑深层」「带硬事实过了质量门但有效字 24 → 不炼深层」；`rebuild.test.ts` 同源断言 |
| 40-D 提示词把相对区间与契约说清楚 | `src/electron/llmGateway.ts` `buildLayerPrompt(layer, input, category)`：`layerBand(spec, input)` 现算现写——`长度：X–Y 字（由上游 N 字按本层压缩比算出；写不够就是没内容，写超了就是没压缩，都算废）`；`格式契约：第一个词必须是「适用场景」…不许换成别的说法`（`mustStartWith` 落到 prompt，判定才查得下去）；`保留：源文中出现的关键词不得丢弃（也不得凭空补造）`；L6 仍单独给 JSON 输出格式。上游内容用 `"""` 包裹原样下传，**L0 原文从不上送** | `llmGateway.test.ts` 30 例（含 prompt 含「由上游 … 字按本层压缩比算出」与 `mustStartWith` 契约、区间随源文长度变化） |
| 40-E 队列卡与日志页显示「阶梯停在哪」 | `src/web/params/refineQueue.ts`：`REFINE_STOP_LABELS`（`LayerViolationCode` + 队列自有码 → 中文，**码→中文的唯一映射处**，未知码原样显示不吞）+ `refineStopLabel` + `refineStopRows`（按行数降序，UI 顺序稳定）；`RefineQueueCard.tsx` 进度区新增 `data-testid="refine-stop-codes"` 一行「阶梯停在哪：压得太狠（低于本层下限）（`too_short`）1 行 …」+ 尾部口径说明「『已炼成』不等于『炼到 L6』」，无码时不占位；`src/web/Home/programLogLabels.ts` 的 `NOTE_KEYS` 补 `to_layer/stop_layer/stop_code/refined_by`（`kernel:refine:row` 那三个字段在人话视图也看得见，值只有层名与英文码，无正文） | `RefineQueueCard.test.tsx` 8→**10** 例（按码显示行数 / 未知码原样透出 / 无 `stop_codes` 不渲染该行）、`programLogLabels.test.ts` 新增一例（`detailNote` 必须带出 `to_layer/stop_layer/stop_code/refined_by`） |
| 40-F 存量口径实测（只读） | `npm run rejudge`（2026-11-03 14:10 UTC+08:00，全程不写盘）回放真实 `memories.db.json`：1585 行 → **放行 1461 / 拦下 124**，124 条**全是 `short_low_signal`**、全是 L1、受保护 0；样本形如「开始实施。先创建解决方案和项目文件。」「接下来我们需要怎么做」 | 回放器本身即 `tools/rejudge-dry.mjs`（批次36-B），依赖 Node ≥ 24 直跑 `.ts`；`rejudge.test.ts` 11 例断言预览与实际回执必然一致 |
| 40-G 旧 fixture 与既有断言校正（**改这三处必同步**） | 新相对规格 + v3 门槛打破了 16 例旧回归：`refine.test.ts` / `refineQueue.test.ts` / `merge.test.ts` / `llmHonesty.test.ts` 的样本全部换成**实测过的压缩链**（L1 320 字 → L2 171 → L3 115 → L4 62（`适用场景：`开头）→ L5 52（`边界条件：`开头）→ L6 JSON）——旧的「短源 + 长摘要」fixture **真的该判废**，不是测试写错；`webhook.test.ts` 4 例、`MemoryPage.test.tsx`/`MemoryLayeredPage.test.tsx` 3 例、`e2e/write.spec.ts` 1 例的 fixture 正文本来就会被 v3 拦下 → 给句子加硬事实（`回滚耗时 120 秒` / `网关 504 状态码` / `pool_size=5`），让断言继续打在各用例本来的目标（E2E 那条仍然断言 `E_L0_LOCKED`）。`rejudge.test.ts` 的行戳断言改为 `QUALITY_GATE_VERSION - 1` 参数化，不再硬编码 `v2` | 全绿：单测 **146 文件 / 1681 例**（覆盖率 Statements 81.46% / Branches 73.81% / Lines 84.52%）、`npm run build:electron` + **E2E 106 例** |

> 诚实边界（批次40）：① **只改规则与记账字段，没动数据**——那 238 条 `failed` 是批次39 绝对规格下记的账，本批次**没有回滚队列、没有重炼存量**；要重炼就点参数页「重试失败行」（放回 pending，按新相对规格重跑，**会再次真实调用引擎并消耗当日额度**）。② 124 行 `short_low_signal` 存量仍在库里——安全页「规则重判存量」按钮（逐字 `REJUDGE` + 强制备份）**我没替用户点过**。**〔2026-11-04 校正〕后半句照旧（按钮归用户），前半句已过期**：用户于 2026-11-03 14:43:03 亲手执行，审计 `op=rules_rejudge purged=124`、事前备份 `rules-rejudge-2026-11-03T06-43-03-474Z`，11-04 11:42 回放 `would_block=0`。③ 深度档位是**拍出来的工程常量**（每深一层源料大致翻倍），不是语义理解；`<30 字` 的豁免判据仍是正则与词表，豁免的是**字数**这一维，不是「有没有信息量」。④ `headlineLayer` 只保证「行上报的深度不撒谎」，不证明产物质量——L2 合规但内容编造仍会落库（启发式既有取舍：宁可放过不可错杀）。⑤ `minRatio` 的 0.4/0.35/0.3/0.25 来自「按真实账本长度分布回放，短源链不再整批判废」的实测标定，不是理论值；换模型或换采集口径需要重新标定。⑥ 只排不炼、≤3 引擎、≤500 行/日、正文零落盘这四条批次39 闸门**一条没放松**；本批改的是「炼几层、每层写多少字、为什么停」，不是「花多少钱」。⑦ **红线复述**：L0 管理密码与恢复码同时丢失 = L0 原数据库不可恢复，本批次与找回通道无关。

## 批次41-A（2026-11-03）：内核审计搬出记忆库 —— 追加式 `audit.jsonl` + 归档轮转 + 四源备份（评审 P1-5）

> 起因：评审 P1-5「内核审计只增不减，且非批量模式下每条审计 = 整库 stringify+fsync+rename」。当时报告写「本机库已 25 MB 级」，本次实测校正为 **13.01 MiB**（`memories.db.json` 13,635,138 B，2026-11-03 16:20 UTC+08:00 只读实测；库最后写入 16:00:27）。
> 实测代价（**临时目录复刻，不碰数据根**）：真实库内容 1,475 行记忆 + 11,666 行审计（审计序列化 2,983,840 B = 库的 **21.9%**）；旧路径（整库 stringify → 写 tmp → fsync → rename）中位 **108.44 ms/条**，新路径（单行 append + fsync）中位 **3.78 ms/条** → **约 28.7 倍**；单独 `JSON.stringify(doc)` 中位 31.8 ms。
> 任务附注：「这条不做，P2-9「sync 接线会放大摘要行无向量 + 审计增长」永远不能做」——本批次解除审计这一半，另一半（摘要行向量）= 批次41-B。

| 条目 | 实现要点 | 测试 |
|---|---|---|
| 41-A1 追加式审计账本 | **新文件** `src/core/memagent/auditLog.ts`：`FileAuditLog`（`AUDIT_FILE_NAME='audit.jsonl'`、`AUDIT_ACTIVE_MAX_BYTES=16MiB`）。写=`openSync(path,'a')+writeSync+fsyncSync`（O(记录大小)，不再整库序列化）；`append/appendMany/beginBatch/commitBatch/close`（**落盘成功才进内存视图**，失败原样上抛且批次保留，绝不「标已提交、实际没落盘」）；轮转 `rotateIfNeeded` 只在超闸门时把**整档** `renameSync` 进 `audit-archive/audit-<UTC>-<三位补零序号>.jsonl`（**只换文件、一条不删**；序号恒定存在，否则同毫秒两次轮转的纯字典序会排反）；归档挪不动（占用/权限）就继续在在档上追加，**轮转失败绝不丢审计**。读：`query/list/count/stats`；逐行解析，坏行只计 `skipped_lines`（掉电尾行属正常残留），**整档一行都认不出**才判结构损坏 → `backupCorrupt` 改名隔离 + `AuditLogCorruptError`(`E_AUDIT_LOG_CORRUPT`)。只读镜像（`readonly`）绝不写盘/轮转/改名别人的文件，按**字节增量**跟随写方追加（变短=轮转 → 整体重载）；`readFrom` 用 `Buffer.alloc`（**不用 `allocUnsafe`**：短读时未初始化堆内存可能混进结果，即评审 P2-11 同类坑） | `__tests__/auditLog.test.ts` **11** 例（新）：空账本不抛不预建 / 落盘与新实例顺序读回 / `query` 三种过滤 / 尾行截断容错且 `skipped_lines=1` / 整档不可认→抛码 + `.corrupt` 保内容 + 二次启动空账本 / 批量未提交不落盘·commit 一次落盘·`close` 兜底 / `appendMany` 一次补齐 / **轮转不删数据**（`archive_files=1·rows=3·archived_rows=3·bytes=0`，再追加后归档仍 3 行、`query({request_id:'req_old'})` 仍命中）/ 只读增量可见 + 写方轮转后重载 / 只读绝不写盘改名 / `detail` 结构保真 |
| 41-A2 FileStorage 接上与存量迁移 | `src/core/memagent/fileStorage.ts`：`FileDoc.audit` 降级为**历史字段**；新选项 `auditPath`（缺省 = 记忆库同目录 `join(dir, AUDIT_FILE_NAME)`）与 `auditMaxBytes`（单测闸门）；`appendAudit` → `auditLog.append`；`queryAudit` = **归档 + 在档 + 库里未迁完的 `doc.audit`** 合并（全量真数据口径不变）；**`migrateLegacyAudit()` 是公开的、构造时不调用**——搬之前必须有一次备份（项目不变量），所以由端壳在备份成功后调它，返回本次搬走的行数、库里已空即幂等返回 0、只读实例返回 0；中断风险按**「宁重复不缺失」**处理并写一条 `security_change/op=audit_log_migrate` 可见审计；审计账本读不认时**不掀掉整个存储**（记忆库还读得动），记 `auditCorruption` 后按空账本继续；`commitBatch` 顺序 **L0 库 → 记忆库 → 审计**（绝不先写一条数据没落盘的审计）；`auditStats` getter 出 `rows`（含 legacy）/`migrated_rows`/`legacy_rows_in_ledger`/`corruption` | `fileStorage.test.ts` **37** 例，新增 describe「FileStorage · 审计独立账本（批次41-A）」9 例：缺省 `auditPath` 派生 / 库里 `audit: []` 而 `audit.jsonl` 有 2 行 / **构造不搬（断言库文件字节一字未动 + 历史照旧查得到）→ 显式调 `migrateLegacyAudit()` 才搬 2 行、再调返回 0、二次启动不重复** / **迁移中断 → 重复 2 条 + `audit_log_migrate` 审计** / 只读不迁（显式调用也返回 0）但查得到 legacy 且文件字节不变（写抛 `/只读模式/`）/ 只读镜像跟随写方追加 / `audit.jsonl` 整档不可认 → `corruption` 可见 + `.corrupt` 存在 + **记忆照常读写** / 批量模式攒批与 `close()` 兜底 / `auditMaxBytes:1` 轮转后 `queryAudit` 仍全量。另：P0-6 写盘失败族的 `appendAudit` 用例改打审计文件本身（`mkdirSync` 占位 + 先改名腾位），旧 `${db}.tmp` 障碍对追加式文件无效 |
| 41-A3 主进程接线、迁移闸门与观测 | `src/electron/main.ts`：§1 `AUDIT_PATH`（= `LIB_PATHS.audit`，兜底 `join(USER_DATA, AUDIT_FILE_NAME)`）→ §2 `FileStorage(DB_PATH, {l0, auditPath})` → §10 bootstrap **存量迁移闸门**：`auditStats.legacy_rows_in_ledger > 0` 且本进程可写 → `backupBeforeKernelChange('audit-log-split', 'audit:log-backup')` 成功后才 `storage.migrateLegacyAudit()`；备份/迁移抛错 → `kernel:audit:log-migrate-skipped`（warn，含 `legacy_rows` 与 error）且**本次不搬**（历史审计原样留库里，应用照常启动，绝不无备份改写用户账本）；只读实例只落 `bootstrap:audit-migrate-deferred` 主日志。打开后落 `kernel:audit:log-open`（path/rows/bytes/archive/坏行/legacy/readonly），并按需追加 `audit:log-migrated`（迁移过多少行）、`audit:log-bad-lines`（warn）、`audit:log-corrupt`（error，含隔离原件路径）；§6 `dataRoot:get` 回显 `activeAuditPath` + `audit: storage.auditStats`；§2 `adoptLibraryFilesIntoPlace` 新增第 4 件「审计账本」补送与 `adoptLibraryDirIntoPlace(USER_DATA, ledgerDir, 'audit-archive')` 整批补送（汇总 `审计归档（N 个文件）`）；§5 `backupPaths()` 出四源 | 备份闸门与四条日志键在 `main.ts` §10（接线级，无自动化测试，需在实机日志页按中文标题核对：手测报告 §5）；纯函数与存储层由 `dataRoot.test.ts`/`backupFiles.test.ts`/`fileStorage.test.ts` 覆盖 |
| 41-A4 数据根与两库位置 | `src/electron/dataRoot.ts`：`LibraryPaths` 新增 `audit`（**跟 `ledgerDir`**，缺字段回落 root = 与记忆库同位置；不跟 L0 库走）、`DATA_ROOT_MIGRATE_FILES` += `AUDIT_FILE_NAME`、`DATA_ROOT_MIGRATE_DIRS` += `'audit-archive'`、新导出 `adoptLibraryDirIntoPlace(fromDir,toDir,dirName)`（复用 `copyDirMissing`：目标同名不动、源不删、同目录跳过） | `dataRoot.test.ts` 20→**27** 例：`audit` 随 `ledgerDir`/旧指针回落 root、两个白名单必须含新条目（**改了必须同步 AGENTS §6**）、`migrateDataRoot` 真带走 `audit.jsonl`（目标已有则 `skipped` 不覆盖）与 `audit-archive/` 逐文件、`.lock` 不迁、源保留、只有审计/只有非空归档目录都算「这里有数据」且进 `summarizeDataDir`、`adoptLibraryDirIntoPlace` 三种结果 |
| 41-A5 四源备份配方 | `src/electron/backupFiles.ts`：`BackupKind` += `'audit'`，新 `BACKUP_EXT`（audit=`.jsonl`，其余 `.json`），前缀 `memaudit-`；`planBackupFiles`/`selectBackupsToDelete`/`sortBackupsNewestFirst`/`kindOfBackupName` 全部按第四类扩到同源口径（**份数按库分算，绝不跨库凑数**）。追加式文件被复制时可能截到半行：**读侧按行容错，不为此加锁**（备份不该阻塞写入） | `backupFiles.test.ts` 9→**13** 例（四前缀一次全备 / 各 missing 组合如实标缺哪个 / 四前缀滚动互不挤占 / `.jsonl` 与 `.json` 不误删 `.tmp`/`.lock` / `kindOfBackupName('memaudit-…')==='audit` / `BACKUP_EXT` 断言） |
| 41-A6 设置页与备份标签 | `src/web/memory/dataRoot.ts`：`AuditLogInfo`（path/archive_dir/rows/bytes/archive_files/archive_bytes/archived_rows/skipped_lines/readonly/migrated_rows/legacy_rows_in_ledger/corruption）+ `DataRootInfo.activeAuditPath?/audit?`；`src/web/memory/backup.ts` `BackupKind` += `'audit'`、`BACKUP_KIND_LABEL.audit='审计账本'`（**「备了记忆库」不再等于「备了审计」**）；`src/web/params/KbManagementCard.tsx` 新增 `data-testid="kb-audit-path"` 行（在档行数 / 归档文件数与行数 / 坏行 / 上次隔离原件路径），迁移说明点名「L0 库、密钥环与审计账本」 | 渲染层字段来自 `dataRoot:get` 真值，无桩数据；卡面数字需实机核对（手测报告 §5） |

| 41-A7 日志页人话标签 | `src/web/Home/programLogLabels.ts`：`kernel:audit:log-open/log-migrated/log-bad-lines/log-corrupt/log-backup/log-migrate-skipped` 六条中文标题（审计账本在哪、迁了多少、坏了几行、原件隔离到哪、搬之前备了什么、为什么这次没搬）+ `NOTE_KEYS` 补 `rows/bytes/migrated_rows/legacy_rows/legacy_rows_in_ledger/archived_rows/archive_files/skipped_lines`（值全是计数与路径，**审计正文与 `detail` 里的内容不被抬进摘要**） | `programLogLabels.test.ts` 10→**12** 例（六条 `actionTitle` 命中 + `detailNote` 带出计数且断言正文不出现） |

> 诚实边界（批次41-A）：① **`audit-archive/` 不进滚动备份**——`backups/` 只有在档 `audit.jsonl` 的快照；轮转从不删数据、全量历史仍常驻数据目录，但**要异地留存请整体备份数据目录**，别假设备份覆盖了全量历史。② 归档与在档**一次装进内存**（`loadAll`），审计行数继续涨时这是内存占用的上限来源，本批次没做「按需查档」。③ 存量迁移的中断窗口只可能产生**重复行**，不产生缺失；库里那格清空后 `persist` 失败 = 历史仍留在库里，下次启动再迁一次（不静默截断）。④ **另一份同接口实现 `sqliteStorage.ts`（node:sqlite，当前未注入生产）没动**，本次只收口主进程实际注入的 `FileStorage`。⑤ 16 MiB 闸门与「归档不删」是工程取舍，**没有 TTL、没有自动清理**，不是保留期合规策略。⑥ 上面那组 ms 数字来自**临时目录复刻**（读真实库、写临时目录），不是数据根实测。**2026-11-04 10:08:50（UTC+08:00）闸门已在用户机真跑过**（见「批次41-Z」节）：体积差这条**已字面成立**（`doc.audit` 归零、库 14,283,011 → 11,215,610 B），但**时延收益本机仍无足量样本**（迁移后 `ipc:storage:putMemory` 命中 n=0，迁移前 n=3、中位 165 ms）——不要把复刻的 28.7 倍当成本机实测值写进任何回执。

## 批次41-B（2026-11-03）：遗忘摘要行补齐 `sha256` + 语义向量 —— 摘要行与写入路径同字段口径（评审 P1-4 未修的另一半）

> 评审原话拆两半：P1-4「摘要行无向量」+ P1-5「审计增长」。P1-5 = 批次41-A（上一条），P1-4 = 本条。任务口径（用户拍板）：**「摘要行与正常写入路径同源 —— `content_l1` → `embedSync` 落向量 → `sha256`，向量 upsert 进同一个 vector backend；补 `forgetting.test.ts` 正例（断言摘要行能被语义召回命中）」**；范围外：**不改摘要合成分组口径与质量门**。
> 为什么这不只是「多存两个字段」：语义召回的打分对象就是行上的 `m.embedding`（`agent.ts` 读行向量，`VectorBackend` 只是那份可丢弃的索引）→ 缺向量的摘要行**恒 0 分**，遗忘引擎产出的摘要永远召不回来；缺 `sha256` 的行在 sync 的每日全量对账里被 `!m.sha256` 判成「缺失」（`sync.ts:226`），且违反需求规格书 §2.2 不变量 7「向量源自 L1」。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-B1 摘要行字段同源 | `src/core/memagent/forgetting.ts` 的 `buildSummary`：新增 `const contentL1 = gate.content!`（= 过完 L0→L1 质量门的正文，行上 `content` 与 `content_l1` 同值）→ `sha256: sha256hex(contentL1)` + `embedding: embedSync(contentL1, DEFAULT_VECTOR_DIM)`；导入 `DEFAULT_VECTOR_DIM/embedSync`（`vector.ts`）、`sha256hex`（`sync.ts`）。**纯函数、无 I/O**，与 `memories.ts:290/292`、`rebuild.ts:369-372`、`refineQueue.ts:415-418` 同一组合（sha 取行上报正文、向量取 L1） | `forgetting.test.ts` AC-09 用例新增两条断言：`summary.sha256 === sha256hex(summary.content)`、`summary.embedding` 逐元素等于 `embedSync(content_l1, DEFAULT_VECTOR_DIM)` |
| 41-B2 索引 upsert 与「不给就不假装」 | `ForgettingOptions.vector?: VectorBackend`；`runForgettingCycle` 合并段在 `putMemory(summary)` 之后 `await opts.vector.upsert(summary.mem_id, summary.content_l1!, { project_id, layer: 'L1' })`（layer 用 `'L1'`：摘要行上报的就是 L1，与 `memories.ts` 写入按 deepest 层建索引同源同值）。**`vector` 缺省时只写行上向量**，不调任何索引、不声称建过索引 | 新用例「批次41-B：摘要行进向量索引」：第一段给真 `JsVectorBackend` → 跑完整周期 → `vector.search(embedSync(summary.content_l1, vector.dim), 5, {})` 命中 `summary.mem_id`、行上向量与查询向量余弦 = 1；第二段不给 vector → 行上 `embedding` 仍真算、新建的索引里**没有**该 id |
| 41-B3 端壳注入同一个 backend | `src/electron/main.ts` 遗忘周期调度（§5.1 采集器区块内的 `runForgettingScheduled`）：`runForgettingCycle(storage, now, { enabled, weeklyCompress, vector: collectorVector })` —— `collectorVector`（`main.ts:2412`）与采集器写入、补炼队列 `startRefineQueue`、L0 查阅/重建用的是**同一个** `JsVectorBackend` 实例，摘要行不再游离于该实例之外 | 接线级（6h 周期 + 10min 首跑，无自动化测试）；实机按手测报告核对 `gc` 审计的 `summaries_created` 与记忆库 `sum_` 行的 `sha256`/`embedding` |

> 实测（2026-11-03 17:50 UTC+08:00，只读真实账本；桌面端持写锁正在写，读的是当时快照）：1,532 行记忆中 **`sum_` 前缀行 = 0、带 `merged_from` 的行 = 0** → 遗忘引擎在用户机上从未真产出过摘要行，**本批次没有历史摘要行需要回填**，新口径从下一次周期产出起生效。顺带量到两处**不属本批次**的存量缺口：① **533 行缺 `sha256`**（全部 `layer=L1`、`quality_gate_v=3`、`refined_by=stub`、`has_l0=true`；创建时刻集中在 2026-10-30 10:02–16:27 UTC+08:00，全部无 `layers_generated_at`）——`coreWrite` 的 `sha256` 由提交 `843282c`（2026-10-31 17:55）引入，故这批是**该提交之前的历史行**，不是现役通道在漏；后果限定在「sync 对账会把它们列进 missing」，而 sync 未接线 → 记为**批次41-J 的前置事实**。② **1 行缺 `embedding`** → 语义召回恒 0 分，同属存量清理类，未动。两者都不在本批次顺手改：批量重算 533 行的指纹属于**改写账本**，要走备份闸门与卡片口径（`rejudge`/`legacy` 那一类），不是补字段这一步的 scope。
> 门禁（批次41-B 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；全量 `vitest run` **147 文件 / 1714 例**全绿（覆盖率 Statements 81.63% / Branches 73.78% / Lines 84.73%）；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-B）：① `refined_by` 仍是 `stub`（本地合成不是 LLM 产物，批次28-C 口径不变）；② 只补**新产出**的字段，已有 `sum_` 行（本机 0 行）不回填；③ 向量索引是内存件，重启后由 `collectorVector` 重新建，**行上 `embedding` 才是召回依据**——所以本批次的必要项是 `embedding`，`upsert` 是让索引与表保持一致；④ 分组口径（`enterprise/team/project/category` + `content.slice(0,8)`、`≥3` 触发、`auto_merge` 白名单）与 `checkL0ToL1Quality` 质量门**一字未动**。

## 批次41-C（2026-11-03）：删除行的通道同步摘除补炼队列条目 —— `refine-queue.json` 里的幽灵条目

> 补炼队列 `refine-queue.json` 是「待炼行」的索引（`mem_id → 状态`，正文一个字不落）。删除通道对账本做的是**硬删**（`FileStorage.deleteMemory` 的 `delete this.doc.memories[id]` + 同步删 L0 密文），但此前**没碰队列**，被删的 id 一直留在文件里：`summarizeRefineQueue` 把死行算进 pending/failed、`nextPending` 反复取到 `no_source`。
> 实测（2026-11-03 19:35 UTC+08:00 只读真实 `refine-queue.json` + 账本）：1,621 条队列项（1,359 pending / 262 done），其中 **124 条 `mem_id` 在账本里已不存在（`not-in-ledger`），全部 `pending`、attempts 1–2** = 删掉的行遗留的幽灵条目。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-C1 两个纯函数（单一真源） | `src/core/memagent/refineQueue.ts`：`removeRefineRows(state, ids, now)` 按 id 摘除（**任意状态都摘**——行没了它的 pending/done/failed/skipped 全成幽灵；只删不新增、id 不在即幂等返回 `removed=0`）；`reconcileRefineQueue(state, liveIds, now)` 按「当前未删行」集合一次摘掉所有已消失 id（`liveIds` 是 `Iterable<string>`，活集合为空则全摘） | `refineQueue.test.ts` 新增「批次41-C」describe 4 例：`removeRefineRows` 幂等 / `reconcileRefineQueue` 活行保留·死行剔除且活行状态原样（done 的 live_1 保持 done）/ 全活时 `pruned=0` 且**原 state 原样返回**（不复制）/ `summarizeRefineQueue` 在摘除后把死行从 pending·failed 计数回落（pending=1、failed=0） |
| 41-C2 端壳接线（三处） | `src/electron/main.ts` §6f：新 helper `reconcileRefineQueueDir(why)`（`refineQueueDir` 未就绪直接返回；`listMemories({})` 取活行 → `reconcileRefineQueue`，只在 `pruned>0` 落盘 + 记 `kernel:refine:queue-reconciled`）与 `removeRefineQueueRow(id)`（单条摘除，热路径不做全量）；① `startRefineQueue` 启动时对账一次并写进 `refine:backfill-scan` 的 `pruned_ghosts`（**存量 124 条在下次启动自净**）；② `storage:deleteMemory` IPC 成功后 `removeRefineQueueRow(id)`（改 async）；③ `purgeLedger`（`'ledger-reset'`）与 `rejudgeRows`（`'rules-rejudge'`）执行完各 `void reconcileRefineQueueDir(…)` | 纯函数 4 例覆盖逻辑；handler 三处是**接线级**（各一行），需手测报告实机核对 `refine:queue-reconciled` / `refine:backfill-scan` 动作日志（人话标签见 41-C3） |
| 41-C3 日志页人话标签 | `src/web/Home/programLogLabels.ts`：新增 `kernel:refine:queue-reconciled / queue-reconcile-error / queue-remove-error` 三条中文标题；`NOTE_KEYS` 补 `pruned / pruned_ghosts / why`（值只有计数与触发原因，无正文） | `programLogLabels.test.ts`（沿用既有 `actionTitle` 命中断言，无新增计数断言） |

> 门禁（批次41-C 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；全量 `vitest run` **147 文件 / 1718 例**全绿；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-C）：① 41-C 只收口 `refine-queue.json` 这份**索引文件**，删除通道「**连带销毁 N 条 L0 原文**」是另一件事（`deleteMemory` 本就同步删 L0 密文，属存储语义，本批次不动、也不假装告知）——见 **41-O**；② 对账是「当前未删行」口径，`done` 行若仍在库中保留（「已炼到 L3」结论仍有意义），只有行没了才摘；③ 三个 handler 的接线没有自动化测试直接覆盖（与 41-A 的备份闸门同口径的接线级缺口，归 41-H 补齐）。

## 批次41-P（2026-11-04）：第四条硬删通道接上队列对账 —— 复查 41-C「幽灵收干净了吗」时量出来的缺口

> 41-C 按「三个删除通道」接线，但账本里的**硬删**有四条：`rebuildLayersFromL0`（安全页「按 L0 重建 L1–L6」）的 purge 分支同样逐行 `storage.deleteMemory`（`src/core/memagent/rebuild.ts:299`），41-C 漏接。后果不是数据错，而是**索引脏到下次重启为止**：点过 REBUILD 且 `purged>0` 的那批 id 会留在 `refine-queue.json` 里，直到 `startRefineQueue` 的全量对账自净。
> 复查实测（2026-11-04 10:29–10:31 UTC+08:00，真实数据根**只读**，应用正在补炼中，数字为快照）：队列 **1531** 项 vs 活行 **1532**，**幽灵 0**（41-C 摘除 124 条后的幂等状态此刻仍成立）；`pending 1150 · done 314 · skipped 65（全 thin）· failed 2（全 bad_json）`，`dayRows=54/500`；唯一「有 L1、无深层、却不在队列」的活行是 `params_01M6AGZS9K4CTQM23HV64MYF1E`（`pinned=true`）——**保护行不入队是批次39/40 既定口径，不是漏**。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-P1 端壳接线（一行） | `src/electron/main.ts` 的 `IPC.l0RebuildRun`：`l0:rebuild-run` 动作日志之后补 `if (report.purged > 0) void reconcileRefineQueueDir('l0-rebuild')`（**purged=0 是常态，不为此白扫整本账本**），并把 `reconcileRefineQueueDir` 的头注释改为「覆盖四条硬删通道」 | 与另三条通道同为**接线级**：判定本体 `reconcileAndPersistRefineQueue` 已由批次41-H 覆盖（注入 load/save + 落盘计数）；`why=l0-rebuild` 的 `kernel:refine:queue-reconciled` 需真点 REBUILD 才出，属口令闸门，本批**未点** |
| 41-P2 不改的部分 | `rebuild.ts` 本体不动（核心模块不持有队列目录，`refineQueueDir` 归端壳）；落盘与日志闸门不动（仍只在真摘到才写盘）；批次28-A 的浏览器 HTTP 数据面 `deleteMemory`（`src/home/server.ts:87`）不接对账——那是第二个进程，桌面端在跑时它是只读镜像（删会被拒），它单独持锁写入时留下的幽灵由下次启动全量对账自净 | `npm run verify:fast` 全绿：**147 文件 / 1733 例**，typecheck 干净、oxlint **0/0**、索引已刷新（306 文件）、覆盖率 Statements 81.76% / Branches 73.98% / Lines 84.83% |

> 诚实边界（批次41-P）：① 本条只把 REBUILD 从「靠重启自净」变成「当场自净」，**没有新增删除语义**；② 复查数字是**运行中快照**（应用正在补炼，`pending`/`dayRows` 每分钟都在变），不可当静态基线引用；③ 该接线**不在用户机运行的产物里**（安装包建于 10:17:07，本条改于其后），要生效需重新打包。

## 批次41-L（2026-11-04）：MCP 机器令牌全量轮换 —— **零代码改动的运维**，但先量出「只换一家」不成立

> 起因：DSH 的 MCP Bearer 自 2026-10-31 泄露一直没换（41-L 立项时挂在手测报告 §6）。用户指令「轮换 DSH MCP Bearer 令牌」，先量架构：`loadOrCreateMcpToken()`（`src/electron/main.ts:507-519`）只在 bootstrap 跑一次，**同一个值**喂 MCP TCP 8202、HTTP 8204、webhook 8203 与 `registerMcpClientsIpc(mcpToken)`；`assertMcpToken()` 只回一个字符串。而 `deepseek-harness` 配方 = `configPath:null` + `inheritsFrom:'qoder-cn'` + `writable:true`（批次28-B）——DSH **没有自己的配置面**。→ 结论：不存在「只换 DSH」这条路径，把这条摆出来后用户改口径为「全量换 + 全量重写」。真正的按客户端/成员隔离令牌属批次41-K/45-B 方案（未实现）。

| 步骤 | 做了什么 | 怎么验 |
|---|---|---|
| 41-L1 退出与换值 | 向持写锁主进程发 `CloseMainWindow()` → 走 `before-quit`（落盘 + 清内存 L0 密钥）→ `memories.db.json.lock` 自行释放；`mcp-token.txt` 由 `randomBytes(32).hex` 新值 tmp+rename 原子替换 | **旧值全程零落盘**（草稿脚本原本要把旧令牌另存一份给下一步用 = 白轮换，跑之前删掉了该逻辑）。新指纹 `6fef9c55022c`、退役值 `005925732bce`（sha256 前 12 位，**都不是令牌本身**） |
| 41-L2 用生产函数重写客户端 | `wireMcpClient(id, token, { currentToken })`（`src/electron/mcpClients.ts`，纯 Node，`node --experimental-strip-types` 直接 import）逐家跑 `qoder-cn`/`claude-code`/`codex`/`trae-cn`/`workbuddy` + `deepseek-harness`（委托宿主真写）——每份先 `.bak-<ISO>` 再合并，冲突/坏文件按批次23 口径拒绝 | 5 份备份：`settings.json.bak-2026-11-04T02-50-59-433Z` / `.claude.json.bak-…-435Z` / `config.toml.bak-…-438Z` / `Trae CN/User/mcp.json.bak-…-443Z` / `.workbuddy/mcp.json.bak-…-445Z`；**现役 5 份配置里退役值命中 0/5** |
| 41-L3 DSH 私有配置 | `dsh-bundles/dsh-memagent-mcp/cordis.patch.yml`（被 `.gitignore` 的 `/dsh-bundles/` 覆盖，**绝不提交**）按「恰好一个 64 位 hex」守卫替换 | mtime 10:51:17，文件内唯一 hex64 指纹 = 新值 |
| 41-L4 重启与探针 | 安装包产物 10:51:48（UTC+08:00）起来，写锁 `{"pid":38552}` | `[bootstrap:mcp-token-ready]`（只带 `file`，无值）、`kernel:audit:log-open rows=11958`、`refine:backfill-scan pruned_ghosts:0`；探针：**新令牌 Bearer 200（响应体不含令牌明文）· 错令牌 401 `-32001` · 无凭据 401 · 新令牌走 `x-mcp-token` 200 · webhook 8203 无令牌 401** |

> 诚实边界（批次41-L）：① **退役值仍在上面 5 份 `.bak-*` 里**（备份原文件是 `wireMcpClient` 既定行为，批次26-B P2-15 只保留最新 3 份）——它已不能访问任何东西，但要连备份一起清干净得手工删，本批没替用户删；② `mode:0o600` 在 Windows 上 `fs.statSync().mode` 报 **666**（应用首次写入也是这个值，真实权限看 NTFS ACL），属既有表现；③ `bootstrap:mcp-token-ready` **只进 `main.log`、不进 `actions.log`**（同 41-B 的 `forgetting:cycle` 一类观测缺口，本批未顺手改）；④ **本会话 Qoder 侧连接器无实测证据**（该工具在本次会话不可用），「重载 Qoder 后自动用上新令牌」是推断；⑤ 单令牌仍是机器级凭据（拿到即全库 + §1.1 召回），41-K/45-B 才是根治；⑥ 换令牌**必然**让所有旧配置立刻 401，所以「全量重写」不是可选项——只换不重写等于把所有 Agent 断在外面。

## 批次41-D（2026-11-03）：采集器失败指数退避 + 上限（P1-12）

> 实测（grep `backoff` 于 `main.ts` 0 命中）：采集 reconciler 每 5min 跑一轮，单轮 `catch` 只 `mlog('collector:…:error')` 后原样等下一次定时。L0 写密钥锁定（或任何持续故障）时**同样的失败每 5min 重演一次**，日志与错误长期空转、无退避、无上限。
> 目标：失败按指数退避（5min→10→20→40，钳到上限 2h）；连续失败 N 轮（缺省 6）后**停自动重试**，UI 只留「上次失败原因 + 手动重跑」；成功即退避归零。退避状态机收进纯函数，主进程只接线；`collector:backoff` 动作日志只带原因码。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-D1 退避状态机（纯函数单一真源） | `src/core/memagent/sessionCollector.ts` 的 `createReconciler`：`onScan` 抛错=本轮没推进 → `consecutiveFails++`、`nextEligibleAt = now + min(backoffCapMs, intervalMs·backoffFactor^fails)`；心跳 tick 用 `now() < nextEligibleAt` 门控（固定 base tick，跨窗才起跑）；`consecutiveFails ≥ maxConsecutiveFails` → 清心跳停自动重试；成功即归零 + 若曾停则重启心跳。新增选项 `backoffFactor`（缺省 2）/`backoffCapMs`（缺省 2h）/`maxConsecutiveFails`（缺省 6）/`now`（注入时钟，测试用）+ 回调 `onRoundFail`/`onAutoRetryStopped`/`onRecover`（只带原因码/轮数/间隔，绝不带正文）+ `Reconciler` 增读 `consecutiveFails`/`autoRetryStopped` | `sessionCollector.test.ts` 新增「批次41-D」describe 5 例：失败→指数退避且下一次心跳在窗口内被门控、跨窗才再跑 / 退避间隔封顶到 `backoffCapMs` / 连续失败达 `maxConsecutiveFails` 停自动重试且清心跳（tick 不再跑） / 失败后成功恢复退避归零并重启心跳（新增一份 timer） / 成功轮直接归零 |
| 41-D2 端壳接线 | `src/electron/main.ts` §5.1：`COLLECTOR_BACKOFF_CAP_MS=2h`/`COLLECTOR_MAX_CONSECUTIVE_FAILS=6`；`onScan` 末尾 `!canAdvance`（L0 锁定致 apply 失败 / commit 失败 / 有写失败）时**抛错**（原因码 `apply_failed`/`commit_failed`/`write_failed`）让 reconciler 计为失败并退避；三个退避回调各落 `collector:backoff`/`backoff-auto-stopped`/`backoff-recovered`（`mlog` + `actionLog('collector',…)` 双写，值只有 `fails`/`delayMs`/`reason`）；`collector:status` 回显 `consecutiveFails`/`autoRetryStopped`/`last`（上次失败原因）；`collector:trigger-now` 手动重跑走同一退避记账、回显 `advanced`、成功后自恢复心跳 | handler 是**接线级**（`onScan` 补抛 + 三回调 + 状态回显），纯函数退避状态机由 41-D1 的 5 例覆盖，接线需手测报告实机核对 `collector:backoff` 动作日志 |
| 41-D3 日志页人话标签 | `src/web/Home/programLogLabels.ts`：新增 `collector:backoff / backoff-auto-stopped / backoff-recovered` 三条中文标题；`NOTE_KEYS` 补 `fails / delayMs / prevFails / capMs`（值只有数字与原因码，无正文） | `programLogLabels.test.ts`（`actionTitle` 命中断言，无新增计数断言） |

> 门禁（批次41-D 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；全量 `vitest run` **147 文件 / 1723 例**全绿；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-D）：① 退避只在「**onScan 真的抛错**」时触发——41-D 前主进程 `onScan` 从不抛错（`canAdvance` 只影响游标推进），退避是靠本批次在 `onScan` 末尾对 `!canAdvance` **补抛错**才真正接上的，没这条补抛 reconciler 永远看到「成功」；② 门控粒度是**心跳节拍**（固定 5min tick）而非精确到退避值——退避窗口内的 tick 直接跳过，实际起跑取「≥ nextEligibleAt 的下一个 5min 心跳」，非精确到毫秒（为保持注入定时器接口不变）；③ 手动 `trigger-now` 与清空重采的追采循环也走同一 `noteRound` 记账，会累加/清零退避计数（「真失败就该退避」的诚实口径）；④ 主进程退避接线是**接线级**，纯函数退避状态机由 5 例覆盖，接线需手测实机核对 `collector:backoff` 动作日志。

## 批次41-E（2026-11-03）：主窗口创建失败必须报错并退出（P1-6）

> 实测 `main.ts` 的 `new BrowserWindow` catch 分支：`mlog('bootstrap:window-failed')` 后 `return`——不走 `handleBootFailure`、不退出。用户表现「双击没反应」，进程存活并持单实例锁，只能杀进程恢复。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-E1 catch 分支报错并退出 | `src/electron/main.ts` §11 `bootstrap()`：catch 里 ① `mlog` 保留；② 补 `actionLog('app','bootstrap:window-failed',{ error, logPath: MAIN_LOG }, { level:'error' })`（此前只进 `main.log`，`actions.log` 查不到）；③ `dialog.showErrorBox('主窗口创建失败', 原因 + MAIN_LOG 路径)`；④ `app.quit()` 真退出（`return` 兜住后续 `win.webContents` 不空跑） | **主进程接线级**（`BrowserWindow`/`dialog`/`app` 无法在 vitest 真起窗口），无单测；实机核对：模拟窗口创建失败 → 弹错框 + `actions.log` 有 `app:bootstrap:window-failed` + 进程退出释放单实例锁 |
| 41-E2 日志页人话标签 | `src/web/Home/programLogLabels.ts`：新增 `app:bootstrap:window-failed` 中文标题；`NOTE_KEYS` 补 `logPath`（值只有路径，无正文） | `programLogLabels.test.ts`（`actionTitle` 命中断言，无新增计数断言） |

> 门禁（批次41-E 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；`programLogLabels.test.ts` 12 例全绿。
> 诚实边界（批次41-E）：① 靠 `app.quit()` 退出（而非 `process.exit`）——保留 `before-quit` 钩子（清内存 L0 密钥），失败启动时 L0 本未解锁，走标准退出路径即可；② 本改动的价值在「**可见 + 可诊断 + 可退出**」，没有自动化测试，实机验证归手测报告。

## 批次41-F（2026-11-03）：备份目录校验 + 删除只认本配方产出的文件（P1-8）

> 实测 `main.ts`：`backupChooseDir` 拿到原生目录选择结果后只 `normalize()` 就直接落 `backup-config.json`，**没有与数据根同规格的绝对路径/UNC/相对路径/可写性校验**；`rotateBackups` 在该目录内按前缀 `selectBackupsToDelete` 匹配删除——`selectBackupsToDelete` 此前只认「前缀 + 扩展名」，管理员把目录配错（指到 `memories-export/` 或某个装着别人 `memories-*.json` 的共享目录）就会把**非本配方产出的同名文件**也删掉。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-F1 删除只认「本配方产出的确切文件名」 | `src/electron/backupFiles.ts`：新增纯函数 `isRecipeBackupName(name)`（`<前缀><合法UTC时间戳段><扩展名>` 三者齐全才算本配方产出，时间戳段用 `planBackupFiles` 同一形态 `YYYY-MM-DDTHH-MM-SS-mmmZ`）；`selectBackupsToDelete` 在「前缀 + 扩展名」基础上**追加 `isRecipeBackupName` 门**——前缀匹配不再单独作为删除依据，共享目录里外来的、恰好同前缀但中间非时间戳的文件（如 `memories-notes.json`）不碰 | `backupFiles.test.ts` 批次41-F 两例：`isRecipeBackupName` 认形状（非时间戳/缺完整段→假）；`selectBackupsToDelete` 混入 `memories-notes.json` 时只删本配方最旧一份、外来文件保留；全外来→一个不删。改后旧例 `memories-a.json/b.json` 不再当备份滚（本批次已按时间戳形状改名） |
| 41-F2 落 `cfg.dir` 前做与数据根同一套校验 | `src/electron/main.ts` §6：`backupSaveConfig`（手动改 dir）与 `backupChooseDir`（原生选择）保存前都走 `validateDataRootPath`（绝对/拒 UNC·相对）+ `ensureDirWritable`（可写探针，复用 `dataRoot.ts` 的真源），拒绝时**如实报错、不落配置**，并落 `backup:dir-invalid` / `backup:dir-unwritable`（mlog，含配置者与原因，无正文） | **主进程接线级**：校验真源在 `dataRoot.ts`（已有单测），备份两条 handler 是各几行接线；实机核对——配 UNC/相对/不可写目录 → IPC 返回 `ok:false` + 明确原因、`backup-config.json` 未变；配正常目录 → `backup:config-saved` 带 `dir` |

> 门禁（批次41-F 收口）：`npm run typecheck` 干净；`backupFiles.test.ts` **15 例全绿**（新增 41-F 两例 + 修正 1 例）；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-F）：① `isRecipeBackupName` 只能挡住「**形状不像本配方**」的外来文件（中间非时间戳段）；若共享目录里是**另一个实例产出的合法时间戳形状**备份，按名字仍无法区分归属——这属于「不该把多实例指向同一备份目录」的使用口径，本批次不为此引入实例指纹（会破坏既有备份文件的兼容性）；② 41-F 的删除收口落在纯函数 `selectBackupsToDelete`，`rotateBackups`（main.ts）直接调用它，无额外删除路径；③ 两条校验 handler 的接线无自动化测试直接覆盖（校验真源有单测），实机核对归手测报告。

## 批次41-G（2026-11-03）：审计遗留三条小修 —— 全量评审 `AUDIT-FULL-REVIEW-2026-10-31` 里 #7/#11/#12 三条

> 收口 2026-10-31 全量评审里三条未修的遗留小项，均为**局部卫生**，不动行为口径：#7（e2e 强杀 CDP 端口进程树可能误杀用户自己的 Chrome）、#11（动作日志尾读用 `Buffer.allocUnsafe` 且忽略 `readSync` 实读长度）、#12（静态服务 `decodeURIComponent` 未捕获畸形 `%` 序列的 `URIError`）。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-G1 e2e 强杀前先验归属（评审 #7） | `e2e/global-setup.mjs`：新增 `exePathOfPid(pid)`（Windows 走 PowerShell 查 `Win32_Process.ExecutablePath`、Linux 读 `/proc/<pid>/exe`、取不到返回 `null`）+ `isPlaywrightExe(path)`（与 `chromium.executablePath()` 相等、或路径含 `ms-playwright`/`.local-browsers` 缓存特征才认「本仓库」）；旧实例占用 CDP 端口时**先确认可执行路径属于本仓库 Playwright 浏览器才 `taskkill /T`**，否则**不启动并抛出明确指引**（释放端口或设 `E2E_CDP_PORT`），绝不连用户 Chrome 标签页一起杀 | 无单测（e2e 引导脚本）；`node --check` 语法过；实机核对——占 9222 的是系统 Chrome 时 E2E 报「非本仓库进程占用，请释放/换端口」而非杀掉；占的是上轮残留 Chromium 时正常清掉续跑 |
| 41-G2 尾读不用 `allocUnsafe` 且尊重实读长度（评审 #11） | `src/electron/actionLog.ts` `readTailLines`：`Buffer.allocUnsafe(readBytes)` → `Buffer.alloc(readBytes)`，并把 `readSync` 返回值接住、只取 `buf.subarray(0, read)` 再转字符串——短读（文件在读前缩小等）不再把未初始化堆内存/池化旧数据混进日志窗口（与 `auditLog.readFrom` 同一口径） | `actionLog` 尾读既有单测仍绿（1725 例全过）；行为对正常文件不变（`read == readBytes` 时子串=整段） |
| 41-G3 静态服务 `decodeURIComponent` 捕获 `URIError`（评审 #12） | `src/electron/main.ts` §7 `startStaticServer`：请求行 `decodeURIComponent` 包 `try/catch`，畸形 `%` 序列（`URIError`）→ 回 `400 bad request`，不再让未捕获异常打断整个请求回调 | 正常请求路径不变；`curl 'http://127.0.0.1:<port>/%zz'` 得 400 而非服务端崩溃 |

> 门禁（批次41-G 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；全量 `vitest run` **147 文件 / 1725 例**全绿（Statements 81.73% / Branches 73.89% / Lines 84.81%）；`node --check e2e/global-setup.mjs` 过；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-G）：① 41-G1 的判定是「**能确认是本仓库才杀，确认不了就不杀**」——`exePathOfPid` 取不到路径（如 PowerShell 不可用、macOS 无 `/proc`）时按「非本仓库」处理，宁可让本次 E2E 失败并给指引，也不误杀；这是**保守默认**，代价是「确实是我们残留但路径查不到」时会拦一次（此时设 `E2E_CDP_PORT` 换端口即可绕过）；② 41-G2 只改读取缓冲与实读长度，**不改尾读窗口口径**（仍 128KB / 50 行、跨轮转回退）；③ 41-G3 只收口**主进程静态服务**这一处评审点名的 `decodeURIComponent`，e2e 测试脚手架（`dev-server.ts`/`servers.ts`）与 `agentOnboard/server.ts` 里的同类调用**不在本条评审范围内、未动**（测试脚手架是随机端口一次性、agentOnboard 侧由外层 try/catch 兜底）。

## 批次41-H（2026-11-03）：补齐两处「接线级」自动化测试 —— 把主进程里「只在真改到才落盘」与「向导强制与否」的判定收成可测纯函数

> 41-C / 41-A 收口时留了两处**接线级缺口**（主进程 handler 的接线没有自动化测试直接覆盖，归 41-H）：① §6f 补炼接线——删除/清空重采/规则重判后「摘除补炼队列幽灵条目，**且只在真摘到才落盘 + 记日志**」；② 向导主进程判定——指针缺失/损坏/老指针没 `setupDone` 时**必须**进向导。此前这两处判定都写死在 `main.ts`（无法在 vitest 里 import Electron），逻辑靠实机走查。41-H 把**判定本体**提成纯函数、`main.ts` 退成薄接线，判定就有自动化覆盖。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-H1 补炼「对账/单删 + 是否落盘」判定提成纯函数 | `src/core/memagent/refineQueue.ts`：新增 `reconcileAndPersistRefineQueue({queueDir,liveIds,now,load,save})` 与 `removeRefineQueueRowAndPersist({queueDir,id,now,load,save})`——`load`/`save` 由调用方注入（本模块不碰文件系统），返回 `{pruned/removed, persisted, state}`，把「`queueDir` 未就绪不碰盘 / 无幽灵不落盘（幂等）/ 真摘到才 `save` 一次」这三条分支收成**一个可测口径**；`main.ts` §6f 的 `reconcileRefineQueueDir`（reset/rejudge 后全量对账）与 `removeRefineQueueRow`（`storage:deleteMemory` 成功后的单删热路径）改成直接调它，行为不变（同落盘闸门、同 `refine:queue-reconciled` 日志键） | `refineQueue.test.ts` 新增「批次41-H」describe 2 例：`reconcileAndPersistRefineQueue` 有幽灵→落盘 1 次且清掉 ghost、无幽灵→不落盘、`queueDir:null`→连 load 都不碰；`removeRefineQueueRowAndPersist` 真摘到→落盘 1 次、再摘幂等不落盘、`queueDir:null`/`id:''` 一律不碰（注入式 load/save + 落盘计数器断言） |
| 41-H2 向导主进程判定提成纯函数 | `src/electron/dataRoot.ts`：新增 `wizardRequired(read: DataRootPointerRead): boolean` = `!isSetupComplete(read.status==='ok' ? read.pointer : null)`——把「`readSetupPointer`（读指针）→ 判缺失/损坏 → `isSetupComplete`」三步收成**单一判定**（missing/corrupt 当 `null` → 一律进向导）；`main.ts` 的 `isWizardIncomplete` 改成读指针后直接调 `wizardRequired`（读指针这步仍留在端壳，因为 `DATA_ROOT_POINTER` 是主进程常量） | `dataRoot.test.ts` 新增「批次41-H」describe 4 例：指针缺失/损坏→`true`；老指针没 `setupDone`（只两库目录）→`true`；`setupDone` 但缺库目录→`true`；**唯一放行**（两库目录 + `setupDone` 齐全）→`false` |

> 门禁（批次41-H 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；全量 `vitest run` **147 文件 / 1731 例**全绿（Statements 81.75% / Branches 73.91% / Lines 84.82%）；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-H）：① 41-H 补的是**判定本体的接线级覆盖**——把「是否落盘」「是否进向导」这两条主进程分支提成纯函数后就有单测；但 **`main.ts` 里 IPC 通道本身怎么把 `storage:deleteMemory` 成功回调接到 `removeRefineQueueRow`、reset/rejudge 执行完接到 `reconcileRefineQueueDir` 这层「调用顺序」仍无自动化测试**（需要真起 IPC + 会话 + 内核，属 E2E/实机口径，未在本批次伪造）；② 纯函数提取**不改变既有行为**（落盘闸门、日志键、`refine:queue-reconciled` 口径全部照旧），只是把原本内联在 `main.ts` 的三行判定挪进 `refineQueue.ts`/`dataRoot.ts` 的单一真源；③ `wizardRequired` 仍不含 L0 密钥环/写密钥的状态——向导门禁口径是「指针三件事」，与 `isWizardIncomplete` 旧口径一致，未借本批次扩张判据。

## 批次41-O（2026-11-03）：删除通道如实告知「连带销毁 N 条 L0 原文」（用户口径 B：只告知、不改「删除即销毁 L0」的存储语义）

> 41-C 收口时留了一笔账：三个删除通道（`ledgerReset` 清空重采 / `rejudge` 规则重判 / 手动删行）对账本是**硬删**，而 `FileStorage.deleteMemory` 本就**同步删 L0 密文**（批次36/37 设计）。用户口径 B 明确**不反转**存储语义（删除即销毁 L0，不保留），所以问题不是「该不该销毁」，而是「**销毁多少原文，用户事前不知道**」——`RejudgePreview` 此前没上报待删行里带 L0 原文的条数，卡片也没提示「这些原文删了就回不来」。41-O 只补**告知**这一层：把「连带销毁 N 条 L0 原文」在两张卡的预览 / 确认 / 回执三处明写，并把数字带进审计与动作日志；删除/销毁逻辑一字不动。

| 步骤 | 改了什么 | 怎么验 |
|---|---|---|
| 41-O1 重判预览/回执上报带 L0 原文的待删行数 | `src/core/memagent/rejudge.ts`：`RejudgePreview` 新增 `with_l0_cipher: number`——**只计「将删且非受保护且带 L0」的行**（`purge && !protected && hasL0Source`；受保护行执行会跳过、其 L0 存活不计，放行/缺 L1 行不删不计）；判据 `hasL0Source`（行上明文 `content_orig` / 已拆 `content_l0_enc` / `has_l0` 标记）与 `ledgerReset.ts` 的 `hasText` 判据同源；`summarize()` 只在「purge 且非受保护」分支累加；整轮 `security_change/op=rules_rejudge` 审计 detail + `main.ts` 的 `rules:rejudge-run` 动作日志都带上 `with_l0_cipher` | `rejudge.test.ts` 新增批次41-O 1 例（受保护 purge / 放行 / 缺 L1 一律不计，只 1 条「将删且带 L0」计 1）；`RulesRejudgeCard.test.tsx` 补 `with_l0_cipher` 断言 + 「警告出现 / 为 0 时不出现」正反例 |
| 41-O2 两张安全页卡三处明写 | `src/web/security/RulesRejudgeCard.tsx`：预览区 `with_l0_cipher>0` 出红字 `rules-rejudge-l0-warn`（「N 条待删行带 L0 原文：删除同步销毁其 L0 密文，且不能按 L0 重建找回，唯一退路是备份目录」）+ 确认区补一句 + 回执区 `rules-rejudge-l0-receipt`（「连带销毁 N 条 L0 原文」）；`src/web/security/LedgerResetCard.tsx` 同口径出 `ledger-reset-l0-warn` / 确认区 / `ledger-reset-l0-receipt`（其预览内联计数原就有，本次补警告块与回执块） | `LedgerResetCard.test.tsx` 预览用例补 `ledger-reset-l0-warn` 断言（含「5」「L0」「备份目录」）；两卡 testid 与文案由单测锁定 |
| 41-O3 文档校正「按 L0 重建」适用范围 | AGENTS §9 批次37-E 边界补 ⑤、批次39 分工补 41-O 边界；本文件 37-E 行补「适用边界」引注；`specs/需求规格书.md` 同步——统一写明：**重建救整份 L1–L6 库丢失/要重造，救不回逐行删除**（逐行删除的 L0 原文已同步销毁，重建只能按「取不到原文」跳过，退路只有执行前备份） | 三处文档与卡片口径一致，无「删一行还能靠重建找回」的误导表述 |

> 门禁（批次41-O 收口）：`npm run typecheck` 干净；oxlint **0 warnings / 0 errors**；全量 `vitest run` **147 文件 / 1733 例**全绿（Statements 81.76% / Branches 73.98% / Lines 84.83%）；`npm run code:index -- --write` 306 文件且 `:check` 最新。
> 诚实边界（批次41-O）：① **不改存储语义**——删行同步销毁 L0 密文仍是既定行为（口径 B），本批次只把它从「静默」变「事前明写」；② `with_l0_cipher` 在 `rejudge` 里只数**会删的那部分**，而 `ledgerReset` 是整库清空、其 `scanLedgerForReset` 早已报全库带 L0 行数——两者口径不同（选择性删 vs 全删）但都诚实，未强行拉齐；③ 受保护行（pinned/locked）执行时跳过、其 L0 存活，故**不计**进 `with_l0_cipher`，避免「会销毁」被高估；④ 「备份目录是唯一退路」在卡面与文档都点明，本批次不提供新的找回通道。

## 批次41-J（2026-11-03）：未接线三件套立项方案（**只出方案、不实现**）

> 完整方案在 `specs/ROADMAP-批次42-未接线三件套-方案.md`（本行只留指针与实测结论，不复述全文）。三件「未接线大项」= 云端同步 / 每日全量补齐 / 独立采集守护进程；**均为增量能力，不做不影响现有数据正确性**。
>
> **实测结论（2026-11-03 只读，非推测）**：① 云端同步**核心已写好且已测**（`sync.ts` 的 `SyncHub`+三端引擎+§9.7 裁决、`pgSyncHub.ts` 基于 `@electric-sql/pglite` 进程内 Postgres、可传 `dataDir` 落盘），但 `src/electron/` **0 处**引用、内核入口 `agent.ts` 的 `sync()` 仍 `E_NOT_IMPLEMENTED`（`agent.ts:253-264`）；② §3.4 `reconcile()` 引擎存在但**无调度**（`FORGETTING_INTERVAL_MS` 是 6h 遗忘周期，不是每日对账）；③ 采集/遗忘/补炼全在**主进程内** `main.ts` 的 `setInterval`，**桌面端没开就没在采**。
>
> **拆分建议（供后续排期，不代表已排期/已实现）**：42-A 内核 `sync()` 接真 → 42-B 端壳 `PgSyncHub` 持久化 + `sync:*` IPC → 42-C 三端引擎 + §9.7 裁决 UI → 42-D 备份/迁移收口；43-A 每日全量 `reconcile`（依赖 42）；44-A 采集抽无头守护 → 44-B 双写者锁协同。**前置**：多端 `team_id` 隔离依赖 **41-K 的账本租户归一**，建议 41-K 先于 42。
> 诚实边界（批次41-J）：本批次**只写方案**，未改任何 `src/` 代码、未触发实质 `verify` 逻辑变化；方案里的「每日 / 每 6h / 15s」等数字取自当前 `main.ts` 实测，非目标值；中枢落地形态（单机 pglite 文件 vs 远端 PG）是 42 的第一道拍板口，方案未替用户定。

## 批次41-K（2026-11-03）：令牌与租户欠账立项方案（**只出方案、不实现**）

> 完整方案在 `specs/ROADMAP-批次45-租户归一与成员密钥域模型-方案.md`（本行只留指针与实测结论）。两条欠账 = **账本租户归一（MCP 作用域收紧的前置）** + **成员/API 密钥内核域模型**；**不处理不影响单机数据正确性**（MCP 现在是「单令牌 + `['*']` 全放行」的已知接受取舍），但做多租户硬隔离前必须先做 45-A。
>
> **实测结论（2026-11-03 只读，非推测）**：① 渲染层 `getTenant()` 首次**现造** `u_<ulid>/team_local/ent_local`（桌面壳内被 `syncTenantFromHost` 会话真值覆盖，纯浏览器仍现造）；② 采集器/MCP 写账本用**写死** `u1/t1/e1`——**同一份 `memories.db.json` 混住多租户身份**；③ `McpAccount.scope_project_ids` 默认 `['*']`（`mcpAuth.ts` 冻结，机器级单令牌），`projectInScope` 已写好且 `mcpScope.test.ts` 8 例覆盖，**差的是账本租户一致才敢收紧**；④ 内核**无**「成员/API 密钥」域模型（只有 `Account` 写三元组 + L0 授权的 `grantee_user_id`/`scope_project_ids`），home 侧 `admin/member` 角色与内核**未绑定**。
>
> **拆分建议（供后续排期，不代表已排期/已实现）**：45-A 账本租户归一（单一租户真源 + 数据根规范三元组 + 存量归一迁移走备份闸门）→ 45-A3 才收紧 `McpAccount.scope_project_ids`；45-B 成员/API 密钥域模型（`Member`/`ApiKey` 真实空表，`ApiKey.secret` 只存哈希、绑定 member，复用 45-A 归一租户，把单一机器级令牌升级为「member 的 API key」）。**依赖**：45-B 依赖 45-A；45-A3 依赖 41-J/42 是否做多机（单机可先只做 45-A1/A2）。
> 诚实边界（批次41-K）：本批次**只写方案**，未改任何 `src/` 代码；`u1/t1/e1` 与「现造 `u_<ulid>`」为当前实测口径，一旦 45-A 落地这些写源都要改，本行数字仅作现状记录。

## 批次41-Z（2026-11-04）：批次41 收口 —— 全量门禁、打包，以及**第一次让批次41 的代码在用户机上跑起来**

> 这一节不是「又改了什么代码」，而是**把 41-A…41-O 从「仓库里有」变成「用户机上正在执行」**。收口前的实测事实：数据根写锁里 pid=19008 的可执行路径是 `release/installer/win-unpacked/`，即批次40-E 于 2026-11-03 14:32 产出的那份包，其 `app.asar` 里 `grep audit.jsonl` **0 命中** → 41-A 的 `FileAuditLog` 根本不在运行的二进制里。所以 41-A 的存量迁移、41-C 的启动对账、41-D/E/F/O 全部**只存在于源码，从未执行过**。
>
> **两步落地**：① `npm run build && npm run build:electron && node tools/package-win.cjs` 出便携产物 `release/win-unpacked/`（该目录不碰正在运行的 `release/installer/`，也不产出安装包），`CloseMainWindow` 优雅退出 pid 19008 后启动 → 10:08:50（UTC+08:00）闸门自跑；② `npm run verify` 全链绿后 `npm run package` 出 NSIS 包，`release/installer` 换成含批次41 的产物，10:18:33 第二次启动做幂等复验。
>
> **真机证据（全部来自数据根，只读核对）**：
>
> | 项 | 实测值 |
> |---|---|
> | 41-A 备份闸门 | `kernel:audit:log-backup` → `backups/audit-log-split-2026-11-04T02-08-50-029Z`，**3 源**（迁移前的 `memories.db.json` 14,283,011 B 快照、`memories.l0.json`、`l0-keyring.json`）；当时 `audit.jsonl` 尚不存在，故**没有第 4 源**（配方按「缺哪个源就明写缺哪个」执行，不是漏备） |
> | 41-A 迁移 | `kernel:audit:log-migrated` `migrated_rows=11847`；`audit.jsonl` 3,067,402 B、**11,847 行逐行 `JSON.parse` 通过、0 坏行**；`doc.audit` 长度 **0**；库文件 14,283,011 → 11,215,610 B（**−3.07 MB**）；记忆行数 1532 未变 → **审计条数迁移前后相等，`queryAudit` 全量口径没丢行** |
> | 41-A 幂等 | 第二次启动 `kernel:audit:log-open` rows=11855、`legacy_rows_in_ledger` 已空 → **不再出现 `log-migrated`**（与 `fileStorage.test.ts` 那条「二次启动不重复」用例同口径，真机成立） |
> | 41-A 追加中 | 迁移后 `audit.jsonl` 11,847 → 11,856 行持续增长（`memory_op` 新行），写锁由新产物持有 → 追加式账本不是「搬完就静止」 |
> | 41-C 对账 | 首次启动 `kernel:refine:backfill-scan` `pruned_ghosts:**124**`（队列 1655 → 1531 条，幽灵现量 0）；第二次启动 `pruned_ghosts:0` = **幂等** |
> | 时延收益 | **本机无足量样本**：迁移后 `ipc:storage:putMemory` n=0、迁移前 n=3（中位 165 ms）。复刻实验的 28.7 倍**不得**当本机实测值引用 |
> | 41-D 退避 | 今日 `collector:backoff*` **0 命中**（采集器一直成功推进）→ 只有单测 5 例，**未被真机实证** |
> | 41-B 摘要行 | `main.log` 里 `forgetting:cycle` 共 **33 条**，最近一条 09:55:31（UTC+08:00）`summaries_created:0`（`freshness_updated:1532 migrated:16`）→ 合并组未触发（需同键 ≥3 行），**新字段仍无真机产物**；顺带确认该周期**只 `mlog` 到 `main.log`、不写 `actions.log`**（`main.ts:2972`），属既有观测缺口、不属本批次，未顺手改 |
>
> **门禁（实测）**：`npm run verify` **退出码 0** —— typecheck 干净、oxlint **0 warnings / 0 errors**、`code:index:check` 已是最新（**306 个文件**）、vitest **147 文件 / 1733 例**全绿（Statements 81.76% / Branches 73.98% / Lines 84.83%）、`build:electron` + Playwright **106 例通过（37.3s）**。安装包 `release/installer/MultiAgent Memory-0.1.0-setup.exe` **122,048,550 B = 116.39 MB**，SHA256 `E5160D30647EFC5E511D366A6BAEA2260E682869E5247691AB1DD26845A30634`，2026-11-04 10:17:07 落盘。
>
> **两条踩坑记录（下次别再误判）**：① 打包日志显示 `release/installer` 被外部进程占用（EPERM）→ 按批次21 既定路径先输出到 `release\installer-20261104-021635`、构建成功后删旧目录并**收口回 `release/installer`**，同时删掉了便携产物 `release\win-unpacked`（所以便携那份不能当长期入口，收口必须落在安装包）。② **用 `grep app.asar` 判「产物里有没有某段代码」在本项目不成立**——electron-builder 把 `dist-electron` 放进了 `app.asar.unpacked/`，asar 本体里 `grep audit.jsonl` 恒为 0（假阴性）。正确判据：`app.asar.unpacked/dist-electron/main.cjs` 的 md5 与刚构建的 `dist-electron/main.cjs` 逐字节相同（本次 `5c251652…`，`audit.jsonl` 命中 3 次），或直接看真机启动的动作日志。
>
> 诚实边界（批次41-Z）：本节的「真机已验证」只覆盖 41-A 与 41-C 两条；41-D（需一次真失败）、41-E（需模拟窗口创建失败）、41-F（需把备份目录配到非法路径）、41-O（需管理员点重判/清空预览）与 41-B（需一个真摘要行）**仍待实机走查**，步骤写在 `specs/MANUAL-TEST-FIX-BATCH-41.md` §3，没有把它们写成已验证。







### 批次41-R：明细页查看事件双写进 `actions.log`（观测入口错位，不是功能缺陷）

> 发现方式不是读代码，是**闭合 41-L 时真点了一次明细页**（2026-11-04 11:51）：`main.log` 里 `mcp:recall_detail_view` 3 条、`actions.log` **0 条**。AGENTS §4 写明「排查第一入口 = `actions.log`」，日志记录页读的也是它（`tailActionLog`）——所以「明细页到底被点开过没有」这件事对用户不可见。同型缺口此前修过两次：批次34 的 `llm:config-saved`/`llm:test-engine`、批次41-B 声明的 `forgetting:cycle`。

| 项 | 落点 | 测试 |
|---|---|---|
| 41-R1 双写接线 | `src/electron/main.ts` §11 里 `runMcpHttpServer({…, onViewDetail })`：`mlog('mcp:recall_detail_view',{outcome})` **加** `actionLog('mcp','recall_detail_view',{outcome})`（批次34 同口径）。回调签名 `'ok'\|'miss'` 由 `src/core/memagent/mcpHttp.ts:76` 定死，**一次性 id、页面正文、令牌都出不了这道口** | 接线两行本身属端壳级；判据与值形态由下一条在核心层钉住 |
| 41-R2 人话视图 | `src/web/Home/programLogLabels.ts`：动作字典新增 `mcp:recall_detail_view` = 「打开召回明细页（一次性链接）」；`NOTE_KEYS` 补 `outcome` | `programLogLabels.test.ts` 2 例：`actionTitle('mcp','recall_detail_view')` 认得新键；`detailNote({outcome,id,html})` 只输出 `outcome=ok`（id/正文不进摘要） |
| 41-R3 回调本体 | `mcpHttp.ts` 的 `GET /recall/<id>` 路由（`take()` 命中给 200 + `ok`，未命中/过期给 404 + `miss`；**不消费票据**，TTL 内可重复打开） | `mcpHttp.test.ts` 新增「批次41-R」describe 1 例：真起服务器 → `recall_memory(project_id:P1)` 取 `display.detail_url` → 打开 200、打开 `'q'.repeat(22)` 得 404，断言回调序列 `['ok','miss']` 且值域只有这两个字面量 |

> 门禁（批次41-R 收口）：`npm run verify` 退出码 **0**（typecheck 干净 → oxlint 0/0 → 索引 306 文件最新 → vitest **147 文件 / 1735 例**（本批 +2，Statements 81.76%）→ Electron 构建 → E2E **106 passed**）；`npm run package` 重新出包（122,048,686 B / SHA256 `d0f31b70a702236cfb16cc10f9ccf7a050270e23f075c50ce85ff309a4c5cadf`，12:11:56），产物 `app.asar.unpacked/dist-electron/main.cjs` 里双写两行都在、`l0-rebuild` 命中 2 次（= 41-P 同批出厂；10:17 那版包里没有 41-P）。
> **真机已验（2026-11-04 12:14，本批新产物，写锁 `{"pid":3880}`）**：真发一次 `recall_memory`（客户端自报 `verify-41r`）→ `mode=markdown-compact` + `detail_url` → 打开 **200 / 5,548 B**（页面里检索当前令牌命中 0）→ 假 id **404** → `actions.log` 该键由 **0 条 → 2 条**（`{"outcome":"ok"}` / `{"outcome":"miss"}`），`main.log` 由 3 条 → 5 条（双写、非搬移）。核对步骤与期望行见 `specs/MANUAL-TEST-FIX-BATCH-41.md` §3。
> 诚实边界（批次41-R）：① 只修观测，票据口径（30 分钟、纯内存、不消费）与闸门（Host 绑定 + 免令牌）一字未动；② 同批量到的 **41-Q 没在本批修**——`clientSupportsHtmlDetails` 判据是 `client.split('/')[0]` **精确等于 `qoder`**，本机 Qoder Desktop 自报 `qoder-desktop-mcp-host/1.0.0`，recall 审计 **0 命中**（11:51 实测 100 条、12:15 复测 102 条，含本会话为验证而发的 2 条）→ `html-details` 档从未生效；把它加进白名单的前提是「Qoder 气泡真渲染 `<details>`」，这条**尚无证据**（DSH 侧 2026-10-31/11-01 两次实测是原样吐纯文本），盲改会把失效 HTML 铺回聊天窗口，所以留待用户拍板；③ 上面那条真机验证**自己也进了账**——那次 `verify-41r` 召回在 `audit.jsonl` 里留下一条真实 recall 行（观测修复的验证必然污染被观测的计数，所以上面的数字都带时刻）。

### 批次41-S：MCP 调用方身份可跨客户端串号（**2026-11-05 已按用户拍板的方案 B 落地，取代先前的方案 A**；立案由 41-R 的真机验证顺带量出）

> 这条不是读代码读出来的怀疑，是**两次真调用打在同一台机器上撞出来的**：12:14:49 我的 Node 探测脚本 `initialize(clientInfo.name=verify-41r)`，12:21:21 Qoder Desktop 连接器真调一次召回，`audit.jsonl` 里**两行的 `detail.client` 都是 `verify-41r/0.0.1`**。

| 环节 | 真源与后果 |
|---|---|
| 判据（为什么能串） | `src/core/memagent/mcpHttp.ts:124-126` 两张表：`clientBySession`（`initialize` 生成的 sid → 自报名）、`clientByUa`（**UA → 最近一次 `initialize` 的自报名**）；取值顺序 = `Mcp-Session-Id` 命中 → 同 UA 最近一次 initialize → `clientFromUserAgent(ua)`。凡是「做过 initialize、后续请求不回传会话头」的客户端都落在同一条 UA 记录上，而 `remember()`（`:135-142`）是 delete+set → **最后一次 initialize 赢**。本机实测 **Node 的 `fetch` 默认发字面量 `User-Agent: node`**（一次性回显服务返回 `{"ua":"node","session":null}`），Electron 主进程本身就是 Node → 同机多客户端必然共键。**边界**：这段里能确证的观测只有「我的探测脚本没写会话头」和「Node `fetch` 默认 UA 是 `node`」两条；Qoder 连接器到底带不带 `Mcp-Session-Id` 服务端不落原始请求头、无法证明，所以「UA 撞车」是按取值顺序**推**出的最解释得通的一条，不是看到的（观测到的确定事实只有「两次调用的 `detail.client` 字面相同」）。 |
| 后果面 ①（展示档位） | `clientSupportsHtmlDetails(client)`（`mcpRecall.ts`）按这个自报名选三档之一 → 甲客户端可能吃到乙客户端的档位。方案 B 落地后：通用 UA 上**登记的仍是任意/探测自报名**时归为 `unknown`（不吃别人档位）；但通用 UA 上登记的是**已知产品**（如 Qoder 宿主 `qoder-desktop-mcp-host`）时保住身份 → 该客户端的气泡折叠档（`html-details`）不丢（方案 A 曾把这一档连带丢掉）。`clientBySession`（真会话头）不受影响。 |
| 后果面 ②（接入证据，最重） | `applyRecallEvidence`（`src/electron/mcpClients.ts`，批次30）按 `client.split('/')[0]` 匹配 `MCP_CLIENT_SPECS[].id`/`auditClientIds`，把 `no_config/missing_entry/missing_auth` 升成「审计检测到真实调用 N 次 = 已接入」。串号等于**把 A 的调用算成 B 的接入证据**，与 AGENTS §7.4「绝不伪造已接入」直接冲突。方案 B 后：任意/探测自报名在通用 UA 下不登记、取不到 → 审计记为 `unknown`，`unknown` 不匹配任何 `spec.id`/`auditClientIds`（`mcpClients.ts` 首段判空即 `continue`）→ 不再作为任何一家的接入证据。**残留（与展示档位同源）**：已知产品在通用 UA 上保住身份，若同机另一「不带会话头、同通用 UA」的调用被归并成那个已知产品，理论上会把它的调用算进那个产品的接入证据——彻底消除需方案 C。 |
| 方案 B 实现（2026-11-05，取代 A） | 保留纯函数 `mcpHttp.isIdentifiableUserAgent(ua)`（`node`/`curl/`/`python-urllib/`/`wget/`/`go-http-client/`/`okhttp/`/`java/`/`axios/` 与「认不出厂商词的未知 UA」判否，含厂商词判是）；**新增 `mcpHttp.isTrustedClientSelfName(client)`**（自报名首段命中「已知客户端产品表」判是）。接线两处：`initialize` 登记条件 `ua && (isIdentifiableUserAgent(ua) || isTrustedClientSelfName(selfId))`；取值顺序 `会话头 → (有辨识度 UA 或该 UA 上登记的是已知产品) 同 UA 归并 → clientFromUserAgent`。**动因**：方案 A 把 Qoder 宿主（UA=`node`、不带会话头、只靠 initialize 自报 `qoder-desktop-mcp-host`）也降成 `unknown`，连带丢了它的气泡折叠档——用户口径「能内联就内联，做不到才用 HTML 页兜底」，故 B 让**已知产品**的自报名在通用 UA 下保住身份，任意/探测名（`verify-41r`）仍不登记。TCP 8202 不涉及。**残留**：同一条通用 UA 键上若已登记某已知产品，后续「不带会话头、同通用 UA」的调用会被归并成那个产品（本机通用 UA 主要就是 Qoder 宿主一家）；彻底消除需方案 C（要求回传 `Mcp-Session-Id`）。 |
| 测试现状 | `mcpHttp.test.ts`「批次41-S 串号闸门」describe（方案 A 保留的部分）：`isIdentifiableUserAgent` 通用/未知/厂商词正反例 + 端到端串号用例（甲以 `node` 自报 `verify-contam`——任意名不在已知产品表——乙以 `node` 不带会话头调 recall 记为 `unknown`；对照组有辨识度 UA 仍归并，批次15 能力不回归）。**方案 B 新增两组用例**：① 「已知产品自报名走通用 UA、不带会话头也保住身份」——`qoder-desktop-mcp-host` 以通用 UA（`okhttp/`）initialize 后 recall（不带会话头）得 `display.mode=html-details` 且审计 `client=qoder-desktop-mcp-host/1.0.0`，并断言残留（第二次不带会话头仍归并成它）；② 「任意/探测自报名在通用 UA 下既不登记也不被归并」——`java/17` + 自报 `probe-x` → recall `client=unknown`。另 `isTrustedClientSelfName` 单独 describe 覆盖已知产品正反例（大小写/带不带版本）与 `verify-contam`/`verify-41r`/`probe-x`/`unknown`/空/undefined 判否。41-Q 白名单另在 `recallInsight.test.ts` 补 `qoder-desktop-mcp-host` 正反例。 |

### 批次41-X：显式身份头 `X-Memagent-Client`——每请求自带身份 + 一键接入把它写进每份配置（闭合批次41-S 方案 B 的残留串号）

> 动因（用户口径）：「显式身份头，要考虑其他 agent 怎么一键接入」。方案 C 原设想「要求客户端回传 `Mcp-Session-Id`」需要客户端改造、做不到；等效做法是每请求一个身份头——不共用 UA/会话这类「别人也会命中」的键，而写入通道本来就存在（一键接入已在写 `Authorization`）。**身份头只是身份，不是凭据**：鉴权仍是机器级 `Authorization: Bearer`。

| 环节 | 真源 | 测试 |
|---|---|---|
| 服务端取值（纯函数） | `src/core/memagent/mcpHttp.ts`：`MCP_CLIENT_HEADER = 'x-memagent-client'` + `clientFromExplicitHeader(raw)`——先 `normalizeClientLabel`（空白折叠 + 截 80），再要求匹配 `^[A-Za-z0-9 ._:/@+-]{1,64}$`；超限 / 控制字符 / 非字符集**不采信**（脏值不进审计），非法值退回 41-S 归并链而不是拒绝服务。数组头取首个。 | `mcpHttp.test.ts` 批次41-X 纯函数例：`['codex','other']→'codex'`、`'Trae CN'→'Trae CN'`、`'a\r\nb'→'a b'`（折叠成单空格，控制字符不原样入账）、81 字符 / `'emoji😀'` / 全空白 / `undefined` → `undefined` |
| 服务端取值顺序 | `mcpHttp.ts` 请求处理：`显式身份头 → clientBySession(会话头) → （有辨识度 UA 或该 UA 登记的是已知产品）clientByUa 归并 → clientFromUserAgent`；`initialize` 里 `selfId = declaredClient ?? clientFromInitialize(params)`，**带显式头的客户端不再占通用 UA 那条键**（`byUa = !declaredClient && …`，即 41-S 残留串号的来源被切断）。TCP 8202 无请求头概念，不走这套。 | `mcpHttp.test.ts` 批次41-X 端到端例：带 `qoder-cn` 头 → 审计 `detail.client` 与 `display.mode=html-details`；同机另一客户端以通用 UA `node`、不带会话头调用 → `unknown`（抢不走）；已知产品经通用 UA 归并仍保住身份（41-S 方案 B 用例不回归） |
| 已知产品表 | `TRUSTED_CLIENT_SELF_IDS` 补 `qoder-cn`（与配方 id 对齐） | `mcpHttp.test.ts` 的 `isTrustedClientSelfName` describe |
| 一键接入下发（写进配置） | `src/agentOnboard/mcpClients.ts`：`MCP_CLIENT_HEADER_NAME = 'X-Memagent-Client'` + `mcpHeaderPairs(spec, token)` = `Authorization: Bearer <token>` 与 `X-Memagent-Client: <spec.id>`（**值就是配方 id**：`qoder-cn`/`claude-code`/`codex`/`cursor`/`gemini-cli`/`qwen-code`/`trae-cn`/`workbuddy`/`zcode`/`deepseek-harness`）。三条路径同源：`buildMcpEntry`（真写条目）/`renderMcpSnippet`（「复制片段」，覆盖不能自动写入的客户端）/`mergeMcpJsonConfig` + `mergeMcpTomlConfig`（JSON 合并、TOML 子表与内联表两种写法）。 | `agentOnboard/__tests__/mcpClients.test.ts`：三种条目风格字段、Zcode/WorkBuddy/Trae 片段、Codex TOML 片段均断言含身份头；令牌在片段里仍只出现一次 |
| 检出 | `probeJsonConfig` 用通用 header 袋（大小写头名均可）置 `hasClientId`；`probeTomlConfig` 用 `tomlHeaderRe(MCP_CLIENT_HEADER_NAME)` 认段内子表/内联表；`McpConfigProbe.hasClientId?: boolean`（无从判定时为 `undefined`，不默认 true/false） | 同上（`missing_auth` 例断言 `hasClientId:false`） |
| 扫描与升级 | `src/electron/mcpClients.ts`：`McpClientStatus.hasClientId?`；`state==='wired' && hasClientId===false` → note 明写「能调用但身份按 UA 归并（多客户端共用通用 UA 时会串号）——点『补身份头』写入」；宿主继承（deepseek harness）的 `hasClientId` 如实取宿主并指向同一条补写路径 | `electron/__tests__/mcpClients.test.ts` 批次41-X 5 例：老配置 wired+`false`+note / 新配置 `true` / 真写补头（备份 + 令牌不动 + 二次 `changed:false` 幂等）/ Codex TOML 补头保留原有自定义头且令牌只出现一次 / 无文件面（审计证据升级来的 Zcode）留 `undefined` |
| **本批测出来的真缺陷** | `wireMcpClient` 原先 `if (probe.state === 'wired')` 直接 `changed:false` 短路——**「补身份头」按钮会点了个空响应**。现闸门改为 `probe.state === 'wired' && probe.hasClientId !== false`，缺头时继续走「备份 `.bak-<ISO>` → 合并 → tmp+rename」；P2-15「`.bak-` 只留最新 3 份」与 conflict/invalid 拒绝口径不动 | 上面那条「真写补头 + 幂等」例就是先失败后修对的（断言 `r.changed===true` 与 `existsSync(r.backupPath)`） |
| UI | `src/web/AgentOnboard/McpClientsPanel.tsx`：`needsClientId(row)`；行内按钮三态文案「一键接入 / 补齐令牌 / **补身份头**」；`canWire`/`pending`/`snippetTargets` 都把「wired 但缺头」算作待处理 → 计入顶部「⚡ 一键适配全部（自动 N）」；接通指引写明头名与配方 id；**「已写入」只在 `hasClientId === true` 时才说**（无文件面的 wired 不谎报有/缺） | `McpClientsPanel.test.tsx` 批次41-X 4 例（补身份头可点 + 指引含头名、有头时仍禁用「已接入」、一键适配把缺头行计为自动目标、`undefined` 时不谎报） |
| **不做什么** | ① 登录自动接入（`autoDiscovery.autoWireMcpForAgents`）对 `state==='wired'` 仍跳过，**不为补头每次登录重写配置**（否则备份滚动、配置文件抖动）；② 不改鉴权（机器级令牌不变，按客户端隔离属 41-K/45-B）；③ 不改 TCP 8202。 | — |

> 诚实边界（批次41-X）：① **没有替用户点「补身份头」，也没重启客户端**——用户机现役 5 份配置仍是批次41-L 那一版（有令牌、无该头），升级需出厂后在接入页点一次「⚡ 一键适配全部」或逐行「补身份头」；② 头值是**自声明不是认证**，本批消除的是「跨客户端串号」，任何进程都能自称任意 id；③ DSH 随宿主下发，其调用只会带宿主的 `qoder-cn`，**服务端无法区分宿主与随宿主下发的 DSH**；④ 不带该头的调用与批次41-S 行为完全一致（向后兼容，无回归）。

### 批次41-W：L0 写密钥未解锁的失败提示 + 就地解锁入口（回答「写密钥能否增加一个有失败提示功能，提示用户输入密码打开」）

> 动因（用户口径）：L0 写密钥锁定期间（重启后未解锁 / 会话超时 / 显式锁定），**每一笔** L0 写入都抛 `E_L0_LOCKED`（明文绝不落盘，§4.4.4）——但原先用户看不出「为什么没写进去」，只能去安全页盲解锁。41-W 把这条失败**做成可见 + 就地可解**，且**不新增任何带权限的读路径**：提示由「一次真实写入失败」驱动，不是主动轮 `l0:status`（它仍是 requireAdmin），密码经 `l0:writeUnlock` 走既有管理员闸门，落不进日志。

| 环节 | 真源 | 测试 |
|---|---|---|
| 判据（单一真源，不许各处写正则） | `src/core/memagent/errors.ts`：`isL0LockedError(e)`（`MemAgentError` 认 `code==='E_L0_LOCKED'`；非 `MemAgentError` 走 `isL0LockedText` 文本判据）+ 导出纯函数 `isL0LockedText(text)`（`includes('E_L0_LOCKED')`）。采集器 / 端壳 / 首页异常派生**共用这一个判据**，不再各写一遍。 | `__tests__/l0LockedError.test.ts` **6 例**（认 code / 认 message / `MemAgentError` 以 code 为准不误判 / 普通写失败不冒充 / null·undefined·裸对象 / 纯文本判据） |
| 采集器（区分「写密钥锁定」与「普通写失败」） | `src/core/memagent/sessionCollector.ts`：`ApplyScanResult` 新增 `failed_l0_locked: number`；`applyScanToStore` 的 catch 用 `isL0LockedError` 分类，锁定行单独计数并进审计 `detail`（`l0_locked: true`，普通失败不带） | `__tests__/sessionCollector.test.ts`「批次41-W」describe **3 例**（`E_L0_LOCKED` 计 `failed_l0_locked` + 审计打标 / 只有 message 的字符串错误也判锁 / 无锁定时 `failed_l0_locked=0`） |
| 端壳接线 | `src/electron/main.ts` §5.1：`lastApply`/`applied` 带 `failed_l0_locked`；游标未推进的 mlog `reason: applied.failed_l0_locked>0 ? 'l0_locked' : 'write_failed'`；41-D 退避的抛错链把 `l0_locked` 排在 `write_failed` 之前（同为「有写失败」，但前者输密码即解、后者是写入 bug，混成一个码会把提示入口藏起来）；`collector:status` 新增 `l0_locked_writes` 回显 | 接线级（真起内核/会话），`sessionCollector` 纯函数 3 例已覆盖判据 |
| 就地解锁卡（写入页 + 采集器场景复用） | `src/web/shared/L0WriteUnlock.tsx`（新）：props `{ scene, onUnlocked? }`；用 `useSessionContext()`——**管理员**出密码框 + 「解锁写密钥」按钮（`getKernel().l0UnlockWrite(password)`），成功/失败都 `setPassword('')`（密码不留 DOM）；**成员 / 未登录**出「需管理员」文案、不起按钮。testid：`l0-write-unlock`/`l0-unlock-password`/`l0-unlock-submit`/`l0-unlock-need-admin`/`l0-unlock-error`/`l0-unlock-done` | `shared/__tests__/L0WriteUnlock.test.tsx` **6 例**（管理员成功→调用 + `onUnlocked` + 密码不在 DOM / 失败→就地报错 + 清密码 + 不回调 / 空密码不调 / 成员→需管理员无按钮 / 未登录→未认证文案 / `scene` 名渲染） |
| 写入页（失败即提示 + 解锁后自动重放） | `src/web/Write/WritePage.tsx`：`doWrite()` 里 `isL0LockedError(e)` → `setL0Locked(true)` + toast「未写入：L0 写密钥未解锁…解锁后会自动重放这条写入」；`l0Locked` 时渲染 `<L0WriteUnlock scene="这条手动写入" onUnlocked={doWrite} />`（解锁成功自动重放这条写入） | `write/__tests__/WritePage.l0locked.test.tsx` **3 例**（锁定写入→出卡 + 无成功回执 + toast / 解锁成功→自动重放→回执 / 解锁失败（错密码）→就地报错 + 清密码 + 无回执；用真 `createTestVault` + `vault.lockWrite` 造真锁） |
| 首页异常（近 30 分钟窗口闸门，避免常驻误报） | `src/web/Home/coreHome.ts`：导出 `L0_LOCK_ANOMALY_WINDOW_MS = 30*60_000` + `deriveKernelAnomalies(audits, now, windowMs)`；聚合分支 `action==='write' && a.ts >= now-windowMs && isL0LockedText(String(d.error??''))` 计 `l0LockedCount`、追 `l0LockedLastId`，出**一条** error 异常「L0 写密钥未解锁：写入被挡」，`request_id` 用最近一次命中的（真实可追溯，不落正文） | `Home/__tests__/coreHome.test.ts`「批次41-W」describe **3 例**（窗口内聚合成一条 + 计数 + 最近 request_id / 超窗即消失 / 非 L0 写失败不产生这条） |
| 日志人话 | `src/web/Home/programLogLabels.ts`：`NOTE_KEYS` 补 `failed_l0_locked`（批次41-W 注释块），采集器失败摘要里能一眼看出「几条是写密钥锁定」 | 断言在既有 `programLogLabels.test.ts` 口径内 |
| 文案 | `src/core/memagent/memories.ts:167` 的 `E_L0_LOCKED` 提示语对齐（只改措辞，不动码） | — |

> 诚实边界（批次41-W）：① **不新增带权限的读路径**——提示由真实写入失败驱动，`l0:status`/`l0:writeUnlock` 仍走既有 requireAdmin 闸门，本批没放宽；② **密码零落盘**：`L0WriteUnlock` 成功/失败都清空输入，`onUnlocked` 回调只传动作不传密码，动作日志与审计只记「解锁成功/失败」不记密码值（有测试断言 DOM 无密码）；③ 首页异常走**近 30 分钟窗口**（`L0_LOCK_ANOMALY_WINDOW_MS`），解锁后不再刷新该窗口内的命中 → 异常自动消失，不是常驻误报；④ 采集器侧 `l0_locked_writes`/`l0_locked` 原因码喂给 41-D 退避——写密钥锁定是「用户输密码就能解的长障」，与「写入 bug」分列；⑤ 接线级行为（端壳 `main.ts` §5.1 的 `l0:status` 回显与退避原因码）需按手测报告实机核对 `collector:backoff` / `collector:status` 动作日志，纯函数判据与三处 UI 由上面的用例覆盖。

### 批次41-T：存量补齐缺失的 `sha256` 与 `embedding`（批次41-B 声明的「533 行缺指纹 + 1 行缺向量」存量，本批给出通道）

> 这两个字段随提交 `843282c`（2026-10-31）才进写入路径，之前的历史行行上就是空的。代价有边界且可查：缺 `embedding` 的行在语义召回里恒 0 分（`agent.ts` 按行上 `m.embedding` 打分），缺 `sha256` 的行在云端同步的每日全量对账里会被 `sync.ts` 列进 `missing` —— 所以这 533 行同时是**批次42（sync 接线）的前置事实**。
> 本机实测（2026-11-04 12:40 UTC+08:00，只读真实账本）：1532 活行里 **533 行缺 sha256、1 行缺 embedding**；缺向量的那行是 pinned 的 `params_01M6AGZS9K4CTQM23HV64MYF1E`。

| 环节 | 真源 |
|---|---|
| 判定与改写（纯函数） | `src/core/memagent/fieldBackfill.ts`：`decide()` 一处判定预览与执行共用；公式与三条既有管道**同源**——`sha256 = sha256hex(content)`（`memories.ts:290`、`rebuild.ts:369`）、`embedding = embedSync(content_l1, dim)`（§2.2 不变量 7：**向量只源自 L1，不从别的层凑**）。`scanRowsForBackfill` 只读预览；`backfillMissingFields` 强制 `admin_user_id` + `backup_confirmed:true`，缺任一即抛错拒绝。**只填两个空字段**：正文 / `layer` / `version` / `updated_at` / 质量门戳 / L0 一律不动 → 第二次跑必然 `fillable_rows=0`（幂等）。 |
| 端壳接线 | `src/electron/ipcChannels.ts` 的 `ledger:fieldsPreview`（需会话）/ `ledger:fieldsBackfill`（需管理员）→ `main.ts` §采集区（`backupBeforeKernelChange('field-backfill','ledger:fields-backup')` → `backfillMissingFields({storage, vector: collectorVector, …})` → `actionLog('kernel','ledger:fields-backfill',{…})`；备份失败落 `ledger:fields-backup-fail`（error）并**拒绝改写**）→ `preload.ts` `ledgerFields` → `src/desktop/hostBridge.ts`（`HostMethod` + `CHANNEL_TO_NATIVE`）。注入 `collectorVector` 与采集器/补炼/重建同一个索引实例。 |
| UI | `src/web/security/FieldBackfillCard.tsx`（挂在 `SecurityPage.tsx`，紧跟「规则重判存量」卡）：缺口按**字段**分列（缺多少 / 其中多少算不出），受保护行单列，回执报「补了几行指纹、几行向量、进了多少索引、备份在哪」。testid：`fields-backfill-preview` / `-preview-report` / `-sample` / `-run` / `-report` / `-clean` / `-error` / `-unavailable` / `-need-admin`。 |
| 日志人话 | `src/web/Home/programLogLabels.ts`：`kernel:ledger:fields-backup` / `-backup-fail` / `ledger:fields-backfill` 三条中文标题 + `ledger:fieldsPreview` / `ledger:fieldsBackfill` 两条通道说明；`NOTE_KEYS` 补 `total`/`fillable_rows`/`sha256_filled`/`embedding_filled`/`indexed`/`protected_rows`/`unfillable_sha256`/`unfillable_embedding`/`failed`（值只有计数与路径，无正文）。 |
| **与其他删除/重造通道的分工** | `REJUDGE`（删行）/ `RESET`（整库清空重采）/ `REBUILD`（整行重造）**都会删或改正文**，所以各有逐字口令；本通道**不删不改正文，只填空字段**，属另一类 → 不设口令，但仍守「批量改写账本前先备份」这条不变量（项目从批次24 起如此）。 |
| 测试 | `fieldBackfill.test.ts` **11 例**（预览计数含「缺但补不了」/ 同源相等 / 只动元数据不动 `version`·`updated_at`·`layer` / 向量注入 vs `indexed:0` / pinned·locked / 填不出原样留着 / 无管理员与无备份都拒绝 / 幂等二次跑 `fillable_rows=0` 且只多一条汇总审计 / 正文与算出的指纹都不落审计）+ `FieldBackfillCard.test.tsx` **8 例**（浏览器不可用 / 非管理员不起预览 / 预览真值 / 样本不上正文 / 执行回执 / 无可补行不给点 / 主进程拒绝原样显示 / IPC 抛错）。 |

> 诚实边界（批次41-T）：① **本批没有替用户点执行**——通道、卡片、门禁都齐了，那 533 行在用户点之前仍是空的；② `indexed` 只统计「本行**新**建了向量且注入了索引」的行，往已存在向量的行上不会重复 upsert，`vector` 未注入时恒 0（与批次41-B 同口径：行上向量是真写、索引是可丢弃的进程内实例，不假装建过）；③ 缺 `content` 或缺 `content_l1` 的行**不猜**——算不出就原样留着并在预览里明列条数，宁可这行继续召不回，也不给它一个来路不明的向量；④ 卡片与审计都只报字段名、层名与长度，**正文与算出的指纹都不落账本**（有测试断言）；⑤ `unfillable_*` 是「字段缺口」口径下的子集，两个字段都缺且都算不出的行会在两边各计一次，所以 `unfillable_sha256 + unfillable_embedding` 不等于「行数」——卡面上写的是「项」不是「行」。


### 批次42：召回模式调度层（自动/手动）+ System Prompt 模板（2026-11-05，用户拍板「1 个自动 1 个手动」）

> 动因：用户粘贴的「5 套记忆召回模式」经核对 = 规格书 §2.4.3 教学版；落地前存在 G1 缺口（5 模式里仅 `minimal` 在 `agent.ts recall()` 真正接分支，其余 4 个声明未实现）。本批新增**调度层模块**作为模式配置与自动分流的单一真源，并补齐类型/枚举对齐；`agent.ts` 实际接线留作下一步（TDD + 每任务一 commit）。

| 环节 | 真源 | 测试 |
|---|---|---|
| 调度层模块（§2.4.3 五模式表 + §2.4.4 分流表直译） | `src/core/memagent/recallModes.ts`：`RECALL_MODE_SPECS`（5 模式 selectPriority/trimOrder/preload/conflictRule/weights/disabledLayers/isMinimal）、`COMMON_INVARIANTS`（§2.4.2 公共不变量）、`MODE_FEATURE_WORDS`/`SCENE_PLAN`/`DEFAULT_DISPATCH_CONFIG`、`resolveMode()`（自动/手动唯一入口：手动优先 > 自动分流；多模式命中裁决主/次；critical 禁极简 16.5）、`isManualMode()`/`modeWeights()`/`modeSpec()` | `src/core/memagent/__tests__/recallModes.test.ts` **19 例**（权重/层级断言 + §2.4.4 裁决走查 + 手动优先 + 16.5 硬规则 + 多模式次模式） |
| 顶层开关语义收敛 | `src/core/memagent/types.ts`：`RecallMode` 增 `'auto'`（与 `null` 同义=自动；收敛此前 null/auto 不一致 G2）；`Scene` 增 `'history_query'`（补此前枚举漂移） | `tsc --noEmit` 干净 |
| MCP 工具暴露 | `src/core/memagent/mcpSchema.ts`：`mode` 枚举扩为 6 值（`auto` + 5 具体模式，手动必须给具体模式）；`scene` 枚举补 `history_query`；`mode` 描述改为自动/手动措辞 | `tsc --noEmit` 干净 |
| 设计文档（差距对照表 + 自动/手动设计 + 调度层方案 + UI 交互） | `specs/召回模式设计与实现方案.md` | 人工核对 |
| System Prompt 模板（5 套 + 冲突约束 + auto 如何选用） | `specs/召回模式SystemPrompt模板.md` | 人工核对 |
| **待接线（下一步，尚未改行为）** | `src/core/memagent/agent.ts` `recall()` 顶部用 `resolveMode` 替换手搓 `minimal` 分支；`selectRecallBackground`/`scoreMemory` 接入 `resolved.mode`（权重/层级/裁剪）；`RecallResult` 增 `secondary_mode_hint`/`hit_keywords`；审计 `mode_dispatch` | 接线后补 `agent.ts` 回归用例，跑 `npm run verify` |

> 本批发现的规格书缺陷（已锁定，待修订）：① §2.4.3 `pattern_reasoning` 权重 `(0.15,0.25,0.10,0.40)` 求和 **0.90 ≠ 声明「权重和=1.0」**，`recallModes.ts` 保留字面值未擅自归一化，测试显式锁定；② 用户粘贴文档的「层级单条 Token 上限 400/200/100/50、total 800」在规格书与代码（`layerRules.ts` 字符上限 300/200/120/60）均不存在，模板文档已按规格书权重框架修正。
> 索引：`npm run code:index -- --write` 已更新 `specs/code-index.generated.md`（313 文件）。

### 批次43：文档对齐（双向吸收 + 反向补回，2026-11-05）

> 动因：用户要求把目标工作集 `specs/working-set/`（原 WorkBuddy 工作集 `multiagent-memory-ops\`）的 4 份文档，与本项目 `specs/` 对齐——**双向吸收 + 反向补回**。〔批次43 二次〕所有资料已导入本项目 `specs/working-set/` 统一管理，后续对齐基于本地副本。需求定稿见 `specs/文档对齐确认需求稿.md`（含选 B：保留已提交 `recallModes.test.ts`）。
> 源头：目标侧 `agent-memory-sop.md`(v1.8)、`mcp-extension-contract.md`(v1.1)、`multiuser-design-status.md`、`archive/draft-tool-inventory.md`；本侧 `接入Agent行为规范.md`、`记忆库工具能力清单.md`、`需求规格书_内核API契约.md`、`MCP运维与多Agent写入规范.md`。

| 吸收进本项目（A1–A5 + M1） | 落点 | 来源 |
|---|---|---|
| A1 多用户三池 D1–D25（三池/令牌代理/mint/user_id 读取不隔离/L0 归档/L1 分流/脱敏闸门 B+ 两者并用 规则同步+模型异步） | `specs/多用户三池隔离设计_D1-D25.md`（新建，多用户隔离单一真源） | 目标 multiuser-design-status.md + SOP §15 + 契约 §13 |
| A2 12 工具 Agent 面口径（读7/写2/管3=12，运维/管理端能力单列不计入；命名对齐 recall_memory/manage_memory） | `specs/记忆库工具能力清单.md`（重构） | 目标 draft-tool-inventory.md + 契约 §14 |
| A3 L0 写密钥门禁与落盘兜底（E_L0_LOCKED、writeDek 清空路径、逐条 pending/flush、get_write_status、两种拒绝判别） | `specs/接入Agent行为规范.md` §11 | 目标 SOP §10.2 |
| A4 记忆打分与衰减公式（score 权重 + importance/confidence 恒0.5 两把锁死旋钮 + 整改方向；区分 recallModes 模式权重） | `specs/需求规格书_内核API契约.md` §2.3 | 目标 SOP §13.2 / 契约 §0 |
| A5 source_agent 命名表（workbuddy/claude-desktop/cursor/gemini-cli/codex，禁依赖默认 mcp） | `specs/接入Agent行为规范.md` §7.1 | 目标 SOP §5–§6 |
| M1 回显两档（折叠气泡首选 / HTML `<details>` 兜底，取消 markdown-full/单行）+ 互通约束（参数对齐 APP mcpRecall.ts/recallInsight.ts） | `specs/接入Agent行为规范.md` §3.1 | 本项目回显设计 + 用户二次校正 |

| 反向补回目标 SOP（R1–R3，升 v1.9） | 落点 | 来源 |
|---|---|---|
| R1 回显两档 + 互通 | 目标 `agent-memory-sop.md` §9.4 | 本项目 接入Agent行为规范.md §3 |
| R2 5 召回模式（auto + 5 具体模式 + 权重 + critical 禁 minimal + 中英混排不触发极简） | 目标 `agent-memory-sop.md` §9.3 | 本项目 recallModes.ts / 需求规格书 §2.1 |
| R3 运维架构四方向（守护/健康/跨机/多Agent写入） | 目标 `agent-memory-sop.md` §16 | 本项目 MCP运维与多Agent写入规范.md |

> 提交粒度：每个原子任务一提交（T1–T7），仅提交本次相关 specs 文件，不碰早期遗留脏文件（errors.ts/sessionCollector.ts）与早期未提交 specs。目标 SOP 所在文件夹非 git 仓库，其改动仅落磁盘、不在本仓库提交。
> 索引：`npm run code:index -- --write` 见下方说明（本批纯文档改动，源码符号未变）。

### 批次44：吸收项落地 D1–D5（2026-11-05）

> 需求/设计真源：`specs/批次44-吸收项落地设计.md`（A1–A5/M1 代码缺口核对）+ `specs/批次44-D5工具面落地子方案.md`（D5 立项细化）。
> 纪律：每原子任务一提交；完成即展示「测试/门禁输出 + 改动清单」并等人工确认再推进下一步。

| 任务 | commit | 代码落点 | 测试 / 门禁 |
|---|---|---|---|
| D1 `source_agent` 去默认 `'mcp'` | `14af325` | `mcp.ts` / `mcpHttp.ts` / `mcpSchema.ts`：必填且拒绝字面 `mcp` | TCP/HTTP 缺参拒绝用例 |
| D2 工具命名对齐 `get_preferences` | `01d17b6` | MCP 内核 + AgentOnboard 子系统 + 8 份活文档；旧名无别名 | 旧名 → -32601 |
| D3 `write_memory` 扩展打分旋钮 | `a620999` | `memories.ts` 的 `parseWriteKnobs()` + `coreWrite` 落库钳制；schema→MCP→打分 | 旋钮落库 / 越界 / tags 类型用例 |
| D4 `get_write_status` + pending/flush | `051436e` | 新增 `pendingWrites.ts`（`PendingWrites`/`MemoryPendingStore`）、`pendingStoreFile.ts`（`FilePendingStore`）；`agent.ts` 装配 `writeUnlocked`/`enqueuePending`/`flushPending`/`getWriteStatus`；`l0vault.ts` 的 `isWriteUnlocked()`；两端 case | `pendingWrites.test.ts` 7 例 + TCP 4 例 + HTTP 3 例 |
| D5-0 工具面子方案 | `834b069` | `specs/批次44-D5工具面落地子方案.md`（范围重算 = 6 工具 + 1 变体；决策 ① 推荐 `create_project` 并入 D6） | 人工评审；用户回复「并入 D6」 |
| **D5-1 `list_memories` + `get_memory`** | `588ae4c` | 新增 `src/core/memagent/mcpReadTools.ts`（TCP/HTTP 共用编排：`toMemoryView()` 白名单裁剪、`runListMemoriesTool()`、`runGetMemoryTool()`）；`mcpSchema.ts` 工具数 5→7 + 指令第 6 条「盘点」；`mcp.ts` / `mcpHttp.ts` 各增两个 case | 新增 `__tests__/mcpReadTools.test.ts` **11 例**；`mcp.test.ts` +4 例、`mcpHttp.test.ts` +3 例、`tools/list` 断言 5→7；全量 `vitest run --maxWorkers=1` 172 文件 / 2049 项、`tsc --noEmit`、oxlint 受影响 7 文件 0/0 |

> D5-1 红线：对外只回白名单摘要（`mem_id`/`project_id`/`category`/`layer`/`decay_class`/`pinned`/`locked`/时间戳/打分字段/`tags`/`snippet`）；`snippet` 取 `content_l1 ?? content` 前 200 字，绝不返回 `content_l0_enc`/`content_orig`/`has_l0`/`content`/`embedding`。项目定位复用 `mcpRecall.ts` 的 `projectInfosFromMemories`/`resolveProjectId`，所有项目与单条读取均经 `projectInScope` 校验。
> 活文档同步：`记忆库工具能力清单.md`（2 行状态 + 现状 7 条目 + 口径说明）、`需求规格书.md` §19.5 工具表 +2 行、`批次44-D5工具面落地子方案.md`（决策 ① 已拍板 / D5-1 ✅ / D5-5 取消并入 D6）、`code-index.generated.md` 重生成。

| **D5-2 `feedback` + `manage_memory`** | `f927603` | 新增 `src/core/memagent/mcpManageTools.ts`（TCP/HTTP 共用：`runFeedbackTool()`、`runManageMemoryTool()`、`deleteAllowed()`、`parsePatch()`、`assertInScope()`）；`types.ts` 的 `MemAgent` 增正式 `feedback`/`memoryOp`（保留 `_feedback`/`_memoryOp` 兼容钩子）、`agent.ts` 同步暴露；`mcpReadTools.ts` 的 `MemoryView` 补 `reinforce_count`/`conflict_id`；`mcpSchema.ts` 工具数 7→9 + 指令第 7 条「反馈与治理」；两端各增两个 case + `allowDelete` 启动项（缺省读 `MCP_ALLOW_DELETE=1`） | 新增 `__tests__/mcpManageTools.test.ts` **12 例**；`mcp.test.ts` +6 例、`mcpHttp.test.ts` +3 例、`tools/list` 断言 7→9；全量 `vitest run --maxWorkers=1` 173 文件 / 2070 项、`tsc --noEmit` 两工程、oxlint 受影响 10 文件 0/0 |

> D5-2 红线与语义：内核 `coreFeedback` / `coreMemoryOp` **零改动**，MCP 层只做接线 + 校验 + 裁剪；`trust_delta` 由内核计算（`confirm +0.1` / `reject −0.05` / `disputed 0` 挂 `conflict_id`）；G4 `locked` 仅 `unlock` 放行、回 `blocked_locked:true`；`delete` 默认拒绝，放行后落墓碑并回 `mem:null`；按 `mem_id` 越界报**通用作用域错误**（文案不带项目 ID、不回显正文）；回执 `mem` 一律经 `toMemoryView()` 白名单裁剪，绝不返回 L0 密文/原文。
> 互通口径：APP `FeedbackDraft.action`（`FeedbackAction` = confirm/reject/disputed）↔ MCP `feedback.verdict` ↔ 内核 `FeedbackKind`；APP 17.3 操作 ↔ MCP `manage_memory.action` ↔ 内核 `MemOp`。字段命名不同但枚举、内核通道与账本完全一致。
> 活文档同步：`记忆库工具能力清单.md`（2 行状态 + 现状 9 条目）、`需求规格书.md` §19.5 工具表 +2 行、`批次44-D5工具面落地子方案.md`（D5-2 ✅ / 决策 ② 已实现 / 实测表快照说明）、`AGENTS.md` §1.1（工具清单 4→9 + 作用域校验口径）、`code-index.generated.md` 重生成。

| **D5-3 `gc_report`** | `ac11137` | 新增 `src/core/memagent/mcpGcTools.ts`（TCP/HTTP 共用：`runGcReportTool()`、`GC_REPORT_NOTE`）；**内核小改**：`types.ts` 的 `GcReq.dry_run?` + `GcReport.audit: AuditRef \| null`、`memories.ts` 的 `coreGc` 演算不落库（不 `putMemory`、不 `appendAudit`、回 `audit=null`）；`mcpSchema.ts` 工具数 9→10 + 指令第 8 条「遗忘可观测性」；两端各增一个 case | 新增 `__tests__/mcpGcTools.test.ts` **10 例**（含 `ma.gc()` 未传 `dry_run` 原行为回归、演算零写入、字段诚实）；`mcp.test.ts` +6 例、`mcpHttp.test.ts` +3 例、`tools/list` 断言 9→10；全量 `vitest run --maxWorkers=1` 174 文件 / 2089 项、`tsc --noEmit` 两工程、oxlint 受影响 9 文件 0/0 |

> D5-3 诚实口径（决策 ③）：`dry_run` **MCP 入口缺省 true**（只演算、不写记忆、不写审计、`audit_written:false`），内核 `ma.gc()` 未传 `dry_run` **保持原真实落库行为**——两者默认值相反且各有测试钉住。报告只回内核真实三项 `decayed`/`merged`/`conflicts_resolved`，`note` 说明与目标契约 `freshness_updated`/`summaries_created` 等无对应统计量，不改名冒充、不补 0。内核未实现冲突裁决，故不暴露 `resolve_conflicts`，传入即明确拒绝；`project_id` 显式必填且必须落在令牌作用域内。
> 活文档同步：`记忆库工具能力清单.md`（`gc_report` 状态 + 现状 10 条目 + 诚实口径）、`需求规格书.md` §19.5 工具表 +1 行、`需求规格书_内核API契约.md`（§2 生命周期行 + 新增 §2.4 dry_run 三态表 + 修正 §2.3 立项时关于「两把锁死旋钮」的陈旧 ❌ 表述）、`批次44-D5工具面落地子方案.md`（D5-3 ✅ / 决策 ③ 已实现）、`AGENTS.md` §1.1（工具清单 9→10）、`code-index.generated.md` 重生成。

| **开发纪律：三道闸门** | `0403d72` | 新建 `specs/开发纪律_三道闸门.md`（单一真源：A/B/C 执行表、C1 代码级变异流程、C2 输入/状态变异矩阵、C3 纯文档反向核对、§4 三栏收尾模板）；`AGENTS.md` 新增 §0 引用并声明 2026-11-05 起强制 | 纯文档动作按 C3：反向核对 4 个 npm 脚本与 4 个 C1 示例判据逐条对照源码；声明变异把 A2 命令改成不存在的 `npm run test:full-gate` → 与 `package.json` 核对返回 false（失配被发现）→ 还原后残留 0 处 |

| **D5-4 `recall_memory(scope='session')`** | `8e556ee` | `types.ts`（`RecallReq.scope?/session_id?` + `Memory.session_id?`）、`memories.ts`（`coreWrite` 显式传入才落 `session_id`）、`agent.ts`（新增 `sessionRecall()` 非向量分支 + `recall()` 早返回）、`mcpRecall.ts`（`scope`/`session_id`/`top_k` 校验并透传）、`mcpSchema.ts`（`recall_memory` schema 两个新属性 + 指令第 1 条会话工作记忆措辞）；**TCP/HTTP 两端不新增 case**，复用 `runRecallTool()`；`tools/list` 仍 10 个条目 | 新增 `__tests__/mcpSessionRecall.test.ts` **11 例**；`mcp.test.ts` +6 例（52 例）、`mcpHttp.test.ts` +6 例（52 例）；受影响 3 套件合计 115 例全绿；全量 `vitest run --maxWorkers=1` **175 文件 / 2112 项全绿**（C1 变异前后各跑一次）；`npm run typecheck` 两工程 0 错；oxlint 受影响 8 文件 **0 warnings / 0 errors**；`code:index:check` 319 文件已最新 |

> D5-4 口径：`scope='session'` 按 `session_id` 精确过滤 → `created_at` 倒序（同时间戳用 `mem_id` 降序兜底）→ 取最近 `top_k` 条（1–10，缺省 5）；**不走向量语义检索、不注入项目背景**，`hit.score=0` 是「未计算相关度」的诚实值，`background` 恒为 `{items:[],tokens:0,candidates:0}`；历史行无 `session_id` 一律不进视图，绝不拿 `created_at`/`project_id` 冒充；`projectInScope` 与 3000t 硬熔断仍生效（超限按「最近优先」从尾部丢弃），并写 `action='recall'` 审计（detail 带 `scope`/`session_id`/`background_tokens:0`）。写入侧只在 `write_memory.session_id` **显式且非空**时落库，可选字段向后兼容；sqlite/file 整行 JSON 序列化无需改表。项目召回路径一行未改（A 回归用例钉住）。
> 活文档同步：`AGENTS.md` §1.1（会话工作记忆变体 + 仍 10 工具）、`记忆库工具能力清单.md`（变体状态 🔲→✅、口径说明、§7 进度）、`需求规格书.md` §19.5 `recall_memory` 行、`需求规格书_内核API契约.md`（§2 生命周期行 + `RecallReq` 增 3 字段 + 新增 §2.1.1 会话视图口径表）、`批次44-D5工具面落地子方案.md`（状态改为 D5 全部落地 / D5-4 ✅ / 执行顺序补三道闸门）、`code-index.generated.md` 重生成（319 文件不变——生成器按既有规则排除 `__tests__` 与 `*.test.ts`，但 5 个改动源文件的行数/哈希已刷新）。

> **D5-4 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `RecallReq`/`Memory` 两个契约类型（列出全部实现与调用点：`agent.ts`/`memories.ts`/`mcpRecall.ts`/两端 case/存储序列化/审计格式）、TCP(8202) + HTTP(8204)、回显档位、`tools/list`；全量 175 文件 / 2112 项；受影响 3 套件 115 项；typecheck 两工程 0 错；oxlint 8 文件 0/0；`code:index:check` 319 文件；既有行为回归用例 = `项目召回路径不变（A 回归）` / `A 回归：不带 scope 仍走项目语义召回` / `A 回归：scope=project 与不带 scope 命中一致` / `ma.gc()` 与 `get_write_status` 等既有套件全绿；提交卫生 = 精确 `git add`，外部生成未跟踪 spec 严格排除。
> **B·效果验证**：AC→用例映射见 `批次44-D5工具面落地子方案.md` §4 D5-4 行；状态断言实测 = `write_memory` 后 `storage.getMemory(mem_id).session_id === 'S-WRITE'/'S-WRITE-HTTP'`、会话视图 `hits=['s_new','s_mid']`、`scanned_memories=3`、`score=0`、`background.candidates=0`、HTTP 审计 `detail={scope:'session',session_id:'S-HTTP',hits:2}`；端到端链路 = TCP `write_memory → recall_memory(scope=session)` 与 HTTP `tools/call write_memory → tools/call recall_memory` 各一条；诚实降级 = 不存在会话回空态（`hits=0`/`payload_tokens=0`）、非法参数 `-32602` 且 recall 审计条数不变、越界项目拒、无 `session_id` 历史行不进视图。
> **C·变异验证**：**C1** 变异点 = `agent.ts` 会话过滤 `m.session_id === sid` → `true`（纪律文档 §3 的示例判定）→ 内核单测 4 例 + TCP 2 例 + HTTP 2 例共 **8 例红灯**（如 `expected ['legacy','s2_a'] to deeply equal ['s1_b','s1_c']`）→ 原样还原（残留 0 处、`m.session_id === sid` 复位）→ 同批 3 套件 **115 例全绿** + 全量 175/2112 再跑一次全绿。**C2** 输入/状态变异矩阵 = 缺 `session_id` / 空串 / 非字符串 / 非法 `scope` / `top_k` 0·11·1.5·非整数 / `scope='project'` 却给 `session_id` / 不存在的会话 / 别会话 / 同会话别项目 / 无 `session_id` 历史行 / 删除墓碑 / 合并影子 / 单条 8000 字超预算 / 受限令牌越界 —— 全部明确拒绝或如实空态；`scope=project` 仍走项目召回、不误入会话分支。

### 批次46：真正冲突裁决 + 摘要合并统计（需求定稿，2026-11-05）

> 前置：用户要求「实现真正的冲突裁决与摘要合并统计」；按纪律先定稿（#17）再拆实现。编号 46 而不是 45 —— `ROADMAP-批次45-租户归一与成员密钥域模型-方案.md` 已占用 45 且主题无交集。

| 任务 | commit | 内容 | 三道闸门 |
|---|---|---|---|
| **46-1 需求/方案定稿（#17）** | 本次提交（下一子任务同步时补短哈希） | 新建 `specs/批次46-真正冲突裁决与摘要合并统计_落地方案.md`（12 项代码实测、§7 六字段逐项映射与取舍、§9.7 三模式 + hold 四值语义、3 个落地方案与 9 个决策点、46-1～46-5 任务拆分、A/B/C 验收点、C1 六个候选变异点）；纠错 4 份活文档的「本系统无对应统计量」旧措辞；`需求规格书_内核API契约.md` §2.4 补「两条 GC 路径不可混用」；本表补 D5-4 短哈希 `8e556ee`。**零代码改动** | 见下方三栏 |

> **关键实测结论（推翻 D5-3 一处记录）**：契约 §7 六字段在 `forgetting.ts::ForgettingCycleReport` + `runForgettingCycle()` 里**早已完整实现**且有真实事件源，由 `main.ts:3064` 每 6h 调度、写 `action='gc'` 带 `task='forgetting_cycle'` 审计，`forgetting.test.ts` 覆盖；缺的是**接线与隔离**（扫全库无 `project_id` 过滤、无 `dry_run`、未接 MCP）。冲突裁决：`GcReq.resolve_conflicts?`（`types.ts:199`）已声明但 `coreGc` 未读，三模式在端壳 `web/dispute/coreDispute.ts`（含硬编码 `project_id:'P1'`、`conflict_score:0.8`）。故本专项 = 接线 + 隔离 + 裁决下沉 + 文档纠错，**不是从零造统计**；D5-3 运行期决策（只回三项 / 不补 0 / 不改名冒充）保持正确不变。

> **46-1 三道闸门证据（纯文档按 C3）**：
> **A·影响面回归**：影响面 = 新增方案文档 + 5 份活文档措辞/交叉引用；**零源码、零类型、零 schema、零测试改动**，`code:index:check` 319 文件仍最新（生成器排除 `specs/` 与测试文件）；既有行为不变 = `ma.gc()` 三态表、`runForgettingCycle()` 签名、`main.ts` 6h 调度、`tools/list` 10 工具、D5-3 十例与 D5-4 115 例均未触碰；提交卫生 = 精确 `git add`，外部生成未跟踪 spec 排除。
> **B·效果验证**：脚本逐条核对 §1 的 14 项 file:line 声明（`memories.ts:566` `coreGc`、`types.ts:199` `resolve_conflicts?`、`forgetting.ts:209/279/295/338/357`、`main.ts:3064`、`coreDispute.ts:48/122`、`web/dispute/types.ts:12`、`types.ts:457`、`memories.ts:722`）→ **14/14 命中、失配 0**；交叉引用核对 4 份活文档各含 1 处指向新方案；首次核对抓到 `types.ts:198` 是注释行（声明在 199），方案已把区间细化为「196-206（在 199）」。
> **C·变异验证**：C3 声明变异 —— 临时把 §2 的 `report.freshness_updated = mems.length` 改成 `= 0` → 与 `forgetting.ts:295` 源码对照返回「一致: false → 失配被发现」→ 原样还原 → 复核「一致: true、变异残留 0 处」。未做代码级变异（本提交无代码）。
