// 冲突类型 → 中文标签（规格常量）。页面数据真相 = 内核账本，无演示冲突。
import type { ConflictRecord } from './types.ts';

export const CONFIRM_TYPE_LABEL: Record<ConflictRecord['conflict_type'], string> = {
  direct_contradiction: '直接矛盾',
  partial_overlap: '部分重叠',
  context_dependent: '语境相关',
  uncertain: '不确定',
};
