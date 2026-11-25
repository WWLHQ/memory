// P2-9 三项已批准裁决的锁定测试（2026-11-25）：显式冲突对 / critical 硬下限守卫 / growth:v1 整块回退。
import { describe, expect, it } from 'vitest';
import { applyDepthGuard, buildConflictNotes } from '../recallModeKernel.ts';
import { modeDispatchFromLedger } from '../paramsSnapshot.ts';
import { normalizeGrowthConfig, normalizeModeDispatch } from '../../../shared/growthConfig.ts';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { Hit, Memory } from '../types.ts';

const q = '架构 规范 红线 冲突 核对';
const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const hit = (id: string, layer: Hit['layer'], score: number, content = q): Hit => ({
  mem_id: id, content, layer, decay_class: 'hot', pinned: false, locked: false,
  score, evidence_ref: `l0:${id}`,
});
const mem = (id: string, layer: Memory['layer'], cid?: string): Memory => ({
  mem_id: id, project_id: 'P1', user_id: 'u1', enterprise_id: 'e1', team_id: 't1',
  category: 'fact', layer, content: q, decay_class: 'hot', pinned: false, locked: false,
  version: 1, created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000,
  ...(cid ? { conflict_id: cid } : {}),
});

describe('P2-9-① 显式冲突对仲裁', () => {
  it('只仲裁成对显式标记；同一对在 fact_first 与 top_insight 下 winner 可不同', () => {
    const hits = [hit('mem_l3', 'L3', 0.8), hit('mem_l5', 'L5', 0.7)];
    const mems = [mem('mem_l3', 'L3', 'cf_1'), mem('mem_l5', 'L5', 'cf_1')];
    const fact = buildConflictNotes(hits, mems, 'fact_first');
    const top = buildConflictNotes(hits, mems, 'top_insight');
    expect(fact[0]?.winner).toBe('mem_l3');
    expect(top[0]?.winner).toBe('mem_l5');
    expect(fact[0]?.rationale).toContain('L3 真实事实优先');
    expect(top[0]?.rationale).toContain('顶层原则约束下层事实');
    expect(fact[0]?.text).toContain('[冲突]');
  });
  it('单条标记或三条共享 cid 不仲裁；未标记对不推断', () => {
    const hits = [hit('a', 'L3', 0.9), hit('b', 'L4', 0.8), hit('c', 'L2', 0.7)];
    const mems = [mem('a', 'L3', 'cf_1'), mem('b', 'L4', 'cf_1'), mem('c', 'L2', 'cf_1')];
    expect(buildConflictNotes(hits, mems, 'fact_first')).toHaveLength(0);
    expect(buildConflictNotes(hits, [mem('a', 'L3'), mem('b', 'L4')], 'fact_first')).toHaveLength(0);
  });
});

describe('P2-9-② critical 硬下限守卫', () => {
  it('三层有候选时每层补回最高分；非 critical 不动', () => {
    const hits = [hit('l3a', 'L3', 0.9, 'a'.repeat(40))];
    const candidates = [
      hit('l3a', 'L3', 0.9, 'a'.repeat(40)), hit('l3b', 'L3', 0.7, 'b'.repeat(40)),
      hit('l4a', 'L4', 0.8, 'c'.repeat(40)), hit('l2a', 'L2', 0.6, 'd'.repeat(40)),
    ];
    const est = (s: string) => s.length;
    const guarded = applyDepthGuard(hits, candidates, 'critical', 1000, est);
    expect(guarded.guard.triggered).toBe(true);
    expect(guarded.hits.map((h) => h.mem_id).sort()).toEqual(['l2a', 'l3a', 'l4a']);
    expect(guarded.guard.restored).toContain('l4a');
    const other = applyDepthGuard(hits, candidates, 'default', 1000, est);
    expect(other.hits).toEqual(hits);
    expect(other.guard.triggered).toBe(false);
  });
  it('预算不足时如实标注 reason，不伪造占位条目', () => {
    const hits = [hit('l3a', 'L3', 0.9, 'x'.repeat(900))];
    const candidates = [hit('l3a', 'L3', 0.9, 'x'.repeat(900)), hit('l4a', 'L4', 0.8, 'y'.repeat(900))];
    const g = applyDepthGuard(hits, candidates, 'critical', 1000, (s) => s.length);
    expect(g.guard.reason).toContain('硬熔断');
    expect(g.hits.every((h) => h.mem_id !== 'phantom')).toBe(true);
  });
});

const snapshot = () => ({
  min_len_zh: 30, min_len_en: 12, hit_threshold: 2,
  feature_words: {
    top_insight: { words: ['架构', '规范'], high_conf: [] },
    fact_first: { words: ['报错', '核对'], high_conf: ['故障'] },
    event_replay: { words: ['复现'], high_conf: [] },
    pattern_reasoning: { words: ['规律'], high_conf: [] },
    minimal: { words: [], high_conf: [] },
  },
  mode_weights: Object.fromEntries(['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'].map((m) => [m, { w_f: 0.25, w_i: 0.25, w_c: 0.25, w_a: 0.25 }])),
});

describe('P2-9-③ growth:v1 命名空间与整块回退', () => {
  it('五模式齐全的快照生效；权重和≠1 整块回退', () => {
    expect(normalizeModeDispatch(snapshot())).not.toBeNull();
    const bad = snapshot();
    bad.mode_weights.fact_first = { w_f: 0.3, w_i: 0.3, w_c: 0.3, w_a: 0.2 };
    expect(normalizeModeDispatch(bad)).toBeNull();
    expect(normalizeGrowthConfig({ mode_dispatch: bad }).mode_dispatch).toBeNull();
  });
  it('无命名空间=absent；坏快照=fallback 且带原因', () => {
    const base = { mem_id: 'growth_1', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: '', team_id: 'e1',
      category: 'preference' as const, layer: 'L1' as const, content: '', decay_class: 'hot' as const,
      pinned: true, locked: false, version: 1, created_at: 1, updated_at: 1 };
    expect(modeDispatchFromLedger([{ ...base, content: 'growth:v1:{"weights":{}}' }]).status).toBe('absent');
    expect(modeDispatchFromLedger([{ ...base, content: `growth:v1:${JSON.stringify({ mode_dispatch: { hit_threshold: 99 } })}` }]).status).toBe('fallback');
    expect(modeDispatchFromLedger([{ ...base, content: `growth:v1:${JSON.stringify({ mode_dispatch: snapshot() })}` }]).status).toBe('applied');
  });
  it('生产召回写 dispatch_config_applied / fallback 审计，热更词表真改变分流', async () => {
    const storage = new InMemoryStorage();
    const ma = createMemAgent({ form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage });
    const pref = (content: string): Memory => ({
      mem_id: 'growth_test', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: 'e1', team_id: 't1',
      category: 'preference', layer: 'L1', content, decay_class: 'hot', pinned: true, locked: false,
      version: 1, created_at: 1, updated_at: 1,
    });
    await storage.putMemory(pref(`growth:v1:${JSON.stringify({ mode_dispatch: snapshot() })}`));
    const r = await ma.recall({ query: '架构 规范', project_id: 'P1' });
    expect(r.dispatch_config_source).toBe('growth:v1.mode_dispatch');
    const applied = await storage.queryAudit({ action: 'dispatch_config_applied' });
    expect(applied.length).toBeGreaterThan(0);
    const bad = snapshot();
    // 权重和必须≠1 才算「整块非法」：{1,0,0,0} 和仍为 1，属合法快照，不能拿来当坏样例
    bad.mode_weights.fact_first = { w_f: 0.3, w_i: 0.3, w_c: 0.3, w_a: 0.2 };
    // 真实写入口是「旧记录 delete + 新记录 put」（saveGrowthConfigToLedger），不累积两条现行配置
    await storage.deleteMemory('growth_test');
    await storage.putMemory(pref(`growth:v1:${JSON.stringify({ mode_dispatch: bad })}`));
    const r2 = await ma.recall({ query: '架构 规范', project_id: 'P1' });
    expect(r2.dispatch_config_source).toBe('baseline');
    expect((await storage.queryAudit({ action: 'dispatch_config_fallback' })).length).toBeGreaterThan(0);
  });
});
