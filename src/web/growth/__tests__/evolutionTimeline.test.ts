// M4：进化时间线 + 漂移仪表（纯数据层）——逐条对上审计 / 空账本不补零 / 漂移=真实差。
import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import {
  dedupDrift, driftRows, evolutionTimelineFromLedger, recallDrift, rollbackStateOf, thresholdDrift,
  type EvolutionTimelineEntry,
} from '../evolutionTimeline.ts';
import { DEFAULT_RECALL_WEIGHTS, type RecallWeights } from '../../../shared/growthConfig.ts';

function audit(requestId: string, ts: number, detail: Record<string, unknown>): AuditRecord {
  return {
    request_id: requestId, action: 'growth_op', ts,
    project_id: 'P_SYSTEM', user_id: 'system', form: 'desktop', detail,
  } as AuditRecord;
}

const W_FROM: RecallWeights = { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 };
const W_TO: RecallWeights = { w_f: 0.40, w_i: 0.25, w_c: 0.15, w_a: 0.20 };

describe('evolutionTimelineFromLedger（M4-1 逐条对应真实审计）', () => {
  it('adopted 记录：requestId/时间/参数前后/评估指标/回诊点/历史均来自审计原文', () => {
    const entries = evolutionTimelineFromLedger([
      audit('req_evo_1', 1000, {
        event: 'adopted', family: 'recall_weights', applied: true,
        from: W_FROM, to: W_TO,
        eval: { status: 'suggest', reason: 'NDCG 提升 0.031 且符号检验 p=0.043', gain: 0.031, p: 0.043, meanFrom: 0.512, meanTo: 0.543, samples: 34 },
        guard: { pass: true, reason: '护栏通过' },
        history_saved: true,
        rollback_plan: { due_at: 1000 + 7 * 86400000 },
      }),
    ]);

    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.requestId).toBe('req_evo_1');
    expect(e.ts).toBe(1000);
    expect(e.decision).toBe('adopted');
    expect(e.family).toBe('recall_weights');
    expect(e.applied).toBe(true);
    expect(e.from).toEqual(W_FROM);
    expect(e.to).toEqual(W_TO);
    expect(e.gain).toBe(0.031);
    expect(e.p).toBe(0.043);
    expect(e.samples).toBe(34);
    // 原因优先取 eval.reason（审计原文），不是页面自造
    expect(e.reason).toBe('NDCG 提升 0.031 且符号检验 p=0.043');
    expect(e.rollbackDueAt).toBe(1000 + 7 * 86400000);
    expect(e.historySaved).toBe(true);
  });

  it('多条记录按时间倒序（最新在前），且条数 = 审计条数（不聚合、不补零）', () => {
    const entries = evolutionTimelineFromLedger([
      audit('req_a', 100, { event: 'insufficient', family: 'recall_weights', applied: false }),
      audit('req_c', 300, { event: 'rolled_back', family: 'recall_weights', applied: true, current_mean_ndcg: 0.46, drop: 0.052 }),
      audit('req_b', 200, { event: 'suggest_recall_weights', family: 'recall_weights', status: 'suggested', from: W_FROM, to: W_TO }),
    ]);

    expect(entries.map((e) => e.requestId)).toEqual(['req_c', 'req_b', 'req_a']);
    expect(entries[0].decision).toBe('rolled_back');
    expect(entries[0].currentMeanNdcg).toBe(0.46);
    expect(entries[0].drop).toBe(0.052);
    expect(entries[1].decision).toBe('suggested');
    expect(entries[2].decision).toBe('insufficient');
    // 审计里没写原因的（insufficient）就是空串，页面显「—」
    expect(entries[2].reason).toBe('');
    // 没写 rollback_plan / eval 的就不该冒出这些键
    expect(entries[2].rollbackDueAt).toBeUndefined();
    expect(entries[2].gain).toBeUndefined();
  });

  it('suggest_recall_weights 的裁决看 status：评估判不足不得标成「已建议」', () => {
    const entries = evolutionTimelineFromLedger([
      audit('req_x', 10, { event: 'suggest_recall_weights', family: 'recall_weights', status: 'insufficient' }),
      audit('req_y', 20, { event: 'suggest_recall_weights', family: 'recall_weights', status: 'rejected' }),
      audit('req_z', 30, { event: 'guarded', family: 'recall_weights', guard: { pass: false, reason: '冷却期内（7 天）不重复自动调整' } }),
    ]);
    expect(entries[0].requestId).toBe('req_z');
    expect(entries[0].decision).toBe('guarded');
    expect(entries[0].reason).toBe('冷却期内（7 天）不重复自动调整');
    expect(entries.find((e) => e.requestId === 'req_x')?.decision).toBe('insufficient');
    expect(entries.find((e) => e.requestId === 'req_y')?.decision).toBe('rejected');
  });

  it('旧式 detail.entry 包装项跳过（交给既有 growthAudit，不产生双份）', () => {
    const entries = evolutionTimelineFromLedger([
      audit('req_old', 50, { event: 'adopted', entry: { event: 'weight_tuned', payload: '{}' } }),
      audit('req_new', 60, { event: 'adopted', family: 'recall_weights', applied: true }),
    ]);
    expect(entries.map((e) => e.requestId)).toEqual(['req_new']);
  });

  it('不相关动作/未知事件一律忽略（M4-2 空账本 → 空数组，不伪造 0 记录）', () => {
    expect(evolutionTimelineFromLedger([])).toEqual([]);
    const entries = evolutionTimelineFromLedger([
      { request_id: 'req_r', action: 'recall', ts: 1, detail: {} } as AuditRecord,
      audit('req_unknown', 2, { event: 'something_else' }),
    ]);
    expect(entries).toEqual([]);
  });
});

describe('回诊三态（M5-3）', () => {
  const DAY = 24 * 3600 * 1000;
  const due = 10 * DAY;
  const adopted: EvolutionTimelineEntry = {
    requestId: 'req_ad', ts: 1 * DAY, family: 'recall_weights', decision: 'adopted',
    reason: 'ok', phase: 'evolution', applied: true, rollbackDueAt: due,
  };

  it('无 due_at → none（页面写「无回诊计划」，不显示 0 天）', () => {
    const e: EvolutionTimelineEntry = { ...adopted, rollbackDueAt: undefined };
    expect(rollbackStateOf(e, [e], 5 * DAY)).toEqual({ state: 'none' });
  });

  it('未到期 → pending + 剩余天数（向上取整）', () => {
    const v = rollbackStateOf(adopted, [adopted], 3 * DAY);
    expect(v.state).toBe('pending');
    expect(v.daysLeft).toBe(7);
  });

  it('已过期且无结论 → overdue（如实暴露，不假装完成）', () => {
    expect(rollbackStateOf(adopted, [adopted], 20 * DAY).state).toBe('overdue');
  });

  it('之后出现 rolled_back / kept → done（两种结论都算回诊完成）', () => {
    const rb: EvolutionTimelineEntry = {
      requestId: 'req_rb', ts: 11 * DAY, family: 'recall_weights', decision: 'kept',
      reason: '回诊通过', phase: 'rollback', rollbackDueAt: due,
    };
    expect(rollbackStateOf(adopted, [adopted, rb], 20 * DAY).state).toBe('done');

    const rolledBack: EvolutionTimelineEntry = { ...rb, requestId: 'req_rb2', decision: 'rolled_back' };
    expect(rollbackStateOf(adopted, [adopted, rolledBack], 20 * DAY).state).toBe('done');
  });

  it('回诊跑了但样本不足（insufficient）不算完成，仍按时间判 overdue', () => {
    const ins: EvolutionTimelineEntry = {
      requestId: 'req_ins', ts: 11 * DAY, family: 'recall_weights', decision: 'insufficient',
      reason: '回诊样本不足', phase: 'rollback', rollbackDueAt: due,
    };
    expect(rollbackStateOf(adopted, [adopted, ins], 20 * DAY).state).toBe('overdue');
  });

  it('他族（feedback_policy）的回诊记录不能把 recall_weights 的计划标记为完成', () => {
    const other: EvolutionTimelineEntry = {
      requestId: 'req_other', ts: 11 * DAY, family: 'feedback_policy', decision: 'kept',
      reason: 'x', phase: 'rollback', rollbackDueAt: due,
    };
    expect(rollbackStateOf(adopted, [adopted, other], 20 * DAY).state).toBe('overdue');
  });

  it('回诊审计用 plan 字段也读得到 due_at（M5-1 回诊分支写的是 plan）', () => {
    const entries = evolutionTimelineFromLedger([
      audit('req_rb3', 50, {
        event: 'rolled_back', family: 'recall_weights', phase: 'rollback',
        plan: { due_at: due }, drop: 0.05, current_mean_ndcg: 0.46,
        reason: '回诊未通过：跌幅 0.05 > 允许 0.03',
      }),
    ]);
    expect(entries[0].rollbackDueAt).toBe(due);
    expect(entries[0].phase).toBe('rollback');
    expect(entries[0].decision).toBe('rolled_back');
    expect(rollbackStateOf(entries[0], entries, 20 * DAY).state).toBe('done');
  });
});

// 供上面的用例构造审计

describe('漂移仪表（M4-3 数值 = 当前 vs 基准的真实差）', () => {  const drifted: RecallWeights = { w_f: 0.40, w_i: 0.25, w_c: 0.15, w_a: 0.20 };

  it('recallDrift：四维逐项真实差（含 0 漂移项）', () => {
    const rows = recallDrift(drifted, DEFAULT_RECALL_WEIGHTS);
    expect(rows.map((r) => r.key)).toEqual(['w_f', 'w_i', 'w_c', 'w_a']);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.w_f).toMatchObject({ current: 0.4, baseline: 0.35, drift: 0.05 });
    expect(byKey.w_i).toMatchObject({ current: 0.25, baseline: 0.3, drift: -0.05 });
    expect(byKey.w_c.drift).toBe(0);
    expect(byKey.w_a.drift).toBe(0);
    // 标签是人话，不是裸 key
    expect(byKey.w_f.label).toBe('新鲜度 w_f');
  });

  it('未配置的维度按基准值算（drift=0），不把「缺键」当 0 从而虚报 -0.35', () => {
    const rows = driftRows({ w_f: 0.40 }, { w_f: 0.35, w_i: 0.30 }, { w_f: '新鲜度', w_i: '重要度' });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ key: 'w_i', current: 0.3, baseline: 0.3, drift: 0 });
  });

  it('dedupDrift / thresholdDrift 复用同一口径（五维 / 六层）', () => {
    const dedup = dedupDrift(
      { semantic: 0.30, keyword: 0.28, entity: 0.15, structure: 0.12, llm_judge: 0.15 },
      { semantic: 0.35, keyword: 0.20, entity: 0.15, structure: 0.10, llm_judge: 0.20 },
    );
    expect(dedup).toHaveLength(5);
    expect(dedup[0]).toMatchObject({ key: 'semantic', drift: -0.05 });
    expect(dedup[4].label).toBe('LLM 仲裁');

    const layers = thresholdDrift(
      { L1: 0.6, L2: 0.65, L3: 0.78, L4: 0.85, L5: 0.9, L6: 0.95 },
      { L1: 0.6, L2: 0.65, L3: 0.8, L4: 0.85, L5: 0.9, L6: 0.95 },
    );
    expect(layers).toHaveLength(6);
    expect(layers[2]).toMatchObject({ key: 'L3', drift: -0.02 });
  });
});
