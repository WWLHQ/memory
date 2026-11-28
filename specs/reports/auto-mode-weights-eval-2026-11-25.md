# auto 模式专属权重 vs growth:v1 固定权重 —— 离线 A/B 评估（2026-11-25，北京时间）

## 1. 问题
默认 auto 档下 5 种召回模式的专属权重差异「不自动生效」（权重恒走 growth:v1）。本评估回答：能否把 auto 改为「应用建议模式的专属权重」——即开闸？

## 2. 方法（唯一变量 = 权重向量）
- 脚本：`tools/eval-auto-mode-weights.mjs`（只读）。
- 数据源：`%APPDATA%\MultiAgent Memory\data-root.json` → `ledgerDir=D:\MultiAgent Memory\data`，读 `audit.jsonl` + `audit-archive/`。
- 复用审计 `mems_detail` 元组 `[mem_id, relevance, f, imp, conf, boost]` 的同一批分量重排，**不重跑向量检索、不写库、不改生产配置、不为凑数调参**。
- 对照组 A：`growth:v1` 固定权重 `{w_f .35, w_i .30, w_c .15, w_a .20}`（`growthConfig.ts:DEFAULT_RECALL_WEIGHTS`）。
- 对照组 B：用 `resolveMode(query, scene, 'auto')` 现算建议模式，套该模式专属权重（归一化到和=1；pattern_reasoning 原和 0.90）。
- 打分：`score = relevance × Σ w·分量`，与 `forgetting.ts:scoreFromParts` 同式。
- 双口径：A=top1 relevance（已融合 token coverage，λ=0.6）；B=证据不足率（top1 score<0.3）。
- 稳健性：按 ts 前后半切分交叉校验。

## 3. 样本
- 含 mems_detail 的 recall 557 条；关联 mode_dispatch 620 条。
- 跳过 manual 56 条 → 可用 auto 样本 **501 条**；坏行/缺 query 0。
- 建议模式分布：minimal 265 / top_insight 176 / fact_first 38 / event_replay 22。

## 4. 结果
### 4.1 整体
| 口径 | growth:v1 | auto 专属 | 差值 |
| --- | --- | --- | --- |
| top1 相关度 | 0.4069 | 0.3878 | -0.0191 (-4.7%) |
| 证据不足率 | 59.88% | 71.46% | +11.58pp |
→ auto 双口径均显著变差。

### 4.2 分建议模式
| 建议模式(n) | growth 相关度/thin | auto 相关度/thin | 判定 |
| --- | --- | --- | --- |
| minimal(265) | .4043/.5774 | .3773/.7434 | auto 双劣 |
| top_insight(176) | .4146/.6307 | .4034/.7159 | auto 双劣 |
| fact_first(38) | .3791/.7105 | .3690/.7368 | auto 双劣 |
| event_replay(22) | .4242/.4091 | .4221/.3182 | thin 改善但相关度微降，样本小 |

### 4.3 分场景
default(250)、task_start(209)、critical(36) 均 auto 双劣；history_query(6) 两方案持平（.3928/.5）。

### 4.4 时间切分
- 前半(250)：growth .3919/.668 vs auto .3686/.752 → growth 双优
- 后半(251)：growth .4218/.5299 vs auto .4069/.6773 → growth 双优
→ 结论跨时间稳定，非偶然波动。

## 5. 判定（三档）
- 全面开闸 ❌：要求 auto 在双口径 + 双时间半区稳定优于 growth；实测全面相反。
- 条件灰度 ❌：唯一有改善迹象的 event_replay 仅 22 条、且相关度未同步提升，统计效力不足。
- **保持只观测 ✅（结论）**：维持 A3 硬闸，auto 仍走 growth:v1；分流的 suggested 只写元数据、不应用专属权重。

## 6. 为什么（机制）
growth:v1 偏重新鲜度(f=.35)，契合「最近写入的记忆更相关」的真实分布；5 模式权重把重心移向 importance/access_boost（如 minimal .35/.35、pattern .28/.44），在长尾 query 上摊薄 top1 相关度、抬高证据不足率——与一周观察里「证据不足率飙升、平均命中数下滑」同因。故 auto「选对模式」目前只体现在 dispatch 元数据，换成专属权重反而伤排序。

## 7. 边界与限制
- mems_detail 已四舍五入 3 位；绝对数不外推线上，方向可信。
- pinned +0.15 因埋点无该字段未计（两方案对称，不影响相对比较）。
- pattern_reasoning 权重和 0.90（规格缺陷，待修），本评估归一到 1 后参与。
- 只读评估，未写 growth:v1、未改阈值、未调参凑数。

## 8. 下一步
1. 保持只观测；不启用 A3 开闸。
2. event_replay 扩样本后单独复核（唯一潜在灰度候选）。
3. 修 pattern_reasoning 权重和为 1 的规格缺陷。
4. 若未来要开闸，前置条件：auto 需在双口径 + 双半区稳定优于 growth。
