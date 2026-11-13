// 批次48 A23：生长配置单一真源与账本回读（默认回退、坏值丢弃、调度衰减不可停）
import { describe, expect, it } from 'vitest';
import type { Memory } from '../../core/memagent/types.ts';
import { GROWTH_PREF_PREFIX, growthConfigFromLedger } from '../../core/memagent/paramsSnapshot.ts';
import { parseCron } from '../cron.ts';
import {
  DEFAULT_FEEDBACK_POLICY, DEFAULT_RECALL_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, RECALL_KEYS,
  SCHEDULE_TASKS, normalizeGrowthConfig, validFeedbackPolicy, validRecallWeights, validThresholds,
  validWeights,
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
      // 批次61 GAP-1：recall_weights 为必填项——合法值必须逐字保留，不被回退覆盖
      recall_weights: { w_f: 0.40, w_i: 0.25, w_c: 0.15, w_a: 0.20 },
      // 批次61 GAP-2：feedback_policy 同理，显式启用的策略不得被 normalize 关掉
      feedback_policy: { enabled: true, window_days: 14, reject_downgrade_threshold: 4 },
    };
    expect(normalizeGrowthConfig(custom)).toEqual(custom);
  });

  it('调度任务真源（A23.2）：四项齐全、cron 全部可解析、衰减不可停', () => {
    expect(SCHEDULE_TASKS.map((t) => t.key)).toEqual(['decay', 'verdict_reminder', 'self_growth', 'archive']);
    for (const t of SCHEDULE_TASKS) {
      expect(parseCron(t.expr), `${t.key} 的 cron 必须可解析`).not.toBeNull();
      expect(t.when.length).toBeGreaterThan(0);
    }
    expect(SCHEDULE_TASKS.find((t) => t.key === 'decay')!.required).toBe(true);
    expect(SCHEDULE_TASKS.filter((t) => t.required).map((t) => t.key)).toEqual(['decay']);
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

  it('旧账本（无 recall_weights 字段）→ 召回权重取历史常量，读出排序与改造前逐字一致', () => {
    const raw = {
      weights: { semantic: 0.40, keyword: 0.20, entity: 0.15, structure: 0.05, llm_judge: 0.20 },
      thresholds: { L1: 0.6, L2: 0.65, L3: 0.7, L4: 0.75, L5: 0.8, L6: 0.8 },
      schedule: { decay: true, verdict_reminder: true, self_growth: true, archive: false },
    };
    const got = growthConfigFromLedger([pref(`${GROWTH_PREF_PREFIX}${JSON.stringify(raw)}`)]);
    expect(got.recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
  });
});

// 批次61 GAP-1（规格 A1–A3）：召回打分权重进入 growth:v1 单一真源。
// 红线：缺省/非法一律回退历史常量（0.35/0.30/0.15/0.20），保证旧账本行为逐字不变。
describe('召回打分权重 recall_weights（GAP-1 契约层）', () => {
  it('A1：默认值 = 内核历史常量 SCORE_WEIGHTS，四维齐全且和 = 1', () => {
    expect(DEFAULT_RECALL_WEIGHTS).toEqual({ w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 });
    expect(RECALL_KEYS).toEqual(['w_f', 'w_i', 'w_c', 'w_a']);
    expect(validRecallWeights(DEFAULT_RECALL_WEIGHTS)).toBe(true);
  });

  it('A2：和 ≠ 1 / 缺维度 / 越界 / 非数字 → validRecallWeights 为 false', () => {
    expect(validRecallWeights({ w_f: 0.4, w_i: 0.3, w_c: 0.15, w_a: 0.2 })).toBe(false); // 和 1.05
    expect(validRecallWeights({ w_f: 0.35, w_i: 0.30, w_c: 0.35 })).toBe(false);          // 缺 w_a
    expect(validRecallWeights({ w_f: 1.2, w_i: -0.2, w_c: 0.0, w_a: 0.0 })).toBe(false);   // 越界
    expect(validRecallWeights({ w_f: '0.35', w_i: 0.30, w_c: 0.15, w_a: 0.20 })).toBe(false);
    expect(validRecallWeights(null)).toBe(false);
    expect(validRecallWeights(undefined)).toBe(false);
  });

  it('A3：坏块整块回退默认（不按比例偷偷修正）', () => {
    expect(normalizeGrowthConfig({ recall_weights: { w_f: 0.4, w_i: 0.3, w_c: 0.15, w_a: 0.2 } }).recall_weights)
      .toEqual(DEFAULT_RECALL_WEIGHTS);
    expect(normalizeGrowthConfig({ recall_weights: { w_f: 0.9 } }).recall_weights)
      .toEqual(DEFAULT_RECALL_WEIGHTS);
    expect(normalizeGrowthConfig({}).recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
    expect(normalizeGrowthConfig(null).recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
  });

  it('A3：合法自定义召回权重原样保留（含 1e-6 浮点容差）', () => {
    const w = { w_f: 0.30, w_i: 0.30, w_c: 0.20, w_a: 0.20 };
    expect(normalizeGrowthConfig({ recall_weights: w }).recall_weights).toEqual(w);
    // 0.1+0.2+0.3+0.4 在浮点下不精确等于 1 → 容差 1e-6 内必须仍判合法
    expect(validRecallWeights({ w_f: 0.1, w_i: 0.2, w_c: 0.3, w_a: 0.4 })).toBe(true);
  });
});

// 批次61 GAP-2（规格 B1 前提）：反馈回灌策略必须默认关闭——升级后老账本行为逐字不变。
describe('反馈回灌策略 feedback_policy（GAP-2 契约层）', () => {
  it('默认关闭：enabled=false / 窗口 30 天 / 阈值 3', () => {
    expect(DEFAULT_FEEDBACK_POLICY).toEqual({ enabled: false, window_days: 30, reject_downgrade_threshold: 3 });
    expect(normalizeGrowthConfig(null).feedback_policy).toEqual(DEFAULT_FEEDBACK_POLICY);
    expect(validFeedbackPolicy(DEFAULT_FEEDBACK_POLICY)).toBe(true);
  });

  it('旧账本（无该字段）→ 默认关闭，不凭空启用降档', () => {
    const got = growthConfigFromLedger([pref(`${GROWTH_PREF_PREFIX}${JSON.stringify({ weights: DEFAULT_WEIGHTS })}`)]);
    expect(got.feedback_policy.enabled).toBe(false);
  });

  it('非法块整块回退默认：非布尔开关 / 窗口越界 / 阈值越界 / 非整数', () => {
    expect(validFeedbackPolicy({ enabled: 'yes', window_days: 30, reject_downgrade_threshold: 3 })).toBe(false);
    expect(validFeedbackPolicy({ enabled: true, window_days: 0, reject_downgrade_threshold: 3 })).toBe(false);
    expect(validFeedbackPolicy({ enabled: true, window_days: 366, reject_downgrade_threshold: 3 })).toBe(false);
    expect(validFeedbackPolicy({ enabled: true, window_days: 30, reject_downgrade_threshold: 0 })).toBe(false);
    expect(validFeedbackPolicy({ enabled: true, window_days: 30, reject_downgrade_threshold: 2.5 })).toBe(false);
    expect(normalizeGrowthConfig({ feedback_policy: { enabled: true, window_days: 30, reject_downgrade_threshold: 0 } })
      .feedback_policy).toEqual(DEFAULT_FEEDBACK_POLICY);
  });

  it('合法显式启用原样保留（用户启用的策略不得被 normalize 关掉）', () => {
    const p = { enabled: true, window_days: 14, reject_downgrade_threshold: 5 };
    expect(normalizeGrowthConfig({ feedback_policy: p }).feedback_policy).toEqual(p);
  });
});
