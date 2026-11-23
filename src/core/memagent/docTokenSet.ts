// P1-8′（2026-11-23）：召回热路径的正文 tokenSet 进程内缓存。
//
// 背景（现查实测，见 specs/reports/p1-6-7-8-reevaluation-2026-11-23.md）：
//   query embed 0.002ms、全库 cosine 1ms，而 agent.ts 对每条候选执行
//   `new Set(tokenize(m.content))` 在 5686 条账本上要 242ms——这才是延迟大头。
//   原 P1-8 方案缓存 qvec 是把对象搞反了，本模块缓存「每条记忆正文的 token 集合」。
//
// 语义等价红线（B 闸门）：缓存只改变「token 从哪儿来」，不改变 token 本身。
//   · 分词函数仍直接调用 vector.ts 的 tokenize（与召回/高亮同一真源），不复制、不改写；
//   · 失效判据用**完整正文字符串相等**（比 32 位哈希更强：哈希碰撞会静默改分，这里不可能）；
//     正文字符串是引用，缓存一条只多存一个指针，不复制大文本；
//   · key = mem_id，不同记忆互不污染；写后立刻召回时正文变了 → 命中不等 → 重算。
//
// 容量：进程内无界增长会累积历史写入的 tokenSet，设硬上限，超了整表清空（只影响性能，
// 不影响结果——下次访问按正文重算）。上限按 2 万条（现网 5686 条的 3.5 倍）留余量。

import { tokenize } from './vector.ts';

const MAX_ENTRIES = 20_000;

interface CacheEntry {
  /** 缓存时的正文原文；用引用比较即可（字符串不可变） */
  content: string;
  tokens: Set<string>;
}

const cache = new Map<string, CacheEntry>();

/**
 * 取一条记忆正文的 token 集合（与 `new Set(tokenize(content))` 逐元素一致）。
 * 命中缓存直接返回同一个 Set；正文变化（写入/编辑后）自动失效重算。
 */
export function docTokenSet(mem_id: string, content: string): Set<string> {
  const cached = cache.get(mem_id);
  if (cached && cached.content === content) return cached.tokens;

  const tokens = new Set(tokenize(content));
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(mem_id, { content, tokens });
  return tokens;
}

/** 仅供测试/进程重置使用：清空缓存，不影响任何持久化状态。 */
export function clearDocTokenCache(): void {
  cache.clear();
}

/** 仅供测试/观测使用：当前缓存条数。 */
export function docTokenCacheSize(): number {
  return cache.size;
}
