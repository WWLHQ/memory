---
title: mode_dispatch 采纳后回诊计划 —— 分流命中率基线与回滚判据（方案）
date: 2026-11-26
status: implemented（2026-11-26 用户拍板后实施：判据C + 局部回退 + growth_evolve rollback 入口已通）
scope: 采纳后 N 天回看分流命中率是否变差 → 自动/建议回滚；仅 mode_dispatch 族
depends: 7.2 样本池读取侧（MODE-DISPATCH-EVOLUTION.md）；既有回诊框架（loop.ts#checkRollback / versioning.ts）
---

# mode_dispatch 回诊计划：分流命中率怎么算

> 本文回答「冷却期只挡重复提，不挡用了一阵变差」这个缺口。是**方案**，不是实现。

## 1. 问题定性：为什么需要回诊

`guard.cooldown_days=7` 只做一件事：采纳后 7 天内**不再提新建议**。它对「这次采纳本身是不是改坏了」完全沉默——采纳后第 8 天开始，无论分流命中率涨了还是跌了，现行实现都不会回头看。

现有回诊只覆盖两族：`recall_weights`（`checkRollback` 用 NDCG@20 + 配对符号检验）与 `dedup_weights`（`checkDedupRollback` 用测试集 F1）。`mode_dispatch` 采纳时不写 `rollback_plan`，回诊任务扫不到它。本方案补第三族。

## 2. 核心概念：分流命中率怎么定义

### 2.1 一句话

**分流命中率 = 用户认为「这次模式选对了」的比例**，分母只算能判定的分流反馈，不算「召回内容不对」和「其它」。

### 2.2 分子分母（关键，直接决定回诊会不会误报）

数据源：`mode_feedback` 审计，按 `request_id` 关联 `mode_dispatch`（沿用 `buildDispatchSamples` 的关联与去重口径，不新写第二套）。

| 反馈 | 计入 | 说明 |
|---|---|---|
| 👍 `verdict='up'` | 分子 +1，分母 +1 | 用户明确认为模式选对 |
| 👎 `reason='模式选错'` | 分母 +1（不计分子） | 唯一有效的分流负样本 |
| 👎 `reason='召回内容不对'` | **都不计** | 这是内容质量问题，不是分流问题；计入会冤枉词表 |
| 👎 `reason='其它'` / 无原因 | **都不计** | 无法判定，不猜 |
| 关联不到 `mode_dispatch` / 模式不可识别 | **都不计** | 没有分流事实就无法判定 |

**命中率 = positives / (positives + negatives)**，其中 positives/negatives 就是 `DispatchMetrics` 里那两个字段——**直接复用，不重算**。

### 2.3 为什么不能用「召回命中率」冒充

`growth-stat-hitrate`（`hit_rate`）数的是「召回结果有没有命中」，是**内容**维度；分流命中率数的是「模式选得对不对」，是**路由**维度。一次召回可以是"模式选对了但内容没命中"，也可以是"模式选错了但碰巧内容命中"。两者混用会让回诊改错东西。

## 3. 基线怎么算（采纳时刻算死）

沿用 `EvolutionRollback` 的既有纪律（§136 注释）：**计划写进采纳那条 `growth_op` 的 `detail.rollback_plan`，采纳时刻算死，不跟着配置走**。否则用户 7 天后把 `after_days` 从 7 改成 14，历史计划会被篡改、审计不可回放。

采纳时刻 T0：

```
before 窗口 = [T0 - dispatch_days, T0)   // 默认 30 天
before_tagged = positives + negatives（窗口内有效样本）
before_rate = positives / before_tagged
```

**基线不成立就不写回诊计划**（与 `recall_weights` 的「无 eval.meanTo 不挂计划」同口径）：

- `before_tagged < min_samples.dispatch_tagged`（默认 10）→ 不写 `rollback_plan`，如实记「基线样本不足未挂回诊」。
- 这是诚实行为：10 条以下算出的命中率方差太大，拿它当基线会让回诊变成掷骰子。

计划结构（写进 `growth_op.adopted(family='mode_dispatch').rollback_plan`）：

```ts
{
  family: 'mode_dispatch',
  due_at: T0 + rollback.after_days * DAY,   // 默认 7 天
  baseline_rate: before_rate,               // 采纳前命中率
  baseline_tagged: before_tagged,           // 基线样本数（回放用）
  min_tagged: min_samples.dispatch_tagged,  // 回诊最小样本（复用既有键）
  max_drop: <见 §4>,                        // 允许跌幅
  adopted_words_snapshot: <采纳后的整份快照> // 回诊时确认「还是这份配置」
}
```

## 4. 回诊触发判据（推荐）

到期日 `due_at` 到（或用户点「立即回诊」），取 after 窗口：

```
after 窗口 = [T0, T0 + rollback.after_days)  // 与 before 等长，避免窗口长度不同造成偏差
after_tagged / after_rate 同 §2.2 口径
drop = before_rate - after_rate
```

### 4.1 三态判定（与既有回诊同形）

| 状态 | 条件 | 动作 |
|---|---|---|
| `insufficient` | `after_tagged < min_tagged` | 不判涨跌，如实写「样本不足还需 N 条」，不动配置 |
| `kept` | `drop <= max_drop` | 命中率没显著变差，保留，写一条 `rollback_kept` 审计 |
| `rolled_back` | `drop > max_drop` **且**置信门槛通过 | 回滚到 `adopted_words_snapshot` 之前那份（`growth:v1:history`），写 `rolled_back` 审计 |

### 4.2 max_drop 与置信门槛——推荐值

这是本方案最需要拍板的地方。三个候选：

| 方案 | 判据 | 优点 | 缺点 |
|---|---|---|---|
| A 纯跌幅 | `drop > 0.05` | 简单 | 10 条样本下 1 条翻转 = 0.1，必然越过 0.05 → 频繁误回滚 |
| B 跌幅 + 配对符号检验 | `drop > 0.05` 且 `signTestP ≤ 0.10` | 与 `recallEval` 同源、统计严谨 | 需要逐样本配对；模式反馈是独立点击，配对对象难定义（同一 request_id 采纳前后各点一次几乎不存在） |
| **C 跌幅 + 最小净负样本数（推荐）** | `drop > 0.10` 且 `negatives_after − negatives_before ≥ 3` | 样本量小时用「绝对条数」兜底，抗单条翻转；口径与 `DispatchMetrics` 同源，零新概念 | 不是严格统计检验，是工程保守阈值 |

**推荐 C**，理由：
1. 样本门槛 10 条时命中率的最小分辨率是 0.1（1/10），把 `max_drop` 定在 0.10 以下等于让单条反馈就能触发回滚，是伪精确。
2. B 的配对检验在本场景没有天然配对单位——`recall_weights` 能配对是因为同一批 `mems_detail` 用两套权重重排；分流采纳前后是**不同时间、不同请求**，没有同批数据可配。硬凑配对就是伪造证据（与本项目「能编造的证据都不算证据」铁律冲突）。
3. `min_tagged` 已有 10 条门槛，再叠 `negatives` 净增 ≥3，等于要求「至少多 3 个用户明确说模式选错」，足够抗抖动。

**默认值**：`max_drop = 0.10`（新键 `evolution.rollback.mode_dispatch_max_drop`，范围 0.05–0.30，与 `max_drop=0.03` 的 NDCG 回滚阈值分开——两者量纲不同，复用会造成假耦合，同 §5.1 阈值独立新设的判据）。

### 4.3 采纳后快照校验（防「中途又改过」）

回诊时先读现行 `growth:v1.mode_dispatch`，与 `adopted_words_snapshot` 逐字比对：

- 不一致（用户在冷却期后手动采纳了别的建议）→ **不回滚旧的**，写 `rollback_skipped`（reason：配置已被后续采纳替换，回诊计划失效）。否则会把用户更新的配置退回一个更早的版本。
- 一致 → 才进入 §4.1 三态判定。

## 5. 动作：回滚怎么落

不写第二套回滚逻辑，复用 `versioning.ts#rollbackGrowthConfig(storage, ...)`（既有 history 栈 + 整块校验 + 整块回退）。差异只在参数来源：

```ts
await rollbackGrowthConfig(storage, {
  target: 'mode_dispatch',          // 新参数：既有只回滚整份 cfg，这里指定只回退该块
  historyKey: adoptedHistoryKey,    // 采纳时 saveConfigWithHistory 的 key
  requestId, form, now,
});
```

写审计 `growth_op`：`phase='rollback'`, `family='mode_dispatch'`, `event='rolled_back'|'rollback_kept'|'insufficient'|'rollback_skipped'`, `reason=<中文人话>`, `metrics={ before_rate, after_rate, before_tagged, after_tagged, drop }`。UI 侧复用生长页的回诊卡，字段中文名取自 `recallLabels.ts`，不渲染 JSON。

## 6. 影响面清单（拍板后按此改）

| 文件 | 改动 | 闸门角色 |
|---|---|---|
| `src/shared/growthConfig.ts` | `EvolutionRollback` 增 `mode_dispatch_max_drop`（默认 0.10）；`normalizeEvolutionConfig` 整块校验 | A 兼容：旧账本缺键取默认 |
| `src/core/memagent/evolution/modeDispatchRegression.ts` | 新增纯函数 `computeDispatchBackfill(beforeMetrics, afterMetrics, maxDrop)` 返回三态 | B + C 主战场 |
| `src/core/memagent/evolution/loop.ts` | auto/手动采纳写 `rollback_plan`；新增 `checkDispatchRollback(storage, opts, force?)` | A 回归：既有两族回诊零改动 |
| `src/core/memagent/evolution/versioning.ts` | `rollbackGrowthConfig` 支持 `target:'mode_dispatch'` 局部回退 | A 回归 |
| `src/core/memagent/mcpGrowthTools.ts` / `mcpSchema.ts` | `growth_evolve(action='rollback', family='mode_dispatch', force?)` 入口 | B 效果 |
| `src/web/growth/EvolutionSettingsCard.tsx` | 高级区加 `mode_dispatch_max_drop`（0.05–0.30） | B UI |
| `__tests__/` 三个测试文件 | 基线不足/kept/rolled_back/skipped/快照变更后跳过各 1 例 | B + C |

## 7. 三道闸门

**A·影响面回归**：`verify:fast` 全绿；既有 `recall_weights` / `dedup_weights` 回诊测试逐字不改成绿；旧账本缺 `mode_dispatch_max_drop` 取默认且其它 rollback 字段不被拖回默认。

**B·效果验证**：采纳时 `before_tagged=8` → 审计无 `rollback_plan` 且写「基线不足」；`before=9/10, after=5/10` 且 negatives 净增 4 → 真回滚且现行 `mode_dispatch` 等于采纳前快照；`after_tagged=6` → `insufficient` 不动配置；`drop=0.05` → `kept`；采纳后又被新采纳替换 → `rollback_skipped` 不回滚。

**C·变异验证**：把「净增 ≥3」改成「≥1」→ 单条翻转用例必须红；把 `adopted_words_snapshot` 比对删掉 → 「配置已被替换」用例必须红；原样还原全绿。

## 8. 边界与诚实限制

- 命中率来自用户反馈，不是客观真值；低频使用时样本攒不够是常态，`insufficient` 会占多数回诊轮次——这是正确行为，不得为让回诊「有动作」而降阈值。
- 反馈本身有偏：只有当次召回用户愿意点才会产生；未点的请求不进分母。这是所有基于反馈的指标的共同边界，须在页面注明「基于用户主动反馈」。
- 回诊只回滚`mode_dispatch` 块，不动 `recall_weights` / 其它配置（局部回退）。
- 不做「采纳前 A/B 双跑」——那需要一次请求走两套分流并都收反馈，属在线实验，远超本方案范围。
