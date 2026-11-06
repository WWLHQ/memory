// T4 验收（提前规划的测试）：首页 Dashboard 数据聚合（§0.2）
// 对应 specs/tasks/HOME-LOGIN.md T4 「验收（提前规划的测试）」
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../dashboard.ts';
import type { TenantContext } from '../../types/home.ts';
import type { Gain } from '../../types/agentOnboard.ts';

const ctx: TenantContext = {
  enterprise_id: 'ent_001',
  team_id: 'team_001',
  user_id: 'user_001',
  perspective: 'team',
  session_id: 'sess_abc',
};

const gain: Gain = { icon: '🪙', title: 'Token 节省', big: '-58%', desc: 'payload 780/1500', src: 'mech' };

const raw = {
  gains: [gain, gain, gain, gain],
  anomalies: [
    { title: '同步慢', detail: 'mirror 延迟', level: 'warn' as const, jump: 'P15' },
    { title: 'Codex 熔断 OPEN', detail: 'desktop/Codex 连续失败≥5', level: 'error' as const, request_id: 'req_x1', jump: 'P10' },
    { title: '反代理临上限', detail: 'proxy 95%', level: 'error' as const, request_id: 'req_x2', jump: 'P13' },
  ],
  activeMemories: [
    { title: '为什么上次重构失败', hits: 3, decayClass: 'hot' as const, request_id: 'req_001' },
    { title: '周报模板', hits: 1, decayClass: 'cold' as const, request_id: 'req_002' },
  ],
  todos: [
    { label: '⚖️ 待裁决 3 条', detail: '9.7 冲突队列', request_id: 'req_003', kind: 'dispute' as const },
    { label: '🛡️ 反代理额度', detail: '本月剩余 12%', request_id: 'req_004', kind: 'proxy_budget' as const },
  ],
};

describe('T4 首页 Dashboard 数据聚合', () => {
  it('ctx=null → 返回 null（UI 灰置）', () => {
    expect(buildDashboard(null, raw)).toBeNull();
  });

  it('ctx 有效 + raw → 四区块齐全', () => {
    const d = buildDashboard(ctx, raw);
    expect(d).not.toBeNull();
    if (d) {
      expect(d.gains).toHaveLength(4);
      expect(d.anomalies).toHaveLength(3);
      expect(d.activeMemories).toHaveLength(2);
      expect(d.todos).toHaveLength(2);
    }
  });

  it('异常列表按 error 置顶（熔断/同步失败在最前）', () => {
    const d = buildDashboard(ctx, raw);
    expect(d).not.toBeNull();
    if (d) {
      expect(d.anomalies[0].level).toBe('error');
      expect(d.anomalies[1].level).toBe('error');
      expect(d.anomalies[2].level).toBe('warn');
      // error 内部保持原序（熔断 OPEN 在反代理前）
      expect(d.anomalies[0].request_id).toBe('req_x1');
    }
  });

  it('账本能给的 request_id 原样透传，缺失的留空串（可溯源但不编造）', () => {
    const d = buildDashboard(ctx, raw);
    expect(d).not.toBeNull();
    if (d) {
      expect(d.anomalies.find((a) => a.title === 'Codex 熔断 OPEN')?.request_id).toBe('req_x1');
      expect(d.activeMemories.every((m) => m.request_id.startsWith('req_'))).toBe(true);
      expect(d.todos.every((t) => t.request_id.startsWith('req_'))).toBe(true);
      // 原始数据里没有 request_id 的异常保持空串（不合成 anom_N）
      expect(d.anomalies.find((a) => a.title === '同步慢')?.request_id).toBe('');
    }
  });

  it('活跃记忆带 decay_class（hot/warm/cold）', () => {
    const d = buildDashboard(ctx, raw);
    expect(d).not.toBeNull();
    if (d) {
      expect(d.activeMemories[0].decayClass).toBe('hot');
      expect(d.activeMemories[1].decayClass).toBe('cold');
    }
  });

  it('待办含 9.7 待裁决数（dispute）+ 反代理额度（proxy_budget）', () => {
    const d = buildDashboard(ctx, raw);
    expect(d).not.toBeNull();
    if (d) {
      const kinds = d.todos.map((t) => t.kind);
      expect(kinds).toContain('dispute');
      expect(kinds).toContain('proxy_budget');
    }
  });

  it('缺失 request_id 的原始项保持空串：不合成假溯源 id（账本没给链路就如实留空）', () => {
    const d = buildDashboard(ctx, {
      anomalies: [{ title: '无溯源', detail: 'x', level: 'warn' }],
      activeMemories: [{ title: 'm', hits: 1, decayClass: 'warm' }],
      todos: [{ label: 't', detail: 'd' }],
    });
    expect(d).not.toBeNull();
    if (d) {
      expect(d.anomalies[0].request_id).toBe('');
      expect(d.activeMemories[0].request_id).toBe('');
      expect(d.todos[0].request_id).toBe('');
    }
  });

  it('空白 request_id（只含空格）同样不冒充链路', () => {
    const d = buildDashboard(ctx, { anomalies: [{ title: '空白', detail: 'y', level: 'warn', request_id: '   ' }] });
    expect(d?.anomalies[0].request_id).toBe('');
  });
});
