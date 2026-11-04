// 存量字段回填回归（批次41-T）：预览只读、缺什么补什么且与写入路径同源、
// 正文/层级/version/updated_at 一字不动、算不出的不猜、受保护行照样补但单列计数、
// 缺管理员或缺备份拒绝且不改数据、注入向量后端才进索引、二次运行幂等、审计不带正文。
import { describe, expect, it } from 'vitest';
import { backfillMissingFields, scanRowsForBackfill } from '../fieldBackfill.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync, DEFAULT_VECTOR_DIM } from '../vector.ts';
import { sha256hex } from '../sync.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
const L1_TEXT = '需求：做一个 SolidWorks 批量导出 STEP 的插件，要求支持整个装配体目录。';
const DEEP_TEXT = '模式：批量转换类需求应先确认装配体层级与命名约定，再决定导出粒度。';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_bf_1',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: L1_TEXT,
    content_l1: L1_TEXT,
    layer_specs: { L1: 'v1:清洗脱敏' },
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: NOW,
    created_by_agent: 'claude-code',
    ...over,
  };
}

async function seeded(mems: Memory[]) {
  const storage = new InMemoryStorage();
  for (const m of mems) await storage.putMemory(m);
  return storage;
}

const ok = { admin_user_id: 'admin', request_id: 'req_bf_1', now: NOW, backup_confirmed: true } as const;

describe('scanRowsForBackfill 只读预览', () => {
  it('按字段缺口给出计数与分布，且不写数据、不落审计', async () => {
    const storage = await seeded([
      mem(),                                                            // 两个字段都缺 → 都可补
      mem({ mem_id: 'mem_bf_2', sha256: sha256hex(L1_TEXT) }),          // 只缺 embedding
      mem({ mem_id: 'mem_bf_3', embedding: embedSync(L1_TEXT, DEFAULT_VECTOR_DIM) }), // 只缺 sha256
      mem({ mem_id: 'mem_bf_4', sha256: sha256hex(L1_TEXT), embedding: embedSync(L1_TEXT, DEFAULT_VECTOR_DIM) }), // 齐全
      mem({ mem_id: 'mem_bf_5', content: '', content_l1: '' }),         // 两个都算不出
      mem({ mem_id: 'mem_bf_6', pinned: true }),                        // 受保护但确实缺字段
      mem({ mem_id: 'mem_bf_7', deleted: true }),                       // 墓碑
    ]);
    const auditBefore = await storage.queryAudit({});
    const before = await storage.listMemories({ include_deleted: true });
    const p = await scanRowsForBackfill(storage);
    expect(p).toMatchObject({
      total: 7, tombstones: 1, already_complete: 1,
      missing_sha256: 4, missing_embedding: 4,
      fillable_rows: 4, protected_rows: 1,
      unfillable_sha256: 1, unfillable_embedding: 1,
    });
    expect(p.by_layer).toEqual({ L1: 4 });
    expect(p.sample.length).toBeLessThanOrEqual(20);
    expect(auditBefore).toHaveLength(0); // 预览不写审计
    // 预览之后账本一字未动
    const after = await storage.listMemories({ include_deleted: true });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('sha256 与 embedding 都算得不出时给 no_content，只算不出向量时给 no_l1', async () => {
    const storage = await seeded([
      mem({ content: '', content_l1: '' }),
      mem({ mem_id: 'mem_bf_b', content: DEEP_TEXT, content_l1: undefined }),
    ]);
    const p = await scanRowsForBackfill(storage);
    expect(p.unfillable_sha256).toBe(1);
    expect(p.unfillable_embedding).toBe(2); // 两行都没有可用的 content_l1
    // 第二行缺 embedding 但 content 在 → 只补 sha256，向量仍算不出
    const row = p.sample.find((s) => s.mem_id === 'mem_bf_b');
    expect(row).toMatchObject({ fill_sha256: true, fill_embedding: false, codes: ['no_l1'] });
    // 第一行两个字段都算不出 → 不进 sample（sample 只收本轮会写盘的行）
    expect(p.sample.some((s) => s.mem_id === 'mem_bf_1')).toBe(false);
  });
});

describe('backfillMissingFields 执行', () => {
  it('补出来的两个字段与写入路径同源（sha256hex(content) / embedSync(content_l1)）', async () => {
    const storage = await seeded([mem()]);
    const report = await backfillMissingFields({ storage, ...ok });
    expect(report).toMatchObject({ fillable_rows: 1, sha256_filled: 1, embedding_filled: 1, failed: 0 });
    const m = await storage.getMemory('mem_bf_1');
    expect(m?.sha256).toBe(sha256hex(L1_TEXT));
    expect(m?.embedding).toEqual(embedSync(L1_TEXT, DEFAULT_VECTOR_DIM));
  });

  it('元数据补齐不是内容改写：正文 / 层级 / version / updated_at 一字不动', async () => {
    const storage = await seeded([mem({ layer: 'L2', content: DEEP_TEXT, updated_at: undefined })]);
    await backfillMissingFields({ storage, ...ok });
    const m = await storage.getMemory('mem_bf_1');
    expect(m).toMatchObject({ layer: 'L2', content: DEEP_TEXT, content_l1: L1_TEXT, version: 1 });
    expect(m?.updated_at).toBeUndefined();
    expect(m?.sha256).toBe(sha256hex(DEEP_TEXT)); // 指纹来源就是行上报的 content
  });

  it('注入向量后端才进索引；不注入时行上向量照真算、indexed 恒 0（不假装建过索引）', async () => {
    const storage = await seeded([mem()]);
    const vector = new JsVectorBackend();
    const report = await backfillMissingFields({ storage, vector, ...ok });
    expect(report).toMatchObject({ embedding_filled: 1, indexed: 1 });
    const hits = await vector.search(embedSync(L1_TEXT, vector.dim ?? DEFAULT_VECTOR_DIM), 5, {});
    expect(hits.map((h) => h.mem_id)).toContain('mem_bf_1');

    const storage2 = await seeded([mem({ mem_id: 'mem_bf_2' })]);
    const r2 = await backfillMissingFields({ storage: storage2, ...ok });
    expect(r2).toMatchObject({ embedding_filled: 1, indexed: 0 });
    expect((await storage2.getMemory('mem_bf_2'))?.embedding).toEqual(embedSync(L1_TEXT, DEFAULT_VECTOR_DIM));
  });

  it('pinned / locked 行照样补（填字段不删不改内容），但回执里单列 protected_rows', async () => {
    const storage = await seeded([mem({ pinned: true }), mem({ mem_id: 'mem_bf_2', locked: true })]);
    const p = await scanRowsForBackfill(storage);
    expect(p.protected_rows).toBe(2);
    const report = await backfillMissingFields({ storage, ...ok });
    expect(report.sha256_filled).toBe(2);
    expect((await storage.getMemory('mem_bf_1'))?.pinned).toBe(true);
  });

  it('算不出的行原样留着：不猜指纹、不拿别的层凑向量', async () => {
    const storage = await seeded([
      mem({ content: '', content_l1: '' }),
      mem({ mem_id: 'mem_bf_b', content_l1: undefined }),
    ]);
    const report = await backfillMissingFields({ storage, ...ok });
    // 第一行两个字段都算不出；第二行 content 在 → 只补 sha256，向量仍不猜
    expect(report).toMatchObject({
      unfillable_sha256: 1, unfillable_embedding: 2,
      missing_sha256: 2, missing_embedding: 2,
      fillable_rows: 1, sha256_filled: 1, embedding_filled: 0,
    });
    const empty = await storage.getMemory('mem_bf_1');
    expect(empty?.sha256).toBeUndefined();
    expect(empty?.embedding).toBeUndefined();
    const b = await storage.getMemory('mem_bf_b');
    expect(b?.sha256).toBe(sha256hex(L1_TEXT));
    expect(b?.embedding).toBeUndefined();
  });

  it('缺管理员或缺备份：拒绝且一行都不改', async () => {
    const storage = await seeded([mem()]);
    const before = JSON.stringify(await storage.listMemories({ include_deleted: true }));
    await expect(backfillMissingFields({ storage, request_id: 'r', now: NOW, backup_confirmed: true } as never))
      .rejects.toThrow(/管理员/);
    await expect(backfillMissingFields({ storage, admin_user_id: 'admin', request_id: 'r', now: NOW } as never))
      .rejects.toThrow(/备份/);
    expect(JSON.stringify(await storage.listMemories({ include_deleted: true }))).toBe(before);
  });

  it('二次运行幂等：fillable=0，不再写行也不留单行审计', async () => {
    const storage = await seeded([mem(), mem({ mem_id: 'mem_bf_2', sha256: sha256hex(L1_TEXT) })]);
    const first = await backfillMissingFields({ storage, ...ok });
    expect(first.fillable_rows).toBe(2);
    const auditCount1 = (await storage.queryAudit({})).length;
    const second = await backfillMissingFields({
      storage, admin_user_id: 'admin', request_id: 'req_bf_2', now: NOW + 1, backup_confirmed: true,
    });
    expect(second).toMatchObject({ fillable_rows: 0, sha256_filled: 0, embedding_filled: 0, failed: 0 });
    const rows = await storage.queryAudit({});
    expect(rows.length).toBe(auditCount1 + 1); // 只多那一条整轮汇总
    expect(rows.filter((r) => r.action === 'memory_op').length).toBe(2); // 单行审计不重复
  });

  it('审计只带字段名与长度，正文与 L1 一个字都不出口', async () => {
    const storage = await seeded([mem()]);
    await backfillMissingFields({ storage, ...ok });
    const json = JSON.stringify(await storage.queryAudit({}));
    expect(json).toContain('field_backfill');
    expect(json).not.toContain('SolidWorks');
    expect(json).not.toContain(L1_TEXT);
    expect(json).not.toContain(sha256hex(L1_TEXT)); // 连算出来的指纹也不回显
  });

  it('汇总审计把 vector_injected 如实写出来（观测「进了索引没有」）', async () => {
    const storage = await seeded([mem()]);
    await backfillMissingFields({ storage, ...ok });
    const json = JSON.stringify(await storage.queryAudit({}));
    expect(json).toContain('"vector_injected":false');
  });
});
