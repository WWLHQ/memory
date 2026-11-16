// 「本机租户身份」卡中文名唯一来源（管理员与成员权限设计 §14.2 / AC-11）。
// UI 铁律：整页只出中文名 + 一句摘要，绝不渲染原始 JSON / payload / 英文字段名——
// 别处需要翻译租户字段时一律 import 本表，不写第二套词表。
export const TENANT_FIELD_LABELS = {
  user_id: { name: '本机用户标识', desc: '决定个人记忆的归属账号' },
  team_id: { name: '团队标识', desc: '团队级记忆共享的边界' },
  enterprise_id: { name: '企业（租户）标识', desc: '多租户数据隔离的顶层边界' },
} as const;

export type TenantFieldKey = keyof typeof TENANT_FIELD_LABELS;

export const TENANT_FIELD_KEYS: readonly TenantFieldKey[] = ['user_id', 'team_id', 'enterprise_id'];

/** 二次确认口令（与主进程 tenant:set handler 同一常量口径） */
export const TENANT_CONFIRM_WORD = 'TENANT';
