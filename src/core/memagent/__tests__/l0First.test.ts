// L0-first 落库口径（2026-11-17 用户拍板）回归：
//   ① 质量门放行 → 原文密文随行拆进 L0 库，blob 带归属/状态元数据（owner/accepted）
//   ② 质量门拦截 → 不建 L1 行，原文密文以 bak_* 键落主 L0 库（status=filtered + 拦截原因 + 归属）
//   ③ 未接 l0Backup 端口 → 保留旧行为（只写拦截审计，不落标记条目）
//   ④ 写密钥未解锁 → E_L0_LOCKED fail-closed（拦截条目也不落明文备份）
//   ⑤ 完整性核对：bak_* 是有意不入账本的标记条目，不算孤儿
//   ⑥ 租户隔离：管理员会话放行 + decryptWithKey 口径一（解锁后可解；锁写锁不影响查阅密钥）
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreWrite } from '../memories.ts';
import { FileStorage } from '../fileStorage.ts';
import { InMemoryStorage } from '../storage.ts';
import { InMemoryL0BlobStore } from '../l0Store.ts';
import { scanLedgerForSplit } from '../l0Split.ts';
import { JsVectorBackend } from '../vector.ts';
import { createTestVault, TEST_ADMIN_PW, TEST_ADMIN_ID } from './l0Kit.ts';
import type { Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const VEC = (): JsVectorBackend => new JsVectorBackend();

/** FileStorage + 内存 L0 库（tmpdir 落账本），与 coreWrite 走同一条生产拆行路径 */
async function makeStorage() {
  const dir = await mkdtemp(join(tmpdir(), 'l0first-'));
  const l0 = new InMemoryL0BlobStore();
  const storage = new FileStorage(join(dir, 'memories.db.json'), { l0, auditPath: join(dir, 'audit.jsonl') });
  return { dir, l0, storage };
}

describe('L0-first：质量门放行路径', () => {
  it('放行条目的 blob 带归属与 accepted 状态，行只留 has_l0', async () => {
    const { vault } = await createTestVault();
    const { dir, l0, storage } = await makeStorage();
    try {
      const r = await coreWrite(
        { content: 'PostgreSQL 16 的逻辑复制支持并行大事务apply', category: 'fact', project_id: 'P1', source_agent: 'collector:test' },
        { storage, vector: VEC(), account: ACCOUNT, request_id: 'req_ok_1', now: 1, l0: vault, l0Backup: l0 },
      );
      expect(r.mem_id).toMatch(/^mem_/);
      const row = await storage.getMemory(r.mem_id) as Memory | null;
      expect(row?.has_l0).toBe(true);
      expect(row?.content_l0_enc).toBeUndefined();
      const blob = await l0.get(r.mem_id);
      expect(blob?.envelope).toBeTruthy();
      expect(blob?.owner_user_id).toBe('u1');
      expect(blob?.project_id).toBe('P1');
      expect(blob?.status).toBe('accepted');
      expect(blob?.source_agent).toBe('collector:test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('L0-first：质量门拦截路径', () => {
  it('拦截条目以 bak_* 键落 L0 库（filtered + 原因 + 归属），不建 L1 行', async () => {
    const { vault } = await createTestVault();
    const l0 = new InMemoryL0BlobStore();
    const storage = new InMemoryStorage();
    const r = await coreWrite(
      { content: '好', category: 'fact', project_id: 'P1', source_agent: 'collector:test' },
      { storage, vector: VEC(), account: ACCOUNT, request_id: 'req_f_1', now: 2, l0: vault, l0Backup: l0 },
    );
    expect(r.mem_id).toBe('');
    expect(r.dedup.action).toBe('filtered');
    const ids = await l0.ids();
    expect(ids).toHaveLength(1);
    expect(ids[0]?.startsWith('bak_')).toBe(true);
    const blob = await l0.get(ids[0]!);
    expect(blob?.status).toBe('filtered');
    expect(blob?.owner_user_id).toBe('u1');
    expect(blob?.project_id).toBe('P1');
    expect(blob?.filter_code).toBeTruthy();
    expect(blob?.filter_reason).toBeTruthy();
    expect(blob?.source_agent).toBe('collector:test');
    // 不建 L1 行
    expect(await storage.listMemories({})).toHaveLength(0);
  });

  it('未接 l0Backup 端口 → 保留旧行为：不落标记条目', async () => {
    const { vault } = await createTestVault();
    const l0 = new InMemoryL0BlobStore();
    const r = await coreWrite(
      { content: '好', category: 'fact', project_id: 'P1' },
      { storage: new InMemoryStorage(), vector: VEC(), account: ACCOUNT, request_id: 'req_f_2', now: 3, l0: vault },
    );
    expect(r.dedup.action).toBe('filtered');
    expect(await l0.ids()).toHaveLength(0);
  });

  it('写密钥未解锁 → E_L0_LOCKED（拦截条目也不落明文备份）', async () => {
    const { vault } = await createTestVault({ setup: false });
    const l0 = new InMemoryL0BlobStore();
    await expect(coreWrite(
      { content: '好', category: 'fact', project_id: 'P1' },
      { storage: new InMemoryStorage(), vector: VEC(), account: ACCOUNT, request_id: 'req_f_3', now: 4, l0: vault, l0Backup: l0 },
    )).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(await l0.ids()).toHaveLength(0);
  });
});

describe('L0-first：完整性核对与租户隔离', () => {
  it('bak_* 标记条目不算孤儿密文', async () => {
    const { vault } = await createTestVault();
    const { dir, l0, storage } = await makeStorage();
    try {
      await coreWrite(
        { content: '好', category: 'fact', project_id: 'P1', source_agent: 'collector:test' },
        { storage: new InMemoryStorage(), vector: VEC(), account: ACCOUNT, request_id: 'req_f_4', now: 5, l0: vault, l0Backup: l0 },
      );
      const preview = await scanLedgerForSplit(storage, l0);
      expect(preview.orphan_blobs).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('decrypt 归属：管理员会话对他人条目放行；decryptWithKey 解锁后可解、锁写锁不影响查阅密钥（口径一）', async () => {
    const { vault } = await createTestVault();
    const envelope = await vault.seal('别人的原文');
    // 管理员会话（scope ['*']）→ 归属不符也放行
    const admin = await vault.unlock({ password: TEST_ADMIN_PW, user_id: TEST_ADMIN_ID });
    await expect(vault.decrypt({
      l0_session_id: admin.l0_session_id, project_id: 'P1', mem_id: 'm_x', envelope, owner_user_id: 'someone-else',
    })).resolves.toBe('别人的原文');
    // 口径一：decryptWithKey 用内存写密钥直接解（免 grant / 免查阅会话）
    await expect(vault.decryptWithKey(envelope)).resolves.toBe('别人的原文');
    // 锁定写锁后：查阅密钥仍在内存（两把锁互不替代 §4.4.4）→ decryptWithKey 走查阅密钥兜底仍可解；
    // 两把密钥都不在内存 → E_L0_LOCKED 已由「写密钥未解锁」用例（setup:false）覆盖。
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await expect(vault.decryptWithKey(envelope)).resolves.toBe('别人的原文');
  });

  it('归属 fail-closed：无 grant 的受限会话解他人条目 → E_L0_NO_GRANT + 审计 not_owner', async () => {
    const { vault, audits } = await createTestVault();
    const envelope = await vault.seal('归属人的原文');
    // 直接注入「受限会话」（scope 不含 *、无 grant_id）：真实 unlock 只产出管理员(['*'])
    // 或带 grant_id 的授权会话，这类会话来自未来 member 会话来源，归属分支是其 fail-closed 闸门。
    const clockNow = 1_800_000_000_000;
    const inner = vault as unknown as {
      sessions: Map<string, { l0_session_id: string; grant_id?: string; user_id: string; scope_project_ids: string[]; expires_at: number; created_at: number; last_activity_at: number }>;
    };
    inner.sessions.set('l0s_test_bob', {
      l0_session_id: 'l0s_test_bob', user_id: 'bob', scope_project_ids: ['P2'],
      expires_at: clockNow + 300_000, created_at: clockNow, last_activity_at: clockNow,
    });
    await expect(vault.decrypt({
      l0_session_id: 'l0s_test_bob', project_id: 'P1', mem_id: 'm_owner', envelope, owner_user_id: 'u1',
    })).rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });
    expect(audits.some((a) => a.action === 'l0_auth_fail' && a.detail.reason === 'not_owner')).toBe(true);
  });

  it('归属放行：本人会话解自己的条目（非管理员 scope 也能解出明文）', async () => {
    const { vault } = await createTestVault();
    const envelope = await vault.seal('我的原文');
    // 管理员查阅解锁一次：viewDek 进内存（会话本身不用，只为让 decrypt 走到解密步）
    await vault.unlock({ password: TEST_ADMIN_PW, user_id: TEST_ADMIN_ID });
    // 注入「本人受限会话」：user_id 即 owner、无 grant_id、scope 仅 P1 → 归属与 scope 均放行
    const clockNow = 1_800_000_000_000;
    const inner = vault as unknown as {
      sessions: Map<string, { l0_session_id: string; grant_id?: string; user_id: string; scope_project_ids: string[]; expires_at: number; created_at: number; last_activity_at: number }>;
    };
    inner.sessions.set('l0s_test_u1', {
      l0_session_id: 'l0s_test_u1', user_id: 'u1', scope_project_ids: ['P1'],
      expires_at: clockNow + 300_000, created_at: clockNow, last_activity_at: clockNow,
    });
    await expect(vault.decrypt({
      l0_session_id: 'l0s_test_u1', project_id: 'P1', mem_id: 'm_self', envelope, owner_user_id: 'u1',
    })).resolves.toBe('我的原文');
  });
});
