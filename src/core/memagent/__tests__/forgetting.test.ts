// REQ-010 遗忘机制契约测试（17.11 AC 覆盖 + 17.7 迁移规则 + 17.6 策略表）
import { describe, expect, it } from 'vitest';
import {
  archiveAgedMemories,
  buildSummary, classifyLayer, clusterSimilar, forgetOne, freshnessOf, hardFilter,
  policyFor, reinforceOne, restoreOne, runForgettingCycle,   scoreMemory, SCORE_WEIGHTS,
  fuseRelevance, fusedRelevanceOf, tokenCoverage, RELEVANCE_FUSION_LAMBDA,
} from '../forgetting.ts';
import { DEFAULT_RECALL_WEIGHTS } from '../../../shared/growthConfig.ts';
import { InMemoryStorage } from '../storage.ts';
import { DEFAULT_VECTOR_DIM, JsVectorBackend, cosine, embedSync } from '../vector.ts';
import { sha256hex } from '../sync.ts';
import { forgettingPrefsFromSnapshot } from '../paramsSnapshot.ts';
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

// 批次61 GAP-1（规格 A1/A2/A4）：召回打分权重从「写死常量」变为「growth:v1 可配置」。
// 红线：缺省入参必须与历史常量逐字一致 —— 未保存过配置的库，召回排序结果不得有任何变化。
describe('GAP-1 召回权重接线（A1/A2/A4）', () => {
  it('A1：SCORE_WEIGHTS 与 shared 真源逐字一致；缺省入参 ≡ 显式传默认值', () => {
    expect(SCORE_WEIGHTS).toEqual(DEFAULT_RECALL_WEIGHTS);
    const m = mem({ importance: 0.6, confidence: 0.7, access_count: 5, created_at: NOW - 5 * DAY });
    expect(scoreMemory(m, 0.9, NOW)).toBe(scoreMemory(m, 0.9, NOW, DEFAULT_RECALL_WEIGHTS));
  });

  it('A2：换权重会改变排序（默认偏向重要度，调高新鲜度后新行反超）', () => {
    // 新但轻：刚创建、重要度/置信度都低、无访问
    const freshThin = mem({
      created_at: NOW - 60 * 1000, importance: 0.1, confidence: 0.1, access_count: 0,
    });
    // 旧但重：创建很久（新鲜度触底 0.05）、重要度/置信度满、访问 10 次（boost 满）
    const staleHeavy = mem({
      created_at: NOW - 1000 * DAY, half_life_days: 1, importance: 1, confidence: 1, access_count: 10,
    });
    // 默认权重（f .35 / i .30 / c .15 / a .20）：旧但重的行在前
    expect(scoreMemory(staleHeavy, 0.9, NOW)).toBeGreaterThan(scoreMemory(freshThin, 0.9, NOW));
    // 自生长把新鲜度权重顶上去（仍是合法配置，和 = 1）：排序反转 —— 证明权重真的参与打分
    const freshHeavy = { w_f: 0.70, w_i: 0.10, w_c: 0.10, w_a: 0.10 };
    expect(scoreMemory(freshThin, 0.9, NOW, freshHeavy))
      .toBeGreaterThan(scoreMemory(staleHeavy, 0.9, NOW, freshHeavy));
  });

  it('A4：墓碑（deleted）与合并影子（merged_into）不进候选，且优先于 pinned 免检', () => {
    expect(hardFilter(mem({ decay_class: 'hot', deleted: true }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'hot', merged_into: 'sum_x' }))).toBe(false);
    // pinned 免检不能救回墓碑/影子 —— 否则用户会看到「已删除」或与摘要重复的原文
    expect(hardFilter(mem({ decay_class: 'hot', pinned: true, deleted: true }))).toBe(false);
    expect(hardFilter(mem({ decay_class: 'hot', pinned: true, merged_into: 'sum_x' }))).toBe(false);
    // 未标记的行不受影响（回归锚点）
    expect(hardFilter(mem({ decay_class: 'hot' }))).toBe(true);
    expect(hardFilter(mem({ decay_class: 'cold', pinned: true }))).toBe(true);
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

describe('批次48 A17 参数页普通配置真实生效', () => {
  it('遗忘速度 → 全局半衰期覆盖；行上 half_life_days 仍优先', () => {
    const plain = mem({ created_at: NOW - 30 * DAY });
    // fact 默认 365 天 → 30 天时 freshness≈0.945；覆盖 30 天后 = 0.5（真实改变判定）
    expect(freshnessOf(plain, NOW)).toBeGreaterThan(0.9);
    expect(freshnessOf(plain, NOW, 30)).toBeCloseTo(0.5, 5);
    const own = mem({ created_at: NOW - 30 * DAY, half_life_days: 60 });
    expect(freshnessOf(own, NOW, 30)).toBeCloseTo(Math.pow(0.5, 0.5), 5); // 行上 60 天优先
    // warm 25 天：内核默认（fact 365）新鲜度≈0.954 → 不降档；覆盖 7 天后 f=0.5^(25/7)≈0.084<0.1 → 降 cold
    expect(classifyLayer(mem({ created_at: NOW - 25 * DAY, decay_class: 'warm' }), NOW)).toBeNull();
    expect(classifyLayer(mem({ created_at: NOW - 25 * DAY, decay_class: 'warm' }), NOW, 7)).toBe('cold');
  });

  it('保留时长 → 到龄自动归档；locked/pinned 豁免；dryRun 只演算不落库', async () => {
    const storage = new InMemoryStorage();
    const old = mem({ mem_id: 'old', category: 'fact', decay_class: 'cold', created_at: NOW - 400 * DAY });
    const pinned = mem({ mem_id: 'pin', category: 'fact', decay_class: 'cold', created_at: NOW - 400 * DAY, pinned: true });
    const locked = mem({ mem_id: 'lock', category: 'fact', decay_class: 'cold', created_at: NOW - 400 * DAY, locked: true });
    await storage.putMemory(old); await storage.putMemory(pinned); await storage.putMemory(locked);

    const dry = await runForgettingCycle(storage, NOW, { autoArchiveDays: 365, dryRun: true });
    expect(dry.archived).toBe(1);                       // 演算计数照实
    expect((await storage.getMemory('old'))?.decay_class).toBe('cold'); // 未落库

    const real = await runForgettingCycle(storage, NOW, { autoArchiveDays: 365 });
    expect(real.archived).toBe(1);
    expect((await storage.getMemory('old'))?.decay_class).toBe('archived');
    expect((await storage.getMemory('pin'))?.decay_class).toBe('cold');
    expect((await storage.getMemory('lock'))?.decay_class).toBe('cold');
    const gcAudits = await storage.queryAudit({ action: 'gc' });
    expect((gcAudits[gcAudits.length - 1].detail as { archived?: number }).archived).toBe(1);

    // 未配置（undefined）→ 完全不归档：与旧行为一致
    const s2 = new InMemoryStorage();
    await s2.putMemory(old);
    expect((await runForgettingCycle(s2, NOW, {})).archived).toBe(0);
    expect((await s2.getMemory('old'))?.decay_class).toBe('cold');
  });

  it('重要程度=锁定 → 全局豁免后台任务：只写 skipped 审计，零迁移零归档', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'x', decay_class: 'hot', created_at: NOW - 400 * DAY }));
    const r = await runForgettingCycle(storage, NOW, { exemptAll: true, autoArchiveDays: 30, halfLifeDays: 7 });
    expect(r.migrated).toBe(0);
    expect(r.archived).toBe(0);
    expect((await storage.getMemory('x'))?.decay_class).toBe('hot');
    const gcAudits = await storage.queryAudit({ action: 'gc' });
    expect(gcAudits[gcAudits.length - 1].detail).toMatchObject({ skipped: true, reason: 'global_importance_locked' });
  });

  it('参数快照折算：三项一起进入调度 prefs；旧快照缺字段不覆盖内核默认', () => {
    const snap = mem({
      mem_id: 'p_snap', category: 'preference', layer: 'L1', user_id: 'system',
      content: `params:v1:${JSON.stringify({ cfg: { forget_speed: 'fast', retention: 'short', importance: 'locked' }, kbs: [], dev: {} })}`,
    });
    expect(forgettingPrefsFromSnapshot([snap])).toEqual({
      enabled: true, halfLifeDays: 7, autoArchiveDays: 30, exemptAll: true,
    });
    // 无快照 / 旧快照（只有 auto_organize）→ 不覆盖
    expect(forgettingPrefsFromSnapshot([])).toEqual({ enabled: true, exemptAll: false });
    const legacy = mem({
      mem_id: 'p_legacy', category: 'preference', layer: 'L1', user_id: 'system',
      content: `params:v1:${JSON.stringify({ cfg: { auto_organize: false }, kbs: [], dev: {} })}`,
    });
    expect(forgettingPrefsFromSnapshot([legacy])).toEqual({ enabled: false, exemptAll: false });
  });
});

// 批次48 A23.2：归档单独成趟（cron 的 archive 任务用它；decay 不再顺带归档）
describe('archiveAgedMemories（独立归档趟）', () => {
  it('只归档到龄行，不碰层迁移；locked/pinned/已有归档状态按规则跳过；重复调用幂等', async () => {
    const storage = new InMemoryStorage();
    const old = mem({ mem_id: 'old', decay_class: 'cold', created_at: NOW - 400 * DAY });
    const warmRecent = mem({ mem_id: 'warm', decay_class: 'warm', created_at: NOW - 25 * DAY });
    const pinned = mem({ mem_id: 'pin', decay_class: 'cold', pinned: true, created_at: NOW - 400 * DAY });
    const locked = mem({ mem_id: 'lock', decay_class: 'cold', locked: true, created_at: NOW - 400 * DAY });
    await storage.putMemory(old);
    await storage.putMemory(warmRecent);
    await storage.putMemory(pinned);
    await storage.putMemory(locked);

    expect(await archiveAgedMemories(storage, NOW, { autoArchiveDays: 365 })).toBe(1);
    expect((await storage.getMemory('old'))?.decay_class).toBe('archived');
    // 25 天的 warm 行不在归档趟里被降层（层迁移属于 decay 任务）
    expect((await storage.getMemory('warm'))?.decay_class).toBe('warm');
    expect((await storage.getMemory('pin'))?.decay_class).toBe('cold');
    expect((await storage.getMemory('lock'))?.decay_class).toBe('cold');
    // 幂等：同一批再跑一次不再计数
    expect(await archiveAgedMemories(storage, NOW, { autoArchiveDays: 365 })).toBe(0);
    // 未配置阈值 = 不归档（旧行为）
    expect(await archiveAgedMemories(storage, NOW, {})).toBe(0);
  });

  it('dryRun 只演算计数，不落库', async () => {
    const storage = new InMemoryStorage();
    await storage.putMemory(mem({ mem_id: 'old2', decay_class: 'cold', created_at: NOW - 400 * DAY }));
    expect(await archiveAgedMemories(storage, NOW, { autoArchiveDays: 365, dryRun: true })).toBe(1);
    expect((await storage.getMemory('old2'))?.decay_class).toBe('cold');
  });
});

describe('批次60（A 方案）：query 覆盖率融合，修长文被余弦稀释', () => {
  it('tokenCoverage：全命中=1、部分命中按比例、无命中与空 query=0', () => {
    const doc = new Set(['量子', '子纠', '纠缠']);
    expect(tokenCoverage(['量子', '子纠', '纠缠'], doc)).toBe(1);
    expect(tokenCoverage(['量子', '显卡'], doc)).toBe(0.5);
    expect(tokenCoverage(['无关', '词'], doc)).toBe(0);
    expect(tokenCoverage([], doc)).toBe(0);
  });

  it('λ=0 逐字返回余弦：这是一键回退旧口径的保证，不是巧合', () => {
    for (const c of [0, 0.13, 0.42, 0.9, 1]) {
      expect(fuseRelevance(c, 1, 0)).toBe(c);
      expect(fuseRelevance(c, 0.3, 0)).toBe(c);
    }
  });

  it('覆盖率=0 → 融合分=0：没有共有词不凭空得分（与回显「无命中词不高亮」同口径）', () => {
    expect(fuseRelevance(0.9, 0)).toBe(0);
    expect(fusedRelevanceOf('量子纠缠', '数据库连接池配置说明', 0.9)).toBe(0);
  });

  it('单调性：同一余弦下覆盖率越高分越高；覆盖率=1 时等于 cos^(1-λ)', () => {
    const c = 0.5;
    expect(fuseRelevance(c, 0.9)).toBeGreaterThan(fuseRelevance(c, 0.5));
    expect(fuseRelevance(c, 0.5)).toBeGreaterThan(fuseRelevance(c, 0.2));
    expect(fuseRelevance(c, 1)).toBeCloseTo(Math.pow(c, 1 - RELEVANCE_FUSION_LAMBDA), 10);
  });

  it('核心回归：同样内容只是加长，相关度差距必须被显著拉回', () => {
    const q = '缓存 TTL 过期 超时重试 上限 延迟';
    const core = '该服务 P99 延迟必须低于 200ms；超时重试上限 3 次；本地缓存 TTL 60s 过期。';
    const padded = core + '无关填充内容。'.repeat(120);
    const cosShort = cosine(embedSync(q), embedSync(core));
    const cosLong = cosine(embedSync(q), embedSync(padded));
    // 旧口径的病根：正文一变长，余弦直接掉到 30% 以下
    const ratioCos = cosLong / cosShort;
    expect(ratioCos).toBeLessThan(0.3);
    // 新口径：覆盖率仍为 1，比值被拉回 50% 以上
    const ratioFused = fusedRelevanceOf(q, padded, cosLong) / fusedRelevanceOf(q, core, cosShort);
    expect(ratioFused).toBeGreaterThan(0.5);
    // 坦率记录边界：A 方案是「缓解」不是「根治」——长文仍略低于短文，要根治得走 B/C
    expect(ratioFused).toBeLessThan(1);
  });
});

// 批次61 GAP-2（规格 B4）：净化周期只读聚合 recall / verdict 审计。
// 红线：读审计失败不得阻断遗忘；dry_run 仍零写入（连读都不多做一趟）。
describe('GAP-2 净化侧只读聚合（B4）', () => {
  function audit(action: 'recall' | 'memory_op', ts: number, detail: Record<string, unknown>) {
    return { request_id: `req_${action}_${ts}`, action, form: 'desktop', ts, detail } as never;
  }

  it('gc 审计带 signal_summary，且每个数字都能与审计逐条对上（不估算）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(mem({ mem_id: 'a1', decay_class: 'hot', created_at: NOW - 5 * DAY }));
    await s.appendAudit(audit('recall', NOW - 3000, { hits: 2, evidence_thin: true }));
    await s.appendAudit(audit('recall', NOW - 2000, { hits: 1, evidence_thin: false }));
    await s.appendAudit(audit('memory_op', NOW - 1000, { op: 'reject', mem_id: 'a1' }));
    await s.appendAudit(audit('memory_op', NOW - 900, { op: 'confirm', mem_id: 'a1' }));

    const report = await runForgettingCycle(s, NOW);
    expect(report.migrated).toBe(1);                        // 迁移照常
    expect(report.signal_summary?.ok).toBe(true);
    if (report.signal_summary?.ok) {
      expect(report.signal_summary.summary).toMatchObject({
        recalls: 2, evidence_thin: 1,
        verdicts: { confirm: 1, reject: 1, disputed: 0 },
        reject_ratio: 0.5, rejected_mem_ids: 1,
      });
    }
    const gc = (await s.queryAudit({ action: 'gc' })).at(-1)!;
    const detail = gc.detail as { signal_summary?: { ok: boolean } };
    expect(detail.signal_summary?.ok).toBe(true);           // 审计与返回值同源
  });

  it('审计读不到 → 净化照常跑完（不阻断），signal_summary.ok=false 如实上报', async () => {
    class NoAuditStorage extends InMemoryStorage {
      override async queryAudit(): Promise<never> {
        throw new Error('audit unreadable');
      }
    }
    const s = new NoAuditStorage();
    await s.putMemory(mem({ mem_id: 'a1', decay_class: 'hot', created_at: NOW - 5 * DAY }));
    await s.putMemory(mem({ mem_id: 'a2', decay_class: 'warm', created_at: NOW - 40 * DAY }));

    const report = await runForgettingCycle(s, NOW);
    expect(report.migrated).toBe(2);                        // 衰减没有被审计故障拖死
    expect(report.signal_summary?.ok).toBe(false);
    if (report.signal_summary && !report.signal_summary.ok) {
      expect(report.signal_summary.error).toContain('unreadable');
    }
    expect((await s.getMemory('a1'))?.decay_class).toBe('warm'); // 真实落库
  });

  it('dry_run 仍零写入，且不多跑一趟审计读（report.signal_summary 缺省）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(mem({ mem_id: 'a1', decay_class: 'hot', created_at: NOW - 5 * DAY }));
    const before = (await s.queryAudit({})).length;
    const report = await runForgettingCycle(s, NOW, { dryRun: true });
    expect(report.migrated).toBe(1);                        // 演算计数照常诚实
    expect(report.signal_summary).toBeUndefined();
    expect((await s.queryAudit({})).length).toBe(before);    // 零审计
    expect((await s.getMemory('a1'))?.decay_class).toBe('hot'); // 零落库
  });
});
