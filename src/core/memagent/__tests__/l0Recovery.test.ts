// 批次37-G：L0 恢复码纯函数单测。
// 钉四件事：① 码是 256bit 随机且不可猜；② 输入归一只吃空白，不吃别的宽容；
// ③ admin_wrap 与 recovery_wrap 开的是**同一个 DEK**（否则恢复码找回来的密钥解不开老密文）；
// ④ 恢复卡有码、有指纹、有红线，但绝不含管理密码。
import { describe, it, expect } from 'vitest';
import {
  buildRecoveryCard, createKeyringSecrets, formatRecoveryCode, generateRecoveryCode,
  keyringFingerprint, normalizeRecoveryCode, RECOVERY_CODE_BYTES, unwrapDekWithRecovery, wrapDekWithRecovery,
} from '../l0Recovery.ts';
import { decryptL0WithKey, encryptL0WithKey, unwrapSecret, deriveKek } from '../crypto.ts';

const PW = 'adminpass-1';

describe('恢复码生成与归一', () => {
  it('32 字节 → 43 字符 base64url；两次生成不同；只含 base64url 字符', () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(RECOVERY_CODE_BYTES);
  });

  it('展示按 4 字符分组，归一后与原文逐字相同（手抄换行/复制带空格都不该导致恢复失败）', () => {
    const code = generateRecoveryCode();
    const shown = formatRecoveryCode(code);
    expect(shown).toContain(' ');
    expect(normalizeRecoveryCode(shown)).toBe(code);
    expect(normalizeRecoveryCode(`  ${code.slice(0, 10)}\n${code.slice(10)}  \t`)).toBe(code);
    expect(normalizeRecoveryCode(undefined as unknown as string)).toBe('');
  });

  it('不接受用户自拟的短码（弱恢复码等于没有恢复通道）', async () => {
    await expect(wrapDekWithRecovery(new Uint8Array(32), 'password123')).rejects.toThrow(/长度不足/);
  });
});

describe('两份包裹开同一个 DEK', () => {
  it('恢复码包与管理密码包解出的 DEK 一致，且能解开用该 DEK 封的信封', async () => {
    const code = generateRecoveryCode();
    const created = await createKeyringSecrets(PW, code);
    const fromPw = await unwrapSecret(created.admin_wrap, await deriveKek(PW, created.admin_wrap.salt));
    const fromCode = await unwrapDekWithRecovery(created.recovery_wrap, code);
    expect(Buffer.from(fromCode)).toEqual(Buffer.from(fromPw));
    expect(Buffer.from(fromCode)).toEqual(Buffer.from(created.dek));

    const env = await encryptL0WithKey('L0 原文：端口 8204', created.dek);
    expect(await decryptL0WithKey(env, fromCode)).toBe('L0 原文：端口 8204');
  });

  it('码错 → 解不开（与「密码错」同一类失败，不区分原因）；带空白的正确码 → 解得开', async () => {
    const code = generateRecoveryCode();
    const created = await createKeyringSecrets(PW, code);
    await expect(unwrapDekWithRecovery(created.recovery_wrap, generateRecoveryCode())).rejects.toThrow();
    await expect(unwrapDekWithRecovery(created.recovery_wrap, formatRecoveryCode(code)))
      .resolves.toHaveLength(32);
  });

  it('两次 createKeyringSecrets 的 DEK/盐都不同（不复用随机数）', async () => {
    const a = await createKeyringSecrets(PW, generateRecoveryCode());
    const b = await createKeyringSecrets(PW, generateRecoveryCode());
    expect(Buffer.from(a.dek)).not.toEqual(Buffer.from(b.dek));
    expect(a.admin_wrap.salt).not.toBe(b.admin_wrap.salt);
  });
});

describe('库指纹', () => {
  it('由公开材料稳定派生（8 位十六进制）；任一侧缺失给空串', async () => {
    const created = await createKeyringSecrets(PW, generateRecoveryCode());
    const f = keyringFingerprint(created.admin_wrap, created.recovery_wrap);
    expect(f).toMatch(/^[0-9a-f]{8}$/);
    expect(keyringFingerprint(created.admin_wrap, created.recovery_wrap)).toBe(f);
    expect(keyringFingerprint(null, created.recovery_wrap)).toBe('');
    expect(keyringFingerprint(created.admin_wrap, null)).toBe('');
    // 换一个库（盐不同）→ 指纹不同，用户才知道两张卡不是同一份
    const other = await createKeyringSecrets(PW, generateRecoveryCode());
    expect(keyringFingerprint(other.admin_wrap, other.recovery_wrap)).not.toBe(f);
  });
});

describe('恢复卡', () => {
  it('含分组码/指纹/文件路径/三条红线；不含管理密码，也不含逐字码以外的形态', () => {
    const code = generateRecoveryCode();
    const card = buildRecoveryCard({
      code, fingerprint: 'ab12cd34', l0_path: 'D:\\私密\\l0\\memories.l0.json',
      created_at: 1_800_000_000_000, has_admin_password: true,
    });
    expect(card).toContain(formatRecoveryCode(code));
    expect(card).toContain('ab12cd34');
    expect(card).toContain('memories.l0.json');
    expect(card).toContain('同时');
    expect(card).toContain('不可恢复');
    expect(card).toContain('用过一次即作废');
    expect(card).toContain('重新导出');
    expect(card).not.toContain(PW);
    expect(card).not.toContain('256bit');
  });
});
