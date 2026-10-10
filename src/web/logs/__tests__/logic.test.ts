import { describe, it, expect } from 'vitest';
import { ensureRequestId, classifyError, aggrErrors, filterLogs, l0Auth, canDeleteAudit, L0_PASSWORD } from '../logic.ts';
import { SEED_LOGS } from '../seed.ts';
import type { L0State, LogFilter } from '../types.ts';

const NOW = new Date('2026-10-10T12:00:00Z').getTime();
const F: LogFilter = { level: 'all', form: 'all', actions: [], window: '24h', keyword: '', onlyAbnormal: false };

describe('ensureRequestId（R-LOG2）', () => {
  it('缺失补 n/a 并计数', () => {
    const r = ensureRequestId(SEED_LOGS);
    expect(r.missing).toBe(1);
    expect(r.fixed.every((l) => l.request_id)).toBe(true);
    expect(r.fixed.find((l) => l.request_id === 'n/a')).toBeTruthy();
  });
});

describe('filterLogs（§2.1 + R-LOG1）', () => {
  it('error 恒置顶且不被时间窗过滤', () => {
    const logs = ensureRequestId(SEED_LOGS).fixed;
    const out = filterLogs(logs, { ...F, window: '5min' }, NOW);
    expect(out[0].level).toBe('error'); // 11:50 的 error 在 5min 窗外但仍置顶
  });
  it('仅异常 = 只看 error+warn', () => {
    const logs = ensureRequestId(SEED_LOGS).fixed;
    const out = filterLogs(logs, { ...F, onlyAbnormal: true }, NOW);
    expect(out.every((l) => l.level !== 'info')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });
  it('跨端对照：form=web 看同步事件', () => {
    const logs = ensureRequestId(SEED_LOGS).fixed;
    const out = filterLogs(logs, { ...F, form: 'web', actions: ['sync_down', 'sync_up', 'sync_fail'] }, NOW);
    expect(out.every((l) => l.form === 'web')).toBe(true);
    expect(out.some((l) => l.action === 'sync_down')).toBe(true);
    expect(out.some((l) => l.action === 'sync_fail')).toBe(true);
  });
  it('动作多选过滤', () => {
    const logs = ensureRequestId(SEED_LOGS).fixed;
    const out = filterLogs(logs, { ...F, actions: ['sync_down', 'sync_up'] }, NOW);
    expect(out.every((l) => l.action === 'sync_down' || l.action === 'sync_up')).toBe(true);
  });
  it('关键词搜 request_id', () => {
    const logs = ensureRequestId(SEED_LOGS).fixed;
    expect(filterLogs(logs, { ...F, keyword: 'req_l01' }, NOW).length).toBe(1);
  });
});

describe('异常聚合（§2.3）', () => {
  it('error 按类型聚合 + 处置入口', () => {
    const logs = ensureRequestId(SEED_LOGS).fixed;
    const aggr = aggrErrors(logs);
    const kinds = aggr.map((a) => a.kind);
    expect(kinds).toContain('conflict_pending');
    expect(kinds).toContain('sync_fail');
    expect(kinds).toContain('breaker_open');
    const conflict = aggr.find((a) => a.kind === 'conflict_pending')!;
    expect(conflict.target).toContain('P8');
  });
  it('classifyError 非 error 返回 null', () => {
    expect(classifyError(SEED_LOGS.find((l) => l.level === 'warn')!)).toBeNull();
  });
});

describe('l0Auth（R-LOG3）', () => {
  const base: L0State = { role: 'admin', unlocked: false, failCount: 0, lockedUntil: null };
  it('密码对 → 解锁（会话级）', () => {
    const r = l0Auth(L0_PASSWORD, base, NOW);
    expect(r.ok).toBe(true);
    expect(r.state.unlocked).toBe(true);
    expect(r.message).toContain('l0_view');
  });
  it('密码错 → 计数 + 已记审计', () => {
    expect(l0Auth('wrong', base, NOW).message).toContain('已记审计');
  });
  it('连错 5 次 → 锁 15min', () => {
    let st = base;
    for (let i = 0; i < 5; i++) st = l0Auth('wrong', st, NOW).state;
    const r = l0Auth(L0_PASSWORD, st, NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('锁定');
  });
  it('非管理员拒绝', () => {
    const r = l0Auth(L0_PASSWORD, { ...base, role: 'member' }, NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('非管理员');
  });
});

describe('canDeleteAudit（R-LOG8）', () => {
  it('普通用户无删除权限', () => {
    expect(canDeleteAudit('member', true).allowed).toBe(false);
  });
  it('Admin 未二次确认拒绝；确认后允许且写 audit_delete', () => {
    expect(canDeleteAudit('admin', false).allowed).toBe(false);
    const r = canDeleteAudit('admin', true);
    expect(r.allowed).toBe(true);
    expect(r.reason).toContain('audit_delete');
  });
});
