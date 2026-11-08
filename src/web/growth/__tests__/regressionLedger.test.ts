// 回归评估 + Δ 曲线取数口径：只认真实 weight_tuned / 回归审计，四态如实区分。
import { describe, expect, it } from 'vitest';
import { deltaSeriesFromLedger, regressionRecordsFromLedger } from '../useGrowthReal.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';

function audit(
  action: string,
  detail: Record<string, unknown>,
  ts: number,
  requestId = `req_${ts}`,
): AuditRecord {
  return {
    request_id: requestId, action, form: 'desktop', project_id: 'P1',
    ts, detail,
  } as AuditRecord;
}

const TEST = (f1: number, precision: number) => ({ train: { f1, precision }, test: { f1, precision } });

describe('Δ 曲线只取真实 weight_tuned 事件', () => {
  it('空账本 = 空数组（空态，不造点）', () => {
    expect(deltaSeriesFromLedger([])).toEqual([]);
  });

  it('回归采纳（action=weight_tuned）Δ = 测试集 F1 提升；非 weight_tuned 事件忽略', () => {
    const audits: AuditRecord[] = [
      audit('recall', { hits: 3 }, 1000),
      audit('weight_tuned', {
        kind: 'dedup_regression',
        metrics: { before: TEST(0.612, 0.7), after: TEST(0.648, 0.685) },
      }, 2000, 'reg_1'),
      audit('growth_op', { entry: { event: 'schedule_changed', action: 'toggle_x', payload: '{}', at: 3000 } }, 3000),
    ];
    const series = deltaSeriesFromLedger(audits);
    expect(series).toHaveLength(1);
    expect(series[0].delta).toBeCloseTo(0.036, 3);
    expect(series[0].is_tuned).toBe(true);
  });

  it('历史 growth_op(weight_tuned) 仍取 payload.delta_before', () => {
    const audits: AuditRecord[] = [
      audit('growth_op', {
        entry: { event: 'weight_tuned', action: 'tune', payload: JSON.stringify({ delta_before: 0.18 }), at: 4000 },
      }, 4000),
    ];
    const series = deltaSeriesFromLedger(audits);
    expect(series).toHaveLength(1);
    expect(series[0].delta).toBeCloseTo(0.18, 2);
  });
});

describe('回归四态逐条记录', () => {
  it('样本不足 / 已评估未采纳 / 已采纳三态字段如实映射，缺失字段保持 undefined', () => {
    const audits: AuditRecord[] = [
      audit('insufficient_samples', {
        kind: 'dedup_regression', total: 12, positives: 3, negatives: 9, window_days: 30,
      }, 1000, 'reg_a'),
      audit('weight_regression', {
        kind: 'dedup_regression', reason: 'precision_drop_over_threshold',
        counts: { total: 40, positives: 10, negatives: 30, window_days: 30 },
        before: { train: { f1: 0.6, precision: 0.8 }, test: { f1: 0.62, precision: 0.81 } },
        after: { train: { f1: 0.61, precision: 0.7 }, test: { f1: 0.63, precision: 0.74 } },
      }, 2000, 'reg_b'),
      audit('weight_tuned', {
        kind: 'dedup_regression',
        counts: { total: 40, positives: 10, negatives: 30, window_days: 30 },
        metrics: { before: TEST(0.60, 0.80), after: TEST(0.65, 0.79) },
      }, 3000, 'reg_c'),
      audit('weight_regression', { kind: 'other' }, 4000, 'reg_d'),
    ];
    const rows = regressionRecordsFromLedger(audits);
    expect(rows).toHaveLength(3);                       // kind!=='dedup_regression' 被忽略
    expect(rows.map((r) => r.kind)).toEqual(['adopted', 'not_adopted', 'insufficient_samples']);

    const [adopted, notAdopted, insufficient] = rows;
    expect(adopted.applied).toBe(true);
    expect(adopted.before?.f1).toBeCloseTo(0.60);
    expect(adopted.after?.f1).toBeCloseTo(0.65);
    expect(adopted.counts?.total).toBe(40);

    expect(notAdopted.applied).toBe(false);
    expect(notAdopted.reason).toBe('precision_drop_over_threshold');
    expect(notAdopted.after?.precision).toBeCloseTo(0.81 - 0.07);  // 仅校验字段来源，不做业务裁决

    expect(insufficient.applied).toBe(false);
    expect(insufficient.counts?.total).toBe(12);
    expect(insufficient.before).toBeUndefined();
    expect(insufficient.reason).toBeUndefined();
  });
});
