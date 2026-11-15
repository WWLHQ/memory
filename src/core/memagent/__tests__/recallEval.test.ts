// M2：召回权重离线评估（NDCG@k / 配对符号检验 / 护栏 / 弱标签分离 / 只读不改账）。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVAL_K, MAX_GUARD_RISE, MIN_NDCG_GAIN, SIGN_TEST_P,
  decideOutcome, evaluateRecallWeights, guardCheck, ndcgAtK, rankIds, rescoreRow,
  samplesFromAudits, signTestP, type EvalSample,
} from '../evolution/recallEval.ts';
import type { MemDetailRow } from '../forgetting.ts';
import type { RecallWeights } from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import type { AuditRecord } from '../types.ts';

const row = (id: string, rel: number, f: number, imp: number, conf: number, boost: number): MemDetailRow =>
  [id, rel, f, imp, conf, boost];

describe('M2-1：同批 mems_detail 两套权重重排（可手算复现）', () => {
  // 5 条已知分量：只有 freshness / boost 拉开差异，便于手算
  const rows: MemDetailRow[] = [
    row('a', 0.9, 0.1, 0.5, 0.5, 0.0),
    row('b', 0.9, 0.5, 0.5, 0.5, 0.0),
    row('c', 0.9, 0.9, 0.5, 0.5, 0.0),
    row('d', 0.9, 0.5, 0.5, 0.5, 1.0),
    row('e', 0.9, 0.5, 0.5, 0.5, 0.5),
  ];
  const wFrom: RecallWeights = { w_f: 0.5, w_i: 0.2, w_c: 0.2, w_a: 0.1 };
  const wTo: RecallWeights = { w_f: 0.1, w_i: 0.2, w_c: 0.2, w_a: 0.5 };

  it('rescoreRow 与手算一致', () => {
    // c: 0.9 * (0.5*0.9 + 0.2*0.5 + 0.2*0.5 + 0.1*0) = 0.9 * 0.65 = 0.585
    expect(rescoreRow(rows[2], wFrom)).toBe(0.585);
    // d: 0.9 * (0.1*0.5 + 0.2*0.5 + 0.2*0.5 + 0.5*1) = 0.9 * 0.75 = 0.675
    expect(rescoreRow(rows[3], wTo)).toBe(0.675);
  });

  it('from 序 [c,d,e,b,a] / to 序 [d,e,c,b,a]，与手算完全一致', () => {
    expect(rankIds(rows, wFrom)).toEqual(['c', 'd', 'e', 'b', 'a']);
    expect(rankIds(rows, wTo)).toEqual(['d', 'e', 'c', 'b', 'a']);
  });
});

describe('NDCG@k / 符号检验 基础', () => {
  it('全相关 → 1；DCG/IDCG 手算复现', () => {
    expect(ndcgAtK([1, 1, 1], 3)).toBeCloseTo(1, 10);
    // gains [0,1] → DCG=1/log2(3)=0.63093，IDCG=1 → NDCG=0.63093
    expect(ndcgAtK([0, 1], 10)).toBeCloseTo(1 / Math.log2(3), 6);
    // 全 0 增益（IDCG=0）→ 0，不 NaN
    expect(ndcgAtK([0, 0], 10)).toBe(0);
  });

  it('配对符号检验（双侧精确二项）边界', () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(3, 3)).toBe(1);
    expect(signTestP(5, 0)).toBeCloseTo(0.0625, 10); // 2/32
    expect(signTestP(4, 0)).toBeCloseTo(0.125, 10); // 2/16 > 0.10 → 不显著
    expect(signTestP(40, 0)).toBeLessThan(1e-6);
    // 对称
    expect(signTestP(5, 1)).toBeCloseTo(signTestP(1, 5), 10);
  });
});

describe('M2-2 / M2-3 / M2-4：决策三态与护栏', () => {
  it('M2-2：样本 < minSamples → insufficient，needMore = 差额，不给建议', () => {
    const d = decideOutcome({ samples: 12, minSamples: 30, gain: 0.5, p: 0.001, guardPass: true });
    expect(d.status).toBe('insufficient');
    expect(d.needMore).toBe(18);
  });

  it('M2-3：0.019 → 不采纳；0.021 但 p=0.4 → 不采纳；0.021 且 p=0.05 → suggest', () => {
    expect(decideOutcome({ samples: 50, minSamples: 30, gain: 0.019, p: 0.01, guardPass: true }).status)
      .toBe('rejected');
    expect(decideOutcome({ samples: 50, minSamples: 30, gain: 0.021, p: 0.4, guardPass: true }).status)
      .toBe('rejected');
    expect(decideOutcome({ samples: 50, minSamples: 30, gain: 0.021, p: 0.05, guardPass: true }).status)
      .toBe('suggest');
    expect(MIN_NDCG_GAIN).toBe(0.02);
    expect(SIGN_TEST_P).toBe(0.10);
  });

  it('M2-4：护栏上升 > 0.02 → 一票否决（即使提升显著/达标）', () => {
    const bad = guardCheck({ rejectFrom: 0.10, rejectTo: 0.13, thinFrom: 0.05, thinTo: 0.05 });
    expect(bad.pass).toBe(false);
    expect(bad.rejectRise).toBeCloseTo(0.03, 10);
    const ok = guardCheck({ rejectFrom: 0.10, rejectTo: 0.11, thinFrom: 0.05, thinTo: 0.06 });
    expect(ok.pass).toBe(true);
    expect(MAX_GUARD_RISE).toBe(0.02);
    expect(
      decideOutcome({ samples: 50, minSamples: 30, gain: 0.10, p: 0.001, guardPass: bad.pass }).status,
    ).toBe('rejected');
  });
});

describe('M2-5：弱标签单独评估，不参与强 NDCG', () => {
  const rows: MemDetailRow[] = [
    row('a', 1.0, 0.2, 0.5, 0.5, 0.0),
    row('b', 1.0, 0.8, 0.5, 0.5, 0.0),
    row('c', 1.0, 0.5, 0.5, 0.5, 0.0),
  ];
  const wFrom: RecallWeights = { w_f: 0.7, w_i: 0.1, w_c: 0.1, w_a: 0.1 }; // b 在前
  const wTo: RecallWeights = { w_f: 0.1, w_i: 0.1, w_c: 0.1, w_a: 0.7 }; // boost 都 0 → 平，稳定序
  const strongOnly: EvalSample = { rows, labels: { a: 1, b: 0, c: 0 } };
  const withWeak: EvalSample = { ...strongOnly, weakLabels: { a: 0, b: 1, c: 1 } };

  it('加不加弱标签，强 NDCG 结果逐字段一致；弱结果单独给出', () => {
    const r1 = evaluateRecallWeights({ samples: [strongOnly], wFrom, wTo, minSamples: 1 });
    const r2 = evaluateRecallWeights({ samples: [withWeak], wFrom, wTo, minSamples: 1 });
    // 强指标不受弱标签影响
    expect({ s: r2.samples, f: r2.meanFrom, t: r2.meanTo, g: r2.gain, p: r2.p, st: r2.status })
      .toEqual({ s: r1.samples, f: r1.meanFrom, t: r1.meanTo, g: r1.gain, p: r1.p, st: r1.status });
    expect(r1.weak).toBeUndefined();
    expect(r2.weak).toBeDefined();
    expect(r2.weak!.samples).toBe(1);
  });
});

describe('M2 端到端：权重改好 → suggest；纯函数不改账（M2-6）', () => {
  // 一条 pos(gain1) / 一条 neg(gain0)；from 权重让 neg 排前（NDCG 差），to 权重让 pos 排前（NDCG 好）
  const rows: MemDetailRow[] = [
    row('A', 0.95, 0.95, 0.95, 0.95, 0.0), // neg
    row('B', 0.85, 0.95, 0.95, 0.95, 0.95), // pos
  ];
  const wFrom: RecallWeights = { w_f: 0.34, w_i: 0.33, w_c: 0.33, w_a: 0 };
  const wTo: RecallWeights = { w_f: 0.1, w_i: 0.1, w_c: 0.1, w_a: 0.7 };
  const one: EvalSample = { rows, labels: { A: 0, B: 1 } };

  it('40 次同构召回：to 权重把 pos 顶到第一 → gain>0.02 且 p 显著 → suggest，topN 标注', () => {
    const samples = Array.from({ length: 40 }, () => ({ ...one }));
    const r = evaluateRecallWeights({ samples, wFrom, wTo, minSamples: 30 });
    expect(r.status).toBe('suggest');
    expect(r.samples).toBe(40);
    expect(r.improved).toBe(40);
    expect(r.declined).toBe(0);
    expect(r.gain).toBeGreaterThanOrEqual(MIN_NDCG_GAIN);
    expect(r.p).toBeLessThanOrEqual(SIGN_TEST_P);
    expect(r.topN).toBe(2); // 「在 top 2 内评估」
    expect(DEFAULT_EVAL_K).toBe(20);
  });

  it('M2-6：评估只读审计、不写任何账（前后审计条数不变）', async () => {
    const storage = new InMemoryStorage();
    const recall: AuditRecord = {
      request_id: 'r1', action: 'recall', ts: 1, project_id: 'P1',
      detail: { mems: ['A', 'B'], mems_detail: rows },
    };
    const fb: AuditRecord = {
      request_id: 'fb1', action: 'recall_feedback', ts: 2,
      detail: { recall_id: 'r1', mem_id: 'B', verdict: 'confirm' },
    };
    await storage.appendAudit(recall);
    await storage.appendAudit(fb);
    const before = (await storage.queryAudit({})).length;

    const built = samplesFromAudits(
      await storage.queryAudit({ action: 'recall' }),
      await storage.queryAudit({ action: 'recall_feedback' }),
    );
    expect(built.samples).toHaveLength(1);
    evaluateRecallWeights({ samples: built.samples, wFrom, wTo, minSamples: 1 });

    const after = (await storage.queryAudit({})).length;
    expect(after).toBe(before); // 零写入
    expect(await storage.queryAudit({ action: 'growth_op' })).toHaveLength(0);
  });

  it('M1-5：旧 recall 审计无 mems_detail → 如实跳过（不补零不推断）', () => {
    const old: AuditRecord = { request_id: 'r_old', action: 'recall', ts: 1, detail: { mems: ['A'] } };
    const withDetail: AuditRecord = {
      request_id: 'r_new', action: 'recall', ts: 2, detail: { mems: ['A', 'B'], mems_detail: rows },
    };
    const fb: AuditRecord = {
      request_id: 'fb1', action: 'recall_feedback', ts: 3,
      detail: { recall_id: 'r_new', mem_id: 'B', verdict: 'confirm' },
    };
    const built = samplesFromAudits([old, withDetail], [fb]);
    expect(built.skippedOld).toBe(1);
    expect(built.samples).toHaveLength(1);
    expect(built.samples[0].rows).toHaveLength(2);
  });
});
