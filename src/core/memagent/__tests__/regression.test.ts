// 批次48 A23.3：回归算法与审计落账的可复现验证
import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../types.ts';
import {
  DEFAULT_FEEDBACK_POLICY, DEFAULT_RECALL_WEIGHTS, DEFAULT_SCHEDULE_FLAGS, type GrowthConfig,
} from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import {
  collectDedupSamples, classify, evaluateRegression, runGrowthRegression, splitSamples,
  suggestRecallWeights,
} from '../regression.ts';
import { growthConfigFromLedger } from '../paramsSnapshot.ts';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const DAY = 24 * 3600_000;

const dims = (semantic: number) => ({ semantic, keyword: 0.5, entity: 0.5, structure: 0.5 });

function sample(memId: string, merged: boolean, ts = NOW - 1000): {
  mem_id: string; ts: number; layer: 'L1'; dims: ReturnType<typeof dims>; merged: boolean;
} {
  return { mem_id: memId, ts, layer: 'L1', dims: dims(merged ? 0.7 : 0.3), merged };
}

function writeAudit(memId: string, merged: boolean, ts: number, schemaV = 1): AuditRecord {
  return {
    request_id: `req_${memId}`, action: 'write', form: 'desktop', project_id: 'P1', ts,
    detail: {
      mem_id: memId, dedup: merged ? 'grafted' : 'new',
      dedup_eval: {
        schema_v: schemaV, layer: 'L1', dims: dims(merged ? 0.7 : 0.3),
        score: 0.5, threshold: 0.5, merged,
      },
    },
  } as AuditRecord;
}

const currentConfig = (l1: number): GrowthConfig => ({
  weights: { semantic: 0.25, keyword: 0.25, entity: 0.25, structure: 0.25, llm_judge: 0 },
  thresholds: { L1: l1, L2: 0.6, L3: 0.65, L4: 0.7, L5: 0.75, L6: 0.8 },
  schedule: { ...DEFAULT_SCHEDULE_FLAGS },
  recall_weights: { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
  feedback_policy: { ...DEFAULT_FEEDBACK_POLICY },
});

/** 50 条（25 正 / 25 负）；分数 0.55 / 0.45，阈值 0.5 可分 */
function dataset(n = 50): ReturnType<typeof sample>[] {
  return Array.from({ length: n }, (_, i) => sample(`mem_${i}`, i % 2 === 0, NOW - i * 60_000));
}

describe('collectDedupSamples（样本来源与冷启动规则）', () => {
  it('只采信带当前版本 dedup_eval 的 30 天内写入；旧记录不回溯推断', () => {
    const audits = [
      writeAudit('m1', true, NOW - 2 * DAY),
      writeAudit('m2', false, NOW - 40 * DAY), // 超出窗口
      writeAudit('m3', true, NOW - DAY, 99), // 旧 schema
      { request_id: 'req_x', action: 'write', form: 'desktop', project_id: 'P1', ts: NOW, detail: { dedup: 'new', mem_id: 'm4' } } as AuditRecord,
    ];
    const out = collectDedupSamples(audits, NOW);
    expect(out.map((s) => s.mem_id)).toEqual(['m1']);
  });

  it('同一记忆多次反馈取最近一次（不是累加）', () => {
    const audits = [
      writeAudit('dup', true, NOW - 3 * 60_000),
      writeAudit('dup', false, NOW - 60_000),
      writeAudit('other', true, NOW - 2 * 60_000),
    ];
    const out = collectDedupSamples(audits, NOW);
    const dup = out.find((s) => s.mem_id === 'dup');
    expect(out).toHaveLength(2);
    expect(dup?.merged).toBe(false);
    expect(dup?.ts).toBe(NOW - 60_000);
  });
});

describe('evaluateRegression（F1 目标 + 门槛 + no-op）', () => {
  it('样本不足（总数 < 40）→ insufficient_samples 且带 counts', () => {
    const r = evaluateRegression(dataset(20), currentConfig(0.5));
    expect(r.status).toBe('insufficient_samples');
    if (r.status === 'insufficient_samples') {
      expect(r.counts).toMatchObject({ total: 20, positives: 10, negatives: 10, window_days: 30 });
    }
  });

  it('负例 < 10 → 即使总数够也判样本不足', () => {
    const samples = Array.from({ length: 45 }, (_, i) => sample(`mem_${i}`, i < 40, NOW - i * 60_000));
    const r = evaluateRegression(samples, currentConfig(0.5));
    expect(r.status).toBe('insufficient_samples');
  });

  it('历史阈值 0.5、当前阈值 0.9 → 训练后采纳（测试集 F1 提升 ≥ 0.02）', () => {
    // labels 由旧策略（阈值 0.5）决定；当前配置 0.9 几乎预测不出正例 → F1 0
    const r = evaluateRegression(dataset(50), currentConfig(0.9));
    expect(r.status).toBe('adopted');
    if (r.status === 'adopted') {
      expect(r.config.thresholds.L1).toBeLessThan(0.9);
      expect(r.after.test.f1 - r.before.test.f1).toBeGreaterThanOrEqual(0.02);
      expect(r.before.test.precision - r.after.test.precision).toBeLessThanOrEqual(0.05);
      // 六层单调不减
      const t = r.config.thresholds;
      expect(t.L1).toBeLessThanOrEqual(t.L2);
      expect(t.L2).toBeLessThanOrEqual(t.L3);
      expect(t.L5).toBeLessThanOrEqual(t.L6);
    }
  });

  it('当前配置已最优（F1=1）→ 未达门槛，不改配置', () => {
    const r = evaluateRegression(dataset(50), currentConfig(0.5));
    expect(r.status).toBe('not_adopted');
    if (r.status === 'not_adopted') {
      expect(r.reason).toBe('f1_gain_below_threshold');
      expect(r.proposed.thresholds.L1).toBe(0.5);
      expect(r.before.test.f1).toBe(1);
    }
  });

  it('确定性划分：同一账本两次评估结果完全一致', () => {
    const s = dataset(50);
    expect(splitSamples(s).test.map((x) => x.mem_id)).toEqual(splitSamples(s).test.map((x) => x.mem_id));
    expect(evaluateRegression(s, currentConfig(0.9))).toEqual(evaluateRegression(s, currentConfig(0.9)));
  });

  it('classify 指标口径：precision/recall/F1 由真实混淆矩阵算出', () => {
    const rows = [
      sample('a', true, 1), sample('b', true, 2), sample('c', false, 3), sample('d', false, 4),
    ];
    const m = classify(rows, currentConfig(0.5).weights, currentConfig(0.5).thresholds);
    expect(m).toMatchObject({ tp: 2, fp: 0, fn: 0, tn: 2, f1: 1, precision: 1, recall: 1 });
  });
});

describe('runGrowthRegression（真实审计落账）', () => {
  it('样本不足 → 写 insufficient_samples（kind/counts 可查），不落任何配置', async () => {
    const storage = new InMemoryStorage();
    const audits = Array.from({ length: 10 }, (_, i) => writeAudit(`mem_${i}`, i % 2 === 0, NOW - i * 60_000));
    for (const a of audits) await storage.appendAudit(a);
    const r = await runGrowthRegression(storage, { requestId: 'req_t1', form: 'desktop', now: NOW });
    expect(r.status).toBe('insufficient_samples');
    const wrote = await storage.queryAudit({ action: 'insufficient_samples' });
    expect(wrote).toHaveLength(1);
    expect(wrote[0].detail).toMatchObject({ kind: 'dedup_regression', total: 10, negatives: 5 });
    expect(await storage.queryAudit({ action: 'param_save' })).toHaveLength(0);
    expect(await storage.queryAudit({ action: 'weight_tuned' })).toHaveLength(0);
  });

  it('采纳 → 写 weight_tuned（前后快照）+ param_save，账本配置真变', async () => {
    const storage = new InMemoryStorage();
    for (const a of Array.from({ length: 50 }, (_, i) => writeAudit(`mem_${i}`, i % 2 === 0, NOW - i * 60_000))) {
      await storage.appendAudit(a);
    }
    const cfg = currentConfig(0.9);
    await storage.putMemory({
      mem_id: 'growth_seed', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: '', team_id: '',
      category: 'preference', layer: 'L2', content: `growth:v1:${JSON.stringify(cfg)}`,
      decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: NOW - DAY, updated_at: NOW - DAY,
    });
    const r = await runGrowthRegression(storage, { requestId: 'req_t2', form: 'desktop', now: NOW });
    expect(r.status).toBe('adopted');

    const tuned = await storage.queryAudit({ action: 'weight_tuned' });
    expect(tuned).toHaveLength(1);
    const detail = tuned[0].detail as Record<string, unknown>;
    expect(detail.kind).toBe('dedup_regression');
    expect(detail.before).toBeTruthy();
    expect(detail.after).toBeTruthy();
    expect(await storage.queryAudit({ action: 'param_save' })).toHaveLength(1);

    const after = growthConfigFromLedger(await storage.listMemories({}));
    expect(after.thresholds.L1).toBeLessThan(0.9);
  });
});

// 批次61 GAP-1（规格 A6）：召回权重「回归建议」——只读真实 recall / memory_op 审计，
// 只产出建议、只落 growth_op 审计（applied:false），绝不自动写 growth:v1。
function recallAudit(ts: number, o: { thin?: boolean; hits?: number } = {}): AuditRecord {
  return {
    request_id: `req_r_${ts}`, action: 'recall', form: 'desktop', project_id: 'P1', ts,
    detail: { hits: o.hits ?? 3, evidence_thin: o.thin === true },
  } as AuditRecord;
}

function opAudit(ts: number, op: 'confirm' | 'reject' | 'disputed'): AuditRecord {
  return {
    request_id: `req_o_${ts}`, action: 'memory_op', form: 'desktop', project_id: 'P1', ts,
    detail: { op },
  } as AuditRecord;
}

/** n 次窗口内召回（thinEvery>0 时每第 thinEvery 条标证据不足）*/
function recalls(n: number, thinEvery = 0): AuditRecord[] {
  return Array.from({ length: n }, (_, i) => recallAudit(NOW - i * 60_000, {
    thin: thinEvery > 0 && i % thinEvery === 0,
  }));
}

describe('suggestRecallWeights（GAP-1 回归建议算法）', () => {
  it('召回样本 < 30 → 不给建议（不猜），即使异常信号已超阈；metrics 如实计数', () => {
    const audits = [
      ...recalls(29, 2),                                                        // 证据不足 15/29 ≈ 51.7%
      ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject')), // reject 100%
    ];
    const { suggestion, metrics } = suggestRecallWeights(audits, DEFAULT_RECALL_WEIGHTS, NOW);
    // 信号都超阈了，拦住它的是「样本量不足」这道守卫，不是算法没看见问题
    expect(metrics.evidence_thin_ratio).toBeGreaterThan(0.35);
    expect(metrics.reject_ratio).toBe(1);
    expect(metrics.recalls).toBe(29);
    expect(suggestion).toBeNull();
  });

  it('样本量刚好到 30 且信号超阈 → 才给建议（边界另一侧）', () => {
    const audits = [
      ...recalls(30, 2),
      ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject')),
    ];
    expect(suggestRecallWeights(audits, DEFAULT_RECALL_WEIGHTS, NOW).suggestion).not.toBeNull();
  });

  it('窗口外的召回不计入（7 天窗）', () => {
    const old = Array.from({ length: 40 }, (_, i) => recallAudit(NOW - (10 + i) * DAY));
    const { suggestion, metrics } = suggestRecallWeights(old, DEFAULT_RECALL_WEIGHTS, NOW);
    expect(metrics.recalls).toBe(0);
    expect(suggestion).toBeNull();
  });

  it('reject 占比 > 30% → w_c +0.05，缺口从 w_f 扣（和仍 = 1）', () => {
    const audits = [...recalls(40), ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject'))];
    const { suggestion, metrics } = suggestRecallWeights(audits, DEFAULT_RECALL_WEIGHTS, NOW);
    expect(metrics.reject_ratio).toBe(1);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.to).toEqual({ w_f: 0.30, w_i: 0.30, w_c: 0.20, w_a: 0.20 });
    expect(suggestion!.from).toEqual(DEFAULT_RECALL_WEIGHTS); // from 是当前值快照，不被就地改写
    expect(suggestion!.reason).toContain('w_c +0.05');
  });

  it('证据不足占比 > 35% → w_i +0.05，缺口从 w_f 扣', () => {
    const { suggestion, metrics } = suggestRecallWeights(recalls(40, 2), DEFAULT_RECALL_WEIGHTS, NOW);
    expect(metrics.evidence_thin_ratio).toBe(0.5);
    expect(suggestion!.to).toEqual({ w_f: 0.30, w_i: 0.35, w_c: 0.15, w_a: 0.20 });
    expect(suggestion!.reason).toContain('w_i +0.05');
  });

  it('两条规则同时触发 → 共 +0.10，先扣 w_f（够扣就不动 w_a）', () => {
    const audits = [
      ...recalls(40, 2),
      ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject')),
    ];
    const { suggestion } = suggestRecallWeights(audits, DEFAULT_RECALL_WEIGHTS, NOW);
    expect(suggestion!.to).toEqual({ w_f: 0.25, w_i: 0.35, w_c: 0.20, w_a: 0.20 });
  });

  it('w_f 不够扣时继续扣 w_a（两级扣减按序）', () => {
    // w_f 只剩 0.05 的上方空间（0.10−0.05），两条规则共需 0.10 → 余 0.05 从 w_a 扣
    const near = { w_f: 0.10, w_i: 0.50, w_c: 0.20, w_a: 0.20 };
    const audits = [
      ...recalls(40, 2),
      ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject')),
    ];
    const { suggestion } = suggestRecallWeights(audits, near, NOW);
    expect(suggestion!.to).toEqual({ w_f: 0.05, w_i: 0.55, w_c: 0.25, w_a: 0.15 });
  });

  it('扣减守 0.05 下限：w_f/w_a 已触底仍不够 → 不建议，不硬凑', () => {
    const pinned = { w_f: 0.05, w_i: 0.60, w_c: 0.30, w_a: 0.05 };
    const audits = [
      ...recalls(40, 2),
      ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject')),
    ];
    const { suggestion, metrics } = suggestRecallWeights(audits, pinned, NOW);
    expect(metrics.recalls).toBe(40);
    expect(suggestion).toBeNull();
  });

  it('无任何异常信号 → 不建议（不为了“有输出”硬给）', () => {
    const audits = [...recalls(40), ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'confirm'))];
    expect(suggestRecallWeights(audits, DEFAULT_RECALL_WEIGHTS, NOW).suggestion).toBeNull();
  });

  it('建议 never 自动生效：跑完回归后账本 recall_weights 一字不变（applied:false 落审计）', async () => {
    const storage = new InMemoryStorage();
    const cfg = currentConfig(0.5); // 判重侧已最优 → 走 not_adopted 分支，但召回建议仍要落审计
    await storage.putMemory({
      mem_id: 'growth_seed', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: '', team_id: '',
      category: 'preference', layer: 'L2', content: `growth:v1:${JSON.stringify(cfg)}`,
      decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: NOW - DAY, updated_at: NOW - DAY,
    });
    for (const a of Array.from({ length: 50 }, (_, i) => writeAudit(`mem_${i}`, i % 2 === 0, NOW - i * 60_000))) {
      await storage.appendAudit(a);
    }
    for (const a of [...recalls(40, 2), ...Array.from({ length: 10 }, (_, i) => opAudit(NOW - i * 1000, 'reject'))]) {
      await storage.appendAudit(a);
    }

    await runGrowthRegression(storage, { requestId: 'req_t3', form: 'desktop', now: NOW });

    const growthOps = await storage.queryAudit({ action: 'growth_op' });
    const entry = (growthOps[0]?.detail as { entry?: Record<string, unknown> } | undefined)?.entry ?? {};
    expect(entry.event).toBe('recall_weight_suggested');
    expect(entry.action).toBe('suggest_recall_weights');
    const payload = JSON.parse(String(entry.payload)) as {
      applied: boolean; suggestion: { to: Record<string, number> };
    };
    expect(payload.applied).toBe(false);
    expect(payload.suggestion.to.w_i).toBe(0.35);

    // 账本未被改写：仍是 seed 里的默认召回权重
    expect(growthConfigFromLedger(await storage.listMemories({})).recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
  });

  it('有召回观测但样本 < 30 → 落一条 no_suggestion 审计（不静默跳过）', async () => {
    const storage = new InMemoryStorage();
    for (const a of recalls(5)) await storage.appendAudit(a);
    await runGrowthRegression(storage, { requestId: 'req_t4', form: 'desktop', now: NOW });
    const growthOps = await storage.queryAudit({ action: 'growth_op' });
    expect(growthOps).toHaveLength(1);
    const entry = (growthOps[0]?.detail as { entry?: Record<string, unknown> } | undefined)?.entry ?? {};
    expect(entry.event).toBe('recall_weight_no_suggestion');
  });

  it('窗口内零召回 → 不写建议审计（零观测不产生噪音，保护冷启动 no-op 契约）', async () => {
    const storage = new InMemoryStorage();
    await runGrowthRegression(storage, { requestId: 'req_t5', form: 'desktop', now: NOW });
    expect(await storage.queryAudit({ action: 'growth_op' })).toHaveLength(0);
    // 但 dedup 侧的样本不足审计照常写（回归本身不静默）
    expect(await storage.queryAudit({ action: 'insufficient_samples' })).toHaveLength(1);
  });
});
