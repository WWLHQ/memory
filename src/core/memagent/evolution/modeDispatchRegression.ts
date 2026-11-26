// 7.2 读取侧（P2-11）：把 mode_feedback + mode_dispatch + recall 账本行变成「分流修正建议」。
// 边界（2026-11-25 用户拍板口径，见 specs/tasks/MODE-DISPATCH-EVOLUTION.md）：
//  · 窗口 30 天 / 最小有效标注 10 条；有效负样本只认 👎 且 reason='模式选错'；
//     '召回内容不对' 归召回内容质量，不进分流回归；'其它' 只计分母。
//  · 一条建议只动一个模式的一类东西，优先级 remove_words（误判）→ add_words（漏判）→ weight_step。
//    add_words 已于 2026-11-26 解锁：mode_feedback.detail.expected_mode 真写了「用户认为应该分到哪个模式」
//    （方案 MODE-FEEDBACK-TARGET-FIELD.md）；候选词只取已知词表并集，不从自然语言抽词（防伪造证据）。
//    weight_step 属同模式内排序问题，需条目级 rank_wrong 反馈，单独实现。
//  · 本模块是纯函数：不读存储、不写配置；写盘与审计由 loop.ts 负责。
import { DEFAULT_DISPATCH_CONFIG, isConcreteMode, MODE_FEATURE_WORDS, modeWeights, type ConcreteMode } from '../recallModes.ts';
import { MODE_DISPATCH_MODES, normalizeModeDispatch, type ModeDispatchSnapshot } from '../../../shared/growthConfig.ts';
import type { AuditRecord } from '../types.ts';

const DAY_MS = 24 * 3600 * 1000;

/** 特征词表下限：删词后不得少于 3 个（防模式失明）；建议生成与落盘两侧共用同一常量 */
const MIN_FEATURE_WORDS = 3;
/** 特征词表上限：只增不删会撑爆词表，到顶后拒绝 add_words 并提示先做 remove_words */
const MAX_FEATURE_WORDS = 40;

export interface DispatchSample {
  request_id: string;
  ts: number;
  /** 分流建议到的具体模式（mode_dispatch.detail.mode） */
  mode: ConcreteMode;
  verdict: 'up' | 'down';
  reason: string | null;
  /** 原始 query（来自同 request_id 的 recall 审计；缺失时为空串，不参与词证据统计） */
  query: string;
  /** 本次命中的特征词（mode_dispatch.detail.hit_keywords） */
  keywords: string[];
  /** 用户认为「应该分到哪个模式」；仅 👎+模式选错 且账本真写时才非 null（旧账本兼容） */
  expected_mode: ConcreteMode | null;
}

export interface DispatchMetrics {
  /** 窗口内 mode_feedback 行数 */
  feedback: number;
  /** 能关联到 mode_dispatch 且模式可识别、且未过窗口/采纳时间的样本数 */
  linked: number;
  /** 关联不到 mode_dispatch / 模式不可识别而跳过的行数 */
  unlinked: number;
  positives: number;
  negatives: number;
  /** 👎 但原因='召回内容不对'：不进分流回归，只留痕 */
  ignored_content: number;
  /** 👎 但原因缺失/'其它'：只计分母 */
  ignored_other: number;
  /** 有效标注样本 = positives + negatives（阈值判定用这个数） */
  tagged: number;
}

export interface DispatchProposal {
  family: 'mode_dispatch';
  target_mode: ConcreteMode;
  action: 'add_words' | 'remove_words' | 'weight_step';
  changed: Array<{ from: string[]; to: string[] }>;
  reason: string;
  sample_request_ids: string[];
}

type Detail = Record<string, unknown>;
const detailOf = (a: AuditRecord): Detail => (a.detail && typeof a.detail === 'object' ? a.detail as Detail : {});

/** 账本行 → 有效分流样本（窗口 + 采纳时间去重 + 同 request_id 去重） */
export function buildDispatchSamples(
  audits: AuditRecord[],
  opts: { now: number; windowDays: number; since?: number },
): { samples: DispatchSample[]; metrics: DispatchMetrics } {
  const from = opts.now - Math.max(1, opts.windowDays) * DAY_MS;
  const since = opts.since ?? 0;

  const modeByReq = new Map<string, unknown>();
  const kwByReq = new Map<string, string[]>();
  const queryByReq = new Map<string, string>();
  for (const a of audits) {
    if (a.action === 'mode_dispatch') {
      const d = detailOf(a);
      modeByReq.set(a.request_id, d.mode);
      const kw = d.hit_keywords;
      kwByReq.set(a.request_id, Array.isArray(kw) ? kw.filter((w): w is string => typeof w === 'string') : []);
    } else if (a.action === 'recall') {
      const q = detailOf(a).query;
      if (typeof q === 'string') queryByReq.set(a.request_id, q);
    }
  }

  const metrics: DispatchMetrics = {
    feedback: 0, linked: 0, unlinked: 0, positives: 0, negatives: 0,
    ignored_content: 0, ignored_other: 0, tagged: 0,
  };
  const seen = new Set<string>();
  const picked: DispatchSample[] = [];
  for (const a of audits) {
    if (a.action !== 'mode_feedback') continue;
    const d = detailOf(a);
    if (a.ts < from || a.ts <= since) continue;
    metrics.feedback += 1;
    // 同一 request_id 多次点击只算第一次（幂等去重；不拿同一次召回刷样本量）
    if (seen.has(a.request_id)) continue;
    seen.add(a.request_id);
    const mode = modeByReq.get(a.request_id);
    const verdict = d.verdict === 'up' || d.verdict === 'down' ? d.verdict : null;
    if (!isConcreteMode(mode) || !verdict) { metrics.unlinked += 1; continue; }
    const reason = typeof d.reason === 'string' ? d.reason : null;
    const rawExpected = d.expected_mode;
    const sample: DispatchSample = {
      request_id: a.request_id, ts: a.ts, mode, verdict, reason,
      query: queryByReq.get(a.request_id) ?? '', keywords: kwByReq.get(a.request_id) ?? [],
      // 只认 ConcreteMode 合法值；且用户选了同一模式等于没说 → 视为 null，不产 add_words
      expected_mode: isConcreteMode(rawExpected) && rawExpected !== mode ? rawExpected : null,
    };
    if (verdict === 'up') { metrics.positives += 1; metrics.linked += 1; picked.push(sample); continue; }
    if (reason === '模式选错') { metrics.negatives += 1; metrics.linked += 1; picked.push(sample); continue; }
    if (reason === '召回内容不对') { metrics.ignored_content += 1; continue; }
    metrics.ignored_other += 1;
  }
  metrics.tagged = metrics.positives + metrics.negatives;
  picked.sort((x, y) => x.ts - y.ts);
  return { samples: picked, metrics };
}

/**
 * 候选词池 = 所有 ConcreteMode 的已知词表并集 ∪ 现行 growth:v1 快照词表并集。
 * 关键约束：只建议「已经在别的模式词表里、但没在目标模式词表里」的词，即词的归属放错了；
 * 绝不从自然语言 query 抽词——那等于让模型造证据（方案 §3.1）。
 */
export function knownWordPool(current: ModeDispatchSnapshot | null): Set<string> {
  const pool = new Set<string>();
  for (const m of MODE_DISPATCH_MODES) {
    for (const w of MODE_FEATURE_WORDS[m].words) pool.add(w);
    for (const w of MODE_FEATURE_WORDS[m].highConf) pool.add(w);
    const snap = current?.feature_words?.[m];
    if (snap) {
      for (const w of snap.words ?? []) pool.add(w);
      for (const w of snap.high_conf ?? []) pool.add(w);
    }
  }
  return pool;
}

/** add_words：👎+模式选错+用户明确目标模式；候选词必须已在已知词表并集，且 ≥2 条不同 request_id 命中 */
function proposeAddWords(
  samples: DispatchSample[],
  current: ModeDispatchSnapshot | null,
): { proposal: DispatchProposal | null; reason: string } {
  const pool = knownWordPool(current);
  const byTarget = new Map<ConcreteMode, DispatchSample[]>();
  for (const s of samples) {
    if (s.verdict !== 'down' || s.reason !== '模式选错' || !s.expected_mode) continue;
    byTarget.set(s.expected_mode, [...(byTarget.get(s.expected_mode) ?? []), s]);
  }
  const ranked = [...byTarget.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [target, group] of ranked) {
    if (group.length < 2) continue;
    const baseWords: string[] = current?.feature_words?.[target]?.words ?? MODE_FEATURE_WORDS[target].words;
    if (baseWords.length >= MAX_FEATURE_WORDS) {
      return { proposal: null, reason: `${target} 词表已达 ${MAX_FEATURE_WORDS} 词上限，拒绝增词；请先做 remove_words` };
    }
    const own = new Set(baseWords);
    const counts = new Map<string, Set<string>>();
    for (const s of group) {
      // 词必须同时满足：出现在 query、在已知词表并集、不在目标词表里。三缺一都不算。
      const q = s.query;
      for (const w of pool) {
        if (own.has(w) || !q.includes(w)) continue;
        const ids = counts.get(w) ?? new Set<string>();
        ids.add(s.request_id);
        counts.set(w, ids);
      }
    }
    const top = [...counts.entries()]
      .filter(([, ids]) => ids.size >= 2)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
    if (!top) continue;
    const [word, ids] = top;
    const next = [...baseWords, word].sort((a, b) => a.localeCompare(b));
    const rows = group.filter((s) => ids.has(s.request_id));
    return {
      proposal: {
        family: 'mode_dispatch', target_mode: target, action: 'add_words',
        changed: [{ from: [...baseWords], to: next }],
        reason: `${target} 有 ${group.length} 条负样本指向该模式，其中 ${ids.size} 条查询含已知词「${word}」但不在该模式词表，建议增词`,
        sample_request_ids: rows.map((r) => r.request_id),
      },
      reason: '',
    };
  }
  return { proposal: null, reason: '无 ≥2 条同目标模式的有效负样本命中已知词表外溢词，不产 add_words' };
}

/**
 * 产建议：先跑 remove_words（既有逻辑逐字不动），命中直接返回；否则才跑 add_words。
 * 其余情况一律不产建议并写明原因——宁可 insufficient/no_change，也不猜一个目标模式。
 */
export function proposeModeDispatch(
  samples: DispatchSample[],
  current: ModeDispatchSnapshot | null,
): { proposal: DispatchProposal | null; reason: string } {
  const negatives = samples.filter((s) => s.verdict === 'down' && s.reason === '模式选错');
  if (negatives.length === 0) return { proposal: null, reason: '无有效负样本（👎=模式选错），不产建议' };

  const byMode = new Map<ConcreteMode, DispatchSample[]>();
  for (const s of negatives) byMode.set(s.mode, [...(byMode.get(s.mode) ?? []), s]);
  const ranked = [...byMode.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const [target, group] = ranked[0];

  const baseWords: string[] = current?.feature_words?.[target]?.words ?? MODE_FEATURE_WORDS[target].words;
  const highConf = new Set<string>(
    current?.feature_words?.[target]?.high_conf ?? MODE_FEATURE_WORDS[target].highConf,
  );
  const counts = new Map<string, DispatchSample[]>();
  for (const s of group) {
    const hit = new Set(s.keywords.filter((w) => baseWords.includes(w) && !highConf.has(w)));
    for (const w of hit) counts.set(w, [...(counts.get(w) ?? []), s]);
  }
  const top = [...counts.entries()]
    .filter(([, rows]) => rows.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (!top) {
    // remove_words 无命中 → 让 add_words 试（优先级：remove → add → weight_step）
    const added = proposeAddWords(samples, current);
    if (added.proposal) return added;
    return {
      proposal: null,
      reason: `${target} 有 ${group.length} 条负样本，但未集中在单一非高置信特征词上；${added.reason}`,
    };
  }
  const [word, rows] = top;
  const next = baseWords.filter((w) => w !== word);
  if (next.length < MIN_FEATURE_WORDS) return { proposal: null, reason: `${target} 删词后不足 3 个特征词，拒绝改动（防模式失明）` };
  return {
    proposal: {
      family: 'mode_dispatch', target_mode: target, action: 'remove_words',
      changed: [{ from: [...baseWords], to: next }],
      reason: `${target} 的 ${group.length} 条负样本中有 ${rows.length} 条由「${word}」触发，建议删该词`,
      sample_request_ids: rows.map((r) => r.request_id),
    },
    reason: '',
  };
}

/* ── 基线 / 落盘 / 回放（auto 与手动采纳共用同一条路径，避免两套口径） ── */

/**
 * 现行分流快照的「基底」：账本有合法快照就用账本；没有就**以内核基线物化一份**。
 *
 * 为什么不是伪造：三个来源全是内核真源——`DEFAULT_DISPATCH_CONFIG`（30/12/2）、
 * `MODE_FEATURE_WORDS`（五模式词表）、`modeWeights()`（§2.4.3 权重向量，和=1）。
 * 物化出来的快照与内核运行态逐字等价，采纳后只差「被删掉的那一个词」，因此不是猜一个基线，
 * 而是把「当前实际生效的配置」显式落进 growth:v1；`source` 让审计如实区分改动相对谁。
 *
 * 返回 null 只可能是内核基线自己过不了整块校验（真出这种情况就该显式失败，不写半份）。
 */
export function dispatchBaseline(
  current: ModeDispatchSnapshot | null,
): { base: ModeDispatchSnapshot; source: 'ledger' | 'kernel' } | null {
  if (current) return { base: current, source: 'ledger' };
  const feature_words = {} as ModeDispatchSnapshot['feature_words'];
  const mode_weights = {} as ModeDispatchSnapshot['mode_weights'];
  for (const m of MODE_DISPATCH_MODES) {
    const fw = MODE_FEATURE_WORDS[m];
    const w = modeWeights(m);
    feature_words[m] = { words: [...fw.words], high_conf: [...fw.highConf] };
    mode_weights[m] = { w_f: w.f, w_i: w.i, w_c: w.c, w_a: w.a };
  }
  const snap: ModeDispatchSnapshot = {
    min_len_zh: DEFAULT_DISPATCH_CONFIG.minLenZh,
    min_len_en: DEFAULT_DISPATCH_CONFIG.minLenEn,
    hit_threshold: DEFAULT_DISPATCH_CONFIG.hitThreshold,
    feature_words, mode_weights,
  };
  return normalizeModeDispatch(snap) ? { base: snap, source: 'kernel' } : null;
}

/**
 * 把一条建议落到基底上（只改目标模式的词表），再走 `normalizeModeDispatch` 整块校验。
 * 校验失败返回 null —— 调用方必须整单拒绝，绝不写半份。
 */
export function applyDispatchProposal(
  base: ModeDispatchSnapshot,
  proposal: DispatchProposal,
): ModeDispatchSnapshot | null {
  const nextWords = proposal.changed[0]?.to;
  if (!Array.isArray(nextWords)) return null;
  // 「删后不足 3 个特征词」的防线在这里再守一次：建议生成侧已经拦过，
  // 但手动采纳读的是**账本审计**，账本被手改过也必须拦住（防模式失明）。
  if (nextWords.length < MIN_FEATURE_WORDS) return null;
  const cur = base.feature_words[proposal.target_mode];
  if (!cur) return null;
  return normalizeModeDispatch({
    ...base,
    feature_words: {
      ...base.feature_words,
      [proposal.target_mode]: { words: [...nextWords], high_conf: [...cur.high_conf] },
    },
  });
}

/**
 * 审计回放校验：`suggest_mode_dispatch` 审计里的 dispatch 块是否可被采纳。
 * 手动采纳**只认审计里真实存在的建议**（绝不现场现算），因此这里必须真校验形状，
 * 而不是凭 `dispatch` 字段存在就当有效。
 */
const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

export function validDispatchProposal(v: unknown): v is DispatchProposal {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r.family !== 'mode_dispatch') return false;
  // 形状严格校验：只放行已知三类动作；weight_step 虽有枚举但当前不产，回放遇到也认形状（提示后续处理）
  if (r.action !== 'remove_words' && r.action !== 'add_words' && r.action !== 'weight_step') return false;
  if (!isConcreteMode(r.target_mode)) return false;
  if (typeof r.reason !== 'string' || r.reason.length === 0) return false;
  if (!Array.isArray(r.sample_request_ids) || !r.sample_request_ids.every((x) => typeof x === 'string')) return false;
  if (!Array.isArray(r.changed) || r.changed.length === 0) return false;
  return r.changed.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const ch = c as Record<string, unknown>;
    return isStrArr(ch.from) && isStrArr(ch.to);
  });
}

/* ── 采纳后回诊（方案 MODE-DISPATCH-ROLLBACK.md，2026-11-26）── */

/** 命中率 = 👍 /(👍 + 👎且模式选错)，直接复用 DispatchMetrics 的 positives/negatives，不另写第二套 */
export function dispatchHitRate(m: DispatchMetrics): number | null {
  return m.tagged > 0 ? m.positives / m.tagged : null;
}

/**
 * 采纳时刻算死的回诊计划（写进 growth_op.adopted.rollback_plan）。
 * 基线样本不足（tagged < min_tagged）→ 返回 null，如实「不挂计划」，不猜一个 baseline_rate。
 */
export interface DispatchRollbackPlan {
  family: 'mode_dispatch';
  adopted_ts: number;
  due_at: number;
  baseline_rate: number;
  baseline_tagged: number;
  min_tagged: number;
  max_drop: number;
  /** 采纳后的整份快照：回诊时逐字比对，配置已被后续采纳替换则跳过，不回滚旧的 */
  adopted_words_snapshot: ModeDispatchSnapshot;
}
export function computeDispatchRollbackPlan(
  now: number,
  before: DispatchMetrics,
  opts: { afterDays: number; minTagged: number; maxDrop: number; snapshot: ModeDispatchSnapshot },
): DispatchRollbackPlan | null {
  const rate = dispatchHitRate(before);
  if (rate === null || before.tagged < opts.minTagged) return null;
  return {
    family: 'mode_dispatch', adopted_ts: now, due_at: now + Math.max(1, opts.afterDays) * DAY_MS,
    baseline_rate: rate, baseline_tagged: before.tagged,
    min_tagged: opts.minTagged, max_drop: opts.maxDrop,
    adopted_words_snapshot: opts.snapshot,
  };
}

export type DispatchBackfillStatus = 'insufficient' | 'kept' | 'rolled_back';

/**
 * 回诊三态（推荐判据 C）：drop > max_drop 且 negatives 净增 ≥3 才回滚。
 * before/after 的 negatives 都来自 DispatchMetrics；最小净负样本数是抗单条翻转的工程保守阈值。
 */
export function computeDispatchBackfill(
  before: DispatchMetrics,
  after: DispatchMetrics,
  maxDrop: number,
): { status: DispatchBackfillStatus; before_rate: number | null; after_rate: number | null; drop: number; negative_growth: number } {
  const beforeRate = dispatchHitRate(before);
  const afterRate = dispatchHitRate(after);
  const drop = beforeRate !== null && afterRate !== null ? beforeRate - afterRate : 0;
  const negativeGrowth = after.negatives - before.negatives;
  if (beforeRate === null || afterRate === null) return { status: 'kept', before_rate: beforeRate, after_rate: afterRate, drop: 0, negative_growth: negativeGrowth };
  if (drop > maxDrop + 1e-9 && negativeGrowth >= 3) {
    return { status: 'rolled_back', before_rate: beforeRate, after_rate: afterRate, drop, negative_growth: negativeGrowth };
  }
  return { status: 'kept', before_rate: beforeRate, after_rate: afterRate, drop, negative_growth: negativeGrowth };
}
