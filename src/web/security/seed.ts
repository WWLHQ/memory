// 账号与安全页（REQ-006 / P12）种子数据
import type { ApiKey, PwdPolicy, TeamMember } from './types.ts';

export const DEFAULT_POLICY: PwdPolicy = {
  min_len: 8,
  max_len: 64,
  upper: true,
  lower: true,
  digit: true,
  special: true,
  history_count: 5,
};

/** 禁用词表（4.2 forbidden_patterns 命中即拒） */
export const FORBIDDEN_PATTERNS = ['password', '123456', 'qwerty', 'admin'];

/** 密码历史（最近 5 次不可重复） */
export const PWD_HISTORY = ['OldPass!2024', 'Abcdef1!', 'Qwerty9$x', 'Demo1234', 'Xy99$$zz'];

export const SEED_MEMBERS: TeamMember[] = [
  { id: 'user_001', role: 'admin', team: 'team_001', shared: true },
  { id: 'user_002', role: 'member', team: 'team_001', shared: false },
  { id: 'user_003', role: 'member', team: 'team_002', shared: true },
  { id: 'user_004', role: 'readonly', team: 'team_002', shared: false },
];

export const SEED_KEYS: ApiKey[] = [
  { id: 'key_001', masked: 'akif_9x2Q****wR7L', created_at: '2026-08-01T00:00:00Z', last_rotated: '2026-09-20T00:00:00Z', revoked: false },
  { id: 'key_002', masked: 'akif_1a4B****zP8M', created_at: '2026-05-10T00:00:00Z', last_rotated: '2026-06-01T00:00:00Z', revoked: false },
];

/** 角色矩阵（3.2 只读展示） */
export const ROLE_MATRIX = [
  { scope: 'enterprise', visible: '企业管理员全量可见' },
  { scope: 'team', visible: '同团队成员互相可见' },
  { scope: 'private', visible: '个人他人不可见（3.2）' },
];
