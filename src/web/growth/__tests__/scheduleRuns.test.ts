// 批次48 A23.2：调度运行记录只能来自真实审计（action='schedule_run'）；
// 缺记录 = 未运行，不从 cron 反推「应该跑过」。
import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import { regressionOutcomeFromLedger, scheduleRunsFromLedger, scheduleReal } from '../useGrowthReal.ts';
import { regressionStatusText } from '../GrowthPanels.tsx';

function audit(o: Partial<AuditRecord> & { detail?: Record<string, unknown> }): AuditRecord {
  return {
    request_id: o.request_id ?? 'req_x',
    action: o.action ?? 'schedule_run',
    form: o.form ?? 'desktop',
    project_id: o.project_id ?? 'P_SYSTEM',
    ts: o.ts ?? 1_800_000_000_000,
    ...o,
  } as AuditRecord;
}

describe('scheduleRunsFromLedger', () => {
  it('无记录 → 空映射（页面据此显示未运行）', () => {
    expect(scheduleRunsFromLedger([])).toEqual({});
    expect(scheduleRunsFromLedger([audit({ action: 'write' })])).toEqual({});
  });

  it('每个任务只取最近一条，字段全部来自审计', () => {
    const runs = scheduleRunsFromLedger([
      audit({ ts: 100, detail: { task: 'decay', status: 'ok', host: 'electron-main', duration_ms: 12, next_due_at: 900 } }),
      audit({ ts: 300, detail: { task: 'decay', status: 'skipped', host: 'electron-main', duration_ms: 3, next_due_at: 1900, result: { reason: 'auto_policy_disabled' } } }),
      audit({ ts: 200, detail: { task: 'archive', status: 'ok', host: 'electron-main', duration_ms: 5, next_due_at: 2500, result: { archived: 2 } } }),
    ]);
    expect(Object.keys(runs).sort()).toEqual(['archive', 'decay']);
    expect(runs.decay?.ts).toBe(300);
    expect(runs.decay?.status).toBe('skipped');
    expect(runs.decay?.next_due_at).toBe(1900);
    expect(runs.decay?.result.reason).toBe('auto_policy_disabled');
    expect(runs.archive?.result.archived).toBe(2);
  });

  it('未知任务/坏字段如实降级：host=unknown、status=skipped、null 不编造', () => {
    const runs = scheduleRunsFromLedger([
      audit({ ts: 10, detail: { task: 'made_up', status: 'ok' } }),
      audit({ ts: 11, detail: { task: 'self_growth', status: 'weird', duration_ms: 'x', next_due_at: 'y' } }),
    ]);
    expect(runs.self_growth?.host).toBe('unknown');
    expect(runs.self_growth?.status).toBe('skipped');
    expect(runs.self_growth?.duration_ms).toBeNull();
    expect(runs.self_growth?.next_due_at).toBeNull();
    expect(runs.self_growth?.error).toBeNull();
  });

  it('页面调度项本身不带任何伪造运行信息', () => {
    const items = scheduleReal();
    expect(items.map((s) => s.key)).toEqual(['decay', 'verdict_reminder', 'self_growth', 'archive']);
    for (const s of items) expect(s.run).toBeUndefined();
  });
});

describe('regressionOutcomeFromLedger × regressionStatusText（四态必须可区分）', () => {
  const counts = { total: 12, positives: 6, negatives: 6, window_days: 30 };

  it('无记录 → never_run（未到运行时间，不冒充「无变化」）', () => {
    const r = regressionOutcomeFromLedger([audit({ action: 'write' })]);
    expect(r).toEqual({ kind: 'never_run', ts: null });
    expect(regressionStatusText(r)).toContain('未到运行时间');
  });

  it('样本不足 → insufficient_samples + counts，并注明正在积累样本', () => {
    const r = regressionOutcomeFromLedger([
      audit({ ts: 5, action: 'insufficient_samples', detail: { kind: 'dedup_regression', ...counts } }),
    ]);
    expect(r.kind).toBe('insufficient_samples');
    expect(r.counts).toEqual(counts);
    const text = regressionStatusText(r);
    expect(text).toContain('样本不足');
    expect(text).toContain('12');
    expect(text).toContain('非故障');
  });

  it('已评估未达门槛 → not_adopted + reason + 前后测试指标', () => {
    const r = regressionOutcomeFromLedger([
      audit({
        ts: 6, action: 'weight_regression',
        detail: {
          kind: 'dedup_regression', status: 'not_adopted', reason: 'f1_gain_below_threshold',
          counts, before: { test: { f1: 0.9, precision: 0.88 } }, after: { test: { f1: 0.905, precision: 0.87 } },
        },
      }),
    ]);
    expect(r.kind).toBe('not_adopted');
    expect(r.reason).toBe('f1_gain_below_threshold');
    expect(r.before).toEqual({ f1: 0.9, precision: 0.88 });
    expect(r.after).toEqual({ f1: 0.905, precision: 0.87 });
    const text = regressionStatusText(r);
    expect(text).toContain('已评估未达门槛');
    expect(text).toContain('0.9');
    expect(text).toContain('未采纳');
  });

  it('已采纳 → adopted + 前后测试指标，文案与前三态互不相同', () => {
    const r = regressionOutcomeFromLedger([
      audit({
        ts: 7, action: 'weight_tuned',
        detail: {
          kind: 'dedup_regression', status: 'adopted', counts,
          metrics: { before: { test: { f1: 0.62, precision: 0.75 } }, after: { test: { f1: 0.88, precision: 0.74 } } },
        },
      }),
    ]);
    expect(r.kind).toBe('adopted');
    expect(r.before).toEqual({ f1: 0.62, precision: 0.75 });
    expect(r.after).toEqual({ f1: 0.88, precision: 0.74 });
    expect(regressionStatusText(r)).toContain('已采纳');
    expect(regressionStatusText(r)).toContain('0.88');
  });

  it('取最近一条：先不足后可采纳 → 以最新结论为准；无关 kind 一律忽略', () => {
    const r = regressionOutcomeFromLedger([
      audit({ ts: 1, action: 'insufficient_samples', detail: { kind: 'dedup_regression', ...counts } }),
      audit({ ts: 2, action: 'growth_op', detail: { entry: { event: 'weight_tuned' } } }), // 历史页面临时记录，不算回归结论
      audit({ ts: 3, action: 'weight_tuned', detail: { kind: 'dedup_regression', status: 'adopted', counts } }),
    ]);
    expect(r.kind).toBe('adopted');
    expect(r.ts).toBe(3);
  });

  it('文案四态两两不同（不得混成一个「无变化」）', () => {
    const never = regressionStatusText({ kind: 'never_run', ts: null });
    const insuf = regressionStatusText({ kind: 'insufficient_samples', ts: 1, counts });
    const notAd = regressionStatusText({ kind: 'not_adopted', ts: 2, reason: 'f1_gain_below_threshold' });
    const adopted = regressionStatusText({ kind: 'adopted', ts: 3 });
    const all = [never, insuf, notAd, adopted];
    expect(new Set(all).size).toBe(4);
    for (const t of all) expect(t).not.toBe('无变化');
  });
});
