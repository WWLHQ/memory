// 「个人记忆账号绑定」卡中文名唯一来源（OB-3）。
// UI 铁律：整页只出中文名 + 一句摘要，绝不渲染原始 JSON / payload / 英文字段名——
// 别处需要翻译绑定时一律 import 本表，不写第二套词表。
export const BINDING_FIELD_LABELS = {
  account: { name: '登录账号', desc: '顶栏登录用的账号名' },
  kernel_user_id: { name: '绑定的身份', desc: '个人记忆归属到哪个本机用户' },
} as const;

export type BindingFieldKey = keyof typeof BINDING_FIELD_LABELS;

export const BINDING_FIELD_KEYS: readonly BindingFieldKey[] = ['account', 'kernel_user_id'];

/** 二次确认口令（与主进程 owner-bindings:set handler 同一常量口径） */
export const BINDING_CONFIRM_WORD = 'BIND';

/** 绑定生效来源的中文说法（env = 系统环境变量覆盖；file = 本机配置文件） */
export const BINDING_SOURCE_LABELS: Record<'env' | 'file', string> = {
  env: '当前由系统环境变量接管（界面修改不会生效，需清除该变量后重启）',
  file: '当前由本机配置文件生效',
};
