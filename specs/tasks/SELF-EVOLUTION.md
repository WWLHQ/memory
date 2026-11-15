---
title: 自我进化 · 可验证的自动生长（M0–M5）
date: 2026-11-14
status: done（M0–M5 全部落地，AC 见 §4–§8）
scope: 效果可感知 / 频率可配 / 采样与回滚可配 / 召回权重可验证自动采纳
---

# 自我进化 · 可验证的自动生长（M0–M5）

> **来源**：2026-11-14 源码静态审查 + 用户五轮确认（频率可改 → 可感知好坏 → 可验证自动进化 → 采样/回滚可配 → 最小样本开放 + M0 一次做完设置卡）。
>
> **与既有文档的关系**：[`GROWTH-AGENT-EVOLUTION.md`](GROWTH-AGENT-EVOLUTION.md)（批次61 GAP-1/2/3）已经落地「召回权重可被配置消费」「反馈可降档」「双向可观测」。
> 本文**不重复** GAP-1/2/3，只补它明确留下的那段：**读取期参数只能产建议、不能验证、不能自动采纳**，
> 以及用户侧完全缺失的两件事：**看得懂好坏**、**调得了节奏**。
>
> **红线**：默认配置下，系统行为必须与本文落地前**逐字一致**（`mode='suggest'`、缺省值 = 现有常量）。

## 0. 现状诊断（现查现证）

| 链路 | 现状 | 缺口 | 证据 |
|---|---|---|---|
| 写入期判重 | 周日 cron 跑真实回归，达 F1 门槛自动写 `growth:v1` | 已闭环 ✓ | `main.ts:3779-3805`、`regression.ts:415-424` |
| 读取期召回权重 | 只产建议（`applied:false`），且是**启发式规则**不是评估最优 | **无评估、无采纳、无回滚** | `regression.ts:101-124`、`:396-404` |
| 召回审计 | 只落 `mems: [mem_id]` | **无 per-hit 四分量 → 无法离线重算** | `agent.ts:433` |
| 打分黑盒 | `scoreMemory` 内部算 f/imp/conf/boost 后即丢 | 分量拿不到，埋点与重算都无从下手 | `forgetting.ts:59-70` |
| 反馈归因 | `feedback` 只收 `mem_id` + `verdict` | **无 `recall_id` → 标签无法配对** | `mcpManageTools.ts:133-139` |
| 效果展示 | `Δ +{delta}` 恒加号、恒绿色 | **变坏也显示成"+"和绿色** | `GrowthPanels.tsx:206-208` |
| Δ 口径 | `gain ?? deltaBeforeOf(a)` | 同一曲线混两种语义，点间不可比 | `useGrowthReal.ts:172` |
| 调度 | `expr` 硬编码常量；配置只有布尔开关 | **周期/时刻不可改**；页面文案却写"时刻可配" | `growthConfig.ts:94-99`、`GrowthPanels.tsx:312` vs `317-327` |
| 调度消费点 | `task.expr` 被 **两处** 使用：bootstrap 反推、运行推进 | 只改一处 → 重启后按旧表达式算下次到期 | `main.ts:3829-3842`、`:3855`、`:3894`、`:3899` |
| 评估窗口 | 判重 30 天 / 召回 7 天，**两套硬编码且不一致** | 用户不可调 | `regression.ts:27`、`:38` |

**一句话结论**：自动闭环只存在于写入期；读取期连"验证"这一步都没有，"感知好坏"在 UI 上还是错的，节奏还不可调。

## 1. 目标闭环（可验证 = 能算、能比、能撤）

```
观测（per-hit 分量入库） → 配对（反馈归因到召回） → 离线重算（只换权重）
   → 判定（提升 + 显著 + 护栏） → 采纳（原子写 + 版本） → 回诊 → 不达标自动回滚
```

**可验证性的三个硬要求**（缺一即不成立）：

1. **同批数据**：必须用**同一批召回的同一组 `relevance`/四分量**重算，禁止重跑向量检索。理由是重跑时候选集已变（新记忆入库、旧记忆衰减），那叫"重新测量"，不叫"配对比较"。
2. **同一判据**：主指标 NDCG@topK；护栏 reject_ratio、evidence_thin_ratio。
3. **显著性**：配对符号检验（sign test），`p ≤ 0.10`。**没有显著性检验，+0.02 可能纯是噪音**。

### 1.1 判定门槛（常量，不开放配置）

| 项 | 值 | 说明 |
|---|---|---|
| `MIN_NDCG_GAIN` | 0.02 | 与判重 `MIN_F1_GAIN` 同口径 |
| `MAX_GUARD_RISE` | 0.02 | reject_ratio / evidence_thin_ratio 各不升超此值 |
| `SIGN_TEST_P` | 0.10 | 双侧二项检验 |
| `MIN_ROLLBACK_DROP` | 0.03 | 回诊跌破即回滚（可配，见 §2） |

### 1.2 标签分级（解决 confirm/reject 稀疏）

| 级别 | 来源 | 权重 | 现状 |
|---|---|---|---|
| 强 | `feedback` confirm / reject | 1.0 | 有，稀疏 |
| 中 | `disputed` | 0.5（负） | 有 |
| 弱 | 召回后该记忆被 `grafted` 复用 | 0.5（正） | 可从写入审计推 |
| 弱 | 该次召回 `evidence_thin=true` | 0.5（负） | 已有字段 |
| 无 | 未被反馈 | 中性 0 | — |

**纪律**：弱标签只能**单独评估**，禁止与强标签混算成一个 NDCG（混算等于用猜测冒充用户判断）。

## 2. 配置真源（`shared/growthConfig.ts` 扩展）

新增 `GrowthConfig.evolution`，**缺省值 = 现有常量**，旧账本读出来行为逐字不变。

```ts
export type EvolutionMode = 'off' | 'suggest' | 'auto';

export interface EvolutionConfig {
  mode: EvolutionMode;                    // 'suggest'（auto 需显式开启 + 二次确认）
  window: { dedup_days: number; recall_days: number };        // 30 / 7
  sample_top_n: number;                                        // 20（10–50）
  min_samples: {
    dedup_total: number;                  // 40
    dedup_negatives: number;              // 10
    recall_count: number;                 // 30
    recall_tagged: number;                // 10
  };
  rollback: { after_days: number; min_recalls: number; max_drop: number };  // 7 / 20 / 0.03
  guard: { cooldown_days: number; max_step: number; max_drift: number };    // 7 / 0.05 / 0.15
}
```

### 2.1 取值范围与校验

| 字段 | 范围 | 越界后果 |
|---|---|---|
| `mode` | 三枚举 | 非法 → **回退 `suggest`**（绝不回退 `auto`） |
| `window.dedup_days` | 1–180 | 整块回退默认 |
| `window.recall_days` | 1–90 | 同上 |
| `sample_top_n` | 10–50 | 同上（上限控审计体积） |
| `min_samples.*` | 1–10000 整数 | 同上 |
| `rollback.after_days` | 1–90 | 同上 |
| `rollback.min_recalls` | 0–10000 | 同上（0 = 只看天数） |
| `rollback.max_drop` | 0.01–0.20 | 同上 |
| `guard.cooldown_days` | 1–90 | 同上 |
| `guard.max_step` | 0.01–0.20 | 同上 |
| `guard.max_drift` | 0.05–0.50 | 同上 |

复用现有纪律：**任一字段非法 → 整块回退默认，不按比例修正**。

### 2.2 生效时机（最容易出 bug 的一张表）

| 字段 | 生效时机 | 对在途任务 |
|---|---|---|
| `sample_top_n` | 下一次召回 | 无（历史埋点条数不变） |
| `window.*` | 下一次评估 | 无（评估时现算） |
| `min_samples.*` | 下一次评估 | 无 |
| `rollback.*` | **采纳时刻算死**（写入 `growth_op.rollback_plan`） | 已采纳按原计划回诊，不跟改 |
| `guard.*` / `mode` | 下一轮进化 | 无 |

**为什么 `rollback.*` 必须算死**：若跟着配置走，会出现「已过 10 天、用户改成 14 天 → 任务又变回未到期」，历史计划被篡改、审计不可回放。
代价是改完要干等 → UI 必须提供**「立即回诊」**按钮作为覆盖手段。

### 2.3 三个必须提示的用户陷阱

1. **窗口可配但最小样本不匹配** → 窗口设 1 天几乎永远凑不满 40 条，长期 `insufficient`。
2. **`after_days=1` + `min_recalls=0`** → 次日就回诊、标签未积累，极易误回滚（给红色警告，不阻止）。
3. **`sample_top_n=50` + 高频召回** → 审计增量可达数百 MB/年（需轮转）。

### 2.4 配置可行性预测（M0 必做）

配完即算，不等一个月才发现永不生效：

> 按当前设置（30 天窗 / 最小 40 条）：近 30 天可采样本 12 条 → **预计还需约 100 天**首次进化。

纯用现有审计即可算，不依赖新埋点。

## 3. 阶段总表

| 阶段 | 目标 | 主要文件 | 依赖 |
|---|---|---|---|
| **M0** | 看得懂 + 调得了：Δ 判定修正、效果结论卡、参数差异表、**进化设置卡（频率+窗口+采样+回滚+最小样本+可行性预测）** | `GrowthPanels.tsx`、`GrowthPage.tsx`、`useGrowthReal.ts`、`growthConfig.ts`、`main.ts` | 无 |
| **M1** | 让验证有米：`scoreParts` 拆分、per-hit 分量埋点、**feedback↔recall 归因** | `forgetting.ts`、`agent.ts`、`mcpManageTools.ts`、`mcpSchema.ts` | M0 |
| **M2** | 能验证：NDCG 离线重算、符号检验、影响面换算 | `core/memagent/evolution/recallEval.ts`（新增） | M1 |
| **M3** | 可自动：进化轮循环、护栏、版本化、自动回滚 | `evolution/*`、`paramsSnapshot.ts`、`main.ts` | M2 |
| **M4** | 收尾：进化时间线、漂移仪表、文档与索引 | `GrowthPage.tsx`、`specs/` | M3 |
| **M5** | 可手动验证 + 多族统一：审计补 reason、页面手动跑一轮、回诊三态、判重族版本化与回诊 | `evolution/loop.ts`、`evolution/registry.ts`、`regression.ts`、`web/growth/*`、`electron/main.ts` | M4 |

## 4. M0 —— 看得懂 + 调得了（零算法风险）

### 4.1 改动点

1. **修 Δ 判定**：符号按值取（`+`/`−`）、颜色按方向（`ok`/`danger`）、口径分字段（`f1_gain` 与 `hit_rate_delta` 不再混用 `delta`）。
2. **效果结论卡**：改善 / 恶化 / 持平 / 数据不足 四态；带 before→after、样本量、判据、时间、历史徽标串。
3. **参数差异表**：逐参数列出 before/after/变化/影响面，**未变项也列出并写原因**（`llm_judge` 固定不参与、某层样本 <5 未调）。
4. **进化设置卡**：频率（周期+时刻）+ 窗口 + 采样条数 + 回滚天数/最少召回 + 最小样本（高级折叠）+ 可行性预测 + 审计体积估算。
5. **`schedule_exprs` 配置**：主进程两处 `task.expr` 统一走 `resolveScheduleExpr(task, cfg)`。

### 4.2 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| M0-1 | Δ 为负时显示 `−` 号且用 danger 色；为 0 显示中性 | 三组固定值渲染断言 |
| M0-2 | 结论卡四态互斥：样本不足显示"数据不足 + 还需 N 条"，不显示"持平" | 四组输入各断一次 |
| M0-3 | 参数差异表必须包含未变项，且每项有原因文案 | 固定配置 diff 快照 |
| M0-4 | 修改 `schedule_exprs` 后，主进程 60s 内按新表达式调度，且重启后 `next_due` 不被旧 `detail.expr` 污染 | 改 expr → 等 tick → 断审计 `expr` 字段；重启后断 `next_due_at` |
| M0-5 | 非法 cron / 越界数值 → 整块回退默认，页面显示"已回退默认"而非静默接受 | 参数变异矩阵 |
| M0-6 | 频率设为 `* * * * *` 等过密值 → 拒绝并提示最短间隔（非 decay ≥15 分钟） | 边界用例 |
| M0-7 | 可行性预测的数字与实际审计条数逐条对得上，不估算 | 固定审计样本手算比对 |
| M0-8 | 默认配置下，`growth:v1` 缺 `evolution` 时所有页面与调度行为与改造前逐字一致 | 旧账本快照回归 |

**不变项（反向断言）**：`weight_tuned` 审计字段、四态 `regressionStatusText` 文案、`get_write_status` 语义、召回结果（M0 不动打分）。

**风险**：`schedule_exprs` 改变调度时刻 → 用户可能把衰减（`decay`，不可停）也改密，需对 `required` 任务单独限制。

## 5. M1 —— 让验证有米（埋点 + 归因）

### 5.1 改动点

1. **拆分打分函数**（行为逐位不变）：

```ts
scoreParts(m, now)                        // → { f, imp, conf, boost }
scoreFromParts(relevance, parts, w, pinned)  // → score
scoreMemory(m, relevance, now, w) = scoreFromParts(relevance, scoreParts(m, now), w, m.pinned)
```

2. **per-hit 分量埋点**：`recall` 审计增 `mems_detail`，紧凑数组，按 `sample_top_n` 截断：

```
mems_detail: [["mem_x", 0.83, 0.71, 0.5, 0.6, 0.30], ...]
              id        rel    f   imp conf  boost
```

3. **反馈归因**：`feedback` 工具增可选 `recall_id`；不传则按"最近同 `mem_id` 的 recall"关联，关联不到只做降档，**绝不冒充标签**。新审计 `recall_feedback: { recall_id, mem_id, verdict, ts }`。

### 5.2 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| M1-1 | `scoreParts` + `scoreFromParts` 重建的分数与拆分前 `scoreMemory` **逐位相同**（全量既有用例 + 随机样本 1000 例） | 快照 + 属性测试 |
| M1-2 | `mems_detail` 条数 = `min(topK, sample_top_n)`，字段顺序固定，数值精度 3 位 | 边界 topK=3/20/50 |
| M1-3 | 带 `recall_id` 的 feedback 落 `recall_feedback`；不带的仍只改 confidence，行为与改造前一致 | 两组对照 |
| M1-4 | 关联不到 recall 时**不写** `recall_feedback`，只记 `linked:false` | 陈年 mem_id 用例 |
| M1-5 | 旧审计无 `mems_detail` → 评估侧如实跳过，不回填、不推断 | 混合样本 |
| M1-6 | 审计体积：`sample_top_n=50` 单次 ≤ 4KB | 实测断言 |

**不变项**：`scoreMemory` 对外签名与调用点、`Hit` 字段契约、回显四段数字、3000t 熔断。

**风险**：拆分函数若漏传 `pinned`，`+0.15` 加分丢失 → 由 M1-1 的逐位断言兜住。

## 6. M2 —— 能验证（离线评估）

### 6.1 改动点

1. `evolution/recallEval.ts`：按 `mems_detail` 重算两套权重下的 NDCG@topK。
2. 配对符号检验：m 次改善 / k 次变差 → `Binomial(m+k, 0.5)` 双侧 p。
3. 影响面换算：本次变更会让多少条已有记忆的排序位次变化 / 判重结论翻转。

### 6.2 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| M2-1 | 对同一批 `mems_detail`，`from`/`to` 重算的排序差异可手算复现 | 构造 5 条已知分量样本 |
| M2-2 | 样本 < `min_samples` → `insufficient`，**不给建议**，页面显示"还需 N 条" | 边界用例 |
| M2-3 | 提升 0.019 → 不采纳；0.021 但 p=0.4 → 不采纳 | 两组构造 |
| M2-4 | 护栏（reject_ratio / evidence_thin_ratio）上升 >0.02 → 一票否决 | 构造恶化样本 |
| M2-5 | 弱标签单独评估，不参与强标签 NDCG | 混合标签用例 |
| M2-6 | 评估不做任何写入（只读审计 + 只产 `growth_op`） | 审计条数前后比对 |

**风险**：只能在 `sample_top_n` 内重排，第 N 名外换榜不可知 → 结论必须标注「在 top N 内评估」。

## 7. M3 —— 可自动（护栏 + 回滚）

### 7.1 改动点

1. `evolution/registry.ts`：参数族注册（`dedup_weights` / `dedup_thresholds` / `recall_weights` / `feedback_policy`），每族 `propose` / `guard` / `apply`。
2. `evolution/loop.ts`：统一进化轮，决策五态 `adopted|rejected|insufficient|guarded|rolled_back`。
3. **版本化**：`saveGrowthConfigToLedger` 前把上一版存 `growth:v1:history:<ts>`；新增 `rollbackGrowthConfig()`。
4. **回诊**：采纳时写死 `rollback_plan { due_at, min_recalls, max_drop, baseline }`；到期重算，跌破即回滚（仅 `auto`）。
5. **调度**：`main.ts:3779` 扩为「判重回归 → 召回评估轮 → 反馈策略评估轮」，分族记录。

### 7.2 字段级 AC / TC

| AC | 断言 | TC |
|---|---|---|
| M3-1 | `mode='suggest'`（默认）下**绝不写** `growth:v1`，只落建议审计 | 审计 + 配置快照双向断言 |
| M3-2 | `mode='auto'` 且达门槛 → 真写配置，且 `history` 留上一版 | 配置前后 + history 断言 |
| M3-3 | 单次步长 > `max_step` 或累计漂移 > `max_drift` → `guarded`，不写 | 边界构造 |
| M3-4 | 冷却期内同族不重复自动调整 | 连跑两轮断言 |
| M3-5 | 回诊跌破 `max_drop` → 自动回滚到上一版，配置与历史逐字一致 | 端到端采纳→恶化→回滚 |
| M3-6 | 回诊参数按采纳时算死：改配置不影响在途任务 | 改 `after_days` 后断在途 `due_at` 不变 |
| M3-7 | 回滚可被用户「立即回诊」提前触发 | 手动触发用例 |
| M3-8 | `mode='off'` → 连建议都不产 | 审计为空断言 |

**风险**：自动采纳会覆盖用户手动调参 → 需记录"手动覆盖"，手动后暂停该族自动 N 天。

## 8. M4 —— 收尾（时间线 + 文档）

1. 进化时间线：每次进化一行（时间 / 族 / from→to / 指标 / 决策 / 原因 / 回滚点）。
2. 漂移仪表：各参数族距基准的累计漂移。
3. 更新 `specs/code-map.md`、重建 `code-index.generated.md`、`meta/index.md` 登记本文。

| AC | 断言 |
|---|---|
| M4-1 | 时间线每条都能在审计里逐条对上，不补零 |
| M4-2 | 空账本显示"暂无进化记录"，不显示 0 |
| M4-3 | 漂移仪表数值 = 当前配置 vs 基准配置的实际差 |

### 8.1 已落地（2026-11-14）

| 件 | 位置 | 说明 |
|---|---|---|
| 时间线数据层 | `web/growth/evolutionTimeline.ts` | `evolutionTimelineFromLedger` 纯投影：只认 M3 的扁平 `detail.event`，跳过旧式 `detail.entry`（交既有 `growthAudit`，不双份）；`suggest_recall_weights` 的裁决取 `detail.status`（`suggested`/`insufficient`/`rejected`），事件名只作兜底 |
| 漂移仪表数据层 | 同上 `driftRows` / `recallDrift` / `dedupDrift` / `thresholdDrift` | `drift = 当前 − 基准`（真实差，不归一化）；缺键按基准值而非 0 |
| 展示卡 | `web/growth/EvolutionTimelineCard.tsx` | 挂在「回归评估」页签（`DeltaPanel` 之后）；每行带 `request_id` 可回查；空账本显「暂无进化记录」不出表；审计没带的字段写明缺什么（P02 门禁禁止用「—」冒充读数） |
| 接线 | `web/growth/useGrowthReal.ts`（`RealGrowth.evolutionTimeline`）、`web/growth/GrowthPage.tsx` | 与其它指标读同一份审计快照 |
| 测试 | `__tests__/evolutionTimeline.test.ts`（8 例）、`__tests__/evolutionTimelineCard.test.tsx`（3 例） | 覆盖 M4-1/2/3；变异验证 4 组均「红灯 → 还原 → 复绿」 |

> **M5 已定义（2026-11-14 用户确认，见 §8.2）**：原总表止于 M4；M5 由用户显式拍板纳入「审计可解释 + 手动可验证 + 回诊三态 + 判重族版本化统一」四项，四条 AC 见 §8.2。

### 8.2 M5 —— 可手动验证 + 多族统一（2026-11-14 用户确认全做）

现状缺口（现查现证）：

| 缺口 | 证据 | 后果 |
|---|---|---|
| 审计不可解释 | `evolution/loop.ts` 的 `insufficient`/`not_adopted` 只写 `metrics`；`rolled_back` 只写 `plan`/`drop` | 时间线这些行只能显示「本条审计未写原因」，reason 留在返回值里丢了 |
| 无法手动验证 | `src/web/growth` 全目录无 `runEvolutionRound`/`runRollbackCheck` 调用 | 只能等 cron（周日 03:00），想「现在就验一次」没入口 |
| 回诊点无状态 | `rollback_plan.due_at` 只有裸时间戳 | 看不出「未到期 / 已过期没跑 / 已回诊」 |
| 版本化只覆盖一半 | `regression.ts` 采纳走 `saveGrowthConfigToLedger`，未走 `saveConfigWithHistory` | 判重权重没有历史版本，M3 的回滚只对召回权重生效 |

| AC | 断言 |
|---|---|
| M5-1 | 进化轮产出的每条 `growth_op`（insufficient / not_adopted / suggest_recall_weights / guarded / adopted / rolled_back / rollback_kept）都带**非空 reason**；`feedback_policy` 族每轮也落一条审计（说明为何没动）；`mode='off'` 仍零审计 |
| M5-2 | 页面手动触发 → 账本新增对应 `growth_op`（request_id 可回查）；无样本时如实显示「还需 N 次召回」；`mode='off'` 手动触发零审计且明确提示已关闭 |
| M5-3 | 带 `rollback_plan` 的记录给出三态 `pending`/`overdue`/`done`（`done` = 该计划之后已有 `rolled_back` 或 `rollback_kept`）；无 plan → `none` 且页面写「无回诊计划」，不显示 0 天 |
| M5-4 | 判重采纳后存在 `growth:v1:history:<ulid>` 且可逐字还原采纳前 `weights`/`thresholds`；采纳审计带 `rollback_plan`（family=`dedup_weights`、`baseline_test_f1`、`due_at` 采纳时算死）；到期且样本够时重算当前配置 test F1，跌破 `baseline−max_drop` → 回滚并写 `growth_op.rolled_back`（带跌幅），未跌破 → 写 `rollback_kept` |

> **红线不变**：默认 `mode='suggest'`；`off` 零审计；所有回诊/回滚只用唯一写入口 `saveGrowthConfigToLedger`；判重回诊的结论只对评估窗口负责（样本集本身在变）。

### 8.3 M5 已落地（2026-11-14）

| AC | 落地位置 | 关键实现 |
|---|---|---|
| M5-1 | `evolution/loop.ts` | `appendGrowthOp` 类型强制 `phase` + 非空 `reason`；insufficient 带真实计数与 `need`（`样本不足：5/30 次召回（还需 25 次）`）；guarded/adopted 用 `guard.reason`/`eval.reason`；`rolled_back`/`rollback_kept` 带跌幅与允许值；**新增 `rollback_kept` 事件**（回诊通过也留痕）；`feedback_policy` 族每轮落一条（request_id 带 `_fb` 后缀避免同轮撞号；后缀只允许 `[A-Za-z0-9_-]`，见 §8.4） |
| M5-2 | `web/growth/coreGrowth.ts#coreRunEvolution`、`EvolutionTimelineCard`（按钮）、`GrowthPage` | 与 cron 同一函数；回执 = 真实 `added`（前后计数差）+ 召回决策 + 回诊状态；`mode=off` → 零审计并明示「进化已关闭」（`runRollbackCheck` 也加了 off 短路，文案同步改 `EvolutionSettingsCard.modeHint`） |
| M5-3 | `web/growth/evolutionTimeline.ts#rollbackStateOf` + 卡片「回诊点」列 | 四态 none/pending(剩余天数)/overdue/done；done = 该族之后出现 `rolled_back` 或 `rollback_kept`；回诊阶段但样本不足不算 done；回诊审计的 `plan` 字段也读 `due_at` |
| M5-4 | `regression.ts`（采纳改走 `saveConfigWithHistory` + 写死 `rollback_plan`）、`runDedupRollbackCheck`（在 `evolution/loop.ts`）、`electron/main.ts` | 判重采纳前存 `growth:v1:history:<ulid>`；计划 `family='dedup_weights'`、基线 = 采纳时测试集 F1、`due_at` 采纳时算死；到期且窗口样本 ≥ `min_samples` 时用**当前**权重/阈值重算测试集 F1，跌破 `baseline−max_drop` → 回滚到上一版并写 `growth_op.rolled_back`，未跌破写 `rollback_kept` |

**测试与变异**：`__tests__/dedupRollback.test.ts`（8 例）、`evolutionLoop.test.ts` 追加 6 例、`__tests__/evolutionRun.test.tsx`（4 例）、`evolutionTimeline.test.ts` 追加 7 例、`evolutionTimelineCard.test.tsx` 追加 1 例。变异 6 组（reason 置空 / 去 `due_at` 完成判定 / 去 off 短路 / `dedupDropExceeded` 恒 false / 版本化不落历史 / `detail.entry` 跳过）均「红灯 → 还原 → 复绿」。

**已知边界（M5 新增）**：
1. 同一轮进化会写多条 `growth_op`（recall 族 + feedback_policy 族），因此 feedback 族用 `requestId_fb`，审计页按 `request_id` 精确查只会命中其中一条，按前缀查可看全轮。
2. 判重回诊复用**同一个确定性划分 + 同一窗口**，但窗口样本本身会随写入变化，所以「F1 下跌」可能来自样本漂移而非参数变差——结论只对窗口负责，这一点不隐藏。
3. `mode=off` 现在是完全静默（进化轮与回诊都不写审计），因此关闭期间不会有任何「回诊通过/未通过」记录，时间线上该计划的回诊点会停留为 overdue。

### 8.4 真机事故与修复：手动触发报「内核暂不可达」（2026-11-14）

**现象**：桌面壳里点「⚡ 手动跑一轮进化」，toast 报「手动进化触发失败：内核暂不可达」，时间线无新增。

**取证**：`%APPDATA%/MultiAgent Memory/audit.jsonl` 里三条 `evo_*` 审计**都写成功了**，但每轮只有 **1 条** `growth_op`（`event=suggest_recall_weights`），而 `runEvolutionRound` 末尾无条件再写 1 条 `feedback_policy`。→ 抛出点在**第二条 append**。

**真因**：`appendGrowthOp` 给 feedback 族拼的是 `${requestId}#fb`，而 `shared/auditShape.ts#validateAuditRecord` 只放行 `^[A-Za-z0-9_-]{1,64}$`。主进程 `IPC.storageAppendAudit` 与 home 数据面都调它 → 整条拒收 → 进化轮抛错 → 页面裸 `catch` 兜成统一文案。

**为什么会「测试全绿」**：单测走 `InMemoryStorage`，其 `appendAudit` 不做形状校验；主进程才校验。缝隙就在这里，不是偶发。

**修复（三层，缺一不可）**：
1. 后缀改为 `_fb`（合法字符集内）。
2. `appendGrowthOp` 内**同源**过一遍 `validateAuditRecord`，非法即抛带 `family`/`request_id` 的可读原因——以后任何新后缀都不会再退化成「内核暂不可达」。
3. `GrowthPage.handleRunEvolution` 的裸 `catch` 改为 `手动进化触发失败：${errText(e)}`，失败回执带真因（M5-2 诚实边界延伸）。

**回归闸门**：`evolutionLoop.test.ts` 新增「本轮所有 growth_op 的 request_id 都过主进程同源形状闸门」，用与主进程**同一份** `validateAuditRecord` 校验，堵住「InMemory 不校验」的缝隙；原 `run_fb#fb` 断言（把 bug 当契约）一并纠正为 `run_fb_fb`。
变异 2 组：`_fb`→`#fb`（自检层红，9 例失败）／关掉自检但保留 `#fb`（测试断言层红，1 例失败），均「还原 → 复绿」。

### 8.5 真机事故与修复：Δ 卡把"当前命中率"当成"改善量"（2026-11-14）

**现象**：回归评估页「自生长收益」卡显示绿色 `Δ +0.942 · 本次自生长改善了效果`，同一张卡下方却写着「暂无真实自生长调参记录（weight_tuned）」——自相矛盾。

**取证**：账本 `hit_rate` = 278/295 = **0.942**；`weight_tuned` 记录 = **0 条**。

**真因**：`GrowthPage` 里 `deltaBefore = lastTuned ? extractDeltaBefore(...) : 0`，无调参记录时基线落 **0**，随后 `growthDelta(0, hit_rate)` 把"当前命中率"当成了"相对基线的提升"，再被 M0-3 的方向判定渲染成绿色「改善了效果」。**没有基线却印了改善量**，违反 §10 诚实边界。

**修复（三层）**：
1. `DeltaMetric` 增 `'none'`（无基线），`GrowthPage` 在「无采纳记录 + 无 weight_tuned」时置 `'none'`，且 `delta` 返回 0 不再拿命中率充数。
2. `DeltaPanel` 收到 `none` → 数值渲染为 **`Δ 无基线`**（灰、`data-dir="none"`，不印任何数字），结论文案「无对比基线：还没有过一次真实调参（weight_tuned），谈不上改善」，并用新增的 `currentHitRate` prop 明说「当前命中率 94.2% 是现状，不是改善量」。
3. 不用「—」占位（P02 禁「—」冒充读数），统一用文字「无基线」+ 原因。

**回归闸门**：`deltaPanel.test.tsx` 增 2 例（有命中率／拿不到命中率两种）；`GrowthPage.test.tsx` 增 1 例（冷启动 `data-dir="none"` 且不出现「改善了效果」）。
变异 2 组：无基线退回 `hitrate_delta`（页面用例红 `expected 'flat' to be 'none'`）／`DeltaPanel` 忽略 `noBaseline`（单元用例红 `expected 'Δ +0.942' to contain '无基线'`），均「还原 → 复绿」。

**遗留诚实边界**：Δ 卡读的是全量 `recall` 的命中率（`hits>0` 占比），而召回建议读的是 7 日窗口——两者口径不同，页面上已分别用 `metricLabel` 标注，不做统一（统一会让"改善量"与"建议依据"再次混为一谈）。

### 8.6 UI 铁律：原始 JSON 禁止上屏，整页换人话（2026-11-14 用户明确）

**用户原话**：「原始 JSON 禁止输出到 UI 渲染，整个页面要换成人话通过 UI 渲染显示出来。」

**现象**：`DeltaPanel` 的审计回放区把账本 `payload` 原文（`{"suggestion":{"from":{"w_f":0.35,…}}}`）直接渲染成一坨 JSON，
用户看不出「窗口几天 / 召回几次 / 哪维权重动了」。

**改法（四层，都只动展示层，账本契约与数据层一行未改）**：

| 层 | 位置 | 改法 |
|---|---|---|
| 中文维度名（唯一一份） | 新增 `web/growth/recallLabels.ts` | `w_f/w_i/w_c/w_a → 新鲜度/重要性/置信度/访问热度` + `fmtRecallWeights()`；`GrowthPanels`、`EvolutionTimelineCard` 共用，杜绝两套词表 |
| 审计回放人话 | `GrowthPanels.tsx#suggestionAuditOf/suggestionText` | 一句中文：`召回权重建议（仅建议，未改动配置）：最近 7 天 185 次召回里有 111 次（60.0%）证据不足 → 重要性 0.30 → 0.35（+0.05）；置信度、访问热度不变。`；缺字段写「未记进审计」，不补 0 |
| 事件名中文 + 回查能力 | 同上 `GROWTH_EVENT_LABEL`、`GrowthAuditEntry.requestId` | 事件名译中文（未登记 → 「未登记的审计事件」），元信息只留「审计 ID + 时间」；**payload 完全不进 DOM**，回查改靠 `request_id`（`useGrowthReal` 从账本补进 entry） |
| 时间线/设置卡去术语 | `EvolutionTimelineCard.tsx`、`EvolutionSettingsCard.tsx` | 权重差异出中文名；指标改「排序质量提升 +0.031（NDCG） · 显著性 p=0.043 · 基于 34 次召回」；漂移表去掉 `（w_f）`；下拉选项出中文而非 `off/suggest/auto` |

**红线**：① 任何 `payload`/`JSON.stringify` 结果不得进 JSX 文本；② 不得为「排查方便」留 `<details>` 展开原文（用户明确禁止）；
③ 不可翻译时如实写「没有可翻译的明细」，不把原文当兜底。

**回归闸门**：`deltaPanel.test.tsx` 增 5 例（建议摘要逐字段 / 缺指标不补零 / 事件名译中文 + 审计 ID / 账本未带 ID / 坏 payload 不吐原文，均断言整块审计区不含 `{`）；
`growthLoop.test.tsx` 改中文维度名断言 + 断言不出 `w_f`；`evolutionTimelineCard.test.tsx` 改中文名与中文指标断言；`GrowthPage.test.tsx` 回放用例改「权重调优已采纳」并断言不含 `weight_tuned`/`delta_before`。
变异 2 组：把 `{a.payload}` 放回元信息行 → 3 例红；`fmtWeights` 回退字段名口径 → 1 例红；均「原样还原 → 复绿」（SHA256 一致）。

## 9. 共同纪律

| 项 | 要求 |
|---|---|
| 三道闸门 | 每步收尾过 A 影响面回归 / B 效果验证 / C 变异验证（C 至少一次代码级变异：注入缺陷 → 指定用例红灯 → 原样还原 → 绿灯） |
| 门禁 | `typecheck` / `lint` / `test:gate` / `validate_project.py` / `generate.py --check` / `check:no-demo` / `code:index:check` |
| 索引 | 每步重建 `specs/code-index.generated.md`，`meta/index.md` 登记新文档 |
| 提交 | **每次 commit / push 前展示「改动清单 + 门禁输出 + 拟用提交信息」，等用户明确确认**；禁 `git add .`；不带入在途改动 |
| 交付闭环 | 有源码改动 → 关旧端 → 重打包 → 验产物 → 启新端 → 核运行态；**打包后停·等实测 → 再停·等确认** |
| 纯净度 | 收尾「跑验 → 扫 → 清 → 核 → 报」，清掉测试产物与临时脚本 |

## 10. 诚实边界（必须写进 UI）

1. **评估只在 top N 内**（N = `sample_top_n`），边界外换榜不可知，不吹成全局最优。
2. **历史召回无埋点**，只能从 M1 上线后积累；冷启动显示"还需 N 次召回"。
3. **标签稀疏是常态**，`insufficient` 会长期出现；必须显示缺多少，不显示"持平"。
4. **向量库自身在变**，同一条记忆的 relevance 会变，结论只对评估窗口负责。
5. **判重回归的目标函数是复现历史合并决策**，不是复现"正确决策"——它让参数拟合既有行为，不能自动纠正历史错误。
6. **召回权重此前从未被验证**：GAP-1 落地的建议是启发式规则，本文 M2 之前，任何"召回变好了"的说法都没有证据。
