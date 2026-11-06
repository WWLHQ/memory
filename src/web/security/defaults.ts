// 账号与安全页规格常量（密码策略 / 禁用词 / 角色矩阵）。
// 成员、密钥、密码历史均为真实域数据：内核暂无此域模型 → 空初始态，不预置演示记录。
import { DEFAULT_PWD_POLICY, type PwdPolicy } from '../../shared/passwordPolicy.ts';

/** 内置默认策略（后端 home-policy.json 未建立/读取失败时展示与兜底用） */
export const DEFAULT_POLICY: PwdPolicy = DEFAULT_PWD_POLICY;

/** 禁用词表（4.2 forbidden_patterns 命中即拒） */
export const FORBIDDEN_PATTERNS = ['password', '123456', 'qwerty', 'admin'];

/** 角色矩阵（3.2 只读展示） */
export const ROLE_MATRIX = [
  { scope: 'enterprise', visible: '企业管理员全量可见' },
  { scope: 'team', visible: '同团队成员互相可见' },
  { scope: 'private', visible: '个人他人不可见（3.2）' },
];
