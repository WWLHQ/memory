// REQ-004 T2 衰减 / 老化 / 证据判定（纯逻辑，零 UI 依赖）
// 来源：需求规格书_Agent界面内联记忆标识.md §2.1（decay_class）/ §2.4（aging_hint·evidence_thin）/ §3（贡献摘要）
import type { MemoryInjectionMark, TokenSaving, WriteBackMark, DecayClass } from '../types/inlineAttribution.ts';

/** 按记忆age（天）给衰减层（15.3）：≤7 hot / ≤45 warm / ≤180 cold / 其余 dormant */
export function decayClassFromAge(days: number): DecayClass {
  if (days <= 7) return 'hot';
  if (days <= 45) return 'warm';
  if (days <= 180) return 'cold';
  return 'dormant';
}

/**
 * 老化提示文案（9.6）。
 * aging_hint 非空 → 原样返回（后端已算好）；否则按衰减层给默认提示：
 * cold/dormant（较旧）→ 提示校验；hot/warm → 空（未老化）。
 */
export function agingHintText(mark: MemoryInjectionMark): string {
  if (mark.aging_hint && mark.aging_hint.trim()) return mark.aging_hint;
  if (mark.decay_class === 'cold' || mark.decay_class === 'dormant') {
    return '该记忆较旧（45 天前记录），代码可能已改动，请校验后再使用（9.6）';
  }
  return '';
}

/** 证据不足标记（2.4.3 evidence_thin），恒显示不可关 */
export function isEvidenceThin(mark: MemoryInjectionMark): boolean {
  return mark.evidence_thin === true;
}

/**
 * 每回答 1 行贡献摘要（§3）：来自 N 条记忆 · 省 X token · 新沉淀 1 条
 * saving / writeBack 为 null 时不计入对应片段（REQ-007 才提供真实数据）。
 */
export function summarizeAttribution(
  injections: MemoryInjectionMark[],
  saving: TokenSaving | null,
  writeBack: WriteBackMark | null,
): string {
  const parts: string[] = [`来自 ${injections.length} 条记忆`];
  if (saving) parts.push(`省 ${saving.saved} token`);
  if (writeBack) parts.push('新沉淀 1 条记忆');
  return parts.join(' · ');
}
