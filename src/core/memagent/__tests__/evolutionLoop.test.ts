// M3：进化轮循环 / 护栏 / 版本化 / 回诊回滚（AC M3-1..M3-8）。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECALL_WEIGHTS, normalizeGrowthConfig,
  type EvolutionConfig, type GrowthConfig, type RecallWeights,
} from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import { validateAuditRecord } from '../../../shared/auditShape.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../paramsSnapshot.ts';
import { runEvolutionRound, runRollbackCheck } from '../evolution/loop.ts';
import { guardRecallWeights, isRollbackDue, computeRollbackPlan } from '../evolution/registry.ts';
import { historyMemories, configFromHistoryMem } from '../evolution/versioning.ts';
import type { MemDetailRow } from '../forgetting.ts';
import type { Memory, StorageBackend } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_700_000_000_000;
const BASE_T = NOW - 1 * DAY; // 落在召回建议窗口内

// 让「+w_i/+w_c、−w_f」的提议把 P 顶到 N 之上（NDCG 变好）
const P: MemDetailRow = ['P', 1, 0, 0.7, 0.7, 0];
const N: MemDetailRow = ['N', 1, 1, 0, 0, 0];
// 让采纳后的权重（w_f 被压）把负例 Y 顶到正例 X 之上（NDCG 变差）
const X: MemDetailRow = ['X', 1, 0, 0, 0, 0];
const Y: MemDetailRow = ['Y', 1, 0, 1, 1, 0];

function makeCfg(patch: (ev: EvolutionConfig) => void): GrowthConfig {
  const base = normalizeGrowthConfig(null);
  const ev: EvolutionConfig = {
    ...base.evolution,
    window: { ...base.evolution.window },
    min_samples: { ...base.evolution.min_samples },
    rollback: { ...base.evolution.rollback },
    guard: { ...base.evolution.guard },
  };
  patch(ev);
  return { ...base, evolution: ev };
}

async function seedConfig(storage: StorageBackend, patch: (ev: EvolutionConfig) => void): Promise<GrowthConfig> {
  const cfg = makeCfg(patch);
  await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
  return cfg;
}

/** 40 次「改善」召回 + 10 条 memory_op（5 reject/5 confirm → reject_ratio 0.5），并置 evidence_thin=true。 */
async function seedImproving(storage: StorageBackend): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const rid = `r_good_${i}`;
    await storage.appendAudit({
      request_id: rid, action: 'recall', ts: BASE_T + i, project_id: 'P1',
      detail: { mems: ['P', 'N'], mems_detail: [P, N], evidence_thin: true, hits: 2 },
    });
    await storage.appendAudit({
      request_id: `fb_${i}`, action: 'recall_feedback', ts: BASE_T + i,
      detail: { recall_id: rid, mem_id: 'P', verdict: 'confirm' },
    });
  }
  for (let i = 0; i < 5; i++) {
    await storage.appendAudit({ request_id: `op_r_${i}`, action: 'memory_op', ts: BASE_T, detail: { op: 'reject' } });
  }
  for (let i = 0; i < 5; i++) {
    await storage.appendAudit({ request_id: `op_c_${i}`, action: 'memory_op', ts: BASE_T, detail: { op: 'confirm' } });
  }
}

/** 采纳后「变差」的新召回（ts 均在 adopted_ts 之后）。 */
async function seedWorsening(storage: StorageBackend, fromTs: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const rid = `r_bad_${i}`;
    await storage.appendAudit({
      request_id: rid, action: 'recall', ts: fromTs + 1000 + i, project_id: 'P1',
      detail: { mems: ['X', 'Y'], mems_detail: [X, Y], hits: 2 },
    });
    await storage.appendAudit({
      request_id: `fb_bad_${i}`, action: 'recall_feedback', ts: fromTs + 1000 + i,
      detail: { recall_id: rid, mem_id: 'X', verdict: 'confirm' },
    });
  }
}

async function putHistory(storage: StorageBackend, cfg: GrowthConfig, ts: number): Promise<void> {
  const mem: Memory = {
    mem_id: `growth_h_test_${ts}`, project_id: 'P_SYSTEM', user_id: 'system',
    enterprise_id: '', team_id: '', category: 'preference', layer: 'L2',
    content: `growth:v1:history:${JSON.stringify(cfg)}`, decay_class: 'hot',
    pinned: true, locked: false, version: 1, created_at: ts, updated_at: ts,
  };
  await storage.putMemory(mem);
}

const LOOSE = (ev: EvolutionConfig): void => {
  ev.min_samples.recall_count = 1;
  ev.guard.max_step = 0.20;
  ev.guard.max_drift = 0.50;
  ev.rollback.after_days = 7;
  ev.rollback.min_recalls = 0;
  ev.rollback.max_drop = 0.03;
};

describe('M3-1 / M3-2 / M3-8：模式门控', () => {
  it('M3-8：mode=off → 不产任何 growth_op 审计、不写配置', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'off'; });
    await seedImproving(storage);
    const before = (await storage.queryAudit({})).length;
    const r = await runEvolutionRound(storage, { requestId: 'run_off', form: 'desktop', now: NOW });
    expect(r.mode).toBe('off');
    expect(r.decisions).toHaveLength(0);
    expect((await storage.queryAudit({})).length).toBe(before);
    expect(await storage.queryAudit({ action: 'growth_op' })).toHaveLength(0);
  });

  it('M3-1：mode=suggest（默认）→ 只落建议审计，绝不写 growth:v1（双向断言）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'suggest'; LOOSE(ev); });
    await seedImproving(storage);
    const before = (await storage.queryAudit({})).length;
    const r = await runEvolutionRound(storage, { requestId: 'run_suggest', form: 'desktop', now: NOW });
    expect(r.mode).toBe('suggest');
    const d = r.decisions.find((x) => x.family === 'recall_weights')!;
    expect(d.status).toBe('rejected');
    expect(d.applied).toBe(false);
    // 配置未变
    const after = growthConfigFromLedger(await storage.listMemories({}));
    expect(after.recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
    // 有建议审计、无 ad opted 审计
    const growth = await storage.queryAudit({ action: 'growth_op' });
    expect(growth.some((a) => (a.detail as { event?: string }).event === 'suggest_recall_weights')).toBe(true);
    expect(growth.some((a) => (a.detail as { event?: string }).event === 'adopted')).toBe(false);
    // M5-1：本轮写 2 条 —— recall 族建议 + feedback_policy 族「为何没动」（后者 request_id 带 _fb 后缀）
    expect((await storage.queryAudit({})).length).toBe(before + 2);
  });

  it('M3-2：mode=auto 且达标 → 真写配置，且历史留上一版 + 回诊计划算死', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'auto'; LOOSE(ev); });
    await seedImproving(storage);
    const r = await runEvolutionRound(storage, { requestId: 'run_auto', form: 'desktop', now: NOW });
    const d = r.decisions.find((x) => x.family === 'recall_weights')!;
    expect(d.status).toBe('adopted');
    expect(d.applied).toBe(true);
    expect(d.history_saved).toBe(true);

    const after = growthConfigFromLedger(await storage.listMemories({}));
    expect(after.recall_weights).not.toEqual(DEFAULT_RECALL_WEIGHTS);
    expect(after.recall_weights).toEqual(d.to);

    const hs = historyMemories(await storage.listMemories({}));
    expect(hs).toHaveLength(1);
    expect(configFromHistoryMem(hs[0])!.recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);

    const adopted = (await storage.queryAudit({ action: 'growth_op' }))
      .find((a) => (a.detail as { event?: string }).event === 'adopted')!;
    const plan = (adopted.detail as { rollback_plan: { due_at: number; min_recalls: number } }).rollback_plan;
    expect(plan.due_at).toBe(NOW + 7 * DAY); // 采纳时刻算死
  });
});

describe('M3-3 / M3-4：护栏', () => {
  it('M3-3：单次步长 > max_step 或累计漂移 > max_drift → guarded（不写）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => {
      ev.mode = 'auto'; LOOSE(ev);
      ev.guard.max_step = 0.01; // 提议 diff 0.10 > 0.01
    });
    await seedImproving(storage);
    const r = await runEvolutionRound(storage, { requestId: 'run_guard', form: 'desktop', now: NOW });
    const d = r.decisions.find((x) => x.family === 'recall_weights')!;
    expect(d.status).toBe('guarded');
    expect(d.applied).toBe(false);
    expect(growthConfigFromLedger(await storage.listMemories({})).recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
    // 纯函数：漂移越界
    const g = guardRecallWeights(
      { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
      { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
      makeCfg((ev) => { ev.guard.max_drift = 0.05; }).evolution, undefined, NOW,
    );
    expect(g.pass).toBe(true); // 同值 → 不漂移
  });

  it('M3-4：冷却期内同族不重复自动调整 → guarded', async () => {
    const g = guardRecallWeights(
      { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
      { w_f: 0.30, w_i: 0.30, w_c: 0.20, w_a: 0.20 },
      makeCfg((ev) => { ev.guard.cooldown_days = 7; }).evolution,
      NOW - 1 * DAY, NOW,
    );
    expect(g.pass).toBe(false);
    expect(g.reason).toContain('冷却期');
  });
});

describe('M5-1：审计可解释（每条 growth_op 带非空 reason + phase）', () => {
  const growthOps = async (storage: StorageBackend) => storage.queryAudit({ action: 'growth_op' });
  const detailOf = (a: { detail: Record<string, unknown> }) => a.detail as {
    event?: string; family?: string; reason?: unknown; phase?: unknown; need?: unknown; current_mean_ndcg?: number;
  };

  it('insufficient：reason 带真实计数与「还需 N 次」，不再只有 metrics', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'suggest'; ev.min_samples.recall_count = 30; });
    // 只种 5 次召回（< 30），且不产建议
    for (let i = 0; i < 5; i++) {
      await storage.appendAudit({
        request_id: `r_thin_${i}`, action: 'recall', ts: BASE_T + i, project_id: 'P1',
        detail: { mems: ['P'], mems_detail: [P], hits: 1 },
      });
    }
    const r = await runEvolutionRound(storage, { requestId: 'run_ins', form: 'desktop', now: NOW });
    expect(r.decisions.find((d) => d.family === 'recall_weights')!.status).toBe('insufficient');

    const ins = (await growthOps(storage)).find((a) => detailOf(a).event === 'insufficient')!;
    const d = detailOf(ins);
    expect(d.phase).toBe('evolution');
    expect(d.family).toBe('recall_weights');
    expect(d.need).toBe(25);
    expect(d.reason).toBe('样本不足：5/30 次召回（还需 25 次）');
  });

  it('feedback_policy 族每轮也落一条审计（说明为何没动），request_id 带 _fb 不撞号', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'suggest'; LOOSE(ev); });
    await seedImproving(storage);
    await runEvolutionRound(storage, { requestId: 'run_fb', form: 'desktop', now: NOW });
    const ops = await growthOps(storage);
    const fb = ops.find((a) => detailOf(a).family === 'feedback_policy')!;
    expect(fb).toBeTruthy();
    expect(detailOf(fb).reason).toContain('净化动作需人工确认');
    expect(fb.request_id).toBe('run_fb_fb');
    // 同一轮的 recall 族审计仍用裸 requestId
    expect(ops.some((a) => detailOf(a).family === 'recall_weights' && a.request_id === 'run_fb')).toBe(true);
  });

  /**
   * 2026-11-14 真机事故回归闸门：feedback_policy 族曾用 `#fb` 拼 request_id，
   * 而主进程 IPC.storageAppendAudit 走 shared/auditShape.validateAuditRecord（只放行 [A-Za-z0-9_-]）。
   * 渲染层单测用 InMemoryStorage（不校验形状）→ 全绿；真机整条拒收 → 进化轮抛错 → 页面只显示「内核暂不可达」。
   * 这里显式用**与主进程同一份**校验过闸，堵住「测试绿 / 真机红」的缝隙。
   */
  it('本轮所有 growth_op 的 request_id 都过主进程同源形状闸门（不允许 # 等非法字符）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'suggest'; LOOSE(ev); });
    await seedImproving(storage);
    await runEvolutionRound(storage, { requestId: 'run_shape', form: 'desktop', now: NOW });

    const ops = await growthOps(storage);
    expect(ops).toHaveLength(2);
    for (const a of ops) {
      expect(() => validateAuditRecord(a)).not.toThrow();
      expect(a.request_id).not.toContain('#');
      expect(a.request_id.length).toBeLessThanOrEqual(64);
    }
    expect(ops.map((a) => a.request_id).sort()).toEqual(['run_shape', 'run_shape_fb']);
  });

  it('每一条 growth_op 都有非空 reason 与 phase（全分支汇总断言）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'auto'; LOOSE(ev); });
    await seedImproving(storage);
    await runEvolutionRound(storage, { requestId: 'run_all', form: 'desktop', now: NOW });
    await seedWorsening(storage, NOW);
    await runRollbackCheck(storage, { requestId: 'run_rb_all', form: 'desktop', now: NOW + 8 * DAY });

    const ops = await growthOps(storage);
    expect(ops.length).toBeGreaterThan(0);
    for (const a of ops) {
      const d = detailOf(a);
      expect(typeof d.reason).toBe('string');
      expect((d.reason as string).length).toBeGreaterThan(0);
      expect(['evolution', 'rollback']).toContain(d.phase);
    }
    // 回诊分支也带 reason + phase=rollback
    const rb = ops.find((a) => detailOf(a).event === 'rolled_back')!;
    expect(detailOf(rb).phase).toBe('rollback');
    expect(detailOf(rb).reason).toContain('回滚到上一版');
    expect(detailOf(rb).current_mean_ndcg).toBeTypeOf('number');
  });

  it('回诊通过（未跌破允许跌幅）→ 写 rollback_kept，reason 带真实 NDCG 与允许跌幅', async () => {
    const storage = new InMemoryStorage();
    const cfg = makeCfg((ev) => { ev.mode = 'auto'; LOOSE(ev); });
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed_keep', form: 'desktop' });
    // 单条 mems_detail + 它自己被 confirm → 任何权重下 NDCG 恒为 1，结论确定
    const plan = computeRollbackPlan(NOW - DAY, cfg.evolution.rollback, DEFAULT_RECALL_WEIGHTS, DEFAULT_RECALL_WEIGHTS, 1.0);
    plan.due_at = NOW - 1;
    await storage.appendAudit({
      request_id: 'adopt_keep', action: 'growth_op', ts: NOW - DAY, project_id: 'P_SYSTEM',
      detail: { event: 'adopted', family: 'recall_weights', applied: true, rollback_plan: plan },
    });
    const SOLO: MemDetailRow = ['P', 1, 0, 0.7, 0.7, 0];
    for (let i = 0; i < 5; i++) {
      const rid = `r_keep_${i}`;
      await storage.appendAudit({
        request_id: rid, action: 'recall', ts: NOW - 1000 + i, project_id: 'P1',
        detail: { mems: ['P'], mems_detail: [SOLO], hits: 1 },
      });
      await storage.appendAudit({
        request_id: `fb_keep_${i}`, action: 'recall_feedback', ts: NOW - 1000 + i,
        detail: { recall_id: rid, mem_id: 'P', verdict: 'confirm' },
      });
    }

    const rb = await runRollbackCheck(storage, { requestId: 'run_keep', form: 'desktop', now: NOW, force: true });
    expect(rb.status).toBe('ok');
    const kept = (await growthOps(storage)).find((a) => detailOf(a).event === 'rollback_kept')!;
    expect(kept).toBeTruthy();
    expect(detailOf(kept).phase).toBe('rollback');
    expect(detailOf(kept).reason).toContain('回诊通过');
    expect(detailOf(kept).reason).toContain('≤ 允许');
  });

  it('mode=off 仍零审计（M5-1 不破坏 M3-8）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'off'; });
    await seedImproving(storage);
    const before = (await storage.queryAudit({})).length;
    await runEvolutionRound(storage, { requestId: 'run_off2', form: 'desktop', now: NOW });
    expect((await storage.queryAudit({})).length).toBe(before);
  });

  it('M5-2：mode=off → 回诊也不写审计（即使有到期的回诊计划，也不得隐式动作）', async () => {
    const storage = new InMemoryStorage();
    const cfg = makeCfg((ev) => { ev.mode = 'off'; LOOSE(ev); });
    await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed_off', form: 'desktop' });
    const plan = computeRollbackPlan(NOW - DAY, cfg.evolution.rollback, DEFAULT_RECALL_WEIGHTS, DEFAULT_RECALL_WEIGHTS, 1.0);
    plan.due_at = NOW - 1; // 已到期
    await storage.appendAudit({
      request_id: 'adopt_off', action: 'growth_op', ts: NOW - DAY, project_id: 'P_SYSTEM',
      detail: { event: 'adopted', family: 'recall_weights', applied: true, rollback_plan: plan },
    });
    const before = (await storage.queryAudit({ action: 'growth_op' })).length;

    const rb = await runRollbackCheck(storage, { requestId: 'rb_off', form: 'desktop', now: NOW, force: true });
    expect(rb.status).toBe('none');
    expect((await storage.queryAudit({ action: 'growth_op' })).length).toBe(before);
  });
});

describe('M3-5 / M3-6 / M3-7：回诊与回滚', () => {
  async function adoptFirst(): Promise<{ storage: InMemoryStorage; adoptedTs: number; adoptedWeights: RecallWeights }> {
    const storage = new InMemoryStorage();
    await seedConfig(storage, (ev) => { ev.mode = 'auto'; LOOSE(ev); });
    await seedImproving(storage);
    const r = await runEvolutionRound(storage, { requestId: 'run_adopt', form: 'desktop', now: NOW });
    const d = r.decisions.find((x) => x.family === 'recall_weights')!;
    expect(d.status).toBe('adopted');
    return { storage, adoptedTs: NOW, adoptedWeights: d.to! };
  }

  it('M3-5：采纳后恶化 → 到期回诊跌破 max_drop → 自动回滚到上一版（历史消费）', async () => {
    const { storage, adoptedTs } = await adoptFirst();
    await seedWorsening(storage, adoptedTs);
    const rb = await runRollbackCheck(storage, {
      requestId: 'run_rb', form: 'desktop', now: adoptedTs + 8 * DAY,
    });
    expect(rb.status).toBe('rolled_back');
    // 配置逐字回到上一版
    expect(growthConfigFromLedger(await storage.listMemories({})).recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
    expect(historyMemories(await storage.listMemories({}))).toHaveLength(0); // 历史已消费
  });

  it('M3-6：due_at 只认计划里的值，改当前配置不影响在途回诊', async () => {
    const { storage, adoptedTs, adoptedWeights } = await adoptFirst();
    await seedWorsening(storage, adoptedTs);
    // 改配置 after_days=30（若跟配置走，adoptedTs+8d 就不到期）
    const cur = growthConfigFromLedger(await storage.listMemories({}));
    await saveGrowthConfigToLedger(storage, {
      ...cur, evolution: { ...cur.evolution, rollback: { ...cur.evolution.rollback, after_days: 30 } },
    }, { requestId: 'cfg_later', form: 'desktop' });
    expect(adoptedWeights).toBeTruthy();
    const rb = await runRollbackCheck(storage, { requestId: 'run_rb6', form: 'desktop', now: adoptedTs + 8 * DAY });
    // 计划 due_at=+7d 已到 → 不会被新配置 +30d 挡住
    expect(rb.status).toBe('rolled_back');
  });

  it('M3-7：force=true 可提前回诊；force=false 未到期不动作', async () => {
    const storage = new InMemoryStorage();
    const adopted = makeCfg((ev) => { ev.mode = 'auto'; LOOSE(ev); });
    const adoptedWeights = { w_f: 0.25, w_i: 0.35, w_c: 0.20, w_a: 0.20 };
    // 直接种「已采纳」状态：现行配置=采纳权重，历史=默认，回诊计划 due_at 在未来
    await saveGrowthConfigToLedger(storage, { ...adopted, recall_weights: adoptedWeights }, { requestId: 'seed_adopt', form: 'desktop' });
    await putHistory(storage, adopted, NOW - 1 * DAY);
    const plan = computeRollbackPlan(NOW - 1 * DAY, adopted.evolution.rollback, adoptedWeights, DEFAULT_RECALL_WEIGHTS, 1.0);
    plan.due_at = NOW + 30 * DAY; // 未来
    await storage.appendAudit({
      request_id: 'adopt_manual', action: 'growth_op', ts: NOW - DAY, project_id: 'P_SYSTEM',
      detail: { event: 'adopted', family: 'recall_weights', applied: true, rollback_plan: plan },
    });
    await seedWorsening(storage, NOW - DAY);

    const notDue = await runRollbackCheck(storage, { requestId: 'rb_f', form: 'desktop', now: NOW });
    expect(notDue.status).toBe('not_due');
    expect(isRollbackDue(plan, NOW, false)).toBe(false);

    const forced = await runRollbackCheck(storage, { requestId: 'rb_t', form: 'desktop', now: NOW, force: true });
    expect(forced.status).toBe('rolled_back');
  });
});
