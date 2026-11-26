// 7.2 读取侧（mode_feedback → 分流回归）锁定测试。
// 口径来源：specs/tasks/MODE-DISPATCH-EVOLUTION.md §5（2026-11-25 用户拍板）。
import { describe, expect, it } from 'vitest';
import { normalizeGrowthConfig, type GrowthConfig } from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../paramsSnapshot.ts';
import { adoptSuggestedModeDispatch, runEvolutionRound } from '../evolution/loop.ts';
import { historyMemories } from '../evolution/versioning.ts';
import {
  applyDispatchProposal, buildDispatchSamples, dispatchBaseline, proposeModeDispatch,
  validDispatchProposal, type DispatchProposal,
} from '../evolution/modeDispatchRegression.ts';
import type { AuditRecord } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_700_000_000_000;

const audit = (request_id: string, action: AuditRecord['action'], ts: number, detail: Record<string, unknown>): AuditRecord =>
  ({ request_id, action, ts, detail } as AuditRecord);

/** 一次完整链路：recall(query) + mode_dispatch(mode/hit_keywords) + mode_feedback(verdict/reason) */
function chain(
  rid: string, ts: number, opts: {
    mode?: string; query?: string; keywords?: string[];
    verdict?: 'up' | 'down'; reason?: string | null; withDispatch?: boolean; expected_mode?: string | null;
  } = {},
): AuditRecord[] {
  const out: AuditRecord[] = [];
  if (opts.query !== undefined) out.push(audit(rid, 'recall', ts, { query: opts.query }));
  if (opts.withDispatch !== false) {
    out.push(audit(rid, 'mode_dispatch', ts, {
      mode: opts.mode ?? 'fact_first', applied_mode: 'auto', hit_keywords: opts.keywords ?? [], scene: 'default',
    }));
  }
  out.push(audit(rid, 'mode_feedback', ts, {
    mode: opts.mode ?? 'fact_first', verdict: opts.verdict ?? 'down', reason: opts.reason ?? '模式选错', source: 'auto',
    expected_mode: opts.expected_mode ?? null,
  }));
  return out;
}

const snapshot = (words: Record<string, string[]>) => ({
  min_len_zh: 30, min_len_en: 12, hit_threshold: 2,
  feature_words: Object.fromEntries(
    ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'].map((m) => [
      m, { words: words[m] ?? ['x', 'a', 'b', 'c'], high_conf: [] as string[] },
    ]),
  ),
  mode_weights: Object.fromEntries(
    ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'].map((m) => [m, { w_f: 0.25, w_i: 0.25, w_c: 0.25, w_a: 0.25 }]),
  ),
});

/** 合法快照（经内核整块校验）；既给纯函数用，也给进化轮当现行基线 */
const snap = (words: Record<string, string[]> = { fact_first: ['回滚', '核对', '报错', '故障'] }) =>
  normalizeGrowthConfig({ mode_dispatch: snapshot(words) }).mode_dispatch!;

describe('buildDispatchSamples：窗口 / 语义 / 关联 / 去重', () => {
  it('30 天窗口外的反馈不进样本；👎=召回内容不对 不计入有效标注', () => {
    const audits = [
      ...chain('old', NOW - 31 * DAY, {}),
      ...chain('c1', NOW - 1 * DAY, { verdict: 'down', reason: '召回内容不对' }),
      ...chain('u1', NOW - 2 * DAY, { verdict: 'up', reason: null }),
    ];
    const { metrics, samples } = buildDispatchSamples(audits, { now: NOW, windowDays: 30 });
    expect(metrics.feedback).toBe(2);           // old 在窗口外，连 feedback 都不计
    expect(metrics.ignored_content).toBe(1);
    expect(metrics.positives).toBe(1);
    expect(metrics.negatives).toBe(0);
    expect(metrics.tagged).toBe(1);
    expect(samples.map((s) => s.request_id)).toEqual(['u1']);
  });

  it('关联不到 mode_dispatch 的行计入 unlinked 并跳过；同 request_id 只算一次', () => {
    const audits = [
      ...chain('no-dispatch', NOW - DAY, { withDispatch: false }),
      ...chain('dup', NOW - DAY, { verdict: 'up', reason: null }),
      audit('dup', 'mode_feedback', NOW - DAY + 1, { mode: 'fact_first', verdict: 'up', reason: null }),
    ];
    const { metrics, samples } = buildDispatchSamples(audits, { now: NOW, windowDays: 30 });
    expect(metrics.unlinked).toBe(1);
    expect(metrics.tagged).toBe(1);
    expect(samples).toHaveLength(1);
  });

  it('采纳时刻之后的样本才算（since 生效，避免同批样本重复计）', () => {
    const audits = [
      ...chain('before', NOW - 10 * DAY, { verdict: 'up' }),
      ...chain('after', NOW - 1 * DAY, { verdict: 'up' }),
    ];
    const { samples } = buildDispatchSamples(audits, { now: NOW, windowDays: 30, since: NOW - 5 * DAY });
    expect(samples.map((s) => s.request_id)).toEqual(['after']);
  });
});

describe('proposeModeDispatch：单模式单变量、优先删词', () => {
  it('同一非高置信词触发 ≥2 条负样本 → 只提质删该词的一条建议', () => {
    const audits = [
      ...chain('n1', NOW - DAY, { mode: 'fact_first', keywords: ['回滚', '核对'], query: '回滚 核对' }),
      ...chain('n2', NOW - 2 * DAY, { mode: 'fact_first', keywords: ['回滚'], query: '回滚 流程' }),
      ...chain('n3', NOW - 3 * DAY, { mode: 'top_insight', keywords: ['架构'], query: '架构' }),
    ];
    const { samples } = buildDispatchSamples(audits, { now: NOW, windowDays: 30 });
    const { proposal } = proposeModeDispatch(samples, snap());
    expect(proposal?.action).toBe('remove_words');
    expect(proposal?.target_mode).toBe('fact_first');
    expect(proposal?.changed[0].to).toEqual(['核对', '报错', '故障']);
    expect(proposal?.sample_request_ids.sort()).toEqual(['n1', 'n2']);
  });

  it('负样本未集中在单词 / 无负样本 / 删后不足 3 词 → 不产建议并给中文原因', () => {
    const scattered = buildDispatchSamples([
      ...chain('s1', NOW - DAY, { keywords: ['回滚'] }),
      ...chain('s2', NOW - DAY, { keywords: ['核对'] }),
    ], { now: NOW, windowDays: 30 }).samples;
    expect(proposeModeDispatch(scattered, snap({ fact_first: ['回滚', '核对', '报错'] })).proposal).toBeNull();

    expect(proposeModeDispatch([], null).reason).toContain('无有效负样本');

    const tight = buildDispatchSamples([
      ...chain('t1', NOW - DAY, { keywords: ['回滚'] }),
      ...chain('t2', NOW - DAY, { keywords: ['回滚'] }),
    ], { now: NOW, windowDays: 30 }).samples;
    const r = proposeModeDispatch(tight, snap({ fact_first: ['回滚', '核对', '报错'] }));
    expect(r.proposal).toBeNull();
    expect(r.reason).toContain('不足 3 个特征词');
  });
});

async function seed(storage: InMemoryStorage, cfg: GrowthConfig): Promise<void> {
  await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
}

describe('进化轮接线：不足 / 只建议 / auto 采纳', () => {
  it('有效标注 < 10 → insufficient，且不写配置', async () => {
    const storage = new InMemoryStorage();
    const cfg = normalizeGrowthConfig({ evolution: { mode: 'suggest', window: { dedup_days: 30, recall_days: 7, dispatch_days: 30 }, sample_top_n: 20, min_samples: { dedup_total: 40, dedup_negatives: 10, recall_count: 30, recall_tagged: 10, dispatch_tagged: 10 }, rollback: { after_days: 7, min_recalls: 20, max_drop: 0.03 }, guard: { cooldown_days: 7, max_step: 0.05, max_drift: 0.15 } } });
    await seed(storage, cfg);
    for (let i = 0; i < 3; i++) {
      for (const a of chain(`k${i}`, NOW - DAY, { verdict: 'up', reason: null })) await storage.appendAudit(a);
    }
    const r = await runEvolutionRound(storage, { requestId: 'ev1', form: 'desktop', now: NOW });
    const d = r.decisions.find((x) => x.family === 'mode_dispatch');
    expect(d?.status).toBe('insufficient');
    expect(d?.reason).toContain('3/10');
    const ops = await storage.queryAudit({ action: 'growth_op' });
    expect(ops.some((o) => (o.detail as { family?: string }).family === 'mode_dispatch')).toBe(true);
  });

  it('suggest 模式：产建议审计但绝不写 growth:v1', async () => {
    const storage = new InMemoryStorage();
    const cfg = normalizeGrowthConfig({ evolution: { mode: 'suggest', window: { dedup_days: 30, recall_days: 7, dispatch_days: 30 }, sample_top_n: 20, min_samples: { dedup_total: 40, dedup_negatives: 10, recall_count: 30, recall_tagged: 10, dispatch_tagged: 10 }, rollback: { after_days: 7, min_recalls: 20, max_drop: 0.03 }, guard: { cooldown_days: 7, max_step: 0.05, max_drift: 0.15 } } });
    const withSnap = { ...cfg, mode_dispatch: snap() };
    await seed(storage, withSnap);
    for (let i = 0; i < 8; i++) {
      for (const a of chain(`u${i}`, NOW - DAY, { verdict: 'up', reason: null })) await storage.appendAudit(a);
    }
    for (let i = 0; i < 2; i++) {
      for (const a of chain(`n${i}`, NOW - DAY, { keywords: ['回滚'] })) await storage.appendAudit(a);
    }
    const before = JSON.stringify((await storage.listMemories({})).map((m) => m.content).filter((c) => c.startsWith('growth:v1:')));
    const r = await runEvolutionRound(storage, { requestId: 'ev2', form: 'desktop', now: NOW });
    const d = r.decisions.find((x) => x.family === 'mode_dispatch');
    expect(d?.dispatch?.action).toBe('remove_words');
    expect(d?.applied).toBe(false);
    const after = JSON.stringify((await storage.listMemories({})).map((m) => m.content).filter((c) => c.startsWith('growth:v1:')));
    expect(after).toBe(before);
    const sug = (await storage.queryAudit({ action: 'growth_op' }))
      .filter((o) => (o.detail as { event?: string }).event === 'suggest_mode_dispatch');
    expect(sug).toHaveLength(1);
  });

  it('auto 模式：整块校验通过才写盘，采纳前存 history', async () => {
    const storage = new InMemoryStorage();
    const cfg = normalizeGrowthConfig({ evolution: { mode: 'auto', window: { dedup_days: 30, recall_days: 7, dispatch_days: 30 }, sample_top_n: 20, min_samples: { dedup_total: 40, dedup_negatives: 10, recall_count: 30, recall_tagged: 10, dispatch_tagged: 10 }, rollback: { after_days: 7, min_recalls: 20, max_drop: 0.03 }, guard: { cooldown_days: 7, max_step: 0.05, max_drift: 0.15 } } });
    const withSnap = { ...cfg, mode_dispatch: snap() };
    await seed(storage, withSnap);
    for (let i = 0; i < 8; i++) {
      for (const a of chain(`u${i}`, NOW - DAY, { verdict: 'up', reason: null })) await storage.appendAudit(a);
    }
    for (let i = 0; i < 2; i++) {
      for (const a of chain(`n${i}`, NOW - DAY, { keywords: ['回滚'] })) await storage.appendAudit(a);
    }
    const r = await runEvolutionRound(storage, { requestId: 'ev3', form: 'desktop', now: NOW });
    const d = r.decisions.find((x) => x.family === 'mode_dispatch');
    expect(d?.status).toBe('adopted');
    expect(d?.history_saved).toBe(true);
    const mems = await storage.listMemories({});
    const cur = mems.find((m) => m.content.startsWith('growth:v1:') && !m.content.startsWith('growth:v1:history:'));
    expect(cur?.content).not.toContain('"回滚"');
  });
});

/* ── 手动采纳入口（growth_evolve adopt family=mode_dispatch） ── */

/** 一条形状合法的「删词」建议（手动采纳只认审计里的建议，这里模拟已有审计内容） */
const proposalFor = (word: string): DispatchProposal => ({
  family: 'mode_dispatch', target_mode: 'fact_first', action: 'remove_words',
  changed: [{
    from: ['报错', '堆栈', '日志', '核对', '验证', '是否', '对不对', '实际值', 'trace', 'exception'],
    to: ['报错', '堆栈', '日志', '验证', '是否', '对不对', '实际值', 'trace', 'exception'],
  }],
  reason: `fact_first 的 2 条负样本中有 2 条由「${word}」触发，建议删该词`,
  sample_request_ids: ['n1', 'n2'],
});

async function seedSuggestAudit(storage: InMemoryStorage, ts: number, word = '核对'): Promise<void> {
  await storage.appendAudit(audit('sug_dp', 'growth_op', ts, {
    phase: 'evolution', event: 'suggest_mode_dispatch', family: 'mode_dispatch',
    applied: false, status: 'suggested', dispatch: proposalFor(word),
    reason: `${proposalFor(word).reason}（mode=suggest：只产建议，未写配置）`,
  }));
}

const suggestCfg = () => normalizeGrowthConfig({ evolution: { mode: 'suggest' } });

describe('dispatchBaseline / applyDispatchProposal（基线解析与整块落盘）', () => {
  it('账本无快照 → 用内核基线物化，且整块校验通过（30/12/2 + 五模式词表与权重）', () => {
    const b = dispatchBaseline(null);
    expect(b?.source).toBe('kernel');
    expect(b?.base.min_len_zh).toBe(30);
    expect(b?.base.min_len_en).toBe(12);
    expect(b?.base.hit_threshold).toBe(2);
    expect(b?.base.feature_words.top_insight.words).toContain('架构');
    expect(b?.base.feature_words.fact_first.high_conf).toEqual(['事故', '故障']);
    const sum = Object.values(b!.base.mode_weights).map((w) => w.w_f + w.w_i + w.w_c + w.w_a);
    expect(sum.every((s) => Math.abs(s - 1) <= 1e-6)).toBe(true);
  });

  it('账本有快照 → source=ledger 且逐字沿用，不被内核基线覆盖', () => {
    const cur = snap({ fact_first: ['回滚', '核对', '报错'] });
    const b = dispatchBaseline(cur);
    expect(b?.source).toBe('ledger');
    expect(b?.base.feature_words.fact_first.words).toEqual(['回滚', '核对', '报错']);
  });

  it('建议只改目标模式词表，其他模式与高置信词逐字不动；非法建议 → null（不写半份）', () => {
    const base = dispatchBaseline(null)!.base;
    const next = applyDispatchProposal(base, proposalFor('核对'))!;
    expect(next.feature_words.fact_first.words).not.toContain('核对');
    expect(next.feature_words.fact_first.high_conf).toEqual(base.feature_words.fact_first.high_conf);
    expect(next.feature_words.top_insight).toEqual(base.feature_words.top_insight);
    expect(applyDispatchProposal(base, { ...proposalFor('核对'), changed: [] })).toBeNull();
    // 账本被手改成「只剩 2 个词」也必须拦住（防模式失明，落盘侧再守一次）
    expect(applyDispatchProposal(base, { ...proposalFor('核对'), changed: [{ from: ['a'], to: ['报错', '验证'] }] })).toBeNull();
  });

  it('validDispatchProposal：缺字段/错族/错动作一律判无效（手动采纳不凭字段存在就认）', () => {
    expect(validDispatchProposal(proposalFor('核对'))).toBe(true);
    expect(validDispatchProposal({ ...proposalFor('核对'), action: 'not_an_action' })).toBe(false);
    expect(validDispatchProposal({ ...proposalFor('核对'), family: 'recall_weights' })).toBe(false);
    expect(validDispatchProposal({ ...proposalFor('核对'), changed: [{ from: ['a'] }] })).toBe(false);
    expect(validDispatchProposal(null)).toBe(false);
  });
});

describe('adoptSuggestedModeDispatch（手动采纳分流建议）', () => {
  it('无建议 / mode=off → 如实拒绝，不写配置', async () => {
    const s1 = new InMemoryStorage();
    await saveGrowthConfigToLedger(s1, suggestCfg(), { requestId: 'seed', form: 'desktop' });
    const none = await adoptSuggestedModeDispatch(s1, { requestId: 'ad1', form: 'desktop', now: NOW });
    expect(none.applied).toBe(false);
    expect(none.reason).toContain('没有可采纳的分流建议');

    const s2 = new InMemoryStorage();
    await saveGrowthConfigToLedger(s2, normalizeGrowthConfig({ evolution: { mode: 'off' } }), { requestId: 'seed', form: 'desktop' });
    await seedSuggestAudit(s2, NOW - 1000);
    const off = await adoptSuggestedModeDispatch(s2, { requestId: 'ad2', form: 'desktop', now: NOW });
    expect(off.applied).toBe(false);
    expect(off.reason).toContain('off');
  });

  it('有建议 + 账本无快照 → 以内核基线为基底落库（baseline_source=kernel）、存历史、审计 adopted_via=manual', async () => {
    const storage = new InMemoryStorage();
    await saveGrowthConfigToLedger(storage, suggestCfg(), { requestId: 'seed', form: 'desktop' });
    await seedSuggestAudit(storage, NOW - 1000);

    const r = await adoptSuggestedModeDispatch(storage, { requestId: 'ad3', form: 'desktop', now: NOW });
    expect(r.applied).toBe(true);
    expect(r.baseline_source).toBe('kernel');
    expect(r.to?.feature_words.fact_first.words).not.toContain('核对');

    const cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.mode_dispatch?.feature_words.fact_first.words).not.toContain('核对');
    expect(cfg.mode_dispatch?.feature_words.event_replay.words).toContain('复现');
    expect(historyMemories(await storage.listMemories({}))).toHaveLength(1);

    const adopted = (await storage.queryAudit({ action: 'growth_op' }))
      .filter((a) => (a.detail as { event?: string }).event === 'adopted');
    expect(adopted).toHaveLength(1);
    const d = adopted[0].detail as { family?: string; adopted_via?: string; baseline_source?: string };
    expect(d.family).toBe('mode_dispatch');
    expect(d.adopted_via).toBe('manual');
    expect(d.baseline_source).toBe('kernel');
  });

  it('采纳后进入冷却期 → 再次采纳被护栏拒绝（不静默放行）', async () => {
    const storage = new InMemoryStorage();
    await saveGrowthConfigToLedger(storage, suggestCfg(), { requestId: 'seed', form: 'desktop' });
    await seedSuggestAudit(storage, NOW - 1000);
    expect((await adoptSuggestedModeDispatch(storage, { requestId: 'ad4', form: 'desktop', now: NOW })).applied).toBe(true);

    const second = await adoptSuggestedModeDispatch(storage, { requestId: 'ad5', form: 'desktop', now: NOW + DAY });
    expect(second.applied).toBe(false);
    expect(second.reason).toContain('冷却期内');
  });
});

// ── add_words（2026-11-26 解锁：expected_mode 字段，方案 MODE-FEEDBACK-TARGET-FIELD.md） ──
describe('add_words 建议（目标模式字段 + 已知词表并集，不抽自然语言）', () => {
  /** 两条 👎+模式选错+expected_mode=event_replay，query 含「验证」(在 fact_first 词表、不在 event_replay) */
  const addSamples = () => {
    const audits = [
      ...chain('r_add1', NOW - DAY, { mode: 'fact_first', query: '验证 流程', expected_mode: 'event_replay' }),
      ...chain('r_add2', NOW - DAY / 2, { mode: 'fact_first', query: '核对 验证 时间线', expected_mode: 'event_replay' }),
    ];
    return buildDispatchSamples(audits, { now: NOW, windowDays: 30 }).samples;
  };
  const cur = snapshot({
    fact_first: ['报错', '验证', '核对', '是否'],
    event_replay: ['复现', '重现', '回顾', '时间线'],
  }) as Parameters<typeof proposeModeDispatch>[1];

  it('两条不同 request_id 指向同目标模式 + 已知词 → 产 add_words', () => {
    const r = proposeModeDispatch(addSamples(), cur);
    expect(r.proposal?.action).toBe('add_words');
    expect(r.proposal?.target_mode).toBe('event_replay');
    expect(r.proposal?.changed[0].to).toContain('验证');
    expect(r.proposal?.sample_request_ids.sort()).toEqual(['r_add1', 'r_add2']);
  });

  it('单条样本 → 不产（C 变异验证：把 ≥2 改成 ≥1 本例必须红）', () => {
    const one = addSamples().slice(0, 1);
    expect(proposeModeDispatch(one, cur).proposal).toBeNull();
  });

  it('query 里的新词不在任何已知词表 → 不产，不抽自然语言造证据', () => {
    const audits = [
      ...chain('r_new1', NOW - DAY, { query: '品牌战略 验证', expected_mode: 'event_replay' }),
      ...chain('r_new2', NOW - DAY, { query: '品牌战略 验证', expected_mode: 'event_replay' }),
    ];
    const s = buildDispatchSamples(audits, { now: NOW, windowDays: 30 }).samples;
    expect(proposeModeDispatch(s, cur).proposal).not.toBeNull(); // 对照组：含已知词能产
    // 「验证」在所有 chain 里被 mode 词表命中，但这两条走了 expected，仍可命中「验证」——换成完全未知词
    const unknown = buildDispatchSamples([
      ...chain('u1', NOW - DAY, { query: '量子纠缠 拓扑绝缘', expected_mode: 'event_replay' }),
      ...chain('u2', NOW - DAY, { query: '量子纠缠 拓扑绝缘', expected_mode: 'event_replay' }),
    ], { now: NOW, windowDays: 30 }).samples;
    expect(proposeModeDispatch(unknown, cur).proposal).toBeNull();
    expect(s.length).toBe(2);
  });

  it('旧账本无 expected_mode → 不产 add_words（向后兼容）', () => {
    const audits = [
      ...chain('r_old1', NOW - DAY, { query: '验证 流程' }),
      ...chain('r_old2', NOW - DAY, { query: '核对 验证' }),
    ];
    const s = buildDispatchSamples(audits, { now: NOW, windowDays: 30 }).samples;
    expect(s.every((x) => x.expected_mode === null)).toBe(true);
    expect(proposeModeDispatch(s, cur).proposal).toBeNull();
  });

  it('词表已达 40 上限 → 拒绝增词并写原因', () => {
    const full = snapshot({
      fact_first: ['报错', '验证', '核对', '是否'],
      event_replay: Array.from({ length: 40 }, (_, i) => `w${i}`),
    }) as Parameters<typeof proposeModeDispatch>[1];
    const r = proposeModeDispatch(addSamples(), full);
    expect(r.proposal).toBeNull();
    expect(r.reason).toContain('上限');
  });

  it('validDispatchProposal 放行 add_words 但仍拒假形状', () => {
    const p = proposeModeDispatch(addSamples(), cur).proposal!;
    expect(validDispatchProposal(p)).toBe(true);
    expect(validDispatchProposal({ ...p, action: 'hack' })).toBe(false);
    expect(validDispatchProposal({ ...p, changed: [{ from: 'x', to: [] }] })).toBe(false);
  });
});
