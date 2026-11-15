// M5-4：判重族的版本化 + 回诊回滚。
// 口径：回诊基线 = 采纳时写死的测试集 F1（不是 NDCG）；due_at 采纳时算死；回滚只用唯一写入口。
import { describe, expect, it, beforeEach } from 'vitest';
import type { AuditRecord, Memory } from '../types.ts';
import { InMemoryStorage } from '../storage.ts';
import {
  DEFAULT_EVOLUTION, DEFAULT_FEEDBACK_POLICY, DEFAULT_SCHEDULE_EXPRS, DEFAULT_SCHEDULE_FLAGS,
  normalizeGrowthConfig, type GrowthConfig,
} from '../../../shared/growthConfig.ts';
import {
  classify, collectDedupSamples, computeDedupRollbackPlan, runGrowthRegression, splitSamples,
  type DedupRollbackPlan,
} from '../regression.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../paramsSnapshot.ts';
import { configFromHistoryMem, historyMemories } from '../evolution/versioning.ts';
import { runDedupRollbackCheck } from '../evolution/loop.ts';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const DAY = 24 * 3600_000;

const dims = (semantic: number) => ({ semantic, keyword: 0.5, entity: 0.5, structure: 0.5 });

function writeAudit(memId: string, merged: boolean, ts: number): AuditRecord {
  return {
    request_id: `req_${memId}`, action: 'write', form: 'desktop', project_id: 'P1', ts,
    detail: {
      mem_id: memId, dedup: merged ? 'grafted' : 'new',
      dedup_eval: {
        schema_v: 1, layer: 'L1', dims: dims(merged ? 0.7 : 0.3),
        score: 0.5, threshold: 0.5, merged,
      },
    },
  } as AuditRecord;
}

/**
 * L1 阈值可调。注意：六层阈值必须单调不减才合法（`validThresholds`），
 * 所以「旧策略很高」一律写成六层同值，否则会被归一化回默认值，测的就不是旧策略了。
 * 0.9 时旧策略几乎预测不出正例 → 回归有提升空间，必然采纳。
 */
function cfgWith(l1: number): GrowthConfig {
  const base = normalizeGrowthConfig(null);
  return {
    ...base,
    weights: { semantic: 0.25, keyword: 0.25, entity: 0.25, structure: 0.25, llm_judge: 0 },
    thresholds: { L1: l1, L2: Math.max(0.6, l1), L3: Math.max(0.65, l1), L4: Math.max(0.7, l1), L5: Math.max(0.75, l1), L6: Math.max(0.8, l1) },
    schedule: { ...DEFAULT_SCHEDULE_FLAGS },
    feedback_policy: { ...DEFAULT_FEEDBACK_POLICY },
    evolution: { ...DEFAULT_EVOLUTION },
    schedule_exprs: { ...DEFAULT_SCHEDULE_EXPRS },
  };
}

/** 50 条写入（25 正 / 25 负），全部落在 30 天窗内 */
async function seedWrites(storage: InMemoryStorage): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await storage.appendAudit(writeAudit(`mem_${i}`, i % 2 === 0, NOW - i * 60_000));
  }
}

function historyMem(cfg: GrowthConfig, ts: number): Memory {
  return {
    mem_id: `growth_h_${ts}`, project_id: 'P_SYSTEM', user_id: 'system',
    enterprise_id: '', team_id: '', category: 'preference', layer: 'L2',
    content: `growth:v1:history:${JSON.stringify(cfg)}`, decay_class: 'hot',
    pinned: true, locked: false, version: 1, created_at: ts, updated_at: ts,
  };
}

/** 直接种一条「已采纳 + 回诊计划」，用于只测回诊分支 */
async function seedAdoptedPlan(
  storage: InMemoryStorage,
  plan: DedupRollbackPlan,
  ts = NOW - DAY,
): Promise<void> {
  await storage.appendAudit({
    request_id: 'reg_seed', action: 'weight_tuned', form: 'desktop', project_id: 'P_SYSTEM', ts,
    detail: { kind: 'dedup_regression', status: 'adopted', rollback_plan: plan },
  });
}

/** 当前配置在窗口样本上的真实测试集 F1（与回诊同口径，供测试自己算基线） */
async function currentTestF1(storage: InMemoryStorage, at: number): Promise<number> {
  const cfg = growthConfigFromLedger(await storage.listMemories({}));
  const samples = collectDedupSamples(await storage.queryAudit({}), at, cfg.evolution.window.dedup_days);
  const { test } = splitSamples(samples);
  return classify(test, cfg.weights, cfg.thresholds).f1;
}

describe('M5-4 判重采纳：版本化 + 回诊计划', () => {
  let storage: InMemoryStorage;
  beforeEach(() => { storage = new InMemoryStorage(); });

  it('采纳前存上一版：history 可逐字还原采纳前 weights/thresholds', async () => {
    const pre = cfgWith(0.9);
    await saveGrowthConfigToLedger(storage, pre, { requestId: 'seed', form: 'desktop' });
    await seedWrites(storage);

    const r = await runGrowthRegression(storage, { requestId: 'reg1', form: 'desktop', now: NOW });
    expect(r.status).toBe('adopted');

    const hs = historyMemories(await storage.listMemories({}));
    expect(hs).toHaveLength(1);
    const restored = configFromHistoryMem(hs[0])!;
    expect(restored.weights).toEqual(pre.weights);
    expect(restored.thresholds).toEqual(pre.thresholds);
    // 现行配置确实已换（否则「能还原」没有意义）
    expect(growthConfigFromLedger(await storage.listMemories({})).thresholds)
      .not.toEqual(pre.thresholds);
  });

  it('采纳审计带 rollback_plan（family=dedup_weights、基线=测试集 F1、due_at 采纳时算死）', async () => {
    await saveGrowthConfigToLedger(storage, cfgWith(0.9), { requestId: 'seed', form: 'desktop' });
    await seedWrites(storage);
    const r = await runGrowthRegression(storage, { requestId: 'reg2', form: 'desktop', now: NOW });
    expect(r.status).toBe('adopted');

    const tuned = (await storage.queryAudit({ action: 'weight_tuned' }))[0];
    const d = tuned.detail as { rollback_plan: DedupRollbackPlan; history_saved: boolean };
    expect(d.history_saved).toBe(true);
    expect(d.rollback_plan.family).toBe('dedup_weights');
    expect(d.rollback_plan.due_at).toBe(NOW + 7 * DAY);
    expect(d.rollback_plan.min_samples).toBe(40);
    if (r.status === 'adopted') {
      expect(d.rollback_plan.baseline_test_f1).toBe(r.after.test.f1);
    }
  });

  it('computeDedupRollbackPlan：due_at 只由采纳时刻与 after_days 决定（不跟后续配置走）', () => {
    const plan = computeDedupRollbackPlan(NOW, { after_days: 7, max_drop: 0.03 }, 0.8);
    expect(plan.due_at).toBe(NOW + 7 * DAY);
    const later = computeDedupRollbackPlan(NOW, { after_days: 30, max_drop: 0.03 }, 0.8);
    expect(later.due_at).toBe(NOW + 30 * DAY);
  });
});

describe('M5-4 判重回诊（runDedupRollbackCheck）', () => {
  let storage: InMemoryStorage;
  beforeEach(() => { storage = new InMemoryStorage(); });

  it('未跌破允许跌幅 → rollback_kept，配置不动', async () => {
    const cfg = cfgWith(0.5);
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
    await seedWrites(storage);
    const f1 = await currentTestF1(storage, NOW + 8 * DAY);
    const plan: DedupRollbackPlan = {
      family: 'dedup_weights', adopted_ts: NOW - DAY, due_at: NOW + 7 * DAY,
      min_samples: 40, max_drop: 0.03, baseline_test_f1: f1,
    };
    await seedAdoptedPlan(storage, plan);

    const rb = await runDedupRollbackCheck(storage, { requestId: 'rb1', form: 'desktop', now: NOW + 8 * DAY });
    expect(rb.status).toBe('ok');
    expect(growthConfigFromLedger(await storage.listMemories({})).thresholds).toEqual(cfg.thresholds);

    const op = (await storage.queryAudit({ action: 'growth_op' })).find(
      (a) => (a.detail as { event?: string }).event === 'rollback_kept',
    )!;
    const d = op.detail as { family?: string; phase?: string; reason?: string };
    expect(d.family).toBe('dedup_weights');
    expect(d.phase).toBe('rollback');
    expect(d.reason).toContain('判重回诊通过');
  });

  it('跌破 baseline−max_drop → rolled_back，配置回滚到历史版本', async () => {
    const cfg = cfgWith(0.5);
    const previous = cfgWith(0.9);
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
    await storage.putMemory(historyMem(previous, NOW - 2 * DAY));
    await seedWrites(storage);
    const f1 = await currentTestF1(storage, NOW + 8 * DAY);
    const plan: DedupRollbackPlan = {
      family: 'dedup_weights', adopted_ts: NOW - DAY, due_at: NOW + 7 * DAY,
      min_samples: 40, max_drop: 0.03, baseline_test_f1: f1 + 0.1, // 基线远高于现状
    };
    await seedAdoptedPlan(storage, plan);

    const rb = await runDedupRollbackCheck(storage, { requestId: 'rb2', form: 'desktop', now: NOW + 8 * DAY });
    expect(rb.status).toBe('rolled_back');
    // 回滚 = 还原上一版（六层阈值回到 0.9），历史被消费
    expect(growthConfigFromLedger(await storage.listMemories({})).thresholds).toEqual(previous.thresholds);
    expect(historyMemories(await storage.listMemories({}))).toHaveLength(0);

    const op = (await storage.queryAudit({ action: 'growth_op' })).find(
      (a) => (a.detail as { event?: string }).event === 'rolled_back',
    )!;
    expect((op.detail as { reason?: string }).reason).toContain('判重回诊未通过');
  });

  it('窗口样本不足 → insufficient，写明还需多少条，且不动配置', async () => {
    const cfg = cfgWith(0.5);
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
    await seedWrites(storage);
    const plan: DedupRollbackPlan = {
      family: 'dedup_weights', adopted_ts: NOW - DAY, due_at: NOW + 7 * DAY,
      min_samples: 100, max_drop: 0.03, baseline_test_f1: 0.5,
    };
    await seedAdoptedPlan(storage, plan);

    const rb = await runDedupRollbackCheck(storage, { requestId: 'rb3', form: 'desktop', now: NOW + 8 * DAY });
    expect(rb.status).toBe('insufficient');
    expect(rb.needed).toBe(50);
    expect(growthConfigFromLedger(await storage.listMemories({})).thresholds).toEqual(cfg.thresholds);
    const op = (await storage.queryAudit({ action: 'growth_op' }))[0];
    expect((op.detail as { reason?: string }).reason).toContain('还需 50 条');
  });

  it('未到期 → not_due 且不写审计；force 可提前回诊', async () => {
    await saveGrowthConfigToLedger(storage, cfgWith(0.5), { requestId: 'seed', form: 'desktop' });
    await seedWrites(storage);
    const f1 = await currentTestF1(storage, NOW + DAY);
    const plan: DedupRollbackPlan = {
      family: 'dedup_weights', adopted_ts: NOW - DAY, due_at: NOW + 30 * DAY,
      min_samples: 40, max_drop: 0.03, baseline_test_f1: f1,
    };
    await seedAdoptedPlan(storage, plan);

    const notDue = await runDedupRollbackCheck(storage, { requestId: 'rb4', form: 'desktop', now: NOW });
    expect(notDue.status).toBe('not_due');
    expect(await storage.queryAudit({ action: 'growth_op' })).toHaveLength(0);

    const forced = await runDedupRollbackCheck(storage, { requestId: 'rb5', form: 'desktop', now: NOW, force: true });
    expect(forced.status).toBe('ok');
  });

  it('mode=off → none 且零审计；无任何采纳计划 → none', async () => {
    const cfg = cfgWith(0.5);
    await saveGrowthConfigToLedger(storage, {
      ...cfg, evolution: { ...cfg.evolution, mode: 'off' },
    }, { requestId: 'seed', form: 'desktop' });
    await seedWrites(storage);
    const plan: DedupRollbackPlan = {
      family: 'dedup_weights', adopted_ts: NOW - DAY, due_at: NOW + 7 * DAY,
      min_samples: 40, max_drop: 0.03, baseline_test_f1: 0.5,
    };
    await seedAdoptedPlan(storage, plan);
    expect((await runDedupRollbackCheck(storage, { requestId: 'rb6', form: 'desktop', now: NOW + 8 * DAY })).status)
      .toBe('none');
    expect(await storage.queryAudit({ action: 'growth_op' })).toHaveLength(0);

    const empty = new InMemoryStorage();
    await saveGrowthConfigToLedger(empty, cfgWith(0.5), { requestId: 'seed2', form: 'desktop' });
    expect((await runDedupRollbackCheck(empty, { requestId: 'rb7', form: 'desktop', now: NOW })).status).toBe('none');
  });
});
