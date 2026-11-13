---
title: 净化生长 × Agent 侧进化 — 三个独立缺口任务
date: 2026-11-12
status: implemented（GAP-1/2/3 均已实施并过用例，待真机实测确认）
scope: GAP-1 召回权重可进化 / GAP-2 反馈回灌因果链 / GAP-3 双向可观测
---

# 净化生长 × Agent 侧进化 — 三个独立缺口任务

> **来源**：[`specs/reports/审查-Agent侧记忆库与净化生长打通-2026-11-12.md`](../reports/审查-Agent侧记忆库与净化生长打通-2026-11-12.md) §3/§5。
> 本文把审查结论拆成**三个互不依赖、各自独立提交**的原子任务，与
> [`specs/tasks/RECALL-ECHO-RAG.md`](RECALL-ECHO-RAG.md) 的回显改造**完全隔离**（不共用分支步骤、不共用提交、不共用打包批次）。
>
> **状态：已实施（2026-11-12 批次61）。** GAP-1/2/3 三条链路代码与用例均已落盘，
> 各过三道闸门（含代码级变异验证），尚未打包真机实测。实施落点见 §7「实施落点对照」。
> 结论以 2026-11-12 `main` 的代码实际为准；规格声称与代码冲突处见审查报告 §4。

## 0. 为什么必须独立

审查结论是「物理账本共享，但自我进化目标链基本断开」。三个缺口分属三条不同的因果链：

| | 断在哪一段 | 改动层 | 与回显改造的关系 |
|---|---|---|---|
| GAP-1 | 「使用数据 → 召回排序参数」 | 内核打分常量 + 配置 | 无共享文件 |
| GAP-2 | 「反馈 → 净化动作」 | 内核写路径 + 冲突/补炼队列 | 无共享文件 |
| GAP-3 | 「Agent 侧数字 ↔ 桌面侧数字」 | MCP 报告 + 页面数据层 | 仅 `mcpHttp.ts` 名称重叠，改的不是同一函数 |

混做会让「回显改版」的回归失败无法归因到具体链路，也会把一批内核行为变更塞进同一个提交。
**纪律：一个 GAP = 一个原子任务 = 一次门禁 = 一次提交（提交前单独确认）。**

## 1. 任务总表

| 编号 | 优先级 | 目标（一句话） | 首要改动文件 | 依赖 |
|---|---|---|---|---|
| GAP-1 | **P0** | 让召回排序权重能被自生长回归消费，而不是写死常量 | `forgetting.ts` / `agent.ts` / `paramsSnapshot.ts` | 无 |
| GAP-2 | P1 | 让 `feedback` 的 reject/disputed 真正进入降档、补炼、裁决链 | `memories.ts` / `forgetting.ts` / `conflict.ts` / `refineQueue.ts` | 建议 GAP-1 之后（共用打分口径） |
| GAP-3 | P2 | 让 `gc_report` 与净化生长页看到同一组 Agent 侧指标 | `mcpGcTools.ts` / `useGrowthReal.ts` / `GrowthPanels.tsx` | 无（可并行） |

三项都会改运行时源码 → 各自按 `AGENTS.md` §0.2 走完整交付闭环（关旧端 → 重打包 → 验产物 → 启新端 → 核运行态）。
重启后 L0 写密钥默认锁定，需在安全页重新解锁，否则采集诚实进 `cursor-hold(l0_locked)`（预期行为，不是回归）。

---

## 2. GAP-1（P0）召回排序参数可进化

### 2.1 现状证据

- `forgetting.ts:18`：`SCORE_WEIGHTS = { w_f:0.35, w_i:0.30, w_c:0.15, w_a:0.20 } as const`，**全仓无写入点**。
- `forgetting.ts:53–64` / `:120–123`：`scoreMemory` 与 `hardFilter` 直接读该常量；`hardFilter` 只有 3 条判据，**未过滤 `deleted` / `merged_into`**。
- `regression.ts:262–289` 的真实回归对象 ≠ `DimWeights` / `LayerThresholds`（**写入查重维度**），唯一消费点是 `memories.ts:235–236` 的 `coreWrite → findDuplicate`。
- `recallModes.ts` 的 `ModeWeights` **未被 `agent.ts` 引用**；`src/web/growth/logic.ts:74–106` 的 `evaluateOptimizations` 注释即「只读指标驱动，不改指标」。
- 规格声称「每周回归 mode_weights」（`需求规格书_UI页面设计.md:685`）与「命中率低 → 降阈值 / 加速遗忘」（`需求规格书.md:885–898`）**均未落地**。

**后果**：命中率再低、Agent 反馈再多，Agent 看到的召回排序与过滤参数恒定；「自生长」只影响写入查重，不影响读出。

### 2.2 候选方案（实施前需用户确认，不在本轮定案）

1. **最小**：把 `SCORE_WEIGHTS` 从 `as const` 改成从 `growth:v1` 配置读取的运行时权重（带校验与默认值），`scoreMemory` 接受可选权重参数；`hardFilter` 补 `deleted` / `merged_into` 过滤。
2. **完整**：在方案 1 基础上，让 `regression.ts` 同时产出召回权重的调整建议（基于命中率 / 反馈分布），经用户确认或阈值门禁后才应用，**不自动改权重**。
3. 无论哪种，**默认行为必须与现状逐字一致**（配置缺省 = 现有常量值），否则老账本的召回结果漂移无法解释。

### 2.3 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| A1 | 未配置 `growth:v1` 权重时，`scoreMemory` 输出与改造前逐字一致 | 固定样本 + 快照断言（旧值基线） |
| A2 | 配置合法权重后，排序结果随之变化且可复算 | 两组权重跑同一批记忆，断言顺序差异与手算一致 |
| A3 | 非法/越界/非数值权重 → 回退默认值并记审计，不抛异常、不静默生效 | 参数变异矩阵 |
| A4 | `hardFilter` 排除 `deleted` / `merged_into` 行 | 构造含墓碑与合并影子的样本 |
| A5 | `recallModes.ts` 的 ModeWeights 若被接线，须有唯一消费点；未接线则单测断言「不被引用」不产生幻觉 | 静态断言或代码索引核对 |
| A6 | 回归产物只写配置、不直接改历史记忆 | 审计行断言（`weight_tuned` 存在、记忆 version 不变） |

**不变项（反向断言）**：`estTokens` 与 3000t 预算口径、`buildRecallSections` 四段数字、`display` 6 字段契约、`hitHighlight` 三处 `matched_terms`、账本落盘文件清单。

**风险**：权重可配置后，「同一次 query 在不同时间返回不同顺序」需要可解释性（审计记权重版本 + 页面显示当前权重），否则排障困难。

---

## 3. GAP-2（P1）反馈信号回灌净化因果链

### 3.1 现状证据

- `memories.ts:824–867`：`coreFeedback` 只改 `confidence`（confirm +0.1 / reject −0.05）、加 `reinforce_count` 或挂 `conflict_id`；全文无降档 / 重炼 / ban / 断边调用。
- 从默认 `confidence=0.5` 到 `hardFilter` 的 0.05 阈值需**连续 9 次 reject**，实际近乎不触发。
- `conflict.ts:75–99`：路径 1 要求恰好 2 条同 `conflict_id`，而 `disputed` 挂的是单条 → **造不出可裁决冲突对**。
- `forgetting.ts:386–496` 的 `runForgettingCycle` 只读 `listMemories`，**从不读 `recall` / `memory_op` / `mcp_call` 审计**。
- `boost = min(1, access_count/10)`（`forgetting.ts:60`）在 10 次命中后饱和；`classifyLayer` 只降不升（`:129–150`），规格写的「命中/恢复 → warm」未落地。
- `refineQueue.ts` 入队点仅 `main.ts:1832 / :1937 / :3216`，与反馈无调用关系。

### 3.2 候选方案

1. reject 累计到阈值 → 触发降档或入补炼队列（写 `growth_op` 审计，用户可在页面看到原因）。
2. `disputed` 生成**成对** `conflict_id`（补齐另一条或走单条裁决路径），让冲突裁决页真能处理。
3. `runForgettingCycle` 增加只读的 recall/verdict 审计聚合，作为 freshness/boost 的附加输入（**只读，不改写入路径**）。
4. 所有阈值进配置，默认阈值保持「不改变现状行为」，由用户显式启用。

### 3.3 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| B1 | 单次 reject 仍只改 `confidence`，行为与现状一致（默认阈值未启用时） | 回归快照 |
| B2 | 启用阈值后，累计 reject 触发降档 / 入队，且审计含可追溯原因 | 计数变异 + 审计断言 |
| B3 | `disputed` 生成的冲突对能被 `conflict.ts` 裁决路径识别 | 端到端冲突用例 |
| B4 | `runForgettingCycle` 读审计失败（审计不可读）时**不阻断**净化，只记告警 | 故障注入 |
| B5 | `access_count` 饱和行为不变（除非显式改阈值） | 边界值 10 / 11 次用例 |

**不变项**：`feedback` 入参 schema、`memory_op` 审计既有字段、页面确认/拒绝计数、L0 写锁与共享池分流。

---

## 4. GAP-3（P2）Agent 侧 × 桌面侧双向可观测

### 4.1 现状证据

- `mcpGcTools.ts:39–50`：`gc_report` 默认 `dry_run=true`；`forgetting.ts:490` `if (dryRun) return report; // 零审计`。
- 报告 10 项分层统计在 growth/lifecycle 页**完全不展示**：`useGrowthReal.ts:341–365` 只认 `schedule_run` / `growth_op` / `weight_tuned` / `recall` / `memory_op`，从不读 `action='gc'`。
- 报告里**没有** client 维度、省量、verdict 分布；页面也**没有** recall 次数、`saved_tokens`、按 Agent 拆分、首调合规率。
- 但这些信号**已经写进审计**：`agent.ts:298`（client）、`:304–307`（省量）、`mcpHttp.ts:373–386`（`mcp_call`）—— 属于「已采集未消费」。
- `mcpGcTools.ts:32 / :645` 明确「勿与桌面 cron decay 同时执行以免双计」；`main.ts:3760–3763` 各自独立调度，执行记录不互通。

### 4.2 候选方案

1. `gc_report` 增加只读的 Agent 维度分组（按 `detail.client` 聚合 recall 次数 / 省量 / verdict 分布），**不改 dry_run 默认行为**。
2. growth 页新增一块「Agent 侧使用」卡片，展示上述审计聚合，并标注数据口径与统计窗口。
3. `gc` / `mcp_call` 审计在日志页与 growth 页可见，避免双计时给出明确的互斥提示文案。
4. 所有指标注明「来自审计、非实时」，绝不把 dry_run 演算值显示成已执行结果。

### 4.3 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| C1 | `dry_run=true` 仍零写入、零审计，报告标注「演算」 | 审计条数前后相等 |
| C2 | 新增 Agent 分组的每一个数字都能在审计里逐条对上（不估算、不补零） | 固定审计样本手算比对 |
| C3 | 无 client 的旧审计归入「未标识」，不冒充某个 Agent | 混合样本 |
| C4 | 页面在审计为空时显示「暂无数据」，不显示 0 制造已采集假象 | 空账本用例 |
| C5 | `gc` 与 cron decay 同时执行时给出互斥提示，不双计 | 并发用例 |

**不变项**：`gc_report` 入参与 10 项既有字段、票据与 8204 安全头、页面既有指标计算、审计落盘格式。

---

## 5. 共同纪律

| 项 | 要求 |
|---|---|
| 三道闸门 | 每步收尾过 A 影响面回归 / B 效果验证 / C 变异验证；C 至少一次代码级变异（注入缺陷 → 指定用例红灯 → 原样还原 → 绿灯） |
| 门禁 | `typecheck` / `lint` / `test:gate` / `validate_project.py` / `generate.py --check` / `check:no-demo` / `code:index:check` |
| 索引 | 每步重建 `specs/code-index.generated.md`，并在 `meta/index.md` 登记新文档（避免孤儿警告） |
| 提交 | **每次 commit / push 前单独展示「改动清单 + 三道闸门输出 + 拟用提交信息」，等用户明确确认**；不把非本任务产生的在途改动带入 |
| 交付闭环 | 运行时源码改动按 `AGENTS.md` §0.2 重打包 + 重启 + 核运行态；三项各自独立完成，不合并打包 |
| 纯净度 | 收尾跑「跑验 → 扫 → 清 → 核 → 报」，清掉本步测试产物与临时脚本 |

## 6. 与回显改造的隔离边界

| | 回显改造（`RECALL-ECHO-RAG.md` T2–T6） | 本文件 GAP-1/2/3 |
|---|---|---|
| 改动层 | 展示层模板 / 展示要求 / 明细页 HTML | 内核打分、写路径、报告与页面数据层 |
| 共用文件 | `mcpHttp.ts`（`recallEchoNote`） | `mcpHttp.ts`（审计与报告段）—— **不同函数、不同代码块** |
| 是否共享提交 | 否 | 否 |
| 是否共享打包批次 | 否 | 否 |

**建议排期**：回显改造先完成 T2–T6 并交付；GAP-1 单独作为下一个 P0 任务启动。理由：GAP-1 会改变召回排序结果，
而回显 T6 的真机验证需要稳定的召回样本，两者同期进行会让「排序变了」被误判为「回显改错了」。

---

## 7. 实施落点对照（批次61，2026-11-12）

本节只记「规格 AC → 代码 → 用例」的对应关系，避免下一个人再从零考古。三道闸门证据见提交说明。

### 7.1 GAP-1 召回排序参数可进化

| AC | 实现落点 | 用例 |
|---|---|---|
| A1 | `shared/growthConfig.ts:DEFAULT_RECALL_WEIGHTS`（真源）+ `forgetting.ts:SCORE_WEIGHTS` 转发 | `shared/__tests__/growthConfig.test.ts`「A1：默认值 = 内核历史常量」；`forgetting.test.ts`「A1：SCORE_WEIGHTS 与 shared 真源逐字一致」 |
| A2 | `forgetting.ts:scoreMemory(m, relevance, now, w)`；`agent.ts` 召回入口读 `growth:v1` 后传两处调用 | `forgetting.test.ts`「A2：换权重会改变排序」 |
| A3 | `shared/growthConfig.ts:validRecallWeights` + `normalizeGrowthConfig` 整块回退 | `growthConfig.test.ts`「A2/A3」两组 |
| A4 | `forgetting.ts:hardFilter` 最前排除 `deleted`/`merged_into`（优先于 pinned 免检） | `forgetting.test.ts`「A4：墓碑与合并影子不进候选」 |
| A5 | `recallModes.ts` 仍未接线（本轮不做）；`agent.ts` 唯一消费点是 `growth:v1` | 人工核对（`code-index.generated.md` 无新增引用） |
| A6 | `regression.ts:suggestRecallWeights` 只产建议；`appendRecallSuggestionAudit` 落 `growth_op`（`applied:false`） | `regression.test.ts`「建议 never 自动生效」+「扣减守 0.05 下限」等 10 例 |

**决策记录**：A6 采取「完整方案」——回归产出 `recall_weights` 调整建议并落审计，**不自动应用**；
`suggestRecallWeights` 规则写死（reject 占比 > 30% → `w_c +0.05`；证据不足 > 35% → `w_i +0.05`；
缺口按 `w_f → w_a` 顺序扣、单维下限 0.05），样本 < 30 次召回一律不给建议。

### 7.2 GAP-2 反馈信号回灌

| AC | 实现落点 | 用例 |
|---|---|---|
| B1 | `shared/growthConfig.ts:FeedbackPolicy` 缺省 `enabled:false` | `growthConfig.test.ts`「反馈回灌策略」4 例；`memop.test.ts`「B1：连打 5 次 reject 只降 confidence」 |
| B2 | `memories.ts:coreFeedback` reject 分支 + `feedbackSignal.ts:tallyRejects`；达阈写 `growth_op`（`reject_downgrade`） | `memop.test.ts`「B2：第 3 次触发 hot→warm」+「窗口外不计入」+「cold 不硬推」 |
| B3 | `feedbackSignal.ts:findConflictCounterpart`（同项目 / live / 相似度 ≥ 0.75），`conflict.ts` 路径 1 即可命中 | `memop.test.ts`「B3：conflict.ts 真能列出这一对」+「幂等不拉第三条」+「找不到对手如实留单条」 |
| B4 | `forgetting.ts:runForgettingCycle` 追加 `readFeedbackSignals`（try/catch 兜底，失败不阻断） | `forgetting.test.ts`「B4：审计读不到 → 净化照常跑完」；`feedbackSignal.test.ts` 14 例 |
| B5 | `scoreMemory` 的 `boost = min(1, access_count/10)` 一字未改 | 既有 `AC-03` / `AC-11` 用例继续绿（未改一行） |

**决策记录**：入补炼队列（`refineQueue.ts`）需要队列状态与目录，`coreFeedback` 无此依赖 → 本轮选「降档」分支
（规格 §3.2 第 1 条是「降档**或**入队」二选一）；补炼入队留待后续单独任务，避免为了接队列把内核写路径搅成一团。

### 7.3 GAP-3 双向可观测

| AC | 实现落点 | 用例 |
|---|---|---|
| C1 | `mcpGcTools.ts` 只读聚合放在 `gcFull` 之后，不改 `dry_run` 语义 | `mcpGcTools.test.ts`「C1：注入 storage 后 dry_run 仍零写入零审计」 |
| C2 | `agentUsage.ts:summarizeAgentUsage` 逐条计数（recall / mcp_call / memory_op） | `agentUsage.test.ts`「每个数字与审计逐条对得上」；`mcpGcTools.test.ts`「C2」 |
| C3 | 缺 `client` → `CLIENT_UNKNOWN='未标识'`，不猜 Agent | `agentUsage.test.ts`「C3」 |
| C4 | 空审计 → 页面显「暂无数据」，不渲染 0 值表格 | `agentUsageCard.test.tsx` 3 例（含 GrowthPage 空账本） |
| C5 | `agentUsage.ts:GC_CONCURRENCY_NOTE` + 报告 `concurrency_note` 字段 + 卡片同文 | `agentUsage.test.ts`「C5」；`mcpGcTools.test.ts`「C5」 |

**诚实边界（UI 已写明）**：`memory_op` 审计没有 `client` 字段 → verdict 分布只能到项目级，
`verdicts_attributable` 恒 `false`，页面照此标注，不把裁决数摊到 Agent 头上。
