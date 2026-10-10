// 写入页（REQ-006 / P2）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type {
  DedupResult, ExistingMemory, LayerName, MemoryDraft, ValidationResult, WriteReceipt,
} from './types.ts';
import { LAYER_THRESHOLDS } from './seed.ts';

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
 * 查重评分（6.1 五维）：composite = 0.35*semantic + 0.20*keyword + 0.15*entity + 0.10*structure + 0.20*llm_judge
 * 相似度 s 越高各维越高；is_duplicate = composite ≥ 该层阈值。
 */
export function scoreDedup(
  content: string,
  existing: ExistingMemory[],
  layer: LayerName = 'L3',
): DedupResult {
  const threshold = LAYER_THRESHOLDS[layer];
  const best = existing
    .map((e) => ({ e, s: jaccard(content, e.content) }))
    .sort((a, b) => b.s - a.s)[0];

  const s = best ? best.s : 0;
  const dims = {
    semantic: round2(s * 0.9 + 0.05),
    keyword: round2(s * 0.8 + 0.1),
    entity: round2(s * 0.7),
    structure: round2(s * 0.6 + 0.1),
    llm_judge: round2(s * 0.85),
  };
  const composite = round2(
    dims.semantic * 0.35 + dims.keyword * 0.2 + dims.entity * 0.15 + dims.structure * 0.1 + dims.llm_judge * 0.2,
  );
  return {
    dims,
    composite,
    threshold,
    is_duplicate: composite >= threshold,
    matched: best && best.s > 0 ? best.e : undefined,
  };
}

/** 六维阈值（6.1 阈值表 L1 0.7…L6 0.9） */
export function thresholdForLayer(layer: LayerName): number {
  return LAYER_THRESHOLDS[layer];
}

/** 写入回执（13.6）：memory_id + L1–L6 逐层（L1 仅审计展开，15.3） */
export function composeReceipt(content: string, dedupAction: WriteReceipt['dedup_action'] = 'create'): WriteReceipt {
  const memory_id = `mem_${Math.abs(hash(content))}`;
  const layers = {} as WriteReceipt['layers'];
  (['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as LayerName[]).forEach((ln) => {
    layers[ln] = {
      summary: ln === 'L1' ? 'L1 原文（仅审计展开）' : `第 ${ln} 层精炼摘要`,
      auditOnly: ln === 'L1',
    };
  });
  return { memory_id, layers, dedup_action: dedupAction };
}

function round2(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
