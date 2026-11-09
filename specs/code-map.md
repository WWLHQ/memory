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
| REQ-006 | [需求规格书_其余页面字段级交互规格.md](需求规格书_其余页面字段级交互规格.md) | [冲突裁决页_原型.html](design/ui/冲突裁决页_原型.html) | 已落地（P7 写入冲突裁决域，**与 42-C 的 sync §9.7 同步冲突裁决是不同域**）：`dispute.html`（vite input）→ `src/web/dispute/`（`DisputePage`/`DisputeQueue`/`DisputeVerdict` + `coreDispute.ts`(`DisputeCtx` 注入 + `getCtx()`)/`logic.ts`/`types.ts` + `useDisputeMirror`），消费内核 P7 写入冲突队列、选胜者、落 `conflict_resolve` 审计；测试 `src/web/dispute/__tests__/DisputePage.test.tsx`。 |
| REQ-007 | [需求规格书_内核API契约.md](需求规格书_内核API契约.md) | - | 原子任务：[CORE-AGENT.md](tasks/CORE-AGENT.md)。桌面主进程实际注入 **[fileStorage.ts](../../src/core/memagent/fileStorage.ts) FileStorage**（原子写 + fsync + 损坏 `.corrupt` 备份），见 `src/electron/main.ts`；`sqliteStorage.ts`（node:sqlite）保留为同接口实现但当前未注入。 |
| REQ-008 | [需求规格书_同步机制详细设计.md](需求规格书_同步机制详细设计.md) | - | 原子任务：[SYNC.md](tasks/SYNC.md)（[sync.ts](../../src/core/memagent/sync.ts) 内存 SyncHub + [pgSyncHub.ts](../../src/core/memagent/pgSyncHub.ts) PgSyncHub（pglite Postgres 中枢，§2 五表账本））。**已接入生产（批次42-A..42-D + 43-A 落地）**：`MemAgent.sync()` 在 `hub` 注入时真调 `syncUp`/`syncDown`（`agent.ts:394/406` `implemented:true`；上行 sha256 幂等 + 下行 since 增量 + `l0_skipped` 红线：L0 密文层不进同步上行），端壳 `main.ts` 装配持久化 `PgSyncHub`（`dataDir`=数据根 `sync-hub/`），8 条 `sync:*` IPC（push/pull/reconcile/conflicts 需会话、resolve 需管理员），`sync.html` 独立页提供立即同步/中枢对账/§9.7 裁决队列，43-A 每日全量对账定时调度只补缺不覆盖。**诚实降级保留**：`hub` 未注入时仍 `E_NOT_IMPLEMENTED` + `implemented:false`（`agent.ts:385`，不删、不假装）。**中枢形态（诚实声明）**：默认单机 pglite 进程内 Postgres（跨端同机中枢，零依赖）；**B4（批次B类 `0b729c9`）已落地可配置远端 PG**：设 `SYNC_HUB_PG_URL` 即接远端共享 Postgres（标准 PG 方言，pglite/pg 双后端同构，远端 path 需 `npm i pg` 且用户提供 PG 服务端，**本环境未端到端验证**）；**B1（批次B类 `0b729c9`）已落地多机硬过滤**：`SYNC_MULTI_TENANT=1` + `tenant.json` 规范三元组 → 中枢层跨机 `team_id` 伪造读写在 push/pull/reconcile 入口 fail-closed 拒绝。未设环境变量时行为与 42-B 完全一致（零变化）。 |
| REQ-009 | [需求规格书_大模型与净化生长页字段级交互规格.md](需求规格书_大模型与净化生长页字段级交互规格.md) | [净化生长与大模型_原型.html](design/ui/净化生长与大模型_原型.html) | 已落地（P14 自我净化与生长）：`growth.html`（vite input）→ `src/web/growth/`（`GrowthPage`/`GrowthPanels`/`DedupCards` + `coreGrowth.ts`/`logic.ts`/`spec.ts`(维度口径单一真源) + `useGrowthReal`/`useGrowthMirror`），消费内核召回/合并/精炼队列真实指标（非演示）；测试 `src/web/growth/__tests__/GrowthPage.test.tsx` + `growthDimsHonesty.test.tsx`（维度诚实）。 |
| REQ-010 | [需求规格书_新增章节_十七_遗忘机制与用户体验设计.md](需求规格书_新增章节_十七_遗忘机制与用户体验设计.md) | [故事线_原型.html](design/ui/故事线_原型.html) / [机制演示_原型.html](design/ui/机制演示_原型.html) | 已落地（P4 遗忘机制与用户体验）：`lifecycle.html`（vite input）→ `src/web/lifecycle/`（`LifecyclePage`/`LifecycleCard`/`ParamPanel` + `coreLifecycle.ts`(`toLifecycleRecord`/`coreListLifecycle`/`coreLifeOp`)/`lifecycleFilter.ts`/`logic.ts` + `useLifecycleMirror`），消费内核 `runForgettingCycle` 真实摘要/压缩计数与遗忘周期调度状态；测试 `src/web/lifecycle/__tests__/LifecyclePage.test.tsx` + `LifecycleCard.test.tsx`。 |
| REQ-011 | [需求规格书_日志记录页字段级交互规格.md](需求规格书_日志记录页字段级交互规格.md) | [日志记录页_原型.html](design/ui/日志记录页_原型.html) / [审计日志页_原型.html](design/ui/审计日志页_原型.html) | 已落地（P15 日志记录 + P11 审计日志）：`logs.html`（`LogsPage`/`LogCards`/`LogFilterBar` + `coreLogs.ts`(`coreLoadLogs`/`coreAuditChain`/`coreL0Browse`)/`logic.ts`，消费 `useSessionContext` 与动作日志镜像）+ `audit.html`（`AuditPage`/`AuditTable`/`FilterBar` + `coreAudit.ts`(`coreLoadAudit`)/`auditLink.ts` + `useAuditMirror`，读内核 `queryAudit` 全量真数据）；两者均 vite input；测试 `src/web/logs/__tests__/LogsPage.test.tsx` + `errorTargetHonesty.test.tsx`、`src/web/audit/__tests__/AuditPage.test.tsx` + `AuditTable.test.tsx`。 |
| REQ-012 | [需求规格书_检索页字段级交互规格.md](需求规格书_检索页字段级交互规格.md) | [检索页_原型.html](design/ui/检索页_原型.html) | 已落地：`retrieval.html`（vite input）→ `src/web/retrieval/`（`RetrievalPage`/`QueryBar`/`ResultList`/`ResultRow`/`ContextPanel`/`BudgetPanel`/`ModeBanner`/`AuditTrailCard` + `coreEngine.ts`(`coreEngine`/`coreReorderMemory`)/`logic.ts` + `useRetrieval`），消费内核 `recall`/`retrieve` 真实检索（含预算/上下文窗口/审计轨迹）；测试 `src/web/retrieval/__tests__/components.test.tsx`。 |

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
- **周期调度（批次48 A23.2）**：主进程**单个 60s tick** 评估四个 cron 任务（衰减每日 02:00 / 裁决提醒每日 08:00 / 自生长每周日 03:00 / 归档每月 1 日 04:00），cron 计算是纯函数 `src/shared/cron.ts`（固定时区偏移，无 DST 表）；任务时刻真源 `src/shared/growthConfig.ts#SCHEDULE_TASKS`。旧的 6h `setInterval` 已删除：decay 复用 `runForgettingCycle`（层迁移+合并+每周冷压缩，不带 `autoArchiveDays`），archive 走 `archiveAgedMemories`（不降层，避免双跑）。到期以账本最近一条 `schedule_run` 的 `next_due_at` 为准，关闭期间错过的点在启动后首个 tick 补跑一次。每次真实执行写 `action='schedule_run'` 审计（task/host/expr/tz_offset_min/trigger/started_at/duration_ms/status/result/next_due_at），生长页据此显示宿主/最近运行/下次到期，无记录 = 尚未运行。开关取自 `growth:v1` 快照（decay 恒开）；`MAM_FORGETTING_DISABLED=1` 只停 decay/archive，`MAM_SCHEDULE_DISABLED=1` 停整个 tick，`MAM_SCHEDULE_TICK_MS` / `MAM_SCHEDULE_FIRST_DELAY_MS` 可调。
- **Web 端调度架构与「未调度」标注（批次48 A23.4）**：调度唯一宿主 = 桌面端 Electron 主进程（`main.ts` 单 tick）；`src/web/growth/GrowthPanels.tsx` 的 `ScheduleTimeline` 只读展示三件事 —— **调度宿主**（`sched-host-*`，优先取 `schedule_run` 审计里的 `host`）、**最近一次 `schedule_run` 审计时间**（`sched-run-*`）、**下次到期**（`sched-next-*`，取审计 `next_due_at`）。无记录一律显示「尚未运行（账本无 schedule_run 记录）」与「无记录」，绝不由 cron 反推；顶部 `sched-arch` 明确「调度由桌面端执行」，Web/浏览器端追加「本页不执行调度、不设置定时器」，页面任何位置不出现「已调度」状态。启停开关只写 `growth:v1` 配置，不代表已调度。
- **判重权重回归（批次48 A23.3）**：核心算法在 `src/core/memagent/regression.ts`（纯函数 `collectDedupSamples`/`classify`/`splitSamples`/`evaluateRegression` + I/O 壳 `runGrowthRegression`）。样本只来自真实写入审计 `action='write'` 的 `detail.dedup_eval`（`memories.ts` 写入期埋点：`schema_v=DEDUP_EVAL_SCHEMA_V(=1)` + 当时最优候选的 dims/score/threshold + `policy` 权重阈值快照；旧记录不回溯推断）。标签 = 当时真实的合并/不合并（`detail.dedup` 对齐）。指标为 positive=合并 的 micro precision/recall/F1；70/30 按 `sha256hex(mem_id)` 前两位确定性划分；训练集上枚举权重网格 + 每层阈值网格（[0.50,0.95]，层内 ≥5 且两类都有才动），六层单调不减投影，末尾 `validWeights`/`validThresholds` 校验不合法回滚。门槛 = 测试集 F1 提升 ≥0.02 且 precision 下降 ≤0.05。结果三态落真实审计：`insufficient_samples`（总数 <40 或负例 <10，带 counts/minimum）、`weight_regression`（not_adopted + reason + before/after/proposed）、`weight_tuned`（adopted + 配置快照 + metrics），采纳时唯一写入口 `saveGrowthConfigToLedger` 落 `growth:v1` + `param_save`。主进程 `self_growth` 任务（每周日 03:00）直接调用同一函数；页面「手动触发」走 `coreGrowth.coreRunGrowthRegression`。页面四态（未到运行时间/样本不足/已评估未达门槛/已采纳）由 `useGrowthReal.regressionOutcomeFromLedger` + `GrowthPanels.regressionStatusText` 如实区分，冷启动注明「正在积累样本，非故障」。
- **Agent 接入状态写账本（批次48 A29，D5=B）**：接入/测试/轮换/吊销/一键接入/撤销绑定统一写内核审计，页面状态从账本重建。
  - 写入：`src/web/AgentOnboard/ledger.ts`（`recordAgentAction`）把动作映射为 `agent_onboard`/`agent_test`/`agent_rotate`/`agent_revoke`/`auto_bind`/`unbound`（动作白名单在 `src/core/memagent/types.ts`），detail 带 `enterprise_id`/`team_id`/`op`/`result`/`status`/`rev`/`reason`/`durationMs`/`keyTail` + `resource_type='agent'`。页面在接入/测试/轮换/吊销/撤销/一键接入后各写一条并立即重建。
  - 重建：`loadAgentLedger` + 纯函数 `rebuildAgentLedger`（租户过滤 → 按 ts 回放 → 同一 Agent 归一化后只留一条；`result='rejected'` 不改变状态；`bound=false` 回落「未接入」）；`mergeLedgerIntoCards` 只覆盖连通态/熔断/密钥尾号/版本，不覆盖用户配置，不产生重复卡片。
  - 服务层持久：`src/agentOnboard/service.ts` 新增 `AuditStore`（`load`/`append`），浏览器兜底服务在 `useBackendMirror.createService` 注入 localStorage 存储（`mam.agentOnboard.audit.v1`），修复「内存 audit 数组重启即丢」；服务端 JSON 仍照旧落盘。
  - 重复发现：`findCard`/`cardKeyOf` 按「trim + 折叠空白 + 小写」匹配，`_configure`/`_oneClick` 只更新同一条（保留首次展示名、密钥与探测结论），`rev` 递增；客户端镜像同样按归一化名合并。
  - 并发版本：卡片 `rev` 每次写 +1；`configure/testConnect/rotateKey/revokeKey/revokeBind` 接受可选 `expectedRev`（HTTP `body.expectedRev` 或 `?rev=`），不一致返回 `version_conflict`（HTTP 409）并审计拒绝，缺省不校验（兼容旧调用方）。
  - 同步/衰减口径：**同步范围 = `local-only`**（接入卡片是本机密钥/安装痕迹，不进 sync 上行/下行）；**衰减天然豁免**（接入卡片不是 Memory 行，不进 gc/遗忘周期，无需 pin）。每条审计都带 `sync_scope='local-only'`、`decay_exempt=true`。
  - 审计页：`src/web/audit/{types,logic,FilterBar}` 新增 6 个动作标签与筛选项。
  - 测试：`src/agentOnboard/__tests__/a29.test.ts`（7 例：持久化回放/口径字段/重复配置/重复一键接入保留密钥/版本冲突/撤销版本校验/租户归属）+ `src/web/AgentOnboard/__tests__/a29Ledger.test.ts`（7 例：回放/重复合并/租户隔离/拒绝记录不改状态/页面合并/空账本/审计字段）。
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
| **46-1 需求/方案定稿（#17）** | `48694c4` | 新建 `specs/批次46-真正冲突裁决与摘要合并统计_落地方案.md`（12 项代码实测、§7 六字段逐项映射与取舍、§9.7 三模式 + hold 四值语义、3 个落地方案与 9 个决策点、46-1～46-5 任务拆分、A/B/C 验收点、C1 六个候选变异点）；纠错 4 份活文档的「本系统无对应统计量」旧措辞；`需求规格书_内核API契约.md` §2.4 补「两条 GC 路径不可混用」；本表补 D5-4 短哈希 `8e556ee`。**零代码改动** | 见下方三栏 |

> **关键实测结论（推翻 D5-3 一处记录）**：契约 §7 六字段在 `forgetting.ts::ForgettingCycleReport` + `runForgettingCycle()` 里**早已完整实现**且有真实事件源，由 `main.ts:3064` 每 6h 调度、写 `action='gc'` 带 `task='forgetting_cycle'` 审计，`forgetting.test.ts` 覆盖；缺的是**接线与隔离**（扫全库无 `project_id` 过滤、无 `dry_run`、未接 MCP）。冲突裁决：`GcReq.resolve_conflicts?`（`types.ts:199`）已声明但 `coreGc` 未读，三模式在端壳 `web/dispute/coreDispute.ts`（含硬编码 `project_id:'P1'`、`conflict_score:0.8`）。故本专项 = 接线 + 隔离 + 裁决下沉 + 文档纠错，**不是从零造统计**；D5-3 运行期决策（只回三项 / 不补 0 / 不改名冒充）保持正确不变。

> **46-1 三道闸门证据（纯文档按 C3）**：
> **A·影响面回归**：影响面 = 新增方案文档 + 5 份活文档措辞/交叉引用；**零源码、零类型、零 schema、零测试改动**，`code:index:check` 319 文件仍最新（生成器排除 `specs/` 与测试文件）；既有行为不变 = `ma.gc()` 三态表、`runForgettingCycle()` 签名、`main.ts` 6h 调度、`tools/list` 10 工具、D5-3 十例与 D5-4 115 例均未触碰；提交卫生 = 精确 `git add`，外部生成未跟踪 spec 排除。
> **B·效果验证**：脚本逐条核对 §1 的 14 项 file:line 声明（`memories.ts:566` `coreGc`、`types.ts:199` `resolve_conflicts?`、`forgetting.ts:209/279/295/338/357`、`main.ts:3064`、`coreDispute.ts:48/122`、`web/dispute/types.ts:12`、`types.ts:457`、`memories.ts:722`）→ **14/14 命中、失配 0**；交叉引用核对 4 份活文档各含 1 处指向新方案；首次核对抓到 `types.ts:198` 是注释行（声明在 199），方案已把区间细化为「196-206（在 199）」。
> **C·变异验证**：C3 声明变异 —— 临时把 §2 的 `report.freshness_updated = mems.length` 改成 `= 0` → 与 `forgetting.ts:295` 源码对照返回「一致: false → 失配被发现」→ 原样还原 → 复核「一致: true、变异残留 0 处」。未做代码级变异（本提交无代码）。

| **46-1 后续收口：D1–D9 拍板 + 外部 spec 纳入** | `c83a644` | 用户 2026-11-05 回复「按推荐执行，外部生成的文件纳入提交」。`批次46-…_落地方案.md` 状态改为「已拍板 / 进入实施」、§5 标题改写、新增 §5.1 拍板结果表（D1 编号 46 / D2 方案 C / D3 显式 verdict / D4 如实标注 / D5 禁止双计 / D6 保留三项+新增真实字段 / D7 不改调度 / D8 保留原名+verdict 枚举 / D9 重排任务）；把长期未跟踪的 `specs/MCP运维与多Agent写入规范.md` **纳入版本管理**（批次43 R3 反向补回的来源文档），纳入时按「活文档要实」就地校正 4 处过时/错误现状声明（§0.1 校正说明：`source_agent` 默认值已去除、Token Broker/mint 内核零命中属 D6、`manage_memory delete` 名称与开关口径）；本表补 46-1 短哈希 `48694c4`。零代码改动 | 见下方三栏 |

> **收口说明**：上一行 46-1 的 A 栏「外部生成未跟踪 spec 排除」是**该提交当时的真实状态**，保留原貌以便追溯；本次按用户明确指令改为纳入，二者不矛盾。
> **外部文档校正的 4 处**：① §4.1「MCP 默认 `'mcp'`」→ 批次44-D1 已去除默认值、必填且拒绝字面 `mcp`；② §4.3「默认身份禁用」缺口 → 标注已闭合（同 D1）；③ §3.2/§3.3「Token Broker 已能 mint 三池令牌」→ 实测全仓 `src/` 对 `TokenBroker`/`mint` 零命中，属 D6 未落地；④ §4.2「`memory_op` delete」→ 对齐为 `manage_memory(action=delete)` + `MCP_ALLOW_DELETE=1` / `allowDelete:true`（D5-2）。未校正项复核仍成立：MCP 无 `GET /health`、`sync` 未接线（`E_NOT_IMPLEMENTED`）、`GET /recall/<id>` 明细页只听回环。

> **46-1 收口三道闸门证据（纯文档按 C3）**：
> **A·影响面回归**：影响面 = 方案文档状态/拍板表 + 新纳入 spec + 本表；零源码/类型/schema/测试改动；`code:index:check` 319 文件仍最新（生成器排除 `specs/`）；全量 `vitest run --maxWorkers=1` 175 文件 / 2112 项全绿、`npm run typecheck` 两工程 0 错；既有行为不变 = `ma.gc()` 三态表、`runForgettingCycle()` 签名、`main.ts` 调度、`tools/list` 10 工具、D5-3/D5-4 用例均未触碰；任务重排按 D9 执行（#19→46-2、#18→46-3、#20→46-4、新增 46-5），**46-2 代码实现属下一原子任务，本轮不擅自连跑**。
> **B·效果验证**：反向核对拍板表 9 条与方案 §4/§5 原推荐逐条一致；核对外部文档 4 处校正与源码证据（`mcp.ts:201-205` / `mcpHttp.ts:246-250` / `mcpSchema.ts:53` 的 `source_agent` 必填、`src/` 对 `TokenBroker|mint` 零命中、`mcpHttp.ts` 对 `health` 零命中、`agent.ts` 的 `E_NOT_IMPLEMENTED`）；`git check-ignore` 确认该文件未被忽略、`git add` 后状态由 `??` 变 `A`。
> **C·变异验证**：C3 声明变异 —— 临时把校正说明里的一条结论改成反向（把「Token Broker 未落地」写回「已能 mint」）→ 与 `src/` 检索结果对照返回失配被检出 → 原样还原 → 复核残留 0 处；再做交叉引用核对（方案 §5.1 ↔ 外部文档 §0.1 ↔ 本表 ↔ 任务清单）。未做代码级变异（本提交无代码）。

| **46-2 接线真实摘要/合并统计（#19）** | `ce688fb` | 按拍板 **D2 方案 C 薄编排** 落地：`forgetting.ts` 的 `ForgettingOptions` 增可选 `projectId?`/`dryRun?`，三处 `listMemories({})` 改为 `listMemories(listFilter)`（缺省 = `{}`，与原先完全等价），层迁移/摘要落库/向量 upsert/原文写回/冷压缩 remove+写回/末尾 gc 审计全部加 `!dryRun` 守卫；**`ForgettingCycleReport` 字段与返回签名一字未改**、`coreGc` 一行未改、`main.ts:3064` 6h 调度不动。`types.ts` 新增 `GcFullReq`/`GcFullReport` 并给 `MemAgent` 增 `gcFull()`；`memories.ts` 新增 `coreGcFull()` + `GC_FULL_NOTE`；`agent.ts` 装配 `gcFull()`。新增 `__tests__/gcFull.test.ts` **15 例** | 见下方三栏 |

> **46-2 报告口径（D4/D5/D6）**：`decayed = migrated` 是兼容别名、同一事件只出一个数（严禁双计）；`merged` 保留为历史占位恒 0 并标注由 `summaries_created` 取代；`freshness_updated = scanned = 本轮扫描条数`，不冒充「新鲜度更新数」；`summaries_created`/`summaries_filtered`/`merged_originals`/`compressed` 六字段全部来自 `runForgettingCycle` 真实事件；`conflicts_resolved` 在 46-2 **诚实为 0**（冲突裁决属 46-3，未落定不伪造、不拿别的数字顶替）；`audit` 由 `queryAudit({request_id})` 查真实账本判定，不按入参猜；`dry_run=true` 全程零写入且 `audit=null`。`note` 分层说明三段口径，并如实写明「演算按当前账本快照、真实执行以落库后状态为准，二者可能不同」。
> **两条入口不可混用**：`ma.gc()` → `coreGc()` 与 `ma.gcFull()` → `runForgettingCycle()` 是并列的两条路径，**勿在同一次执行里同时调用**（都会做层迁移，会双计）。46-2 **未接 MCP**：`mcpGcTools.ts` / `mcpSchema.ts` / TCP(8202) / HTTP(8204) 一行未改，`gc_report` 仍走 `coreGc` 只回三项；接线与报告对齐属 **46-4**。

> **46-2 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `types.ts` 新增契约类型的全部实现/调用点、`coreGc` 与 `runForgettingCycle` 两条路径、`ma.gc()` 三态表、`main.ts` 6h 调度与 `auto_organize` 开关、7 天压缩幂等、向量后端 upsert/remove、`action='gc'` 的 `task='forgetting_cycle'` 审计格式、TCP(8202) + HTTP(8204)、`tools/list`（仍 10 工具）、`DisputePage`/`coreDispute.ts` 端壳。全量 `vitest run --maxWorkers=1` **176 文件 / 2127 项全绿**（C1 变异前 73.18s、还原后 78.23s 各跑一次）；受影响 6 套件 **169 例全绿**（`gcFull` 15 / `forgetting` 29 / `mcpGcTools` 10 / `mcpSessionRecall` 11 / `mcp` 52 / `mcpHttp` 52）；`npm run typecheck` 两工程 0 错；oxlint 受影响 5 文件与全量 542 文件均 **0 warnings / 0 errors**；`npm run code:index -- --write` 刷新 319 文件 + `code:index:check` 319 最新（生成器排除 `__tests__` 与 `*.test.ts`，新增测试不入索引，4 个改动源文件行数/哈希已刷新）。既有行为钉住：`mcpGcTools.test.ts` 10 例（`ma.gc()` 未传 dry_run 仍真实衰减 / dry_run=true 零写入 / 报告只含三项）、`forgetting.test.ts` 29 例、`contract.test.ts`、`DisputePage.test.tsx`、D5-4 会话召回 115 例均在全量中通过；`runForgettingCycle` 不带新参数仍全库扫描、真实落库、审计 `detail.task='forgetting_cycle'` 由专门回归用例钉住。提交卫生 = 精确 `git add`，不含无关文件。
> **B·效果验证**：AC→用例映射见 `批次46-…_落地方案.md` §8 B 与 `gcFull.test.ts`。**状态真的变了**：`summaries_created=1` → 账本真多 1 条 `sum_*` 且 `merged_from=['P1_d0','P1_d1','P1_d2']`；`merged_originals=3` → 三条原文 `decay_class='cold'`、`merged_into=sum_id`、`version=2`；`migrated=1` → `P1_old` 真变 `warm` 且 `version=2`；`compressed=3` → 三条 `compressed_at=NOW`、`version=2`、`embedding` 保留、`vector.search` 不再命中 `c0`，而 P2 副本 `c_p2` 仍命中且 `compressed_at` 未写（项目隔离）；审计 `queryAudit({request_id})` 真 1 条 `action='gc'` 且 `detail.task='forgetting_cycle'`。**dry_run 反向断言**：`before/after` 全行快照 `toEqual`（条数/版本/`decay_class`/`compressed_at`/`merged_into` 全不变）、`queryAudit({})` 零新增、`vector.search` 命中集合不变、`audit===null`，同时演算值 `summaries_created=1`/`migrated=1`/`compressed=3` 如实返回。**诚实降级**：不存在项目 → 全 0 报告且账本不动、空 `project_id` 明确拒绝且零写入、无 `vector` 时 `compressed=0`（不拿冷层行数冒充）、噪声组 `summaries_filtered=1` 且原文不动、`enabled:false` 只记 skipped 审计、7 天内重复压缩 `compressed=0` 且版本不重复推进。端到端链路 = 内核装配 `ma.gcFull()` → `coreGcFull()` → `runForgettingCycle()` → 存储/向量/审计；**TCP/HTTP `tools/call gc_report` 端到端属 46-4，本任务不谎称已接**。
> **C·变异验证**：**C1 两次代码级变异**（方案 §8 候选点 ①②）——① 把 `listFilter` 改成 `{}`（删掉 `projectId` 过滤）→ `gcFull.test.ts` **6 例红灯**（典型 `expected 8 to be 4`：越界项目被计入 P1 报告、`expected 8 to be +0`：不存在项目却扫到 8 条）→ 原样还原 → 15/15 绿；② 把层迁移的 `if (!dryRun)` 守卫去掉（演算仍 `putMemory`）→ **2 例红灯**（快照 `deep equal` 失败、`expected 2 to be 1` 版本被推进）→ 原样还原 → 15/15 绿。还原后 4 个源文件 **SHA256 与变异前基线逐字一致**（`forgetting.ts 33e9fd9f…`、`types.ts 86e53856…`、`memories.ts 7e2d8ad5…`、`agent.ts 40b5a2de…`）、两处变异残留检索均为 0、全量 176/2127 再跑全绿。**C2 输入/状态变异矩阵**：`project_id` 空串 / 不存在 / 多项目混库、`dry_run` true/false、`weeklyCompress` true/false、有 / 无 `vector` 后端、`enabled:false`、噪声成员组、7 天内重复压缩 —— 全部明确拒绝或如实空态；`locked`/`pinned` 豁免、`auto_merge=false` 类别、跨项目不合并由 `forgetting.test.ts` 既有 29 例钉住。未做 C3（本提交含代码）。

| **46-3 内核三模式冲突裁决原子 API（#18）** | `16f606d` | 新增 `src/core/memagent/conflict.ts`（`CONFLICT_NOTE`/`CONFLICT_VERDICTS`/`coreListConflicts()`/`coreResolveConflict()`）：真实配对、四 verdict、成对审计、作用域与 locked 门禁、只归档不删除；`types.ts` 新增 `ConflictVerdict`/`ConflictPair`/`ConflictResolveReq`/`ConflictResolveResult`、`GcFullReq` 增 `verdict?`、`GcReq.resolve_conflicts?` 与 `GcFullReport.conflicts_resolved` 注释改真；`memories.ts` 的 `coreGcFull` 前置校验 + 对已排队对执行显式 verdict + 只加真实落定计数、`GC_FULL_NOTE` 裁决段改写（`coreGc` 仍一行未改、`runForgettingCycle` 签名不变）；端壳 `coreDispute.ts` 重写为内核薄映射并**移除硬编码 `project_id:'P1'` / `conflict_score:0.8`**，`types.ts`/`labels.ts`/`logic.ts`/`DisputeQueue.tsx` 适配 `null` 如实显示。新增 `__tests__/conflict.test.ts` **22 例** + `web/dispute/__tests__/coreDispute.test.ts` **5 例** | 见下方三栏 |

> **46-3 裁决口径（方案 §3 / D3 / D8）**：`auto_override` = 旧行 `archived`（不删正文）+ 新行 `confidence` 钳制 +0.1 + 两条清 `conflict_id` 出队；`merge` = 双归档 + 聚合内容先过 L0→L1 质量门，失败整组回滚保持 pending，成功新建合并行（`merged_from=[old,new]`、真实 `project_id`、L1 口径 `content_l1`/`sha256`/`embedding`/`quality_gate_v`）并写 `action='merge'` + `action='conflict_resolve'`；`user_confirm`/`hold` = **零状态变更**、保持 pending、只写 `pending:true` 成对审计。红线：用户显式 `verdict` 才落定（禁止默认 `auto_override`）、`dry_run=true` 全程零写入且 `audit=null`、裁决不删除、不回显 L0 密文、`conflicts_resolved` 只数本周期真实落定、历史 `pending:false` 审计不回放、单次审计 `old_id`+`new_id` 成对。
> **配对只认两种真实数据**：① 恰好两条共享非空 `conflict_id` 且均非 archived/dormant/deleted；② `action='conflict_resolve'` 且 `detail.pending=true` 的审计里 old/new 两条仍存在。对手缺失 / 三条共享同一 `conflict_id`（歧义）/ 跨项目 / 越界一律不入队、不伪造对。内核无 `detect_conflicts` 检测引擎（§9.7 是设计伪码）→ `conflict_score`/`conflict_type` **如实为 `null`**，UI 显示「未检测 / 未采样」，不再硬编码 0.8 或按正文猜类型。
> **46-3 未动 MCP**：`mcpGcTools.ts` / `mcpSchema.ts` / TCP(8202) / HTTP(8204) 一行未改，`gc_report` 仍明确拒绝 `resolve_conflicts`（D5-3 口径）、`tools/list` 仍 10 工具；放开参数 + 增 `verdict` 枚举 + 报告字段对齐 + TCP/HTTP 用例属 **46-4**。`main.ts` 调度不动。

> **46-3 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = 新增 `conflict.ts` + `types.ts` 契约类型的全部实现/调用点 + `coreGcFull` 编排 + 端壳 `coreDispute.ts`/`types.ts`/`labels.ts`/`logic.ts`/`DisputeQueue.tsx` + `DisputePage` 编排与 toast/审计行 + TCP(8202)/HTTP(8204) + `tools/list` + `main.ts` 6h 调度。全量 `vitest run --maxWorkers=1` **178 文件 / 2154 项全绿**（C1 变异前 81.93s、还原后 73.71s 各跑一次）；受影响 10 套件 **215 例全绿**（`conflict` 22 / `gcFull` 15 / `mcpGcTools` 10 / `forgetting` 29 / `mcpSessionRecall` 11 / `mcp` 52 / `mcpHttp` 52 / 端壳 `coreDispute` 5 / `DisputePage` 7 / `logic` 12）；`npm run typecheck` 两工程 0 错；oxlint 受影响 10 文件与全量 545 文件均 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **320 文件**（新增 `conflict.ts` 入索引，2 个新测试按既有规则排除）+ `code:index:check` 320 最新。既有行为钉住：`mcpGcTools.test.ts` 10 例（含 `resolve_conflicts` 仍明确拒绝）、`gcFull.test.ts` 15 例、`forgetting.test.ts` 29 例、`DisputePage.test.tsx` 7 例、`logic.test.ts` 12 例、D5-4 会话召回 115 例、`contract.test.ts` 均在全量中通过；`coreGc` 三态与 `runForgettingCycle` 返回签名一字未改。提交卫生 = 精确 `git add`。
> **B·效果验证**：AC→用例映射见 `批次46-…_落地方案.md` §3/§8 与两个新测试文件。**状态真的变了**：`auto_override` → 旧行 `decay_class='archived'`、`version=2`、`conflict_id` 清空，新行 `confidence=0.7`、`conflict_id` 清空；`merge` → 双归档 + `merged_into` 指向合并行，合并行 `merged_from=['old','new']`、`project_id` 取真实 `P_REAL_NOT_P1`（不硬编码 P1）、`layer='L1'` 且带 `content_l1`/`sha256`/`embedding`；审计真写 1 条 `conflict_resolve`（+ merge 时 1 条 `merge`），`detail` 含成对 `old_id`/`new_id`/`verdict`/`conflict_id`/`pending`，`project_id` 为真实归属。**反向断言**：`dry_run=true` 四 verdict 全部零写入（全行快照 `toEqual`、审计 0 条、`audit===null`、`conflicts_resolved=0`）；`user_confirm`/`hold` 与 `locked` 库状态完全不变；跨项目/越界零写入；`merge` 噪声内容被质量门拦下时整组回滚、零审计；对手缺失如实空态且结果不含 `content_l0_enc`/L0 原文。**诚实降级**：`conflict_score`/`conflict_type` 为 `null`、三条共享 CID 不入队、历史 `pending:false` 审计不回放、重复调用 `conflicts_resolved=0`、只给 `resolve_conflicts` 不给 `verdict` 明确拒绝、只给 `verdict` 不给 `resolve_conflicts` 不落定、非法 `verdict` 明确拒绝。端到端链路 = 内核 `coreGcFull` → `coreListConflicts` → `coreResolveConflict` → 存储/审计，以及端壳 `coreConflicts`/`coreVerdict` → 同一内核原子 API；**TCP/HTTP `tools/call gc_report` 端到端属 46-4，本任务不谎称已接**。
> **C·变异验证**：**C1 两次代码级变异**（方案 §8 候选点 ③④）——③ 把 `conflicts_resolved += r.conflicts_resolved` 改成无条件 `+= 1` → **2 例红灯**（`expected 1 to be +0`：dry_run / user_confirm 被虚报落定）→ 原样还原 → 37/37 绿；④ 删掉 `auto_override` 的 `archive` 动作（`decay_class: archived` → `oldM.decay_class`）→ **5 例红灯**（内核 3 + 端壳 2，典型 `expected 'hot' to be 'archived'`）→ 原样还原 → 27/27 绿。还原后 8 个源文件 **SHA256 与变异前基线逐字一致**（`conflict.ts e537b258…`、`memories.ts 1e62629a…`、`types.ts dadad35f…`、`coreDispute.ts b83ac78a…`、端壳 `types/labels/logic/DisputeQueue` 均一致）、两处变异残留检索均为 0、全量 178/2154 再跑全绿。**C2 输入/状态变异矩阵**：四 verdict × `dry_run` true/false、`resolve_conflicts` 单独给 / `verdict` 单独给 / 非法值、对手缺失、夹具 ID、`locked` 行、跨项目 / 越界 `project_id`、同 `conflict_id` 三条、质量门噪声组、历史审计回放、重复调用、多项目混库与 `projectId` 过滤 —— 全部明确拒绝或如实空态，绝不静默成功、不补造冲突对。未做 C3（本提交含代码）。

| **46-4 MCP `gc_report` 对齐（#20）** | `05b778d` | `mcpGcTools.ts`：编排从 `ma.gc()`（只回三项）切到 `ma.gcFull()`（完整遗忘周期 + 真实裁决），报告按 D6 保留三项并新增 `freshness_updated/scanned/migrated/summaries_created/summaries_filtered/merged_originals/compressed` 七项真值 + 新增 `conflict_resolution: {requested,verdict,resolved}` 如实回执；放开 `resolve_conflicts` 并增 `verdict` 四值校验（D3/D8 二者都给才落定，缺一明确拒绝、非法值 `-32602`、绝不默认 `auto_override`）；`GC_REPORT_NOTE` 改写为分层口径（不再声称「没有对应统计量」，并说明 MCP 未注入向量后端故 `compressed` 诚实 0）；`dry_run` 缺省 true 零写入零审计不变。`mcpSchema.ts`：指令第 8 条 + `gc_report` description 改写、inputSchema 增两个属性（`required` 仍 `['project_id']`，`tools/list` 仍 10 工具）；**TCP(8202)/HTTP(8204) 两端 case 一行未改**（原本就透传 args 给共用编排）。**内核 `coreGc` / `coreGcFull` / `conflict.ts` / `forgetting.ts` / `main.ts` 6h 调度全部一行未改**。测试：`mcpGcTools.test.ts` 10→16 例、`mcp.test.ts` 52→54 例、`mcpHttp.test.ts` 52→54 例（各补报告字段对齐、裁决参数矩阵与端到端完整链路） | 见下方三栏 |

> **46-4 口径（D3/D4/D5/D6/D8）**：报告字段顺序固定为 `decayed / merged / conflicts_resolved / freshness_updated / scanned / migrated / summaries_created / summaries_filtered / merged_originals / compressed`——三项不删不改名、六项来自 `runForgettingCycle` 真实事件、`scanned` 为 `freshness_updated` 的同值如实命名；`conflicts_resolved` 只取 `coreGcFull()` 真实落定数，不按入参猜；`conflict_resolution.resolved` 与报告同值，未请求裁决时 `{requested:false,verdict:null,resolved:0}`。`dry_run=true`（缺省）走 `runForgettingCycle` 的零写入快照演算，连裁决段也零写入零审计，`audit_written=false`；显式 `false` 才落库并落 `action='gc'` 审计。`resolve_conflicts` **不是自动覆盖开关**：单独给 `resolve_conflicts=true` 或单独给 `verdict` 都明确拒绝，四 verdict 中 `user_confirm`/`hold` 保持 pending 不落定、`auto_override`/`merge` 才真实归档。`compressed` 在本入口恒 0（MCP 不注入 `VectorBackend`、不开 `weeklyCompress`），note 明说「只清向量索引副本、不动磁盘正文」。**两条入口仍不可混用**：`gc_report` 现在走 `ma.gcFull()`，与 `ma.gc()` 并列，勿同一次执行里同时调用以免双计。
> **46-4 未动的活文档**：`需求规格书.md` §19.5、`记忆库工具能力清单.md`、`需求规格书_内核API契约.md`、`AGENTS.md`、`批次44-D5工具面落地子方案.md` 决策 ③ 的措辞纠错统一留到 **46-5（#22）活文档收口**，本任务不提前改、也不谎称已改；方案 §7 登记的「`mcpGcTools.ts:5-21` / `mcpSchema.ts:20,154` 留到 46-4 随代码一起改」已随本次代码落地闭合。

> **46-4 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `runGcReportTool()` 的调用链（`ma.gcFull()` → `coreGcFull()` → `runForgettingCycle()` + `coreListConflicts()`/`coreResolveConflict()`）、`GcReportToolResult` 契约类型、`GC_REPORT_NOTE`/`MCP_INSTRUCTIONS`/`gc_report` schema 三处口径、TCP(8202) + HTTP(8204) 两端、`tools/list`（仍 10 工具）、`initialize` 指令回显、`main.ts` 6h 调度、`coreGc` 三态表、D5-4 会话召回 115 例、`DisputePage` 端壳。全量 `vitest run --maxWorkers=1` **178 文件 / 2164 项全绿**；受影响 3 套件 **124 例全绿**（`mcpGcTools` 16 / `mcp` 54 / `mcpHttp` 54，C1 还原后复跑仍 124/124）；`npm run typecheck` 两工程 0 错；oxlint 全量 545 文件 **0 warnings / 0 errors**；`npm run code:index -- --write` 刷新 **320 文件**（两个改动源文件行数/哈希刷新，生成器按既有规则排除 `__tests__` 与 `*.test.ts`）+ `code:index:check` 320 最新。既有行为钉住：`ma.gc()` 未传 `dry_run` 仍真实衰减 / `dry_run=true` 零写入 / `dry_run=false` 落审计（原有 3 例未改断言）、`tools/list` 仍 10 工具且 `required=['project_id']`、`project_id` 越界与受限令牌仍 `-32602`、`forgetting.test.ts` 29 例、`contract.test.ts`、D5-4 会话召回、端壳 24 例均在全量中通过；内核 5 个文件与 `main.ts` 调度零改动。提交卫生 = 精确 `git add` 7 个文件（2 源码 + 3 测试 + 索引 + 本表），不含临时文件。
> **B·效果验证**：AC→用例映射见 `批次46-…_落地方案.md` §6/§8 与三份测试文件。**状态真的变了**：`resolve_conflicts=true + verdict='auto_override' + dry_run=false` → 单元/TCP/HTTP 三端均断言 `report.conflicts_resolved=1`、`conflict_resolution.resolved=1`、旧行 `decay_class='archived'`、`conflict_id` 清空、新行 `confidence=0.7`、`queryAudit({action:'conflict_resolve'})` 真 1 条且 `detail` 含成对 `old_id`/`new_id`/`verdict`/`pending:false`、`audit_written=true`；报告 10 字段顺序逐字 `toEqual`，`scanned===freshness_updated`、`decayed===migrated`、`merged=0`、`compressed=0`，`note` 含「真实字段」且不含「没有对应统计量」。`dry_run=false` 不带裁决 → `mem_gc_old`/`mem_gc_http` 真降 `warm` 且 `version=2`、审计真 1 条；再演算 `decayed=0`。**反向断言**：`dry_run=true` 带裁决 → 全行快照 `toEqual`、审计条数不变、`audit_written=false`、`resolved=0`；`user_confirm`/`hold` → 库状态完全不变、`resolved=0`、保持 `pending:true` 审计；空项目 → 全 0 报告且账本不动。**诚实降级**：只给 `resolve_conflicts` 不给 `verdict` / 只给 `verdict` 不给 `resolve_conflicts` / 非法 `verdict`（`bogus`/数字）/ 非布尔 `resolve_conflicts`/`dry_run` / 缺或空 `project_id` / 受限令牌越界 → 全部明确拒绝（`-32602` / `isError:true`）且零写入零审计；四 verdict 在 `dry_run` 下均通过校验但一律不落定。**端到端链路**：TCP 与 HTTP 各两条 `tools/call gc_report → 共用编排 → ma.gcFull() → 内核裁决 → 存储/审计` 完整链路（真实落定 + dry_run 零写入），与方案 §6「TCP + HTTP 各一条」要求对齐。
> **C·变异验证**：**C1 两次代码级变异**（本任务新增的两个关键判定）——① 把「`resolve_conflicts=true` 必须显式给 `verdict`」改成「缺省/非法值默认 `auto_override`」（突破 D3/D8 红线）→ 三个套件共 **5 例红灯**（TCP 错误矩阵 `expected undefined to be -32602`、HTTP 错误矩阵 `expected false to be true`、单元 3 例含 `promise resolved … instead of rejecting`）→ 原样还原；② 把报告的 `conflicts_resolved` 改成恒 0（抹掉内核真实落定计数）→ **3 例红灯**（单元 + TCP + HTTP 真实落定用例均 `expected +0 to be 1`）→ 原样还原。还原后 5 个文件 **SHA256 与变异前基线逐字一致**（`mcpGcTools.ts 907647e7…`、`mcpSchema.ts e04c2339…`、`mcpGcTools.test.ts 7db764dc…`、`mcp.test.ts 26bac942…`、`mcpHttp.test.ts c7cafe42…`）、`C1 变异` 残留检索 0 处、三套件 **124/124 复绿** + 全量 178/2164 全绿。**C2 输入/状态变异矩阵**：`resolve_conflicts` 未给 / `true` / `false` / 非布尔；`verdict` 未给 / 四值 / 非法字符串 / 数字；`dry_run` 未给 / `true` / `false` / 字符串 / 数字；`project_id` 缺 / 空串 / 数字 / 不存在项目 / 越界 / 受限令牌；冲突对手缺失、跨项目 CID、三条共享 CID、`locked` 行、历史 `pending:false` 审计、7 天内重复压缩、无 `vector` 后端（由 46-2/46-3 既有 44 例钉住）—— 全部明确拒绝或如实空态，绝不静默成功、不补造统计。未做 C3（本提交含代码）。

| **46-5 活文档与索引收口（#22）** | 本次提交 | 同步批次46 已落地能力到活文档：`需求规格书.md` §19.5 `gc_report` 行改写为 `ma.gcFull()` 接线后的 D6 分层十字段 + `resolve_conflicts`+`verdict` 显式裁决口径（废止「无对应统计量」旧措辞）；`需求规格书_内核API契约.md` §2.4 补「46-4 已落地」说明（`gc_report` 已从 `ma.gc()` 切到 `ma.gcFull()`）；`记忆库工具能力清单.md` §2.3 `gc_report` 状态与诚实口径同步为真实字段与裁决口径；`批次44-D5工具面落地子方案.md` 决策 ③ 补「〔批次46-4 已落地〕」说明；`批次46-…_落地方案.md` §1 表 11 / §7 纠错清单全部标记「46-4 已落地」并回填 `05b778d`；`code-map.md` 回填 46-4 短哈希 `05b778d` 并追加本行。无源码改动，`code-index.generated.md` 不因本任务变化（46-4 已刷新 320 文件） | 见下方三栏 |

> **46-5 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4，纯文档任务用 C3 反向核对）**：
> **A·影响面回归**：影响面 = 6 份活文档（`需求规格书.md` / `需求规格书_内核API契约.md` / `记忆库工具能力清单.md` / `批次46-…_落地方案.md` / `批次44-D5工具面落地子方案.md` / `code-map.md`），**零源码改动**；`git status` 仅这 6 个文档文件；`npm run code:index:check` 仍是 **320 文件最新**（无新增/修改源码，索引无需刷新）；typecheck/oxlint 不适用（无 `.ts` 改动）。AGENTS.md 两处 `gc_report` 引用（§1.1 工具清单、P1-10 作用域）经核仍为准确口径、无需改动。
> **B·效果验证**：grep 核验——活文档中 `gc_report` 现均含 `ma.gcFull()` / `resolve_conflicts` / `verdict` / `conflict_resolution` 与十字段描述；旧「本系统无对应统计量」「不暴露 `resolve_conflicts`」等过期断言已从**当前口径**移除（仅 code-map 历史引用段与 D5 子方案决策史保留为可追溯记录，不误导现状）。代码侧可证事实复核：`mcpGcTools.ts` 确实支持 `verdict` 四值校验、`conflict.ts` 的 `conflict_score`/`conflict_type` 确为 `null`、`tools/list` 仍 10 工具——由 46-4 三套件 124 例钉住，本任务不谎称未改。
> **C·变异验证（C3 反向核对）**：① 临时把 `需求规格书.md` §19.5 的 `gc_report` 行改回「只回三项 / 无对应统计量」旧措辞 → 与 46-4 已落地的 `mcpGcTools.test.ts` 断言（`note` 不含「没有对应统计量」、含「真实字段」、报告 10 字段 `toEqual`）直接矛盾，说明文档若回退即失真；② 临时插入「`compressed` 在 MCP 入口恒非 0」错误声明 → 与 `mcpGcTools.ts` 的 `compressed=0`（MCP 未注入向量后端）矛盾。两处检出后均原样还原，文档与代码一致、无残留。提交卫生 = 精确 `git add` 6 个文档文件，不含临时文件。

| **D6-1 项目注册表（#16）** | `470265a` | `StorageBackend` 全四实现 + IPC 全链路（preload/main/ipcStorage/hostBridge/ipcChannels）+ 服务端白名单 落地 `createProject/getProject/listProjects`；`FileDoc`/`Sqlite` 增 `projects` 持久化（缺省 `{}` 兼容旧库）；3 处测试 mock 补契约占位；新增 `storageProjects.test.ts`（26 例三后端一致）。向后兼容：`listProjects` 仅返回注册表项目（隐式合并留 D6-2） | 见下方三栏 |

> **D6-1 口径（设计 A1+B1 / 子方案 §3）**：`StorageBackend` 接口新增 `createProject/getProject/listProjects` 三方法 + `ProjectKind`/`ProjectRecord`/`CreateProjectInput`/`ListProjectsFilter` 四类型；全部实现者（InMemoryStorage / FileStorage / SqliteStorage / IpcStorageBackend / HostBridgeStorage / HttpStorageBackend）落地。`FileDoc` 增 `projects` 映射（缺省 `{}` 向后兼容旧库），`load()` 的 `ENOENT`（空库）早期返回与 `projects` 形状校验均补 `projects: {}` 兜底；`FileStorage` 三方法带 `assertWritable()` 守卫 + `touchOrRollback` 写盘回滚 + `maybeReload()` 只读镜像跟随。`SqliteStorage` 新增 `projects` 表（doc 存完整 JSON，读取时把落库的 `null` 归一化为 `undefined` 以贴合 `ProjectRecord` 契约）。IPC 全链路打通：`ipcChannels.ts` 三常量 → `preload.ts` 三方法 → `main.ts` `registerStorageIpc` 三 `handleIpc` → `ipcStorage.ts` `StorageIpc`+`IpcStorageBackend` → `hostBridge.ts` 三 `HostMethod`+映射 → `home/server.ts` 内核数据面白名单同步增三方法（浏览器模式凭登录会话直连真实账本可用）。`listProjects` 暂只返回注册表项目（隐式项目合并留到 D6-2 由 `mcpReadTools` 接入），向后兼容。
> **D6-1 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `StorageBackend` 接口与 6 个实现者、`types.ts` 契约、IPC 三层（preload/main/ipcStorage/hostBridge/ipcChannels）、`home/server.ts` 数据面、D6 子方案。全量 `vitest run --maxWorkers=1` **179 文件 / 2190 项全绿**（C1 还原后复跑仍全绿）；新增/受影响套件 **29 例全绿**（`storageProjects` 26 + `ipcStorage` 3，其中 `ipcStorage` 因补三方法转发测试 +1）；`npm run typecheck` 两工程 0 错；oxlint 全量 546 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **320 文件**（仅 `storageProjects.test.ts` 新文件行数与各改动源文件哈希刷新）+ `code:index:check` 320 最新。既有行为钉住：`fileStorage.test.ts` 全量、`sqliteStorage.test.ts` 全量、`contract.test.ts`、`coreHome.test.ts`、`phase5EHonesty.test.tsx`、`ipcStorage.test.ts` 改造后均在全量中通过；三处 mock（`ipcStorage`/`coreHome`×5/`phase5EHonesty`）补占位实现以满足契约；`tools/list` 仍 10 工具（D6-5 才增）。提交卫生 = 精确 `git add` 14 个源码/测试 + 1 份子方案 + 1 份索引（不含临时文件）。
> **B·效果验证**：AC→用例见 `批次46-D6…子方案.md` §4 + `storageProjects.test.ts`。**状态真的变了**：`createProject` → 回写 `project_id`/`kind`(缺省 `general`)/`created_at`/`created_by`，`getProject` 命中返回完整记录、`listProjects` 全量 / 按 `kind` / 按 `owner_user_id` / 组合过滤均正确；`FileStorage` 创建后 `close` 再开新实例项目仍在（落盘持久化）、旧库（无 `projects` 字段）打开不报错且 `listProjects` 空；`SqliteStorage` 同口径持久化；`IpcStorageBackend` 三方法参数/返回值透传。`FileStorage` 只读构造 / 写锁降级下 `createProject` 抛 `StorageLockedError`（绝不静默假成功），`reloadOnMtime` 镜像读操作可见写方新增项目。**反向断言**：空 / `   ` / `''` `project_id` 一律拒绝 `不能为空`；重复 `project_id` 抛 `项目已存在` 且原记录不被覆盖；只读实例 `createProject` 抛 `StorageLockedError` 且读仍可得写方数据；`getProject` 未知返回 `null`。**诚实降级**：`FileStorage.load()` 缺省 `{}` 兜底，绝不因旧库缺字段而抛损坏；写盘失败按 `touchOrRollback` 撤销内存改动（与 `putMemory` 同口径，由既有 `fileStorage.test.ts` 写盘失败套件钉住）。
> **C·变异验证**：**C1 代码级变异**——把 `InMemoryStorage.createProject` 的「`if (this.projects.has(project_id)) throw`」存在性拒绝注释掉 → 对应 **1 例红灯**（`expected promise … to reject with /项目已存在/`，实际 resolve）→ 原样还原 → 该套件 26/26 复绿；另本轮开发期即由测试逮住一处真实变异类缺陷：`FileStorage.load()` 的 `ENOENT` 早期返回漏写 `projects: {}` 导致新实例 `this.doc.projects` 为 `undefined`、`createProject` 调 `in` 运算符抛 TypeError，被 `storageProjects.test.ts` 立红 → 补 `projects: {}` 后全绿（即 C1 已在过程中实证）。**C2 输入/状态变异矩阵**：`project_id` 正常/空/纯空白/重复；`kind` 缺省/`shared`/`user`/`archive`；`owner_user_id` 有/无；`display_name` 有/无；`listProjects` 无过滤/`kind`/`owner`/组合；`FileStorage` 全新库/旧库(无 projects)/持久化重开/只读构造/写锁降级/`reloadOnMtime` 镜像；`SqliteStorage` 持久化重开；`IpcStorageBackend` 转发 —— 全部断言明确拒绝或如实返回，绝不静默成功。未做 C3（本提交含代码）。

| **D6-2 三池模型与作用域门禁（#23）** | `9c13c96` | `mcpAuth.ts`：`projectInScope` 从 `(scope[], projectId)` 升级为携带账户的 `(ScopeAccount, projectId)` 三池版，新增 `classifyProject`/`ProjectPool`/`ScopeAccount`（`is_admin?` 预留，D6-3 才置位）；三池规则 = `P-shared` 恒可见 / `P-archive` 仅 admin / `P-<user>` 仅 owner 或 admin / 其余 general 按 `scope_project_ids`（`'*'` 全放行）。六个工具编排（recall/list/get/write/manage/gc）签名 `scope?: string[]` → `account: McpAccount` 并统一下沉三池门禁；`runListProjectsTool` 升级为「注册表 + 隐式记忆」合并并应用可见性；新增 `ensureSharedProject`（启动自动建 `P-shared`，只读镜像静默跳过）；`main.ts` 桌面启动注入；TCP(8202)/HTTP(8204) 全部调用点切换。新增 `mcpThreePool.test.ts`（17 例），`mcpScope.test.ts` 纯函数段重写为三池矩阵；顺带修复 D6-1 遗留 `ipcStorage.test.ts` mock 不回显缺陷 | 见下方三栏 |

> **D6-2 口径（设计 A1+B1 / 子方案 §3.1/§4）**：三池判定走 `project_id` 命名约定（`classifyProject`：`P-shared`→shared / `P-archive`→archive / `P-<x>`→user（owner=`x`） / 其余→general），门禁点无需查注册表；注册表 `kind` 在 `list_projects` 合并处参与可见性。`projectInScope` 接受 `ScopeAccount`（`{user_id, is_admin?, scope_project_ids}`），`McpAccount` 结构兼容——`is_admin` 为可选预留，D6-3 才在引导令牌上置位，本提交内所有账户按 non-admin 处理（`DEFAULT_MCP_ACCOUNT` scope=`['*']` → general 全放行、user 池仅命中 owner）。general 池沿用批次26-B P1-10 的 `scope_project_ids` 列表语义；**三池规则优先于 scope 列表**（scoped 账户也恒可见 `P-shared`、恒不可见他人 `P-<user>` 与 `P-archive`）。已知边界：存量账本里以 `P-` 开头的历史项目将按 user 池门禁（owner=后缀），桌面默认账户在 D6-3 置 `is_admin=true` 后不受影响；非 admin 受限令牌访问此类项目会被拒——这是 D6 多用户隔离的**设计意图**而非回归。`list_projects` 合并口径 = 注册表项目（可能尚无记忆，`last_activity` 兜底 `created_at`）∪ 记忆反推隐式项目（按 general 兜底），记忆数累加、`last_activity` 取 Max、按最近活动倒序；空账本仍诚实空数组。`ensureSharedProject` 只在应用入口（`main.ts`）调用，MCP 传输层不自动建——保证传输层单测「空账本 → 0」诚实空态契约不破。
> **D6-2 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `mcpAuth.ts`（`projectInScope` 全部 8 个调用点）+ 六工具编排签名（`mcpRecall`/`mcpReadTools`/`mcpManageTools`/`mcpGcTools`）+ 两传输（`mcp.ts`/`mcpHttp.ts` 全部 13 处 `account.scope_project_ids` → `account`）+ `main.ts` 启动注入 + 5 个直调测试文件适配。全量 `vitest run --maxWorkers=1` **180 文件 / 2210 项全绿**（变异还原后复跑确认）；`npm run typecheck` 两工程 0 错；oxlint 全量 547 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **320 文件** + `code:index:check` 320 最新。既有行为钉住：`mcpScope.test.ts` HTTP 全链路（scoped 令牌 recall/write/list_projects 拒绝与放行）、`mcpReadTools` 34 例、`mcpManageTools` 27 例、`mcpGcTools` 16 例、`mcpSessionRecall` 115 例、`mcp`/`mcpHttp` 端到端、`mcpHttp.test.ts` 「空账本 list_projects → 0」诚实空态契约（传输层不 bootstrap 故不破）——均在全量中通过。提交卫生 = 精确 `git add`（fix 与 feat 两个提交分开，不含临时文件）。
> **B·效果验证**：AC→用例见子方案 §3.1/§4 + `mcpThreePool.test.ts` 17 例。**状态真的变了**：三池可见性矩阵 10 组断言（shared 恒可见含越界 scope / user 池 owner+admin 可见、他人拒绝 / archive 仅 admin / general scope 命中放行未命中拒绝）；`list_projects` 合并注册表（`createProject` 后无记忆也出现，`memories=0`）与隐式记忆项目、记忆数累加（2 条 → `memories=2`）、`last_activity` 取 Max（注册表时钟 vs 记忆 ts）；`ensureSharedProject` 建库后 `getProject('P-shared')` 返回 `kind:'shared'` 记录且幂等。**反向断言**：非 owner 非 admin 拒 `P-<user>`、非 admin 拒 `P-archive`、scoped 拒未命中 `P2`、裸 `P-` 不入 user 池、空账本 `total=0` 不造数据；scoped 用户 `list_projects` 恰好 = `P-shared` + `P1`，不含 `P2`。
> **C·变异验证**：**C1 两次代码级变异**——① `projectInScope` shared 分支 `return true` → `return isAdmin`（突破「P-shared 恒可见」）→ **3 例红灯**（纯函数 2 + `list_projects` 端到端 1）→ 原样还原；② user 池 `account.user_id === owner || isAdmin` → `isAdmin`（owner 失去访问权）→ **1 例红灯**（owner 用例）→ 原样还原。还原后三池+作用域套件 26/26 复绿、全量 180/2210 复跑全绿。**C2 输入/状态变异矩阵**：`classifyProject` 6 类输入（含裸 `P-` 边界）；三池 × 账户矩阵（admin/non-admin/owner/他人/scoped）10 组合；注册表有/无记忆、隐式项目、scoped 合并可见性、`ensureSharedProject` 首建/幂等 —— 全部断言明确放行或拒绝，绝不静默。未做 C3（本提交含代码）。

| **D6-3 is_admin 字段与门禁骨架（#24）** | `1de63f2` | `mcpAuth.ts`：`McpAccount` 增可选 `is_admin` 字段（仅显式 `true` 视为 admin，缺省/`false`/其它一律非 admin）；`DEFAULT_MCP_ACCOUNT`（mcp-token.txt 默认引导令牌 = 本机单一信任域属主）显式 `is_admin: true`；新增 `isAdmin(account)` 门禁骨架辅助（D6-5 `create_project`/`mint_token` 的唯一门禁判据）。其余工具与 l0vault/L0 授权会话账户零改动（缺省非 admin）。`mcpThreePool.test.ts` 补 D6-3 段（引导账户断言 + isAdmin 矩阵 4 例） | 见下方三栏 |

> **D6-3 口径**：`is_admin` 语义 = D6-2 三池的 admin 判据（可见 `P-archive` 与任意 `P-<user>`）+ D6-5 管理工具的唯一放行身份。**严格真值判定**：`is_admin === true`，不接受字符串 `'yes'`/`1` 等伪造真值（C1 变异实证）。引导令牌（`DEFAULT_MCP_ACCOUNT`，scope `['*']`）天然是管理员——本机单用户默认账户即账本属主，同时消解 D6-2 已知边界（存量 `P-` 开头历史项目对默认账户的可见性）。l0vault 的 L0 授权会话账户不设 `is_admin`（缺省非 admin），语义独立不受影响。测试侧：`BOB`/`SCOPED` 显式 `is_admin: false`，防继承引导身份导致三池矩阵失真。
> **D6-3 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `mcpAuth.ts` 两处（`McpAccount` 接口 + `DEFAULT_MCP_ACCOUNT`）+ `isAdmin` 新增 + `mcpThreePool.test.ts` 账户构造适配（BOB/SCOPED 显式非 admin）。全量 `vitest run --maxWorkers=1` **180 文件 / 2212 项全绿**；`npm run typecheck` 两工程 0 错；oxlint 全量 547 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 320 文件。既有行为钉住：`mcpScope.test.ts`（SCOPED_ACCOUNT 继承 admin 但矩阵全为 general 项目，general 分支不读 admin 判据 → 期望值不变，全量通过印证）、D6-2 三池矩阵 10 组合、`l0vault.test.ts`、D6-1 注册表 26 例——均在全量中通过。
> **B·效果验证**：**状态真的变了**：`DEFAULT_MCP_ACCOUNT.is_admin === true`（引导令牌即管理员）且 `isAdmin` 放行；矩阵 4 例覆盖 `true`/缺省/`false`/伪造字符串 `'yes'`（严格判定下后三者均非 admin）。**反向断言**：缺省 `is_admin` 的账户（l0vault 授权会话形态）`isAdmin=false`；伪造 `'yes'` 被拒。
> **C·变异验证**：**C1 代码级变异**——`isAdmin` 的 `account.is_admin === true` 改为真值判断 `!!account.is_admin` → **1 例红灯**（`'yes' as unknown as boolean` 伪造身份被放行，`expected false to be true` 方向失败）→ 原样还原 → 19/19 复绿。**C2 矩阵**见 B 段 4 例。未做 C3（本提交含代码）。

| **D6-4 令牌代理 TokenStore + mint（#25）** | `d2649e3` | 新增 `tokenStore.ts`：`TokenRecord`（`token_hash`=sha256、`user_id`/`scope_project_ids`/`is_admin`/`label?`/`expires_at?`/`created_at`/`created_by`）+ `TokenStorePort`（`resolve`/`mint`/`list`）+ `InMemoryTokenStore`（测试）+ `FileTokenStore`（`mcp-tokens.json` 0600，mint 即写盘，缺库空库、损坏 fail-fast）+ `resolveAccountFor`（引导令牌→引导账户优先，库令牌按记录解析，未命中 null）；mint 生成 `mtk_<64hex>` 明文仅一次性回显、过期检查（≤now 拒签、解析时过期=不存在）、输入校验（user_id/scope/created_by 非空、expires_at 须未来）。接线：`mcp.ts`（`McpOptions.tokenStore` 注入、`SocketState.account`、鉴权点 `resolveAccountFor`、每 socket 会话账户贯穿全部工具 case）+ `mcpHttp.ts`（`McpHttpOptions.tokenStore`、401 点按库解析、`callTool`/`handleRpc` 收请求账户）；`main.ts` 装配 `FileTokenStore(userData/mcp-tokens.json)`（TCP/HTTP 共用实例）。新增 `tokenStore.test.ts` 12 例 | 见下方三栏 |

> **D6-4 口径（方案 A1 / 子方案 §3.2）**：令牌库只存 `sha256(明文)`（`token_hash`），明文只在 `mint` 返回值出现一次，绝不落盘/进日志（`list()` 可证）；文件 0600（Windows chmod 仅切只读位，尽力而为，诚实注释）。**解析语义**：`resolveAccountFor(candidate)`——与引导令牌常数时间相等 → 引导账户（`DEFAULT_MCP_ACCOUNT`，admin，`McpOptions.account` 可覆盖）；否则查库 → 命中返回库账户（scope/is_admin/user_id 按记录）；无库或未命中 → null（传输层 401/-32001）。**无库 = 现状行为不变**（仅引导令牌可用）。**库文件语义**：ENOENT → 空库（引导令牌兜底）；JSON/形状损坏 → 构造时抛错 fail-fast，绝不静默清空既有授权。**对子方案 §3.2 字段清单的一处必要补充**：`TokenRecord` 增 `user_id`——受限令牌代表某租户身份，`McpAccount` 解析与三池 `P-<user>` owner 判定必需；team/enterprise 沿用本机单一信任域默认。`mint_token` 的 **MCP 工具入口在 D6-5**（管理员门禁在编排层），本任务只落库能力与鉴权接线。会话账户粒度：TCP 每 socket 各自账户（`Session` 按解析账户建 agent），HTTP 每请求解析（共享 agent + `MemReq.user_id` 显式会话身份，与既有设计同构）。
> **D6-4 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `tokenStore.ts`（新）+ 两传输鉴权点（`mcp.ts` 鉴权/SocketState/Session/9 处工具 case、`mcpHttp.ts` 401/callTool/handleRpc/12 处引用）+ `main.ts` 装配 + `tokenEquals` 从 mcp.ts 移除（不再直用）。全量 `vitest run --maxWorkers=1` **180 文件 / 2224 项全绿**；`npm run typecheck` 两工程 0 错；oxlint 全量 549 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **321 文件**（+tokenStore.ts）。既有行为钉住：`mcp.test.ts` 54 例 + `mcpHttp.test.ts` 54 例（引导令牌全链路鉴权/工具/401 矩阵）、`mcpScope.test.ts`（scoped 令牌 HTTP 全链路）在全量通过——无库注入时两传输行为与 D6-2 基线完全一致。开发期逮住并修正一处自建测试的时序脆弱（30ms 真实等待改为 `resolve(token, now?)` 注入时钟，无 sleep 稳定）；另整目录偶现一次 `fileStorage.test.ts` reloadOnMtime 红灯经单跑 37/37 与全量复跑判定为 mtime 粒度 flaky（非本任务改动面，D6-2/D6-3 期间同测试多次全绿）。提交卫生 = 精确 `git add`。
> **B·效果验证**：AC→用例见子方案 §3.2 + `tokenStore.test.ts` 12 例。**状态真的变了**：mint → 明文 `mtk_` 前缀 ≥32 字符、库中仅 `token_hash`（`record.token_hash !== token`、`list()` JSON 不含明文）；resolve 命中返回 `user_id/scope/is_admin` 与签发一致的账户；`FileTokenStore` mint 后重开新实例 resolve 仍命中（落盘持久化）、文件存在。**反向断言**：未知/空/未携带令牌 → null；过期令牌（注入时钟到点）→ null 等同不存在；`expires_at ≤ now` 拒签；空 `user_id`/空 scope/空 `created_by` 明确拒绝；损坏库（非 JSON / 形状不符）构造即抛 `令牌库损坏`；无库时未知令牌仍 null（现状不变）；引导令牌在有库/无库两态下均返回 admin 引导账户。
> **C·变异验证**：**C1 代码级变异**——删去 `resolveRecord` 的过期检查（过期令牌仍放行）→ **1 例红灯**（注入时钟到点后 `expected … to be null` 实得账户）→ 原样还原 → 12/12 复绿。**C2 输入/状态矩阵**：命中/未命中/过期/空令牌；admin/非 admin/scope 组合；持久化重开；缺库/损坏（两种形态）；引导令牌×有库/无库×未知令牌 6 组合；多令牌互不串号 —— 全部明确拒绝或如实解析，绝不静默放行。未做 C3（本提交含代码）。

| **D6-5 create_project + mint_token 两工具（#26）** | `be4b29c` | 新增 `mcpProjectTools.ts`：`runCreateProjectTool`（admin 门禁 + 三池命名规则校验 + 重名前置拒绝 → `storage.createProject`）与 `runMintTokenTool`（admin 门禁 + 参数校验 → `store.mint`，明文一次性回显 + note 告知不可找回）；`mcpSchema.ts` `MCP_TOOLS` 增两工具（**tools/list 10→12**）+ `MCP_INSTRUCTIONS` 增第 9 条（管理员专属、非 admin 如实转告、明文令牌一次性转交不入库不入日志）；TCP(8202)/HTTP(8204) 各增两 case 复用共用编排；新增 `mcpProjectTools.test.ts` 11 例 + `mcpHttp.test.ts` D6-5 端到端 3 例（含 mint 后新令牌回连验证 scope 生效）；3 处既有 tools/list 数量断言 10→12 | 见下方三栏 |

> **D6-5 口径（子方案 §3.3 + §4 D6-5）**：**tools/list 数量勘误**——子方案表格写「11 工具」（§3.3 只计 create_project），实际 mint_token 并入后为 **12**，以代码与断言为准。**命名规则与 D6-2 命名约定对齐**（对子方案 §3.3「其余 P-<slug>」的一处修正）：kind=shared 固定 `P-shared`、kind=archive 固定 `P-archive`、kind=user 必须 `P-<owner_user_id>`（owner 缺省=调用者）、**kind=general 禁止 `P-` 前缀**——`P-<x>` 会被 `projectInScope` 判为 user 池（owner=x），受管 general 若允许该命名即与三池门禁自相矛盾；general 改用小写 slug（`^[a-z0-9][a-z0-9_-]{0,63}$`）。重名走 `getProject` 前置拒绝（-32602），不靠底层异常冒泡成 -32000。`mint_token`：`is_admin=true` 令牌只能由 admin 签发（编排门禁天然保证）；明文 `mtk_<64hex>` 仅在结果出现一次，库中仅 sha256；未装配 tokenStore 明确报错。指令第 9 条把「被拒如实转告、明文不入库不入日志」写进 Agent 行为约束。非 admin 令牌的 `create_project`/`mint_token` 一律 `-32602` 明确拒绝、零副作用。
> **D6-5 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `mcpProjectTools.ts`（新）+ `mcpSchema.ts`（tools 12 + instructions 第 9 条）+ 两传输 case（TCP/HTTP）+ 3 处既有 tools/list 数量断言（`mcp.test.ts` ×2、`mcpHttp.test.ts` ×1，10→12）。全量 `vitest run --maxWorkers=1` **180 文件 / 2235 项全绿**；`npm run typecheck` 两工程 0 错；oxlint 全量 551 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **322 文件**（+mcpProjectTools.ts）。既有行为钉住：既有 10 工具 schema/指令断言逐条保留（gc_report required/properties、recall/write required、instructions 点名会话视图）在全量通过。提交卫生 = 精确 `git add`。
> **B·效果验证**：AC→用例见子方案 §3.3 + `mcpProjectTools.test.ts` 11 例 + HTTP 端到端 3 例。**状态真的变了**：admin `create_project` → 注册表真落 `app1/httpapp`（kind/created_by/display_name 齐）且 `list_projects` 立即可见；admin `mint_token` → 明文返回一次、库中仅哈希、`resolve(明文)` 得到签发账户（scope/is_admin 一致）；端到端 mint 的 carol 令牌回连后 `list_projects` 恰好只见 scope 内 `httpapp`（不含 `otherproj`）、scope 外 write 被拒、scope 内 write 落库。**反向断言**：非 admin 两工具一律 `-32602`「仅管理员」且零副作用（`bobproj` 不落库、tokenStore 空）；重名/非法 kind/user 池 owner 不匹配/general 带 P- 前缀/非 slug 命名/空 scope/过期 expires_at/伪造 is_admin 均明确拒绝；未装配 tokenStore 报「未装配令牌库」。
> **C·变异验证**：**C1 代码级变异**——`runCreateProjectTool` 的 admin 门禁 `!isAdmin(account)` 改为恒放行 → **3 例红灯**（单元「非 admin 拒绝」+「admin 创建」（共享 storage 被 NON_ADMIN 用例污染连锁）+ HTTP 端到端「非 admin 拒绝且不落库」）→ 原样还原 → 三套件 119/119 复绿。**C2 输入/状态矩阵**：命名规则 8 组合（shared/archive 固定名、user 显式/缺省 owner、general slug/带 P- 前缀/非 slug、非法 kind）、重名、mint 的 user_id/scope/is_admin/expires/label 各非法形态、未装配 store、mint 后回连 scope 内外读写 —— 全部明确拒绝或如实放行，绝不静默。未做 C3（本提交含代码）。

| **D6-6 活文档同步（#27）** | 本次提交 | 同步批次46-D6 已落地能力到活文档：`记忆库工具能力清单.md`（§2.1 `list_projects` 补三池合并口径；§2.3 `create_project` 🔲→✅（D6-5 管理员专属）+ 新增 `mint_token` 行；Agent 面合计改「读7/写2/管4=13、tools/list 12 条目」；§4 令牌代理「不在 MCP 内实现」更正为 D6-4 内核级落地；§5 不变式 2 补三池语义；净新增清单标记 D6 全齐）；`需求规格书.md` §19.5（`list_projects` 行补三池口径；表格增 `create_project`/`mint_token` 两行；`gc_report` 行「仍 10 工具」附 D6-5 勘误注）；`MCP运维与多Agent写入规范.md`（§0.1 校正表 #3、§1.1 单令牌缺口、跨机认证表三处补「批次46-D6 已落地」并保留历史校验记录）；`AGENTS.md`（§1.1 工具数 10→12 + 管理工具口径；P1-10 ⑤ 段补三池门禁与令牌库，残留风险收窄）；`code-map.md` 回填 D6-1~D6-5 真实短哈希并追加本行。零源码改动 | 见下方三栏 |

> **D6-6 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4，纯文档任务用 C3 反向核对）**：
> **A·影响面回归**：影响面 = 5 份文档（`记忆库工具能力清单.md` / `需求规格书.md` / `MCP运维与多Agent写入规范.md` / `AGENTS.md` / `code-map.md`），**零源码改动**；`git status` 仅这 5 个文档文件；`npm run code:index:check` 仍 **322 文件最新**（无源码变化，索引无需刷新）；typecheck/oxlint 不适用（无 `.ts` 改动）。
> **B·效果验证（grep 核验）**：`create_project`/`mint_token` 在清单与规格书中均为「✅ 已落地（D6-5，管理员专属）」；`tools/list` 当前口径全部为 **12**（唯一残留的「仍 10 工具」是规格书 `gc_report` 行内的 46-4 历史口径引用，同行已附「〔批次46-D6-5 勘误：自 D6-5 起为 12 工具〕」，属可追溯记录不误导现状）；「令牌代理**不在 MCP 内实现**」旧断言 grep **0 命中**（已更正为 D6-4 内核级落地）；运维规范三处「尚未落地/属 D6 须先补」均补「批次46-D6 已落地」并保留历史校验记录；AGENTS.md P1-10 ⑤ 残留风险由「单令牌拿到即全库」收窄为「三池已按身份隔离，跨租户彻底收紧仍需租户归一」。代码侧事实复核：`tools/list` 12 条目、`mcpProjectTools.ts` admin 门禁、`tokenStore.ts` 仅存哈希——由 D6-2~D6-5 共 2235 项全量测试钉住，本任务不谎称未改。
> **C·变异验证（C3 反向核对）**：① 临时把清单 `create_project` 行改回「🔲 净新增（D23 本期不开）」→ 与已落地的 `mcpProjectTools.test.ts`/HTTP 端到端 3 例（admin 成功/非 admin 拒绝）直接矛盾，文档回退即失真；② 临时在清单 §4 写回「不在 MCP 内实现」→ 与 `tokenStore.ts` + `mint_token` 工具 + `mcp-tokens.json` 0600 已落地的事实矛盾。两处检出后均原样还原。提交卫生 = 精确 `git add` 5 个文档文件，不含临时文件。

| **45-A1 单一租户真源：tenant.json + 三写者对齐（#28）** | `53b024c` | 新增 `shared/tenantDefaults.ts`（规范缺省三元组 `DEFAULT_TENANT` = `u1/t1/e1` + `normalizeTenantTriple` 校验）与 `electron/tenantSource.ts`（`loadOrCreateTenant(dataRoot)`：数据根级 `tenant.json` 0600，首建写缺省、复用原样返回、损坏 **fail-fast 抛错阻断启动**）；`main.ts`：bootstrap 装配 `tenantTriple` 并双写 `bootstrap:tenant-source` 日志，采集器（L2738）/webhook（L2631）两处硬编码 `{u1,t1,e1}` 改读真源，TCP/HTTP MCP 引导账户改为 `{...tenantTriple, is_admin:true, scope_project_ids:['*']}`；`kernel.ts`：浏览器降级不再现造 `u_<ulid>/team_local/ent_local`，改用 `DEFAULT_TENANT`（登录 `bindTenant`/桌面壳 `syncTenantFromHost` 覆盖路径不动），`resetKernelForTests` 补 `tenantCache` 重置。新增 `tenantSource.test.ts` 7 例 + `kernelTenant.test.ts` 降级用例 1 例 | 见下方三栏 |

> **45-A1 口径（ROADMAP 批次45 §一 45-A1）**：三个写者（页面 kernel / 采集器·webhook / MCP 引导账户）共用同一真源——主进程裁决 `userData/tenant.json`，渲染层缺省值直接引用同一常量 `DEFAULT_TENANT`，杜绝「页面造一个、采集器写一个」的账本租户混住。缺省值与存量账本硬编码一致（u1/t1/e1，测试锁定不许漂移）→ 45-A2 存量归一迁移近零。损坏语义与 `mcp-tokens.json` 同口径：非 JSON / 三字段任一缺失或非字符串 → fail-fast 抛错，**绝不静默重造身份**（身份是账本归属的根）；`schema: tenant/1` 自述版本随首建写入，读取对未知 schema 宽容（只校验三元组字段）。MCP 引导账户三元组来自真源（缺省 u1/t1/e1 行为等价），`is_admin:true`（D6-3 本机属主口径不变）、scope `['*']`（45-A3 收紧前现状不变）。浏览器降级值仍持久化到 `mam.tenant.v1`（跨页面/跨重启稳定），登录/桌面壳真值覆盖链路不变；`team_local/ent_local` 字样自此从代码库清零。已知边界：`home` server 会话三元组（`enterprise_id:'local'`）与 tenant.json 是两个域——45-A1 只收敛**账本写者**，登录会话归一留给 45-A2/云端同步拍板。
> **45-A1 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `shared/tenantDefaults.ts`（新）+ `electron/tenantSource.ts`（新）+ `main.ts`（import + bootstrap 装配 + 两写者 + MCP 引导账户注入）+ `web/kernel.ts`（getTenant 降级 + resetKernelForTests + 文件头注释）+ 新增/适配 2 测试文件。全量 `vitest run --maxWorkers=1` **183 文件 / 2243 项全绿**；`npm run typecheck` 两工程 0 错；oxlint 全量 554 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **324 文件** + `check` 通过。既有行为钉住：`kernelTenant.test.ts` 原有 4 例（syncTenantFromHost 覆盖/降级/失败不动）、20+ 页面测试（resetKernelForTests 语义加强后全量通过）、`webhookServer.test.ts`、`dataRoot.test.ts`——均在全量中通过。开发期逮住一处测试辅助缺陷：`resetKernelForTests` 未重置 `tenantCache`，跨用例缓存泄漏使降级持久化断言拿到被 clear 的 localStorage → 补重置后复绿（同 D6-2「C1 过程中实证」口径）。
> **B·效果验证**：AC→用例见 ROADMAP 45-A1 + `tenantSource.test.ts` 7 例 + `kernelTenant.test.ts` 降级 1 例。**状态真的变了**：首建 → 文件落盘（含 `schema` 字段，POSIX 断言 0600）且返回缺省三元组；复用 → 已存在合法文件原样返回不改写（写入 `u_carol/t_x/e_x` 重启后仍返回）；降级 → `getTenant()` 等于 `DEFAULT_TENANT` 且持久化到 localStorage。**反向断言**：非 JSON / 缺字段 / 空字符串三种损坏形态均抛 `租户真源损坏` 不静默回落；`normalizeTenantTriple` 对非对象/数字字段拒绝、对多余字段（schema）宽容；缺省三元组与存量账本一致被测试锁定（漂移即红）。
> **C·变异验证**：**C1 两次代码级变异**——① kernel 降级改回现造 `u_<ulid>/team_local/ent_local` → **1 例红灯**（降级用例 expected u1/t1/e1 实得 ulid 身份）→ 原样还原；② tenantSource 字段损坏分支改为静默回落 `DEFAULT_TENANT` → **2 例红灯**（缺字段/空字符串均未抛错）→ 原样还原。还原后两套件 12/12 复绿、全量 183/2243 复跑全绿。**C2 输入/状态矩阵**：首建/复用/三形态损坏/空字段/多字段宽容；kernel 降级恒等 + 持久化 + sync 覆盖 —— 全部明确断言，绝不静默。未做 C3（本提交含代码）。

| **45-A2 存量账本租户归一（#29）** | `ee1c967` | 新增 `core/memagent/tenantNormalize.ts`：`scanRowsForTenantNormalize`（只读预览：mismatched/by_field/by_user/sample）+ `normalizeTenantFields`（把历史行 `team_id/enterprise_id` 重盖成 tenant.json 规范值，**user_id 与其余字段原样保留**；强制 `backup_confirmed` 备份闸门；逐行 `memory_op` op='tenant_normalize' 只记归属字段新旧值 + 整轮 `security_change` 汇总；幂等——已规范零写盘）；`main.ts` bootstrap 在 41-A 审计迁移块之后插入存量归一段：mismatched>0 且只读镜像 → deferred 留痕；否则 `backupBeforeKernelChange('tenant-normalize')` 备份失败即本次不迁（41-A 口径），成功则迁移并双写 `bootstrap:tenant-normalized`/`ledger:tenant-normalized` 日志；`tenantTriple` 装配上移至该块之前（A1/A2 共用真源）。新增 `tenantNormalize.test.ts` 6 例 | 见下方三栏 |

> **45-A2 口径（ROADMAP 批次45 §一 45-A2）**：归一目标 = 主进程 `tenant.json` 真源（bootstrap 现读现用，不是硬编码）；**user_id 保留原值**——混住行里的 `u_<ulid>`/`u1` 都是真实历史身份，归一只收敛「这笔账属于哪个团队/企业」，不伪造「是谁写的」。墓碑行不归一（保留原样诚实计数）；pinned/locked 照样归一（只改归属字段不碰内容）但单列计数。判定 = `m.team_id ?? '' !== target.team_id || m.enterprise_id ?? '' !== target.enterprise_id`（缺失字段视同 mismatch，归一到规范值）。触发时机 = bootstrap 自动（每启必扫，mismatched=0 时只留 `tenant-normalize-clean` 一条日志，**幂等不写盘**）——与 ROADMAP 参照的批次41-A 审计迁移同模式，无 UI 依赖、无逐字口令（本模块不删行、不改正文、不动 version/updated_at/层级，与 REJUDGE/RESET/REBUILD 不同类）。审计行级 detail 只含字符串归属字段新旧值 + `user_id_kept`，正文一个字不进账本。
> **45-A2 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `tenantNormalize.ts`（新）+ `main.ts`（import + A1 装配块上移 + bootstrap 归一段）+ 新增 `tenantNormalize.test.ts`。全量 `vitest run --maxWorkers=1` **184 文件 / 2249 项全绿**；`npm run typecheck` 两工程 0 错；oxlint 全量 556 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **325 文件** + `check` 通过。既有行为钉住：D6 系列全部 MCP/令牌测试、`fieldBackfill.test.ts`（同模式模板）、`fileStorage`/`storage` 套件（putMemory/listMemories 语义）——均在全量中通过。开发期修正三处自建测试夹具笔误（「已规范」行忘覆盖缺省 `ent_local` → 预览/执行/审计 3 例错算）、一处 TS 字面量拓宽（`ok` 常量漏 `as const` → `backup_confirmed: true` 拓宽为 boolean）、一处 main.ts 声明顺序（A1 装配块上移至 A2 使用点之前）。
> **B·效果验证**：AC→用例见 ROADMAP 45-A2 + `tenantNormalize.test.ts` 6 例。**状态真的变了**：混住行（`team_local/ent_local`）归一后 `team_id='t1'`/`enterprise_id='e1'` 且 `user_id='u_legacy'` 保留、version/pinned/created_at/content 一字不动；逐行审计含新旧值与 `user_id_kept`，汇总审计含 target/by_field/by_user/sample_ids；预览零写盘零审计（JSON 快照对比）。**反向断言**：墓碑行原样保留；缺管理员/缺备份确认/空目标三类拒绝且零写盘零审计；二次运行 mismatched=0 零写盘（幂等）；行审计不含正文。
> **C·变异验证**：**C1 代码级变异**——`normalizeTenantFields` 写入行去掉 `enterprise_id` 归一（只盖 team_id）→ **3 例红灯**（执行断言 enterprise 未变 / 幂等二次跑仍 mismatched / 受保护行 enterprise 未归一）→ 原样还原 → 6/6 复绿、全量 2249 复跑全绿。**C2 输入/状态矩阵**：mismatch 三形态（双差/单差 team/单差 ent）+ 已规范 + 墓碑 + protected + 多 user 分布；拒绝矩阵 3 类；幂等重跑；审计成对与脱敏 —— 全部明确断言，绝不静默。未做 C3（本提交含代码）。

| **45-B1 成员/API 密钥域模型 + 真实空表（#30）** | `67e9d0e` | 新增 `core/memagent/memberStore.ts`：内核 `MemberRecord`（`member_id`/`name`/`role` admin\|member/租户三元组/`status` active\|suspended）与 `ApiKeyRecord`（`key_id`/`owner_member_id`/**`secret_hash`=sha256 绝不留明文**/`scope_project_ids`/`created_at`/`revoked_at`+`revoked_by`）+ `MemberStorePort`（`createMember` 显式主键重复拒绝 / `listMembers` 按 role+status 过滤 / `mintApiKey` 明文 `apk_<64hex>` 一次性回显 + owner 必须存在且 active / `revokeApiKey` 幂等 / `resolveSecret` 常数时间比较 + 已吊销=null）；`InMemoryMemberStore`（测试）+ `FileMemberStore`（`userData/members.json` 0600，**构造时缺文件即落一份真实空表** `{members:[],api_keys:[]}`，create/mint/revoke 即写盘，损坏 fail-fast 与 mcp-tokens.json 同口径）；`main.ts` bootstrap 装配 + `bootstrap:member-store-ready` 双写日志。新增 `memberStore.test.ts` 10 例 | 见下方三栏 |

> **45-B1 口径（ROADMAP 批次45 §二 45-B1）**：独立 `MemberStorePort`（**不扩 `StorageBackend`**）——六个后端实现各加 7 方法的改动面不成比例，且成员/密钥是身份域数据不是记忆数据，D6-4 `TokenStorePort` 文件库先例完全适用。「真实空表」的落地方式 = `FileMemberStore` 构造时缺文件即写 `{schema:'members/1', members:[], api_keys:[]}`（0600）——§9 欠账的表从第一天起真实存在、可审计，不是 UI 假象，也不展示演示行。密钥红线与 D6-4 令牌完全一致：只存 sha256、明文一次性回显、不进日志/审计/URL；吊销 = `resolveSecret` 返回 null（不泄露「曾存在」）；已停用（suspended）成员拒签新密钥。B1 只落域模型与存储端口——**调用入口刻意不建**：成员登记的授权口径（谁能建谁）与 home 账号绑定是 45-B2，密钥进 MCP 门是 45-B3，main.ts 仅装配空表并 `void memberStore` 显式标注无消费方。与既有体系的关系：`role` admin|member 对应 home 侧 `AccountRecord` 角色（B2 映射）；`scope_project_ids` 复用 D6-2 三池口径（B3 进 `McpAccount`）。
> **45-B1 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `memberStore.ts`（新）+ `main.ts`（import + bootstrap 装配 + `void` 标注）+ 新增 `memberStore.test.ts`。全量 `vitest run --maxWorkers=1` **185 文件 / 2259 项全绿**；`npm run typecheck` 两工程 0 错（开发期逮住一处 `memberStore` 未使用 TS6133 → `void` 显式标注 + 诚实注释）；oxlint 全量 558 文件 **0 warnings / 0 errors**；`code:index -- --write` 刷新 **326 文件** + `check` 通过。既有行为钉住：D6 系列 tokenStore/mcp 全套件（同构文件库口径互证）——均在全量中通过。
> **B·效果验证**：AC→用例见 ROADMAP 45-B1 + `memberStore.test.ts` 10 例。**状态真的变了**：`FileMemberStore` 构造即落真实空表文件（内容精确断言 `{schema,members:[],api_keys:[]}`，POSIX 0600）；create+mint 后重开新实例成员与密钥哈希都在、`resolveSecret(明文)` 命中且**文件不含明文**。**反向断言**：重复 member_id / role 与 status 非法 / 六个必填字段空字符串 → 全部显式拒绝零副作用；owner 不存在 / 已停用 / scope 空 → 拒签；未知与空明文 → null；吊销后 resolve → null 且重吊不重盖时间、listApiKeys 缺省滤掉已吊销；非 JSON 与形状不符两种损坏 → 构造抛「成员库损坏」且损坏文件原样保留。
> **C·变异验证**：**C1 两次代码级变异**——① `resolveSecret` 删掉已吊销检查（吊销密钥仍可解析）→ **1 例红灯**（吊销后 `expected null` 实得记录）；② 停用成员签发校验改为跳过 → **1 例红灯**（suspended owner 拒签用例）→ 均原样还原 → 10/10 复绿、全量 2259 复跑全绿。**C2 输入/状态矩阵**：成员登记校验 7 形态 + 重复主键；role/status 过滤组合；mint 的 owner 三态（存在 active/不存在/suspended）+ scope/created_by 非法；吊销幂等与可见性过滤；文件库三态（缺文件建空表/合法重开/两种损坏）—— 全部明确断言，绝不静默。未做 C3（本提交含代码）。

| **45-A3 MCP 作用域收紧："*" 仅属本机属主引导账户（#31）** | `4bf0d35` | `mcpAuth.ts`：新增 `scopeHasWildcard(scope)` 共用判定（mint 编排/库层/解析层三处共用，防口径分家）；`mcpProjectTools.ts` `runMintTokenTool`：`scope_project_ids` 含 `'*'` 且目标令牌非 admin → `-32602` 拒签（admin 给 admin 令牌签 `'*'` 仍放行 = 本机属主委托）；`tokenStore.ts`：`assertMintInput` 库层同样拒签非 admin `'*'`（双保险）+ `resolveRecord` 对存量/被篡改的「非 admin 持 `'*'`」记录 **fail-closed**（解析即 null，等同不存在、记录保留可审计）；`DEFAULT_MCP_ACCOUNT`（`['*']` + `is_admin:true`）不变——本机单租户拍板口径下它是 `'*'` 的**唯一合法持有者**。测试 +6 例（tokenStore 2 / mcpProjectTools 2 / mcpThreePool 不变式补断言 / 既有 mcpHttp bob-mint-'*' 用例天然命中 admin 门禁先行）；活文档同步 AGENTS.md P1-10 ⑤ / 能力清单 mint_token 口径 / 需求规格书 mint_token 行 | 见下方三栏 |

> **45-A3 口径（ROADMAP 批次45 §一 45-A3，拍板 = 本机单租户先行）**：ROADMAP 的 A3 有两条路径——「41-J/42 云端同步（多机）」或「本机单租户口径（单机）」；本提交按**单机口径**落地：`'*'` 全放行语义保留，但**唯一持有者收敛为本机属主引导账户**（`DEFAULT_MCP_ACCOUNT` 与 main.ts 注入真源三元组的引导账户，均 `is_admin=true`）。非 admin 受限令牌必须在签发时显式列出可见项目（三池可见性仍在其上生效）——堵住「单机默认 `['*']` 经 mint 泄漏成任意令牌全放行」的口子。**前置已由 45-A 满足**：A1 三写者同源 + A2 存量 team/enterprise 归一后，账本里不存在按 team 硬过滤会打穿 §1.1 召回的混住行；单机模式下「按 team/enterprise 硬过滤」由构造达成（全账本同一规范三元组），无需行级过滤——多机场景留给 42 云端同步拍板（AGENTS P1-10 ⑤ 已如实更新）。防御纵深三层：工具层 `-32602`（HTTP/TCP 同源编排）→ 库层 mint 拒签 → 解析层 fail-closed（不信任绕过前两层落盘的记录）。
> **45-A3 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `mcpAuth.ts`（新增导出）+ `mcpProjectTools.ts`（mint 编排一道闸）+ `tokenStore.ts`（mint 拒签 + resolve fail-closed）+ 3 个测试文件（新增 4 例 + 1 处不变式补断言）+ 3 份活文档。全量 `vitest run --maxWorkers=1` **185 文件 / 2263 项全绿**；`npm run typecheck` 两工程 0 错；oxlint 558 文件 **0 warnings / 0 errors**；`code:index:check` 326 文件无新文件无需刷新。既有行为钉住：D6 系列全部 MCP/令牌/三池套件（含 mcpHttp 端到端「bob 持 `'*'` 调 mint_token → 仅管理员」——admin 门禁先行，A3 闸在其后不冲突）、D6-4 既有 `is_admin:true` 签 `'*'` 用例——均在全量中通过。过程纪律：一次全量与 C1 变异窗口重叠出现 1 例红灯（fail-closed 检查被临时移除所致），还原后重跑全量确认，该次结果作废不计。
> **B·效果验证**：AC→用例见 ROADMAP 45-A3 + 新增用例。**状态真的变了**：admin 给非 admin 签 `'*'`（含 `['*','P1']` 混合数组）→ `-32602` 且库零副作用；admin 给 admin 签 `'*'` → 放行且 resolve 生效；手工构造的存量违规记录（模拟文件被篡改/旧版遗留）→ `resolve` 返回 null 但 `list()` 仍可见（可审计不清除）。**反向断言**：`DEFAULT_MCP_ACCOUNT.scope_project_ids === ['*']` + `is_admin===true` 不变式被测试锁定；库层拒签错误信息含「45-A3」可溯源；fail-closed 不泄露「曾存在」。
> **C·变异验证**：**C1 两次代码级变异**——① `resolveRecord` 删 fail-closed 检查 → **1 例红灯**（存量违规记录被放行）；② `runMintTokenTool` 删 `'*'` 闸 → **1 例红灯**（期望 `-32602` 的 McpToolError 实得库层普通 Error）→ 均原样还原 → 43/43 复绿、全量 2263 重跑全绿。**C2 输入/状态矩阵**：`'*'` 单独/混合数组/is_admin 三态 × 工具层与库层两闸；存量记录 fail-closed vs 合法记录解析；admin 委托放行 —— 全部明确断言，绝不静默。未做 C3（本提交含代码，活文档 3 处同步随提交、grep 可核对）。

| **45-B2 home 账号 ↔ 内核 Member 打通（#32）** | `a1bb788` | 新增 `auth/memberSync.ts`：`syncMembersFromHome(store, views)` **单向 upsert**（home 账号视图 → 内核成员库：新账号登记 `member_id=user_id=账号名`、角色/团队/企业变更经 `updateMember` 跟随、两边一致零写盘；**不删除**内核侧 home 没有的成员；**status 不参与同步**——suspended 是内核侧保留状态，同步绝不重置为 active；幂等可重跑）+ `syncMembersFromHomeNow`（直读 loginService 当前快照）；`memberStore.ts` 增 `updateMember`（`member_id`/`user_id` 身份锚点**不可变**，patch 校验，未知 → null；InMemory + File 双实现，File 即写盘）；`home/server.ts`：`ServerOptions.memberStore`（缺省未装配 = 内核空表诚实空态）+ 两个同步点——`persistAccounts()` 汇聚点（注册/角色/团队/密码落盘全部经过它）+ 启动首帧对账（快照导入的存量账号兜底，幂等）；`main.ts`：memberStore 装配上移至 home server 创建之前并注入。测试：`auth/__tests__/memberSync.test.ts` 5 例 + `home/__tests__/memberSync.test.ts` 集成 2 例（HTTP 全链路：启动对账 / register 验证码流程 / accounts/update 角色变更跟随） | 见下方三栏 |

> **45-B2 口径（ROADMAP 批次45 §二 45-B2）**：home 账号域（`loginService` 的 AccountView）是账号身份**真源**，内核 memberStore 是「这是个 member」的域——同步是**单向 home → kernel**，内核绝不反写 home。**身份映射**：`member_id = user_id = home 账号名`（登录会话身份即账号名，与 45-A1 `bindTenant` 链路一致）；`role` 直接映射（home `admin|member` → 内核 `Member.role`）；`team_id/enterprise_id` 取 home 分配值（注意：home 会话三元组与账本规范三元组是**两个域**——45-A1 已知边界，成员表记录的是 home 身份元数据，账本行归属仍由 45-A1/A2 管辖，两者在 42 云端同步拍板时对齐）。**不变量**：`member_id`/`user_id` 不可变；`status` 只由内核侧管理（home 无停用概念）；密码哈希与一切凭据材料**绝不进成员库**（loginService 的域不越界）。**零改动面控制**：loginService 保持零依赖纯内核不动，同步逻辑独立成模块；未注入 memberStore 的 home server（既有测试/其它入口）行为完全不变。`updateMember` 是 45-B1 端口的一次必要扩展（角色变更传播需要它），校验与不可变锚点口径在端口层强制。
> **45-B2 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `memberStore.ts`（+updateMember 双实现）+ `auth/memberSync.ts`（新）+ `home/server.ts`（options + 两同步点）+ `main.ts`（装配上移 + 注入）+ 2 个新测试文件。全量 `vitest run --maxWorkers=1` **187 文件 / 2270 项全绿**；`npm run typecheck` 两工程 0 错（开发期逮住 2 处：测试误从 memberSync 导入未 re-export 的 `AccountView` 类型 / 未使用辅助函数——改从 loginService 导入并删除死代码）；oxlint 561 文件 **0 warnings / 0 errors**（逮住 1 处测试内无谓对象展开）；`code:index` 刷新 **327 文件**。既有行为钉住：home 全套端点测试（未注入 memberStore 路径零行为变化）、memberStore 10 例（B1 契约不破）、D6/45-A 全系列——均在全量中通过。
> **B·效果验证**：AC→用例见 ROADMAP 45-B2 + 7 例。**状态真的变了**：server 集成（HTTP 全链路）启动首帧对账把播种 admin + 存量 carol 登记进内核库；`POST /api/register`（验证码流程走通）后 `personal-<账号>` 团队成员即时出现在成员库；`/api/accounts/update` 角色变更（admin 专属门禁后）内核 `Member.role` 跟随为 admin。**反向断言**：幂等重跑 created=updated=0；内核侧手工成员不被删除；suspended 不被同步重置（含角色变更触发更新的场景）；文件库重开数据一致且不含 'password' 字样；`user_id`/`created_at` 不被更新覆盖。
> **C·变异验证**：**C1 代码级变异**——`syncMembersFromHome` 删掉 `updateMember` 调用（变更不跟随，只虚增计数）→ **4 例红灯**（单元角色/团队跟随 + status 场景 + 混合计数 + server 集成角色变更）→ 原样还原 → 7/7 复绿、全量 2270（变异前有效全量）复跑确认。**C2 输入/状态矩阵**：创建/更新/unchanged 三态计数；role/team/enterprise 逐字段变更；suspended × unchanged 与 × 更新两场景；内核侧多余成员存活；文件库持久化与无密码材料 —— 全部明确断言，绝不静默。未做 C3（本提交含代码）。

| **45-B3 API 密钥进 MCP 门（#33）** | `4cd0dce` | `memberStore.ts`：`mintApiKey` 增 **45-A3 收紧口径延伸**（member 角色成员拒签含 `'*'` 的密钥，admin 角色放行=本机属主委托）+ 新增 `resolveApiKeyAccount(store, candidate, now?)`（鉴权链第三环解析：未命中/已吊销 → null；owner 停用 → **立即断其全部密钥**；owner 非 admin 而存量密钥持 `'*'` → fail-closed；命中 → McpAccount = owner 成员租户三元组 + 密钥 scope + `is_admin = owner.role==='admin'`）；`tokenStore.ts` `resolveAccountFor` 升级**三环**：引导令牌 → mtk_ 受限令牌库 → apk_ 成员 API 密钥（前环命中即返回，未装配环跳过）；`mcp.ts`/`mcpHttp.ts`：`McpOptions.memberStore` 注入鉴权点（缺省未装配 = 仅引导/令牌库可用，现状不变）；`home/server.ts` 新增 **admin 专属管理端点** `GET /api/keys`（只含元数据视图，secret_hash 不外泄）/ `POST /api/keys/mint`（明文一次性回显、审计 `key_mint` 不含明文）/ `POST /api/keys/revoke`（审计 `key_revoke`）；`types/home.ts` LoginAudit action 枚举扩两值；`main.ts` memberStore 注入两 MCP 传输。测试 +10 例（memberStore 3 / tokenStore 2 / home 端点集成 2 + 前批 B2 3） | 见下方三栏 |

> **45-B3 口径（ROADMAP 批次45 §二 45-B3）**：单一机器级 MCP 令牌升级为「member 的 API key」——每个 key 携带自己的 `scope_project_ids`（复用 45-A 规范租户 + 45-A3 收紧口径），`McpAccount` 由 key 解析而来。**鉴权链三环**（优先级递减）：① 引导令牌（`mcp-token.txt`，本机属主 admin）；② D6-4 受限令牌（`mtk_`，`mcp-tokens.json`）；③ 45-B3 成员 API 密钥（`apk_`，`members.json`）。**身份映射**：账户三元组取 owner 成员（B2 同步进来的 home 身份域），`is_admin = owner.role==='admin'`（B2 角色映射进 MCP 门禁）——home admin 的密钥可见 `P-archive`/任意 `P-<user>`，member 的密钥走三池 + 显式 scope。**fail-closed 三条**：吊销 → null；owner 停用 → 该成员全部密钥立即失效（一个动作断全部凭据）；存量「非 admin 持 `'*'`」记录 → null（不信任绕过签发校验落盘的记录）。**管理面**：轮换/撤销走 home 管理员端点 + 审计（`key_mint`/`key_revoke`，均不含明文）；明文只在 mint 响应出现一次（与 mtk_/AGENTS 红线一致）。**兼容性**：`memberStore` 未装配的传输（既有测试/其它入口）行为完全不变——第三环只有装配后才参与。
> **45-B3 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `memberStore.ts`（通配符门禁 + resolveApiKeyAccount）+ `tokenStore.ts`（resolveAccountFor 三环）+ 两传输（options + 鉴权点）+ `home/server.ts`（三端点）+ `types/home.ts`（审计枚举）+ `main.ts`（注入）+ 3 个测试文件扩展。全量 `vitest run --maxWorkers=1` **187 文件 / 2277 项**：四轮复跑 3 绿 + 1 例偶现红灯——失败点正是 D6-2/D6-4 期间已两次记录的 `fileStorage.test.ts` reloadOnMtime（**mtime 粒度 flaky**，单跑 37/37 绿、B3 未触碰 fileStorage 任何代码，非本任务改动面）；`npm run typecheck` 两工程 0 错（开发期逮住 2 处测试 HeadersInit `string|undefined` → 非空断言）；oxlint 561 文件 **0 warnings / 0 errors**；`code:index --write` 刷新 **327 文件**。既有行为钉住：`mcpHttp.test.ts` 端到端 55+ 例（未装配 memberStore 路径零变化）、D6-4 令牌矩阵、45-A3 `'*'` 收紧、B1/B2 全部契约——均在全量中通过。开发期还逮住并修正一处**测试架构缺陷**：共享 `beforeEach` 误放在第一个 describe 内部，B3 用例缺少状态重置、前用例的 carol=admin 跨 describe 泄漏（临时调试定位后钩子上移到文件级，vitest describe 级钩子只作用于本 describe——已留注释）。
> **B·效果验证**：AC→用例见 ROADMAP 45-B3 + 新增 10 例。**状态真的变了**：member 角色成员签 `'*'` 密钥 → 库层 400 拒签（HTTP 端点级验证）；admin 角色成员密钥 `resolveApiKeyAccount` → owner 三元组 + `is_admin:true`；member 密钥 → `is_admin:false`；revoke（HTTP 端点）后 `resolveSecret`/`resolveApiKeyAccount` 均 null。**反向断言**：非 admin 会话 `/api/keys` 401/403；list 视图无 `secret_hash` 无明文；owner 不存在 400；未装配 memberStore 时 apk_ 不可用（现状不变）；`mtk_` 优先于 `apk_`。
> **C·变异验证**：**C1 两次代码级变异**——① `resolveApiKeyAccount` 删 owner 停用检查 → **1 例红灯**（停用成员密钥仍可解析）；② 删 `is_admin = owner.role==='admin'` 角色映射（恒 true）→ **2 例红灯**（member 密钥 is_admin 断言 ×2）→ 均原样还原 → 38/38 复绿、全量 2277 复跑全绿。**C2 输入/状态矩阵**：三环顺序 × 装配组合；角色 × `'*'` 门禁（member 拒/admin 放）；吊销/停用/未命中 fail-closed；HTTP 端点 401/403/400/404 矩阵 —— 全部明确断言，绝不静默。未做 C3（本提交含代码）。

| **42-A 内核 sync() 接真（#34）** | `ab2eeb4` | `types.ts`：`MemAgentOptions.hub?`（AnySyncHub 注入口，缺省 = 诚实降级）+ `SyncReq.since?`（下行游标，缺省 0 全量靠版本比对去重）+ `SyncReport` 细分 `dedup/behind/lww/l0_skipped/cursor?`；`agent.ts` `sync()` 重写**双分支**——hub 未注入保留 `E_NOT_IMPLEMENTED` + `implemented:false` 审计（诚实降级不是功能缺失）；注入后 push = `syncUp(storage, hub, form)`（sha256 幂等 + 自动 LWW，仅语义互斥进 §9.7 队列）、pull = `syncDown(hub, storage, 本端租户三元组 scope, since, form)`，审计 `implemented:true` 带真实 pushed/pulled/细分；`sync.ts` syncUp 引擎层加 **L0 红线**（`has_l0 || content_l0_enc` 行不进上行，`l0_skipped` 计数如实回报不静默——对所有调用方生效）；测试：新建 `agentSync.test.ts` 4 例（push 含 L0 红线 / pull 含 since 增量 / 冲突透传且本地版本不动 / 降级保留且账本零变动）+ `syncL0Honesty.test.ts` 改写（降级用例口径更新 + 注入真跑两用例）+ `contract.test.ts` 措辞校准 | 见下方三栏 |

> **42-A 口径（ROADMAP 批次42 §一 42-A）**：内核 `sync()` 从恒抛 `E_NOT_IMPLEMENTED` 换成真调 `syncUp`/`syncDown`——调用方（端壳）注入 `hub`（内存 SyncHub 或进程内 pglite PgSyncHub）+ 本端 store 即接通。**前置拍板（按持续授权采纳推荐口径）**：① 中枢形态 = 单机 pglite 文件中枢先行（`dataDir` = 数据根 `sync-hub/`，42-B 落地；远端 PG 留待后续拍板）；② 裁决 = 全自动 LWW 先行 + 冲突如实进 §9.7 队列，人工裁决页后补（42-C）。**诚实降级保留**：hub 未注入（纯浏览器 web kernel / 既有测试）→ `E_NOT_IMPLEMENTED` + `implemented:false`，绝不假装接通；coreHome 的 `wired=false` 判定（基于审计 `implemented !== false`）42-A 不动——web 端无中枢装配，wired=false 依旧诚实，桌面端 42-B 才翻真。**L0 红线**：方案红线「L0 密文层不进同步上行」落在 syncUp **引擎层**（而非仅 agent 层）——未来 42-B IPC / CLI 等调用方全部被红线覆盖；L0 行本地原样保留（不打戳不清 pending），`l0_skipped` 进报告与审计。**游标职责**：内核 API 不持久化游标；`SyncReq.since` 由端壳传入（42-B 端壳持有），缺省 0 全量下行靠既有版本比对去重，幂等安全。
> **42-A 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `types.ts`（3 处类型扩展）+ `agent.ts`（sync 重写 + import）+ `sync.ts`（SyncUpReport + 红线行）+ 3 个测试文件（新建 1 + 改写 1 + 措辞 1）。全量 `vitest run --maxWorkers=1` **188 文件 / 2283 项全绿**（基线 187/2277 → +1 文件 +6 例）；`npm run typecheck` 两工程 0 错；oxlint **0 warnings / 0 errors**；`code:index --write` 刷新 **327 文件**。既有行为钉住：sync 引擎全套（sync.test 17 例 / pgSyncHub 语义一致 + 落盘 + 三端集成）、contract/syncL0Honesty 诚实边界套件、D6/45 全系列——均在全量中通过。开发期逮住 2 处：SyncReport 最初漏 `l0_skipped` 透传字段 / pull 用例误断言最早审计（queryAudit 时间正序，改断言末轮并加 toHaveLength(2)）。
> **B·效果验证**：AC→用例见 ROADMAP 42-A + 新增 6 例。**状态真的变了**：hub 注入后 push 真上行（中枢镜像 1 行、审计 `implemented:true pushed:1 l0_skipped:2`）；pull 真下行（他端 2 行落本地、cursor 回传、since=cursor 二次拉 0 行）；同 updated_at 语义互斥 → conflicts=1 + §9.7 队列 pending + 本地版本不动。**反向断言**：L0 行（has_l0 与 content_l0_enc 两形态）不上行且本地 `has_l0` 原样保留；hub 未注入 → E_NOT_IMPLEMENTED + `implemented:false` 审计 + 不含 pushed/pulled 字段 + 本地数据零变动。
> **C·变异验证**：**C1 两次代码级变异**——① agent.ts 删 hub 未注入降级块 → **3 例红灯**（agentSync 降级 + syncL0Honesty 降级 + contract 降级，三道防线全响）；② sync.ts 删 L0 红线行 → **1 例红灯**（pushed=3≠1，L0 行混进上行）→ 均原样还原 → 24/24 复绿 + 全量 2283 复跑确认。**C2 输入/状态矩阵**：push/pull/降级三分支；L0 两字段形态 × 明文行混合账本；since=0 全量 vs since=cursor 增量；冲突 pending vs 本地保留 —— 全部明确断言，绝不静默。未做 C3（本提交含代码，coreHome/TopBar 措辞 42-A 未动、源码声明测试锁定）。

| **42-B 端壳中枢 + IPC（#35）** | `230be81` | `ipcChannels.ts` +8 通道（`sync:push/pull/reconcile/conflicts/resolve/cursor/auditCount/auditsFrom`）；`main.ts`：模块级 `syncHub`（主进程 PgSyncHub，dataDir=数据根 `sync-hub/`）+ bootstrap 装配（建表幂等；**init 失败不阻断启动**——同步是增量能力，置 null + 双写日志，handler 如实报「中枢未就绪」）+ 8 个 handler（上行/下行/对账/冲突列表/审计游标 `requireSession`；**人工裁决 `sync:resolve` `requireAdmin`**；team_id 渲染层 kernelAccount 传入=45-A1 规范真值，信任边界与 storage:* 一致）；`preload.ts` +sync 命名空间（sessionId 末参，resolve 需管理员）；`hostBridge.ts` HostMethod + CHANNEL_TO_NATIVE 接线；新建 `web/shared/syncHub.ts` **HostSyncHub**（AnySyncHub 结构同构代理：unwrap IpcResult + pull/reconcile 剔除信封字段返回形状与 PgSyncHub 严格一致）；`web/kernel.ts` `hostSyncHub()`（与 L0 端口同一宿主能力判定）注入 getKernel/createKernelOnSameStorage；`sync.ts` AnySyncHub 从 class union 改为 **SyncHubLike 接口**（class 带 private 字段结构化失效，接口化后内存/PG/宿主代理三实现均兼容，引擎全 await 双兼容不变）；测试：新建 `syncHub.test.ts` 4 例 + `kernelSync.test.ts` 3 例（kernel 级全链路：mock IPC→真 SyncHub 支撑）+ syncL0Honesty 装配契约补 `...hostSyncHub()` 断言 | 见下方三栏 |

> **42-B 口径（ROADMAP 批次42 §一 42-B）**：中枢落地形态按前置拍板 = **单机 pglite 文件中枢**（`sync-hub/` 与账本同数据根，桌面/Web/CLI 同机跨端；远端 PG 留待后续拍板）。**启动韧性**：中枢 init 失败 ≠ 应用启动失败（增量能力），降级 null + 日志，sync:* handler `E_NOT_IMPLEMENTED` 如实报——绝不假装可用。**权限矩阵**：会话动作 = push/pull/reconcile/conflicts/cursor/auditCount/auditsFrom；管理员动作 = resolve（§42-B 前置拍板②：全自动 LWW 先行，人工裁决页 42-C 落 UI 但门禁先收紧）。**信任边界**：team_id/user_id 由渲染层 kernelAccount 传入（45-A1 已归一 tenant.json 规范真值），主进程只校验非空——与 storage:* 通道同信任级别（本机渲染层）；主进程派生口径留给 42-D 收口评估。**迁移白名单**：`sync-hub/` 是目录不是文件，`DATA_ROOT_MIGRATE_FILES` 文件白名单不适用——42-D「备份与迁移收口」专项处理（口径对齐 41-A 审计备份），42-B 不动 dataRoot 防口径混改。**wired 语义**：coreHome `wired=false` 基于「审计中无 `implemented !== false` 的同步记录」——桌面壳 hub 注入后第一次真 sync 翻真，纯浏览器依旧诚实 false；42-B 不改 coreHome 判定逻辑（它已经按审计事实工作）。
> **42-B 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `ipcChannels.ts`（+8）+ `main.ts`（import/模块级/装配/8 handler）+ `preload.ts`（+sync 命名空间）+ `hostBridge.ts`（+8 映射）+ `web/shared/syncHub.ts`（新）+ `web/kernel.ts`（hostSyncHub + 两装配点）+ `sync.ts`（AnySyncHub 接口化）+ 3 个测试文件（新建 2 + 补断言 1）。全量 `vitest run --maxWorkers=1` **2290 项全绿**（42-A 基线 2286 → +7 新例 +1 装配断言 -3 旧口径重写）；`npm run typecheck` 两工程 0 错（开发期逮住 3 处：AnySyncHub class union 无法结构化容纳 HostSyncHub → 接口化 SyncHubLike / SyncHub.listConflicts 无参 / mock args 可选签名）；oxlint **0 warnings / 0 errors**；`code:index --write` 刷新 **328 文件**（+syncHub.test）。既有行为钉住：sync 引擎全套 / agentSync / kernelTenant / syncL0Honesty / D6-45 全系列——均在全量中通过。
> **B·效果验证**：AC→用例见 ROADMAP 42-B + 新增 7 例。**状态真的变了**：kernel 级全链路（mock IPC = 真 SyncHub 支撑）——seed 行 push 后 mock 中枢镜像 1 行 + `sync:push [mem,'web']` / `sync:auditCount` 通道真调用；他端上行 → kernel pull 落本地 `pulled=1` 且 cursor 回传；HostSyncHub 8 方法通道/参数逐一验证 + 引擎 syncUp/syncDown 经代理真跑通（applied=1 / pulled=1）。**反向断言**：纯浏览器（capability=none）不注入 → `E_NOT_IMPLEMENTED` 且零 sync 通道调用；中枢 `ok:false` → MemAgentError 如实抛；pull/reconcile 返回形状与 PgSyncHub 严格一致（toEqual 不含信封字段）。
> **C·变异验证**：**C1 两次代码级变异**——① kernel.ts `hostSyncHub()` 删纯浏览器不注入判定（恒注入）→ **1 例红灯**（纯浏览器降级用例，sync 不再抛 E_NOT_IMPLEMENTED）；② syncHub.pull 删信封剔除（恒透传含 ok）→ **1 例红灯**（严格 toEqual）→ 均原样还原 → 19/19 相关套件复绿 + 全量 2290 复跑全绿。**C2 矩阵**：8 通道 × 参数形状；native/none 能力 × hub 注入两态；ok:true/ok:false/undefined 三种 IPC 回包；同步（内存）与异步（代理）双中枢兼容 —— 全部明确断言。未做 C3（本提交含代码；`sync-hub/` 迁移白名单口径留 42-D 专项，code-map 已记录）。

| **42-C 同步与裁决页（#36）** | `bc8874b` | 新增独立入口 `sync.html`（vite input +1）+ `src/web/sync/`：`coreSyncPage.ts`（ctx 全可注入：runSync = agent.sync **push→pull 两段真跑**，project_id 传 `'*'` 仅作审计归因不参与过滤——引擎按 team_id 隔离；失败 ok:false + 真实错误；listSyncConflicts/resolveConflict 经 hub 代理；hubOverview 只读对账视图：镜像行数/败者留档/指纹异常**如实展示不静默覆盖**）+ `SyncPage.tsx`（立即同步卡 + 中枢对账卡 + §9.7 裁决队列表：local vs remote 内容对照、保留本端/保留镜像双按钮、裁决成功/失败 toast 均如实）+ `syncEntry.tsx` + `theme.css`（复用 audit 暗色系统 + 本页专属类）；`SyncPageHub` 结构化最小面（内存 SyncHub 同步返回 / HostSyncHub 异步代理双兼容）；测试 `sync/__tests__/syncPage.test.tsx` 7 例（逻辑 4 + 组件 3） | 见下方三栏 |

> **42-C 口径（ROADMAP 批次42 §一 42-C）**：三端真跑 = 桌面端经 42-B 注入链路（agent.sync → HostSyncHub → 主进程 PgSyncHub）由本页触发；Web/CLI 端 CLI 命令留待后续（内核 sync 已可跑，端壳入口按需补）。**独立页面而非挂 dispute**：dispute.html 是 REQ-006 P7 **写入冲突**裁决域（coreListConflicts 账本内配对），§9.7 **同步裁决**是另一域（中枢镜像并发版本）——混页会破坏单一职责，新入口 sync.html。**权限**：resolve 走 42-B 管理员门禁（页面不预判角色，主进程 requireAdmin 拒绝 → 错误如实展示——照 backup 页模式）。**审计链**：裁决成功 → 中枢 `conflict_resolve`（PgSyncHub.resolve 内部落）+ 主进程 actionLog（42-B handler 已写）；页面刷新后队列清空即真证据。**43-A 预告口径**：hubOverview 的指纹异常只列清单绝不覆盖——与「每日全量补齐只补缺、不静默改行」同源。
> **42-C 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `vite.config.ts`（+1 入口）+ `sync.html` + `src/web/sync/`（4 新文件）+ 1 测试文件。全量 `vitest run --maxWorkers=1` **2297 项全绿**（42-B 基线 2290 → +7）；`npm run typecheck` 两工程 0 错（开发期逮住 2 处：ctx.hub 用 Pick<HostSyncHub> nominal 失效 → SyncPageHub 结构化接口 + 同步/异步 union 返回 / resolve mock 死代码参数不匹配）；oxlint **0 warnings / 0 errors**；`code:index --write` 刷新 **331 文件**（+sync 页 3 源文件）。既有行为钉住：42-A/42-B 全套 + dispute 页（写入冲突域不受影响）+ audit 页 theme（被复用只读）——均在全量中通过。
> **B·效果验证**：AC→用例见 ROADMAP 42-C + 7 例。**状态真的变了**：runSync 两段真跑且报告逐字段汇总（pushed/pulled/conflicts/dedup/behind/lww/l0_skipped/cursor）；内存中枢构造真 §9.7 冲突（同 updated_at 全晚）→ 队列列出 local/remote 对照 → resolve('local') 后队列清空 + 中枢 `conflict_resolve` 审计落账；hubOverview 镜像/败者/指纹如实。**反向断言**：agent 抛错 → ok:false + 错误信息含 E_NOT_IMPLEMENTED 且 toast 如实展示；裁决 403 → toast「裁决失败…403」不假装成功；空队列诚实空态。
> **C·变异验证**：**C1 两次代码级变异**——① coreSyncPage.runSync 吞错返回 ok:true → **1 例红灯**（同步失败如实展示）；② SyncPage.handleResolve 吞错不设 err toast → **1 例红灯**（裁决失败如实展示）→ 均原样还原 → 7/7 复绿 + 全量 2297 复跑全绿。**C2 矩阵**：成功/失败两分支 × runSync/resolve 两动作；队列有冲突/空两态；本地/镜像两胜者 —— 全部明确断言。未做 C3（本提交含代码，页面为纯新增入口不影响既有页面）。

| **42-D 备份与迁移收口（#37）** | `5440583` | `main.ts` `before-quit`：`syncHub?.close()` 优雅关闭（pglite 显式 close 才保证 WASM 存储层完整刷盘；close 失败只忽略——退出路径绝不阻断）；**AGENTS.md §数据根清单补段**：sync-hub 口径拍板（详见下方）；本轮**诚实修订方案原文**：不把 sync-hub 加进 DATA_ROOT_MIGRATE_DIRS / 备份四源配方（拍板理由见口径块） | 见下方三栏 |

> **42-D 口径（ROADMAP 批次42 §一 42-D，按仓库既有先例修订）**：方案原文建议「sync-hub/ 进 DATA_ROOT_MIGRATE_FILES + backups/（新前缀）」——实施时对照仓库既有口径先例 **AGENTS §124 `refine-queue.json`**（衍生可重建数据**不在迁移白名单**——丢了也不丢数据，启动自动重建），sync-hub 与其完全同类，故**修订拍板**：① **不进迁移白名单**——中枢是各端账本的上行镜像，真源在本地账本；丢失恢复 = 任一端 `syncUp` 全量上行（sha256 幂等 + 向量时钟保证不丢不重）；换数据根后中枢在新根首启自动重建（空镜像），各端重新同步即恢复。② **不进备份四源配方**——热复制 pglite 落盘目录有一致性风险（备份需中枢 close/checkpoint，复杂度与收益不匹配）；且衍生数据备份的收益 = 0（重建等价）。③ **真实缺口收口 = 优雅关闭**：pglite WASM 存储层需显式 close 才完整刷盘，`before-quit` 接 `PgSyncHub.close()`。方案文档为立项建议性质，实施记录真实决策并留痕（本条 + AGENTS 段），42 云端同步其余三项（A/B/C）均按方案落地。
> **42-D 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `main.ts`（before-quit +1 行）+ `AGENTS.md`（+1 段）。全量 `vitest run --maxWorkers=1` **191 文件 / 2297 项全绿**（42-C 基线一致——本轮无新增测试文件）；`npm run typecheck` 两工程 0 错；oxlint **0 warnings / 0 errors**；`code:index --write` 刷新 **331 文件**。既有行为钉住：`dataRoot.test`（迁移白名单三向）+ `pgSyncHub.test`（落盘持久化 = close 后重开数据一致，即 close 语义已被引擎测试覆盖）——均在全量中通过。
> **B·效果验证**：接线验证 = typecheck 通过 + `before-quit` 与 L0 `onExit` 同构（先例模式）；close 语义真验证 = pgSyncHub 落盘持久化用例（close 后重开 `reconcile` 数据一致）。**口径验证**：AGENTS §数据根清单与 code-map 同步留痕，grep 可核对（「sync-hub」在 AGENTS 唯一出现于本段）。
> **C·变异验证**：**C1 不适用**（electron app 生命周期钩子无法在 vitest 环境执行——与既有 L0 onExit / 窗口导航闸门同类的诚实边界，靠 typecheck + 同构先例 + 手测报告纪律覆盖）；**C2**：dataRoot 白名单三向 + pgSyncHub close/重开持久化（37 例）全部明确断言；拍板类改动以文档留痕 + grep 核对替代变异。未做 C3（本提交含代码接线）。

| **43-A §3.4 每日定时 reconcile（#38）** | `7a37a39` | `main.ts`：新增每日全量对账调度——`MAM_SYNC_RECONCILE_INTERVAL_MS`（缺省 24h 定死）+ `MAM_SYNC_RECONCILE_FIRST_DELAY_MS`（缺省 10min 首延）+ `MAM_SYNC_RECONCILE_DISABLED=1` 逃生阀（与遗忘调度同款三件套模式）；`runSyncReconcileScheduled(why)`：**中枢未装配（syncHub=null）直接跳过**——没有远端可对账，绝不伪造对账回执；装配后跑 `reconcile(syncHub, storage, tenantTriple scope)`——**只补本地缺的行、不改已有行**（引擎语义），指纹不一致 `integrity_issues` 只如实报（warn 级 actionLog）不静默覆盖；结果双写 mlog + actionLog，错误如实落 error 级；引擎侧 `sync_reconcile` 审计由 hub.reconcile 内部落账 | 见下方三栏 |

> **43-A 口径（ROADMAP 批次42 §二 43-A）**：前置依赖 42-A/42-B 中枢已接线 ✅（42-B 落地后本项才有意义）。**AC 逐条**：① 缺省每日一次、env 可调、缺省值定死 ✅（24h + MAM_ 前缀三件套）；② 只补本地没有的行 ✅（reconcile 引擎 `if (!existing)` 才 putMemory，既有测试锁定）；③ 指纹不一致进 integrity_issues 如实报、不静默覆盖 ✅（warn 级日志 + 引擎返回原样透传）；④ 结果落 sync_reconcile 审计 + 动作日志 ✅（hub 内部审计 + actionLog 双写）；⑤ 中枢未接线不伪造回执 ✅（null 守卫 + hubReady 观测日志）。与 42-C 对账视图同源口径：指纹异常只列清单绝不覆盖。
> **43-A 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `main.ts`（import + 调度块，与遗忘调度同作用域）。全量 `vitest run --maxWorkers=1` **191 文件 / 2297 项全绿**（42-D 基线一致——本轮为纯调度接线，无新增测试文件）；`npm run typecheck` 两工程 0 错；oxlint **0 warnings / 0 errors**；`code:index --write` 刷新 **331 文件**。既有行为钉住：sync 引擎全套（sync.test 补漏/指纹用例、pgSyncHub 对账用例、agentSync）——引擎语义「只补缺不覆盖」已被既有测试锁定。
> **B·效果验证**：AC 逐条验证（见口径块 ①–⑤）；引擎真验证 = sync.test「短周期漏单补齐」（missing 行被补）+ pgSyncHub reconcile（missing_local 指纹校验）+ agentSync 全链路（27 例相关套件）。**调度验证** = typecheck + 遗忘调度同构先例（electron 调度无单测的诚实边界）+ `bootstrap:sync-reconcile-scheduled` 观测日志（含 hubReady 真值）。
> **C·变异验证**：**C1 不适用**（新增代码为 electron 调度接线，与遗忘/采集调度同类的无单测边界；核心语义「只补缺不覆盖」在引擎层且已有测试锁定——变异引擎侧已在 42 系列及 sync.test 覆盖矩阵中验证过）；**C2**：reconcile 引擎既有断言矩阵（补缺/跳过已存在/指纹如实/墓碑参与）+ 中枢未装配守卫（null → return）——引擎侧全部明确断言。未做 C3（本提交含代码接线）。

| **44-A/B 独立采集守护（#39）** | 9edcfed | 新建 `core/memagent/collectDaemon.ts`：`runDaemonRound`（daemon 一轮 = `scanSessionLogs` 纯 fs 读 → daemon 指纹去重（扫描前快照——引擎会把本轮 hash 写进传入集合）→ 新消息写 pending **分片文件**，只创建新文件永不改旧 → state（cursor+seen）每轮原子落盘）+ `drainCollectPending`（桌面端交接：逐条 write → **全文件成功才删除**，部分失败整片保留待重试；损坏分片保留不阻塞其余）；`tools/collect-daemon.mjs` CLI（--root/--interval/--once，SIGINT 优雅停，Node22 原生跑 TS 同 rejudge-dry 先例）；`main.ts` 接入 drain 两点（首扫后 / 追采后）——桌面端唯一写者（持 DEK）经 coreWrite 完整入库 | 见下方三栏 |

> **44-A/B 口径（ROADMAP 批次42 §三，含两处实施拍板）**：① **L0 硬约束（方案未覆盖的架构级分叉口）**：采集写入需 L0 seal（DEK 由桌面端 L0Vault 持有），headless daemon 无法加密原文——daemon 写账本的任何形态都不可行（「只写 L1」造成行不完整破坏重建链路）。**拍板：daemon = 只读侦察兵**——只做「扫描 + 指纹去重 + 暂存分片」，写入职责全留桌面端（coreWrite + dedup 幂等兜底重复）。② **44-B 双写者风险由架构消解**（优于原方案「建议性写锁竞争调优」）：daemon **永不碰账本**（零写锁竞争——28-A FileStorage 写锁机制原样保留给桌面端/只读镜像场景）；pending 分片「daemon 只创建新文件 + 桌面端持锁时才删」→ 任一时刻单进程触碰单个分片；崩溃窗口只可能重复写（dedup 兜底）不可能丢消息（分片保留）。③ daemon 状态目录 = 数据根 `collect-daemon/`（state.json + pending/）——**不在迁移白名单**（衍生数据，与 refine-queue/42-D sync-hub 同口径：丢失 = daemon 重新全量扫描，消息仍在原始日志里）。④ 实机走查边界诚实保留：多进程并发时序（daemon 写分片 × 桌面端 drain 删片）属 E2E/实机口径，单元测试覆盖的是协议不变量（只创建/成功才删/失败保留）。
> **44-A/B 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `collectDaemon.ts`（新）+ `collectDaemon.test.ts`（新 5 例）+ `tools/collect-daemon.mjs`（新 CLI）+ `main.ts`（import + drain 函数 + 两调用点）。全量 `vitest run --maxWorkers=1` **192 文件 / 2302 项全绿**（43-A 基线 2297 → +5）；`npm run typecheck` 两工程 0 错；oxlint **0 warnings / 0 errors**；`code:index --write` 刷新 **332 文件**（+collectDaemon.ts）。既有行为钉住：sessionCollector 全套（scanSessionLogs 纯读口径未被 daemon 改动）、桌面端采集路径（drain 为新增旁路，onScan/追采原逻辑不变）——均在全量中通过。开发期逮住 1 处：scanSessionLogs 会把本轮 hash 写进传入 seenHashes（引擎口径），fresh 判定改用扫描前快照。
> **B·效果验证**：AC→用例 5 例。**状态真的变了**：伪造 Claude JSONL → daemon 轮产出分片（items.content 完整可交接）+ state 落盘；二轮同日志 → 指纹命中零新分片；追加新消息 → 第二分片产出且第一分片字节不变（只创建不改旧）；drain 全成功 → 分片删除 + written 计数；部分失败（E_L0_LOCKED 模拟）→ 整片保留 + errors 如实；半截 JSON 分片 → 保留不阻塞其余。**反向断言**：pending 目录不存在 → 零回执不报错。
> **C·变异验证**：**C1 两次代码级变异**——① drain 删「全成功才删」（失败也删）→ **1 例红灯**（部分失败保留用例）；② daemon 删状态持久化（cursor+seen 均不落盘）→ **2 例红灯**（二轮指纹命中 + 分片只创建用例，重复分片产出现象）→ 均原样还原 → 5/5 复绿 + 全量 2302 复跑全绿。**C2 矩阵**：新消息/已见/追加三轮扫描；drain 全成功/部分失败/损坏分片/目录不存在四态 —— 全部明确断言。未做 C3（本提交含代码）。

### 批次B类：B4 远端 PG 中枢 + B1 多机硬过滤（2026-11-06，承 42-B / 45-A1，`0b729c9`）

> 动因：REQ-008 与 42-B 落地单机 pglite 中枢后，「远端 PG 多机共享中枢 + 多机 team/enterprise 硬过滤」长期挂起。本轮在**零破坏默认行为**前提下把这两项做成 env 门控的可选能力，并补 B1 单测。方案真源：`specs/ROADMAP-批次B类-远端PG与多机硬过滤-方案.md`。

| 项 | 提交 | 改动面 | 测试 |
| --- | --- | --- | --- |
| **B4 远端 PG 中枢可配置** | `0b729c9` | `pgSyncHub.ts`：`HubDb` 抽象 + `PgliteBackend`（默认）/ `PgRemoteBackend`（`dynamic import('pg')` + `Pool`，仅 `pgUrl` 设置才加载）+ `PgSyncHubOptions{pgUrl?,canonicalTenant?,multiTenant?}`；构造签名向后兼容（`new PgSyncHub()` / `new PgSyncHub(dataDir)` 仍有效）；`main.ts` 读 `SYNC_HUB_PG_URL`、`init` 失败明确 `sync-hub-remote-fail` 且**不静默退回本地**；`build-electron.cjs` 把 `pg` 列入 `external`（不打包，运行时按需加载）；`package.json` 新增 `pg`(dep) + `@types/pg`(devDep) | `pgSyncHub.test.ts` 默认 pglite 路径 6 例全绿（语义/落盘/引擎集成未退化） |
| **B1 多机硬过滤** | `0b729c9` | `pgSyncHub.ts` 新增 `assertSameTenant(teamId)` 在 push/pull/reconcile 入口调用：`multiTenant && canonicalTenant` 时非规范 `team_id` 立即抛 `B1 跨机团队硬过滤拒绝`；`main.ts` 注入 `canonicalTenant=tenant.json 三元组` + `SYNC_MULTI_TENANT` 开关 | `pgSyncHub.test.ts` 新增 3 例：规范团队正常 / 跨机伪造 push·pull·reconcile 全拒且中枢不落入侵者 / 未开 multiTenant 不误拒 / canonicalTenant 缺失等效关闭 |
| **B3 真精炼启用链路核查** | 核查无代码改动 | `memories.ts`/`refineQueue.ts`/`rebuild.ts` 三入口 `canLlm` 闸门（`llm && llm.isStub===false && model && (refineLayer||refine)`）+ `main.ts:1608` 直传 `LlmGatewayProvider` + `kernel.ts:202` 动态 `createHostLlm` 接线；确认无"有密钥也强制 stub"的遗留短路点 | `refineQueue.test.ts`(36)/`refine.test.ts`(50)/`llmHonesty.test.ts`(6) 共 **92 例**：仿真真 provider 下 `refined_by=llm/llm_partial`、stub 下 `no_llm/stub` 全覆盖 |

> **B4/B1 口径（批次B类）**：双后端共用一套标准 PG SQL（`HubDb`），pglite 与 pg 方言同构；远端模式 SQL 行为以 pglite 单测为语义基准，远端 path 仅替换连接层。**fail-fast 不静默退回**：`SYNC_HUB_PG_URL` 设了但 pg 未装 / 服务端不可达 → `init` 抛错 → 主进程记 `sync-hub-remote-fail`（error 级）并置 `syncHub=null`，sync:* handler 如实报「中枢未就绪」——绝不悄悄改用本地 pglite 让远端配置下的数据落到本地。**B1 不改变单机默认**：`SYNC_MULTI_TENANT` 未设时 `assertSameTenant` 直接放行，42-B 既有 `team_id` 信任模型不变。
> **B4/B1 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `pgSyncHub.ts` + `main.ts`（hub 装配段）+ `build-electron.cjs`（external）+ `pgSyncHub.test.ts`（+3）。`npm run typecheck` 两工程 0 错；oxlint **0 warnings / 0 errors**；`src/core/memagent` 全量 **54 文件 / 866 例全绿**（B2 三环鉴权接线未受影响）。`hub` 构造签名向后兼容，既有 `new PgSyncHub()` / `new PgSyncHub(dataDir)` 全量用例零改动通过。
> **B·效果验证**：AC→用例见上表。**状态真的变了**：`SYNC_HUB_PG_URL` 设置 → `isRemote=true` 走 `PgRemoteBackend`（构造即存 URL，`init` 内才 `connect()`，未设则永不强依赖 pg）；`SYNC_MULTI_TENANT=1` + 规范 `team_id` → 跨机 `push/pull/reconcile` 抛 `B1...` 且中枢 `reconcile` 规范视图查不到入侵者数据。**反向断言**：不设 env → 默认 pglite 落盘语义与 42-B 完全一致（`pgSyncHub.test.ts` 既有 6 例全绿）；`canonicalTenant` 缺而 `multiTenant=1` → 无基准比对不误拒；未装 pg 且未设 URL → 默认路径零依赖不受影响。
> **C·变异验证**：**C1 一处代码级变异**——`assertSameTenant` 删 `teamId !== canonicalTenant.team_id` 判定（改为恒放行）→ **跨机伪造 3 例全部红灯**（push/pull/reconcile 拒例变绿=失效）→ 原样还原 → 3 例复绿 + `pgSyncHub.test.ts` 9 例全绿。B4 远端 `PgRemoteBackend` 因本环境无 PG 服务端**未做 e2e 变异**，诚实标注为「待用户提供服务端后补」（代码 path 已就位，仅连接层未验证）。
> **B3·真精炼启用链路核查（2026-11-06，无代码改动）**：
> **核查结论**：`refined_by` 的 stub 唯一闸门是 `canLlm = llm && llm.isStub===false && model && (refineLayer||refine)`（`memories.ts:79`），写时/队列/重建三入口共用 `makeLayerGenerator`，**无任何硬编码"有密钥也 stub"的短路点**。接线：桌面主进程 `main.ts:1608` 直传 `LlmGatewayProvider`（`isStub=false` 硬编码）；渲染层 `kernel.ts:202` `createHostLlm()` 用**动态** `isStub=!(snapshot?.usable)`——桌面 LLM 接通 → 快照 usable → 真 provider 生效。故"真精炼"与"桌面端精炼"是**同一管线**，仅 `provider.isStub`/`canLlm` 不同；接通后写入即带真实 L2–L6（`refined_by=llm/llm_partial`），历史 L1 存量由后台补炼队列（参数页开启）跑真引擎补齐。实证：`refineQueue.test.ts`(36)/`refine.test.ts`(50)/`llmHonesty.test.ts`(6) 共 **92 例**全绿——仿真真 provider 下 `refined_by` 不为 stub、stub 下如实 `no_llm/stub`。**本环境未做真实 LLM 调用**（无桌面密钥/端点，不能在此产出真实深层行）；真实产出留桌面端。

### 批次48 A24：反代理封顶与真实路由统一（2026-11-06）

> 动因（P1-2）：`agent.ts` 曾写死 `price_cap=0.01` / `cost_cap=2`，模型页模拟与内核真实路由各说各话；`usedToday` 是进程内计数（重启归零）；`llm_proxy` 的 cost 按 `text.length/2` 估算。本轮统一为「参数快照单一真源 + 账本当日实算 + 上游真实 usage」，未设置一律按「未设置」（null）处理，不再回落硬编码。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 封顶持久化（单一真源） | `src/shared/proxyAccounting.ts`（`ProxyCaps` / `UNSET_PROXY_CAPS` / `normalizeProxyCap` / `proxyCostToday` / `PROXY_COST_WINDOW_MS`）；`src/core/memagent/paramsSnapshot.ts`（`cfg.proxy_price_cap` / `proxy_cost_cap` + `proxyCapsFromSnapshot` + `saveProxyCapsToLedger`：delete+put 单条、写 `param_save` 审计 `kind='proxy_caps'`） | `src/web/models/__tests__/a24Caps.test.ts`（持久化 / 未设置 / 参数页交叉覆盖） |
| 真实路由去硬编码 | `src/core/memagent/agent.ts`：`agent.write` 并行读 `listMemories` + `queryAudit` → `proxyCapsFromSnapshot` / `proxyCostToday` → `routeProxy(..., caps.price_cap, caps.cost_cap, usedToday)`；`src/core/memagent/llm.ts`：`routeProxy` 对 null 如实「price_cap 未设置」/「cost_cap 未设置，不封顶」 | `src/core/memagent/__tests__/a24.test.ts`（未设置不入选 / 快照 0.03 命中低价 / 账本 ¥2.0 触发成本封顶） |
| 真实 usage 记账 | `src/electron/llmGateway.ts`（`parseUsage` + `chat` 回 usage + `takeUsage()` 累计精炼调用）；`src/electron/main.ts`（`llm:refine` 层模式回传 `tokens`）；`src/web/hostLlm.ts`（`takeUsage()` + IPC tokens 透传）；`agent.write` 的 `llm_proxy` 写 `tokens` / `unit_price_cny_per_mtok` / `cost = tokens × 单价 / 1e6`；无 usage 或单价未设置 → `tokens` / `cost` 为 null，删除 `text.length/2` 估算 | `llmGateway.test.ts`（mock usage=12 / 无 usage=0 / takeUsage 累计清零）+ `a24.test.ts`（cost 0.0003 / tokens·cost null） |
| 页面 null 语义 | `src/web/models/coreModels.ts`（`getCtx().caps`、`coreSimulateAuto()` 无参读快照、`coreLoadProxyCaps` / `coreSaveProxyCaps`（值未变不写）、`ProxyCallAuditEntry.cost: number \| null`）；`ModelsPage.tsx`（初始 null + 挂载回填 + 变更即持久化 + 审计「未记录」）；`ProxyPanel.tsx`（空值→null + 「未设置」提示）；`logic.ts`（`proxyEligible` / `validatePriceCap` / `autoPick` / `manualPick` 接受 null）；`coreParams.ts`（参数页保存不冲掉封顶） | `a24Caps.test.ts` + 既有 `logic.test.ts` / `ModelsPage.test.tsx` / `auditHonesty.test.tsx` |

> **A24 三道闸门证据（按 `specs/开发纪律_三道闸门.md` §4）**：
> **A·影响面回归**：影响面 = `agent.ts` / `llm.ts` / `paramsSnapshot.ts` / `types.ts` / `shared/proxyAccounting.ts` / `electron/llmGateway.ts` / `electron/main.ts` / `web/hostLlm.ts` / `web/models/*` / `web/params/coreParams.ts` + 2 个新测试文件。全量 `vitest run --maxWorkers=1` **205 文件 / 2440 例全绿**（A29 基线 203 文件 → +2 文件；期间一次原生崩溃 `0xC0000409`，按 A27 同口径重跑一次即全绿，非断言失败）；`npm run typecheck` 两工程 0 错；oxlint **0 warnings / 0 errors**；`check:no-demo` 通过；`npm run build` + `build:electron` 通过。既有行为钉住：模型页 simulate/审计渲染、参数页保存、`llmHonesty`/`refine` 精炼口径、`coreSimulateAuto(0.01, 2)` 显式传参用例均在全量中通过。
> **B·效果验证**：AC 逐条 → `a24.test.ts`（6 例）+ `a24Caps.test.ts`（6 例）+ `llmGateway.test.ts`（含新增 2 例）。**状态真的变了**：未设置快照 → 低价源不入选且审计原因是「price_cap 未设置」（不再是 0.01 判定）；写入快照 0.03 → 真实路由命中 `cheap-x` 并落 `llm_proxy`；账本 seed ¥2.0 + `cost_cap=2` → 本次回退且 reason 含「成本封顶 2.00」；`usage=100` + 单价 3 → `cost=0.0003`；无 usage → `tokens/cost=null`；模型页 `coreSimulateAuto()` 无参读同一快照。**反向断言**：空值/NaN/-1 → 未设置；值未变 → 不写快照；参数页再保存不冲掉封顶；24h 窗口外花费不计入 `used`。
> **C·变异验证（两次代码级变异，均原样还原）**：① `agent.write` 把 `caps.price_cap/cost_cap` 换回写死的 `0.01/2` → `a24.test.ts` **6/6 全红**（原因断言不再出现「price_cap 未设置」）；② `usedToday` 改回 `0`（进程内计数语义）→ usedToday 用例 **1 红**（`llm_fallback` 缺失 / 成本封顶不再触发）→ 还原后 3 个 A24 相关文件复绿。C2 矩阵：未设置/0/0.03/NaN/-1、usage 有/无/单价有/无、24h 内外、参数页交叉保存 —— 全部明确断言。未做 C3（本提交含代码）。

### 批次48 A25：监控页宿主 Agent 下拉真实化（2026-11-06）

> 动因（P2-1）：`src/web/monitor/options.ts` 曾写死 `AGENT_OPTIONS = ['all','coder-01','writer-02','sync-00']`，与真实账本无关；e2e 用例还把「空账本 4 个选项」当成「来自真实宿主清单」。现改为只由账本派生，空账本只留「全部」。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 选项派生纯函数 | `src/web/monitor/options.ts`：`ALL_AGENTS_OPTION` + `agentOptionsFromLedger(alerts, createdBy)`（告警 `agent` 字段 + 记忆 `created_by_agent`；trim、去空、去重、排除 `all`、字典序，`all` 恒在首位） | `src/web/monitor/__tests__/a25AgentOptions.test.tsx`（空账本 / 去重排序 / 页面两项） |
| 页面接真 | `src/web/monitor/useMonitorReal.ts`：`RealMonitor.agentOptions` 由 `loadRealMonitorData` 用同一份 `mems`/`alerts` 实算；`MonitorPage.tsx` 渲染 `real?.agentOptions ?? ['all']`，`all` 显示为「全部」 | 同上 + 既有 `MonitorPage.test.tsx`（mock 缺字段回落 `['all']` 仍通过） |
| e2e 口径修正 | `e2e/monitor.spec.ts`：用例名改为「选项由真实账本派生，空账本只保留「全部」」，断言 1 项、含「全部」、不含 `sync-00`/`coder-01` | e2e 依赖 dist + 浏览器栈，本环境未执行；口径已由单测钉住 |

> **A25 三道闸门证据**：
> **A·影响面回归**：影响面 = `web/monitor/{options,useMonitorReal,MonitorPage}.tsx` + `e2e/monitor.spec.ts`。全量 `vitest run --maxWorkers=1` **206 文件 / 2444 例全绿**（A24 基线 205/2440 → +1 文件 / +4 例）；`typecheck` 两工程 0 错；oxlint **0/0**；`check:no-demo` 通过；`build` + `build:electron` 通过。
> **B·效果验证**：空账本 → 下拉 **1 项「全部」**，不再出现占位 agent；账本有 `sync-00` → 选项 `['all','sync-00']` 且可选中、命中 0 条并显示诚实空态；`agentOptionsFromLedger` 对空白/重复/`all` 混合输入给出确定排序。**反向断言**：显式断言不含 `sync-00` / `coder-01`（防止占位名回潮）。
> **C·变异验证**：把 `agentOptionsFromLedger` 改回旧常量 `['all','coder-01','writer-02','sync-00']` → `a25AgentOptions.test.tsx` **3/4 红**（空账本、合并排序、页面下拉），还原后复绿。C2 边界：空数组 / 空白串 / undefined / 重复名 / `all` 混入。未做 C3。

### 批次48 A26：检索项目范围（2026-11-06）

> 动因（P2-4）：`coreEngine` 原先只取 `listProjectIds()[0]` 做单项目召回，多项目账本下**静默丢弃其它项目命中**。现增加项目选择器，默认「全部项目」，多项目逐项召回后合并；单项目场景行为不变。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 多项目召回合并 | `src/web/retrieval/coreEngine.ts`：`ALL_PROJECTS_SCOPE='all'`；`coreEngine(..., projectScope='all')` 对 `all` 走全部真实项目（空账本回落 `DEFAULT_PROJECT_ID`），逐项目 `ma.recall` 后按 `mem_id` 去重合并、`sortHits` 统一排序；payload = 各项目之和，`evidence_thin` = 任一项触发补查后的合并口径 | `src/web/retrieval/__tests__/a26Projects.test.tsx`（默认 all 两项目都命中 / 显式非首项目只命中自身 / 单项目 all≡指定） |
| 项目选择器 | `src/web/retrieval/QueryBar.tsx`：`QueryBarValue.project?` + `projects` 属性 + `data-testid="q-project"`（首项「全部项目」）；`useRetrieval.search(..., projectScope)`；`RetrievalPage.tsx` 挂载时 `listProjectIds()` 回填、检索传 `qv.project ?? 'all'` | 同上（默认 selected=all、切换回调带 project） |
| 项目清单口径 | `src/web/shared/kernelProjects.ts`：`listProjectIds()` 排除内部 `P_SYSTEM`（参数快照等 preference 不进用户项目选择器） | `a26Projects.test.tsx`（P_SYSTEM 不进清单） |

> **A26 三道闸门证据**：
> **A·影响面回归**：影响面 = `retrieval/{coreEngine,useRetrieval,QueryBar,RetrievalPage}` + `shared/kernelProjects.ts`（项目清单被写页/记忆页/日志页共用，排除 `P_SYSTEM` 对它们只是少一个内部项）。全量 `vitest run --maxWorkers=1` **207 文件 / 2450 例全绿**（A25 基线 206/2444 → +1 文件 / +6 例；首次运行再次遇到原生崩溃 `0xC0000409`，按 A27 口径重跑一次全绿，非断言失败）；`typecheck` 两工程 0 错；oxlint 0/0；`check:no-demo` 通过；`build` + `build:electron` 通过。既有 `components.test.tsx`（16 例）与 `coreEngine.realdata.test.ts`（4 例）全绿，未改其断言。
> **B·效果验证**：两个项目各有「缓存 TTL」记忆时，默认检索**同时返回 300s 与 600s 两条**（证明不丢其它项目命中）；显式选 `P-b` 只回 600s；单项目账本下 `all` 与显式选择命中集合完全一致（`memory_id` 数组相等）；选择器默认值 = `all`、首项文案「全部项目」、切换回调携带 `project`。**反向断言**：显式断言不含另一项目内容。
> **C·变异验证**：把 `scopes` 改回旧式 `[projects[0] ?? DEFAULT_PROJECT_ID]` → `a26Projects.test.tsx` **1 红**（默认 all 只剩首个项目命中），还原后 4 文件 46 例复绿。C2 边界：空账本 / 单项目 / 两项目 / 显式非首个项目 / 内部 `P_SYSTEM` 混入。未做 C3。

### 批次48 A28：模型配置按租户（2026-11-06）

> 动因（P3-1）：`mam.modelConfig.v1` 是单机全局 key，同一浏览器切换租户/用户会串用别人的向量模型与用途配置。现按租户/用户加维度，旧 key 一次性迁移，空租户回退缺省。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 租户维度 key | `src/web/models/modelConfig.ts`：`tenantStorageKey()` = `mam.modelConfig.v1:e=<ent>:t=<team>:u=<user>`（`encodeURIComponent`）；身份读 `mam.tenant.v1`（与 `kernel.getTenant` 同源，只读避免循环依赖）；三元组全空 → 回退旧 key | `src/web/models/__tests__/a28Tenant.test.ts`（key 形状 / 租户隔离 / 空租户） |
| 旧 key 一次性迁移 | `readModelConfig()`：租户 key 无数据 → `migrateLegacyIfNeeded` 复制旧值并删除旧 key；租户 key 已有数据时不动旧 key、不覆盖 | 同上（迁移并删旧 / 切租户不二次迁移 / 已有数据不覆盖） |
| 读写与清理 | `writeModelConfig` 写当前租户 key；`clearModelConfig`（测试辅助）清旧 key 与全部租户维度 key | 同上（clear 后无残留） |

> **A28 三道闸门证据**：
> **A·影响面回归**：影响面 = `web/models/modelConfig.ts` + 所有经 `readModelConfig` 的模型页状态（`ModelsPage.tsx`、`configuredVectorDim` 内核装配、`coreModels` 保存）。全量 `vitest run --maxWorkers=1` **208 文件 / 2456 例全绿**（A26 基线 207/2450 → +1 文件 / +6 例；其间连续两次原生崩溃 `0xC0000409`、第三次通过，均非断言失败——该不稳定性即 A27 的治理对象）；`typecheck` 两工程 0 错；oxlint 0/0；`check:no-demo` 通过；`build` + `build:electron` 通过。既有模型页/配置用例（`ModelsPage.test.tsx` 7 例、`coreModels.test.ts` 12 例）全绿未改断言。
> **B·效果验证**：租户 A 写入后切租户 B 读为 null（不串读），切回 A 原样读回；旧 key 有值 + 租户 key 为空 → 首次读取迁移并删除旧 key，之后切 B 也拿不到；租户 key 已有值时旧 key 保持不动；无租户身份时 key = 旧 key 且读写正常。**反向断言**：迁移后旧 key 必须为 null、B 必须 null、已有数据不被旧值覆盖。
> **C·变异验证**：`tenantStorageKey()` 改回常量 `mam.modelConfig.v1` → `a28Tenant.test.ts` **4/6 红**（key 形状/隔离、迁移删旧、切租户、已有数据不覆盖），还原后 6 例复绿。C2 边界：空租户 / 单租户 / 两租户切换 / 旧 key 有值/无值 / 租户 key 已有值。未做 C3。

### 批次48 A27：全量测试门禁稳定化（2026-11-06，D2=S1）

> 动因（P2-3）：全量 `vitest run --maxWorkers=1` 在单进程内跑 200+ 文件，A24/A26/A28 期间多次原生崩溃 `0xC0000409`（STATUS_STACK_BUFFER_OVERRUN）——既不可复现定位，又逼人「重跑一次」；此前没有任何书面口径，重跑会连断言失败一起吞掉。

| 能力 | 代码落点 | 测试/证据 |
|---|---|---|
| 4 分片串行 | `tools/test-gate.mjs`：逐片 `spawn` 本地 `node_modules/vitest/vitest.mjs run --maxWorkers=1 --shard=i/N --reporter=json --outputFile=<片报告>`；片数默认 4（`--shards=N` 可调 1–8） | `npm run test:gate` → 4 片 **52+52+52+52 文件 / 2456 例全绿**，总耗时约 66s |
| 仅 0xC0000409 重试一次 | `classifyAttempt` 判定顺序固定：先看 JSON 报告（有 failed test/suite → `assertion-fail` 立即判红）→ 再看退出码/崩溃码（`0xC0000409` = 3221226505 / -1073740791，或 stderr 命中该码 → `crash` 允许重试一次；重试后仍崩溃判红） | 自检 `MAM_TEST_GATE_SELFTEST_CRASH="1:once"` → 第 1 次崩溃、重试通过（重试 1 次）；`"1:twice"` → 重试后仍判红（不无限重试） |
| 断言失败绝不重试/不吞 | 报告 `numFailedTests > 0` 或 `numFailedTestSuites > 0` → 直接失败，`retries=[]`；无报告且非崩溃码（过滤零命中 / unhandled error / 报告全绿但非 0 退出）一律判红不重试 | 注入真实失败用例（`expect(1+1).toBe(3)`）→ 门禁 **exit=1、失败 1 例、重试 0 次**，`summary.json.failedTests` 记录用例名 |
| JSON 报告留档 | 每片 `test-results/test-gate/<runId>/shard-<i>-a<n>.json` + `summary.json`（状态/分片/重试/失败用例名/耗时；重试保留两轮报告） | `summary.json` 实跑产物 |

> **A27 三道闸门证据**：
> **A·影响面回归**：影响面 = 新增 `tools/test-gate.mjs` + `package.json` 的 `test:gate` 脚本 + `specs/开发纪律_三道闸门.md` A2 口径；不改任何生产代码与既有测试。**新门禁全量 = 208 文件 / 2456 例全绿、重试 0 次**（与 A28 基线同口径同数字，证明分片未漏测/重复测：52×4 = 208）；既有 `npm test`（单进程 vitest）保留不变；`typecheck` 两工程 0 错；`oxlint tools/test-gate.mjs` 0/0；`check:no-demo` 通过；`build` + `build:electron` 通过。
> **B·效果验证**：① 正常全量 → 4 片全通过、`totals = 208 文件 / 2456 例`、`retries=[]`；② 注入真实断言失败用例 → **门禁判红且 `retries=[]`**（证明不重试、不吞，`summary.json` 里 `failedTests` 带用例全名）；③ 自检崩溃一次 → 重试 1 次后通过（`retries=[{shard:1, reason:'0xC0000409'}]`）；④ 自检崩溃两次 → 重试 1 次后判红（证明只重试一次、不无限重试）；⑤ 过滤零命中（`no-such-test-file-xyz`）→ 报告 0 例、判红且不重试。**（②③④⑤ 均为实机跑出，非纸面推断）**
> **C·变异验证**：C1 把「有 failed test/suite → assertion-fail」改成 `return 'pass'`（吞掉断言失败）→ 同一注入失败用例的门禁**变绿且 `totals.failed=1`**（防线失效被肉眼可见地证明）→ 原样还原后再跑同一用例 → **exit=1、判红、重试 0** 复绿。C2 输入矩阵：无报告非崩溃（过滤零命中）/ 有报告断言失败 / 模拟崩溃一次 / 模拟崩溃两次 / 报告全绿但非 0 退出 —— 分类结果逐一断言（前两类判红不重试、中两类只重试一次、最后一类判红不重试）。
> **已知边界**：分片按 vitest `--shard` 的文件哈希分配，片间用例数不均（578/573/603/702）属正常；`0xC0000409` 本身未能在本环境按需复现，重试分支用自检开关验证（`MAM_TEST_GATE_SELFTEST_CRASH`，只影响指定分片的第一/两次尝试，不改判据）。

### 批次48 A30：演示页与生产产物（2026-11-06，D3=b）

> 口径（P3-3）：**保留** inline 演示页与悬浮覆盖层，但**强制演示标识**（页面显著位置标明为演示）、**不进入主导航**；生产构建可达但必须带标识。演示页数据仍取自本机真实账本，标识只声明「形态演示、非正式功能入口」，不谎称数据造假。

| 能力 | 代码落点 | 测试/证据 |
|---|---|---|
| 强制演示标识（演示页） | `src/web/shared/DemoBadge.tsx`（`data-testid="demo-badge"`、`role="note"`）；`src/web/InlineAttribution/inlineAttributionEntry.tsx` 首屏渲染 `<DemoBadge />`（在登录门禁/数据加载之外） | `a30DemoBadge.test.tsx`（2 例）、`a30InlineDemoBadge.test.tsx`（2 例：首屏可见；`#root` 缺失显式抛错） |
| 强制演示标识（浮层） | `src/web/InlineAttribution/floatEntry.tsx` 在拖拽条下渲染 `<DemoBadge compact />`（280px 窗宽紧凑形态） | `floatEntry.test.tsx` 增加断言：`demo-badge` 含「演示（DEMO）」 |
| 不进主导航 | `src/web/overview/Overview.tsx` 的 `VIEWS` 移除 `inline` 项（17 → 16 个已落地视图）；顶部说明去掉 `REQ-004 内联标识`；悬浮层按钮改名「🧠 悬浮标识层（演示）」并补 title | `a30DemoNav.test.tsx`（3 例：导航项不含内联标识、计数 16、按钮显式标注演示）；`e2e/overview.spec.ts` 改为断言主导航无该项 |
| 生产构建可达且带标识 | 两个 HTML 入口保留在 vite inputs，`vite build` 产出 `dist/inlineattribution.html`、`dist/floatattribution.html`；`e2e/overview.spec.ts` 直接 `goto` 演示页并断言 `demo-badge` 可见且含「演示页（DEMO）」 | 构建产物清单含两页；`Get-ChildItem dist/assets -Filter *.js` 命中「演示页（DEMO）」/「形态演示，非正式功能入口」 |

> **A30 三道闸门证据**：
> **A·影响面回归**：影响面 = 新增 `DemoBadge.tsx` + 3 个测试文件；改 `inlineAttributionEntry.tsx`、`floatEntry.tsx`、`Overview.tsx`、`e2e/overview.spec.ts`。**全量门禁 `npm run test:gate` = 211 文件 / 2463 例全绿**（53/53/53/52 文件，580/576/609/698 例）。typecheck 两工程 0 错；`oxlint` 603 文件 0/0；`check:no-demo` 337 文件 21 判据 0 命中（演示标识用「演示」而非被禁的伪造口径词）；`build` + `build:electron` 通过，`dist/` 含 `inlineattribution.html`、`floatattribution.html`，产物 JS 内含演示标识文案。
> **B·效果验证**：① 单元/组件：标识在演示页首屏（登录门禁外）与浮层紧凑形态均可见；② 主导航：`.nav .item` 不含「Agent 界面内联标识」，计数 16，`REQ-004` 不再出现在顶部说明；③ 生产构建：两页产物存在且打包 JS 命中演示标识文案；④ e2e 断言（真浏览器，本机未跑：需 dist + 浏览器）——直接 goto 演示页要求 `demo-badge` 可见并含「演示页（DEMO）」；⑤ **A27 门禁实机复验**：本次全量第 4 片首跑真出现原生崩溃 `0xC0000409`（exit=3221226505，无 JSON 报告），门禁按口径**重试一次**后 52 文件 / 698 例通过，`summary.json` 记 `retries=[{shard:4, reason:'0xC0000409'}]`。
> **C·变异验证**：C1-a 删除浮层 `<DemoBadge compact />` → `floatEntry.test.tsx` **1 红**；C1-b 把 `inline` 视图加回 `VIEWS` → `a30DemoNav.test.tsx` **2 红**（导航项与计数）；C1-c 删除演示页入口的 `<DemoBadge />` → `a30InlineDemoBadge.test.tsx` **1 红**。三处均原样还原后 4 文件 / 11 例复绿。C2 边界：`#root` 缺失显式抛错、无 preload 桥仍显示标识、浮层紧凑形态不省略演示文案。
> **已知边界**：`floatattribution.html` 是独立透明窗（依赖 preload 桥），浏览器直开只显示「桥缺失」占位 + 演示标识，属既有诚实降级，未改；e2e 真浏览器路径本机未执行，逻辑已在 spec 中落定。

### 批次48 A31：厂商计费接入（2026-11-07）

> 口径（用户 2026-11-06 拍板 + 2026-11-07 裁定 A）：**逐字段 provenance**，不整块打标。余额只有真厂商端点成功才 `vendor_live`；日配额/单价厂商 API 一律不提供 → 模型页按引擎手工配置并持久化；单次 cost 只能是 `usage × 单价` 的推算值。适配器范围按现有 **13 个 preset** 落地（openai/anthropic 非 preset，暂不接入，矩阵如实记录）。A31-a 的实测矩阵见 `specs/A31-BILLING-MATRIX.md`（不写产品代码）。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 条款/归一化/文案（单一真源） | `src/shared/billing.ts`：`ManualBilling` / `UNSET_MANUAL_BILLING` / `normalizeManualBilling`（空串不当 0）/ `billingProvenanceText`（四档文案 + openrouter `key_limit` 标注）/ `billingAmountText` / `estimateCallCostCny`；线上契约 `BillingEngineView` | `src/shared/__tests__/billing.test.ts`（归一化 / 四档文案 / key 限额标注 / 单次推算边界） |
| 厂商适配器 + 五级降级 | `src/electron/llmBilling.ts`：`BILLING_ADAPTERS`（deepseek `/user/balance`、kimi `/v1/users/me/balance`、siliconflow `/v1/user/info`、openrouter `/key`+`/credits`；6 家云端 `no_endpoint` 不发 HTTP；本机 3 家 `local_free`）+ `LlmBillingService`（TTL 10 分钟、`lastGood` 永不覆盖、401/403→manual、超时/5xx→stale、无凭据→manual） | `src/electron/__tests__/llmBilling.test.ts`（12 例：成功解析 / 401 降级 / stale 保留 as_of / no_endpoint 零请求 / 无凭据 / 本机 / **openrouter 普通 key 的 `total_credits:0` 不当余额** / management key 走 credits / TTL 与 force / 凭据槽） |
| 独立 billing 凭据槽 | `BILLING_CREDS_FILE='llm-billing-keys.json'`（`loadBillingCredentials` / `saveBillingCredential`，0600，与 `llm-keys.json` 同级）；`src/electron/dataRoot.ts` 迁移白名单补该文件；IPC `llm:billingKey` 仅管理员，日志只记「写/清」不记明文 | 同上（槽独立、空串清除）；`dataRoot` 迁移用例随既有测试 |
| 手工配置持久化（按引擎） | `src/electron/llmGateway.ts`：`LlmEngineConfig.billing: ManualBilling` + `LlmEnginePatch.billing`（合并写 `updatedAt`，全空归 null）+ `clampEngine` 归一 | `src/electron/__tests__/llmGateway.test.ts` 既有用例保持全绿 |
| IPC 通道 | `src/electron/ipcChannels.ts`（`llm:billing` / `llm:billingKey`）；`src/electron/main.ts` §6d：`llmBillingView(force)` 读配置 + 推理 key + 手工值；余额查询**不计 cost_cap、不写 llm_proxy 审计**；`src/electron/preload.ts` 暴露 `llm.billing/setBillingKey`；`src/desktop/hostBridge.ts` 方法表补两项 | 逻辑由单测覆盖；IPC 注册完整性由 `ipcChannels` 既有校验 |
| 模型页展示（A31-d） | `src/web/models/BillingPanel.tsx`（余额值 + provenance + 降级原因 + 凭据 keySet + 手工余额/日配额/单价）；`ModelsPage.tsx` 挂载拉取 / 手动刷新 / 保存手工值 / 保存凭据；审计回显 cost 文案改「usage × 单价推算，非厂商账单」；`src/web/hostLlm.ts` 视图类型补 `billing?`（缺省按未填） | 纯函数口径由 `billing.test.ts` 钉住；页面构建通过 |

> **A31 三道闸门证据（b/c/d 共用一份组合代码树；b 的 IPC 契约是 c/d 的前置）**：
> **A·影响面回归**：`typecheck` 两工程 0 错；oxlint **0/0**；`check:no-demo` 通过（新增文件无演示词，单价单位改用「¥/百万词元」以避 C02 规则）；`build` + `build:electron` 通过。
> **B·全量测试门禁**：`npm run test:gate` 4 分片全绿 **213 文件 / 2482 例**（基线 211/2463 → +2 文件 / +19 例），JSON 报告留档 `test-results/test-gate/<runId>/`。
> **C·变异验证**：把 openrouter 适配器的 `if (is_management_key !== true)` 短路成永不成立 → `llmBilling.test.ts` **2 红**（普通 key 走 key 限额、`total_credits:0` 不当余额），还原后复绿。C2 边界：空串/负值/配额 0 / 无凭据 / 无接口 / 401 / 5xx / 超时 / TTL 命中与 force / management key。
> **已知边界**：deepseek、kimi、siliconflow 的响应形状未经真实 key 验证（本环境无凭据），缺字段一律返 `error` 而非猜值；引擎级单价只用于引擎级展示与推算，`llm_proxy` 审计的 `cost` 仍按参数快照的全局单价计算（A24 口径未改），两者不一致时以审计的 `unit_price_cny_per_mtok` 为准，页面不冒充厂商账单。




### 批次51–53：工作台顶部布局校正 + 功能导航栏层级刻度（2026-11-09）

> 口径：用户三轮反馈收敛为 ① 品牌块（图标 + 记忆工作台）在标题栏**居中**；② 快速访问工具条**紧跟**「文件/编辑/视图/工具/帮助」之后（不是推到最右）；③ Ribbon 8 选项卡行下移到功能区下方；④ 导航栏最下面新增 L0–L6 层级刻度，标题**去掉 STRATA 英文**，列位与导航树对齐。刻度数字**一律接真实账本**，禁止写入定稿图里的示例值。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 顶部布局校正 | `src/web/shell/Workspace.tsx`（`.qa` 移到菜单项之后、`rib-spring`/`menu-scope` 后置、`.tb-left` 加 `data-brand-align="center"`、右键 `inQa` 判定保留）、`src/web/shell/theme.css`（`.titlebar` 居中、`.win-space` 绝对定位、下挂标签样式） | `src/web/shell/__tests__/workspace.test.tsx`「顶部布局：快捷按钮紧跟菜单项之后，品牌块在标题栏居中」 |
| 层级刻度数据（L0–L6 真实计数） | `src/web/shell/strataScale.ts`（`STRATA_LAYERS` 七档定义、`loadStrataScale`、`hasOriginal`、`countWithContent`）；L0 口径 = `has_l0`/行上信封/行上明文三者并集，与 `l0Split.decide` 同源 | `src/web/shell/__tests__/strataScale.test.ts`（7 例：定义 / 账本读失败 / L0 计数 / C2 空账本 / C2 历史行 / C2 非法类型 / 失败层口径） |
| 层级刻度渲染 | `src/web/shell/StrataScale.tsx`（失败层显式「读取失败」、数据源标注、重读按钮）、`src/web/shell/Workspace.tsx`（常驻加载 + 刷新复位 + 导航底部挂载）、`src/web/shell/theme.css`（`.strata-*` 列位对齐 `.tree-row`） | `workspace.test.tsx`「层级刻度：标题无 STRATA，L0–L6 七档接真实账本，失败层不当 0」「读取失败：如实报错，不渲染任何伪造计数」 |
| 维护索引 | `specs/code-index.generated.md`（`npm run code:index -- --write`） | `npm run code:index:check` |

> **批次51–53 三道闸门证据**：
> **A·影响面回归**：影响面 = 壳层 `Workspace.tsx` / `theme.css` + 新增 3 文件；未改动内核公开契约、`types.ts` 接口、TCP 8202 / HTTP 8204、存储序列化、审计格式、MCP 12 工具、各 iframe 页面。**全量门禁 `npm run test:gate` = 225 文件 / 2624 例全绿**（4 片首跑通过、失败 0、重试 0；报告 `test-results/test-gate/20261109-161351/`）。受影响套件单跑：`workspace.test.tsx` 46/46、`strataScale.test.ts` 7/7。`npm run typecheck` 两工程 0 错；`oxlint` 652 文件 0 warnings / 0 errors；`check:no-demo` 370 文件 26 判据 0 命中；`code:index -- --write` + `code:index:check` 通过（376 源码 / 120 文档）。既有行为回归用例：既有的 `loadLayerPanel` 口径套件 `layers.test.ts` 2/2 全绿（分层条只在分层页出现、失败层显示「读取失败」、浏览器内存账本标注，均未变）；右键上下文菜单、Ribbon 折叠/展开、主题切换、标签切换用例均保持全绿。
> **B·效果验证**：AC→用例映射：① 品牌居中 → `titlebar.dataset.brandAlign === 'center'` + 浏览器几何 `brandOffsetFromCenter=0`；② QAT 紧跟菜单项 → `qa.previousElementSibling === 最后一个 .menu-wrap`、`qaGapAfterMenu=7px`、`qaRightMargin=949px`（不再贴右）；③ 标签行下移 → `tabsAfterBody=true`、`tabCount=8`、折叠后标签行仍在；④ 层级刻度 → `inNav=true`、`afterTree=true`、七档 `L0..L6` 与层名逐项断言、标题 `层级刻度` 且 `hasStrataText=false`、列位 `strataMark=24=navIcon`、`strataLayer=44=navLabel`、分组缩进同为 `12px`。状态断言实测值：mock 账本下 `L0=7 / L1=2 / L3=读取失败 / L4=0`，浏览器内存账本下如实 `全 0` 并标注「浏览器内存账本（非本机库）」，重读按钮点击后 `rows=7` 恢复。端到端链路：`getStorage().listMemories({})` + `coreBrowse(L1–L6)` → `loadStrataScale()` → `StrataScale` → DOM；浏览器 `SCALE_CHECK PASS` / `ALIGN2_CHECK PASS` / `REFRESH_CHECK PASS`、浅深主题复验、`pageerrors=none`。诚实降级：账本读失败 → `status:'error'` 且不调 browse、不渲染任何行；某层 browse 返回 null / 抛错 → 该层 `count=null` 显示「读取失败」而非 0。
> **C·变异验证**：C1 共 5 个关键判定注入缺陷，均**指定测试红灯 → 原样还原 → 哈希一致** → 全量 225/2624 复绿：M1 `hasOriginal` 改 `return true` → `expected 6 to be 4` 红；M2 标题加回 `· STRATA` → `expected '层级刻度 · STRATA' to be '层级刻度'` 红；M3 `count == null ? '读取失败'` 改 `count ?? 0` → `expected '0' to be '读取失败'` 红；M4 删 `data-brand-align` → `expected undefined to be 'center'` 红；M5 弹簧误置于 QAT 之前 → `expected <span class="rib-spring"> to be <div class="menu-wrap">` 红。`grep` 复查无变异残留。C2 输入/状态变异矩阵：空账本 → 七档全 0 且标内存账本；历史行缺 `has_l0`/信封 → L0 为 0（向后兼容不猜）；非法类型（content 为 null/数字/空白、L0 字段为数字/null/字符串）→ 不计入且不崩溃；账本读失败 → error 且不 browse；browse null / 抛错 → 失败层而非 0；重复 mem_id → 去重；空白内容 → 不算有内容；组件 `data=null` → 「读取中…」、`status=error` → 报错且零行。全部如实空态或明确报错，无静默成功、无伪造计数。
> **已知边界**：浏览器直连静态服务时无主进程，刻度显示内存账本真实读数（本机当前为 0），不冒充本机持久库；桌面端接真库后显示真实条数。L0 计数按「账本里有原文的行」统计，不等于 L0 原数据库里密文信封的物理条数（拆库后两者一一对应，未拆库老行原文在行上），口径已写入 `title`。刻度的短名（密文/脱敏/摘要/要点/场景/边界/索引）按定稿图，内核正式层名保留在 `title` 与 `fullName` 字段，避免短名掩盖语义。


### 批次54：按参考图重排功能导航 IA + 真实动态角标（2026-11-09）

> 口径：用户再次贴出窄侧栏参考图并问「软件怎么没有和这个图片对齐」。经确认，上一轮「对齐」只做成了层级刻度与导航树的**列位对齐**（x=24 / x=44），未改导航树本身。本轮按用户选定口径执行：① 功能导航重排为**四组 17 项**，分组名 / 条目名 / 顺序 / 图标对齐图片；② 每项映射已落地的真实 HTML；③ 层级刻度仍固定在导航栏最下面；④ 角标**只读真实账本 / 接入后端**，绝不写死参考图里的 `1467 / 3 / 3` 示例数。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 四组 17 项信息架构 | `src/web/shell/views.ts`（`NAV` 重写为 工作台 / 记忆 / 连接 / 治理；`首页 / 写入 / 检索 / 监控 / 记忆库 / 层级管理 / 生命周期 / 净化生长 / 冲突裁决 / Agent 接入 / 大模型配置 / 同步中枢 / 全局参数 / 账号与安全 / 日志记录 / 审计日志 / 用户反馈`） | `src/web/shell/__tests__/views.test.ts`「批次54：功能导航严格按参考图四组 17 项」；`workspace.test.tsx`「DOM 为四组 17 项」；`e2e/shell.spec.ts` 右键导航树 / 标签条用例 |
| 新增三个真实页面映射 | `views.ts` `PageKey` / `PAGES` 补 `layered → memory-layered.html`、`dispute → dispute.html`、`feedback → feedback.html`（三者本就是 `vite.config.ts` 构建入口）；`login` / `setup` 保留真实页面但不进主导航 | `views.test.ts`「每个页面都指向仓库根目录的真实 HTML，且已登记为 vite 构建入口」「主导航覆盖全部真实页面（login / setup 例外）」；浏览器 `pageMap` 实测三个 iframe src |
| 动态角标（零演示数） | `src/web/shell/navCounts.ts`（`coreListMemories` / `coreConflicts` / `AgentOnboardClient.getCards` 并发 `allSettled`，失败项不写入或记 0）；`Workspace.tsx` `realNavCounts` + `mergedNavCounts` + 刷新/登录态重读；`NavTreeItem` 角标 `title` 写明来源，`count > 0` 才渲染 | `src/web/shell/__tests__/navCounts.test.ts`（4 例：真实读数 / C2 读取失败 / 后端显式关闭 / 空态为 0）；`workspace.test.tsx`「角标只显示真实读数，不出现参考图示例数」「角标读数为 0 或读不到时不渲染徽标」 |
| 旧深链与分层条兼容 | `Workspace.tsx`：`openMemoryTab('?tab=l0', …)` 由「记忆库」派生 L0 标签；`activeNav` 按 page+href 兜底回查，避免 Ribbon 派生 id 丢属性检查器标题；`showLayerStrip` 改判 `page === 'layered'` 或记忆库 `tab=layers/l0`；菜单 `冲突待裁决 → openNav('dispute')`、`分层 L1–L6 → openNav('layered')` | `workspace.test.tsx`「L0 不再占主导航，Ribbon 深链仍打开 memory.html?tab=l0」「S7 分层条只在层级管理页或记忆库分层标签出现」；`e2e/personal.spec.ts` 个人记忆不再占主导航、页面待确认数仍真实 |
| 维护索引 | `specs/code-index.generated.md`、`specs/code-map.md` | `npm run code:index -- --write` + `npm run code:index:check` |

> **批次54 三道闸门证据**：
> **A·影响面回归**：影响面 = 壳层 `views.ts` / `Workspace.tsx` + 新增 `navCounts.ts` / `navCounts.test.ts` + 3 份测试契约 + `e2e/personal.spec.ts` / `e2e/shell.spec.ts`；未改内核公开契约、`types.ts` 接口、TCP 8202 / HTTP 8204、存储序列化、审计格式、MCP 12 工具、各 iframe 页面内部实现。**全量门禁 `npm run test:gate` = 226 文件 / 2630 例全绿**（4 片首跑通过、失败 0、重试 0；报告 `test-results/test-gate/20261109-174801/`）。`npm run typecheck` 两工程 0 错；`oxlint` 654 文件 0 warnings / 0 errors；`check:no-demo` 371 生产文件 / 26 判据 0 命中；`code:index` 377 源码 / 120 文档，`code:index:check` 通过；`npx vitest run --coverage --testTimeout=15000` 226 文件 / 2630 例全绿，覆盖率 Lines 82.45% / Statements 79.26% / Branches 70.87% / Functions 74.89%，均高于基线。`npm run verify:fast` 在默认 5s 超时 + 全并发下仍复现历史已知的 `personal.test.ts` / PgSyncHub 3 例超时（非本轮改动引入），以 `test:gate` 4 分片与 15s 超时全量结果为准。**全量 E2E `npm run test:e2e` = 126/126 通过**（`--workers=1`，含壳层右键、登录弹窗、个人记忆、首启向导等）。既有行为回归：顶部品牌居中、QAT 紧跟菜单、8 标签下移、层级刻度 L0–L6 与列位、右键上下文菜单、主题切换、标签开关均保持绿。
> **B·效果验证**：AC→用例映射：① 四组 → DOM `.tree .tree-group` = `['工作台','记忆','连接','治理']`；② 17 项 → `.tree .tree-row` = 17，`.tlabel` 逐项等于参考图文案；③ 真实页面 → 浏览器点击「层级管理 / 冲突裁决 / 用户反馈」后 iframe src 分别为 `/memory-layered.html` / `/dispute.html` / `/feedback.html`；④ 层级刻度仍在底部 → `scaleAfterTree=true`、标题 `层级刻度` 且 `hasStrata=false`、七档 `L0..L6`；⑤ 列位仍对齐 → `strataMark=24=navIcon`、`strataLayer=44=navLabel`；⑥ 顶部既有校正未回退 → `brandOffset=0`、`brandAlign=center`、QAT `qaAfterLastMenu=true`、`tabsAfterBody=true`、`tabCount=8`。状态断言：真账本预读为 0 时 DOM `badges=[]`，页面无 `1467`；`title` 标注 `coreListMemories` / `coreConflicts` / `GET /agents` 来源。端到端链路：`loadNavCounts()` → `mergedNavCounts` → `NavTreeItem` → 角标；浏览器 `NAV_VERIFY_CHECK PASS`、`PAGEERRORS none`。浅色 / 深色截图：`ui-concepts/workspace-nav-aligned.png`、`ui-concepts/workspace-nav-aligned-dark.png`。
> **C·变异验证**：C1 共 5 个关键判定注入缺陷，均**指定测试真实断言红灯 → 原样还原 → SHA256 哈希一致**：M1 `工作台` 改 `工作区` → `views.test.ts` 四组断言红；M2 `记忆库` 改 `记忆管理` → 17 项逐项断言红；M3 `loadNavCounts` 记忆数恒置 0 → `navCounts.test.ts` 真实读数断言红；M4 `count > 0` 改 `count >= 0` → `workspace.test.tsx`「0 不渲染徽标」红；M5 移除 `active?.page === 'layered'` 分层条判定 → S7「打开分层页才出现分层条」红。脚本以 `process.execPath + node_modules/vitest/vitest.mjs` 实跑，逐例校验输出含 `AssertionError|expected|FAIL`，`C1_RESULT PASS`；还原后 3 份套件 58/58 复绿。C2 输入 / 状态变异矩阵：空账本 / 空冲突队列 / 空 Agent 卡片 → 全 0 且不显示角标；账本读失败 → 不写 `memory-bank`；接入后端不可达 → `agent=0`；`?agentBackend=` 显式关闭 → 不发 fetch；组件收到 0 → 不渲染 `[data-testid^="nav-count-"]`；页面不含 `1467`。全部如实空态或明确失败，无静默成功、无伪造计数。
> **已知边界**：本轮按用户确认口径只重排**信息架构 + 条目映射 + 角标数据源 + 既有列位对齐**；导航窗格宽度仍为 250px、顶部「功能导航」标题行与折叠按钮保留，未做像素级仿形（参考图为 189×391 的局部裁切）。若需连窗格宽度 / 标题行 / 行高密度一起逐像素复刻，需另行确认。浏览器直连开发服务时后端未启动，角标真实读数为 0 因此不显示；桌面端接真库与真接入后端后显示真实条数。`个人记忆` 不再占主导航，但 `memory.html?tab=personal` 深链与页面真实计数仍在，E2E 已改为断言页面 `pm-pending-count`。


### 批次55：功能区命令区 2 行压缩 + 层级刻度复用概览账本（2026-11-09）

> 口径：用户截图确认红框内是**功能区命令区**而不是顶部 QAT；「现在是三行，缩减到两行的高度」，同时层级刻度报「需要登录操作」需改为**复用概览页已成功的同一次真实账本读取**。本轮不动 QAT、不动导航 IA、不动内核 API。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 功能区 3 行 → 2 行 | `src/web/shell/Workspace.tsx` `RibbonGroupView` 小按钮按 2 个一组分列、`RibbonButton` 大图标 24→18；`src/web/shell/theme.css` `.ribbon-body` 94→64px、`.rbig` 70→46px、`.rsmall` 22→20px、窄屏媒体查询同步收紧 | `src/web/shell/__tests__/ribbonLayout.test.ts`（静态版式 + 分列契约）、`workspace.test.tsx`「功能区命令按 2 行排布，单列小按钮不超过 2 个且不丢命令」；浏览器 `DEV_VERIFY_CHECK PASS` |
| 层级刻度改数据源 | `src/web/Home/coreHome.ts` `HomeFeedResult` 增 `strata: HomeStrataCount[] \| null`，由同一次 `listMemories` + `deriveLayerGraph(memories).hubs` 派生 L0–L6；`src/web/shell/overview.ts` `OverviewSnapshot` 增 `strata`；`src/web/shell/strataScale.ts` 删除 `loadStrataScale` / `getStorage` / `coreBrowse`，改纯函数 `strataViewFromOverview(snapshot)`；`Workspace.tsx` 由 `overview` 派生刻度，刷新/重读统一走 `refreshOverview()` | `src/web/Home/__tests__/coreHome.test.ts`（L0 原文标记 + L1/L2 层内容计数、空账本、读失败 `strata=null`）、`src/web/shell/__tests__/strataScale.test.ts`（快照未到 / 读失败 / 缺层 / 非法计数 / 空账本）、`workspace.test.tsx`（七档真实读数、缺层显示读取失败、整块报错） |
| 维护索引 | `specs/code-index.generated.md`、`specs/code-map.md` | `npm run code:index -- --write` + `npm run code:index:check` |

> **批次55 三道闸门证据**：
> **A·影响面回归**：影响面 = 壳层 `Workspace.tsx` / `theme.css` / `overview.ts` / `strataScale.ts` / `StrataScale.tsx` + 首页 `coreHome.ts` + 3 份测试；未改内核公开契约、`types.ts` 接口、TCP 8202 / HTTP 8204、存储序列化、审计格式、MCP 12 工具、各 iframe 页面内部实现。**全量门禁 `npm run test:gate` = 227 文件 / 2634 例全绿**（4 片首跑通过、失败 0、重试 0；报告 `test-results/test-gate/20261109-193342/`）。`npm run typecheck` 两工程 0 错；`oxlint` 654 文件 0 warnings / 0 errors；`check:no-demo` 371 生产文件 / 26 判据 0 命中；`code:index` 377 源码 / 120 文档，`code:index:check` 通过；`npx vitest run --coverage --testTimeout=15000` 227 文件 / 2634 例全绿，覆盖率 Lines 82.46% / Statements 79.24% / Branches 70.90% / Functions 74.82%，均高于基线。**全量 E2E `npm run test:e2e` = 126/126 通过**（`--workers=1`）。既有行为回归：四组 17 项导航、顶部品牌居中、QAT 紧跟菜单、8 标签下移、层级刻度列位、右键上下文菜单、主题切换、标签开关均保持绿。
> **B·效果验证**：AC→用例映射：① 2 行 → 浏览器实测 `ribbonHeight=64`、`bigHeight=46`、`smallHeight=20`、`.rcol` 单列最多 2 个小按钮、命令总数不丢，`tabsAfterBody=true`；② 层级刻度接真实数据 → 不再独立调 `storage:listMemories`，与概览页共用 `getHomeFeed` 同一次快照；浏览器实测 `strataRows=7`、`L0..L6` 全为数字、无「需要登录操作」、无 `1467`、无 `strata-note.err`，页脚如实标「浏览器内存账本（非本机库）」；③ 既有布局 → `groups=['工作台','记忆','连接','治理']`、`navRows=17`、`brandAlign=center`。端到端链路：`loadOverview()` → `getHomeFeed(getKernelStorage())` → `OverviewSnapshot.strata` → `strataViewFromOverview()` → `StrataScale` → DOM；刷新按钮与 F5 都回到 `refreshOverview()`，不再出现「概览有数、刻度报登录失败」的时序分叉。浏览器 `DEV_VERIFY_CHECK PASS`、`PAGEERRORS none`；`npm run package` 后用真 `dist/` 静态服务复验 `BUILD_VERIFY_CHECK PASS`、`PAGEERRORS none`（`ribbonHeight=64` / `maxCol=2` / 七档全为数字 / 无「需要登录操作」/ 无 `1467`）。浅色 / 深色截图：`ui-concepts/workspace-2row-strata.png`、`ui-concepts/workspace-2row-strata-dark.png`；最终构建截图：`ui-concepts/workspace-final-build.png`、`ui-concepts/workspace-final-build-dark.png`。
> **C·变异验证**：C1 共 5 个关键判定注入缺陷，均**指定测试真实断言红灯 → 原样还原 → SHA256 哈希一致**：M1 分列 `i += 2` 改 `i += 3` → `ribbonLayout.test.ts` 分列契约红；M2 `.ribbon-body` 64px 改回 94px → 静态版式契约红；M3 `strataViewFromOverview` 读失败判定短路为 `if (false)` → `strataScale.test.ts`「账本读取失败」红；M4 `getHomeFeed` 的 L0 计数恒置 0 → `coreHome.test.ts`「strata L0 按原文标记」红；M5 缺层 `?? null` 改 `?? 0` → `strataScale.test.ts`「缺失层」红。脚本以 `process.execPath + node_modules/vitest/vitest.mjs` 实跑并逐例校验输出含 `AssertionError|expected|FAIL`，`C1_RESULT PASS`；还原后全量 227/2634 复绿。C2 输入 / 状态变异矩阵：快照未到 → 「读取中…」；`storageError` 或 `strata=null` → 整块 error 且零行；缺层 / 负数 / NaN / 非法类型 → 该层「读取失败」而非 0，`failed` 如实记录；空账本 → 七档全 0 且不标失败；页面不含 `1467`。全部如实空态或明确失败，无静默成功、无伪造计数。
> **已知边界**：浏览器直连开发服务时无主进程与登录会话，`getHomeFeed` 走进程内内存账本，七档真实读数均为 0 并标注「浏览器内存账本（非本机库）」；桌面端登录后读本机真实账本，七档显示真实条数。功能区改为 2 行后横向宽度可能增加，`.ribbon-body` 保留 `overflow-x:auto`（窄屏媒体查询已同步收紧按钮宽度）；顶部 QAT 图标行、导航窗格宽度 250px 与「功能导航」标题行均未按截图裁切尺寸做像素级仿形。`npm run verify:fast` 默认 5s 超时 + 全并发下仍复现历史已知的 `personal.test.ts` / PgSyncHub 3 例超时（非本轮改动引入），以 `test:gate` 4 分片与 15s 超时全量结果为准。

### 批次56：问账本收进快捷栏「记忆助手」（2026-11-09）

> 口径：用户截图圈出首页底部「问账本」问答框，要求「做成可收缩的图标移动到快捷栏，名称记忆助手，不随标签变换而变换」。本轮只动壳层 QAT + 首页问答框迁移；问答逻辑（answerOverviewQuestion）原样复用，不改内核 API、不改审计格式。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| QAT「记忆助手」开关 | `src/web/shell/Workspace.tsx`：`qa-ask` 置灰演示位替换为 `{ id:'assistant', icon:'spark', text:'记忆助手', active }` 真实开关；`QaSpec` 增 `active`（高亮 + `aria-pressed`）；QAT 按钮包 `.qa-slot` 定位槽，面板常驻壳层（收起只是不渲染，会话不丢） | `workspace.test.tsx`「QAT 记忆助手展开/收起…」「Esc 收起面板；空输入不发送」 |
| 壳层问答面板 | 新增 `src/web/shell/MemoryAssistant.tsx`：复用 `answerOverviewQuestion` + 壳层 `overview` 快照（与层级刻度/状态栏同一次读取）；建议问题 chips、Enter 发送 / Shift+Enter 换行、Esc 收起、刷新走 `refreshOverview()`；读不到/未取数如实标注 | `workspace.test.tsx`「回答只转述真实账本快照」「账本读取失败时如实回答没读到」 |
| 切标签不丢会话 | 开闭状态在 `Workspace`（`assistantOpen`），问答 thread 在常驻 `MemoryAssistant`；中心标签切换只切 iframe，壳层不卸载 | `workspace.test.tsx`「切换中心标签：面板开闭状态与问答会话都不丢」 |
| 首页移除问答框 | `src/web/overview/OverviewPage.tsx` 删 `.ov-ask` / `.ovx-answers` 与 input/thread 状态；`overviewPageData.ts` 建议问题抽为 `OVERVIEW_SUGGESTIONS` 导出（助手复用），`OverviewView.suggest` 字段删除；`overviewPage.css` 删孤儿样式（含 `--ov-accent-soft`） | 既有 `home.spec.ts` / `overview.spec.ts` / `crossTabAuth.spec.ts` 断言 `.ovx-*` 保持绿 |
| 面板样式 | `src/web/shell/theme.css` 新增 `.qa-slot` / `.qa-btn.on` / `.ma-*`（全部走壳层令牌，浅/深/随系统自动跟随） | 浏览器浅/深截图目视 + 面板不溢出视口断言 |
| 维护索引 | `specs/code-index.generated.md`、`specs/code-map.md` | `npm run code:index -- --write` + `code:index:check` |

> **批次56 三道闸门证据**：
> **A·影响面回归**：影响面 = 壳层 `Workspace.tsx` / `theme.css` + 新增 `MemoryAssistant.tsx` + 首页 `OverviewPage.tsx` / `overviewPage.css` / `overviewPageData.ts` + `workspace.test.tsx`；未改内核公开契约、存储序列化、审计格式、MCP 工具、其余 iframe 页面。`npm run verify:fast` EXIT=0：typecheck 两工程 0 错；oxlint 0/0；`code:index:check` 通过（378 源码 / 120 文档）；`check:no-demo` 0 命中；全量 vitest **227 文件 / 2638 例全绿**，覆盖率 Lines 82.70% / Statements 79.49% / Branches 71.06% / Functions 75.14%。受影响 E2E 子集（真构建产物 + 真后端）：`shell / home / overview / crossTabAuth` **21/21 通过**（含 QAT 登录入口、全域右键、主题切换、`.ovx` 首页契约）。既有行为回归：QAT 紧跟菜单、品牌居中、8 标签、层级刻度、登录弹窗、右键菜单均保持绿。
> **B·效果验证**：AC→用例映射：① 可收缩图标 → `qa-assistant` 点击后面板出现、`aria-pressed=true`，再点/✕/Esc 收起；② 名称记忆助手 → QAT 按钮可见文字「记忆助手」；③ 不随标签变换 → 组件用例与真浏览器双重断言：切到记忆库再切回首页，面板仍开、2 条回答原样保留；④ 首页问答框移除 → iframe 内 `.ov-ask` 计数=0。真浏览器（dev server + Chromium）16 项断言全过：`homeAskBoxRemoved / qatLabel / initiallyClosed / opened / pressed / answerReal / answerCount=2 / inputCleared / survivesTabSwitch / survivesSwitchBack / escCloses / threadAfterReopen / darkTheme=dark / noOverflow / pageErrors=[]`；状态行实测「账本读取 21:17:47 · 只转述本次快照，不含演示数据」。端到端链路：`loadOverview()`（壳层单次真实读取）→ `MemoryAssistant` → `answerOverviewQuestion(q, snapshot)` → DOM；刷新按钮回到 `refreshOverview()`。诚实降级：快照 `storageError` → 回答「账本没读到，无法回答」并带真实原因；空输入发送钮禁用。浅/深截图：会话可视化目录 `assistant-open-light.png` / `assistant-open-dark.png`。
> **C·变异验证**：C1 变异点 = 面板常驻判定 `{q.id === 'assistant' && (…)}` 注入 `active?.page === 'home' &&`（切标签即卸载）→ 指定用例「切换中心标签：面板开闭状态与问答会话都不丢」真实红灯（`getByTestId('memory-assistant')` 找不到，workspace.test.tsx:972）→ 原样还原 → 54/54 复绿，`git diff` 确认无变异残留。C2 输入/状态变异矩阵：空输入 → 发送禁用不假答；`storageError` → 如实「没读到」不拿 0 冒充；Esc → 收起；收起再展开 → 会话保留；切标签往返 → 开闭与会话保留；深色 → 面板令牌跟随。全部如实空态或明确失败，无静默成功。
> **已知边界**：面板为 QAT 下拉浮层（与菜单弹层同模式），展开时覆盖功能区右部，收起即恢复；开闭状态存于壳层内存，刷新整页后回到收起（问答会话不跨进程重启持久化——本轮需求只要求不随标签切换丢失）。浏览器直连 dev 时无主进程，回答基于浏览器内存账本并如实标注；桌面端登录后读本机真实账本。


### 批次57-A：L1 共享令牌换为 Stratum（方案A）· 纸灰底/墨蓝字/电青 + 深空/辉光青（2026-11-09）

> 口径：用户认可 L1+L3 预览后下令「L1 改 p0.css / shell theme.css 令牌 + L3 逐页改版式，首页先行（记忆库暂停）」，并强调「首页数据要接入真实数据」。本小节为 **L1**：只换两份共享 CSS 的**令牌取值**（组件命名与版式一律不动），把旧蓝灰配色整体切到方案 A；旧组件命名全部别名到 A 令牌，保证下游组件零改动、只换色。L3 首页版式与真实数据接入在 57-B 单独成批。

| 能力 | 代码落点 | 测试 |
|---|---|---|
| 共享页令牌换 A | `src/web/shared/p0.css` `:root` / `html[data-theme="dark"]` 整块重写为 A 源令牌（--bg/--surface/--surface2/--ink/--muted/--line/--line2/--accent/--accent-ink/--accent-soft/--ok/--warn/--bad + --c-l0..l6 + --mono/--sans），旧命名 --line-2/--text/--faint/--panel/--field/--accent-weak/--err/--chip/--win/--sel/--sel-text 全部别名到 A；body 字体改 `var(--sans)` | `aTokens.test.ts`「p0.css 亮色/暗色令牌 = A」 |
| 壳层令牌换 A | `src/web/shell/theme.css` `:root` / dark 整块重写为同一套 A 源令牌，旧壳层命名 --win/--chrome/--panel/--panel2/--tx/--tx2/--mu/--red/--red-soft/--amber/--green 别名到 A；`--r` 6→8px；body 字体 `var(--sans)`；标题栏渐变 / `.qa` 深色分隔 / `.app-mark` 等硬编码色改到 A；`--accent` 上的 `color:#fff` 全部改 `var(--accent-ink)`（深色电青底白字对比不足） | `aTokens.test.ts`「shell/theme.css 令牌 = A / 暗色 = A」 |
| 令牌契约测试（C 指定哨兵） | 新增 `src/web/shared/__tests__/aTokens.test.ts`：静态读取两份 CSS 断言 A 取值 + 旧命名别名链 | 4 例全绿；作为 C1 变异的红灯哨兵 |
| 维护索引 | `specs/code-index.generated.md`、`specs/code-map.md` | `npm run code:index -- --write` + `code:index:check` |

> **批次57-A 三道闸门证据**：
> **A·影响面回归**：影响面 = `src/web/shared/p0.css` + `src/web/shell/theme.css` + 新增 `aTokens.test.ts` + 两份 specs；**只换令牌取值，不动任何组件版式 / TS / 内核 / 存储 / 审计 / MCP / 端口**。`npm run verify:fast` EXIT=0：typecheck 两工程 0 错；oxlint 0/0；`code:index:check` 通过；`check:no-demo` 生产文件 / 26 判据 0 命中；全量 vitest **228 文件 / 2642 例全绿**（原 227/2638 + 新契约 1 文件 4 例），覆盖率 Lines ≥82.7%。既有行为回归：壳层四段布局、四组 17 项导航、层级刻度、右键、主题切换、标签开关均不变（纯令牌换色，组件引用路径未变）。
> **B·效果验证**：真浏览器（现有 5180 dev 服务 + Chromium，`verify-l1.cjs`）7 项断言全过：浅色 `.app-mark` 背景 = rgb(0,136,204)（A 电青）、body = rgb(243,245,248)（A 纸灰）、ribbon = rgb(237,241,246)（A surface2）；深色 `.app-mark` = rgb(34,211,238)（A 辉光青）、body = rgb(6,11,22)（A 深空）、ribbon = rgb(16,27,48)；页面无 `1467`、无 pageerror。端到端链路：`:root` A 源令牌 → 旧命名别名（var(--bg)/var(--ink) …）→ 既有组件 var() 引用 → 渲染色。截图 `l1-shell-light.png` / `l1-shell-light2.png`。
> **C·变异验证**：C1 共 2 个令牌点注入缺陷，均**指定契约测试真实红灯 → 原样还原 → 全绿**：M1 `p0.css` 浅色 `--accent #0088CC→#0f6cbd` → `aTokens.test.ts`「p0.css 亮色令牌」红（`to match /--accent:\s*#0088CC/i` 失配）→ 还原复绿；M2 `theme.css` 浅色 `--accent #0088CC→#2f6fed`（旧壳层色）→「shell/theme.css 令牌 = A」红 → 还原复绿；`git diff` 确认无变异残留。C2 输入/状态矩阵：浅色 A 取值 / 深色 A 取值 / 旧命名别名仍解析到 A / `--r:8px` 生效 / 无演示数字。全部如实，无静默回退旧配色。
> **已知边界**：本轮 L1 只覆盖用户点名的 `p0.css` 与壳层 `theme.css` 两份共享源；`src/web/shared/theme.css`（8 页暗色共用）与 `legacyLight.css` / `p0Legacy.css`（9 页明/暗叠加层）本轮**未动**，这些页在各自叠加层下仍走旧暗色令牌，后续批次按需对齐。首页（index.html）iframe 加载的是 `overviewPage.css` 自有令牌、非 p0.css——其 A 化随 57-B 首页改版一并完成。`color-mix` 依赖 Chromium ≥111，Electron 45 满足。
