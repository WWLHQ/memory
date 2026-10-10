// REQ-012 T6 假引擎：无后端演示用；用 T2 纯逻辑产出 mock 结果（含横幅/预算/异常态）。
import type { BudgetData, ModeBannerData, RetrievalHit, Scene, ModeSel } from './types.ts';
import { autoDispatch, budgetLevel, freshness, resolveSceneBudget, sortHits } from './logic.ts';
import { SEED_HITS } from './seed.ts';

export interface EngineResult {
  hits: RetrievalHit[];
  banner: ModeBannerData;
  budget: BudgetData;
  /** 异常态（§6） */
  evidence_thin: 'none' | 'backfill_hit' | 'backfill_miss';
  breach: boolean;
}

/**
 * 模拟检索：scoring 用 T2 权重思路（demo 简化）；payload 按命中数 × 每条 token 估算。
 * payload>3000 → 硬熔断（R9）；=触发 evidence_thin 的空结果 → 补查 cold（15.3）。
 */
export function fakeEngine(query: string, scene: Scene, modeSel: ModeSel, requestId: string): EngineResult {
  const table = resolveSceneBudget(scene);
  const dispatch = modeSel ? { mode: modeSel, hit_keywords: [] as string[] } : autoDispatch(query, scene);
  const minimal = dispatch.mode === 'minimal';

  // 粗召回：全部种子；极简只取 L3+L4（demo：非 cold 条）
  let hits = minimal ? SEED_HITS.filter((h) => !h.l2_only) : [...SEED_HITS];

  // 打分（demo 简化：关键词命中 ×0.3 + freshness×0.4 + confidence×0.3）
  const kw = query.trim().slice(0, 4);
  hits = hits.map((h) => ({
    ...h,
    score: Math.min(1, (h.content.includes(kw) ? 0.3 : 0) + freshness(h.age_days, h.half_life_days) * 0.4 + h.confidence * 0.3),
  }));
  hits = sortHits(hits);

  const topK = hits.slice(0, 5);
  const payload = topK.reduce((s, h) => s + (h.l2_only ? 120 : 260), 0);
  const breach = budgetLevel(payload) === 'breach';

  // 极简逃生阀（§6）：minimal 且 L4 零命中（demo：hits 为空时走补查）
  let evidence_thin: EngineResult['evidence_thin'] = 'none';
  let cold_recall = false;
  if (topK.length === 0) {
    evidence_thin = 'backfill_hit';
    cold_recall = true;
  }

  const banner: ModeBannerData = {
    scene,
    mode: dispatch.mode,
    fallback: !modeSel,
    hit_keywords: dispatch.hit_keywords,
    secondary_mode_hint: minimal ? null : { mode: 'minimal', note: '≤200t 摘要注入（2.4.3 次模式）' },
    request_id: requestId,
    evidence_thin,
    cold_recall,
  };

  const budget: BudgetData = {
    payload_tokens: payload,
    pipeline_llm_tokens: table.rerank === true ? 640 : 0,
    stage1_count: hits.length,
    stage2_count: topK.length,
    rerank_applied: table.rerank === true,
    budget_breach: budgetLevel(payload) !== 'ok',
    breach_detail: budgetLevel(payload) !== 'ok' ? ['L2 摘要 × 1 条'] : undefined,
  };

  return { hits: topK, banner, budget, evidence_thin, breach };
}
