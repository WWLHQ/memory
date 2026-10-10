// 账号与安全页（REQ-006 / P12）纯逻辑层
import type { ApiKey, PwdPolicy, TeamMember } from './types.ts';
import { FORBIDDEN_PATTERNS } from './seed.ts';

/** 密码校验（4.2）：长度 8-64 / 字符类 / 禁用词 / 最近 N 次不可重复 */
export function validatePwd(pwd: string, policy: PwdPolicy, history: string[]): string | null {
  if (pwd.length < policy.min_len || pwd.length > policy.max_len)
    return `长度须 ${policy.min_len}-${policy.max_len} 位`;
  if (policy.upper && !/[A-Z]/.test(pwd)) return '须含大写字母';
  if (policy.lower && !/[a-z]/.test(pwd)) return '须含小写字母';
  if (policy.digit && !/[0-9]/.test(pwd)) return '须含数字';
  if (policy.special && !/[^A-Za-z0-9]/.test(pwd)) return '须含特殊字符';
  const low = pwd.toLowerCase();
  if (FORBIDDEN_PATTERNS.some((p) => low.includes(p))) return '含禁用词';
  if (history.slice(0, policy.history_count).includes(pwd)) return '与历史重复';
  return null;
}

/** 跨团队操作约束（3.2/18.2-A）：需已共享 */
export function canCrossTeam(m: TeamMember): boolean {
  return m.shared;
}

/** 密钥轮换（18.2-A）：宽限 24h；超 90 天未轮换提示 */
export const ROTATE_GRACE_HOURS = 24;
export const ROTATE_WARN_DAYS = 90;

export function rotateWarn(key: ApiKey, now = Date.now()): string | null {
  if (key.revoked) return null;
  const days = Math.floor((now - new Date(key.last_rotated).getTime()) / 86400e3);
  return days > ROTATE_WARN_DAYS ? `已 ${days} 天未轮换（>${ROTATE_WARN_DAYS} 天）` : null;
}

export function inGrace(key: ApiKey, now = Date.now()): boolean {
  const h = (now - new Date(key.last_rotated).getTime()) / 3600e3;
  return h <= ROTATE_GRACE_HOURS;
}

/** 密钥脱敏展示（与 P10 联动） */
export function maskKey(raw: string): string {
  if (raw.length <= 8) return '****';
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
}
