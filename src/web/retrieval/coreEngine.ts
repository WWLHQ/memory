// REQ-012 接真内核引擎（T7）：与 fakeEngine 同签名（async），内部走 memagent-core ma.recall
// 数据源 = 内核 InMemoryStorage（SEED_HITS 灌入）；UI 类型/横幅/预算语义不变。
import type { BudgetData, ModeBannerData, RetrievalHit, Scene, ModeSel } from './types.ts';
import { autoDispatch, budgetLevel, resolveSceneBudget, sortHits, freshness } from './logic.ts';
import { SEED_HITS } from './seed.ts';
import type { Memory, RecallReq } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import type { MemAgent } from '../../core/memagent/types.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';

export interface EngineResult {
  hits: RetrievalHit[];
  banner: ModeBannerData;
  budget: BudgetData;
  evidence_thin: 'none' | 'backfill_hit' | 'backfill_miss';
  breach: boolean;
}

const DAY = 24 * 3600 * 1000;

/** 页面级共享内核实例（module singleton）：内存态为真相 */
let agentP: Promise<MemAgent> | null = null;

function getAgent(): Promise<MemAgent> {
  if (!agentP) {
    agentP = (async () => {
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: new InMemoryStorage(),
      });
      for (const h of SEED_HITS) {
        const m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'> = {
          mem_id: h.memory_id,
          project_id: 'P1',
          content: h.content,
          category: h.tags.includes('pref') ? 'preference' : 'fact',
          layer: 'L2',
          decay_class: h.decay_class,
          pinned: h.pinned,
          locked: h.locked,
          importance: h.importance,
          confidence: h.confidence,
          half_life_days: h.half_life_days,
          last_access_time: Date.now() - h.age_days * DAY,
          tags: h.tags,
        };
        await ma._seedMemory(m);
      }
      return ma;
    })();
  }
  return agentP;
}

function toRetrievalHit(
  h: { mem_id: string; content: string; decay_class: string; pinned: boolean; locked: boolean; score: number },
  seed: (typeof SEED_HITS)[number] | undefined,
): RetrievalHit {
  const age_days = seed?.age_days ?? 1;
  return {
    memory_id: h.mem_id,
    content: h.content,
    // R2：cold/archived/dormant 仅 L2 摘要占位
    l2_only: seed?.l2_only ?? (h.decay_class === 'cold' || h.decay_class === 'archived' || h.decay_class === 'dormant'),
    decay_class: h.decay_class as RetrievalHit['decay_class'],
    pinned: h.pinned,
    locked: h.locked,
    freshness: seed ? freshness(seed.age_days, seed.half_life_days) : 0.5,
    importance: seed?.importance ?? 0.5,
    confidence: seed?.confidence ?? 0.5,
    score: h.score,
    tags: seed?.tags ?? [],
    conflict_note: seed?.conflict_note,
    age_days,
    half_life_days: seed?.half_life_days ?? 30,
  };
}

export async function coreEngine(query: string, scene: Scene, modeSel: ModeSel, _requestId: string): Promise<EngineResult> {
  const ma = await getAgent();
  const table = resolveSceneBudget(scene);
  const dispatch = modeSel ? { mode: modeSel, hit_keywords: [] as string[] } : autoDispatch(query, scene);

  // 内核 recall（17.5/17.8 打分 + pinned 免检 + 冷层补查 + critical 禁 minimal）
  // 页面 Scene 含 history_query（演示扩展），内核场景三值 → 映射 default
  const coreScene = scene === 'critical' ? 'critical' : scene === 'task_start' ? 'task_start' : 'default';
  const req: RecallReq = { query, project_id: 'P1', scene: coreScene, mode: modeSel, top_k: 5 };
  const r = await ma.recall(req);

  const hits: RetrievalHit[] = r.hits
    .map((h) => toRetrievalHit(h, SEED_HITS.find((s) => s.memory_id === h.mem_id)));
  const ordered = sortHits(hits);

  const payload = r.payload_tokens;
  const breach = budgetLevel(payload) === 'breach';

  // 2.4.3 逃生阀：内核 evidence_thin=true 表示触发过补查；补查后仍有命中 → backfill_hit
  const evidence_thin: EngineResult['evidence_thin'] = r.evidence_thin
    ? (r.hits.length > 0 ? 'backfill_hit' : 'backfill_miss')
    : 'none';

  const banner: ModeBannerData = {
    scene,
    mode: dispatch.mode,
    fallback: !modeSel,
    hit_keywords: dispatch.hit_keywords,
    secondary_mode_hint: dispatch.mode === 'minimal' ? null : { mode: 'minimal', note: '≤200t 摘要注入（2.4.3 次模式）' },
    request_id: r.request_id,
    evidence_thin,
    cold_recall: evidence_thin === 'backfill_hit',
  };

  const budget: BudgetData = {
    payload_tokens: payload,
    pipeline_llm_tokens: table.rerank === true ? 640 : 0,
    stage1_count: ordered.length,
    stage2_count: Math.min(5, ordered.length),
    rerank_applied: table.rerank === true,
    budget_breach: budgetLevel(payload) !== 'ok',
    breach_detail: budgetLevel(payload) !== 'ok' ? ['L2 摘要 × 1 条'] : undefined,
  };

  return { hits: ordered, banner, budget, evidence_thin, breach };
}
