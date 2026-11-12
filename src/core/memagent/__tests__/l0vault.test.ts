// L0Vault 安全路径矩阵（§4.4）：管理密码/授权/一次性消费/5min 空闲/5 次锁定/重启锁屏/
// 写密钥分离/scope/全有或全无/旧数据迁移/审计零秘密。全部用真 L0Vault + 可注入时钟。
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptL0, parseL0EnvelopeV2 } from '../crypto.ts';
import { FileStorage } from '../fileStorage.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';
import {
  createTestVault, TEST_ADMIN_ID, TEST_ADMIN_PW, TEST_GRANT_PW, type TestVault,
} from './l0Kit.ts';

const MIN = 60_000;
const GRANTEE = 'u1';

async function grant(
  t: TestVault,
  over: { user?: string; scope?: string[]; password?: string; request_id?: string } = {},
) {
  return t.vault.grantAccess({
    grantee_user_id: over.user ?? GRANTEE,
    scope_project_ids: over.scope ?? ['P1'],
    password: over.password ?? TEST_GRANT_PW,
    request_id: over.request_id,
    admin_user_id: TEST_ADMIN_ID,
  });
}

function mem(mem_id: string, patch: Partial<Memory> = {}): Memory {
  return {
    mem_id, project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content: 'l1 内容', decay_class: 'hot',
    pinned: false, locked: false, version: 1, created_at: 1,
    ...patch,
  };
}

describe('管理密码（§4.4.1）', () => {
  it('密码 <8 位 / 重复设置 → E_AUTH_L0；设置成功即持写密钥并落审计（不含密码）', async () => {
    const { vault, keyring, audits } = await createTestVault({ setup: false });
    await expect(vault.setupAdminPassword('short', TEST_ADMIN_ID)).rejects.toMatchObject({ code: 'E_AUTH_L0' });
    await vault.setupAdminPassword(TEST_ADMIN_PW, TEST_ADMIN_ID);
    expect(await vault.status()).toMatchObject({ has_admin_wrap: true, write_unlocked: true });
    expect(keyring.value?.admin_wrap?.ct).toBeTruthy();
    expect(JSON.stringify(keyring.value)).not.toContain(TEST_ADMIN_PW);
    const a = audits.find((x) => x.detail.op === 'l0_admin_setup');
    expect(a?.action).toBe('security_change');
    await expect(vault.setupAdminPassword('another-pass', TEST_ADMIN_ID)).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('轮换：旧密码失效、新密码可解、DEK 不变（旧密文仍可解）', async () => {
    const { vault } = await createTestVault();
    const env = await vault.seal('轮换前的 L0 原文');
    await expect(vault.changeAdminPassword('wrong-old-pass', 'new-pass-1', TEST_ADMIN_ID))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    await vault.changeAdminPassword(TEST_ADMIN_PW, 'new-pass-1', TEST_ADMIN_ID);
    await expect(vault.unlock({ password: TEST_ADMIN_PW, user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    const u = await vault.unlock({ password: 'new-pass-1', user_id: TEST_ADMIN_ID });
    const plain = await vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: env,
    });
    expect(plain).toBe('轮换前的 L0 原文');
  });
});

describe('授权申请与发放（§4.4.2）', () => {
  it('申请：无项目 → 拒绝；成功 → pending + 审计；发放后请求标记 granted', async () => {
    const t = await createTestVault();
    await expect(t.vault.requestAccess({ project_ids: [], user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    const req = await t.vault.requestAccess({ project_ids: ['P1', 'P1', ' P2 '], reason: '复盘', user_id: GRANTEE });
    expect(req.status).toBe('pending');
    const [pending] = await t.vault.listRequests();
    expect(pending.project_ids).toEqual(['P1', 'P2']);
    expect(t.audits.some((a) => a.action === 'l0_auth_request' && a.detail.request_id === req.request_id)).toBe(true);

    const g = await grant(t, { request_id: req.request_id });
    expect(g.scope_project_ids).toEqual(['P1']);
    const [granted] = await t.vault.listRequests();
    expect(granted).toMatchObject({ status: 'granted', decided_by: TEST_ADMIN_ID, grant_id: g.grant_id });
    expect(t.audits.some((a) => a.action === 'l0_auth_grant' && a.detail.grant_id === g.grant_id)).toBe(true);
    // 同一申请不能二次发放
    await expect(grant(t, { request_id: req.request_id })).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('系统随机一次性密码：仅发放结果返回一次，keyring 不落密码', async () => {
    const t = await createTestVault();
    const g = await t.vault.grantAccess({
      grantee_user_id: GRANTEE, scope_project_ids: ['P1'], admin_user_id: TEST_ADMIN_ID,
    });
    expect(g.password).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(t.keyring.value)).not.toContain(g.password!);
    const u = await t.vault.unlock({ grant_id: g.grant_id, password: g.password!, user_id: GRANTEE });
    expect(u.grant_id).toBe(g.grant_id);
  });

  it('授权密码 <8 位 / 空 scope / 空 grantee → 拒绝', async () => {
    const t = await createTestVault();
    await expect(grant(t, { password: '1234567' })).rejects.toMatchObject({ code: 'E_AUTH_L0' });
    await expect(grant(t, { scope: [] })).rejects.toMatchObject({ code: 'E_AUTH_L0' });
    await expect(grant(t, { user: '' })).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('拒绝与撤销：状态与 wrapped DEK 一并处理，撤销后解锁 E_L0_EXPIRED', async () => {
    const t = await createTestVault();
    const r1 = await t.vault.requestAccess({ project_ids: ['P1'], user_id: GRANTEE });
    await t.vault.denyRequest({ request_id: r1.request_id, admin_user_id: TEST_ADMIN_ID, reason: '不必要' });
    expect((await t.vault.listRequests())[0].status).toBe('denied');
    expect(t.audits.some((a) => a.action === 'l0_auth_deny' && a.detail.reason === '不必要')).toBe(true);

    const g = await grant(t);
    // 发放结果（视图）永不返回 wrapped DEK
    expect(t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!.wrap).toBeTruthy();
    await t.vault.revokeGrant({ grant_id: g.grant_id, admin_user_id: TEST_ADMIN_ID, reason: '离岗' });
    const record = t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!;
    expect(record.status).toBe('revoked');
    expect(record.wrap).toBeUndefined();
    await expect(t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
    expect(t.audits.some((a) => a.action === 'l0_auth_revoke' && a.detail.grant_id === g.grant_id)).toBe(true);
    // 重复撤销幂等
    await t.vault.revokeGrant({ grant_id: g.grant_id, admin_user_id: TEST_ADMIN_ID });
    await expect(t.vault.revokeGrant({ grant_id: 'grant_missing', admin_user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });
});

describe('解锁与连续会话（§4.4.3）', () => {
  it('管理员错密码 → E_AUTH_L0 + bad_password 审计；对密码 → scope=* 会话', async () => {
    const t = await createTestVault();
    await expect(t.vault.unlock({ password: 'wrong-pass', user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    const fail = t.audits.find((a) => a.action === 'l0_auth_fail' && a.detail.reason === 'bad_password');
    expect(fail?.detail).toMatchObject({ user_id: TEST_ADMIN_ID, fails: 1 });
    expect(JSON.stringify(t.audits)).not.toContain('wrong-pass');

    const u = await t.vault.unlock({ password: TEST_ADMIN_PW, user_id: TEST_ADMIN_ID });
    expect(u.idle_timeout_ms).toBe(5 * MIN);
    expect(u.expires_at).toBe(t.clock.t + 5 * MIN);
    expect(await t.vault.sessionInfo(u.l0_session_id)).toMatchObject({
      user_id: TEST_ADMIN_ID, scope_project_ids: ['*'],
    });
    expect((await t.vault.status()).active_sessions).toBe(1);
  });

  it('未设置管理密码直接解锁 → E_L0_NO_GRANT + no_grant 审计', async () => {
    const t = await createTestVault({ setup: false });
    await expect(t.vault.unlock({ password: 'whatever-1', user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });
    expect(t.audits.some((a) => a.action === 'l0_auth_fail' && a.detail.reason === 'no_grant')).toBe(true);
    await expect(t.vault.unlock({ password: '', user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('授权解锁：仅限指定账号；一次性消费后 wrapped DEK 删除、再次解锁须重新申请', async () => {
    const t = await createTestVault();
    const g = await grant(t);
    await expect(t.vault.unlock({ grant_id: 'grant_missing', password: TEST_GRANT_PW, user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });
    await expect(t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: 'u2' }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    expect(t.audits.some((a) => a.action === 'l0_auth_fail' && a.detail.reason === 'wrong_user')).toBe(true);

    const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE });
    expect(u).toMatchObject({ grant_id: g.grant_id, idle_timeout_ms: 5 * MIN });
    const rec = t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!;
    expect(rec.status).toBe('consumed');
    expect(rec.wrap).toBeUndefined();
    expect(rec.last_view_at).toBe(t.clock.t);

    await expect(t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
    expect(t.audits.some((a) => a.action === 'l0_auth_fail' && a.detail.reason === 'expired')).toBe(true);
  });

  it('5 次密码错误 → 锁定 15 分钟 + 授权作废（wrapped DEK 删除）；到期后可再试但授权须重发', async () => {
    const t = await createTestVault();
    const g = await grant(t);
    for (let i = 0; i < 5; i++) {
      await expect(t.vault.unlock({ grant_id: g.grant_id, password: 'bad-pass-1', user_id: GRANTEE }))
        .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    }
    const rec = t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!;
    expect(rec.status).toBe('revoked');
    expect(rec.wrap).toBeUndefined();
    expect(t.locks.map.get(`l0:${GRANTEE}`)).toMatchObject({ fails: 5, locked_until: t.clock.t + 15 * MIN });
    expect(t.audits.some((a) => a.action === 'l0_auth_revoke' && a.detail.reason === 'bad_password_5')).toBe(true);

    // 锁定期间即使密码正确也拒绝
    await expect(t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    expect(t.audits.some((a) => a.action === 'l0_auth_fail' && a.detail.reason === 'locked')).toBe(true);

    // 15 分钟后解锁不再锁定，但授权已被第 5 次错误作废
    t.clock.t += 15 * MIN + 1;
    await expect(t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
    expect(t.locks.map.get(`l0:${GRANTEE}`)).toBeUndefined();
  });

  it('5 分钟空闲 → 会话与 wrapped DEK 一起作废、grant 记 expired；心跳可续期', async () => {
    const t = await createTestVault();
    const g = await grant(t);
    const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE });
    const env = await t.vault.seal('空闲锁定的原文');

    // 4 分钟时心跳 → 续期到心跳后 5 分钟
    t.clock.t += 4 * MIN;
    const hb = await t.vault.heartbeat(u.l0_session_id);
    expect(hb.expires_at).toBe(t.clock.t + 5 * MIN);
    t.clock.t += 4 * MIN;
    expect(await t.vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: env,
    })).toBe('空闲锁定的原文');

    // 再过 5 分钟无操作 → 会话过期，grant 转 expired
    t.clock.t += 5 * MIN;
    await expect(t.vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: env,
    })).rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
    const rec = t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!;
    expect(rec.status).toBe('expired');
    expect(rec.wrap).toBeUndefined();
    expect(t.audits.some((a) => a.action === 'l0_auth_expire' && a.detail.reason === 'idle_5min')).toBe(true);
    expect((await t.vault.status()).active_sessions).toBe(0);
  });

  it('主动结束查阅 lock() → 会话失效且 grant 记 expired（user_closed）', async () => {
    const t = await createTestVault();
    const g = await grant(t);
    const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE });
    await t.vault.lock(u.l0_session_id);
    await expect(t.vault.sessionInfo(u.l0_session_id)).rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
    expect(t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!.status).toBe('expired');
    expect(t.audits.some((a) => a.action === 'l0_auth_expire' && a.detail.reason === 'user_closed')).toBe(true);
    // 重复 lock 幂等
    await t.vault.lock(u.l0_session_id);
  });

  it('scope 校验：授权仅含 P1 → 解密 P2 抛 E_L0_NO_GRANT；密文篡改 → E_AUTH_L0', async () => {
    const t = await createTestVault();
    const g = await grant(t, { scope: ['P1'] });
    const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE });
    const env = await t.vault.seal('scope 原文');
    await expect(t.vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P2', mem_id: 'm1', envelope: env,
    })).rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });

    const tampered = JSON.parse(env) as { ct: string };
    tampered.ct = `${tampered.ct.slice(0, -4)}AAAA`;
    await expect(t.vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: JSON.stringify(tampered),
    })).rejects.toMatchObject({ code: 'E_AUTH_L0' });
    // 从未给过会话的 id → E_L0_EXPIRED
    await expect(t.vault.decrypt({
      l0_session_id: 'l0s_missing', project_id: 'P1', mem_id: 'm1', envelope: env,
    })).rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
  });
});

describe('写密钥分离（§4.4.4）', () => {
  it('锁定写密钥 → seal E_L0_LOCKED；重新解锁后恢复；审计只记动作', async () => {
    const t = await createTestVault();
    await expect(t.vault.unlockWrite({ password: 'wrong-write-pw', admin_user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    expect((await t.vault.status()).write_unlocked).toBe(false);
    await expect(t.vault.seal('x')).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    await t.vault.unlockWrite({ password: TEST_ADMIN_PW, admin_user_id: TEST_ADMIN_ID });
    expect((await t.vault.status()).write_unlocked).toBe(true);
    expect((await t.vault.seal('恢复写入')).length).toBeGreaterThan(0);
    const ops = t.audits.filter((a) => a.action === 'security_change').map((a) => a.detail.op);
    expect(ops).toContain('l0_write_lock');
    expect(ops).toContain('l0_write_unlock');
    expect(JSON.stringify(t.audits)).not.toContain('wrong-write-pw');
  });

  it('写密钥与查阅密钥互不替代：仅查阅会话不能发放授权以外的写入；无任何密钥时发放 → E_L0_LOCKED', async () => {
    const t = await createTestVault();
    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await expect(grant(t)).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    // 管理员解锁查阅后（viewDek）可发放，但不会恢复写密钥
    await t.vault.unlock({ password: TEST_ADMIN_PW, user_id: TEST_ADMIN_ID });
    const g = await grant(t);
    expect(g.grant_id).toMatch(/^grant_/);
    expect((await t.vault.status()).write_unlocked).toBe(false);
    await expect(t.vault.seal('x')).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
  });
});

describe('生命周期钩子（§4.4.3/§4.4.4）', () => {
  it('应用重启：会话/密钥清空，active 与 consumed 授权全部 expired 且删除 wrapped DEK', async () => {
    const t = await createTestVault();
    const g1 = await grant(t, { user: 'u1', scope: ['P1'] });
    const g2 = await grant(t, { user: 'u2', scope: ['P2'], password: 'grant-u2-pass' });
    const u = await t.vault.unlock({ grant_id: g1.grant_id, password: TEST_GRANT_PW, user_id: 'u1' });
    expect(t.keyring.value!.grants.find((x) => x.grant_id === g1.grant_id)!.status).toBe('consumed');

    await t.vault.onAppRestart();
    const statuses = Object.fromEntries(t.keyring.value!.grants.map((x) => [x.grant_id, x.status]));
    expect(statuses[g1.grant_id]).toBe('expired');
    expect(statuses[g2.grant_id]).toBe('expired');
    expect(t.keyring.value!.grants.every((x) => x.wrap === undefined)).toBe(true);
    await expect(t.vault.sessionInfo(u.l0_session_id)).rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
    await expect(t.vault.seal('x')).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(t.audits.filter((a) => a.action === 'l0_auth_expire' && a.detail.reason === 'app_restart').length).toBeGreaterThanOrEqual(2);
  });

  it('锁屏/休眠：会话与写密钥立即失效、授权作废并记原因', async () => {
    for (const reason of ['screen_lock', 'suspend'] as const) {
      const t = await createTestVault();
      const g = await grant(t);
      const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE });
      await t.vault.onSecurityLock(reason);
      await expect(t.vault.sessionInfo(u.l0_session_id)).rejects.toMatchObject({ code: 'E_L0_EXPIRED' });
      await expect(t.vault.seal('x')).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
      expect(t.keyring.value!.grants.find((x) => x.grant_id === g.grant_id)!.status).toBe('expired');
      expect(t.audits.some((a) => a.action === 'l0_auth_expire' && a.detail.reason === reason)).toBe(true);
      expect(t.audits.some((a) => a.action === 'security_change' && a.detail.op === reason)).toBe(true);
    }
  });

  it('退出 onExit：只清内存密钥，不重写 keyring', async () => {
    const t = await createTestVault();
    const writes = t.keyring.writes;
    await t.vault.onExit();
    expect(t.keyring.writes).toBe(writes);
    await expect(t.vault.seal('x')).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(t.audits.some((a) => a.action === 'security_change' && a.detail.op === 'l0_write_lock')).toBe(true);
  });
});

describe('旧数据迁移（§4.4.6）', () => {
  it('content_orig / v1 信封 → v2；缺旧密码保留并标记 pending；幂等可重跑', async () => {
    const t = await createTestVault();
    const storage = new InMemoryStorage();
    const v1 = await encryptL0('旧 v1 密文原文', 'old-pass-1');
    const v1Other = await encryptL0('另一旧密码的原文', 'other-pass-1');
    await storage.putMemory(mem('m_orig', { content_orig: '历史明文原文' }));
    await storage.putMemory(mem('m_v1', { content_l0_enc: v1 }));
    await storage.putMemory(mem('m_pending', { content_l0_enc: v1Other }));
    await storage.putMemory(mem('m_plain'));

    // 缺旧密码：m_v1 与 m_pending 都 pending
    const dry = await t.vault.migrateLegacy(storage, { admin_user_id: TEST_ADMIN_ID });
    expect(dry).toEqual({ scanned: 4, migrated_orig: 1, migrated_v1: 0, pending: 2, skipped: 1 });
    expect((await storage.getMemory('m_orig'))!.content_l0_enc).toBeTruthy();

    const rep = await t.vault.migrateLegacy(storage, { admin_user_id: TEST_ADMIN_ID, oldPassword: 'old-pass-1' });
    expect(rep).toEqual({ scanned: 4, migrated_orig: 0, migrated_v1: 1, pending: 1, skipped: 2 });
    const migrated = (await storage.getMemory('m_v1'))!;
    expect(migrated.content_l0_enc).not.toBe(v1);
    expect(parseL0EnvelopeV2(migrated.content_l0_enc!)).not.toBeNull();
    const pending = (await storage.getMemory('m_pending'))!;
    expect(pending.l0_migration_pending).toBe(true);
    expect(pending.content_l0_enc).toBe(v1Other);

    // 迁移后的密文可用管理会话解回原文
    const u = await t.vault.unlock({ password: TEST_ADMIN_PW, user_id: TEST_ADMIN_ID });
    const orig = (await storage.getMemory('m_orig'))!;
    expect(await t.vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: orig.mem_id, envelope: orig.content_l0_enc!,
    })).toBe('历史明文原文');
    expect(await t.vault.decrypt({
      l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm_v1', envelope: migrated.content_l0_enc!,
    })).toBe('旧 v1 密文原文');

    // 幂等重跑
    const again = await t.vault.migrateLegacy(storage, { admin_user_id: TEST_ADMIN_ID, oldPassword: 'old-pass-1' });
    expect(again).toEqual({ scanned: 4, migrated_orig: 0, migrated_v1: 0, pending: 1, skipped: 3 });
    const audit = t.audits.filter((a) => a.detail.op === 'l0_migrate');
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(t.audits)).not.toContain('old-pass-1');
    expect(JSON.stringify(t.audits)).not.toContain('历史明文原文');
  });

  it('写密钥未解锁 → E_L0_LOCKED（不迁移任何条目）', async () => {
    const t = await createTestVault();
    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    const storage = new InMemoryStorage();
    await storage.putMemory(mem('m1', { content_orig: '明文' }));
    await expect(t.vault.migrateLegacy(storage, { admin_user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect((await storage.getMemory('m1'))!.content_orig).toBe('明文');
  });

  it('L0AdminPort.migrate：无存储后端 → E_NOT_IMPLEMENTED；注入后端 → 真实报告', async () => {
    const noStorage = await createTestVault();
    await expect(noStorage.vault.migrate({ admin_user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });

    const storage = new InMemoryStorage();
    await storage.putMemory(mem('m_orig', { content_orig: '历史明文' }));
    await storage.putMemory(mem('m_plain'));
    const t = await createTestVault({ storage });
    const res = await t.vault.migrate({ admin_user_id: TEST_ADMIN_ID });
    expect(res.report).toEqual({ scanned: 2, migrated_orig: 1, migrated_v1: 0, pending: 0, skipped: 1 });
    expect(res.backup_dir).toBeUndefined();
    expect((await storage.getMemory('m_orig'))!.content_orig).toBeUndefined();
  });

  // T4 不变量守卫（文件级）：本机真数据实测（2026-11-12）memories.db.json 里 content_orig=0、
  // memories.l0.json 全 v2 密文。此例把该不变量锁在「落盘文件」层面——遗留明文 content_orig
  // 经 migrateLegacy 封存后，raw 账本文件里既无 content_orig 键、也无原文串；且幂等重跑不新增明文。
  // 防回归：阻止有人把明文原文副本重新写回行/文件（那是把 L0 加密原地废掉）。
  it('T4 不变量守卫：存量 content_orig 明文迁移后，落盘文件里再无该明文与 content_orig 键', async () => {
    const dir = await mkdtemp(join(tmpdir(), 't4-invariant-'));
    try {
      const dbPath = join(dir, 'memories.db.json');
      const storage = new FileStorage(dbPath);
      const SENTINEL = `T4-plaintext-sentinel-${Math.random().toString(36).slice(2)}`;
      // 遗留形态：行上带明文 content_orig（拆库前旧数据）——此时落盘文件确含明文
      await storage.putMemory(mem('m_legacy', { content_orig: SENTINEL, content: 'L1 摘要占位' }));
      const before = await readFile(dbPath, 'utf8');
      expect(before).toContain('"content_orig"');
      expect(before).toContain(SENTINEL);

      // 迁移（写密钥已在内存）：content_orig → v2 密文，并清空行上明文
      const t = await createTestVault();
      const rep = await t.vault.migrateLegacy(storage, { admin_user_id: TEST_ADMIN_ID });
      expect(rep.migrated_orig).toBe(1);

      // 不变量：落盘文件既无 content_orig 键、也无原文串；原文只以 v2 密文留在行上
      const after = await readFile(dbPath, 'utf8');
      expect(after).not.toContain('"content_orig"');
      expect(after).not.toContain(SENTINEL);
      const row = (await storage.getMemory('m_legacy'))!;
      expect(row.content_orig).toBeUndefined();
      expect(parseL0EnvelopeV2(row.content_l0_enc ?? '')).not.toBeNull();

      // 幂等重跑：不新增明文
      const again = await t.vault.migrateLegacy(storage, { admin_user_id: TEST_ADMIN_ID });
      expect(again.migrated_orig).toBe(0);
      expect(await readFile(dbPath, 'utf8')).not.toContain(SENTINEL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('审计零秘密（红线）', () => {
  it('全流程审计不出现密码 / DEK / wrapped DEK / 明文', async () => {
    const t = await createTestVault();
    const g = await grant(t);
    await expect(t.vault.unlock({ grant_id: g.grant_id, password: 'wrong-grant-pw', user_id: GRANTEE }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: GRANTEE });
    const env = await t.vault.seal('审计红线原文');
    await t.vault.decrypt({ l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: env });
    await t.vault.onSecurityLock('screen_lock');

    const serialized = JSON.stringify(t.audits);
    for (const secret of [TEST_ADMIN_PW, TEST_GRANT_PW, 'wrong-grant-pw', '审计红线原文']) {
      expect(serialized).not.toContain(secret);
    }
    const ct = (JSON.parse(env) as { ct: string }).ct;
    expect(serialized).not.toContain(ct);
    expect(serialized).not.toContain('wrap');
    expect(t.audits.every((a) => a.action.startsWith('l0_auth') || a.action === 'security_change')).toBe(true);
  });
});

describe('成员写解锁口令（§4.4.4-B）', () => {
  const MEMBER = 'u-member';
  const MEM_PW = 'memberpass-1';

  it('管理员发放后，成员可用自己的口令解锁写密钥（与管理密码互不替代）', async () => {
    const t = await createTestVault();
    expect((await t.vault.status()).member_write_wraps).toBe(0);

    await t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    expect((await t.vault.status()).member_write_wraps).toBe(1);
    expect(t.keyring.value?.member_wraps?.[MEMBER]?.ct).toBeTruthy();
    expect(JSON.stringify(t.keyring.value)).not.toContain(MEM_PW);

    // 写密钥锁定后，成员用自己口令（≠管理密码）仍可解锁
    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    expect((await t.vault.status()).write_unlocked).toBe(false);
    await t.vault.unlockWrite({ password: MEM_PW, admin_user_id: TEST_ADMIN_ID, member_id: MEMBER });
    expect((await t.vault.status()).write_unlocked).toBe(true);
  });

  it('未发放口令 → E_L0_NO_GRANT；口令错误 → E_AUTH_L0', async () => {
    const t = await createTestVault();
    await expect(t.vault.unlockWrite({ password: MEM_PW, admin_user_id: TEST_ADMIN_ID, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });

    await t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    await expect(t.vault.unlockWrite({ password: 'wrong-pw-1', admin_user_id: TEST_ADMIN_ID, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('发放口令需先解锁写密钥：写密钥锁定态下 → E_L0_LOCKED', async () => {
    const t = await createTestVault();
    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await expect(t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect((await t.vault.status()).member_write_wraps).toBe(0);
  });

  it('口令 <8 位 → E_AUTH_L0', async () => {
    const t = await createTestVault();
    await expect(t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: 'short', admin_user_id: TEST_ADMIN_ID }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('撤销写解锁口令：计数归零且成员不再能解锁', async () => {
    const t = await createTestVault();
    await t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    await t.vault.removeMemberWriteWrap({ member_id: MEMBER, admin_user_id: TEST_ADMIN_ID });
    expect((await t.vault.status()).member_write_wraps).toBe(0);
    await expect(t.vault.unlockWrite({ password: MEM_PW, admin_user_id: TEST_ADMIN_ID, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });
  });

  it('status.member_wrap_ids：列出发给了谁（排序、只回账号、不含任何包裹材料），撤销即消失', async () => {
    const t = await createTestVault();
    expect((await t.vault.status()).member_wrap_ids).toEqual([]);

    await t.vault.addMemberWriteWrap({ member_id: 'mem_b', passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    await t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    const st = await t.vault.status();
    // 字典序稳定 → 页面渲染顺序不抖；数量与列表长度一致
    expect(st.member_wrap_ids).toEqual([MEMBER, 'mem_b'].sort());
    expect(st.member_write_wraps).toBe(st.member_wrap_ids.length);
    // 只回账号：salt/iv/ct 一个都不许出现在 status 里
    const wrap = t.keyring.value?.member_wraps?.[MEMBER];
    const serialized = JSON.stringify(st);
    expect(serialized).not.toContain(wrap!.ct);
    expect(serialized).not.toContain(wrap!.iv);
    expect(serialized).not.toContain(wrap!.salt);

    await t.vault.removeMemberWriteWrap({ member_id: MEMBER, admin_user_id: TEST_ADMIN_ID });
    expect((await t.vault.status()).member_wrap_ids).toEqual(['mem_b']);
  });

  it('myWriteWrap：分开回「有没有钥匙」与「现在是否已解锁」，不校验口令、不返回包裹', async () => {
    const t = await createTestVault();
    // 未发放 + 写密钥在内存（setup 后即解锁）
    expect(await t.vault.myWriteWrap(MEMBER)).toEqual({ has_wrap: false, write_unlocked: true });
    await t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    const r = await t.vault.myWriteWrap(MEMBER);
    expect(r).toEqual({ has_wrap: true, write_unlocked: true });
    expect(Object.keys(r)).toEqual(['has_wrap', 'write_unlocked']);
    // 锁定写密钥 → 钥匙还在（has_wrap 仍 true），但「已解锁」变 false：两件事必须分开
    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    expect(await t.vault.myWriteWrap(MEMBER)).toEqual({ has_wrap: true, write_unlocked: false });
    await expect(t.vault.myWriteWrap('')).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('成员解锁装的是同一把全局 DEK：写锁后成员自解锁可继续 seal，且与管理员封存密文互通', async () => {
    const t = await createTestVault();
    const envAdmin = await t.vault.seal('管理员封存原文');
    await t.vault.addMemberWriteWrap({ member_id: MEMBER, passphrase: MEM_PW, admin_user_id: TEST_ADMIN_ID });
    const g = await t.vault.grantAccess({ grantee_user_id: MEMBER, scope_project_ids: ['P1'], password: TEST_GRANT_PW, admin_user_id: TEST_ADMIN_ID });
    const u = await t.vault.unlock({ grant_id: g.grant_id, password: TEST_GRANT_PW, user_id: MEMBER });

    await t.vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await t.vault.unlockWrite({ password: MEM_PW, admin_user_id: TEST_ADMIN_ID, member_id: MEMBER });

    const envMember = await t.vault.seal('成员续写原文');
    const p1 = await t.vault.decrypt({ l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: envAdmin });
    const p2 = await t.vault.decrypt({ l0_session_id: u.l0_session_id, project_id: 'P1', mem_id: 'm2', envelope: envMember });
    expect(p1).toBe('管理员封存原文');
    expect(p2).toBe('成员续写原文');
  });
});
