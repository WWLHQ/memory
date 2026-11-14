---
title: P1 客户端整形改造（借鉴 dsh-hindsight 第 6/7/8 项）
date: 2026-11-14
status: planned
scope: REQ-014 / 回拼原文与新旧覆盖 / 保真声明强化 / 侧栏真实状态卡
---

# P1 客户端整形改造（借鉴 dsh-hindsight 第 6/7/8 项）

> 对应 REQ-014 / AC-014 / TC-016。来源与论证见
> [`specs/reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md`](../reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md) §4（P1 改造项）。
> P0 已落地为 REQ-013（`specs/tasks/RECALL-SHAPING.md`，T1–T7）。
> 行为唯一真源是源码；本文是实施规格与验收清单。
> 拆分规范见 [`meta/TASK_SPLITTING.md`](../../meta/TASK_SPLITTING.md)（原子任务 8 属性 + DAG）。

## 0. 目标与决策（用户 2026-11-14 拍板）

- **范围**：P1 三项（原文回拼+新旧覆盖 / 保真声明强化 / 侧栏真实状态卡）折入本 REQ，作为 C6–C8。
- **决策红线**：**T3（source_excerpt 原文摘录）做**；**T5（prelude 中性提示扩展）不做**（不偏离 `recallPrelude.ts:4`「绝不注入话术」）。其余遵守全部铁律红线。
- **折入 SSOT**：REQ-014 + AC-014 + TC-016 + 本任务文件（已登记 `meta/index.md`）。

---

## 1. C6 召回结果「以最新为准」明示（回拼原文 + 新旧覆盖）

### 1.1 外部做法
Hindsight 把抽取出的「事实」按 `chunk_id` 拼回一次 retain 的**原文片段**注入；并用 `supersededIds` 把旧记录标「已被取代」，召回时**强制补带**合并后的新记录，让 Agent 同时拿到「保真原文」与「新旧关系」。

### 1.2 我方现状（证据）
- 召回注入只拼 `hits[].content` 正文，且是**原样**拼（`recallPrelude.ts:64-80` 的 `buildRecallPrelude`）。
- `content` 在我们的体系里已是 **L2 摘要（≤300 字）**，不是原文；L0 是 v2 密文信封、不参与检索（`l0Store.ts`）。
- 我们**已有**完整的合并治理：`merged_into` / `merged_from` 墓碑字段（`types.ts:737-738`），17.9 合并组→摘要逻辑（`forgetting.ts:205-268`），且所有召回/背景选材都已过滤 `merged_into` 影子（`recallInsight.ts:58,80`）。
- **我们没有 chunk 结构**——造 chunk 成本大、且与 L0–L6 分层模型不兼容。

### 1.3 冲突与约束
- 直接照搬「chunk 回原文」要新建 chunk 存储 + 索引，违背「轻量单文件存储」现状，且 L0 密文不能进检索/注入（安全红线）。
- 但若完全不处理，用户看到的是「摘要」，拿不到「同一事项以最新版为准」的明示。

### 1.4 改造方案（A 档必做、B 档做）
- **A 档 · 墓碑强制补带（零新字段）**：命中 `merged_into` 时把目标记忆作为派生必带项强制进入 hits/background，打 `superseded:true` 标记；命中卡加中性标注「⮕ 该事项已合并入 `[mem_x]`，以最新版为准」——只加标注、不改正文、不编话术，与回显铁律兼容。落点：新增 `recallSupersede.ts`（纯函数 + 单测）+ `agent.ts`（命中补带）+ `recallInsight.ts`（标注）+ 明细卡。
- **B 档 · 原文摘录（做，T3）**：加可选字段 `source_excerpt`（脱敏后的关键原文摘录，≤200 字，**L0 密文不进**），在写入侧（conflict/merge/精炼）填充；`buildRecallPrelude` 拼装时：若命中是摘要，则附带其 `source_excerpt`，实现「摘要 + 原文片段」双保真。落点：`types.ts`（可选字段）、`coreWrite.ts`/`forgetting.ts`（填充）、`recallPrelude.ts`（拼接）。

---

## 2. C7 保真/免责声明强化（仅明细页 footer）

### 2.1 外部做法
Hindsight 在自动注入块加免责头：「只是背景、可能过时」「路径/符号以原文为准」「同一事项以时间最新为准」，降低 Agent 误用记忆的风险。

### 2.2 我方现状（证据）
- 硬前置召回的拼装真源 `recallPrelude.ts:4` 写明边界：**「只注入 hits[].content 正文，绝不注入 display.markdown / 回显话术 / 令牌」**。
- 回显铁律（[1]《读取规范》）：**不得改写 `display.markdown`，URL/数字/金额不得改写**，Agent 原样输出（已明确告知 Agent 原样输出：`recallInsight.ts:684-685`）。
- 本机明细页 footer 已有完整的「数字同源 / 不编造 / 不含令牌」口径说明（`recallInsight.ts:868-874`），这是**安全且零铁律冲突**的保真声明落点。

### 2.3 冲突与约束
- 把免责头**写进 `display.markdown` / 回显** = 改写回显内容 = 违反铁律，且会破坏 A6/A8 回显贯通测试。
- 唯一可放免责头的地方是 hook 的 system prelude（注入到 system 最前，非回显），而该文件明确「绝不注入话术」——偏离现有约定。

### 2.4 改造方案（守铁律，分两处）
- **做：明细页 footer 强化（`recallInsight.ts:868-874` 附近）**：把「保真 / 以最新为准 / 不含令牌 / 不编造」声明强化为更完整的一条口径说明。**不进注入正文、不进回显**，零铁律冲突，立即可做（T4）。
- **不做：prelude 扩展（T5 明确不做）**：`RECALL_PRELUDE_MARKER` 中性提示扩展会偏离 `recallPrelude.ts:4`，且聊天回显加免责话术违反 [1]。**本 REQ 仅由 T4 的明细页 footer 承担 C7**，T5 不排期。
- **明确不做**：不在聊天回显里加任何免责话术（那等于替用户改写输出，违反 [1]）。

---

## 3. C8 侧栏真实状态卡（事件驱动 + 轻量轮询）

### 3.1 外部做法
Hindsight 用 25s 长轮询把真实 operation 状态（部署中/运行中/失败）推到侧栏状态卡；另有「一键部署向导」（自动装 uv/Python/venv）。

### 3.2 我方现状（证据）
- 导航计数是 **postMessage 一次性回传**（`navCountChannel.ts:24-33` 的 `publishNavCount`），只传角标计数，不传状态。
- 但我们**已有完整的真实状态通道**：`hostBridge.ts` 的 `HostMethod` 枚举已含 `collector:status`、`l0:pendingWrites`、`refine:state`、`sync:*`、`recallHard:state` 等真实 operation 状态（`hostBridge.ts:36-79`），统一经 `hostCall` 拉取。
- Electron 桌面端**自带服务、无 deploy 概念**；自动装运行时与 `AGENTS.md §0.1` 纯净度、打包纪律冲突（报告 P2 已明确不建议）。

### 3.3 冲突与约束
- 长轮询（`setInterval` 25s 阻塞式拉取）对 Electron 桌面端是过度设计——我们已有 hostCall 同步请求 + 事件驱动能力，且 navCount 是一次性回传（用途不同，不冲突）。
- 一键部署向导：与 Electron 打包纪律 + 纯净度 §0.1 冲突，**明确不做**。

### 3.4 改造方案（事件驱动 + 轻量轮询，复用既有通道）
- **做：事件驱动 + 轻量轮询状态卡**：侧栏组件通过现有 `hostCall` 拉取 `collector:status` / `l0:pendingWrites` / `refine:state` / `sync:*` 等**真实**状态，用 React `useEffect` 周期性（10–15s，非 25s 长轮询）拉取并展示「采集进行中 / 写入兜底 N 条 / 精炼队列 M 条 / 同步进行」等真实状态。
- **做：扩展侧栏挂载点**：复用 `navCountChannel.ts` 的模式，新增 `NAV_STATUS_MSG` 一次性回传给壳层侧栏（与现有 navCount 不冲突，后者只传计数）。
- **不做：长轮询**、**不做：一键部署向导**（我们 Electron 自带服务，无需 deploy）。

---

## 4. 任务拆分总表（P1 → REQ-014）

| 子任务 | 归属 | 单一目标 | 落点 | 状态 |
|---|---|---|---|---|
| T1 | C6-A | merged_into 命中强制补带目标记忆 | `recallSupersede.ts`（新）+ `agent.ts` | 做 |
| T2 | C6-A | 命中卡「以最新为准」标注 | `recallInsight.ts` + 明细页 | 做 |
| T3 | C6-B | `source_excerpt` 字段 + 填充 + 拼装 | `types.ts` + `coreWrite.ts`/`forgetting.ts` + `recallPrelude.ts` | **做** |
| T4 | C7 | 明细页 footer 保真声明强化 | `recallInsight.ts:868-874` | 做 |
| T5 | C7 | prelude 中性提示扩展 | `recallPrelude.ts:6` | **不做**（偏离 `:4` 铁律） |
| T6 | C8 | navStatusChannel 状态回传 | `src/web/shared/navStatusChannel.ts`（新） | 做 |
| T7 | C8 | 侧栏状态卡组件 | Dashboard/TopBar + hostCall | 做 |
| T8 | C8 | 固化「部署向导不做」 | `已知边界台账.md` | 做 |

依赖：T1→T2；T4 独立；T6→T7；T3/T4/T6/T7/T8 相互独立；T8 独立文档。

---

## 5. 原子任务拆解（8 属性 + DAG）

### T1 merged_into 命中强制补带
- 目标：新增 `src/core/memagent/recallSupersede.ts` 纯函数，命中 `merged_into` 时把目标记忆作为派生必带项强制进入 hits/background，打 `superseded:true`，不重复带入。
- 输入：`types.ts:737-738`（merged_into/merged_from）、`recallInsight.ts:58,80`（现有过滤）、`agent.ts`（命中补带点）。
- 输出：新增 `src/core/memagent/recallSupersede.ts` + `src/core/memagent/__tests__/recallSupersede.test.ts`；`agent.ts` 调用补带。
- 验收：`npm test -- recallSupersede`（补带 + 去重 + 不碰 `recallModes.ts` 单一真源反向断言）。
- 边界：仅新增 `recallSupersede.ts` 与对应测试 + `agent.ts` 补带调用；**不动** `recallModes.ts` / `growthConfig.ts`。
- 依赖：前置 无；被 T2 依赖。
- 提交：一个 commit，message 含 `T1`/`REQ-014`。

### T2 命中卡「以最新为准」标注
- 目标：命中卡（回显 + 明细页 + RAG 四段）对 `superseded` 项加中性标注「⮕ 该事项已合并入 `[mem_x]`，以最新版为准」，只加标注不改写正文。
- 输入：`recallInsight.ts`（命中卡 + 明细卡）、`recallSupersede.ts`（superseded 标记）。
- 输出：修改 `recallInsight.ts` 标注逻辑 + 对应测试。
- 验收：`npm test -- recallInsight`（superseded 标注用例；`display.markdown` 仍逐字不变反向断言）。
- 边界：仅改标注渲染；**不改写** `display.markdown` 正文（铁律）。
- 依赖：前置 T1；被 无 依赖。
- 提交：含 `T2`/`REQ-014`。

### T3 source_excerpt 原文摘录（做）
- 目标：`types.ts` 加可选字段 `source_excerpt`（≤200 字，**L0 密文不进**）；写入侧（conflict/merge/精炼）填充；`recallPrelude.ts` 拼装时摘要+原文片段双保真。
- 输入：`types.ts`、`coreWrite.ts`/`forgetting.ts`（填充点）、`recallPrelude.ts:64-80`（拼装）、`l0Store.ts`（L0 密文不进约束）。
- 输出：`types.ts` 可选字段 + `coreWrite`/`forgetting` 填充 + `recallPrelude` 拼装 + 单测。
- 验收：`npm test -- recallPrelude`（或 `sourceExcerpt`）（填充 + 拼装 + L0 不进断言）。
- 边界：仅加可选字段与填充/拼装；**不引入**外部模型/LLM；L0 密文不进 `source_excerpt`。
- 依赖：前置 无；被 无 依赖。
- 提交：含 `T3`/`REQ-014`。

### T4 明细页 footer 保真声明强化
- 目标：`recallInsight.ts:868-874` footer 强化为完整保真声明（数字同源 / 以最新为准 / 不含令牌 / 不编造）。
- 输入：`recallInsight.ts:867-874`（footer）、回显铁律。
- 输出：修改 footer 文案 + 单测断言 `display.markdown` 逐字不变。
- 验收：`npm test -- recallInsight`（footer 文案 + `display.markdown` 不变反向断言）。
- 边界：仅改明细页 footer；**不进**注入头、**不进** `display.markdown`（铁律）。
- 依赖：前置 无。
- 提交：含 `T4`/`REQ-014`。

### T5 prelude 中性提示扩展 —— 不做
- 决策：用户明确不做。理由：偏离 `recallPrelude.ts:4`「绝不注入话术/令牌」既有约定，且聊天回显加免责话术违反回显铁律 [1]。C7 仅由 T4 的明细页 footer 承担，本任务不排期。

### T6 navStatusChannel 状态回传
- 目标：新增 `src/web/shared/navStatusChannel.ts`，复用 `navCountChannel.ts:24-33` 模式，一次性回传状态摘要（与 navCount 不冲突）。
- 输入：`navCountChannel.ts`（publishNavCount 模式）、`hostBridge.ts:36-79`（HostMethod 真实状态枚举）。
- 输出：新增 `src/web/shared/navStatusChannel.ts` + `src/web/shared/__tests__/navStatusChannel.test.ts`。
- 验收：`npm test -- navStatusChannel`（解析 / 回传）。
- 边界：仅新增文件；复用既有 `HostMethod` 枚举，**不新增**通道方法。
- 依赖：前置 无；被 T7 依赖。
- 提交：含 `T6`/`REQ-014`。

### T7 侧栏状态卡组件
- 目标：Dashboard/TopBar 侧栏状态卡，经 `hostCall` 拉 `collector:status` / `l0:pendingWrites` / `refine:state` / `sync:*` 真实状态，轻量轮询（10–15s）展示。
- 输入：`hostBridge.ts`（hostCall + HostMethod）、`navStatusChannel.ts`（T6）。
- 输出：新增/修改侧栏组件 + 组件测试。
- 验收：`npm test -- <状态卡组件>`（真实状态展示 + 轻量轮询 + 不实现长轮询）。
- 边界：仅改侧栏展示；**不引入**长轮询、**不实现**部署向导。
- 依赖：前置 T6。
- 提交：含 `T7`/`REQ-014`。

### T8 固化「部署向导不做」
- 目标：在 `specs/已知边界台账.md` 固化「一键部署向导明确不做」（Electron 自带服务、与纯净度 §0.1/打包纪律冲突）。
- 输入：`specs/已知边界台账.md`、`AGENTS.md §0.1`。
- 输出：修改 `specs/已知边界台账.md` 增加条目。
- 验收：grep 台账含「一键部署向导」+ 文档门禁（`validate`）。
- 边界：仅文档。
- 依赖：前置 无。
- 提交：含 `T8`/`REQ-014`。

---

## 6. 依赖 DAG

```
T1 ──▶ T2
T3 ──▶ (独立)
T4 ──▶ (独立)
T6 ──▶ T7
T8 ──▶ (独立文档)
```
T1→T2 有先后；T3/T4/T6/T7/T8 相互独立；T6→T7。

---

## 7. 三道闸门计划（每步收尾）

- **A · 影响面回归**：每个 T 改完跑 `npm run typecheck` / `lint` / `test:gate` / `python tools/validate_project.py` / `npm run code:index:check`；C6 反向断言证明 `recallModes.ts` 单一真源未变、L0 密文不进 `source_excerpt`。
- **B · 效果验证**：每条 AC 一条正向端到端用例；真实跑一次含「已合并记忆」的 recall，核对补带 + 标注；`source_excerpt` 核对双保真；侧栏核对真实状态展示。
- **C · 变异验证**：至少一次代码级变异（如临时去掉 merged_into 补带 → A1 用例红灯 → 还原复绿；临时在 prelude 注入免责话术 → A4 反向断言红灯 → 还原复绿）。

T1/T3/T4/T6 为纯函数/文档/通道（无 UI 大改）→ B/C 以单测覆盖；T2/T7 有运行时/渲染改动 → A/B/C 三栏全跑。

---

## 8. 不可逾越边界（铁律清单，任何 P1 子任务都不得破坏）

1. **回显铁律**：不得改写 `display.markdown`，URL/数字/金额不得改写；Agent 原样输出（[1]、`recallInsight.ts:684-685`）。
2. **prelude 边界**：只注入 `hits[].content` 正文，绝不注入话术/令牌（`recallPrelude.ts:4`）——T5 因偏离此条已明确不做。
3. **模式单一真源**：任何新增召回/权重/词表规则回 `core/memagent/recallModes.ts` / `shared/growthConfig.ts`；Web 与回显只读内核（A6 测试锁）。
4. **纯本地零出网**：不接第三方 embedding/LLM/reranker（`pipeline_llm_tokens` 恒 0，`agent.ts:383`）。
5. **pending ≠ 成功**：L0 锁定 / 发件箱待判的写入仍是「未成功」，不得谎报。
6. **安全**：L0 密文不进检索/注入/摘录（`source_excerpt` 对 L0 恒空）；明细页不含令牌（`recallInsight.ts:903-909`）。

---

## 9. 交付与状态

- 本文件已折入 SSOT：REQ-014 + AC-014 + TC-016，并登记 `meta/index.md`（第 25 行后）。
- 状态 = **planned（待实现）**；**未改动任何运行时源码、未 commit / push / 打包 / CI**。
- 工作区既有在途改动（18+ 个）与既有未跟踪报告均未触碰。
