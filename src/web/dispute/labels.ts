// 冲突类型 → 中文标签（规格常量）。页面数据真相 = 内核账本，无演示冲突。
import type { ConflictRecord } from './types.ts';

/** null（内核未检测）由 typeLabel 单独处理，不进标签表 */
export const CONFIRM_TYPE_LABEL: Record<Exclude<ConflictRecord['conflict_type'], null>, string> = {
  direct_contradiction: '直接矛盾',
  partial_overlap: '部分重叠',
  context_dependent: '语境相关',
  uncertain: '不确定',
};
