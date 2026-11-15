// M1-2：per-hit 分量埋点（mems_detail）——构建函数边界 + recall 审计接线。
// 关键契约：条数 = min(scored.length, limit)、字段顺序 [id, rel, f, imp, conf, boost]、
// 数值 3 位小数、顺序与召回排名一致；M1-6：50 行单次 JSON ≤ 4KB。
import { describe, expect, it } from 'vitest';
import { buildMemsDetail, scoreParts } from '../forgetting.ts';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const NOW = Date.now();
const DAY = 24 * 3600 * 1000;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function mkMem(p: Partial<Memory> & { mem_id: string }): Memory {
  return {
    project_id: 'P1', category: 'insight', layer: 'L1', decay_class: 'hot',
    content: 'x', pinned: false, locked: false, version: 1, created_at: NOW - 30 * DAY,
    ...p,
  } as Memory;
}

function scoredRow(i: number) {
  return { m: mkMem({ mem_id: `mem_${i.toString().padStart(4, '0')}` }), relevance: 0.5 };
}

function makeAgent() {
  const storage = new InMemoryStorage();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
  });
  return { ma, storage };
}

describe('buildMemsDetail（M1-2 纯函数）', () => {
  it('字段顺序固定且千分位取整：rel/f/imp/conf/boost 各就各位', () => {
    const m = mkMem({ mem_id: 'mem_a', importance: 0.42678, confidence: 0.77123, access_count: 3 });
    const [row] = buildMemsDetail([{ m, relevance: 0.1234567 }], NOW, 20);
    expect(row[0]).toBe('mem_a');
    expect(row[1]).toBe(0.123); // relevance 千分位
    expect(row[2]).toBe(round3(scoreParts(m, NOW).f)); // f 由 scoreParts 提供
    expect(row[3]).toBe(0.427); // importance
    expect(row[4]).toBe(0.771); // confidence
    expect(row[5]).toBe(0.3); // access_count 3 → 0.3
  });

  it('limit 边界 3 / 20 / 50：条数严格等于 min(候选数, limit)，且顺序与输入一致', () => {
    const scored = Array.from({ length: 60 }, (_, i) => scoredRow(i));
    expect(buildMemsDetail(scored, NOW, 3)).toHaveLength(3);
    expect(buildMemsDetail(scored, NOW, 20)).toHaveLength(20);
    expect(buildMemsDetail(scored, NOW, 50)).toHaveLength(50);
    // 顺序：前 3 条 id 必须逐位对应输入前 3 条（不重排）
    expect(buildMemsDetail(scored, NOW, 3).map((r) => r[0]))
      .toEqual(['mem_0000', 'mem_0001', 'mem_0002']);
    // limit 超出候选数 → 全量
    const few = scored.slice(0, 4);
    expect(buildMemsDetail(few, NOW, 50)).toHaveLength(4);
    // limit=0 → 空
    expect(buildMemsDetail(scored, NOW, 0)).toEqual([]);
    // 空候选 → 空（不编造）
    expect(buildMemsDetail([], NOW, 20)).toEqual([]);
  });

  it('M1-6：sample_top_n=50 单次埋点 JSON ≤ 4KB（用 26 字符真实长度 id）', () => {
    const scored = Array.from({ length: 50 }, (_, i) => ({
      m: mkMem({ mem_id: `mem_${'A'.repeat(23)}${String(i).padStart(3, '0')}`.slice(0, 26) }),
      relevance: 0.987654,
    }));
    const rows = buildMemsDetail(scored, NOW, 50);
    expect(rows).toHaveLength(50);
    const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
    expect(bytes).toBeLessThanOrEqual(4096);
  });
});

describe('recall 审计接线 mems_detail（M1-2 集成）', () => {
  it('mems_detail 条数 = min(候选, top_k)，顺序与命中一致，分量取自同一批召回', async () => {
    const { ma, storage } = makeAgent();
    const seeded = [];
    for (let i = 0; i < 5; i++) {
      seeded.push(await ma._seedMemory({
        content: `召回埋点样本 ${i}：数据库连接池超时 maxWait 调整观察慢查询`,
        category: 'fact', project_id: 'P1',
      }));
    }
    const r = await ma.recall({ query: '数据库连接池超时 maxWait 慢查询', project_id: 'P1', top_k: 5 });
    expect(r.hits.length).toBe(5);

    const [a] = await storage.queryAudit({ action: 'recall' });
    const detail = a.detail.mems_detail as [string, number, number, number, number, number][];
    expect(detail).toHaveLength(5); // min(5 候选, 20 sample_top_n, top_k 5) = 5
    // 顺序与最终命中一致
    expect(detail.map((row) => row[0])).toEqual(r.hits.map((h) => h.mem_id));
    // 每条 6 元组、字段类型正确、数值 3 位小数
    for (const row of detail) {
      expect(row).toHaveLength(6);
      expect(typeof row[0]).toBe('string');
      for (let k = 1; k < 6; k++) {
        const v = row[k] as number;
        expect(typeof v).toBe('number');
        expect(round3(v)).toBe(v);
      }
    }
    // 种子记忆未设 importance/confidence/access_count → imp/conf=0.5、boost=0、f≈1
    const byId = new Map(seeded.map((m) => [m.mem_id, m] as const));
    for (const row of detail) {
      const m = byId.get(row[0]);
      if (!m) continue; // 命中里可能含非种子（此处不会发生），跳过以防误判
      const p = scoreParts(m, NOW);
      expect(row[3]).toBe(round3(p.imp)); // 0.5
      expect(row[4]).toBe(round3(p.conf)); // 0.5
      expect(row[5]).toBe(round3(p.boost)); // 0
      // f 用 recall 时刻计算，种子创建于此毫秒附近 → 取整后为 1
      expect(row[2]).toBe(1);
    }
  });

  it('候选少于 top_k → mems_detail 条数 = 候选数（不补齐、不编造）', async () => {
    const { ma, storage } = makeAgent();
    for (let i = 0; i < 3; i++) {
      await ma._seedMemory({ content: `短样本 ${i} 连接池`, category: 'fact', project_id: 'P1' });
    }
    await ma.recall({ query: '连接池', project_id: 'P1', top_k: 5 });
    const [a] = await storage.queryAudit({ action: 'recall' });
    const detail = a.detail.mems_detail as unknown[];
    expect(detail).toHaveLength(3);
  });

  it('空库 → mems_detail 为空数组', async () => {
    const { ma, storage } = makeAgent();
    await ma.recall({ query: '任意查询', project_id: 'P1', top_k: 5 });
    const [a] = await storage.queryAudit({ action: 'recall' });
    expect(a.detail.mems_detail).toEqual([]);
  });
});
