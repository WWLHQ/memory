// 五维查重（§6.1）：语义 35% / 关键词 20% / 实体 15% / 结构 10% / LLM 仲裁 20%。
// 逐层阈值见 layerRules.DEDUP_THRESHOLDS；无真实 LLM → 四维归一化（去掉仲裁权重）。
import { cosine, embedSync } from './vector.ts';
import {
  DEDUP_THRESHOLDS, DEDUP_WEIGHTS, DEDUP_WEIGHTS_NO_LLM,
  type RefineLayer,
} from './layerRules.ts';
import type { LlmProvider, Memory } from './types.ts';

export interface DimensionScores {
  semantic: number;
  keyword: number;
  entity: number;
  structure: number;
  judge?: number;
}

export interface DedupEvaluation {
  mem: Memory;
  text: string;
  score: number;
  dims: DimensionScores;
  judge: 'llm' | 'unavailable';
}

export interface DedupOutcome {
  best: DedupEvaluation | null;
  evaluated: number;
  threshold: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 层文本：候选必须真实存有该层内容，不以其它层冒充（§2.2 不变量 6） */
export function layerText(m: Memory, level: RefineLayer): string | undefined {
  const key = `content_${level.toLowerCase()}` as keyof Memory;
  const v = m[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

/** 关键词集合：英文/数字词 + 中文 2-gram（去常见停用词） */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were', 'have', 'has', 'not',
  '一个', '我们', '可以', '需要', '就是', '然后', '因为', '所以', '但是', '如果', '这个', '那个', '以及',
]);

export function keywordSet(text: string): Set<string> {
  const out = new Set<string>();
  const lower = (text ?? '').toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) {
    if (!STOP.has(m[0])) out.add(m[0]);
  }
  for (const m of lower.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) { out.add(run); continue; }
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!STOP.has(bg)) out.add(bg);
    }
  }
  return out;
}

/** 实体集合：错误码/状态码、配置键、数字+单位、引号标识、域名（技术内容的硬锚点） */
export function entitySet(text: string): Set<string> {
  const out = new Set<string>();
  const t = text ?? '';
  for (const m of t.matchAll(/\b[A-Z][A-Z0-9_]{1,}(?:[-_]\d+)?\b/g)) out.add(m[0]);
  for (const m of t.matchAll(/\b[a-z][a-z0-9_]{2,}\s*=/g)) out.add(m[0].replace(/\s*=$/, ''));
  for (const m of t.matchAll(/\b\d+(?:\.\d+)?(?:ms|s|kb|mb|gb|tb|%|px|t)?\b/gi)) out.add(m[0].toLowerCase());
  for (const m of t.matchAll(/`([^`]{2,40})`|"([^"]{2,40})"|「([^」]{2,40})」/g)) {
    const v = m[1] ?? m[2] ?? m[3];
    if (v) out.add(v.trim());
  }
  for (const m of t.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi)) out.add(m[0].toLowerCase());
  return out;
}

/** 结构形态：行数/长度/代码块/列表/数字密度 */
function shape(text: string): number[] {
  const t = text ?? '';
  const lines = Math.min(20, t.split('\n').length) / 20;
  const len = Math.min(1, Math.log2(t.length + 1) / 12);
  const code = /(^|\n)\s*(```|const |let |function |def |class |SELECT |import )/.test(t) ? 1 : 0;
  const list = /(^|\n)\s*(?:[-*]|\d+\.)\s/.test(t) ? 1 : 0;
  const nums = Math.min(10, (t.match(/\d+/g) ?? []).length) / 10;
  return [lines, len, code, list, nums];
}

export function structuralSimilarity(a: string, b: string): number {
  const sa = shape(a);
  const sb = shape(b);
  const diff = sa.reduce((acc, v, i) => acc + Math.abs(v - sb[i]), 0) / sa.length;
  return clamp01(1 - diff);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 四维基础分（归一化到 0–1，不含 LLM 仲裁） */
export function baseDimensionScores(a: string, b: string, dim: number): DimensionScores {
  return {
    semantic: clamp01(cosine(embedSync(a, dim), embedSync(b, dim))),
    keyword: clamp01(jaccard(keywordSet(a), keywordSet(b))),
    entity: clamp01(jaccard(entitySet(a), entitySet(b))),
    structure: structuralSimilarity(a, b),
  };
}

export function fourDimScore(d: DimensionScores): number {
  return clamp01(
    d.semantic * DEDUP_WEIGHTS_NO_LLM.semantic
    + d.keyword * DEDUP_WEIGHTS_NO_LLM.keyword
    + d.entity * DEDUP_WEIGHTS_NO_LLM.entity
    + d.structure * DEDUP_WEIGHTS_NO_LLM.structure,
  );
}

export function fiveDimScore(d: DimensionScores): number {
  return clamp01(
    d.semantic * DEDUP_WEIGHTS.semantic
    + d.keyword * DEDUP_WEIGHTS.keyword
    + d.entity * DEDUP_WEIGHTS.entity
    + d.structure * DEDUP_WEIGHTS.structure
    + (d.judge ?? 0) * DEDUP_WEIGHTS.judge,
  );
}

/** top-N 候选先按四维排序，再交给 LLM 仲裁（§6.1） */
export const JUDGE_TOP_N = 3;

export interface DedupOptions {
  dim: number;
  request_id: string;
  llm?: LlmProvider;
  model?: string;
}

/**
 * 在候选集中找最佳重复项。
 * - 候选必须同 project、未删除、真实存有该层内容（调用方先过滤 project/deleted）
 * - 无真实 LLM / 未实现 judgeDuplicate → 四维归一化
 * - LLM 仲裁只对四维 Top-3 调用，失败回退四维
 */
export async function findDuplicate(
  text: string,
  level: RefineLayer,
  candidates: Memory[],
  opts: DedupOptions,
): Promise<DedupOutcome> {
  const threshold = DEDUP_THRESHOLDS[level];
  const scored: DedupEvaluation[] = [];
  for (const m of candidates) {
    if (m.deleted) continue;
    const ct = layerText(m, level);
    if (!ct) continue;
    const dims = baseDimensionScores(text, ct, opts.dim);
    scored.push({ mem: m, text: ct, dims, score: round3(fourDimScore(dims)), judge: 'unavailable' });
  }
  if (scored.length === 0) return { best: null, evaluated: 0, threshold };

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, JUDGE_TOP_N);

  const canJudge = Boolean(
    opts.llm && opts.llm.isStub === false && opts.model && typeof opts.llm.judgeDuplicate === 'function',
  );
  if (canJudge) {
    for (const cand of top) {
      try {
        const raw = await opts.llm!.judgeDuplicate!(opts.model!, text, cand.text, {
          request_id: opts.request_id, usage: 'judge',
        });
        cand.dims.judge = clamp01(raw);
        cand.score = round3(fiveDimScore(cand.dims));
        cand.judge = 'llm';
      } catch {
        // 仲裁失败 → 保持四维分（不阻断写入）
      }
    }
  }

  top.sort((a, b) => b.score - a.score);
  return { best: top[0] ?? null, evaluated: scored.length, threshold };
}
