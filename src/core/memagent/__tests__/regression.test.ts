// 批次48 A23.3：回归算法与审计落账的可复现验证
import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../types.ts';
import { DEFAULT_SCHEDULE_FLAGS, type GrowthConfig } from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import {
  collectDedupSamples, classify, evaluateRegression, runGrowthRegression, splitSamples,
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
