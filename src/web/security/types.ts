// 账号与安全页（REQ-006 / P12）数据模型
// 规格：4.1 加密 / 4.2 密码策略 / 3.2 角色矩阵 / 18.2-A 用户与团队。

export interface PwdPolicy {
  min_len: number;
  max_len: number;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
  /** 最近 N 次不可重复（4.2） */
  history_count: number;
}

export type Scope = 'enterprise' | 'team' | 'private';

export interface TeamMember {
  id: string;
  role: 'admin' | 'member' | 'readonly';
  team: string;
  /** 跨团队共享标记（3.2：改共享标记即时生效） */
  shared: boolean;
}

export interface ApiKey {
  id: string;
  masked: string;
  created_at: string;
  last_rotated: string;
  revoked: boolean;
}
