// 按 L0 重建 L1–L6 回归（批次37-E）：预览只读但真读原文、执行覆盖正文并重算指纹/向量/戳、
// 按当前质量门删应删行、pinned/locked 与取不到原文的行一律不碰、缺管理员/缺备份拒绝、
// LLM 可用才炼深层（残缺如实 llm_partial）、四类取不到原因码各有一条、L0 原文绝不进审计。
import { describe, expect, it } from 'vitest';
import { makeL0Reader, rebuildLayersFromL0, scanRowsForRebuild } from '../rebuild.ts';
import type { L0Reader } from '../rebuild.ts';
import { QUALITY_GATE_VERSION } from '../qualityGate.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, DEFAULT_VECTOR_DIM, embedSync } from '../vector.ts';
import { sha256hex } from '../sync.ts';
import type { LlmProvider, Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
/** 干净的原文：重建后的 L1 与它一致（无脱敏触发、过质量门） */
/**
 * 批次40-C：一条「有料」的 L1（有效字 245 → `depthCapFor` 给到 L5）。
 * 层级规格现在是**相对**的（产物长度由源文算出），短 L1 只能炼到 L2——五层全合规的用例必须有足够的料。
 */
const CLEAN = '线上事故复盘：支付接口在高峰期大面积超时，根因是连接池配置项 pool_size=5 过小，压测时未覆盖真实并发量。'
  + '排查过程：先看网关 5xx 曲线，再对比数据库活跃连接数，确认连接等待队列堆积；把 pool_size 从 5 调到 50 并加上超时回收后恢复正常。'
  + '后续动作：压测脚本补上并发档位，配置项进代码仓库并加评审；同时在告警里增加连接池饱和度指标，避免下次只能靠人肉看曲线定位。'
  + '教训：容量类参数不能按开发机经验拍脑袋，必须按峰值流量的两倍预留，并且要有一个可观测指标兜底，'
  + '否则每次都要从零排查一遍，故障恢复时间完全取决于谁值班、谁恰好看过这条曲线。';
/** 逐层落在各自压缩区间内的合规产物链（与 CLEAN 同源算出，见 layerBand） */
const LADDER: Record<string, string> = {
  L2: '支付接口高峰期大面积超时的根因是连接池配置项 pool_size=5 过小，压测未覆盖真实并发；'
    + '排查靠网关 5xx 曲线对比数据库活跃连接数，确认等待队列堆积。把配置项调到 50 并加超时回收后恢复，'
    + '后续把并发档位补进压测脚本、配置项入仓评审，并新增连接池饱和度告警指标。',
  L3: '成功点：用两条曲线对比快速定位到连接池根因，改配置项后立即恢复。失败点：上线前压测没覆盖真实并发量，容量参数按开发机经验拍脑袋。'
    + '教训：容量类配置项必须按峰值流量两倍预留，并配一个可观测指标兜底，否则故障恢复时间取决于谁值班。',
  L4: '适用场景：接口偶发超时、错误码集中在网关层的容量类故障。做法：先对齐入口错误率与资源活跃连接数两条曲线，'
    + '确认是等待堆积而非代码缺陷，再按峰值流量两倍预留配置项，并补一个资源饱和度指标做告警兜底。',
  L5: '边界条件：只适用于等待队列堆积（连接池或线程池饱和）；若表现为单请求耗时上升，则属代码或下游变慢，不适用。',
};
/** 带敏感串的原文：重建后的 L1 必须被脱敏（与行上裸奔的旧 L1 不同） */
const RAW_SENSITIVE = '排查记录：登录 10.0.8.12 报错 ECONNREFUSED，联系 zhang.san@example.com 后改为 8204 端口恢复。';
/** 按当前质量门该删的原文（过程旁白） */
const NARRATION = '我先看一下当前目录情况和开发环境（SolidWorks 版本、.NET 环境等）。';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_rb_1',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: CLEAN,
    content_l1: CLEAN,
    content_orig: CLEAN,
    layer_specs: { L1: 'v1:清洗脱敏' },
    refined_by: 'stub',
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

/** 行上明文的读取器：本模块多数用例只验判定与改写，不需要真解密 */
const plainReader: L0Reader = (m) => Promise.resolve(
  m.content_orig
    ? { ok: true as const, from: 'row_plaintext' as const, text: m.content_orig }
    : { ok: false as const, code: 'no_source' as const, reason: '无 L0 原文' },
);

const ok = { admin_user_id: 'admin', request_id: 'req_rb_1', now: NOW, backup_confirmed: true } as const;

/** 逐层合规的假 LLM：每层字数区间（批次40 起随源文相对）与格式契约都满足 checkLayerSpec */
function goodLlm(): LlmProvider & { calls: number } {
  const out: Record<string, string> = {
    ...LADDER,
    L6: JSON.stringify({ keywords: ['连接池', '超时', '容量', '压测', '告警'], projections: ['接口超时排查'] }),
  };
  const p = {
    calls: 0,
    listModels: () => [],
    call: async () => ({ text: '', tokens: 0 }),
    isStub: false,
    async refineLayer(_model: string, layer: string, _input: string): Promise<string> {
      p.calls++;
      return out[layer] ?? '';
    },
  };
  return p;
}

describe('scanRowsForRebuild 只读预览', () => {
  it('分类计数正确，且不写任何行、不写审计', async () => {
    const storage = await seeded([
      mem({ mem_id: 'mem_rb_1', content_orig: NARRATION }),                 // 原文按当前门该删
      mem({ mem_id: 'mem_rb_2', content_orig: RAW_SENSITIVE, content_l1: RAW_SENSITIVE }), // 重炼后 L1 会变
      mem({ mem_id: 'mem_rb_3', content_orig: NARRATION, pinned: true }),    // 受保护：不判
      mem({ mem_id: 'mem_rb_4', content_orig: undefined }),                  // 取不到原文
      mem({ mem_id: 'mem_rb_5', deleted: true }),                            // 墓碑
      mem({ mem_id: 'mem_rb_6' }),                                           // 重炼后 L1 不变
    ]);
    const auditBefore = await storage.queryAudit({});
    const p = await scanRowsForRebuild({ storage, readL0: plainReader });
    expect(p).toMatchObject({
      gate_version: QUALITY_GATE_VERSION,
      total: 6, tombstones: 1,
      rebuild: 2, rebuild_l1_changed: 1,
      purge: 1, protected_total: 1,
      unavailable: 1, llm_available: false,
    });
    expect(p.by_code).toEqual({ narration: 1 });
    expect(p.by_unavailable).toEqual({ no_source: 1 });
    expect(p.sample.map((s) => s.mem_id)).not.toContain('mem_rb_5');
    // 只读：行数与审计条数一字不变
    expect((await storage.listMemories({ include_deleted: true })).length).toBe(6);
    expect((await storage.queryAudit({})).length).toBe(auditBefore.length);
  });

  it('不调 LLM 时把「当前带 L2–L6 的行」如实计成将被清空', async () => {
    const storage = await seeded([mem({ content_l2: '旧的深层产物', content_l3: '还是旧的' })]);
    expect((await scanRowsForRebuild({ storage, readL0: plainReader })).rebuild_deep_cleared).toBe(1);
    const withLlm = await scanRowsForRebuild({ storage, readL0: plainReader, llmAvailable: true });
    expect(withLlm.rebuild_deep_cleared).toBe(0);
    expect(withLlm.llm_available).toBe(true);
  });
});

describe('rebuildLayersFromL0 门禁与拒绝', () => {
  it('缺管理员 / 缺备份确认 → 抛错且一行不改', async () => {
    const storage = await seeded([mem({ content_orig: NARRATION })]);
    const before = await storage.listMemories({ include_deleted: true });
    await expect(rebuildLayersFromL0({
      storage, readL0: plainReader, ...ok, admin_user_id: '',
    })).rejects.toThrow(/管理员/);
    await expect(rebuildLayersFromL0({
      storage, readL0: plainReader,
      admin_user_id: 'admin', request_id: 'req_rb_2', now: NOW, backup_confirmed: false as unknown as true,
    })).rejects.toThrow(/备份/);
    expect(await storage.listMemories({ include_deleted: true })).toEqual(before);
    expect(await storage.queryAudit({})).toEqual([]);
  });
});

describe('rebuildLayersFromL0 执行', () => {
  it('无 LLM：按原文重炼 L1（脱敏生效）+ 清空 L2–L6 + 重算指纹/向量/戳，审计成对且不含原文', async () => {
    const storage = await seeded([mem({ content_orig: RAW_SENSITIVE, content_l1: RAW_SENSITIVE, content_l2: 'stub 深层', layer: 'L2', content: 'stub 深层' })]);
    const vector = new JsVectorBackend();
    const report = await rebuildLayersFromL0({ storage, vector, readL0: plainReader, ...ok });
    expect(report).toMatchObject({
      total: 1, rebuild: 1, rebuilt: 1, rebuilt_l1_changed: 1,
      purge: 0, purged: 0, deep_cleared: 1, deep_generated: 0, llm_calls: 0, failed: 0,
    });
    const row = (await storage.getMemory('mem_rb_1'))!;
    expect(row.content_l1).not.toContain('zhang.san@example.com');
    expect(row.content_l1).not.toContain('10.0.8.12');
    expect(row.content_l1).toContain(RAW_SENSITIVE.slice(0, 5));
    expect(row.layer).toBe('L1');
    expect(row.content).toBe(row.content_l1);
    expect(row.content_l2).toBeUndefined();
    expect(row.refined_by).toBe('stub');
    expect(row.layer_specs).toEqual({ L1: 'v1:清洗脱敏' });
    expect(row.layers_generated_at).toBe(NOW);
    expect(row.quality_gate_v).toBe(QUALITY_GATE_VERSION);
    expect(row.version).toBe(2);
    expect(row.sha256).toBe(sha256hex(row.content_l1!));
    expect(row.embedding).toEqual(embedSync(row.content_l1!, vector.dim));
    // L0 原文的位置不许被本模块动
    expect(row.content_orig).toBe(RAW_SENSITIVE);
    // 语义向量按新 L1 重建：以新 L1 检索应命中本条
    expect((await vector.search(embedSync(row.content_l1!, vector.dim), 5, { project_id: 'P1' }))
      .some((h) => h.mem_id === 'mem_rb_1')).toBe(true);
    const audits = await storage.queryAudit({ request_id: 'req_rb_1' });
    const ops = audits.filter((a) => a.action === 'memory_op');
    const summary = audits.find((a) => a.action === 'security_change');
    expect(ops.length).toBe(1);
    expect(ops[0].detail).toMatchObject({ op: 'l0_rebuild_row', source: 'row_plaintext', to_layer: 'L1', refined_by: 'stub' });
    expect(JSON.stringify(ops[0].detail)).not.toContain('zhang.san@example.com');
    expect(summary!.detail).toMatchObject({ op: 'layers_rebuild', rebuild: 1, purge: 0, use_llm: false });
    expect(JSON.stringify(summary)).not.toContain(RAW_SENSITIVE);
  });

  it('按当前质量门：原文该拦的行删掉 + 向量摘除 + 每行 rebuild_purge 审计', async () => {
    const storage = await seeded([mem({ mem_id: 'mem_rb_1', content_orig: NARRATION })]);
    const vector = new JsVectorBackend();
    await vector.upsert('mem_rb_1', NARRATION, { project_id: 'P1' });
    const report = await rebuildLayersFromL0({ storage, vector, readL0: plainReader, ...ok });
    expect(report).toMatchObject({ purge: 1, purged: 1, rebuilt: 0, by_code: { narration: 1 } });
    expect(await storage.listMemories({})).toEqual([]);
    expect((await vector.search(embedSync(NARRATION), 5, { project_id: 'P1' })).length).toBe(0);
    const audits = await storage.queryAudit({ request_id: 'req_rb_1' });
    expect(audits.find((a) => a.action === 'memory_op')!.detail).toMatchObject({ op: 'rebuild_purge', filter_code: 'narration' });
  });

  it('pinned/locked 与取不到原文的行：一行都不碰，只在回执里计数', async () => {
    const storage = await seeded([
      mem({ mem_id: 'mem_rb_p', content_orig: NARRATION, pinned: true }),
      mem({ mem_id: 'mem_rb_l', content_orig: NARRATION, locked: true }),
      mem({ mem_id: 'mem_rb_n', content_orig: undefined }),
    ]);
    const before = await storage.listMemories({ include_deleted: true });
    const report = await rebuildLayersFromL0({ storage, readL0: plainReader, ...ok });
    expect(report).toMatchObject({ skipped_protected: 2, skipped_unavailable: 1, rebuilt: 0, purged: 0 });
    const after = await storage.listMemories({ include_deleted: true });
    expect(after.find((m) => m.mem_id === 'mem_rb_p')!.content_orig).toBe(NARRATION);
    expect(after.find((m) => m.mem_id === 'mem_rb_n')!.content_orig).toBeUndefined();
    expect(after.map((m) => m.version)).toEqual(before.map((m) => m.version));
    expect(await storage.queryAudit({})).toHaveLength(1); // 只有整轮汇总，没有逐行 op
  });

  it('有真实 LLM：L2–L6 逐层生成、refined_by=llm、主内容落到最深的那层', async () => {
    const storage = await seeded([mem({ mem_id: 'mem_rb_1' })]);
    const llm = goodLlm();
    const report = await rebuildLayersFromL0({
      storage, readL0: plainReader, llm, llmModel: 'fake-1', ...ok,
    });
    expect(report).toMatchObject({ rebuilt: 1, deep_generated: 5, llm_calls: 5, refine_failed: 0 });
    const row = (await storage.getMemory('mem_rb_1'))!;
    expect(row.layer).toBe('L6');
    expect(row.refined_by).toBe('llm');
    expect(row.content).toBe(row.content_l6);
    expect(Object.keys(row.layer_specs!).sort()).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    // 语义向量仍以 L1 为准（§2.2 不变量 7）
    expect(row.embedding).toEqual(embedSync(row.content_l1!, DEFAULT_VECTOR_DIM));
  });

  it('LLM 中途判废：保留已产出的层，记 llm_partial 与 refine_failed，整轮不中断', async () => {
    const storage = await seeded([mem({ mem_id: 'mem_rb_1' }), mem({ mem_id: 'mem_rb_2' })]);
    const bad: LlmProvider = {
      listModels: () => [],
      call: async () => ({ text: '', tokens: 0 }),
      isStub: false,
      refineLayer: async (_m, layer) => (layer === 'L2' ? LADDER.L2 : ''),
    };
    const report = await rebuildLayersFromL0({ storage, readL0: plainReader, llm: bad, llmModel: 'fake-2', ...ok });
    expect(report).toMatchObject({ rebuilt: 2, refine_failed: 2 });
    const row = (await storage.getMemory('mem_rb_1'))!;
    expect(row.refined_by).toBe('llm_partial');
    expect(row.layer).toBe('L2');
    expect(row.content_l3).toBeUndefined();
  });

  it('useLlm=false 即便有 LLM 也只重建 L1（回执如实标 use_llm）', async () => {
    const storage = await seeded([mem({ content_l2: '旧深层' })]);
    const report = await rebuildLayersFromL0({
      storage, readL0: plainReader, llm: goodLlm(), llmModel: 'fake-1', useLlm: false, ...ok,
    });
    expect(report).toMatchObject({ llm_available: false, llm_calls: 0, deep_cleared: 1, deep_generated: 0 });
    expect((await storage.getMemory('mem_rb_1'))!.content_l2).toBeUndefined();
  });
});

describe('makeL0Reader：L0 原文的四种取不到', () => {
  /** 只读信封的桩库（读取器只用 get；InMemoryL0BlobStore 会拒绝假信封，不该在这儿造假密文） */
  const storeWith = (id: string, envelope: string) => ({
    get: async (mem_id: string) => (mem_id === id ? { envelope, sealed_at: NOW } : null),
  });

  it('has_l0 + 库里有信封 + 能解 → from=l0_store', async () => {
    const reader = makeL0Reader({ l0Blobs: storeWith('mem_rb_1', 'ENV'), decrypt: async () => CLEAN });
    const src = await reader(mem({ content_orig: undefined, has_l0: true }));
    expect(src).toEqual({ ok: true, from: 'l0_store', text: CLEAN });
  });

  it('缺查阅解密口 → view_locked；库里没有 → broken_link；解不开 → bad_envelope；两头都没有 → no_source', async () => {
    const l0 = storeWith('mem_rb_1', 'ENV');
    expect(await makeL0Reader({ l0Blobs: l0 })(mem({ content_orig: undefined, has_l0: true })))
      .toMatchObject({ ok: false, code: 'view_locked' });
    expect(await makeL0Reader({ l0Blobs: l0 })(mem({ mem_id: 'mem_x', content_orig: undefined, has_l0: true })))
      .toMatchObject({ ok: false, code: 'broken_link' });
    expect(await makeL0Reader({ l0Blobs: l0, decrypt: async () => { throw new Error('口令不对'); } })(mem({ content_orig: undefined, has_l0: true })))
      .toMatchObject({ ok: false, code: 'bad_envelope' });
    expect(await makeL0Reader({})(mem({ content_orig: undefined })))
      .toMatchObject({ ok: false, code: 'no_source' });
  });

  it('行上残留信封（未拆分）也走解密，绝不把信封当正文', async () => {
    const src = await makeL0Reader({ decrypt: async () => CLEAN })(mem({ content_orig: undefined, content_l0_enc: 'ENV' }));
    expect(src).toEqual({ ok: true, from: 'row_plaintext', text: CLEAN });
    const locked = await makeL0Reader({})(mem({ content_orig: undefined, content_l0_enc: 'ENV' }));
    expect(locked).toMatchObject({ ok: false, code: 'view_locked' });
  });
});
