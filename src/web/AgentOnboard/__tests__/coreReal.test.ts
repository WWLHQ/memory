// 效果证据四卡真实聚合 + 接入后端审计统计（真实化单元测试）
import { describe, expect, test } from 'vitest';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import type { AuditRecord, Memory } from '../../../core/memagent/types.ts';
import { emptyOnboardGains, getOnboardGains } from '../coreOnboard.ts';
import { computeAgentStats, normalizeAgentKey, statsForAgent } from '../useBackendMirror.ts';

function mem(p: Partial<Memory> & Pick<Memory, 'mem_id' | 'project_id'>): Memory {
  return {
    enterprise_id: 'e_demo', team_id: 't_demo', layer: 'L2', content: `mem-${p.mem_id}`,
    category: 'fact', decay_class: 'active', pinned: false, locked: false,
    version: 1, created_at: Date.now(), ...p,
  } as Memory;
}

function audit(action: AuditRecord['action'], detail: Record<string, unknown>, ts = Date.now()): AuditRecord {
  return { request_id: `req_${Math.random().toString(36).slice(2, 8)}`, action, ts, detail };
}

describe('getOnboardGains（效果证据四卡真实聚合）', () => {
  test('空账本 → 全部「—」+ 诚实说明，绝不示例数字', async () => {
    const g = await getOnboardGains(new InMemoryStorage());
    expect(g).toHaveLength(4);
    for (const card of g) {
      expect(card.big).toBe('—');
      expect(card.desc).toContain('暂无');
    }
  });

  test('emptyOnboardGains 占位与空账本口径一致', () => {
    const g = emptyOnboardGains();
    expect(g).toHaveLength(4);
    expect(g.every((x) => x.big === '—')).toBe(true);
  });

  test('Token 节省：recall payload_tokens vs 1500 预算 → 真实百分比', async () => {
    const s = new InMemoryStorage();
    await s.appendAudit(audit('recall', { query: 'q1', hits: 3, payload_tokens: 750, mems: ['m1', 'm2', 'm3'] }));
    await s.appendAudit(audit('recall', { query: 'q2', hits: 1, payload_tokens: 750, mems: ['m1'] }));
    const g = await getOnboardGains(s);
    // avg payload = 750 / 1500 → -50%
    expect(g[0].big).toBe('-50%');
    expect(g[0].desc).toContain('2 次召回');
    expect(g[0].desc).toContain('750/1500');
  });

  test('效率提升：跨会话召回次数与累计命中', async () => {
    const s = new InMemoryStorage();
    await s.appendAudit(audit('recall', { query: 'q1', hits: 3, payload_tokens: 100, mems: ['m1', 'm2', 'm3'] }));
    await s.appendAudit(audit('recall', { query: 'q2', hits: 1, payload_tokens: 100, mems: ['m4'] }));
    const g = await getOnboardGains(s);
    expect(g[1].big).toBe('4 次命中');
    expect(g[1].desc).toContain('2 次');
  });

  test('跨 Agent 复用：记忆条数 + 共享 project_id 域数', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(mem({ mem_id: 'm1', project_id: 'p1' }));
    await s.putMemory(mem({ mem_id: 'm2', project_id: 'p1' }));
    await s.putMemory(mem({ mem_id: 'm3', project_id: 'p2' }));
    const g = await getOnboardGains(s);
    expect(g[2].big).toBe('3 条 · 2 域');
  });

  test('模型成本：llm_proxy 审计次数与实际花费', async () => {
    const s = new InMemoryStorage();
    await s.appendAudit(audit('llm_proxy', { llm_proxy_source: 'agent:claude-free', cost: 0, mode: 'auto' }));
    await s.appendAudit(audit('llm_proxy', { llm_proxy_source: 'agent:gpt4o-mini', cost: 0.02, mode: 'auto' }));
    const g = await getOnboardGains(s);
    expect(g[3].big).toBe('2 次 · ¥0.02');
  });
});

describe('computeAgentStats（接入后端审计 → 每家真实统计）', () => {
  test('test 通过率 + 最近 rotate', () => {
    const now = Date.now();
    const stats = computeAgentStats([
      { ts: now - 3000, action: 'test', agent: 'A', status: 'CONNECTED' },
      { ts: now - 2000, action: 'test', agent: 'A', status: 'DEGRADED' },
      { ts: now - 1000, action: 'rotate', agent: 'A' },
      { ts: now - 500, action: 'configure', agent: 'B' },
      { ts: now - 100, action: 'test', agent: '' }, // 无 agent → 忽略
    ]);
    expect(stats['A']).toEqual({ tests: 2, passed: 1, lastTestAt: now - 2000, lastRotateAt: now - 1000 });
    expect(stats['B']).toEqual({ tests: 0, passed: 0 });
    expect(stats['']).toBeUndefined();
  });

  test('空审计 → 空对象（UI 显「—」）', () => {
    expect(computeAgentStats([])).toEqual({});
  });

  test('auto_bind（登录自动接入）计入连通成功率；durationMs 聚合平均/最近延时', () => {
    const now = Date.now();
    const stats = computeAgentStats([
      { ts: now - 3000, action: 'auto_bind', agent: 'A', status: 'CONNECTED', result: 'pass', durationMs: 100 },
      { ts: now - 2000, action: 'auto_bind', agent: 'B', status: 'DEGRADED', result: 'fail', durationMs: 300 },
      { ts: now - 1000, action: 'test', agent: 'A', status: 'CONNECTED', result: 'pass', durationMs: 300 },
    ]);
    expect(stats['A']).toEqual({ tests: 2, passed: 2, lastTestAt: now - 1000, avgRtt: 200, lastRtt: 300 });
    expect(stats['B']).toEqual({ tests: 1, passed: 0, lastTestAt: now - 2000, avgRtt: 300, lastRtt: 300 });
  });

  test('旧审计无 durationMs → 成功率照常，延时保持「—」（不伪造耗时）', () => {
    const now = Date.now();
    const stats = computeAgentStats([
      { ts: now - 1000, action: 'test', agent: 'A', status: 'CONNECTED', result: 'pass' },
    ]);
    expect(stats['A']).toEqual({ tests: 1, passed: 1, lastTestAt: now - 1000 });
    expect(stats['A'].avgRtt).toBeUndefined();
  });

  test('审计不可读时用 /agents lastTest 兜底：接入后仍有真实成功率/延时', () => {
    const now = Date.now();
    const stats = computeAgentStats([], [
      {
        agent_name: 'Claude Code', priority: 'P1', status: 'CONNECTED', circuit: 'CLOSED',
        lastTest: { ok: true, reason: '命中安装证据（cli）', at: now - 500, durationMs: 1201 },
        keyRotatedAt: now - 9000,
      },
      // 无拨测样本：仍建条目（0 样本），UI 可解释为「暂无连通样本」而不是一直加载
      { agent_name: 'Codex', priority: 'P2', status: 'CONFIGURED', circuit: 'CLOSED' },
    ]);
    expect(stats['Claude Code']).toEqual({
      tests: 1, passed: 1, lastTestAt: now - 500, avgRtt: 1201, lastRtt: 1201, lastRotateAt: now - 9000,
    });
    expect(stats['Codex']).toEqual({ tests: 0, passed: 0 });
  });

  test('审计有记录时不重复计卡片 lastTest（审计为准）；最近时间取更晚真实拨测', () => {
    const now = Date.now();
    const stats = computeAgentStats(
      [{ ts: now - 1000, action: 'auto_bind', agent: 'A', status: 'CONNECTED', result: 'pass', durationMs: 300 }],
      [{ agent_name: 'A', priority: 'P0', status: 'CONNECTED', circuit: 'CLOSED', lastTest: { ok: true, reason: '', at: now - 200, durationMs: 400 } }],
    );
    expect(stats['A']).toMatchObject({ tests: 1, passed: 1, lastTestAt: now - 200, avgRtt: 300 });
  });

  test('旧版 auto_bind 无 status/result：不计入分母（不把历史绑定算成失败），可用 lastTest 补 1 个样本', () => {
    const now = Date.now();
    const legacyOnly = computeAgentStats([
      { ts: now - 2000, action: 'auto_bind', agent: 'deepseek harness' },
    ]);
    expect(legacyOnly['deepseek harness']).toEqual({ tests: 0, passed: 0, lastTestAt: now - 2000 });

    const topped = computeAgentStats(
      [{ ts: now - 2000, action: 'auto_bind', agent: 'deepseek harness' }],
      [{
        agent_name: 'deepseek harness', priority: 'P0', status: 'CONNECTED', circuit: 'CLOSED',
        lastTest: { ok: true, reason: '命中安装证据', at: now - 500, durationMs: 1180 },
      }],
    );
    expect(topped['deepseek harness']).toEqual({
      tests: 1, passed: 1, lastTestAt: now - 500, avgRtt: 1180, lastRtt: 1180,
    });
  });

  test('Agent 名归一化：大小写/空白不同也不丢指标，卡片展示名优先', () => {
    const now = Date.now();
    const stats = computeAgentStats(
      [
        { ts: now - 2000, action: 'test', agent: 'deepseek harness', status: 'CONNECTED', result: 'pass', durationMs: 200 },
        { ts: now - 1000, action: 'auto_bind', agent: 'DeepSeek  Harness', status: 'CONNECTED', result: 'pass', durationMs: 400 },
      ],
      [{ agent_name: 'DeepSeek Harness', priority: 'P0', status: 'CONNECTED', circuit: 'CLOSED' }],
    );
    expect(Object.keys(stats)).toEqual(['DeepSeek Harness']);
    expect(stats['DeepSeek Harness']).toEqual({
      tests: 2, passed: 2, lastTestAt: now - 1000, avgRtt: 300, lastRtt: 400,
    });
    expect(normalizeAgentKey(' DeepSeek   Harness ')).toBe('deepseek harness');
    expect(statsForAgent(stats, 'deepseek harness')).toEqual(stats['DeepSeek Harness']);
    expect(statsForAgent(stats, 'missing')).toBeUndefined();
  });

  test('审计样本都缺 durationMs：用卡片 lastTest 真实耗时补延时（不增加尝试次数）', () => {
    const now = Date.now();
    const stats = computeAgentStats(
      [{ ts: now - 1000, action: 'test', agent: 'A', status: 'CONNECTED', result: 'pass' }],
      [{ agent_name: 'A', priority: 'P0', status: 'CONNECTED', circuit: 'CLOSED', lastTest: { ok: true, reason: '', at: now - 200, durationMs: 900 } }],
    );
    expect(stats['A']).toEqual({
      tests: 1, passed: 1, lastTestAt: now - 200, avgRtt: 900, lastRtt: 900,
    });
  });
});
