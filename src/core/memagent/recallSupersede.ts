// REQ-014 / T1（C6-A）：合并影子的「以最新为准」补带。
//
// 背景（为什么不是「命中影子再补带」）：`forgetting.ts:hardFilter` 在最前面就排除
// `merged_into` 影子（且排在 pinned 免检之前），主召回 / 次模式池 / 项目背景 / 会话视图
// 四条取数路径全部过滤。也就是说影子**永远不会出现在 hits 里**，字面意义上的
// 「命中影子 → 补带目标」在现有治理下没有触发点。
//
// 本模块的语义：影子继续不注入、不进候选，只把它的向量当作「用户问的是这件旧事」的探测器。
// query 与影子相似度达到强信号阈值（与 2.4.3 冷回填逃生阀同为 0.85）时，把它 `merged_into`
// 指向的目标记忆（即合并后的最新版）作为派生必带项补进命中，并打 `superseded` 标记。
// 没有影子命中时，本模块不产出任何东西 —— 既有行为逐字不变。
//
// 边界：
// - 只读，不写库、不改审计口径；
// - 不碰 `recallModes.ts` / `growthConfig.ts`（模式与权重单一真源）；
// - 补带项仍需走调用方的硬熔断（3000t）与分层禁用规则，不得绕开预算。

import type { Hit, Memory } from './types.ts';

/** 影子探测的强信号阈值：与 2.4.3 冷回填逃生阀同一口径（sim ≥ 0.85） */
export const SUPERSEDE_PROBE_MIN_SIM = 0.85;

/** 单次召回最多补带几条「最新版」——超过就是噪音，不是提醒 */
export const SUPERSEDE_MAX_EXTRA_HITS = 2;

/** 一次影子探测的产出：影子是谁、目标是谁、强到什么程度 */
export interface SupersedeProbe {
  /** 被命中的合并影子（不注入，只作为触发源） */
  shadow_id: string;
  /** 影子合并进的目标记忆（最新版，可能被补带） */
  target_id: string;
  /** query 与影子的余弦相似度 */
  sim: number;
}

export interface SupersedeProbeArgs {
  queryVec: number[];
  /** 全量记忆（**含**影子；影子靠 merged_into 识别） */
  memories: readonly Memory[];
  cosine: (a: number[], b: number[]) => number;
  /**
   * 完全不参与补带的 id（例如已作为次模式 hint 下发、再补带就是重复注入）。
   * 注意：**不要**把「已在命中里的目标」放进来——那种情况要由 mergeSupersededHits
   * 打上 superseded 标（正文/分数不变），而不是干脆不提。
   */
  excludeIds: ReadonlySet<string>;
  /** 手动模式禁用的层：目标落在这些层时不补带（不得绕开分层裁剪） */
  disabledLayers?: readonly string[];
  minSim?: number;
  limit?: number;
}

/**
 * 纯函数：用 query 向量探测「被合并的旧记录」，产出应补带的最新版目标。
 *
 * 判定顺序（任一不满足即跳过，不臆造补带）：
 * 1. 影子：`merged_into` 非空、未 deleted、有 embedding；
 * 2. 强信号：sim ≥ minSim；
 * 3. 目标可读：目标存在、未 deleted、本身不是影子（不链式追）；
 * 4. 目标不在 excludeIds、不在 disabledLayers；
 * 5. 同一目标被多个影子命中时取最高 sim，按 sim 降序截断。
 */
export function probeSupersededTargets(args: SupersedeProbeArgs): SupersedeProbe[] {
  const minSim = args.minSim ?? SUPERSEDE_PROBE_MIN_SIM;
  const limit = args.limit ?? SUPERSEDE_MAX_EXTRA_HITS;
  const disabled = new Set(args.disabledLayers ?? []);
  const byId = new Map<string, Memory>();
  for (const m of args.memories) byId.set(m.mem_id, m);

  // 同一目标多处命中只留最高分：目标是「最新版」，带一条就够
  const best = new Map<string, SupersedeProbe>();
  for (const shadow of args.memories) {
    const targetId = shadow.merged_into;
    if (!targetId) continue;
    if (shadow.deleted) continue;
    if (!shadow.embedding || shadow.embedding.length === 0) continue;
    const target = byId.get(targetId);
    // 目标不可读 / 目标自己也是影子（合并链）→ 不补带，避免把半成品当最新版
    if (!target || target.deleted || target.merged_into) continue;
    if (args.excludeIds.has(targetId)) continue;
    if (disabled.has(target.layer)) continue;
    const sim = args.cosine(args.queryVec, shadow.embedding);
    if (!Number.isFinite(sim) || sim < minSim) continue;
    const prev = best.get(targetId);
    if (!prev || sim > prev.sim) {
      best.set(targetId, { shadow_id: shadow.mem_id, target_id: targetId, sim });
    }
  }
  return [...best.values()]
    .sort((a, b) => (b.sim - a.sim) || a.target_id.localeCompare(b.target_id))
    .slice(0, Math.max(0, limit));
}

export interface SupersedeHitArgs {
  target: Memory;
  probe: SupersedeProbe;
  /** 该条的记忆分数（由调用方用同一套 scoreMemory 算，口径不另立） */
  score: number;
  matched_terms: string[];
}

/**
 * 把探测到的目标构造成一条命中：正文用目标自身内容（不拼接、不改写），
 * 只额外带 `superseded` 标记与触发它的影子 id，供回显加中性标注。
 */
export function buildSupersedeHit(args: SupersedeHitArgs): Hit {
  const { target, probe } = args;
  return {
    mem_id: target.mem_id,
    content: target.content,
    layer: target.layer,
    decay_class: target.decay_class,
    pinned: target.pinned,
    locked: target.locked,
    score: Math.round(args.score * 1000) / 1000,
    evidence_ref: `l0:${target.mem_id}`,
    matched_terms: args.matched_terms,
    superseded: true,
    superseded_from: [probe.shadow_id],
    ...(target.merged_from?.length ? { merged_from_count: target.merged_from.length } : {}),
    ...(target.source_excerpt ? { source_excerpt: target.source_excerpt } : {}),
  };
}

/**
 * 合并补带项：已在命中里的目标不重复追加（只补 `superseded_from` 溯源），
 * 其余按传入顺序追加到尾部。返回新增条数，供调用方决定是否重算预算。
 */
export function mergeSupersededHits(
  hits: readonly Hit[],
  extras: readonly Hit[],
): { hits: Hit[]; added: number } {
  const out = [...hits];
  const index = new Map<string, number>();
  out.forEach((h, i) => index.set(h.mem_id, i));
  let added = 0;
  for (const extra of extras) {
    const at = index.get(extra.mem_id);
    if (at === undefined) {
      index.set(extra.mem_id, out.length);
      out.push(extra);
      added += 1;
      continue;
    }
    // 目标本来就被直接命中：只补溯源与标注，不改正文/分数/顺序
    const exist = out[at];
    const from = new Set([...(exist.superseded_from ?? []), ...(extra.superseded_from ?? [])]);
    out[at] = {
      ...exist,
      superseded: true,
      superseded_from: [...from],
      ...(exist.merged_from_count === undefined && extra.merged_from_count !== undefined
        ? { merged_from_count: extra.merged_from_count }
        : {}),
    };
  }
  return { hits: out, added };
}

/**
 * 命中卡的中性标注（只读标记，不改正文）：
 * - 补带/合并目标：说明「本条是最新版」；
 * - 普通命中：无标注（返回 null）。
 * 文案一处在真源，回显/明细页/纯文本三处都读它，避免各写一份话术。
 */
export function supersedeNote(hit: Hit): string | null {
  if (!hit.superseded) return null;
  const from = hit.superseded_from ?? [];
  if (from.length === 0) return '⮕ 本条为合并后的最新版，以本条为准';
  const merged = hit.merged_from_count ?? 0;
  const absorbed = merged > 0 ? `吸收 ${merged} 条旧记录` : '由旧记录合并而来';
  return `⮕ 本条为合并后的最新版（${absorbed}），以本条为准`;
}
