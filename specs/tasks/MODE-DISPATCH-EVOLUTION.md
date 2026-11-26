---
title: 7.2 样本池读取侧接线（mode_feedback → 分流词表/权重回归）
date: 2026-11-25
status: implementing（读取+建议+auto/手动采纳+UI 两键已通；add_words / weight_step 暂不产）
scope: 消费 mode_feedback / mode_dispatch 审计 → 产「分流修正建议」→ 经 growth_evolve adopt 才生效
depends: P2-8（写入侧 mode_feedback）、P2-9（growth:v1.mode_dispatch 命名空间 + 整块回退）
---

# 7.2 样本池读取侧接线（立项）

> 规格依据：`specs/需求规格书.md` §2.4.4 工程约束 3（误分流反馈 → 分流错误样本 → 每周 7.2 回归重拟词表权重）、§7.2（自生长）。
> 行为真源仍是源码；本文只定范围与验收，不含实现。

## 1. 现状（2026-11-25 现查）

| 环节 | 状态 | 证据 |
|---|---|---|
| 写入：👍/👎 模式反馈 | **已通** | `src/web/retrieval/coreModeFeedback.ts` 经 `getKernelStorage().appendAudit({action:'mode_feedback'})` 真写账本；`ModeFeedbackCard.tsx` 在结果页渲染 |
| 写入：分流事实 | 已通 | `agent.ts` 写 `mode_dispatch`（mode / applied_mode / source / hit_keywords / weights_source / scene） |
| 读取：样本池消费 | **零消费方** | 全仓 `mode_feedback` 仅出现在写入件、审计/日志中文标签、测试；`evolution/registry.ts` 的 `EVOLUTION_FAMILIES` 只有 `recall_weights` / `feedback_policy` |
| 落地通道 | 已具备 | `growth:v1.mode_dispatch`（P2-9）可承载热更词表/阈值/权重，整块校验 + 整块回退 |

结论：**闭环断在「读」这一段**——反馈与分流事实都躺在账本里，没有任何回归任务把它们变成建议。

## 2. 目标

1. 每周自生长轮（`growth_config.schedule.self_growth`）新增参数族 `mode_dispatch`：只读账本，把「分流错误样本」聚合成**建议**。
2. 建议只能经 `growth_evolve(action=adopt)` 采纳；采纳前写 `growth:v1:history:<ulid>`，采纳后写 `weight_tuned`（family=mode_dispatch），并对现行配置做整块校验。
3. 样本不足时如实报 `insufficient_samples`，**不产建议、不编数字**。

## 3. 非目标

- 不做在线学习/实时改配置；不改 `auto` 档权重（P1-5 离线 A/B 结论：auto 专属权重双优为负，保持只观测）。
- 不做语义冲突自动推断（P2-9-① 已裁决只认显式 `conflict_id` 对）。
- 不改 `feedback_policy` 语义（只降不升、不推 dormant 的既有保守口径不动）。

## 4. 验收判据（可测）

1. **样本口径**：窗口取 `evolution.window.dispatch_days`（默认 30 天）；只统计 `action='mode_feedback'` 且能按 `request_id` 关联到 `mode_dispatch` 的行；关联不到的单独计数跳过，不猜。
   - 有效正样本 = `verdict='up'`。
   - 有效负样本 = `verdict='down'` **且** `reason='模式选错'`。
   - `verdict='down'` 且 `reason='召回内容不对'` → **不进分流回归**（归召回内容质量），只计数留痕。
   - `reason='其它'` → 只进分母提示，不驱动任何改动。
   - 同一 `request_id` 只计一次；采纳后从 `latestAdoptTs` 起算，避免同一批样本被连续周轮重复计。
2. **阈值**：有效标注样本 < `evolution.min_samples.dispatch_tagged`（默认 10）→ 返回 `insufficient_samples` + 实际条数，`proposal=null`。
3. **产物**：建议结构必须含 `family:'mode_dispatch'`、`target_mode`（单模式）、`action`（`add_words` / `remove_words` / `weight_step`）、`changed`（before→after）、`reason`（引用样本条数与错分模式）、`sample_ids`（可回查的 request_id 列表）。
4. **采纳**：`normalizeModeDispatch` 整块校验失败 → 整单拒绝并报原因，不写半份配置；成功才写 history + 现行配置 + 审计。
5. **只读**：读取侧不得写 `growth:v1`（除 adopt 通道），单测用只读存储桩锁死。
6. **测试**：窗口过滤、阈值不足、request_id 关联缺失、坏建议被整块拒、adopt 成功落 history 五类各至少 1 例；另加「`reason='召回内容不对'` 不计负样本」与「单建议只含一个模式」两例。

## 5. 已定决策（2026-11-25 用户拍板）

### 5.1 阈值：独立新设，不复用反馈降档阈值

| 键 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `evolution.window.dispatch_days` | 30 | 1–365 | 分流样本回看窗口 |
| `evolution.min_samples.dispatch_tagged` | 10 | 1–100 | 有效标注样本门槛（对齐既有 `recall_tagged=10`） |

- **不复用 `feedback_policy.reject_downgrade_threshold`**：它数的是「同一条记忆在窗口内被 reject 几次 → 降 confidence 档」，属记忆级惩罚；回归门槛数的是「不同 request_id 的标注样本够不够」，属统计充分性。复用会造成假耦合——用户为加快降档把 3 调成 1，会同时把分流回归门槛降到 1 条样本。
- 窗口取 30 天而非 `window.recall_days:7`：反馈是用户主动点击才产生，密度远低于每次召回都写的 recall；7 天窗口在早期几乎必然 0 样本。
- 两个新键随 `normalizeGrowthConfig` 整块校验；旧账本缺字段 → 取默认，行为与本改造前一致。

### 5.2 粒度：单模式 + 单变量，优先词表，权重小步

- 一条建议只动**一个模式**的一类东西；其余模式原样保留。
- 优先级：`remove_words`（误判）→ `add_words`（漏判）→ `weight_step`（排序问题）。
- 动权重的前提写死：同一模式内正确条目确实进了候选但没排第一；步长 ≤ `guard.max_step`（0.05），两维此消彼长、权重和保持 1。
- 护栏：每模式词表 ≤40 词（防只增不删）；同一模式在 `guard.cooldown_days`（7 天）内只提一次。
- **整表重拟不进自动建议通道**，只用于离线人工评测（如 `tools/eval-auto-mode-weights.mjs` 那类）。

## 6. 风险

- **样本量**：当前 `mode_feedback` 条数可能远低于 10 条，首轮大概率只出 `insufficient_samples`——这是正确行为，不得为了让建议出现而调阈值。
- **口径一致性**：词表热更后 `mode_dispatch` 审计里的 `hit_keywords` 会随新词表变化，回归比较必须同口径（同一快照版本内比较）。

## 7. 实现进度（2026-11-25）

| 环节 | 状态 | 落点 |
|---|---|---|
| 配置两键（`dispatch_days` / `dispatch_tagged`） | 已通 | `shared/growthConfig.ts`（旧账本缺键取默认，其余字段不被拖回默认） |
| 参数族注册 | 已通 | `evolution/registry.ts` 的 `Family` / `EVOLUTION_FAMILIES` |
| 样本构建（窗口/语义/关联/去重） | 已通 | `evolution/modeDispatchRegression.ts#buildDispatchSamples` |
| 产建议（单模式单变量） | 已通（仅 `remove_words`） | 同上 `#proposeModeDispatch` |
| 进化轮接线（insufficient / suggest / guarded / adopted） | 已通 | `evolution/loop.ts`（`_dp` 后缀审计，request_id 过同源形状闸门） |
| 手动采纳入口 | 已通 | `evolution/loop.ts#adoptSuggestedModeDispatch` + `mcpGrowthTools.ts` 的 `adopt` 按 `family` 分派（缺省 `recall_weights`，行为不变） |
| 生长页 UI 两键 | 已通 | `web/growth/EvolutionSettingsCard.tsx`（`window-dispatch-days` 1–365 / `min-dispatch-tagged` 1–100） |
| 分流基线来源 | 已通 | `modeDispatchRegression.ts#dispatchBaseline`：账本有快照用账本，没有就以内核基线物化（`source` 记入审计） |
| 测试 | 已通 | `__tests__/modeDispatchRegression.test.ts`（15 例）+ `mcpGrowthTools.test.ts` 新增 1 例 + `evolutionSettingsCard.test.tsx` 新增 1 例；`evolutionLoop` 既有用例零改动 |

### 7.1 「账本无快照」的处置（2026-11-25 补定）

原实现遇到 `growth:v1.mode_dispatch` 缺失时直接拒绝，并提示「请先在生长页写入基线」——而生长页从来没有这个入口，等于采纳通道永远走不通。

现改为：**以内核基线物化一份快照**再落盘。三个来源全是内核真源（`DEFAULT_DISPATCH_CONFIG` 的 30/12/2、`MODE_FEATURE_WORDS` 五模式词表、`modeWeights()` 的 §2.4.3 权重向量且和=1），物化结果与运行态逐字等价，采纳后只差「被删掉的那一个词」，因此不是猜一个基线，而是把当前实际生效的配置显式写进热更命名空间。审计用 `baseline_source: 'ledger' | 'kernel'` 如实区分改动相对谁；auto 与手动两条路径共用 `dispatchBaseline` + `applyDispatchProposal`，不写第二套。

副作用（已知并接受）：一旦落库，`dispatch_config_source` 就从 `baseline` 变成 `growth:v1.mode_dispatch`，此后内核基线再改词表也不会自动生效——这是热更命名空间的固有语义（与 `recall_weights` 同），回退靠 `growth:v1:history` + 生长页回滚。

**两条诚实限制（不是遗漏，是当前信号不足）**：

1. `add_words` 需要「用户认为应该分到哪个模式」，`mode_feedback` 目前只有 verdict + 三选一原因，没有目标模式字段。硬编「由模型猜目标模式」等于伪造证据，故不产该类建议；要开需要先扩反馈字段（UI 加「应该是什么模式」）。
2. `weight_step` 属**同模式内排序**问题（正确条目进了候选但没排第一），模式反馈给不出该信号；强行把「模式选错」映射成调权重会改错东西。

**未做**：

- `add_words` / `weight_step` 两类建议（依赖扩 `mode_feedback` 字段，见上）。
- 分流族的自动回诊（采纳后 `guard.cooldown_days` 内不再提，但尚无「采纳后 N 天回看命中率是否变差则回滚」的 `mode_dispatch` 回诊计划；当前回诊只覆盖 recall_weights 与 dedup）。
