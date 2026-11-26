// rank_wrong → weight_step（方案 MODE-FEEDBACK-TARGET-FIELD.md §2.2，2026-11-26）。
// 证据只能来自 recall_feedback.rank_wrong + expected_first_id 与同 request_id 的 recall.mems_detail。
import { describe, expect, it } from 'vitest';
import { buildRankSamples, proposeWeightStep } from '../evolution/rankWeightStep.ts';
import { adoptSuggestedWeightStep, runEvolutionRound, validWeightStepProposal } from '../evolution/loop.ts';
import { InMemoryStorage } from '../storage.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../paramsSnapshot.ts';
import { DEFAULT_RECALL_WEIGHTS, normalizeGrowthConfig } from '../../../shared/growthConfig.ts';
import type { AuditRecord } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_700_000_000_000;
// MemDetailRow = [mem_id, relevance, f, imp, conf, boost]
// m_high = 用户点名「应该排第一」：f 低但 imp 高；m_low 当前靠 w_f(0.35) 险胜。
// 加 w_i 一步（0.30→0.35，其余按比例扣回）后 m_high 反超 —— 这组数据是真能翻盘的，不是硬凑。
const rows = [
  ['m_high', 1, 0.5, 1.0, 0, 0],
  ['m_low', 1, 1.0, 0.5, 0, 0],
];
const audit = (rid: string, action: string, ts: number, detail: Record<string, unknown>): AuditRecord =>
  ({ request_id: rid, action, ts, detail } as AuditRecord);
const rankChain = (rid: string, ts: number) => [
  audit(rid, 'recall', ts, { query: 'q', mems_detail: rows, scene: 'default' }),
  audit(rid, 'recall_feedback', ts + 1, { rank_wrong: true, expected_first_id: 'm_high' }),
];

describe('buildRankSamples（排序反馈只读派生）', () => {
  it('真写 rank_wrong + expected_first_id → 有效样本（current_first_id 由现行权重重排得出）', () => {
    const s = buildRankSamples([...rankChain('r1', NOW - DAY)], DEFAULT_RECALL_WEIGHTS, { now: NOW, windowDays: 30 });
    expect(s.samples).toHaveLength(1);
    expect(s.samples[0].expected_first_id).toBe('m_high');
    expect(s.samples[0].current_first_id).toBe('m_low'); // 默认 w_f=0.35 下 m_low 险胜
  });

  it('点名条目不在候选 / 无 mems_detail → 跳过不猜', () => {
    const a = [
      audit('r2', 'recall', NOW - DAY, { mems_detail: rows }),
      audit('r2', 'recall_feedback', NOW - DAY + 1, { rank_wrong: true, expected_first_id: 'm_missing' }),
      audit('r3', 'recall_feedback', NOW - DAY + 1, { rank_wrong: true, expected_first_id: 'm_high' }),
    ];
    const s = buildRankSamples(a, DEFAULT_RECALL_WEIGHTS, { now: NOW, windowDays: 30 });
    expect(s.samples).toHaveLength(0);
    expect(s.skipped).toBe(2); // r2 点名条目不在候选、r3 无同 request_id 的 recall.mems_detail，两条都跳过
  });

  it('旧反馈无 rank_wrong 字段 → 不计入（不把 confirm 当排序反馈）', () => {
    const a = [
      audit('r4', 'recall', NOW - DAY, { mems_detail: rows }),
      audit('r4', 'recall_feedback', NOW - DAY + 1, { verdict: 'confirm' }),
    ];
    expect(buildRankSamples(a, DEFAULT_RECALL_WEIGHTS, { now: NOW, windowDays: 30 }).samples).toHaveLength(0);
  });
});

describe('proposeWeightStep（C 变异验证）', () => {
  it('两条不同 request_id 指向同一维度 → 产建议，权重和=1、步长=max_step', () => {
    const built = buildRankSamples([
      ...rankChain('r1', NOW - DAY), ...rankChain('r2', NOW - DAY / 2),
    ], DEFAULT_RECALL_WEIGHTS, { now: NOW, windowDays: 30 });
    const r = proposeWeightStep(built.samples, DEFAULT_RECALL_WEIGHTS, 0.05);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal!.kind).toBe('weight_step');
    expect(r.proposal!.dimension).toBe('w_i'); // 真实算出：imp 是被点名条目的优势维
    const sum = ['w_f', 'w_i', 'w_c', 'w_a'].reduce((s, k) => s + r.proposal!.to[k as keyof typeof DEFAULT_RECALL_WEIGHTS], 0);
    expect(sum).toBeCloseTo(1, 2);
    expect(validWeightStepProposal(r.proposal)).toBe(true);
  });

  it('单条样本 → 不产（把 ≥2 改成 ≥1 本例必须红）', () => {
    const built = buildRankSamples(rankChain('r1', NOW - DAY), DEFAULT_RECALL_WEIGHTS, { now: NOW, windowDays: 30 });
    expect(proposeWeightStep(built.samples, DEFAULT_RECALL_WEIGHTS, 0.05).proposal).toBeNull();
  });

  it('权重和≠1 的假建议形状 → validWeightStepProposal 拒绝', () => {
    const built = buildRankSamples([
      ...rankChain('r1', NOW - DAY), ...rankChain('r2', NOW - DAY / 2),
    ], DEFAULT_RECALL_WEIGHTS, { now: NOW, windowDays: 30 });
    const p = proposeWeightStep(built.samples, DEFAULT_RECALL_WEIGHTS, 0.05).proposal!;
    expect(validWeightStepProposal({ ...p, to: { ...p.to, w_f: 9 } })).toBe(false);
  });
});

describe('adoptSuggestedWeightStep（手动采纳）', () => {
  it('只认审计里真实存在的建议：无 suggest_weight_step → 拒绝', async () => {
    const storage = new InMemoryStorage();
    await saveGrowthConfigToLedger(storage, normalizeGrowthConfig({}), { requestId: 'seed', form: 'desktop' });
    const r = await adoptSuggestedWeightStep(storage, { requestId: 'ad1', form: 'desktop', now: NOW });
    expect(r.applied).toBe(false);
    expect(r.reason).toContain('没有可采纳');
  });

  it('进化轮 suggest 模式只产建议不写配置', async () => {
    const storage = new InMemoryStorage();
    await saveGrowthConfigToLedger(storage, normalizeGrowthConfig({}), { requestId: 'seed', form: 'desktop' });
    for (const a of [...rankChain('r1', NOW - DAY), ...rankChain('r2', NOW - DAY / 2)]) await storage.appendAudit(a);
    await runEvolutionRound(storage, { requestId: 'evo1', form: 'desktop', now: NOW });
    const cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.recall_weights).toEqual(DEFAULT_RECALL_WEIGHTS);
    const ops = await storage.queryAudit({ action: 'growth_op' });
    expect(ops.some((a) => (a.detail as { event?: string }).event === 'suggest_weight_step')).toBe(true);
  });
});
