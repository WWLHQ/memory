/**
 * evidence_thin 口径迁移的单一读取真源（#46，2026-11-27）。
 *
 * 背景：evidence_thin 的判定口径在 18a404c（2026-11-22）由 hits.score<0.3 改为
 * scored.relevance<0.3，但字段名不变、历史行无版本标记，导致消费侧把旧口径的
 * 66.75% 假象当成真实证据质量（逐条重算真值 4.72%），可能误触发走 B 或 w_i 自生长。
 *
 * 本模块只做「读取口径归一」，不碰判定逻辑、λ、阈值、打分排序：
 *  · 落侧（agent.ts）新行写 evidence_thin_rule='relevance' 自证口径；
 *  · 历史行带 mems_detail 时按其中 relevance 实时重算（纯读，不改账本）；
 *  · 可选离线回填脚本把重算结果固化为 evidence_thin_corrected（新字段，不覆盖原值）；
 *  · 消费侧一律走 resolveEvidenceThin(detail)，按下面的优先级解读，杜绝各自解读。
 *
 * 优先级（高到低）：
 *  1. evidence_thin_corrected（回填/权威真值）—— boolean 直接用；
 *  2. evidence_thin_rule='relevance' + evidence_thin boolean —— 新口径行直接用；
 *  3. 有 mems_detail 且能取到 relevance —— 实时重算 every(rel<0.3)，标 recomputed；
 *  4. 仅有 evidence_thin boolean 且无 rule、无 mems_detail —— 老 score 口径假象，**返回 null 不可用**（标 legacy），
 *     消费侧必须跳过；绝不能拿旧假象当真实证据质量（那正是 66.75% 误判走 B 的根因）；
 *  5. 都没有 —— 返回 null（不可用），消费侧跳过，不拿 false 冒充。
 */

/** 与 isEvidenceThin 同阈值：纯相关度 <0.3 判证据不足 */
const RECOMPUTE_THRESHOLD = 0.3;

export type EvidenceThinSource = 'corrected' | 'relevance' | 'recomputed' | 'legacy' | 'unknown';

export interface ResolvedEvidenceThin {
  /** 归一后的证据不足布尔；null = 无可信口径，调用方须跳过该行 */
  thin: boolean | null;
  /** 判定来源，供监控/审计标注口径版本 */
  source: EvidenceThinSource;
}

/**
 * 从 mems_detail 的 relevance 列实时重算证据不足（与 isEvidenceThin 同判据 every(rel<0.3)）。
 * mems_detail 行形状：[mem_id, relevance, f, imp, conf, boost]（见 buildMemsDetail）。
 * 取不到任何有效 relevance 时返回 null，绝不用 score 或命中数冒充。
 */
export function recomputeFromDetail(detail: Record<string, unknown>): boolean | null {
  const rows = detail.mems_detail;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const rels: number[] = [];
  for (const row of rows) {
    const v = Array.isArray(row) ? row[1] : (row as { relevance?: unknown } | null)?.relevance;
    if (typeof v === 'number' && Number.isFinite(v)) rels.push(v);
  }
  if (rels.length === 0) return null;
  return rels.every((r) => r < RECOMPUTE_THRESHOLD);
}

/**
 * 归一读取审计 detail 里的 evidence_thin。纯函数、无副作用、不依赖运行环境。
 * @param detail 审计 detail（AuditRecord.detail 或工具侧解析出的对象；类型为 unknown 以兼容各处局部类型）
 */
export function resolveEvidenceThin(detail: unknown): ResolvedEvidenceThin {
  if (!detail || typeof detail !== 'object') return { thin: null, source: 'unknown' };
  const d = detail as Record<string, unknown>;

  // 1. 回填/权威真值字段优先
  if (typeof d.evidence_thin_corrected === 'boolean') {
    return { thin: d.evidence_thin_corrected, source: 'corrected' };
  }

  // 2. 新口径自证行
  if (d.evidence_thin_rule === 'relevance' && typeof d.evidence_thin === 'boolean') {
    return { thin: d.evidence_thin, source: 'relevance' };
  }

  // 3. 历史行：有 mems_detail 就按 relevance 实时重算（真值口径）
  const recomputed = recomputeFromDetail(d);
  if (recomputed !== null) return { thin: recomputed, source: 'recomputed' };

  // 4. 无版本标记且无 mems_detail 的历史行：evidence_thin 是旧 score 口径假象，
  //    不可当真值用 → 返回 null 让消费侧跳过（否则 66.75% 假象会污染监控/进化）。
  if (typeof d.evidence_thin === 'boolean') {
    return { thin: null, source: 'legacy' };
  }

  // 5. 无可信口径
  return { thin: null, source: 'unknown' };
}

/** 现行落侧口径版本常量（agent.ts 与回填脚本共用，避免字符串漂移） */
export const EVIDENCE_THIN_RULE = 'relevance' as const;
