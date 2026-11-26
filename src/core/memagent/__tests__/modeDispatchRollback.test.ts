// mode_dispatch 采纳后回诊（方案 MODE-DISPATCH-ROLLBACK.md，2026-11-26）。
// 判据 C：drop > max_drop 且 negatives 净增≥3 才回滚；快照被替换则跳过；局部回退不动其它族。
import { describe, expect, it } from 'vitest';
import {
  computeDispatchBackfill, computeDispatchRollbackPlan, dispatchHitRate,
  type DispatchMetrics,
} from '../evolution/modeDispatchRegression.ts';
import { runDispatchRollbackCheck } from '../evolution/loop.ts';
import { InMemoryStorage } from '../storage.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../paramsSnapshot.ts';
import { normalizeGrowthConfig } from '../../../shared/growthConfig.ts';
import type { AuditRecord } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_700_000_000_000;

const m = (pos: number, neg: number, extra: Partial<DispatchMetrics> = {}): DispatchMetrics => ({
  feedback: pos + neg, linked: pos + neg, unlinked: 0,
  positives: pos, negatives: neg, ignored_content: 0, ignored_other: 0, tagged: pos + neg, ...extra,
});
const audit = (rid: string, ts: number, detail: Record<string, unknown>): AuditRecord =>
  ({ request_id: rid, action: 'growth_op', ts, detail } as AuditRecord);

describe('分流命中率与回诊三态（纯函数）', () => {
  it('命中率 = 👍/(👍+👎模式选错)，零样本返回 null 不猜', () => {
    expect(dispatchHitRate(m(7, 3))).toBeCloseTo(0.7);
    expect(dispatchHitRate(m(0, 0))).toBeNull();
  });

  it('基线样本不足 → 不挂回诊计划', () => {
    expect(computeDispatchRollbackPlan(NOW, m(8, 0), {
      afterDays: 7, minTagged: 10, maxDrop: 0.1, snapshot: {} as never,
    })).toBeNull();
  });

  it('drop>0.10 但负样本净增<3 → kept（C 变异验证：≥3 改 ≥1 本例必须红）', () => {
    const r = computeDispatchBackfill(m(9, 1), m(6, 2), 0.10);
    expect(r.status).toBe('kept');
    expect(r.negative_growth).toBe(1);
  });

  it('drop>0.10 且负样本净增≥3 → rolled_back', () => {
    const r = computeDispatchBackfill(m(9, 1), m(5, 5), 0.10);
    expect(r.status).toBe('rolled_back');
    expect(r.drop).toBeCloseTo(0.4);
    expect(r.negative_growth).toBe(4);
  });

  it('drop≤max_drop → kept，即使负样本净增很多', () => {
    expect(computeDispatchBackfill(m(8, 2), m(7, 3), 0.10).status).toBe('kept');
  });

  it('采纳前基线 ≥10 条 → 计划字段算死（due_at/baseline_rate/max_drop）', () => {
    const snap = { min_len_zh: 30, min_len_en: 12, hit_threshold: 2 } as never;
    const p = computeDispatchRollbackPlan(NOW, m(8, 2), {
      afterDays: 7, minTagged: 10, maxDrop: 0.10, snapshot: snap,
    });
    expect(p).not.toBeNull();
    expect(p!.due_at).toBe(NOW + 7 * DAY);
    expect(p!.baseline_rate).toBeCloseTo(0.8);
    expect(p!.max_drop).toBe(0.10);
  });
});

describe('runDispatchRollbackCheck（端到端）', () => {
  const snap = normalizeGrowthConfig({}).mode_dispatch!;
  async function seed(storage: InMemoryStorage, plan: NonNullable<ReturnType<typeof computeDispatchRollbackPlan>>) {
    const cfg = normalizeGrowthConfig({});
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
    await storage.appendAudit(audit('adopt1', NOW - 8 * DAY, {
      event: 'adopted', family: 'mode_dispatch', applied: true, rollback_plan: plan,
    }));
  }

  it('未到期 → not_due（不写审计）', async () => {
    const storage = new InMemoryStorage();
    const adoptedTs = NOW - 3 * DAY; // due_at = NOW + 4 天，未到期
    const plan = computeDispatchRollbackPlan(adoptedTs, m(9, 1), {
      afterDays: 7, minTagged: 10, maxDrop: 0.1, snapshot: snap,
    })!;
    await storage.appendAudit(audit('adopt_soon', adoptedTs, {
      event: 'adopted', family: 'mode_dispatch', applied: true, rollback_plan: plan,
    }));
    const r = await runDispatchRollbackCheck(storage, { requestId: 'rb1', form: 'desktop', now: NOW });
    expect(r.status).toBe('not_due');
  });

  it('采纳后配置已被替换 → skipped，不回滚用户的新配置', async () => {
    const storage = new InMemoryStorage();
    const plan = computeDispatchRollbackPlan(NOW - 8 * DAY, m(9, 1), {
      afterDays: 7, minTagged: 10, maxDrop: 0.1, snapshot: { ...snap, hit_threshold: 99 },
    })!;
    await seed(storage, plan);
    const before = growthConfigFromLedger(await storage.listMemories({})).mode_dispatch;
    const r = await runDispatchRollbackCheck(storage, { requestId: 'rb2', form: 'desktop', now: NOW, force: true });
    expect(r.status).toBe('skipped');
    expect(growthConfigFromLedger(await storage.listMemories({})).mode_dispatch).toEqual(before);
    const ops = await storage.queryAudit({ action: 'growth_op' });
    expect(ops.some((a) => (a.detail as { event?: string }).event === 'rollback_skipped')).toBe(true);
  });

  it('采纳后有效标注不足 → insufficient，不动配置', async () => {
    const storage = new InMemoryStorage();
    const plan = computeDispatchRollbackPlan(NOW - 8 * DAY, m(9, 1), {
      afterDays: 7, minTagged: 10, maxDrop: 0.1, snapshot: snap,
    })!;
    await seed(storage, plan);
    const r = await runDispatchRollbackCheck(storage, { requestId: 'rb3', form: 'desktop', now: NOW, force: true });
    expect(r.status).toBe('insufficient');
    expect(r.needed).toBeGreaterThan(0);
  });

  it('off 模式 → none，不写任何审计', async () => {
    const storage = new InMemoryStorage();
    const cfg = normalizeGrowthConfig({});
    cfg.evolution.mode = 'off';
    await seed(storage, computeDispatchRollbackPlan(NOW - 8 * DAY, m(9, 1), {
      afterDays: 7, minTagged: 10, maxDrop: 0.1, snapshot: snap,
    })!);
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'off', form: 'desktop' });
    const n = (await storage.queryAudit({ action: 'growth_op' })).length;
    const r = await runDispatchRollbackCheck(storage, { requestId: 'rb4', form: 'desktop', now: NOW, force: true });
    expect(r.status).toBe('none');
    expect((await storage.queryAudit({ action: 'growth_op' })).length).toBe(n);
  });
});
