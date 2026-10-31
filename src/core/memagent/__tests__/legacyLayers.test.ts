// 遗留账本清理回归（批次24）：只降级「未接 LLM 却带 L2–L6」的历史行；
// 真实 LLM 产物/正常 L1 行不碰；缺 L1 的行跳过不伪造；重跑幂等；执行必须带管理员身份并留审计。
import { describe, expect, it } from 'vitest';
import { demoteStubLayers, isMislabeledLayer, isStubDeepLayered, scanStubLayers } from '../legacyLayers.ts';
import { InMemoryStorage } from '../storage.ts';
import { sha256hex } from '../sync.ts';
import { embedSync } from '../vector.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
const L1_TEXT = '部署踩坑：staging 集群 docker compose v2 需要重新登录仓库，令牌 12 小时过期。';
const STUB_L2 = '本段围绕上述主题展开，关键结论与约束已在文中标注，类型标签为 fact。';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_legacy_1',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'pitfall',
    layer: 'L2',
    content: STUB_L2,          // 旧口径：可召回正文 = stub L2
    content_l1: L1_TEXT,       // 真实 L1 脱敏原文
    content_l2: STUB_L2,
    content_l3: '[得失分析] 成功点：略；失败点：略。',
    content_l4: '[模式归纳] 令牌定期刷新。适用场景：CI 部署。',
    content_l5: '[洞察提炼] 过期即失败；边界条件：无。',
    content_l6: '{"keywords":["docker"],"projections":[]}',
    layer_specs: {
      L1: 'v1:清洗脱敏', L2: 'v1:会话摘要', L3: 'v1:得失分析',
      L4: 'v1:模式归纳', L5: 'v1:洞察提炼', L6: 'v1:投影索引',
    },
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: NOW,
    ...over,
  };
}

async function seeded(mems: Memory[]) {
  const storage = new InMemoryStorage();
  for (const m of mems) await storage.putMemory(m);
  return storage;
}

const run = (storage: InMemoryStorage, admin_user_id = 'admin') =>
  demoteStubLayers({ storage, admin_user_id, request_id: 'req_legacy_test', now: NOW });

describe('isStubDeepLayered 判定', () => {
  it('带 L2–L6 且 refined_by 不是 llm → 命中', () => {
    expect(isStubDeepLayered(mem())).toBe(true);            // 旧行没有 refined_by 字段
    expect(isStubDeepLayered(mem({ refined_by: 'stub' }))).toBe(true);
  });

  it('真实 LLM 产物 / 纯 L1 行 / 只有 content 的摘要行 → 不命中', () => {
    expect(isStubDeepLayered(mem({ refined_by: 'llm' }))).toBe(false);
    const l1Only = mem({ layer: 'L1', content: L1_TEXT, content_l2: undefined, content_l3: undefined, content_l4: undefined, content_l5: undefined, content_l6: undefined, refined_by: 'stub' });
    expect(isStubDeepLayered(l1Only)).toBe(false);
    expect(isStubDeepLayered(mem({ content_l2: '   ', content_l3: undefined, content_l4: undefined, content_l5: undefined, content_l6: undefined }))).toBe(false);
  });
});

describe('demoteStubLayers 正常路径', () => {
  it('历史行降级回 L1：正文回填、深层删除、规格与指纹重算、版本推进', async () => {
    const storage = await seeded([mem()]);
    const report = await run(storage);

    expect(report).toMatchObject({ scanned: 1, hits: 1, demoted: 1, skipped: 0, missing_l1: 0, by_layer: { L2: 1 } });
    expect(report.sample_ids).toEqual(['mem_legacy_1']);

    const after = await storage.getMemory('mem_legacy_1');
    expect(after?.layer).toBe('L1');
    expect(after?.content).toBe(L1_TEXT);
    expect(after?.content_l1).toBe(L1_TEXT);
    expect([after?.content_l2, after?.content_l3, after?.content_l4, after?.content_l5, after?.content_l6])
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(after?.layer_specs).toEqual({ L1: 'v1:清洗脱敏' });
    expect(after?.refined_by).toBe('stub');
    expect(after?.sha256).toBe(sha256hex(L1_TEXT));
    expect(after?.version).toBe(2);
    expect(after?.updated_at).toBe(NOW);
    expect(after?.layers_generated_at).toBe(NOW); // 批次27 P3-3：降级=重建层级内容，按批次24-F 口径打戳
  });

  it('执行留一条 security_change 审计（op=legacy_layer_demote），正文与口令不进账本', async () => {
    const storage = await seeded([mem()]);
    await run(storage);
    const rows = await storage.queryAudit({ action: 'security_change' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('admin');
    expect(rows[0].detail).toMatchObject({ op: 'legacy_layer_demote', scanned: 1, hits: 1, demoted: 1 });
    expect(JSON.stringify(rows[0].detail)).not.toContain(L1_TEXT);
  });

  it('重跑幂等：第二次没有可降级行了', async () => {
    const storage = await seeded([mem()]);
    await run(storage);
    const second = await run(storage);
    expect(second).toMatchObject({ scanned: 1, hits: 0, demoted: 0 });
  });

  it('向量原样保留：历史行的向量本就按 L1 生成（实测与 embedSync(content_l1) 余弦 1.0），降级不重算', async () => {
    const fromL1 = embedSync(L1_TEXT, 8);
    const withVec = mem({ mem_id: 'mem_vec', embedding: fromL1 });
    const noVec = mem({ mem_id: 'mem_novec' });
    const storage = await seeded([withVec, noVec]);

    await run(storage);
    expect((await storage.getMemory('mem_vec'))?.embedding).toEqual(fromL1);
    expect((await storage.getMemory('mem_novec'))?.embedding).toBeUndefined();
  });
});

describe('demoteStubLayers 拒绝与边界', () => {
  it('缺管理员身份 → 抛错，账本一字不改', async () => {
    const storage = await seeded([mem()]);
    await expect(run(storage, '')).rejects.toThrow(/管理员身份/);
    const still = await storage.getMemory('mem_legacy_1');
    expect(still?.layer).toBe('L2');
    expect(still?.content).toBe(STUB_L2);
    expect(await storage.queryAudit({ action: 'security_change' })).toHaveLength(0);
  });

  it('命中但缺 L1 正文：跳过并计数，绝不伪造内容', async () => {
    const storage = await seeded([mem({ content_l1: undefined }), mem({ mem_id: 'mem_legacy_2' })]);
    const report = await run(storage);
    expect(report).toMatchObject({ scanned: 2, hits: 2, demoted: 1, skipped: 1, missing_l1: 1 });
    const untouched = await storage.getMemory('mem_legacy_1');
    expect(untouched?.layer).toBe('L2');
    expect(untouched?.content).toBe(STUB_L2);
  });

  it('混合账本：只动脏行，正常 L1 行与真实 LLM 行原样保留', async () => {
    const clean = mem({
      mem_id: 'mem_l1', layer: 'L1', content: L1_TEXT,
      content_l2: undefined, content_l3: undefined, content_l4: undefined, content_l5: undefined, content_l6: undefined,
      layer_specs: { L1: 'v1:清洗脱敏' }, refined_by: 'stub',
    });
    const realLlm = mem({ mem_id: 'mem_llm', refined_by: 'llm', content: STUB_L2 });
    const storage = await seeded([clean, realLlm, mem({ mem_id: 'mem_dirty' })]);

    const preview = await scanStubLayers(storage);
    expect(preview).toMatchObject({ scanned: 3, hits: 1, missing_l1: 0, by_layer: { L2: 1 } });

    const report = await run(storage);
    expect(report).toMatchObject({ scanned: 3, hits: 1, demoted: 1 });
    expect((await storage.getMemory('mem_l1'))?.version).toBe(1);
    expect((await storage.getMemory('mem_llm'))?.version).toBe(1);
    expect((await storage.getMemory('mem_dirty'))?.layer).toBe('L1');
  });

  it('空账本：全零报告，不写审计', async () => {
    const storage = await seeded([]);
    expect(await scanStubLayers(storage)).toMatchObject({ scanned: 0, hits: 0 });
    const report = await run(storage);
    expect(report).toMatchObject({ scanned: 0, hits: 0, demoted: 0, sample_ids: [] });
    expect(await storage.queryAudit({ action: 'security_change' })).toHaveLength(1);
  });
});

// 批次28-C：误标层行 —— layer 标成 L2–L6 却没有深层正文（批次28 前的合并摘要行 layer='L3'）。
// 没接 LLM 却以深层身份出现，与 stub 深层行同属遗留脏数据；content 是真实本地正文，可诚实回填 L1。
describe('批次28-C 误标层行（无深层正文却标 L2–L6）', () => {
  const summaryRow = mem({
    mem_id: 'mem_sum', layer: 'L3', content: '【摘要】docker 部署三步 / 令牌 12h 过期 / 提前刷新',
    content_l1: undefined, content_l2: undefined, content_l3: undefined,
    content_l4: undefined, content_l5: undefined, content_l6: undefined,
  });

  it('isMislabeledLayer：L2–L6 无深层正文且非 LLM 产物 → 命中；L0/L1/真实 LLM 行不命中', () => {
    expect(isMislabeledLayer(summaryRow)).toBe(true);
    expect(isMislabeledLayer(mem({ layer: 'L0' as Memory['layer'], content: '密文', content_l0_enc: '{}' }))).toBe(false);
    expect(isMislabeledLayer(mem({ layer: 'L1', content: L1_TEXT }))).toBe(false);
    expect(isMislabeledLayer(mem({ refined_by: 'llm' }))).toBe(false);
  });

  it('降级：用 content 诚实回填 L1（不伪造），layer 归 L1，审计带 mislabeled 计数', async () => {
    const storage = await seeded([summaryRow]);
    const preview = await scanStubLayers(storage);
    expect(preview).toMatchObject({ scanned: 1, hits: 1, mislabeled: 1, missing_l1: 0, by_layer: { L3: 1 } });

    const report = await run(storage);
    expect(report).toMatchObject({ hits: 1, demoted: 1, mislabeled: 1 });
    const after = await storage.getMemory('mem_sum');
    expect(after?.layer).toBe('L1');
    expect(after?.content).toContain('【摘要】docker 部署三步');
    expect(after?.content_l1).toBe(after?.content);
    expect(after?.refined_by).toBe('stub');
    expect(after?.sha256).toBe(sha256hex(after!.content));

    const rows = await storage.queryAudit({ action: 'security_change' });
    expect(rows[0].detail).toMatchObject({ op: 'legacy_layer_demote', mislabeled: 1 });
  });

  it('stub 深层行缺 content_l1 时仍跳过：其 content 是假 L2 正文，绝不当 L1 回填', async () => {
    const storage = await seeded([mem({ content_l1: undefined }), summaryRow]);
    const report = await run(storage);
    expect(report).toMatchObject({ scanned: 2, hits: 2, demoted: 1, skipped: 1, missing_l1: 1, mislabeled: 1 });
    expect((await storage.getMemory('mem_legacy_1'))?.layer).toBe('L2');
  });
});
