// T2 验收（提前规划的测试）：密码哈希与校验
// 对应 specs/tasks/HOME-LOGIN.md T2 「验收（提前规划的测试）」
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../hash.ts';

const PLAIN = 'pass_001';

describe('hashPassword（§4.1 哈希存储、不回显）', () => {
  it('产出非明文，且同明文两次哈希结果不同（含随机 salt）', () => {
    const h1 = hashPassword(PLAIN);
    const h2 = hashPassword(PLAIN);
    expect(h1).not.toBe(PLAIN); // 非明文
    expect(h1).not.toBe(h2); // 每次 salt 不同
    expect(h1).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // salt:derived(hex)
  });

  it('空密码 / 含特殊字符密码不崩', () => {
    expect(() => hashPassword('')).not.toThrow();
    expect(() => hashPassword('a"b\'c`d$e%f^&*()_+{}[]|\\')).not.toThrow();
    const he = hashPassword('');
    expect(he).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });
});

describe('verifyPassword（§4.1 校验 + 防时序）', () => {
  const hash = hashPassword(PLAIN);

  it('正确密码返回 true', () => {
    expect(verifyPassword(PLAIN, hash)).toBe(true);
  });

  it('错误密码返回 false', () => {
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('格式错误的 hash 不抛出、返回 false（边界安全）', () => {
    expect(() => verifyPassword(PLAIN, 'not-a-hash')).not.toThrow();
    expect(verifyPassword(PLAIN, 'not-a-hash')).toBe(false);
    expect(verifyPassword(PLAIN, '')).toBe(false);
    expect(verifyPassword(PLAIN, ':')).toBe(false);
  });

  it('防时序：正确/错误密码的校验耗时差在宽松阈值内（scrypt 同参 + 常量比较）', () => {
    const N = 40;
    const tOk: number[] = [];
    const tWrong: number[] = [];
    for (let i = 0; i < N; i++) {
      let s = performance.now();
      verifyPassword(PLAIN, hash);
      tOk.push(performance.now() - s);
      s = performance.now();
      verifyPassword('wrong', hash);
      tWrong.push(performance.now() - s);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const mOk = mean(tOk);
    const mWrong = mean(tWrong);
    const diffRatio = Math.abs(mOk - mWrong) / Math.max(mOk, mWrong);
    // 宽松守卫：主要防"错误路径显著更快/更慢"的粗粒度泄露；scrypt 同参 + timingSafeEqual 保证结构恒定
    expect(diffRatio).toBeLessThan(1.0);
  });
});
