import { describe, it, expect } from 'vitest';
import { canCrossTeam, inGrace, maskKey, rotateWarn, validatePwd } from '../logic.ts';
import { DEFAULT_POLICY, PWD_HISTORY, SEED_KEYS, SEED_MEMBERS } from '../seed.ts';

const NOW = new Date('2026-10-10T10:00:00Z').getTime();

describe('validatePwd（4.2）', () => {
  it('长度校验', () => {
    expect(validatePwd('Ab1!', DEFAULT_POLICY, PWD_HISTORY)).toContain('长度');
  });
  it('字符类校验', () => {
    expect(validatePwd('abcdefgh', DEFAULT_POLICY, PWD_HISTORY)).toContain('大写');
    expect(validatePwd('ABCDEFGH', DEFAULT_POLICY, PWD_HISTORY)).toContain('小写');
    expect(validatePwd('Abcdefgh', DEFAULT_POLICY, PWD_HISTORY)).toContain('数字');
    expect(validatePwd('Abcdefg1', DEFAULT_POLICY, PWD_HISTORY)).toContain('特殊');
  });
  it('禁用词命中即拒', () => {
    expect(validatePwd('MyPassword1!', DEFAULT_POLICY, PWD_HISTORY)).toBe('含禁用词');
  });
  it('与最近 5 次历史重复', () => {
    expect(validatePwd('Abcdef1!', DEFAULT_POLICY, PWD_HISTORY)).toBe('与历史重复');
  });
  it('合规通过', () => {
    expect(validatePwd('N3w^Secret9', DEFAULT_POLICY, PWD_HISTORY)).toBeNull();
  });
});

describe('canCrossTeam（3.2）', () => {
  it('未共享禁跨团队', () => {
    expect(canCrossTeam(SEED_MEMBERS[1])).toBe(false);
    expect(canCrossTeam(SEED_MEMBERS[0])).toBe(true);
  });
});

describe('密钥轮换（18.2-A）', () => {
  it('超 90 天警示', () => {
    // key_002 last_rotated 2026-06-01 → >90d
    expect(rotateWarn(SEED_KEYS[1], NOW)).toContain('未轮换');
    expect(rotateWarn(SEED_KEYS[0], NOW)).toBeNull();
  });
  it('宽限 24h', () => {
    expect(inGrace({ ...SEED_KEYS[0], last_rotated: new Date(NOW - 2 * 3600e3).toISOString() }, NOW)).toBe(true);
    expect(inGrace({ ...SEED_KEYS[0], last_rotated: new Date(NOW - 48 * 3600e3).toISOString() }, NOW)).toBe(false);
  });
  it('脱敏展示', () => {
    expect(maskKey('akif_9x2QabcdefghwR7L')).toBe('akif****wR7L');
    expect(maskKey('short')).toBe('****');
  });
});
