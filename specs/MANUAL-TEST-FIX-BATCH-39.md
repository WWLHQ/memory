# 批次39 手动测试报告 · 重新设计精炼器：L2–L6 由后台补炼队列真生成

日期（UTC+08:00）：2026-11-03
分支：`main`，HEAD 仍是 `3a4080a`（**批次35、36、37、38、39 的改动全部未提交**；`git commit`/`git push` 需用户明确授权，本批未提交）
上一批次：批次38（`specs/MANUAL-TEST-FIX-BATCH-38.md`）
起因（用户原话）：「**L2-L6是怎么生成的？怎么没有数据？**」→「**重新设计精炼器生成L2-L6**」

---

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,040,131 字节 = **116.39 MB** |
| SHA256 | `D165A68BA6FA820563421720958C9E30A872561F0AEF38A99BB5E636E5EED2F8` |
| 构建完成（UTC+08:00） | 2026-11-02 22:44:44 |
| 安装包是否含本批全部代码 | **是**。最后一次源码改动在 22:41:16（`main.ts`），安装包 22:44:44 落盘，晚于全部源码编辑（已用 `stat` 逐一比对）。2026-11-03 上午重跑的 `verify:fast` 只是复验，**没有再改代码，故无需重打包**。 |
| `npm run verify` | **退出码 0（全绿）** |
| 单测 | vitest **146 文件 / 1661 例全过** |
| `npm run lint` | oxlint `0 warnings / 0 errors`（497 文件，oxlint 1.90.0） |
| `npm run code:index:check` | 代码索引已是最新（**305 个文件**） |
| `npm run test:coverage` | Statements 81.32% / Branches 73.56% / Functions 77.50% / Lines 84.43% |
| `npm run test:e2e` | Playwright **106 例通过**（22 spec，含 `e2e/setup.spec.ts` 12 例）。本批未改 E2E 覆盖的页面，跑一遍确认没回归。 |
| 本批新增/改动测试 | `refineQueue.test.ts` **19 例（新文件）** + `RefineQueueCard.test.tsx` **8 例（新文件）** + `llmGateway.test.ts` 增至 **28 例**（新增「单条最多试 3 个引擎」预算用例）+ `ParamsPage.test.tsx` **11 例** + `programLogLabels.test.ts` **10 例** |

---

## 1. 用户问题的直接回答

**「L2–L6 怎么没有数据？」——真因不是没接大模型，也不是没配密钥，是写入管道根本没把精炼器接上。**

2026-11-02 21:5x 对本机真实账本实测（读 `memories.db.json`，非推断）：

| 实测项 | 值 |
|---|---|
| 记忆库行数 | **1585** |
| `layer` | **1585 行全是 L1** |
| `refined_by` | **1585 行全是 stub** |
| 带任一 L2–L6 正文的行 | **0** |
| LLM 网关健康度 | 6 个引擎中 **5 个 `enabled:true` 且有真拨测延时**（ollama 352ms / agnes 475ms / agnes 1608ms / openrouter 2058ms / zhipu 2497ms；deepseek 未启用） |

所以能力是有的，空的是**接线**：
- `src/electron/main.ts` 采集器构造写入上下文时**不传 `llm`/`llmModel`**（同文件的按-L0-重建通道倒是传了 `llmGateway`）；
- `src/core/memagent/mcp.ts` 与 `mcpHttp.ts` 各硬编码 `new FakeLlmProvider()`。

`makeLayerGenerator` 的第一道闸门 `llm && isStub===false && model && (refineLayer|refine)` 因此恒为假 → 阶梯第一步就停在 L1，并如实记 `refined_by=stub`（这正是批次9 立的「没真模型只落 L1，绝不用模板句冒充」硬规则在起作用，**不是 bug**）。

**MCP 那两个 `FakeLlmProvider` 桩本批继续保留**——用户 2026-11-02 明确拍板：「**MCP HTTP 写入只落 L0，脱敏后才能产出 L1**」是设计不变量。

---

## 2. 本批口径（四条全是用户拍板，不是维护者自选）

| # | 问题 | 用户选定 | 落在代码哪里 |
|---|---|---|---|
| A | 采集/写入时机 | **写入只落 L0 密文 + 脱敏 L1，深层 L2–L6 交给后台异步队列炼** | `main.ts` 采集器仍**不**传 `llm`（保持写入快），改为写完一批后 `enqueueRows` |
| B | 存量 1585 行怎么办 | **全量后台补炼** | `main.ts` `startRefineQueue` 启动即全量入队 |
| C | 队列状态放哪 | **落 `refine-queue.json`，重启续炼** | `refineQueue.ts` `loadRefineQueue`/`saveRefineQueue`（0600） |
| D | 成本与失败口径 | **单条≤3 引擎 · 每自然日（UTC+08:00）≤500 行 · `llm_partial` 不自动重试** | `REFINE_MAX_ENGINES_PER_CALL=3` / `REFINE_MAX_ROWS_PER_DAY=500` / `nextPending` 的当日额度闸门 / `retryFailed` 只能手动点 |

---

## 3. 改动清单（逐文件理由，用户要求的「为什么改这么多文件」）

### 新增（5 个文件）

| 文件 | 干什么 · 为什么必须新建 |
|---|---|
| `src/core/memagent/refineQueue.ts` | 队列纯函数 + 单行精炼。`loadRefineQueue`/`saveRefineQueue`（0600，**只有 mem_id + 状态 + 原因码，正文一个字不落这里**）、`enqueueRows`（幂等）、`nextPending`（内含「未启用 / 当日额度用尽」两道闸门）、`settleRowOutcome`（落 done/failed/skipped）、`retryFailed`、`summarizeRefineQueue`（UI 进度）；`refineRowLayers` 用与正常写入**同源**的 `makeLayerGenerator`/`checkLayerSpec`/`layerSpecsFrom` 走 L2→L6，**只有产出至少一层才改行**，改行时重算 `sha256`/`layer_specs`/`layers_generated_at`、`version+1`、向量按新 layer 重 upsert，每行审计 `memory_op/op='layer_refine'` + `actor='refine_queue'`。**为什么独立文件**：这是新的执行通道，逻辑要能被 19 例单测脱离 Electron 主进程直接验证。 |
| `src/core/memagent/__tests__/refineQueue.test.ts` | 19 例覆盖：入队幂等 / 受保护行不入队 / 缺 L1 不入队 / 未启用不起活 / 当日额度耗尽停 / 跨 UTC+08:00 自然日额度重置 / 至少一层才改行 / 零产出时正文与 `refined_by` 不动 / 失败与 skipped 分类 / `retryFailed` 只放回 failed / 队列文件 0600 / 回执 `day_left` 计算。**这是本批唯一把「闸门」钉死的地方**。 |
| `src/web/params/refineQueue.ts` | 渲染层桥。把主进程回执 `{ok,summary,engine,report,retried}` 转成 UI 用的 `RefineResult`；无宿主能力时如实返回「浏览器模式没有这个队列」，**不伪造进度**。 |
| `src/web/params/RefineQueueCard.tsx` | 参数页补炼卡（紧跟 LLM 引擎卡）：进度（pending/done/failed/skipped）、当日额度 `N/500（剩 M）`、引擎可用性徽标、「开启后台补炼」开关、「把存量入队补炼」、「重试失败行」、「刷新」，20s 轮询。引擎不可用时顶部黄条「只排不炼」。 |
| `src/web/params/__tests__/RefineQueueCard.test.tsx` | 8 例：非管理员只读 / 无宿主能力时降级文案 / 进度渲染 / 开关调 `setEnabled` / backfill 回执逐字回显计数 / retry 回执 / 内核抛错只显示原因 / 引擎不可用时警告条。 |

### 修改（7 个文件）

| 文件 | 改了什么 · 为什么必要 |
|---|---|
| `src/electron/llmGateway.ts` | `LlmGatewayProvider` 构造函数加第 4 参 `maxEnginesPerCall`（由 `main.ts` 传入 `REFINE_MAX_ENGINES_PER_CALL=3`）。补炼时一条记忆一次**最多试 3 个引擎**，超预算在错误里明说「还有 N 个未试」——这是 D 口径的成本闸门。**为什么改它**：不改的话队列无法限制单条花费。 |
| `src/electron/__tests__/llmGateway.test.ts` | 增至 28 例，新增「预算=3 时第 4 个引擎不被调用且错误文案写明未试数」。**改动必配测试**（AGENTS §7 第 6 条）。 |
| `src/electron/main.ts` | 新区块 **§6f L2–L6 后台补炼队列**（编号避开已被首启向导占用的 §6e）：`REFINE_TICK_MS=15s` 定时 `runRefineTick`、`refineInFlight` 防重入、启动 `startRefineQueue`（全量入队 + `kernel:refine:backfill-scan` 日志）、采集器写完一批后 `enqueueRows`、4 条 IPC（`refine:state` 需会话；`refine:setEnabled`/`refine:backfill`/`refine:retryFailed` 需管理员）。**为什么是主进程**：队列要真调 LLM、要持账本写锁，只能在主进程。 |
| `src/electron/ipcChannels.ts` | 加 4 个 `refine:*` 通道常量（单一真源）。 |
| `src/electron/preload.ts` | 暴露 `refineQueue` 命名空间。 |
| `src/desktop/hostBridge.ts` | 注册 4 个 `refine:*` 方法映射。 |
| `src/web/params/ParamsPage.tsx` | 把 `RefineQueueCard` 挂进参数页。 |
| `src/web/Home/programLogLabels.ts` | 补 `kernel:refine:*` 8 个人话标签 + 4 个 IPC 通道中文名（日志记录页「人话视图」要认得新动作，AGENTS §4「有动作就有日志」）。 |

> 文档同步（不算代码改动）：`AGENTS.md` §3 新增任务→文件行、§6 新增 `refine-queue.json` 说明、§9 追加批次39 块；`specs/code-map.md` 追加「## 批次39」；`specs/需求规格书.md` 新增 §19.23。

---

## 4. 管理员手测步骤（请在桌面端逐条走，截图/回执留档）

前置：安装 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（SHA256 见 §0），以**内置管理员**登录。

1. **先看队列卡**：参数页 → 找到「L2–L6 后台补炼队列」卡（在 LLM 引擎卡下方）。首屏应看到 pending 计数（启动已全量入队存量）、`refined_by=stub` 的存量都在队里。
2. **⚠️ 补炼会真花钱**：若不想现在花云端 API 费用，**先点「开启后台补炼」开关关掉**，或先把云端引擎停用、只留本机 ollama。卡面与本文档 §6 都把这条写在显眼处。
3. **验证「只排不炼」闸门**：把全部引擎停用（或关掉开关），等一个 tick（≤15s），刷新卡 → 进度不推进、当日额度 `day_rows` **不增长**（引擎不可用时不消耗额度、不判死）。
4. **手动存量入队**：点「把存量入队补炼」→ 回执应逐字给出 `已入队 N 行（原本就在队列 X · 已炼过 Y · 受保护不入队 Z · 不合格 W）`。
5. **看一行真产物**：让队列跑起来（启用 ollama），等几行 done 后：
   - 打开记忆库/层级页，选一条 done 的行 → 应看到 L2（及往上）有真正文，`refined_by` 变为 `llm` 或 `llm_partial`（不再是 stub），层级生成时间刷新。
   - 该条 `version` 比补炼前 +1。
6. **验证正文零落盘**：用文本编辑器打开数据根 `ledgerDir`（L1–L6 所在目录）下的 `refine-queue.json` → 里面**只有 mem_id + 状态 + 原因码 + 时间**，**没有任何 L1/L2…正文，也没有 L0 密文**。
7. **验证动作日志**：在数据根 `actions.log` 里 `grep "[kernel:refine:row]"` → 每精炼一行一条，字段只有 `mem_id, ok, refined_by, to_layer, layers, llm_calls, code, ms, day_rows, day_limit`（**无正文**）。另查 `refine:backfill-scan`、`refine:set-enabled`、`refine:enqueue-collected`。日志记录页「人话视图」应把这些翻译成中文。
8. **验证内核审计**：审计日志页按某条 `mem_id` 回查 → 有 `memory_op` 且 `op='layer_refine'`、`actor='refine_queue'`。
9. **重启续炼**：关应用重开 → 队列卡进度不从零开始（`refine-queue.json` 保住了状态），已 done 的行不会被重复精炼。
10. **重试失败行**：对 `llm_partial`/failed 行，点「重试失败行」→ 回执 `失败行已放回队列：N 行`。**不点不会自动重试**（D 口径）。

---

## 5. 与既有通道的分工（别混用）

| 我想…… | 用哪个 | 前提 |
|---|---|---|
| 让存量/新行长出 L2–L6 | **本批后台补炼队列** | 只需启用引擎；**不动 L1、不动游标** |
| 规则变了、重判哪些行该删 | §19.21 规则重判（`REJUDGE`） | 管理员逐字口令 |
| 采集规则变了、全删重采 | §19.20 清空重采（`RESET`） | 管理员逐字口令 |
| 删了 L1–L6 库要从 L0 原文整行重造 | §19.22(5) 按 L0 重建（`REBUILD`） | 需 L0 查阅会话解出原文，管理员逐字口令 |

**补炼只「加」深层，REBUILD 是整行重造（新 L1 + 深层）**，两者不是一回事。

---

## 6. 诚实边界（未做/已知限制，不留给用户猜）

1. **本批代码已在安装包中，但 §6f 的定时/入队「真机接线」没有自动化测试覆盖**——纯函数 19 例 + 卡片 8 例 + 网关预算 1 例，`main.ts` §6f 的 `setInterval`/启动全量入队/采集器写完即入队**只有单测外的实机走查**能验（见 §4 步骤 3–9）。首次实机务必按 §4 核对 `refine-queue.json` 与 `actions.log`。
2. **补炼会真实调用引擎并花钱**。远端引擎的 `price:0.01` 只是路由记账口径，**不是厂商账单**；回执里的费用一律标注「字符级估算」。想只花本机钱：停用云端引擎或关掉「开启后台补炼」。
3. **队列默认 `enabled:true`**（因用户明确选了「全量后台补炼」），等于**装完即开始消耗额度**——这是有意取舍，不是疏忽；§4 步骤 2 显式提醒先关。
4. **本机 7B 模型慢**：单次精炼实测 ~28s，一行五层约两分钟。`REFINE_MAX_ROWS_PER_DAY=500` 是**上限不是目标**，实际吞吐由模型速度决定。
5. **规格违规 → 该层留空 + 整行标 `llm_partial`**：本机小模型偶发违反层级字数/mustInclude，`checkLayerSpec` 判废后如实留空，**绝不用 stub 或模板句冒充 LLM 产物**；这类行不自动重试（D 口径），要重炼请点「重试失败行」。
6. **MCP 写入通道不变**：`mcp.ts`/`mcpHttp.ts` 的 `FakeLlmProvider` 桩**按用户口径保留**——MCP 仍只落 L0 密文 + 脱敏 L1，深层由后台队列补。
7. **`refine-queue.json` 不在数据根迁移白名单里**：切换数据根不会带它——丢了等价于「重新扫存量入队」，**不丢数据**（启动时 `startRefineQueue` 会按「有 L1 但无任何深层」重扫）。
8. **纯浏览器（`npm run dev`）无主进程**：本卡如实显示「浏览器模式没有这个队列」，不伪造进度、不起活。
9. **批次35–39 的不可逆真实账本操作仍未在真账本上执行**：`RESET`（清空重采）、`SPLIT`（存量搬家）、`REBUILD`（按 L0 重建）的 `*Run` **从未真机点过**——本批同样**不碰**这些； irreversible 操作必须由管理员在应用内亲手输入逐字口令，我不代做。
10. **红线（重申）：L0 管理密码与恢复码同时丢失 = L0 原数据库不可恢复**，没有任何服务端兜底。补炼不改变这一点，也不依赖 L0 原文（它只读库内已有的可检索层）。
11. **`git commit`/`git push` 未做**：批次35–39 改动仍在工作区，HEAD 为 `3a4080a`，等用户明确授权。
