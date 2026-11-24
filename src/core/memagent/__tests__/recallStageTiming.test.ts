// P1-9 延迟分段埋点（2026-11-23）：recall 审计 detail.stage_ms 的契约测试。
// 背景：audit 的 latency_ms 只有一个总数字（端到端 p95 1983ms），无法回答「哪一段吃掉了时间」；
// 而 P1-8′ 的隔离 A/B（416.8→38.3ms）只覆盖纯管线，二者对不上时必须能分段看，否则只能猜。
// 闸门：A 影响面（既有 recall 行为不变）· B 效果（各段真落盘且能加总对上 latency）· C 变异（键集合锁死，删段即红）。
import { describe, it, expect, beforeEach } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';
import type { Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

/** 分段键的唯一真源（测试侧镜像）：新增/删除段必须同步这里，否则本文件立刻红——防止埋点被静默改掉。 */
const STAGE_KEYS = [
  'embed', 'list', 'growth', 'score', 'probe',
  'backfill', 'personal', 'bg', 'writeback', 'tail',
  'audit_mode_dispatch',
] as const;

function baseMemory(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_default',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: 'connection pool timeout 排查记录',
    content_l1: 'connection pool timeout 排查记录',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: 1000,
    ...over,
  };
}

describe('P1-9 · recall 延迟分段埋点 stage_ms', () => {
  let storage: InMemoryStorage;
  let ma: ReturnType<typeof createMemAgent>;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    ma = createMemAgent({
      form: 'desktop',
      account: ACCOUNT,
      llm: new FakeLlmProvider(),
      vector: new JsVectorBackend(),
      storage,
    });
    await storage.putMemory(baseMemory({ mem_id: 'mem_s1', embedding: undefined }));
    await storage.putMemory(baseMemory({ mem_id: 'mem_s2', content: '向量检索 延迟 排查', content_l1: '向量检索 延迟 排查' }));
  });

  async function recallAudit(query: string) {
    const r = await ma.recall({ query, project_id: 'P1', top_k: 3 });
    const audits = await storage.queryAudit({ request_id: r.request_id });
    const recall = audits.find((a) => a.action === 'recall');
    return { r, audit: recall };
  }

  it('B 效果：recall 审计落 stage_ms，键集合与计量口径完全一致', async () => {
    const { audit } = await recallAudit('connection pool timeout');
    expect(audit).toBeDefined();
    const stage = (audit?.detail as { stage_ms?: Record<string, number> } | undefined)?.stage_ms;
    expect(stage).toBeDefined();
    // C 变异锁：键集合必须逐字等于真源——少一个（有人删段）或多一个（有人偷偷加段不更新口径）都红
    expect(Object.keys(stage as Record<string, number>).sort()).toEqual([...STAGE_KEYS].sort());
    for (const k of STAGE_KEYS) {
      expect(typeof (stage as Record<string, number>)[k]).toBe('number');
      expect((stage as Record<string, number>)[k]).toBeGreaterThanOrEqual(0);
    }
  });

  it('B 效果：各段加总与 latency_ms 对得上（tail 兜住收尾，不允许出现大窟窿）', async () => {
    const { audit } = await recallAudit('connection pool timeout');
    const d = audit?.detail as { stage_ms: Record<string, number>; latency_ms: number };
    const { stage_ms: stage, latency_ms } = d;
    // 纯管线各段之和（除去审计写入段，它本来就在 latency_ms 之外）
    const pipelineSum = STAGE_KEYS
      .filter((k) => k !== 'audit_mode_dispatch')
      .reduce((a, k) => a + stage[k], 0);
    expect(pipelineSum).toBeLessThanOrEqual(latency_ms);
    // mark('tail') 是 latency 取样前的最后一次打点，两者最多差 1ms 的取样抖动
    expect(latency_ms - pipelineSum).toBeLessThanOrEqual(1);
  });

  it('B 效果：audit_mode_dispatch 单独计量，且不在 latency_ms 之内（它是端到端成本、不是管线成本）', async () => {
    const { audit } = await recallAudit('向量检索 延迟');
    const stage = (audit?.detail as { stage_ms: Record<string, number> } | undefined)?.stage_ms;
    expect(stage?.audit_mode_dispatch).toBeGreaterThanOrEqual(0);
  });

  it('A 影响面：埋点不污染返回体——RecallResult 不得带 stage_ms（那是审计字段，进 payload 就是白烧 token）', async () => {
    const { r } = await recallAudit('connection pool timeout');
    expect('stage_ms' in (r as unknown as Record<string, unknown>)).toBe(false);
    // 既有语义字段一字未动
    expect(typeof r.request_id).toBe('string');
    expect(Array.isArray(r.hits)).toBe(true);
    expect(typeof r.payload_tokens).toBe('number');
  });

  it('B 效果：不同 query 都带完整分段（不是只在某条路径才埋）', async () => {
    const a = await recallAudit('向量检索');
    const b = await recallAudit('完全不相关的查询词 zxqv');
    for (const { audit } of [a, b]) {
      const stage = (audit?.detail as { stage_ms: Record<string, number> } | undefined)?.stage_ms;
      expect(stage).toBeDefined();
      expect(Object.keys(stage ?? {}).sort()).toEqual([...STAGE_KEYS].sort());
    }
  });
});
