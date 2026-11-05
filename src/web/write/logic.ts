// 写入页（REQ-006 / P2）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type {
  DedupResult, ExistingMemory, LayerName, MemoryDraft, ValidationResult, WriteReceipt,
} from './types.ts';
import { LAYER_THRESHOLDS } from './spec.ts';

/** 估算 token（展示用）：CJK ≈ 2 token/字，其它字符 ≈ 1.3 token/词 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const other = (text.replace(/[一-鿿\s]/g, '').match(/[a-zA-Z0-9]+/g) || []).length;
  return Math.round(cjk * 2 + other * 1.3);
}

/** ≥500 字（CJK 计字，其它计词）触发「将精炼为 L1–L6」（§2.2） */
export function needsRefine(content: string): boolean {
  const units = (content.match(/[一-鿿]/g) || []).length + (content.trim().match(/[a-zA-Z0-9]+/g) || []).length;
  return units >= 500;
}

/** 表单校验（§P2）：content 非空 + project_id 必填（R2 禁空） */
export function validateDraft(d: MemoryDraft): ValidationResult {
  const errors: string[] = [];
  if (d.content.trim().length < 1) errors.push('内容不能为空');
  if (!d.project_id || d.project_id.trim().length === 0) errors.push('project_id 必填（全局注入，不可为空）');
  return { ok: errors.length === 0, errors };
}

function tokenize(s: string): string[] {
  return (s.match(/[一-鿿]|[a-zA-Z0-9]+/g) || []).map((x) => x.toLowerCase());
}

/** Jaccard 相似度（纯函数，便于测试） */
export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 查重预览（批次25 P0-3）：只报本地词面相似度这一个真实可算的数。
 * 旧的「五维 + 综合分」是同一个 Jaccard 的五次仿射变换（含未接大模型却展示 llm_judge），已删除。
 * 真正判重（语义/关键词/实体/结构 四维 + 逐层阈值）由内核 `src/core/memagent/dedup.ts` 在提交时执行；
 * 对照层默认 L1 —— 未接入大模型时内核只对 L1 查重。
 */
export function scoreDedup(
  content: string,
  existing: ExistingMemory[],
  layer: LayerName = 'L1',
): DedupResult {
  const threshold = LAYER_THRESHOLDS[layer];
  const best = content.trim().length === 0
    ? undefined
    : existing
      .map((e) => ({ e, s: jaccard(content, e.content) }))
      .sort((a, b) => b.s - a.s)[0];

  const score = round2(best ? best.s : 0);
  return {
    score,
    layer,
    threshold,
    is_duplicate: score >= threshold,
    matched: best && best.s > 0 ? best.e : undefined,
  };
}

/** 该层查重阈值（内核单一真源 layerRules.DEDUP_THRESHOLDS） */
export function thresholdForLayer(layer: LayerName): number {
  return LAYER_THRESHOLDS[layer];
}

export interface ReceiptOptions {
  /** 内核返回的真实 mem_id */
  memoryId?: string;
  /** 内核真实产出的层（未接入 LLM 时仅 content_l1） */
  layers?: Record<string, string>;
  refinedBy?: 'stub' | 'llm' | 'llm_partial';
}

const LAYER_FIELD: Record<LayerName, string> = {
  L1: 'content_l1', L2: 'content_l2', L3: 'content_l3',
  L4: 'content_l4', L5: 'content_l5', L6: 'content_l6',
};
const LAYERS: LayerName[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

/**
 * 写入回执（13.6）：只展示内核真实产出的层。
 * 未接入 LLM 时 L1 有值，L2–L6 明确标「未精炼（未接入 LLM）」，不再编造摘要。
 */
export function composeReceipt(
  content: string,
  dedupAction: WriteReceipt['dedup_action'] = 'create',
  opts: ReceiptOptions = {},
): WriteReceipt {
  const memory_id = opts.memoryId ?? `mem_${Math.abs(hash(content))}`;
  const refined_by = opts.refinedBy ?? 'stub';
  // 阶段5-E / B10：内核不存在 merge 动作，只有 duplicated→keep 会不新建层。
  const noNewLayers = dedupAction === 'keep';
  const layers = {} as WriteReceipt['layers'];
  for (const ln of LAYERS) {
    const real = opts.layers?.[LAYER_FIELD[ln]];
    const produced = !noNewLayers && typeof real === 'string' && real.trim().length > 0;
    let summary: string;
    if (produced) {
      summary = ln === 'L1'
        ? (dedupAction === 'graft'
          ? 'L1 清洗脱敏（已分支嫁接到既有记忆，原文仅审计展开）'
          : 'L1 清洗脱敏（原文仅审计展开，15.3）')
        : `${ln} 真实精炼产物`;
    } else if (noNewLayers) {
      summary = ln === 'L1' ? '已保留原记忆（本次未新建层）' : '本次未新建层';
    } else {
      summary = ln === 'L1' ? '未产出（未入库或被质量门拦截）' : '未精炼（未接入 LLM）';
    }
    layers[ln] = {
      summary,
      produced,
      auditOnly: ln === 'L1' && produced,
      text: ln === 'L1' ? undefined : (produced ? real : undefined),
    };
  }
  return { memory_id, layers, dedup_action: dedupAction, refined_by };
}

function round2(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
