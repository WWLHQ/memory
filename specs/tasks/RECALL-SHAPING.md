---
title: 召回质量增强（借鉴 Hindsight 客户端整形层）
date: 2026-11-14
status: draft
scope: REQ-013 / 时间窗加权 / 幂等写入 / 标识符加权 / source 标记过滤 / 真实状态 UI
---

# 召回质量增强（借鉴 dsh-hindsight 客户端整形层）

> 对应 REQ-013 / AC-013 / TC-015。来源与论证见
> [`specs/reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md`](../reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md) §4（P0 可直接吸收）。
> 行为唯一真源是源码；本文是实施规格与验收清单。
> 拆分规范见 [`meta/TASK_SPLITTING.md`](../../meta/TASK_SPLITTING.md)（原子任务 8 属性 + DAG）。

## 0. 目标与不可逾越的边界

借鉴外部 dsh-hindsight-local 插件的「客户端整形」能力，补强我们**纯逻辑层面**的召回质量。
它把语义能力外包给 Hindsight（要联网/密钥/费用），我们只抄它**不依赖外部模型**的那部分。

### 0.1 不可逾越（硬约束，反向用例锁着）

- **不破坏召回模式单一真源**：时间窗加权是「打分修正项」，**不是第 6 个模式**；`core/memagent/recallModes.ts` 的 `RECALL_MODE_SPECS` / `resolveMode` 档位数与行为**不变**。任何新增分流规则必须回到内核单一真源，Web/回显只读。
- **不破坏回显铁律**：`display.markdown` 原样输出、URL/数字/金额不得改写（`AGENTS.md:74`、`mcpRecall.ts:14,260`）。C4 的 source 标记**不得改写回显文案**，只在注入头/采集侧落地。
- **不引入外部模型/密钥/出网**：保持 `pipeline_llm_tokens=0`、零密钥、零费用（对比报告 §2 语义检索行）。**禁止**接 1024 维 embedding / reranker / LLM 抽取（P2 明确否决）。
- **不自动安装运行时**：不装 uv / Python / venv / docker（与 `AGENTS.md §0.1` 纯净度、打包纪律冲突）。
- **不推翻 `pending ≠ 成功` 语义**：C2 是补强幂等与续传，不是把 pending 当成功。

### 0.2 借鉴项范围

| 项 | 来源（对比报告） | 档位 | 落点 |
|---|---|---|---|
| C1 时间窗解析与加权 | §4 P0#1 | 直接吸收 | `src/shared/timeWindow.ts` + `agent.ts` 打分修正 |
| C2 确定性幂等写入 | §4 P0#2 | 直接吸收 | `pendingWrites.ts` / `sessionCollector.ts` |
| C3 标识符精确词加权 | §4 P0#4 | 直接吸收 | `vector.ts` / `forgetting.ts` |
| C4 source 标记 + 采集过滤 | §4 P0#5 | 直接吸收（防御性） | `recallPrelude.ts` / `sessionCollector.ts` |
| C5 真实状态驱动 UI | §4 P0#3 | 直接吸收 | 监控/审计页 + 状态轮询 |

**P1（需改造、本轮不纳入，留作后续单独提案）**：原文回拼 + 新旧覆盖（§4 P1#6）、`<memory-context>` 式免责头（§4 P1#7，与回显铁律冲突须显式批准）、侧栏长轮询状态卡 / 一键部署向导（§4 P1#8，与现有 `postMessage` 通道冲突、与打包纪律冲突）。

## 1. 能力拆解（C1–C5）

- **C1**：本地时区相对时间解析 → `query_timestamp`；把「时间窗命中」作为 `agent.ts` 打分修正项（如 ±1 天放宽 + 加权），零命中仍注入本地时间。
- **C2**：内容 sha1 去重 + 游标（`cursor` / `content_hash`）不推进 + 429 指数退避抖动；断点续传。
- **C3**：标识符（路径/符号/ID）精确词权重 3，普通词权重 1；叠加到词袋打分。
- **C4**：注入头带 `source.kind=plugin:*` 标记；采集跳过 `plugin:` 日志、剥离 `<memory-context>` 文本（当前不自动注入，先埋点）。
- **C5**：按 operation id 轮询 `audit.jsonl` 真实状态；409 = 排队中（非失败）；定期对账。

## 2. 原子任务拆分（8 属性 + DAG，每步展示成果 → 等人工确认 → 再下一步）

### T1 时间窗解析纯函数
- 目标：实现 `src/shared/timeWindow.ts` 纯函数（相对时间 → 本地时区时间戳 + `query_timestamp` + 时间窗命中判定），零依赖。
- 输入：对比报告 §4 P0#1；须覆盖东八区边界（早上 7 点不落到前一天）。
- 输出：新增 `src/shared/timeWindow.ts` + `src/shared/__tests__/timeWindow.test.ts`。
- 验收：`npm test -- timeWindow`（纯函数单测全绿，含「昨天下午」「3 天前」「7am」「今天早上」东八区边界 + 时间窗命中）。
- 边界：仅允许新增 `src/shared/timeWindow.ts` 与对应 `__tests__`；**不动** `recallModes.ts` / `agent.ts`。
- 依赖：前置 无；被 T2 依赖。
- 提交：一个 commit，message 含 `T1`/`REQ-013`。

### T2 打分接入时间窗修正项
- 目标：在 `agent.ts` 召回打分处把时间窗命中作为修正项叠加（加权），并零命中时仍注入当前本地时间。
- 输入：T1 的 `timeWindow.ts`；`agent.ts` 打分/预算裁剪逻辑（`agent.ts:235-254` 附近）；`recallModes.ts` 单一真源约束。
- 输出：修改 `agent.ts`（仅加打分修正项 + 注入本地时间）；可加单测。
- 验收：`npm test -- agent`（相关单测绿）+ 手动 recall 带「昨天」类 query 验证加权；`recallModes.test.ts` 档位数不变（反向断言）。
- 边界：仅改 `agent.ts` 打分修正项；**禁止**在 `recallModes.ts` 新增第 6 个模式、禁止改 `resolveMode`。
- 依赖：前置 T1；被 T7 依赖。
- 提交：一个 commit，含 `T2`/`REQ-013`。

### T3 确定性幂等写入
- 目标：给 `pendingWrites.ts` / `sessionCollector.ts` 加内容级 sha1 去重 + 游标不推进 + 429 指数退避抖动，断点续传，且不破坏「pending ≠ 成功」。
- 输入：`pendingWrites.ts`、`sessionCollector.ts`、`WriteResult` 类型（`types.ts`）；对比报告 §4 P0#2。
- 输出：修改上述文件，`WriteResult` 增加 `cursor` / `content_hash` 字段；单测。
- 验收：`npm test -- pendingWrites`（同内容重发幂等、断点续传、失败不推进游标；pending 语义不变）。
- 边界：仅改 `pendingWrites.ts` / `sessionCollector.ts` / `types.ts` 相关类型；不动 `mcp.ts` 写入契约。
- 依赖：前置 无；被 T7 依赖。
- 提交：含 `T3`/`REQ-013`。

### T4 标识符精确词加权
- 目标：在 `vector.ts` `tokenCoverage` 或 `forgetting.ts` 打分处给标识符（路径/符号/ID）权重 3、普通词 1，叠加精确词权重。
- 输入：`vector.ts`（`DEFAULT_VECTOR_DIM=64` 词袋）、`forgetting.ts` 打分；对比报告 §4 P0#4。
- 输出：修改 `vector.ts` 或 `forgetting.ts` 打分；单测断言标识符命中权重提升。
- 验收：`npm test -- vector`（或 `forgetting`）；可量化命中率提升用例。
- 边界：仅改词袋打分；**禁止**引入 embedding 模型 / 外部 LLM（P2 否决项）。
- 依赖：前置 无；被 T7 依赖。
- 提交：含 `T4`/`REQ-013`。

### T5 注入 source 标记 + 采集侧过滤（防御性）
- 目标：若自动注入启用，`recallPrelude.ts` 注入头带 source 标记；`sessionCollector.ts` 采集三处过滤（跳过 `plugin:` / `source.kind`、剥离 `<memory-context>`）。当前不自动注入，先买保险。
- 输入：`recallPrelude.ts`、`sessionCollector.ts`、对比报告 §2 防回灌三处切断 / §4 P0#5。
- 输出：修改上述文件加 source 标记与过滤；单测断言过滤生效。
- 验收：`npm test -- recallPrelude`（三处过滤用例 + source 标记携带）。
- 边界：仅改采集/注入侧；**不得改写** `display.markdown` 回显铁律（`AGENTS.md:74`）。
- 依赖：前置 无；被 T7 依赖。
- 提交：含 `T5`/`REQ-013`。

### T6 异步真实状态驱动 UI
- 目标：监控/审计页按 operation id 轮询真实状态、409「排队中」不算失败、定期对账，复用 `audit.jsonl`。
- 输入：`audit.jsonl`（`auditLog.ts`）、监控/审计页组件、对比报告 §4 P0#3。
- 输出：修改对应 Web 组件 + 状态轮询逻辑；单测/组件测试。
- 验收：`npm test -- <监控组件>`（409 语义 + 状态机）；组件测试。
- 边界：仅改监控/审计展示与轮询；不动审计落盘。
- 依赖：前置 无；被 T7 依赖。
- 提交：含 `T6`/`REQ-013`。

### T7 文档同步 + 重建索引 + 门禁
- 目标：更新相关文档（若涉及 `recall-echo-contract` / `AGENTS` / `STATE`）、重建代码索引、跑全门禁。
- 输入：本规格、各 T 产物、`tools/code-index.mjs`、`validate_project.py`。
- 输出：`meta/index.md` 登记本规格（若未登记）、code-index 重建、`validate` 绿。
- 验收：`node tools/code-index.mjs --check` 绿 + `python tools/validate_project.py` 绿 + `npm run verify:fast` 绿。
- 边界：仅文档/索引；不新增运行时逻辑。
- 依赖：前置 T1–T6。
- 提交：含 `T7`/`REQ-013`。

## 3. 依赖 DAG

```
T1 ──▶ T2
T3 ──▶ T7
T4 ──▶ T7
T5 ──▶ T7
T6 ──▶ T7
```
T1→T2 有先后；T3/T4/T5/T6 相互独立、可并行；T7 汇总全部。

## 4. 三道闸门计划（每步收尾）

- **A · 影响面回归**：每个 T 改完跑 `npm run typecheck` / `lint` / `test:gate` / `python tools/validate_project.py` / `npm run code:index:check`；C1/C2/C3 反向断言证明 `recallModes.ts` 与「pending ≠ 成功」语义未变。
- **B · 效果验证**：每条 AC 一条正向端端用例；真实跑一次带时间词的 recall，核对时间窗加权；同内容重发核对幂等；标识符权重核对命中率提升。
- **C · 变异验证**：至少一次代码级变异（如临时关掉时间窗加权 → A2 用例红灯 → 还原复绿；临时去掉三处采集过滤 → A5 用例红灯 → 还原复绿）。

T1 为纯文档与函数（无 UI 改动）→ B/C 以单测覆盖；其余 T 均有运行时改动 → A/B/C 三栏全跑。

## 5. 风险与待确认

| 项 | 说明 |
|---|---|
| 路径真实性 | `src/shared/`、`src/core/memagent/` 下具体文件名以实施时实际树为准（本文按对比报告引用路径，落地前用 Glob 复核） |
| 与现有档位冲突 | C1 必须作为打分修正项而非第 6 模式，否则破坏 `recallModes.ts` 单一真源（已有测试锁） |
| 回显铁律 | C4 的 source 标记只能落在注入头/采集侧，不得改写 `display.markdown`（须用户显式批准才动回显文案） |
| 在途改动 | 工作区有 18 个非本轮产生的未提交改动，提交时须逐文件挑选，不得 `git add .` |
| P1 未纳入 | 原文回拼/免责头/长轮询状态卡 3 项留作后续单独提案，不混进本 REQ |
