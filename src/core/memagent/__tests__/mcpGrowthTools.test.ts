// 批次 B/C/D：growth_evolve 编排 + 一键采纳 + 场景画像 + 卡片进化行（纯函数与编排契约）
import { describe, expect, it } from 'vitest';
import { DEFAULT_RECALL_WEIGHTS, normalizeGrowthConfig, type EvolutionConfig, type GrowthConfig } from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../paramsSnapshot.ts';
import { adoptSuggestedRecallWeights } from '../evolution/loop.ts';
import { buildSceneProfile } from '../evolution/sceneProfile.ts';
import { growthCardSummary, runGrowthEvolveTool } from '../mcpGrowthTools.ts';
import { historyMemories } from '../evolution/versioning.ts';
import type { Memory } from '../types.ts';

const NOW = 1_700_000_000_000;
const DAY = 24 * 3600 * 1000;

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

async function seedConfig(storage: InMemoryStorage, patch: (ev: EvolutionConfig) => void): Promise<GrowthConfig> {
  const cfg = makeCfg(patch);
  await saveGrowthConfigToLedger(storage, cfg, { requestId: 'seed', form: 'desktop' });
  return cfg;
}

/** LOOSE：最小样本 1、护栏放宽、回诊放宽（与 evolutionLoop.test.ts 同口径） */
const LOOSE = (ev: EvolutionConfig): void => {
  ev.min_samples.recall_count = 1;
  ev.guard.max_step = 0.20;
  ev.guard.max_drift = 0.50;
  ev.rollback.after_days = 7;
  ev.rollback.min_recalls = 0;
  ev.rollback.max_drop = 0.03;
};

/** 一条护栏可过的建议（每维步长 ≤0.05、漂移 ≤0.15，同守默认护栏） */
const SUGGEST_TO = { w_f: 0.38, w_i: 0.30, w_c: 0.13, w_a: 0.19 };

async function seedSuggestion(storage: InMemoryStorage, ts = NOW - 1000, withEval = true): Promise<void> {
  await storage.appendAudit({
    request_id: 'sug_1', action: 'growth_op', ts, project_id: 'P_SYSTEM',
    detail: {
      phase: 'evolution', event: 'suggest_recall_weights', family: 'recall_weights',
      status: 'suggested', applied: false,
      from: DEFAULT_RECALL_WEIGHTS, to: SUGGEST_TO,
      ...(withEval ? { eval: { status: 'suggest', meanTo: 0.62, reason: 'NDCG 提升 0.012' } } : {}),
      reason: 'NDCG 提升 0.012（mode=suggest：只产建议，未写配置）',
    },
  });
}

describe('批次 B：growthCardSummary（卡片进化行，纯函数）', () => {
  it('默认配置：模式 suggest ｜ 暂无评估记录；growth_op 有建议 → 已产建议待采纳', () => {
    const row = growthCardSummary([], [], NOW);
    expect(row.label).toBe('进化');
    expect(row.value).toContain('模式 suggest');
    expect(row.value).toContain('暂无评估记录');

    const audits = [{
      request_id: 'g1', action: 'growth_op' as const, ts: NOW, project_id: 'P_SYSTEM',
      detail: { phase: 'evolution', family: 'recall_weights', event: 'suggest_recall_weights', status: 'suggested' },
    }];
    const row2 = growthCardSummary([], audits, NOW);
    expect(row2.value).toContain('已产建议待采纳');
  });

  it('近 7 天 reject_downgrade → 计入降档数；窗口外不计', () => {
    const mk = (ts: number) => ({
      request_id: `d_${ts}`, action: 'growth_op' as const, ts, project_id: 'P_SYSTEM',
      detail: { entry: { event: 'reject_downgrade', payload: '{"mem_id":"mem_1"}' } },
    });
    const audits = [mk(NOW - DAY), mk(NOW - 8 * DAY)];
    const row = growthCardSummary([], audits, NOW);
    expect(row.value).toContain('近 7 天反馈降档 1 条');
  });

  it('mode=off 如实显示（不伪装成 suggest）', () => {
    const mem: Memory = {
      mem_id: 'growth_off', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: '', team_id: '',
      category: 'preference', layer: 'L2', content: `growth:v1:${JSON.stringify({
        ...normalizeGrowthConfig(null), evolution: { ...normalizeGrowthConfig(null).evolution, mode: 'off' },
      })}`, decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: NOW, updated_at: NOW,
    };
    const row = growthCardSummary([mem], [], NOW);
    expect(row.value).toContain('模式 off');
  });
});

describe('批次 C1：adoptSuggestedRecallWeights（一键采纳）', () => {
  it('无建议审计 → applied:false 且不写配置；mode=off → 明确拒绝', async () => {
    const s1 = new InMemoryStorage();
    await seedConfig(s1, LOOSE);
    const r1 = await adoptSuggestedRecallWeights(s1, { requestId: 'adopt_1', form: 'desktop', now: NOW });
    expect(r1.applied).toBe(false);
    expect(r1.reason).toContain('没有可采纳的建议');

    const s2 = new InMemoryStorage();
    await seedConfig(s2, (ev) => { ev.mode = 'off'; });
    await seedSuggestion(s2);
    const r2 = await adoptSuggestedRecallWeights(s2, { requestId: 'adopt_2', form: 'desktop', now: NOW });
    expect(r2.applied).toBe(false);
    expect(r2.reason).toContain('off');
  });

  it('建议真实存在 + 护栏过 → applied:true：growth:v1 更新、历史留存、审计 adopted_via=manual、挂回诊计划', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    await seedSuggestion(storage);
    const r = await adoptSuggestedRecallWeights(storage, { requestId: 'adopt_ok', form: 'desktop', now: NOW });
    expect(r.applied).toBe(true);
    expect(r.to).toEqual(SUGGEST_TO);
    expect(r.history_saved).toBe(true);

    const cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.recall_weights).toEqual(SUGGEST_TO);
    expect(historyMemories(await storage.listMemories({})).length).toBeGreaterThan(0);

    const adopted = (await storage.queryAudit({ action: 'growth_op' }))
      .filter((a) => (a.detail as { event?: unknown }).event === 'adopted');
    expect(adopted).toHaveLength(1);
    const d = adopted[0].detail as { adopted_via?: unknown; rollback_plan?: unknown; reason?: unknown };
    expect(d.adopted_via).toBe('manual');
    expect(d.rollback_plan).toBeTruthy(); // 建议带 eval.meanTo → 挂回诊计划
    expect(String(d.reason)).toContain('一键采纳');
  });

  it('建议审计无 eval 基线 → 采纳成功但不挂回诊计划（诚实标注，不猜 baseline）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    await seedSuggestion(storage, NOW - 1000, false);
    const r = await adoptSuggestedRecallWeights(storage, { requestId: 'adopt_noeval', form: 'desktop', now: NOW });
    expect(r.applied).toBe(true);
    const adopted = (await storage.queryAudit({ action: 'growth_op' }))
      .filter((a) => (a.detail as { event?: unknown }).event === 'adopted');
    expect((adopted[0].detail as { rollback_plan?: unknown }).rollback_plan).toBeUndefined();
    expect(r.reason).toContain('未挂回诊计划');
  });

  it('采纳计入冷却期：采纳后再采纳（即使有新建议）→ 护栏拒绝', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    await seedSuggestion(storage);
    const first = await adoptSuggestedRecallWeights(storage, { requestId: 'adopt_a', form: 'desktop', now: NOW });
    expect(first.applied).toBe(true);
    await seedSuggestion(storage, NOW + 1000); // 新建议
    const second = await adoptSuggestedRecallWeights(storage, { requestId: 'adopt_b', form: 'desktop', now: NOW + 2000 });
    expect(second.applied).toBe(false);
    expect(second.reason).toContain('护栏未通过');
  });
});

describe('批次 D：buildSceneProfile（场景画像，纯函数）', () => {
  const recall = (ts: number, scene: string, hitKeywords?: string[]) => ({
    request_id: `r_${ts}_${scene}`, action: 'recall' as const, ts, project_id: 'P1',
    detail: { scene, ...(hitKeywords ? { hit_keywords: hitKeywords } : {}) },
  });

  it('按 scene 聚合：次数/占比/最近时间/Top 词降序；dominant_scene 取次数最多', () => {
    const audits = [
      recall(NOW - 1000, 'default', ['打包', '端口']),
      recall(NOW - 2000, 'default', ['打包', '门禁']),
      recall(NOW - 3000, 'task_start', ['批次']),
      recall(NOW - 8 * DAY, 'critical', ['旧窗口不计']),
    ];
    const p = buildSceneProfile(audits, NOW, 7);
    expect(p.total_recalls).toBe(3);
    expect(p.dominant_scene).toBe('default');
    expect(p.scenes[0]).toMatchObject({ scene: 'default', count: 2, share: 0.667 });
    expect(p.scenes[0].top_terms).toEqual(['打包', '端口', '门禁']); // 并列词按 localeCompare 决胜
    expect(p.scenes.find((s) => s.scene === 'critical')).toBeUndefined(); // 窗口外不计
    expect(p.note).toContain('不落库');
  });

  it('无审计 → 全零诚实（total 0、scenes 空、dominant null、share 0）', () => {
    const p = buildSceneProfile([], NOW, 30);
    expect(p.total_recalls).toBe(0);
    expect(p.scenes).toEqual([]);
    expect(p.dominant_scene).toBeNull();
  });

  it('审计缺 hit_keywords → top_terms 空数组（不编造）；缺 scene 归 default', () => {
    const audits = [
      { request_id: 'r1', action: 'recall' as const, ts: NOW - 500, project_id: 'P1', detail: {} },
      { request_id: 'r2', action: 'recall' as const, ts: NOW - 600, project_id: 'P1', detail: { scene: 'default' } },
    ];
    const p = buildSceneProfile(audits, NOW, 7);
    expect(p.scenes[0].top_terms).toEqual([]);
    expect(p.scenes[0].count).toBe(2);
  });
});

describe('批次 B/C/D：runGrowthEvolveTool（MCP 编排）', () => {
  it('action 非法 / profile 窗口越界 / policy enabled 非布尔 → McpToolError', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    for (const bad of [
      { action: 'bogus' },
      { action: 'profile', window_days: 0 },
      { action: 'profile', window_days: 366 },
      { action: 'policy', enabled: 'yes' },
      { action: 'policy', enabled: true, window_days: 0 },
      { action: 'policy', enabled: true, reject_downgrade_threshold: 99 },
    ]) {
      await expect(runGrowthEvolveTool(storage, bad, { form: 'desktop', now: NOW })).rejects.toThrow();
    }
  });

  it('status：返回模式/权重/最近评估/待采纳建议（只读，不写审计）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    await seedSuggestion(storage);
    const before = (await storage.queryAudit({})).length;
    const r = await runGrowthEvolveTool(storage, { action: 'status' }, { form: 'desktop', now: NOW });
    expect(r.action).toBe('status');
    expect(r.mode).toBe('suggest');
    expect(r.weights).toEqual({ ...DEFAULT_RECALL_WEIGHTS });
    expect(r.latest_eval?.event).toBe('suggest_recall_weights');
    expect(r.suggestion?.to).toEqual(SUGGEST_TO);
    expect((await storage.queryAudit({})).length).toBe(before); // 只读
  });

  it('adopt：经编排层采纳成功（与 loop 直调同一链路）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    await seedSuggestion(storage);
    const r = await runGrowthEvolveTool(storage, { action: 'adopt' }, { form: 'desktop', now: NOW });
    expect(r.applied).toBe(true);
    expect(r.to).toEqual(SUGGEST_TO);
    const cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.recall_weights).toEqual(SUGGEST_TO);
  });

  it('adopt family=mode_dispatch：分流建议落库；status 回放建议与基线来源；family 非法 → McpToolError', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE); // 默认 suggest（可采纳，但不自动写）
    await storage.appendAudit({
      request_id: 'sug_dp', action: 'growth_op', ts: NOW - 1000, project_id: 'P_SYSTEM',
      detail: {
        phase: 'evolution', event: 'suggest_mode_dispatch', family: 'mode_dispatch',
        applied: false, status: 'suggested',
        dispatch: {
          family: 'mode_dispatch', target_mode: 'fact_first', action: 'remove_words',
          changed: [{ from: ['报错', '核对', '验证', '是否'], to: ['报错', '验证', '是否'] }],
          reason: 'fact_first 的 2 条负样本中有 2 条由「核对」触发，建议删该词',
          sample_request_ids: ['n1', 'n2'],
        },
        reason: '只产建议，未写配置',
      },
    });

    const st = await runGrowthEvolveTool(storage, { action: 'status' }, { form: 'desktop', now: NOW });
    expect(st.dispatch_suggestion?.dispatch.target_mode).toBe('fact_first');
    expect(st.dispatch_baseline).toBe('kernel'); // 账本尚无快照

    const r = await runGrowthEvolveTool(storage, { action: 'adopt', family: 'mode_dispatch' }, { form: 'desktop', now: NOW });
    expect(r.family).toBe('mode_dispatch');
    expect(r.applied).toBe(true);
    expect(r.baseline_source).toBe('kernel');
    const cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.mode_dispatch?.feature_words.fact_first.words).toEqual(['报错', '验证', '是否']);
    // 采纳后 status 的基线来源变账本
    const st2 = await runGrowthEvolveTool(storage, { action: 'status' }, { form: 'desktop', now: NOW });
    expect(st2.dispatch_baseline).toBe('ledger');

    await expect(
      runGrowthEvolveTool(storage, { action: 'adopt', family: 'dedup_weights' }, { form: 'desktop', now: NOW }),
    ).rejects.toThrow();
  });

  it('profile：返回窗口内场景画像（真实审计聚合）', async () => {
    const storage = new InMemoryStorage();
    await storage.appendAudit({
      request_id: 'pr_1', action: 'recall', ts: NOW - 1000, project_id: 'P1',
      detail: { scene: 'default', hit_keywords: ['打包'] },
    });
    const r = await runGrowthEvolveTool(storage, { action: 'profile', window_days: 7 }, { form: 'desktop', now: NOW });
    expect(r.profile?.total_recalls).toBe(1);
    expect(r.profile?.dominant_scene).toBe('default');
    expect(r.profile?.scenes[0].top_terms).toEqual(['打包']);
  });

  it('policy：启用降档 → growth:v1 更新 + growth_op 审计留痕；停用回默认关闭口径', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    const on = await runGrowthEvolveTool(storage, { action: 'policy', enabled: true, window_days: 14, reject_downgrade_threshold: 2 }, { form: 'desktop', now: NOW });
    expect(on.applied).toBe(true);
    expect(on.feedback_policy).toEqual({ enabled: true, window_days: 14, reject_downgrade_threshold: 2 });
    let cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.feedback_policy.enabled).toBe(true);

    const off = await runGrowthEvolveTool(storage, { action: 'policy', enabled: false }, { form: 'desktop', now: NOW + 1000 });
    expect(off.feedback_policy?.enabled).toBe(false);
    cfg = growthConfigFromLedger(await storage.listMemories({}));
    expect(cfg.feedback_policy.enabled).toBe(false);
    const saved = (await storage.queryAudit({ action: 'growth_op' }))
      .filter((a) => (a.detail as { event?: unknown }).event === 'policy_saved');
    expect(saved).toHaveLength(2);
  });

  it('rollback：family 必填仅 mode_dispatch；无计划 → none（只读不写审计）', async () => {
    const storage = new InMemoryStorage();
    await seedConfig(storage, LOOSE);
    const before = (await storage.queryAudit({})).length;
    await expect(runGrowthEvolveTool(storage, { action: 'rollback' }, { form: 'desktop', now: NOW }))
      .rejects.toThrow('仅支持 family=mode_dispatch');
    await expect(runGrowthEvolveTool(storage, { action: 'rollback', family: 'recall_weights' }, { form: 'desktop', now: NOW }))
      .rejects.toThrow('仅支持 family=mode_dispatch');
    await expect(runGrowthEvolveTool(storage, { action: 'rollback', family: 'mode_dispatch', force: 'yes' }, { form: 'desktop', now: NOW }))
      .rejects.toThrow('force 须为布尔值');
    const r = await runGrowthEvolveTool(storage, { action: 'rollback', family: 'mode_dispatch', force: true }, { form: 'desktop', now: NOW });
    expect(r.rollback?.status).toBe('none');
    expect((await storage.queryAudit({})).length).toBe(before);
  });
});
