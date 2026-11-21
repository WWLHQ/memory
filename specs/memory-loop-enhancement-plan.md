# 记忆闭环增强方案（回显 × 进化 × 生命周期 × 画像）

> 2026-11-21 用户拍板「四批都做、按照顺序执行」。本文档是唯一真源：批次 A/B/C/D 的
> 目标、改动面、红线与验收门禁。每批独立走：全量门禁 → 打包 → 用户实测 → 等明确确认 → 才 commit。

## 一、现状盘点（双向链路已有哪些，全部现查自源码）

### 方向一：生命周期 → 回显（召回时已生效）
| 环节 | 真源 | 作用 |
| --- | --- | --- |
| 衰减打分 | `forgetting.ts#scoreMemory`（freshness 半衰期 × importance × confidence；SCORE_WEIGHTS 可被 growth:v1 替换） | 决定 hit.score |
| 召回池过滤 | `agent.ts`（minimal 只 hot/warm :217；cold 以下只在兜底 :329；hardFilter 排 deleted/merged_into） | 档位决定可见性 |
| 合并标注 | `recallSupersede.ts#supersedeNote` | 被合并的记忆带替代说明 |
| 权重来源可见 | `dispatch.weights_source='growth:v1'` | 进化是否已被采纳 |

### 方向二：回显 → 进化（已有闭环资产）
| 环节 | 真源 | 作用 |
| --- | --- | --- |
| 召回审计 | audit `recall`（含 mems_detail） | 评估取样来源 |
| 强标签 | audit `recall_feedback`（confirm=1 / reject=0，disputed 不进强 NDCG） | `evolution/recallEval.ts#samplesFromAudits` |
| 评估决策 | `recallEval.ts`（NDCG@topK + 符号检验 + reject_ratio/thin_ratio 护栏） | suggest 三态 |
| 反馈降档 | `feedbackSignal.ts#tallyRejects` 连续 reject → `runForgettingCycle` 降档（只降不升） | 惩罚噪声记忆 |
| 采纳/回滚 | growth:v1 versioning + `rollbackGrowthConfig`；auto 档过门槛自动采纳 | 人工兜底 |

### feedback 工具既有口径
`mcpSchema.ts#feedback`：confirm → confidence +0.1 且 reinforce_count+1；reject → −0.05（下限 0.05）；
disputed → 挂裁决不动分。MCP 层红线「内核行为一行不改，MCP 只加归因」（M1-3/M1-4）。

## 二、五缺口（本方案针对）

1. **回显只读无反馈入口**：用户看到命中但没有「有用/没用」的轻量通道，强标签全靠用户主动开口。
2. **进化不可感知**：权重是否已被采纳、上轮评估结论、降档/合并发生了什么，回显里看不到。
3. **RAG 就地引用 [n] 这个天然隐式正反馈未落审计**：agent 采信 [n] 写进回答，账本却不知道。
4. **无用户画像**：场景偏好（什么 query 常在什么场景被问）没有聚合，scene 分流全靠即时判据。
5. **reinforce_count 未联动半衰期**：confirm 只加 0.1 分，寿命不延长，「越用越好用」缺时间维度。

## 三、四批方案

### 批次 A：回显可反馈（隐式正反馈 + 卡片反馈入口 + 进化状态）
- **A1 引用即隐式正反馈（弱信号口）**
  - `feedback` 工具新增可选参数 `implicit: boolean`（仅 verdict=confirm 允许；与其它 verdict 组合直接报错）。
  - MCP 层处理（内核 `coreFeedback` 一行不改）：implicit confirm **不动 confidence（trust_delta=0）**，
    只 `reinforce_count + 1`（version+1、updated_at 照走），并写两条审计：
    - `memory_op`：detail `{ op:'confirm', implicit:true, trust_delta:0, reinforce_only:true, mem_id }`；
    - `recall_feedback`：detail `{ recall_id, mem_id, verdict:'confirm', implicit:true, ts }` ——
      **复用既有 action，recallEval 会自动把它当强标签进评估样本池**（这正是「只进样本池」的落点）。
  - **防刷**：同一 `request_id + mem_id` 只记一次（查 `recall_feedback` 审计去重；重复返回
    `duplicate:true` 且不再 +1）。关联不到召回（recall_link.linked=false）→ 不写任何标签（M1-4 纪律）。
- **A2 卡片反馈入口**：`display.card.hits[]` 新增 `feedback_hint` 字段（常量
  `RECALL_FEEDBACK_HINT`，形如「回复『N 有用』或『N 没用』反馈本条」）；协议文案同步
  （mcpSchema MCP_INSTRUCTIONS + feedback description + mcpHttp bubbleCard）：回答采信 [n] 后
  调 `feedback(confirm, implicit=true, recall_id=本次 request_id)`。
- **A3 卡片显示进化状态**：`Hit` 增加 `reinforce_count?: number`（agent.ts 三处命中构建带出，
  个人记忆命中无此字段则省略）；`RecallCardHit` 增 `reinforce_count?: number`（decay_class 已有）。
- **验收**：implicit 不加分/不降 confidence；去重生效；verdict 组合报错；卡片三字段存在；
  全量门禁绿。

### 批次 B：进化可感知（summary 进化行 + 降档/合并提示）
- 卡片 `summary` 增「进化」行：growth:v1 版本短码 + 进化模式（off/suggest/auto）+ 上轮评估结论
  （insufficient/rejected/suggest 或「无评估记录」），数据从 growth 配置与最近 `weight_regression`
  审计取，取不到如实写「暂无」。
- 降档提示：命中带出「上轮因连续 reject 已从 X 降档」；合并提示：supersedeNote 已有，卡片
  hits 摘要后缀标注「已并入 mem_xxx」。
- **验收**：无评估记录不编造；auto 采纳/回滚事件可见。

### 批次 C：自动化闭环（一键采纳 + confirm 延寿 + 反馈驱动衰减个性化）
- 一键采纳：评估产出 suggest 后，用户一句「采纳」→ 走既有 auto 护栏路径落 growth:v1（versioning
  可回滚），审计 `weight_tuned` 记采纳来源。
- confirm 延寿：coreFeedback confirm 分支在 reinforce_count+1 的同时
  `half_life_days = min(现有值 + 3, 90)`（阶梯 +3/次、封顶 90 天）；implicit confirm **不延寿**
  （弱信号不动寿命，防止刷）。
- FeedbackPolicy.enabled 按项目开启的入口（现在只能全局 P_SYSTEM ledger 配置）。
- **验收**：suggest→采纳全链路审计可查；延寿封顶生效；implicit 不延寿锁测试。

> **批次 C 实施修订（2026-11-21，诚实降级）**：① 采纳入口落地为第 14 个 MCP 工具
> `growth_evolve`（status/adopt/profile/policy 四动作），采纳审计 event='adopted' 带
> `adopted_via:'manual'`（而非 weight_tuned，后者属判重族）；建议审计无评估基线时
> **不挂回诊计划**（绝不猜 baseline）。② 延寿仅对**已显式设置** half_life_days 的记忆
> +3（封顶 90；已 ≥90 不动不缩短）；未显式设置的不猜类别默认值，避免把策略默认固化进记录。
> ③ FeedbackPolicy 仍是**全局** growth:v1 单实例真源，「按项目粒度」需多实例配置
> （涉及版本化与页面配套改造），本轮**不做**，MCP `policy` 动作只开/停全局开关，
> 与参数页同源——不假装已按项目隔离。

### 批次 D：场景画像（聚合 → 反哺 → 透明）
- 场景画像聚合：从 `recall` 审计聚合「query 场景 × 命中层 × 用户反馈」→ 独立 preference 记忆
  （不进召回语料，独立命名空间）。
- 画像反哺：scene 分流判据在自动判据之上叠加画像先验（只调 mode 建议，不改打分权重）。
- 透明可删：画像作为普通记忆可 list/get/delete，页面可见「画像来自哪次召回」。
- **验收**：画像可关（不聚合开关）、可删、删后不影响召回正确性。

## 四、横切红线（全批适用）

1. **反馈只记用户真实表态**：显式 verdict 必须来自用户发言；implicit 只在 agent 采信 [n] 时由
   agent 提交，且幂等去重。
2. **隐式信号零加分**：不加 confidence、不延寿、不触发降档，只进评估样本池。
3. **降档只降不升、不推 dormant**（既有 downgradeClass 口径不变）。
4. **suggest 永不自动写 growth:v1**（只有 auto 档过门槛或用户显式采纳才写）。
5. **回显铁律不变**：卡片仍是回答绝对末尾、其后零文字；文本摘要行与卡片二选一。
6. **诚实边界**：WorkBuddy widget 按钮不能直接发起 MCP 调用——反馈入口是「提示语 + 用户下一轮
   发言 → agent 调 feedback」，不承诺点按钮即生效。
7. 每批独立：门禁（npm test 全量 + typecheck + no-demo + index）→ 打包 → 用户实测 → 等明确
   确认 → 才 commit/push（在途改动单列，禁 `git add .`）。

## 五、落地顺序与当前状态

| 批次 | 状态 | 报告 |
| --- | --- | --- |
| 落盘本方案 | ✅ 2026-11-21 | 本文档 |
| A | ✅ 已实施+线上实测（显式反馈「1 有用」闭环：reinforce 无→1 无重复计分）+ 反馈交互按钮（sendPrompt） | 本文档 §三 A + `specs/recall-echo-contract.md` §7.1.1 |
| B | ✅ 已实施（卡片「进化」行 + 合并提示 + 近 7 天降档数） | 门禁 4082 例全绿 |
| C | ✅ 已实施（growth_evolve adopt + confirm 延寿 +3 封顶 90 + policy 全局开关） | 门禁 4082 例全绿 |
| D | ✅ 已实施（growth_evolve profile：审计只读派生画像，可删、只提示不改配置） | 门禁 4082 例全绿 |
| 打包 | ✅ 2026-11-21（A/B/C/D 同包） | 待用户实测 + 确认后 commit |

**后续全部加回显交互（2026-11-21 用户拍板）**：此后所有召回回显卡片一律带
「N 有用 ↗ / N 没用 ↗」sendPrompt 反馈按钮（无按钮宿主保留文字提示）；本偏好已落
MCP_INSTRUCTIONS §2 + mcpHttp bubbleCard 协议，测试锁钉住（mcpHttp.test.ts C4）。
