// 批次46-2：完整遗忘周期编排（方案 C 薄编排）契约测试
// A 项目隔离 / B 六字段真值 / C dry_run 零写入 / D 7 天幂等 / E 边界与接线 / F 原行为不回归
import { describe, expect, it } from 'vitest';
import { coreGcFull, coreGc } from '../memories.ts';
import { runForgettingCycle } from '../forgetting.ts';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, DEFAULT_VECTOR_DIM, embedSync } from '../vector.ts';
import type { MemAgent, Memory } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;
const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: o.content ?? 'some content here',
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: NOW - 1 * DAY,
    ...o,
  };
}

/** P1 / P2 各 4 条：3 条 decision 同主题（触发摘要）+ 1 条 hot 老记忆（触发迁移） */
async function seedIsolated(storage: InMemoryStorage): Promise<void> {
  for (const pid of ['P1', 'P2']) {
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({
        mem_id: `${pid}_d${i}`, project_id: pid, category: 'decision',
        content: `deploy docker guide part ${i}`,
      }));
    }
    await storage.putMemory(mem({
      mem_id: `${pid}_old`, project_id: pid, category: 'fact',
      content: 'old ledger row about retention', created_at: NOW - 4 * DAY,
    }));
  }
}

/** P1 三条冷行 + P2 一条冷行，均带行上向量并建索引副本（用于压缩真值与项目隔离） */
async function seedCompress(storage: InMemoryStorage, vector: JsVectorBackend): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const content = `cold ledger row ${i}`;
    await storage.putMemory(mem({
      mem_id: `c${i}`, project_id: 'P1', category: 'fact', decay_class: 'cold', content,
      embedding: embedSync(content, DEFAULT_VECTOR_DIM),
    }));
    await vector.upsert(`c${i}`, content, { project_id: 'P1', layer: 'L2' });
  }
  const p2 = 'cold ledger row 0';
  await storage.putMemory(mem({
    mem_id: 'c_p2', project_id: 'P2', category: 'fact', decay_class: 'cold', content: p2,
    embedding: embedSync(p2, DEFAULT_VECTOR_DIM),
  }));
  await vector.upsert('c_p2', p2, { project_id: 'P2', layer: 'L2' });
}

function fixture(): { storage: InMemoryStorage; ma: MemAgent } {
  const storage = new InMemoryStorage();
  const ma: MemAgent = createMemAgent({
    form: 'desktop', account: ACCOUNT,
    llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
  });
  return { storage, ma };
}

describe('46-2 A · 项目隔离与全库原行为', () => {
  it('coreGcFull(project_id=P1) 只扫 P1：六字段真值 + P2 一行不动', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    const r = await coreGcFull({ project_id: 'P1' }, { storage, now: NOW });

    expect(r.project_id).toBe('P1');
    expect(r.freshness_updated).toBe(4);   // P1 共 4 条
    expect(r.scanned).toBe(4);             // D4：如实命名，与 freshness_updated 相等
    expect(r.migrated).toBe(1);            // p1_old: hot → warm
    expect(r.summaries_created).toBe(1);
    expect(r.merged_originals).toBe(3);
    // D5：decayed 只是 migrated 的兼容别名，同一事件不双计
    expect(r.decayed).toBe(r.migrated);
    // 46-2 未接冲突裁决（属 46-3），未落定诚实为 0，不拿别的数字顶替
    expect(r.conflicts_resolved).toBe(0);
    expect(r.merged).toBe(0);

    // P2 四条原封不动（项目隔离的反向断言）
    for (const id of ['P2_d0', 'P2_d1', 'P2_d2', 'P2_old']) {
      const m = await storage.getMemory(id);
      expect(m?.version).toBe(1);
      expect(m?.decay_class).toBe('hot');
      expect(m?.merged_into).toBeUndefined();
    }
    const all = await storage.listMemories({});
    expect(all.filter((m) => m.project_id === 'P2' && m.mem_id.startsWith('sum_'))).toHaveLength(0);
    expect(all.filter((m) => m.mem_id.startsWith('sum_'))).toHaveLength(1);
  });

  it('F 回归：runForgettingCycle 不带新参数仍是全库扫描 + 原审计格式（main.ts 6h 调度不变）', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    const r = await runForgettingCycle(storage, NOW);

    expect(r.freshness_updated).toBe(8);   // P1 + P2 全库
    expect(r.migrated).toBe(2);
    expect(r.summaries_created).toBe(2);  // 两项目各一组
    const audits = await storage.queryAudit({ action: 'gc' });
    expect(audits).toHaveLength(1);
    expect(audits[0].request_id).toBe(r.request_id);
    expect(audits[0].detail).toMatchObject({ task: 'forgetting_cycle', weeklyCompress: false });
  });

  it('不存在的项目 → 全 0 报告且不改动任何记忆（不猜项目、不补造统计）', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    const before = await storage.listMemories({});
    const r = await coreGcFull({ project_id: 'P_NOPE' }, { storage, now: NOW });

    expect(r.freshness_updated).toBe(0);
    expect(r.scanned).toBe(0);
    expect(r.migrated).toBe(0);
    expect(r.summaries_created).toBe(0);
    expect(r.compressed).toBe(0);
    expect(r.conflicts_resolved).toBe(0);
    expect((await storage.listMemories({})).map((m) => m.mem_id)).toEqual(before.map((m) => m.mem_id));
  });

  it('空 project_id 明确拒绝且不产生任何写入', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    await expect(coreGcFull({ project_id: '   ' }, { storage, now: NOW }))
      .rejects.toThrow(/project_id/);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });
});

describe('46-2 B · 六字段真值（非 dry_run 必须断言状态真的变了）', () => {
  it('summaries_created / merged_originals / migrated 的账本真值', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    const r = await coreGcFull({ project_id: 'P1' }, { storage, now: NOW });

    expect(r.summaries_created).toBe(1);
    expect(r.merged_originals).toBe(3);
    expect(r.migrated).toBe(1);

    const summaries = (await storage.listMemories({})).filter((m) => m.mem_id.startsWith('sum_'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0].merged_from).toEqual(['P1_d0', 'P1_d1', 'P1_d2']);
    for (const id of ['P1_d0', 'P1_d1', 'P1_d2']) {
      const m = await storage.getMemory(id);
      expect(m?.decay_class).toBe('cold');
      expect(m?.merged_into).toBe(summaries[0].mem_id);
      expect(m?.version).toBe(2);
    }
    const old = await storage.getMemory('P1_old');
    expect(old?.decay_class).toBe('warm');
    expect(old?.version).toBe(2);

    // 审计以真实账本为准，不按入参猜
    expect(r.audit).not.toBeNull();
    const audits = await storage.queryAudit({ request_id: r.request_id });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('gc');
    expect(audits[0].detail).toMatchObject({ task: 'forgetting_cycle', summaries_created: 1 });
  });

  it('compressed 真值：清掉向量索引副本 + 写 compressed_at，且只清目标项目', async () => {
    const storage = new InMemoryStorage();
    const vector = new JsVectorBackend();
    await seedCompress(storage, vector);
    const probe = embedSync('cold ledger row 0', vector.dim);
    expect((await vector.search(probe, 10, {})).map((h) => h.mem_id)).toContain('c0'); // 前态在索引里

    const r = await coreGcFull(
      { project_id: 'P1', weeklyCompress: true, vector },
      { storage, now: NOW },
    );
    expect(r.compressed).toBe(3);
    for (let i = 0; i < 3; i++) {
      const row = await storage.getMemory(`c${i}`);
      expect(row?.compressed_at).toBe(NOW);
      expect(row?.version).toBe(2);
      expect(row?.embedding).toEqual(embedSync(`cold ledger row ${i}`, DEFAULT_VECTOR_DIM)); // 行上向量保留
    }
    const after = (await vector.search(probe, 10, {})).map((h) => h.mem_id);
    expect(after).not.toContain('c0');
    expect(after).toContain('c_p2'); // P2 副本未被越界清除
    const p2 = await storage.getMemory('c_p2');
    expect(p2?.compressed_at).toBeUndefined();
    expect(p2?.version).toBe(1);
  });

  it('无 vector 后端时 compressed 诚实为 0，不拿冷层行数冒充', async () => {
    const storage = new InMemoryStorage();
    await seedCompress(storage, new JsVectorBackend());
    const r = await coreGcFull(
      { project_id: 'P1', weeklyCompress: true },
      { storage, now: NOW },
    );
    expect(r.compressed).toBe(0);
    expect((await storage.getMemory('c0'))?.compressed_at).toBeUndefined();
  });

  it('summaries_filtered 真值：噪声组被质量门拦下、原文不动', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({
        mem_id: `n${i}`, category: 'decision', content: '你好，我是一个 AI 助手',
      }));
    }
    const r = await coreGcFull({ project_id: 'P1' }, { storage, now: NOW });
    expect(r.summaries_filtered).toBe(1);
    expect(r.summaries_created).toBe(0);
    expect(storage.size).toBe(3);
  });

  it('note 如实说明 D4/D5/D6 口径：扫描条数、别名不双计、冲突未落定', async () => {
    const storage = new InMemoryStorage();
    const r = await coreGcFull({ project_id: 'P1' }, { storage, now: NOW });
    expect(r.note).toContain('扫描条数');
    expect(r.note).toContain('别名');
    expect(r.note).toContain('conflicts_resolved');
  });
});

describe('46-2 C · dry_run 全程零写入', () => {
  it('dry_run=true：演算有值但记忆/版本/审计/向量索引全不变，audit===null', async () => {
    const storage = new InMemoryStorage();
    const vector = new JsVectorBackend();
    await seedIsolated(storage);
    await seedCompress(storage, vector);
    const before = (await storage.listMemories({})).map((m) => ({ ...m }));
    const probe = embedSync('cold ledger row 0', vector.dim);
    const beforeHits = (await vector.search(probe, 10, {})).map((h) => h.mem_id);

    const r = await coreGcFull(
      { project_id: 'P1', dry_run: true, weeklyCompress: true, vector },
      { storage, now: NOW },
    );
    expect(r.dry_run).toBe(true);
    expect(r.summaries_created).toBe(1);   // 演算值，诚实反映「若真跑会发生什么」
    expect(r.migrated).toBe(1);
    expect(r.compressed).toBe(3);
    expect(r.audit).toBeNull();            // 演算未落审计，不伪造回执

    const after = (await storage.listMemories({})).map((m) => ({ ...m }));
    expect(after).toEqual(before);         // 条数 / 版本 / decay_class / compressed_at / merged_into 全不变
    expect(await storage.queryAudit({})).toHaveLength(0);
    expect((await vector.search(probe, 10, {})).map((h) => h.mem_id)).toEqual(beforeHits);
  });

  it('dry_run=true + enabled=false：全 0 报告且连 skipped 审计也不写', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    const r = await coreGcFull(
      { project_id: 'P1', dry_run: true, enabled: false },
      { storage, now: NOW },
    );
    expect(r.freshness_updated).toBe(0);
    expect(r.migrated).toBe(0);
    expect(r.audit).toBeNull();
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('enabled=false（非 dry_run）仍按 AC-14 只记 skipped 审计、全 0 报告', async () => {
    const storage = new InMemoryStorage();
    await seedIsolated(storage);
    const r = await coreGcFull({ project_id: 'P1', enabled: false }, { storage, now: NOW });
    expect(r.migrated).toBe(0);
    expect(r.summaries_created).toBe(0);
    const audits = await storage.queryAudit({ action: 'gc' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ skipped: true, reason: 'auto_policy_disabled' });
    expect(r.audit).not.toBeNull();
  });
});

describe('46-2 D · 7 天压缩幂等', () => {
  it('同一周内第二轮 compressed=0 且冷行版本不重复推进', async () => {
    const storage = new InMemoryStorage();
    const vector = new JsVectorBackend();
    await seedCompress(storage, vector);
    const first = await coreGcFull(
      { project_id: 'P1', weeklyCompress: true, vector },
      { storage, now: NOW },
    );
    expect(first.compressed).toBe(3);
    const second = await coreGcFull(
      { project_id: 'P1', weeklyCompress: true, vector },
      { storage, now: NOW + DAY },
    );
    expect(second.compressed).toBe(0);
    expect((await storage.getMemory('c0'))?.version).toBe(2);
    expect((await storage.getMemory('c0'))?.compressed_at).toBe(NOW);
  });
});

describe('46-2 E/F · 接线与既有入口不回归', () => {
  it('ma.gcFull 与 ma.gc 是两条独立入口：gcFull 只读演算不改库，gc 原行为不变', async () => {
    const { storage, ma } = fixture();
    // ma.gc() / ma.gcFull() 内部用真实 Date.now()，种子时间必须对齐，否则年龄为负不触发降档
    await storage.putMemory(mem({
      mem_id: 'old', category: 'fact', content: 'old ledger row about retention',
      created_at: Date.now() - 4 * DAY,
    }));

    const full = await ma.gcFull({ project_id: 'P1', dry_run: true });
    expect(full.audit).toBeNull();
    expect((await storage.getMemory('old'))?.version).toBe(1);
    expect(await storage.queryAudit({})).toHaveLength(0);

    const gc = await ma.gc({ project_id: 'P1' });
    expect(gc.decayed).toBe(1);
    expect(gc.merged).toBe(0);
    expect(gc.conflicts_resolved).toBe(0);
    expect(gc.audit).not.toBeNull();
    expect((await storage.getMemory('old'))?.version).toBe(2);
  });

  it('coreGc 三态原样：dry_run=true 零写入 / 未传 dry_run 真实落库', async () => {
    const dry = new InMemoryStorage();
    await dry.putMemory(mem({ mem_id: 'old', created_at: NOW - 4 * DAY }));
    const r1 = await coreGc({ project_id: 'P1', dry_run: true }, { storage: dry, request_id: 'req_dry', now: NOW });
    expect(r1.decayed).toBe(1);
    expect(r1.audit).toBeNull();
    expect((await dry.getMemory('old'))?.version).toBe(1);
    expect(await dry.queryAudit({})).toHaveLength(0);

    const real = new InMemoryStorage();
    await real.putMemory(mem({ mem_id: 'old', created_at: NOW - 4 * DAY }));
    const r2 = await coreGc({ project_id: 'P1' }, { storage: real, request_id: 'req_real', now: NOW });
    expect(r2.decayed).toBe(1);
    expect(r2.audit).not.toBeNull();
    expect((await real.getMemory('old'))?.version).toBe(2);
    expect(await real.queryAudit({})).toHaveLength(1);
  });
});
