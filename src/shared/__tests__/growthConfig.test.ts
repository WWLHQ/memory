// 批次48 A23：生长配置单一真源与账本回读（默认回退、坏值丢弃、调度衰减不可停）
import { describe, expect, it } from 'vitest';
import type { Memory } from '../../core/memagent/types.ts';
import { GROWTH_PREF_PREFIX, growthConfigFromLedger } from '../../core/memagent/paramsSnapshot.ts';
import { parseCron } from '../cron.ts';
import {
  DEFAULT_FEEDBACK_POLICY, DEFAULT_RECALL_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, RECALL_KEYS,
  DEFAULT_EVOLUTION, DEFAULT_SCHEDULE_EXPRS, SCHEDULE_MIN_INTERVAL_MIN,
  SCHEDULE_TASKS, normalizeGrowthConfig, normalizeEvolutionConfig, normalizeScheduleExprs,
  resolveScheduleExpr, validEvolutionConfig, validFeedbackPolicy, validRecallWeights, validThresholds,
  validateScheduleExpr, validWeights, minIntervalMinutes, EVOLUTION_MODES,
} from '../growthConfig.ts';
import {
  MIN_NEGATIVES, MIN_SAMPLES, RECALL_SUGGEST_MIN_RECALLS, RECALL_SUGGEST_WINDOW_DAYS,
  REGRESSION_WINDOW_DAYS,
} from '../../core/memagent/regression.ts';

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
    // M0：新增 evolution / schedule_exprs 两块必填字段，未显式给出时取默认（默认即改造前行为）
    // P2-9-③：mode_dispatch 为可选命名空间，未给出 = null（旧账本口径，不伪造词表）
    expect(normalizeGrowthConfig(custom)).toEqual({
      ...custom, evolution: DEFAULT_EVOLUTION, schedule_exprs: DEFAULT_SCHEDULE_EXPRS, mode_dispatch: null,
    });
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

// ==================== M0：自我进化配置（规格 SELF-EVOLUTION §2 / AC M0-5） ====================
describe('M0 evolution 配置（默认值必须等于改造前常量）', () => {
  it('默认值与 regression.ts 历史常量逐字对齐，且 mode 默认 suggest', () => {
    expect(DEFAULT_EVOLUTION.mode).toBe('suggest');
    expect(DEFAULT_EVOLUTION.window.dedup_days).toBe(REGRESSION_WINDOW_DAYS);
    expect(DEFAULT_EVOLUTION.window.recall_days).toBe(RECALL_SUGGEST_WINDOW_DAYS);
    expect(DEFAULT_EVOLUTION.min_samples.dedup_total).toBe(MIN_SAMPLES);
    expect(DEFAULT_EVOLUTION.min_samples.dedup_negatives).toBe(MIN_NEGATIVES);
    expect(DEFAULT_EVOLUTION.min_samples.recall_count).toBe(RECALL_SUGGEST_MIN_RECALLS);
    expect(DEFAULT_EVOLUTION.sample_top_n).toBe(20);
    expect(DEFAULT_EVOLUTION.rollback).toEqual({ after_days: 7, min_recalls: 20, max_drop: 0.03 });
    expect(DEFAULT_EVOLUTION.guard).toEqual({ cooldown_days: 7, max_step: 0.05, max_drift: 0.15 });
    expect(validEvolutionConfig(DEFAULT_EVOLUTION)).toBe(true);
  });

  it('旧账本（无 evolution 字段）→ 默认，行为与改造前逐字一致', () => {
    expect(normalizeGrowthConfig(null).evolution).toEqual(DEFAULT_EVOLUTION);
    expect(normalizeGrowthConfig({ weights: DEFAULT_WEIGHTS }).evolution).toEqual(DEFAULT_EVOLUTION);
  });

  it('M0-5：mode 非法 → suggest，绝不回退 auto', () => {
    for (const bad of ['AUTO', 'on', '', null, 1, undefined]) {
      expect(normalizeEvolutionConfig({ ...DEFAULT_EVOLUTION, mode: bad }).mode).toBe('suggest');
    }
    expect(EVOLUTION_MODES).toEqual(['off', 'suggest', 'auto']);
  });

  it('合法 mode 原样保留（用户显式选 auto/off 不因别的字段脏被降级）', () => {
    const dirtyBody = { ...DEFAULT_EVOLUTION, mode: 'auto', window: { dedup_days: 0, recall_days: 7 } };
    const got = normalizeEvolutionConfig(dirtyBody);
    expect(got.mode).toBe('auto');
    // body 整块回退默认——不按比例把 0 悄悄改成 1
    expect(got.window).toEqual(DEFAULT_EVOLUTION.window);
  });

  it('body 任一字段越界 → 整块回退默认', () => {
    const cases = [
      { window: { dedup_days: 181, recall_days: 7 } },
      { window: { dedup_days: 30, recall_days: 91 } },
      { sample_top_n: 9 },
      { sample_top_n: 51 },
      { min_samples: { ...DEFAULT_EVOLUTION.min_samples, dedup_total: 0 } },
      { rollback: { after_days: 91, min_recalls: 20, max_drop: 0.03 } },
      { rollback: { after_days: 7, min_recalls: -1, max_drop: 0.03 } },
      { rollback: { after_days: 7, min_recalls: 20, max_drop: 0.5 } },
      { guard: { cooldown_days: 0, max_step: 0.05, max_drift: 0.15 } },
      { guard: { cooldown_days: 7, max_step: 0.5, max_drift: 0.15 } },
      { guard: { cooldown_days: 7, max_step: 0.05, max_drift: 0.9 } },
      // 非整数 / 字符串数字 / 缺块
      { sample_top_n: 20.5 },
      { sample_top_n: '20' },
      { window: {} },
    ];
    for (const bad of cases) {
      const got = normalizeEvolutionConfig({ ...DEFAULT_EVOLUTION, ...bad });
      expect(got, JSON.stringify(bad)).toEqual({ ...DEFAULT_EVOLUTION, mode: got.mode });
      expect(got.window).toEqual(DEFAULT_EVOLUTION.window);
      expect(got.min_samples).toEqual(DEFAULT_EVOLUTION.min_samples);
      expect(got.rollback).toEqual(DEFAULT_EVOLUTION.rollback);
      expect(got.guard).toEqual(DEFAULT_EVOLUTION.guard);
    }
  });

  it('合法自定义进化配置原样保留（逐字段重建，未知字段不带回）', () => {
    const custom = {
      mode: 'auto' as const,
      window: { dedup_days: 60, recall_days: 14 },
      sample_top_n: 30,
      min_samples: { dedup_total: 80, dedup_negatives: 20, recall_count: 60, recall_tagged: 20 },
      rollback: { after_days: 14, min_recalls: 40, max_drop: 0.05 },
      guard: { cooldown_days: 14, max_step: 0.03, max_drift: 0.20 },
      evil_extra: 'must-not-leak',
    };
    const got = normalizeEvolutionConfig(custom);
    expect(got).toEqual({
      mode: 'auto', window: custom.window, sample_top_n: 30,
      min_samples: custom.min_samples, rollback: custom.rollback, guard: custom.guard,
    });
    expect(Object.keys(got)).not.toContain('evil_extra');
  });
});

// ==================== M0：调度表达式可配（AC M0-4 / M0-6） ====================
describe('M0 schedule_exprs 调度表达式', () => {
  it('默认值与 SCHEDULE_TASKS.expr 逐字一致（页面与主进程同源）', () => {
    for (const t of SCHEDULE_TASKS) expect(DEFAULT_SCHEDULE_EXPRS[t.key]).toBe(t.expr);
    expect(normalizeScheduleExprs(undefined)).toEqual(DEFAULT_SCHEDULE_EXPRS);
  });

  it('合法自定义保留；非法 key 单独回退，不牵连其他任务', () => {
    const got = normalizeScheduleExprs({
      self_growth: '0 5 * * 1',      // 每周一 05:00：合法
      archive: 'bad-cron',           // 语法非法 → 回退默认
      decay: '0 2 * * *',
      verdict_reminder: '0 8 * * *',
    });
    expect(got.self_growth).toBe('0 5 * * 1');
    expect(got.archive).toBe(DEFAULT_SCHEDULE_EXPRS.archive);
    expect(got.decay).toBe(DEFAULT_SCHEDULE_EXPRS.decay);
  });

  it('M0-6：过密表达式被拒（* * * * * 对任何任务都太密）', () => {
    for (const t of SCHEDULE_TASKS) {
      const chk = validateScheduleExpr(t.key, '* * * * *');
      expect(chk.ok, t.key).toBe(false);
      expect(chk.actual_min).toBe(1);
      expect(chk.reason).toContain('过密');
    }
  });

  it('M0-6：自生长最短 1 天、衰减最短 15 分钟', () => {
    expect(SCHEDULE_MIN_INTERVAL_MIN.self_growth).toBe(1440);
    expect(validateScheduleExpr('self_growth', '0 */6 * * *').ok).toBe(false); // 6 小时
    expect(validateScheduleExpr('self_growth', '0 3 * * 1').ok).toBe(true);    // 每周一
    expect(validateScheduleExpr('decay', '0 */2 * * *').ok).toBe(true);        // 2 小时
    expect(validateScheduleExpr('decay', '0 * * * *').ok).toBe(true);          // 1 小时
  });

  it('账本里塞过密值也不生效（normalize 硬护栏）', () => {
    const got = normalizeScheduleExprs({ self_growth: '*/5 * * * *' });
    expect(got.self_growth).toBe(DEFAULT_SCHEDULE_EXPRS.self_growth);
  });

  it('非法/不可达表达式：validate 给出原因而非静默接受', () => {
    expect(validateScheduleExpr('decay', '0 2 * *').ok).toBe(false);       // 4 段
    expect(validateScheduleExpr('decay', '99 2 * * *').ok).toBe(false);    // 越界
    expect(validateScheduleExpr('decay', '0 2 30 2 *').actual_min).toBeNull(); // 2 月 30 日不可达
  });

  it('resolveScheduleExpr：脏值/缺字段一律回退该任务默认', () => {
    expect(resolveScheduleExpr('self_growth', { self_growth: '0 5 * * 1' })).toBe('0 5 * * 1');
    expect(resolveScheduleExpr('self_growth', { self_growth: 'nope' })).toBe(DEFAULT_SCHEDULE_EXPRS.self_growth);
    expect(resolveScheduleExpr('self_growth', null)).toBe(DEFAULT_SCHEDULE_EXPRS.self_growth);
    expect(resolveScheduleExpr('archive', {})).toBe(DEFAULT_SCHEDULE_EXPRS.archive);
  });

  it('minIntervalMinutes：每周一次 = 10080 分钟，每日 = 1440', () => {
    expect(minIntervalMinutes('0 3 * * 0')).toBe(10080);
    expect(minIntervalMinutes('0 2 * * *')).toBe(1440);
    expect(minIntervalMinutes('0 2 1 * *')).toBeGreaterThanOrEqual(28 * 1440);
  });
});
