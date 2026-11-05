// D6-2 三池模型与作用域门禁（单元契约）：classifyProject / projectInScope 三池语义 /
// runListProjectsTool 注册表+隐式合并与可见性 / ensureSharedProject 启动自动建。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyProject, projectInScope, DEFAULT_MCP_ACCOUNT, type ScopeAccount,
} from '../mcpAuth.ts';
import { runListProjectsTool, ensureSharedProject } from '../mcpRecall.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory, ProjectRecord } from '../types.ts';

// is_admin 在 D6-3 才正式进 McpAccount，此处按推断类型构造（结构与 McpAccount 兼容、is_admin 预留）
const ADMIN = { ...DEFAULT_MCP_ACCOUNT, is_admin: true };
const BOB = { ...DEFAULT_MCP_ACCOUNT, user_id: 'bob' }; // 普通用户，scope ['*']
const SCOPED = { ...DEFAULT_MCP_ACCOUNT, scope_project_ids: ['P1'] }; // scope 仅 P1

function mem(pid: string, id: string, ts: number): Memory {
  return {
    mem_id: id, project_id: pid, user_id: 'u1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content: 'x', content_l1: 'x1',
    content_l0_enc: 'L0', content_orig: 'ORIG', decay_class: 'hot', pinned: false,
    locked: false, version: 1, created_at: ts, updated_at: ts,
  };
}

describe('D6-2 classifyProject（三池命名约定）', () => {
  it('P-shared / P-archive / P-<user> / general 分类正确', () => {
    expect(classifyProject('P-shared')).toBe('shared');
    expect(classifyProject('P-archive')).toBe('archive');
    expect(classifyProject('P-alice')).toBe('user');
    expect(classifyProject('P1')).toBe('general');
    expect(classifyProject('my-project')).toBe('general');
    expect(classifyProject('P-')).toBe('general'); // 裸 P- 不视为用户池
  });
});

describe('D6-2 projectInScope 三池可见性', () => {
  const cases: Array<[string, ScopeAccount, boolean]> = [
    // shared 恒可见
    ['P-shared', BOB, true],
    ['P-shared', SCOPED, true],
    // user 池：owner 可见
    ['P-alice', { ...BOB, user_id: 'alice' }, true],
    // user 池：admin 可见
    ['P-alice', ADMIN, true],
    // user 池：其它普通用户拒绝
    ['P-alice', BOB, false],
    // archive 池：仅 admin
    ['P-archive', ADMIN, true],
    ['P-archive', BOB, false],
    // general：scope '*' 全放行
    ['P1', BOB, true],
    // general：scope 命中
    ['P1', SCOPED, true],
    // general：scope 未命中拒绝
    ['P2', SCOPED, false],
  ];
  for (const [pid, acc, want] of cases) {
    it(`${pid} 对 ${JSON.stringify(acc.user_id)}/${acc.is_admin ? 'admin' : 'non-admin'}/scope=${JSON.stringify(acc.scope_project_ids)} → ${want}`, () => {
      expect(projectInScope(acc, pid)).toBe(want);
    });
  }
});

describe('D6-2 runListProjectsTool 合并注册表+隐式并应用可见性', () => {
  let storage: InMemoryStorage;
  beforeEach(() => { storage = new InMemoryStorage(); });

  it('空账本 → 0（诚实空态，不造数据）', async () => {
    const r = await runListProjectsTool(storage, DEFAULT_MCP_ACCOUNT);
    expect(r.total).toBe(0);
  });

  it('合并注册表（create_project）与隐式（记忆反推）；记忆数累加、last_activity 取 Max', async () => {
    // 注意：项目名不用 'P-' 前缀——按 D6-2 命名约定 'P-<x>' 属 user 池，会按 owner 门禁隐藏
    const rec = await storage.createProject({ project_id: 'REG', kind: 'general', created_by: 'u1' });
    await storage.putMemory(mem('REG', 'm1', 1000));
    await storage.putMemory(mem('REG', 'm2', 2000));
    const r = await runListProjectsTool(storage, DEFAULT_MCP_ACCOUNT);
    expect(r.total).toBe(1);
    expect(r.projects[0].project_id).toBe('REG');
    expect(r.projects[0].memories).toBe(2);
    // 合并口径：注册表 created_at 与记忆最近活动取 Max（注册表真实时钟晚于测试记忆）
    expect(r.projects[0].last_activity).toBe(Math.max(rec.created_at, 2000));
  });

  it('隐式项目（有记忆但无注册表项）按 general 兜底出现', async () => {
    await storage.putMemory(mem('IMPLICIT', 'm1', 1000));
    const r = await runListProjectsTool(storage, DEFAULT_MCP_ACCOUNT);
    expect(r.projects.map((p) => p.project_id)).toContain('IMPLICIT');
  });

  it('archive 项目对非 admin 隐藏、对 admin 可见', async () => {
    await storage.createProject({ project_id: 'P-archive', kind: 'archive', created_by: 'u1' });
    await storage.putMemory(mem('P-archive', 'am1', 1000));
    const nonAdmin = await runListProjectsTool(storage, BOB);
    expect(nonAdmin.projects.find((p) => p.project_id === 'P-archive')).toBeUndefined();
    const admin = await runListProjectsTool(storage, ADMIN);
    expect(admin.projects.find((p) => p.project_id === 'P-archive')).toBeDefined();
  });

  it('scoped 用户（scope [P1]）能看到 P-shared（恒可见）+ P1（scope），看不到 P2（general 不在 scope）', async () => {
    await storage.createProject({ project_id: 'P-shared', kind: 'shared', created_by: 'bootstrap' });
    await storage.putMemory(mem('P1', 'm1', 1000));
    await storage.putMemory(mem('P2', 'm2', 1000));
    const r = await runListProjectsTool(storage, SCOPED);
    const ids = r.projects.map((p) => p.project_id);
    expect(ids).toContain('P-shared');
    expect(ids).toContain('P1');
    expect(ids).not.toContain('P2');
  });
});

describe('D6-2 ensureSharedProject（启动自动建）', () => {
  it('注册表无 P-shared → 自动建；已有 → 幂等不报错', async () => {
    const storage = new InMemoryStorage();
    await ensureSharedProject(storage);
    const created = await storage.getProject('P-shared');
    expect(created).not.toBeNull();
    expect((created as ProjectRecord).kind).toBe('shared');
    await ensureSharedProject(storage); // 幂等
    const again = await storage.getProject('P-shared');
    expect((again as ProjectRecord).project_id).toBe('P-shared');
  });
});
