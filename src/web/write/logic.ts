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

/** 写入页正文计数上限（定稿 300 字）。内核 L1 规格当前 maxChars=null（不限长），界面只做提示，不据此拦截。 */
export const L1_CHAR_LIMIT = 300;

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

/** 标签联想停用词：纯功能词/通用域，不配当标签 */
const TAG_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were', 'not', 'you', 'your',
  'can', 'could', 'should', 'would', 'all', 'any', 'when', 'then', 'than', 'will', 'have', 'has',
  'had', 'into', 'onto', 'its', 'their', 'our', 'out', 'about', 'there', 'here', 'been', 'being',
  'over', 'under', 'after', 'before', 'because', 'while', 'also', 'just', 'only', 'very',
  'www', 'com', 'cn', 'http', 'https', 'localhost',
]);

/**
 * 标签联想（修复轮2）：从写入内容本地提取候选标签——不预置词表、不经大模型。
 * 规则：抽英文/技术 token（≥3 字符，含 .+#- 等技术记号），剥掉首尾连接符，
 * 停用词过滤、大小写去重、排除已选标签，按出现顺序最多 max 个。
 */
export function suggestTagsFromContent(content: string, existing: readonly string[] = [], max = 8): string[] {
  const tokens = content.match(/[A-Za-z][A-Za-z0-9_.+#/-]{2,}/g) || [];
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.replace(/^[_.+#/-]+/, '').replace(/[_.+#/-]+$/, '');
    if (t.length < 3) continue;
    const key = t.toLowerCase();
    if (TAG_STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
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
  /** 内核真实签发的 request_id（回执必须展示真实值，不补造） */
  requestId?: string;
  /** 内核返回的真实 mem_id */
  memoryId?: string;
  /** 回执落定时间（ISO；页面记录本次真实提交时刻） */
  createdAt?: string;
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
  _content: string,
  dedupAction: WriteReceipt['dedup_action'] = 'create',
  opts: ReceiptOptions = {},
): WriteReceipt {
  // 不补造 mem_id：内核没返回就留空，界面显示「—」（filtered 未入库时本来就没有）
  const memory_id = opts.memoryId ?? '';
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
  return {
    request_id: opts.requestId ?? '',
    memory_id,
    created_at: opts.createdAt ?? new Date().toISOString(),
    layers,
    dedup_action: dedupAction,
    refined_by,
  };
}

function round2(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}
