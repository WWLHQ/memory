// VectorBackend（§5.2）：JsVectorBackend 起步实现（hash bag-of-words + cosine）；
// RustWasmVectorBackend 为性能层，接口同构、切换无感（19.11 结论 2）—— 契约级用 JS 实现演示可替换性。
import { MemAgentError } from './errors.ts';
import type { Filter, Scored, VectorBackend } from './types.ts';

const DIM = 64;

function hashToken(tok: string): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIM;
}

export function embedSync(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  for (const tok of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    vec[hashToken(tok)] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // 归一化后 dot = cosine
}

export class JsVectorBackend implements VectorBackend {
  private index = new Map<string, { vec: number[]; filter: Filter }>();

  async embed(texts: string[]): Promise<number[][]> {
    try {
      return texts.map(embedSync);
    } catch (e) {
      throw new MemAgentError('E_VECTOR', '向量后端报错', { cause: String(e) });
    }
  }

  /** 建索引：内核在 write 后调用（演示用内存倒排） */
  async upsert(mem_id: string, text: string, filter: Filter): Promise<void> {
    this.index.set(mem_id, { vec: embedSync(text), filter });
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
