// 批次48 A23.2：调度运行记录只能来自真实审计（action='schedule_run'）；
// 缺记录 = 未运行，不从 cron 反推「应该跑过」。
import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import { scheduleRunsFromLedger, scheduleReal } from '../useGrowthReal.ts';

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
