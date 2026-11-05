// REQ-010 遗忘机制契约测试（17.11 AC 覆盖 + 17.7 迁移规则 + 17.6 策略表）
import { describe, expect, it } from 'vitest';
import {
  buildSummary, classifyLayer, clusterSimilar, forgetOne, freshnessOf, hardFilter,
  policyFor, reinforceOne, restoreOne, runForgettingCycle, scoreMemory,
} from '../forgetting.ts';
import { InMemoryStorage } from '../storage.ts';
import { DEFAULT_VECTOR_DIM, JsVectorBackend, cosine, embedSync } from '../vector.ts';
import { sha256hex } from '../sync.ts';
import type { Memory } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

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

describe('17.5 新鲜度与打分', () => {
  it('半衰期：1 个半衰期后 freshness=0.5，两个=0.25；钳制 ≥0.05', () => {
    const m = mem({ created_at: NOW - 30 * DAY, half_life_days: 30 });
    expect(freshnessOf(m, NOW)).toBeCloseTo(0.5, 5);
    const m2 = mem({ created_at: NOW - 60 * DAY, half_life_days: 30 });
    expect(freshnessOf(m2, NOW)).toBeCloseTo(0.25, 5);
    const m3 = mem({ created_at: NOW - 1000 * DAY, half_life_days: 30 });
    expect(freshnessOf(m3, NOW)).toBe(0.05);
  });

  it('AC-03：pinned 免检 + 加分 0.15', () => {
    const plain = mem({ decay_class: 'warm' });
    const pinned = mem({ decay_class: 'warm', pinned: true });
    expect(hardFilter(plain)).toBe(true);  // warm 参与
    expect(scoreMemory(pinned, 0.8, NOW) - scoreMemory(plain, 0.8, NOW)).toBeCloseTo(0.15, 5);
    // cold 默认被过滤，但 pinned cold 免检直进候选
    expect(hardFilter(mem({ decay_class: 'cold' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'cold', pinned: true }))).toBe(true);
  });

  it('AC-11：Cold/Archived/Dormant 不进默认召回候选', () => {
    expect(hardFilter(mem({ decay_class: 'cold' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'archived' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'dormant' }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'hot' }))).toBe(true);
  });

  it('下限钳制：低 importance/confidence 不被清零', () => {
    const m = mem({ importance: 0, confidence: 0 });
    const s = scoreMemory(m, 1, NOW);
    expect(s).toBeGreaterThan(0);
  });
});

describe('17.7 层迁移', () => {
  it('hot >3d → warm；warm >30d → cold', () => {
    expect(classifyLayer(mem({ decay_class: 'hot', created_at: NOW - 4 * DAY }), NOW)).toBe('warm');
    expect(classifyLayer(mem({ decay_class: 'warm', created_at: NOW - 31 * DAY }), NOW)).toBe('cold');
  });

  it('warm：freshness<0.1 或 confidence<0.3 → cold', () => {
    expect(classifyLayer(mem({ decay_class: 'warm', created_at: NOW - 40 * DAY, half_life_days: 7 }), NOW)).toBe('cold');
    expect(classifyLayer(mem({ decay_class: 'warm', confidence: 0.2 }), NOW)).toBe('cold');
  });

  it('cold：freshness<0.05 且 >90d → dormant', () => {
    const m = mem({ decay_class: 'cold', created_at: NOW - 100 * DAY, half_life_days: 10 });
    expect(classifyLayer(m, NOW)).toBe('dormant');
  });

  it('AC-04：locked / pinned 不参与自动迁移', () => {
    expect(classifyLayer(mem({ decay_class: 'hot', created_at: NOW - 40 * DAY, locked: true }), NOW)).toBeNull();
    expect(classifyLayer(mem({ decay_class: 'hot', created_at: NOW - 40 * DAY, pinned: true }), NOW)).toBeNull();
  });

  it('17.3 操作语义：忘记=降权不删除（AC-05）/ 恢复=拉回 warm（AC-06）/ 记住=进 hot', () => {
    const hot = mem({ decay_class: 'hot', confidence: 0.8, importance: 0.8 });
    const forgotten = forgetOne(hot);
    expect(forgotten.decay_class).toBe('warm');
    expect(forgotten.confidence).toBeLessThan(hot.confidence!);

    const cold = mem({ decay_class: 'cold', created_at: NOW - 60 * DAY });
    const restored = restoreOne(cold, NOW);
    expect(restored.decay_class).toBe('warm');

    const reinforced = reinforceOne(mem({ decay_class: 'warm' }), NOW);
    expect(reinforced.decay_class).toBe('hot');
    expect(reinforced.reinforce_count).toBe(1);
  });
});

describe('17.6 知识库策略表', () => {
  it('六类默认半衰期：fact 365 / preference 180 / decision 30 / pitfall 14 / context 2', () => {
    expect(policyFor('fact').half_life_days).toBe(365);
    expect(policyFor('preference').half_life_days).toBe(180);
    expect(policyFor('decision').half_life_days).toBe(30);
    expect(policyFor('pitfall').half_life_days).toBe(14);
    expect(policyFor('context').half_life_days).toBe(2);
    expect(policyFor('fact').auto_merge).toBe(false);
    expect(policyFor('decision').auto_merge).toBe(true);
  });
});

describe('17.9 合并与摘要', () => {
  it('AC-09：合并生成摘要 + merged_from + 原文降 cold 保留', () => {
    const group = [
      mem({ content: 'deploy docker step one', category: 'decision', importance: 0.9 }),
      mem({ content: 'deploy docker step two', category: 'decision' }),
      mem({ content: 'deploy docker step three', category: 'decision' }),
    ];
    const built = buildSummary(group, NOW);
    expect(built?.ok).toBe(true);
    if (!built || !built.ok) throw new Error('应生成摘要');
    expect(built.summary.merged_from).toHaveLength(3);
    expect(built.summary.importance).toBe(0.9);
    // 批次24 口径2：摘要作为新生成的层级记录，同样带自己的层级生成时间
    expect(built.summary.layers_generated_at).toBe(NOW);
    // 批次28-C：摘要=本地合成（无 LLM）→ layer L1 + content_l1 + refined_by stub，不再冒充 L3
    expect(built.summary.layer).toBe('L1');
    expect(built.summary.content_l1).toBe(built.summary.content);
    expect(built.summary.refined_by).toBe('stub');
    // 批次41-B（评审 P1-4 另一半）：摘要行与写入路径同字段口径 —— sha256 + 源自 L1 的语义向量
    // （§2.2 不变量 7）。缺任一项，摘要行在语义召回里恒 0 分、按 sha256 查重永远匹配不到。
    expect(built.summary.sha256).toBe(sha256hex(built.summary.content!));
    expect(built.summary.embedding).toEqual(embedSync(built.summary.content_l1!, DEFAULT_VECTOR_DIM));
    expect(built.originals.every((o) => o.decay_class === 'cold' && o.merged_into === built.summary.mem_id)).toBe(true);
  });

  it('批次10：成员为噪声（寒暄/助手自述）→ 质量门拦截，不生成摘要', () => {
    const group = [
      mem({ content: '你好，我是一个 AI 助手', category: 'decision' }),
      mem({ content: '你好，我是一个AI助手呀', category: 'decision' }),
      mem({ content: '你好，我是一个 AI 语言模型', category: 'decision' }),
    ];
    const built = buildSummary(group, NOW);
    expect(built && !built.ok).toBe(true);
    if (!built || built.ok) throw new Error('应被质量门拦截');
    expect(built.reason).toContain('质量门');
  });

  it('批次10：成员含真实技术内容 → 摘要落库且已脱敏', () => {
    const group = [
      mem({ content: '部署脚本必须校验 Redis 连接，联系人：张三', category: 'decision' }),
      mem({ content: '部署脚本必须校验 Redis 连接，避免超时', category: 'decision' }),
      mem({ content: '部署脚本必须校验 Redis 连接，电话 13800138000', category: 'decision' }),
    ];
    const built = buildSummary(group, NOW);
    expect(built?.ok).toBe(true);
    if (!built || !built.ok) throw new Error('应生成摘要');
    expect(built.summary.content).toContain('部署脚本');
    expect(built.summary.content).not.toContain('13800138000');
    expect(built.summary.content).not.toContain('张三');
  });
  it('少于 3 条 / 锁定导致不足 3 条 → 不合并', () => {
    expect(buildSummary([mem(), mem()], NOW)).toBeNull();
    const locked = [mem({ locked: true }), mem({ locked: true }), mem()];
    expect(buildSummary(locked, NOW)).toBeNull();
  });

  it('跨项目/团队/租户混组 → 拒绝合并（摘要不得串档）', () => {
    const base = { content: 'deploy docker guide part', category: 'decision' as const };
    expect(buildSummary([
      mem({ ...base, project_id: 'P1' }),
      mem({ ...base, project_id: 'P2' }),
      mem({ ...base, project_id: 'P1' }),
    ], NOW)).toBeNull();
    expect(buildSummary([
      mem({ ...base, team_id: 't1' }),
      mem({ ...base, team_id: 't2' }),
      mem({ ...base, team_id: 't1' }),
    ], NOW)).toBeNull();
    expect(buildSummary([
      mem({ ...base, enterprise_id: 'e1' }),
      mem({ ...base, enterprise_id: 'e2' }),
      mem({ ...base, enterprise_id: 'e1' }),
    ], NOW)).toBeNull();
  });
});

describe('17.10 后台周期任务', () => {
  it('一轮任务：迁移计数 + 审计；locked 豁免（AC-04）', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'a1', decay_class: 'hot', created_at: NOW - 4 * DAY }));
    await storage.putMemory(mem({ mem_id: 'a2', decay_class: 'hot', created_at: NOW - 4 * DAY, locked: true }));
    const report = await runForgettingCycle(storage, NOW);
    expect(report.migrated).toBe(1); // 仅未锁定的 a1
    const a2 = await storage.getMemory('a2');
    expect(a2?.decay_class).toBe('hot');
    const audits = await storage.queryAudit({ action: 'gc' });
    expect(audits.length).toBe(1);
    expect(audits[0].request_id).toBe(report.request_id);
  });

  it('AC-01：任务不删除任何知识', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 5; i++) await storage.putMemory(mem({ mem_id: `k${i}`, content: `zz${i} distinct subject line`, created_at: NOW - 100 * DAY }));
    await runForgettingCycle(storage, NOW);
    expect(storage.size).toBe(5);
  });

  it('AC-14：enabled=false 可关闭（审计记 skipped）', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ created_at: NOW - 40 * DAY }));
    const r = await runForgettingCycle(storage, NOW, { enabled: false });
    expect(r.migrated).toBe(0);
    const audits = await storage.queryAudit({ action: 'gc' });
    expect(audits[0].detail.skipped).toBe(true);
  });

  it('合并集成：同主题 ≥3 条 → 周期内生成摘要 + 原文保留（AC-09）', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({ mem_id: `d${i}`, content: `deploy docker guide part ${i}`, category: 'decision' }));
    }
    const r = await runForgettingCycle(storage, NOW);
    expect(r.summaries_created).toBe(1);
    expect(r.merged_originals).toBe(3);
    expect(storage.size).toBe(4); // 3 原文 + 1 摘要（不删除）
    const d0 = await storage.getMemory('d0');
    expect(d0?.decay_class).toBe('cold');
  });

  it('批次41-B：摘要行进向量索引（给了 vector 就同步 upsert；不给也只有行上向量，不假装建过索引）', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({ mem_id: `v${i}`, content: `deploy docker guide part ${i}`, category: 'decision' }));
    }
    const vector = new JsVectorBackend();
    const r = await runForgettingCycle(storage, NOW, { vector });
    expect(r.summaries_created).toBe(1);
    const summary = (await storage.listMemories({})).find((m) => m.mem_id.startsWith('sum_'))!;
    expect(summary).toBeDefined();

    // 索引里查得到这条摘要（按它自己的正文嵌入去查 → 命中自己）
    const hits = await vector.search(embedSync(summary.content_l1!, vector.dim), 5, {});
    expect(hits.map((h) => h.mem_id)).toContain(summary.mem_id);
    // 语义召回读的是行上的 embedding（agent.ts:81），这里必须非 0 分
    expect(cosine(embedSync(summary.content_l1!, DEFAULT_VECTOR_DIM), summary.embedding!)).toBeCloseTo(1, 6);

    // 不传 vector：行上向量照旧真算，但索引不被写入（无后端时不假装建过索引）
    const storage2 = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await storage2.putMemory(mem({ mem_id: `w${i}`, content: `deploy docker guide part ${i}`, category: 'decision' }));
    }
    const r2 = await runForgettingCycle(storage2, NOW);
    expect(r2.summaries_created).toBe(1);
    const summary2 = (await storage2.listMemories({})).find((m) => m.mem_id.startsWith('sum_'))!;
    expect(summary2.embedding).toEqual(embedSync(summary2.content_l1!, DEFAULT_VECTOR_DIM));
    expect((await vector.search(embedSync(summary2.content_l1!, vector.dim), 5, {}))
      .map((h) => h.mem_id)).not.toContain(summary2.mem_id);
  });

  it('批次10：噪声成员组 → 合并被质量门拦下，原文不动（审计记 summaries_filtered）', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({ mem_id: `n${i}`, content: '你好，我是一个 AI 助手', category: 'decision' }));
    }
    const r = await runForgettingCycle(storage, NOW);
    expect(r.summaries_created).toBe(0);
    expect(r.summaries_filtered).toBe(1);
    expect(storage.size).toBe(3);
    const [a] = await storage.queryAudit({ action: 'gc' });
    expect(a.detail.summaries_filtered).toBe(1);
    expect((a.detail.summary_filter_reasons as string[])[0]).toContain('质量门');
  });

  it('跨项目同内容不合并：分组键含租户/团队/项目（每项目仅 2 条 → 均不触发）', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 2; i++) {
      await storage.putMemory(mem({ mem_id: `p1_${i}`, project_id: 'P1', content: `deploy docker guide part ${i}`, category: 'decision' }));
      await storage.putMemory(mem({ mem_id: `p2_${i}`, project_id: 'P2', content: `deploy docker guide part ${i}`, category: 'decision' }));
    }
    const r = await runForgettingCycle(storage, NOW);
    expect(r.summaries_created).toBe(0);
    expect(storage.size).toBe(4);
  });

  it('17.6 auto_merge=false 的类别（fact/context/preference）不自动合并', async () => {
    for (const category of ['fact', 'context', 'preference'] as const) {
      const storage = new InMemoryStorage();
      for (let i = 0; i < 3; i++) {
        await storage.putMemory(mem({ mem_id: `${category}${i}`, category, content: `sametopic content ${i}` }));
      }
      const r = await runForgettingCycle(storage, NOW);
      expect(r.summaries_created).toBe(0);
      expect(storage.size).toBe(3);
    }
  });
});

/**
 * 批次42 阶段4（4-A）变异杀手：17.9「相似」判据接真。
 * 旧实现按 `content.slice(0, 8)` 分组，下面两例分别打它的两个失效面：
 * ① 同主题换措辞（前缀不同）本应合并却漏掉；② 前缀相同但主题无关本不该合并却硬凑。
 * 把聚类改回前缀分组，这两例必红。
 */
describe('批次42 阶段4：17.9 相似判据接真（语义余弦，非内容前缀）', () => {
  it('clusterSimilar 纯函数：同主题聚一簇、异主题分簇；阈值生效且结果可复现', () => {
    const group = [
      mem({ mem_id: 'b2', content: 'alpha deploy docker guide part', category: 'decision' }),
      mem({ mem_id: 'a1', content: 'beta deploy docker guide part', category: 'decision' }),
      mem({ mem_id: 'c3', content: 'gamma deploy docker guide part', category: 'decision' }),
      mem({ mem_id: 'd4', content: 'redis cluster failover runbook', category: 'decision' }),
    ];
    const clusters = clusterSimilar(group);
    expect(clusters.map((c) => c.length).sort()).toEqual([1, 3]);
    // 按 mem_id 排序后以 a1 为种子，重复调用结果一致
    expect(clusters.find((c) => c.length === 3)!.map((m) => m.mem_id)).toEqual(['a1', 'b2', 'c3']);
    expect(clusterSimilar(group)).toEqual(clusters);
    // 阈值 >1（cosine 上限）→ 全部独立成簇，证明判据确实是相似度而非别的
    expect(clusterSimilar(group, 2)).toHaveLength(4);
  });

  it('杀手①：同主题仅换首个词（内容前 8 字符各不相同）→ 仍应生成 1 条摘要', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 's0', content: 'alpha deploy docker guide part', category: 'decision' }));
    await storage.putMemory(mem({ mem_id: 's1', content: 'beta deploy docker guide part', category: 'decision' }));
    await storage.putMemory(mem({ mem_id: 's2', content: 'gamma deploy docker guide part', category: 'decision' }));
    const r = await runForgettingCycle(storage, NOW);
    expect(r.summaries_created).toBe(1);
    expect(r.merged_originals).toBe(3);
  });

  it('杀手②：内容前 8 字符完全相同但主题无关 → 不得产生任何合并候选组', async () => {
    // 三条前 8 字符都是 'deploy x'，差异全在第 9 字符之后：旧前缀判据必把它们塞进同一组
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'u0', content: 'deploy x alpha beta gamma delta', category: 'decision' }));
    await storage.putMemory(mem({ mem_id: 'u1', content: 'deploy x redis kafka nginx setup', category: 'decision' }));
    await storage.putMemory(mem({ mem_id: 'u2', content: 'deploy x quantum orbit photon spin', category: 'decision' }));
    const r = await runForgettingCycle(storage, NOW);
    // 旧的前缀分组要么生成摘要、要么被质量门记为 filtered —— 两者都不允许
    expect(r.summaries_created).toBe(0);
    expect(r.summaries_filtered).toBe(0);
    expect(storage.size).toBe(3);
  });
});

/**
 * 批次42 阶段4（4-B）变异杀手：17.10 冷压缩接真。
 * 旧实现 `report.compressed = colds.length` 只数数、不碰索引也不写回；把这段重新注入，
 * 杀手③（索引副本未清 / 无压缩痕迹 / 不幂等）与杀手④（无后端仍虚报）必红。
 */
describe('批次42 阶段4：17.10 冷压缩接真（清索引副本，非仅计数）', () => {
  const coldRow = (i: number): Memory => {
    const content = `cold ledger row ${i}`;
    return mem({
      mem_id: `c${i}`, category: 'fact', decay_class: 'cold', content,
      embedding: embedSync(content, DEFAULT_VECTOR_DIM),
    });
  };

  it('杀手③：真清索引副本、行上向量保留、留压缩痕迹，且 7 天内幂等', async () => {
    const storage = new InMemoryStorage();
    const vector = new JsVectorBackend();
    for (let i = 0; i < 3; i++) {
      const row = coldRow(i);
      await storage.putMemory(row);
      await vector.upsert(row.mem_id, row.content, { project_id: 'P1', layer: 'L2' });
    }
    const probe = embedSync('cold ledger row 0', vector.dim);
    expect((await vector.search(probe, 10, {})).map((h) => h.mem_id)).toContain('c0'); // 前态确实在索引里

    const r = await runForgettingCycle(storage, NOW, { weeklyCompress: true, vector });
    expect(r.compressed).toBe(3);
    expect(await vector.search(probe, 10, {})).toHaveLength(0); // 后态：索引副本真被清掉
    for (let i = 0; i < 3; i++) {
      const row = await storage.getMemory(`c${i}`);
      // §2.2 不变量 7「向量源自 L1」不破：冷层补查与 41-T 回填照常工作
      expect(row?.embedding).toEqual(embedSync(`cold ledger row ${i}`, DEFAULT_VECTOR_DIM));
      expect(row?.compressed_at).toBe(NOW);
      expect(row?.version).toBe(2);
    }
    // 幂等：同一周内再跑一轮不重复计数、不重复写回
    const r2 = await runForgettingCycle(storage, NOW, { weeklyCompress: true, vector });
    expect(r2.compressed).toBe(0);
    expect((await storage.getMemory('c0'))?.version).toBe(2);
  });

  it('杀手④：无向量后端时 compressed 必须为 0（不拿冷层行数冒充压缩成绩）', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 3; i++) await storage.putMemory(coldRow(i));
    const r = await runForgettingCycle(storage, NOW, { weeklyCompress: true });
    expect(r.compressed).toBe(0);
    expect((await storage.getMemory('c0'))?.compressed_at).toBeUndefined();
    expect(storage.size).toBe(3); // AC-01：一个字节的知识都没动
  });

  it('压缩范围：cold/archived/dormant 参与，hot/warm 不参与', async () => {
    const storage = new InMemoryStorage();
    const vector = new JsVectorBackend();
    const classes = ['cold', 'archived', 'dormant', 'hot', 'warm'] as const;
    for (let i = 0; i < classes.length; i++) {
      const row = mem({
        mem_id: `x${i}`, category: 'fact', decay_class: classes[i],
        content: `row ${i}`, embedding: embedSync(`row ${i}`, DEFAULT_VECTOR_DIM),
      });
      await storage.putMemory(row);
      await vector.upsert(row.mem_id, row.content, { project_id: 'P1', layer: 'L2' });
    }
    const r = await runForgettingCycle(storage, NOW, { weeklyCompress: true, vector });
    expect(r.compressed).toBe(3);
    expect((await storage.getMemory('x3'))?.compressed_at).toBeUndefined();
    expect((await storage.getMemory('x4'))?.compressed_at).toBeUndefined();
    const probe = embedSync('row 0', vector.dim);
    expect((await vector.search(probe, 10, {})).map((h) => h.mem_id).sort()).toEqual(['x3', 'x4']);
  });
});
