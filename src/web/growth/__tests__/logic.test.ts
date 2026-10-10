// P14 纯逻辑单测：覆盖 R1–R5 与 C1/C2/C4/C5/C6
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, SAMPLES, SEED_DELTA, SEED_METRICS, SEED_SCHEDULE } from '../seed.ts';
import {
  appendTunedPoint, auditOptimization, evaluateOptimizations, growthDelta, isDuplicate,
  layerThresholdOf, shortCircuitPath, validateSchedule, validateThresholds, validateWeights,
  weightedScore,
} from '../logic.ts';
import type { DimWeights, LayerThresholds, ScheduleItem } from '../types.ts';

describe('五维查重（6.1）', () => {
  it('weightedScore：加权平均（35/20/15/10/20）', () => {
    const s = SAMPLES[0]; // 0.91/0.62/0.70/0.55/0.88
    expect(weightedScore(s.dims, DEFAULT_WEIGHTS)).toBe(0.779);
  });

  it('isDuplicate：score ≥ threshold', () => {
    expect(isDuplicate(0.777, 0.75)).toBe(true);
    expect(isDuplicate(0.777, 0.80)).toBe(false);
  });

  it('阈值表：L1 .70 → L6 .90', () => {
    expect(layerThresholdOf('L1', DEFAULT_THRESHOLDS)).toBe(0.70);
    expect(layerThresholdOf('L6', DEFAULT_THRESHOLDS)).toBe(0.90);
  });
});

describe('R1 校验', () => {
  it('C1：权重和≠1 → 报错', () => {
    const bad = { ...DEFAULT_WEIGHTS, semantic: 0.40 } as DimWeights; // sum 1.05
    const r = validateWeights(bad);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('R1');
    expect(r.msg).toContain('1.0500');
  });

  it('合法权重通过', () => {
    expect(validateWeights(DEFAULT_WEIGHTS).ok).toBe(true);
  });

  it('阈值单调：L2 > L3 → 报错', () => {
    const bad = { ...DEFAULT_THRESHOLDS, L3: 0.72 } as LayerThresholds;
    const r = validateThresholds(bad);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('单调不减');
  });

  it('默认阈值通过', () => {
    expect(validateThresholds(DEFAULT_THRESHOLDS).ok).toBe(true);
  });
});

describe('短路嫁接（6.2）', () => {
  it('s1 综合分 0.779 → L1(0.70) 命中即停', () => {
    const steps = shortCircuitPath(SAMPLES[0], DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS);
    expect(steps.length).toBe(1);
    expect(steps[0].layer).toBe('L1');
    expect(steps[0].hit).toBe(true);
    expect(steps[0].action).toContain('停止');
  });

  it('s2 综合分 0.565 → 全层未命中 → 新建', () => {
    const steps = shortCircuitPath(SAMPLES[1], DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS);
    expect(steps[steps.length - 1].layer).toBe('新建');
  });

  it('s3 综合分 0.875 → L1 未命中(0.875<0.90?) 0.875>=0.70 命中 L1', () => {
    // 0.96*0.35+0.78*0.20+0.82*0.15+0.71*0.10+0.93*0.20 = 0.875 → L1 命中
    const steps = shortCircuitPath(SAMPLES[2], DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS);
    expect(steps[0].layer).toBe('L1');
    expect(steps[0].hit).toBe(true);
  });
});

describe('五项自动优化（7.2，种子指标演示）', () => {
  const opts = evaluateOptimizations(SEED_METRICS);

  it('C2：hit_rate=0.28 < 0.3 → ① 降阈值触发', () => {
    expect(opts[0].state).toBe('triggered');
    expect(opts[0].action).toBe('adjust_threshold(lower)');
  });

  it('C5：L6=0.42 < 0.5 → ② 关键词提取优化触发', () => {
    expect(opts[1].state).toBe('triggered');
    expect(opts[1].auditName).toBe('keyword_refined');
  });

  it('low_quality=0.45 > 0.4 → ③ 加速遗忘触发', () => {
    expect(opts[2].state).toBe('triggered');
  });

  it('④⑤ 未被指标触发（idle）', () => {
    expect(opts[3].state).toBe('idle');
    expect(opts[4].state).toBe('idle');
  });
});

describe('自生长收益（7.2 / R3 / R4）', () => {
  it('C4/R3：Δ = after − before，取自真实反馈入参', () => {
    expect(growthDelta(0.28, 0.33)).toBe(0.05);
  });

  it('R4：手动触发追加 is_tuned 点', () => {
    const next = appendTunedPoint(SEED_DELTA, '周日+', 0.05);
    expect(next[next.length - 1].is_tuned).toBe(true);
    expect(next.length).toBe(SEED_DELTA.length + 1);
  });
});

describe('调度（13.3 / R5）', () => {
  it('C6：停用衰减 → 拒', () => {
    const bad = SEED_SCHEDULE.map((s) => (s.key === 'decay' ? { ...s, enabled: false } : s)) as ScheduleItem[];
    expect(validateSchedule(bad).ok).toBe(false);
    expect(validateSchedule(bad).msg).toContain('R5');
  });

  it('停用非必需项 → 通过', () => {
    const ok = SEED_SCHEDULE.map((s) => (s.key === 'archive' ? { ...s, enabled: false } : s));
    expect(validateSchedule(ok).ok).toBe(true);
  });

  it('衰减项标记为 required（不可停）', () => {
    expect(SEED_SCHEDULE.find((s) => s.key === 'decay')?.required).toBe(true);
  });
});

describe('审计（R2 / R4 / G6）', () => {
  it('⑤ 权重回归 → weight_tuned', () => {
    const e = auditOptimization({ auditName: 'weight_tuned', action: 'regress_mode_weights', key: 'regress_weights' }, { cycle: 'weekly' });
    expect(e.event).toBe('weight_tuned');
    expect(e.action).toBe('regress_mode_weights');
  });

  it('R4：手动触发任意项 → 等价 ⑤ 记 weight_tuned', () => {
    const e = auditOptimization({ auditName: '阈值变更', action: 'adjust_threshold(lower)', key: 'lower_threshold' }, { manual: true }, true);
    expect(e.event).toBe('weight_tuned');
  });

  it('① 降阈值 → 阈值变更审计', () => {
    const e = auditOptimization({ auditName: '阈值变更', action: 'adjust_threshold(lower)', key: 'lower_threshold' }, { from: 0.7, to: 0.68 });
    expect(e.event).toBe('阈值变更');
  });
});
