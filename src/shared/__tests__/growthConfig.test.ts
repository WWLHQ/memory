// 批次48 A23：生长配置单一真源与账本回读（默认回退、坏值丢弃、调度衰减不可停）
import { describe, expect, it } from 'vitest';
import type { Memory } from '../../core/memagent/types.ts';
import { GROWTH_PREF_PREFIX, growthConfigFromLedger } from '../../core/memagent/paramsSnapshot.ts';
import {
  DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, normalizeGrowthConfig, validThresholds, validWeights,
} from '../growthConfig.ts';

function pref(content: string): Memory {
  return { category: 'preference', user_id: 'system', content } as unknown as Memory;
}

describe('growthConfig 单一真源', () => {
  it('默认值与内核既有口径一致（五维权重和 = 1，阈值 L1→L6 单调）', () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      semantic: 0.35, keyword: 0.20, entity: 0.15, structure: 0.10, llm_judge: 0.20,
    });
    expect(DEFAULT_THRESHOLDS).toEqual({ L1: 0.70, L2: 0.75, L3: 0.80, L4: 0.85, L5: 0.90, L6: 0.90 });
    expect(validWeights(DEFAULT_WEIGHTS)).toBe(true);
    expect(validThresholds(DEFAULT_THRESHOLDS)).toBe(true);
  });

  it('权重和 ≠ 1 → 整块回退默认（不按比例偷偷修正）', () => {
    const cfg = normalizeGrowthConfig({
      weights: { semantic: 0.4, keyword: 0.2, entity: 0.15, structure: 0.1, llm_judge: 0.2 },
    });
    expect(cfg.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('阈值非单调（L3 < L2）→ 整块回退默认', () => {
    const cfg = normalizeGrowthConfig({
      thresholds: { L1: 0.7, L2: 0.8, L3: 0.5, L4: 0.85, L5: 0.9, L6: 0.9 },
    });
    expect(cfg.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('衰减不可停：schedule.decay=false 被忽略（R5）', () => {
    expect(normalizeGrowthConfig({ schedule: { decay: false, archive: false } }).schedule)
      .toEqual({ decay: true, verdict_reminder: true, self_growth: true, archive: false });
  });

  it('合法自定义配置原样保留', () => {
    const custom = {
      weights: { semantic: 0.40, keyword: 0.20, entity: 0.15, structure: 0.05, llm_judge: 0.20 },
      thresholds: { L1: 0.60, L2: 0.65, L3: 0.70, L4: 0.75, L5: 0.80, L6: 0.80 },
      schedule: { decay: true, verdict_reminder: false, self_growth: true, archive: false },
    };
    expect(normalizeGrowthConfig(custom)).toEqual(custom);
  });
});

describe('growthConfigFromLedger（旧账本兼容）', () => {
  it('无记录 → 默认配置（不伪造“已保存”）', () => {
    expect(growthConfigFromLedger([pref('params:v1:{}')])).toEqual(normalizeGrowthConfig(null));
  });

  it('记录 JSON 损坏 → 默认配置，不抛出', () => {
    expect(growthConfigFromLedger([pref(`${GROWTH_PREF_PREFIX}{oops`)]))
      .toEqual(normalizeGrowthConfig(null));
  });

  it('合法记录 → 按记录执行；坏字段逐块回退', () => {
    const raw = {
      weights: { semantic: 0.40, keyword: 0.20, entity: 0.15, structure: 0.05, llm_judge: 0.20 },
      thresholds: { L1: 0.6, L2: 0.65, L3: 0.7, L4: 0.75, L5: 0.8, L6: 0.8 },
      schedule: { decay: true, verdict_reminder: true, self_growth: true, archive: false },
    };
    const got = growthConfigFromLedger([pref(`${GROWTH_PREF_PREFIX}${JSON.stringify(raw)}`)]);
    expect(got.weights).toEqual(raw.weights);
    expect(got.thresholds).toEqual(raw.thresholds);
    expect(got.schedule.archive).toBe(false);
  });
});
