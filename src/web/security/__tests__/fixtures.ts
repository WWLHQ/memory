// 账号与安全页单测夹具（仅测试用；成员/密钥/密码历史无种子，真实初始态为空）。
import type { ApiKey, TeamMember } from '../types.ts';

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
