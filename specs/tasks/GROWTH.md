# P14 自我净化与生长页 任务拆分（REQ-009 / 6.1 / 6.2 / 7.1 / 7.2 / 13.3）

## T1 脚手架
- `growth.html`（全小写，Windows 大小写教训）+ `src/web/growth/` + vite 第 16 入口 + Overview 第 16 视图。
- theme.css / useToast.tsx cp 自 models。

## T2 数据模型 + 纯逻辑
- types：DimWeights（semantic/keyword/entity/structure/llm_judge）、LayerThresholds（L1–L6）、DedupSample（五维分 + 目标层）、GrowthMetrics（hit_rate/confirmed/rejected/low_quality_ratio/level_stats.L6/latency_ms）、OptState（triggered|idle|running）、ScheduleItem（cron 文案 + enabled）、DeltaPoint（day/delta/is_tuned）
- seed：默认权重 .35/.20/.15/.10/.20、阈值 .70/.75/.80/.85/.90/.90、判重样本若干（含跨层命中演示）、指标种子（hit_rate 0.28 / L6 0.42 / low_quality_ratio 0.45 演示 C2/C5/③）、7 日 Δ 序列（周日点带 is_tuned）、调度 4 项
- logic（纯函数）：
  - `weightedScore(dims, w)` → 加权平均（6.1）
  - `layerThresholdOf(layer)` → L1 .70 … L6 .90
  - `isDuplicate(score, threshold)` → score ≥ threshold（6.1）
  - `validateWeights(w)` → 和=1.0（R1/C1），误差 1e-6
  - `validateThresholds(t)` → L1→L6 单调不减（R1）
  - `shortCircuitPath(sample)` → 逐层查重命中层即停的层序（6.2 演示数据）
  - `evaluateOptimizations(metrics)` → 5 项状态：① hit_rate<0.3 ② L6<0.5 ③ low_quality_ratio>0.4 ④ 恒可 ⑤ 恒可（7.2）
  - `growthDelta(before, after)` → Δ = after − before（R3：入参取自真实 7.1 指标）
  - `deltaSeries(metrics7d)` → 7 日曲线点（周日 is_tuned，13.3）
  - `validateSchedule(enabled)` → 至少保留每日 02:00 衰减（R5/C6）
  - `auditOptimization(item, extra)` → R2 审计条目（action + payload；⑤/手动触发 → weight_tuned）

## T3 组件
- DedupCard：五维只读条 + 综合分进度 + 目标层阈值 + is_duplicate 徽标 + 「重新判重」换样本 + 短路嫁接流程图（写入→L1…命中即停）+ 24h 统计（短路命中/合并/耗时）
- DevTunePanel（开发者模式，G7）：权重 5 输入 + 阈值 6 输入 + R1 校验报错
- GrowthCards：6 指标卡（7.1 只读）
- OptimizationList：5 项自动优化（条件 + 状态徽标 + 动作 + 审计名）
- DeltaPanel：Δ 收益卡 + 7 日 SVG 曲线（weight_tuned 点标）+「手动触发一次自生长」（R4：写审计 + 曲线追加 + Δ 更新）
- ScheduleTimeline：4 项调度启停（R5：停用衰减 → 拒）

## T4 编排 + E2E
- GrowthPage 编排 + toast + mirror（safe-noop）+ 手动触发状态流转
- e2e/growth.spec.ts（:8142）：C1/C2/C3/C5/C6 + R3 只读 + R5 停衰减拒
