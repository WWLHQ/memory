// 批次37-G：L0Vault 层的恢复码行为单测（纯函数见 l0Recovery.test.ts）。
// 钉六件事：① 初始化一次产出「密码包 + 恢复码包」且只回显码这一次；
// ② 已设过管理密码不能再走初始化（防止换 DEK 把老密文全废）；
// ③ 恢复码错算进同一套 5 次锁定链路（码也是凭据，可被暴力试探）；
// ④ 一次性：用过即被新码覆盖，旧码当场解不开；
// ⑤ DEK 不变 → 恢复前封的信封，恢复后用新密码照样解得开；
// ⑥ recovery 能活过 keyring 重新载入，且码/密码任何一次都不进审计。
import { describe, it, expect } from 'vitest';
import { L0Vault } from '../l0vault.ts';
import { MemAgentError } from '../errors.ts';
import { createTestVault, MemoryLockStore, TEST_ADMIN_ID } from './l0Kit.ts';

const PW = 'adminpass-1';
const NEW_PW = 'adminpass-2';

/** 审计里绝不能出现的机密串 */
function assertNoSecrets(audits: { detail?: Record<string, unknown> }[], secrets: string[]) {
  const dumped = JSON.stringify(audits);
  for (const s of secrets) expect(dumped).not.toContain(s);
}

async function initVault() {
  const t = await createTestVault({ setup: false });
  const issued = await t.vault.initL0WithRecovery({ password: PW, admin_user_id: TEST_ADMIN_ID });
  return { ...t, issued };
}

describe('初始化即发恢复码', () => {
  it('产出 43 字符码 + 指纹，keyring 同时有 admin_wrap 与 recovery，审计只记指纹', async () => {
    const { vault, keyring, audits, issued } = await initVault();
    expect(issued.recovery_code).toHaveLength(43);
    expect(issued.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    const k = await keyring.read();
    expect(k?.admin_wrap?.ct).toBeTruthy();
    expect(k?.recovery?.wrap.ct).toBeTruthy();
    expect(k?.recovery?.revoked_at).toBeUndefined();
    const created = audits.filter((a) => a.detail?.op === 'l0_recovery_created');
    expect(created).toHaveLength(1);
    expect(created[0].detail?.fingerprint).toBe(issued.fingerprint);
    // 码明文与密码都不进审计（唯一一次返回就是返回值本身）
    assertNoSecrets(audits, [issued.recovery_code, PW]);
    expect(await vault.recoveryStatus()).toMatchObject({ has_recovery: true, fingerprint: issued.fingerprint });
  });

  it('密码不足 8 位 → E_AUTH_L0，且不落任何 keyring 改动', async () => {
    const t = await createTestVault({ setup: false });
    await expect(t.vault.initL0WithRecovery({ password: 'short', admin_user_id: TEST_ADMIN_ID }))
      .rejects.toBeInstanceOf(MemAgentError);
    expect((await t.keyring.read())?.admin_wrap).toBeUndefined();
    expect(t.keyring.writes).toBe(0);
  });

  it('已设过管理密码 → 拒绝重复初始化（换 DEK 等于把老密文全作废）', async () => {
    const t = await createTestVault();
    const before = JSON.stringify(await t.keyring.read());
    const err = await t.vault.initL0WithRecovery({ password: PW, admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(err?.code).toBe('E_AUTH_L0');
    expect(err?.message).toContain('重新生成恢复码');
    expect(JSON.stringify(await t.keyring.read())).toBe(before);
  });

  it('recoveryStatus 只回状态，绝不回显码', async () => {
    const { vault, issued } = await initVault();
    const status = await vault.recoveryStatus();
    expect(Object.keys(status).sort()).toEqual(['created_at', 'fingerprint', 'has_recovery', 'revoked_at']);
    expect(JSON.stringify(status)).not.toContain(issued.recovery_code);
  });
});

describe('忘记管理密码 → 用恢复码找回', () => {
  it('码对 → 设新密码并当场换新码；旧码立刻解不开，新码可用', async () => {
    const { vault, issued, audits } = await initVault();
    const env = await vault.seal('L0 原文：端口 8204 拒连');
    const next = await vault.recoverWithCode({ code: issued.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID });
    expect(next.recovery_code).not.toBe(issued.recovery_code);
    expect(next.fingerprint).not.toBe(issued.fingerprint);

    // 旧码已被新码覆盖：拿它再试 = 口令错误（不给「格式对但过期」这种可枚举信息）
    const staleErr = await vault.recoverWithCode({ code: issued.recovery_code, newPassword: PW, admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(staleErr?.code).toBe('E_AUTH_L0');
    expect(staleErr?.message).toContain('恢复码无效');

    // 新密码 + 新码都成立
    await expect(vault.unlockWrite({ password: NEW_PW, admin_user_id: TEST_ADMIN_ID })).resolves.toBeUndefined();
    const s = await vault.unlock({ password: NEW_PW, user_id: TEST_ADMIN_ID });
    expect(await vault.decrypt({ l0_session_id: s.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: env }))
      .toBe('L0 原文：端口 8204 拒连');

    const rec = audits.filter((a) => a.detail?.op === 'l0_recovered');
    expect(rec).toHaveLength(1);
    expect(rec[0].detail?.old_fingerprint).toBe(issued.fingerprint);
    assertNoSecrets(audits, [issued.recovery_code, next.recovery_code, PW, NEW_PW]);
  });

  it('恢复码错 5 次 → 账号锁定，锁定期内即使码对也拒绝（码与密码同一套限速）', async () => {
    const { vault, issued, locks, clock } = await initVault();
    for (let i = 0; i < 5; i++) {
      const err = await vault.recoverWithCode({ code: 'junk'.repeat(11), newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID })
        .then(() => null, (e) => e as MemAgentError);
      expect(err?.message).toContain('恢复码无效');
    }
    expect((await locks.read(`l0:${TEST_ADMIN_ID}`))?.fails).toBe(5);
    const locked = await vault.recoverWithCode({ code: issued.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(locked?.message).toContain('锁定');
    // 锁定期间恢复码没被消费：状态仍有效，解锁窗口一过照样能找回
    expect((await vault.recoveryStatus()).has_recovery).toBe(true);
    clock.t += 15 * 60 * 1000 + 1;
    const ok = await vault.recoverWithCode({ code: issued.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID });
    expect(ok.recovery_code).toHaveLength(43);
    expect(ok.recovery_code).not.toBe(issued.recovery_code);
  });

  it('新密码不足 8 位 → 快速失败，恢复码不作废', async () => {
    const { vault, issued } = await initVault();
    const err = await vault.recoverWithCode({ code: issued.recovery_code, newPassword: 'short', admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(err?.message).toContain('新管理密码须');
    expect((await vault.recoveryStatus()).fingerprint).toBe(issued.fingerprint);
  });

  it('从未生成过恢复码（旧库升级）→ 如实拒绝，不假装能找回', async () => {
    const t = await createTestVault();
    const err = await t.vault.recoverWithCode({ code: 'x'.repeat(43), newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(err?.code).toBe('E_L0_NO_GRANT');
    expect(err?.message).toContain('从未生成过');
  });

  it('恢复码带空格/换行（手抄、打印折行）照样解得开', async () => {
    const { vault, issued } = await initVault();
    const spaced = `${issued.recovery_code.slice(0, 20)}\n ${issued.recovery_code.slice(20)}  `;
    const next = await vault.recoverWithCode({ code: spaced, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID });
    expect(next.recovery_code).toHaveLength(43);
  });
});

describe('恢复前后是同一个 DEK', () => {
  it('恢复只重包密码，不换 DEK → 恢复前封的信封仍可读', async () => {
    const { vault, issued } = await initVault();
    const env = await vault.seal('L0 原文：ECONNREFUSED 8204');
    await vault.recoverWithCode({ code: issued.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID });
    const s = await vault.unlock({ password: NEW_PW, user_id: TEST_ADMIN_ID });
    expect(await vault.decrypt({ l0_session_id: s.l0_session_id, project_id: 'P1', mem_id: 'm1', envelope: env }))
      .toBe('L0 原文：ECONNREFUSED 8204');
  });
});

describe('主动换卡（rotateRecoveryCode）', () => {
  it('未解锁写密钥 → E_L0_LOCKED（否则拿到文件的人就能免密发码）', async () => {
    const { keyring, issued } = await initVault();
    const restarted = new L0Vault({
      keyring, locks: new MemoryLockStore(), audit: { appendAudit: async () => {} }, form: 'desktop',
    });
    expect((await restarted.recoveryStatus()).fingerprint).toBe(issued.fingerprint);
    const err = await restarted.rotateRecoveryCode({ admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(err?.code).toBe('E_L0_LOCKED');
  });

  it('解锁后换码：旧码当场失效、新码能完成恢复，审计记 l0_recovery_rotated', async () => {
    const { vault, issued, audits } = await initVault();
    const rotated = await vault.rotateRecoveryCode({ admin_user_id: TEST_ADMIN_ID });
    expect(rotated.recovery_code).not.toBe(issued.recovery_code);
    const err = await vault.recoverWithCode({ code: issued.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID })
      .then(() => null, (e) => e as MemAgentError);
    expect(err?.message).toContain('恢复码无效');
    await expect(vault.recoverWithCode({ code: rotated.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID }))
      .resolves.toHaveProperty('recovery_code');
    const a = audits.filter((x) => x.detail?.op === 'l0_recovery_rotated');
    expect(a).toHaveLength(1);
    expect(a[0].detail?.old_fingerprint).toBe(issued.fingerprint);
    assertNoSecrets(audits, [issued.recovery_code, rotated.recovery_code]);
  });
});

describe('recovery 活过重启', () => {
  it('新建 L0Vault 挂同一 keyring：恢复码仍在，且能凭它找回（load 白名单不再吞字段）', async () => {
    const { keyring, issued } = await initVault();
    const restarted = new L0Vault({
      keyring, locks: new MemoryLockStore(), audit: { appendAudit: async () => {} }, form: 'desktop',
    });
    expect((await restarted.recoveryStatus()).has_recovery).toBe(true);
    expect((await restarted.recoveryStatus()).fingerprint).toBe(issued.fingerprint);
    // 找回不依赖旧实例（内存里没有密码也没有 DEK）
    const next = await restarted.recoverWithCode({
      code: issued.recovery_code, newPassword: NEW_PW, admin_user_id: TEST_ADMIN_ID,
    });
    expect(next.recovery_code).toHaveLength(43);
    expect((await keyring.read())?.recovery?.wrap.salt).toBeTruthy();
  });
});
