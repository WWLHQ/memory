// 批次48 A10：密码策略（4.2）的共享真源 —— 首页后端持久化 + 注册/改密校验 + 安全页展示同一份定义。
// 此前策略卡只是前端 useState：刷新回默认、且对任何真实密码流程都不生效（假配置）。
// 历史密码查重（history_count）暂无历史库，未实现；此处只做长度/字符集校验，不能声称已查重。

export interface PwdPolicy {
  min_len: number;
  max_len: number;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
  /** 最近 N 次不可重复（4.2）；当前无历史库，仅持久化展示，未参与校验 */
  history_count: number;
}

export const DEFAULT_PWD_POLICY: PwdPolicy = {
  min_len: 8,
  max_len: 64,
  upper: true,
  lower: true,
  digit: true,
  special: true,
  history_count: 5,
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
};

/** 把外部输入收敛成合法策略（越界钳制而不是抛错：策略是配置，不是安全凭据） */
export function normalizePwdPolicy(input: unknown): PwdPolicy {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const min_len = int(o.min_len, 8, 64, DEFAULT_PWD_POLICY.min_len);
  const max_len = Math.max(min_len, int(o.max_len, 8, 128, DEFAULT_PWD_POLICY.max_len));
  return {
    min_len,
    max_len,
    upper: bool(o.upper, DEFAULT_PWD_POLICY.upper),
    lower: bool(o.lower, DEFAULT_PWD_POLICY.lower),
    digit: bool(o.digit, DEFAULT_PWD_POLICY.digit),
    special: bool(o.special, DEFAULT_PWD_POLICY.special),
    history_count: int(o.history_count, 1, 10, DEFAULT_PWD_POLICY.history_count),
  };
}

/** 校验密码是否符合策略；符合返回 null，否则返回可直接展示的中文原因 */
export function validatePasswordAgainstPolicy(pwd: string, policy: PwdPolicy): string | null {
  if (pwd.length < policy.min_len || pwd.length > policy.max_len) return `密码长度须 ${policy.min_len}-${policy.max_len} 位`;
  if (policy.upper && !/[A-Z]/.test(pwd)) return '密码须含大写字母';
  if (policy.lower && !/[a-z]/.test(pwd)) return '密码须含小写字母';
  if (policy.digit && !/[0-9]/.test(pwd)) return '密码须含数字';
  if (policy.special && !/[^A-Za-z0-9]/.test(pwd)) return '密码须含特殊字符';
  return null;
}
