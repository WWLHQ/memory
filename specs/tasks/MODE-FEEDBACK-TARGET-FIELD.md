---
title: mode_feedback 增「应该是什么模式」字段 → 解锁 add_words / weight_step
date: 2026-11-26
status: implemented（2026-11-26 用户拍板后实施：expected_mode→add_words、rank_wrong→weight_step 均已通）
scope: UI 与账本双改 + 读取侧两类建议；不改 remove_words 既有口径
depends: 7.2 样本池读取侧（MODE-DISPATCH-EVOLUTION.md，已通）
---

# mode_feedback 增目标模式字段（立项方案）

> 规格依据：`specs/tasks/MODE-DISPATCH-EVOLUTION.md` §7 两条诚实限制。
> 本文是**方案**，不是实现；行为真源仍是源码，拍板后再动代码。

## 1. 问题：为什么 add_words / weight_step 现在不产

`src/core/memagent/evolution/modeDispatchRegression.ts#proposeModeDispatch` 当前只产 `remove_words`。卡点在证据，不在代码：

| 建议类型 | 需要的证据 | 现有 `mode_feedback` 能否给出 |
|---|---|---|
| `remove_words` | 👎 模式选错 + 本次 `hit_keywords` 里哪个词误触发 | 能：`verdict='down'` + `reason='模式选错'` + `mode_dispatch.hit_keywords` |
| `add_words` | 👎 模式选错 + **用户认为应该分到哪个模式** + 该模式的漏判词 | **不能**：`detail` 只有 `mode / verdict / verdict_zh / reason / source` |
| `weight_step` | 模式选对但**正确条目没排第一** + 应该排第一的是哪条 | **不能**：反馈只有模式粒度，没有条目粒度 |

结论：要让后两类可产，必须扩反馈字段。`add_words` 扩一个 `expected_mode` 就够；`weight_step` 还需第二个字段（条目级排序信号）——这是本方案最重要的诚实边界，**不要把「加了 expected_mode」宣传成「三类建议都解锁」**。

## 2. 字段设计

### 2.1 `expected_mode`（解 add_words）

| 项 | 定义 |
|---|---|
| 写入位置 | `mode_feedback` 审计的 `detail.expected_mode` |
| 类型 | `ConcreteMode \| null`。合法值五选一：`top_insight / fact_first / event_replay / pattern_reasoning / minimal` |
| 触发条件 | 仅当 `verdict='down'` **且** `reason='模式选错'` 时必填；其余三种情况（👍、`召回内容不对`、`其它`）一律写 `null` |
| 不允许的值 | 不写当前生效模式（选了等于没说）；不写 `auto`（自动是观测档不是目标）；`critical` scene 下禁 `minimal`（对齐 P2-8 手动选模式的既有约束） |
| 旧账本兼容 | 旧行无此字段 → 读取侧视为 `null`，**不产 add_words**，行为与今天逐字一致；不回填、不猜 |

UI：`src/web/retrieval/ModeFeedbackCard.tsx` 在 👎 且原因选「模式选错」后，展开一个下拉「应该分到哪个模式？」，选项取 `src/web/retrieval/logic.ts#MODE_NAMES` 的中文名（唯一真源，不新建第二套词表）。`src/web/retrieval/coreModeFeedback.ts#ModeFeedbackInput` 增 `expected_mode?`，写入 `detail` 时按上表归一化。

### 2.2 `rank_wrong`（解 weight_step，二期）

`weight_step` 不是模式问题而是**同模式内排序**问题：正确条目进了候选但没排第一。需要第二条独立反馈：

| 项 | 定义 |
|---|---|
| 写入位置 | `feedback`（ recall 逐条反馈）审计的 `detail.rank_wrong: boolean` + `detail.expected_first_id: string \| null` |
| 触发条件 | 用户点某条命中的「这条应该排第一」（新按钮），或「排序不对」并选期望条目 |
| 护栏 | 步长 ≤ `guard.max_step`(0.05)；两维此消彼长、权重和=1；同模式 7 天冷却 |

**本轮不做**，理由：recall 逐条反馈 UI 是另一条交互链路，硬塞进模式反馈卡会制造「模式对但排序错」这种用户看不懂的二重选择。单独立项、单独设计。

## 3. 读取侧：`add_words` 建议口径（核心）

### 3.1 证据来源——词从哪来（不许模型编）

`add_words` 最大的伪证据风险是「从自然语言 query 里抽词」。本方案把候选词**限定在已知词表的并集**里：

```
候选词池 = ⋃(所有 ConcreteMode 的 MODE_FEATURE_WORDS[mode].words)
           ∪ ⋃(growth:v1.mode_dispatch.feature_words[*].words)
```

即只建议「已经在别的模式词表里、但没在目标模式词表里」的词——这是"词的归属被放错了"，不是"造一个新词"。若用户 query 里的关键说法不在任何已知词表，本轮**不产建议**并如实写原因（如需造新词应走离线人工评测通道，不进自动建议）。

### 3.2 产建议条件（单模式单变量，与 remove_words 同优先级框架）

对每条 `expected_mode=T` 的有效负样本：
1. 取该次 `mode_dispatch.hit_keywords` 与 `recall.query`；
2. 找出 query 中出现、但**不在** T 词表、**在**候选词池里的词 W；
3. 按 T 分组，统计每个 W 被多少条不同 `request_id` 命中。

产出一条 `add_words` 建议，当且仅当：
- T 组有效负样本 ≥ 2 条；
- 存在 W 被 ≥ 2 条不同样本命中；
- T 当前词表长度 < 40（`guard` 的每模式上限，防只增不删）；
- 词按 `localeCompare` 稳定排序，取分数最高一个；并列时取字典序最小（可复现，不随机）。

`DispatchProposal.action` 扩为 `'add_words' | 'remove_words'`，`changed` 仍是单条 `{from, to}`，`validDispatchProposal` 同步放宽白名单（仍严格校验形状，不凭字段存在就认）。

### 3.3 优先级与冲突

用户已拍板 `remove_words → add_words → weight_step`。实现为：`proposeModeDispatch` 先跑 `remove_words`（既有逻辑逐字不动），命中则直接返回；否则才跑 `add_words`。一整个建议只动一个模式一类东西，不混合。

## 4. 影响面清单（拍板后按此改）

| 文件 | 改动 | 三道闸门角色 |
|---|---|---|
| `src/web/retrieval/coreModeFeedback.ts` | `ModeFeedbackInput` 增 `expected_mode`；`detail` 归一化写入 | B 效果：审计真写字段 |
| `src/web/retrieval/ModeFeedbackCard.tsx` | 👎+模式选错 → 展开目标模式下拉；中文名取 `MODE_NAMES` | B 效果：UI 交互真触发 |
| `src/web/retrieval/retrieval.css` | 下拉样式，复用既有 `ret-pill`/`ret-btn` 变量 | A 影响面：不改其它页 |
| `src/core/memagent/evolution/modeDispatchRegression.ts` | `DispatchSample` 增 `expected_mode`；`proposeModeDispatch` 增 `add_words` 分支与候选词池；`validDispatchProposal` 放行 `add_words` | B + C 主战场 |
| `src/core/memagent/evolution/loop.ts` | `applyDispatchProposal` 支持 `add_words` 的 `changed[0].to`（现按任意 `to` 整块替换，基本无需改，只需确认长度上限） | A 回归 |
| `specs/tasks/MODE-DISPATCH-EVOLUTION.md` | §7 限制 1 改为「已解锁」，补本方案链接 | 文档同步 |
| `specs/code-index.generated.md` | `npm run code:index -- --write` 重建 | 门禁 |

## 5. 三道闸门（拍板后逐项执行）

**A·影响面回归**：全量 `verify:fast`（typecheck + lint + code:index:check + check:no-demo + test:coverage）；`remove_words` 既有 15 例逐字不改成绿；旧账本无 `expected_mode` 的行不产 add_words（兼容用例）。

**B·效果验证**：
- 👎+模式选错+选了目标模式 → 审计 `detail.expected_mode` 真落盘（读账本断言）；
- 造 2 条不同 request_id 指向同一目标模式、同一已知词 → 真产一条 `add_words` 建议且 `family/target/changed/reason/sample_request_ids` 齐全；
- 目标模式词表已有 40 词 → 拒绝并写原因；
- `amount=0` 或 `expected_mode` 为空/非法 → 不产建议；
- 只读存储桩：读取侧不写 `growth:v1`。

**C·变异验证**：把「≥2 条不同 request_id」改成「≥1」→ 单样本用例必须红灯；把候选词池改成「任意 query 词」→ 造一个不在词表的词，必须红灯；原样还原后必须全绿。

## 6. 非目标

- 不产 `weight_step`（见 §2.2，需条目级排序反馈，另立项）。
- 不做整表重拟（用户已裁决只用于离线人工评测）。
- 不改 `remove_words` 优先级与证据口径。
- 不在本轮改自动档 `auto` 的权重（P1-5 双优为负，保持只观测）。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户懒得选目标模式 → 字段长期为空 → add_words 仍不产 | UI 只在「模式选错」时展开，且给「不确定就留空」提示；不强制 |
| 候选词池太保守 → 真有漏判新词永远加不进来 | 如实写原因；新词走离线评测通道，不伪造进自动建议 |
| 词表只增不删 → 40 词上限很快撞满 | 上限已在建议侧硬拦；撞满后提示先做 remove_words |
