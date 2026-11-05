// VectorBackend（§5.2）当前唯一生产实现：JsVectorBackend（hash bag-of-words + cosine）。
// 接口可插拔，但规格 §5.2 / 19.11 结论 2 规划的 Rust/WASM 性能层尚未实现，不得写成现状。
// 这是内存里的可丢弃索引（进程重启为空，由写入/补炼/重建路径按需 upsert）；语义召回的真依据是
// 行上 embedding（§2.2 不变量 7），索引缺失不等于知识缺失 —— 冷压缩可安全清掉冷层副本。
import { MemAgentError } from './errors.ts';
import type { Filter, Scored, VectorBackend } from './types.ts';

/** 默认嵌入维度（JS 起步实现）；模型配置页可指定维度，内核据此构造后端 */
export const DEFAULT_VECTOR_DIM = 64;

function hashToken(tok: string, dim: number): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % dim;
}

/** 分词：英文按词、中文按 2-gram（中文整句单 token 会让向量无法区分） */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const seg of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (/[\u4e00-\u9fff]/.test(seg)) {
      for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
      if (seg.length === 1) tokens.push(seg);
    } else {
      tokens.push(seg);
    }
  }
  return tokens;
}

export function embedSync(text: string, dim: number = DEFAULT_VECTOR_DIM): number[] {
  if (!Number.isInteger(dim) || dim <= 0) throw new MemAgentError('E_VECTOR', `非法向量维度：${dim}`);
  // oxlint-disable-next-line unicorn/no-new-array -- 定长零向量属热路径，Array.from 会多一层回调开销
  const vec = new Array<number>(dim).fill(0);
  for (const tok of tokenize(text)) {
    vec[hashToken(tok, dim)] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  // 维度不一致（换了模型但旧向量未重建）→ 不可比，按 0 分处理，避免 NaN 污染排序
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // 归一化后 dot = cosine
}

export class JsVectorBackend implements VectorBackend {
  /** 实际嵌入维度（模型配置页保存的 dims 会注入到这里） */
  readonly dim: number;
  private index = new Map<string, { vec: number[]; filter: Filter }>();

  constructor(dim: number = DEFAULT_VECTOR_DIM) {
    if (!Number.isInteger(dim) || dim <= 0) throw new MemAgentError('E_VECTOR', `非法向量维度：${dim}`);
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    try {
      return texts.map((t) => embedSync(t, this.dim));
    } catch (e) {
      throw new MemAgentError('E_VECTOR', '向量后端报错', { cause: String(e) });
    }
  }

  /** 建索引：内核在 write 后调用。按 mem_id 存 (向量, filter)，search 时全表 cosine 扫描后排序取 top-k；
   *  不是倒排索引，也不持久化（可丢弃索引，见文件头说明）。 */
  async upsert(mem_id: string, text: string, filter: Filter): Promise<void> {
    this.index.set(mem_id, { vec: embedSync(text, this.dim), filter });
  }

  async remove(mem_id: string): Promise<void> {
    this.index.delete(mem_id);
  }

  async search(vec: number[], k: number, filter: Filter): Promise<Scored[]> {
    const scored: Scored[] = [];
    for (const [mem_id, entry] of this.index) {
      if (filter.project_id && entry.filter.project_id !== filter.project_id) continue;
      if (filter.layer && entry.filter.layer !== filter.layer) continue;
      if (filter.decay_class && entry.filter.decay_class !== filter.decay_class) continue;
      scored.push({ mem_id, score: cosine(vec, entry.vec) });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
