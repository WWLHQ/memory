// 存量规则重判回归（批次36-C）：预览只读、按当前质量门删应删行、pinned/locked 受保护、
// 放行行只重盖版本戳（正文/向量/version 不动）、缺管理员或缺备份一律拒绝且不改数据、
// 单行失败不中断整轮、空库幂等、预览数字与实际回执一致。
import { describe, expect, it } from 'vitest';
import { rejudgeRows, scanRowsForRejudge } from '../rejudge.ts';
import { QUALITY_GATE_VERSION } from '../qualityGate.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync } from '../vector.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
const GOOD = '需求：做一个 SolidWorks 批量导出 STEP 的插件，要求支持整个装配体目录。';
const NARRATION = '我先看一下当前目录情况和开发环境（SolidWorks 版本、.NET 环境等）。';
const IDENTITY = '我是 **Claude Code**，底层使用的是 **Claude Haiku 4.5**（模型 ID：`claude-haiku-4-5`）。'
  + ' 这是 Anthropic 的轻量快速模型，专为高效对话和编程任务设计。';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_rj_1',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: GOOD,
    content_l1: GOOD,
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

const ok = { admin_user_id: 'admin', request_id: 'req_rj_1', now: NOW, backup_confirmed: true } as const;

describe('scanRowsForRejudge 只读预览', () => {
  it('按当前口径给出应删/受保护/需重盖戳/码分布，且不写任何数据与审计', async () => {
    const storage = await seeded([
      mem({ content_l1: NARRATION }),                    // narration → 应删
      mem({ mem_id: 'mem_rj_2', content_l1: IDENTITY }),  // identity → 应删
      mem({ mem_id: 'mem_rj_3', content: '好的好的好的', content_l1: '好的好的好的' }), // thin → 应删
      mem({ mem_id: 'mem_rj_4', content_l1: NARRATION, pinned: true }),                 // 受保护
      mem({ mem_id: 'mem_rj_5' }),                                                       // 放行，需重盖戳
      mem({ mem_id: 'mem_rj_6', quality_gate_v: QUALITY_GATE_VERSION }),                 // 放行，已最新
      mem({ mem_id: 'mem_rj_7', deleted: true }),                                        // 墓碑
      mem({ mem_id: 'mem_rj_8', content: '', content_l1: undefined }),                   // 缺 L1
    ]);
    const before = await storage.listMemories({ include_deleted: true });
    const p = await scanRowsForRejudge(storage);
    expect(p).toMatchObject({
      gate_version: QUALITY_GATE_VERSION,
      total: 8, tombstones: 1, missing_l1: 1,
      purge: 4, purge_protected: 1, keep_restamp: 1, keep_unchanged: 1,
    });
    expect(p.by_code).toEqual({ narration: 2, identity: 1, thin: 1 });
    expect(p.by_layer).toEqual({ L1: 4 });
    expect(p.sample.every((s) => s.action !== 'skip')).toBe(true);
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(before.length);
    expect(await storage.queryAudit({})).toHaveLength(0); // 预览不写审计
  });

  it('历史行没有版本戳字段 → 按 v1 统计，绝不猜最新', async () => {
    const PREV = QUALITY_GATE_VERSION - 1; // 上一版口径（当前 v3，上一版 v2）
    const storage = await seeded([mem(), mem({ mem_id: 'mem_rj_2', quality_gate_v: PREV })]);
    const p = await scanRowsForRejudge(storage);
    expect(p.by_row_gate_version).toEqual({ v1: 1, [`v${PREV}`]: 1 });
  });

  it('缺 content_l1 才退回正文判定（只喂检索层，不解密 L0）', async () => {
    const storage = await seeded([mem({ content_l1: undefined, content: NARRATION })]);
    const p = await scanRowsForRejudge(storage);
    expect(p.purge).toBe(1);
    expect(p.by_code.narration).toBe(1);
  });

  it('批次41-O：with_l0_cipher 只计「将删且带 L0 原文」的行——受保护 purge 跳过、放行/缺 L1 都不计', async () => {
    const storage = await seeded([
      mem({ content_l1: NARRATION, has_l0: true }),                                // 应删 + 带 L0 → 计 1
      mem({ mem_id: 'mem_rj_2', content_l1: NARRATION }),                         // 应删、无 L0 → 不计
      mem({ mem_id: 'mem_rj_3', content_l1: NARRATION, pinned: true, has_l0: true }), // 受保护，执行会跳过 → 不计
      mem({ mem_id: 'mem_rj_4' }),                                                // 放行 → 不计
      mem({ mem_id: 'mem_rj_5', content: '', content_l1: undefined, has_l0: true }), // 缺 L1，不判定 → 不计
    ]);
    const p = await scanRowsForRejudge(storage);
    expect(p.purge).toBe(3);
    expect(p.purge_protected).toBe(1);
    expect(p.with_l0_cipher).toBe(1);
  });
});

describe('rejudgeRows 存量重判', () => {
  it('删应删行 + 摘向量 + 每行一条 memory_op 与整轮一条 security_change；放行行只重盖版本戳', async () => {
    const storage = await seeded([
      mem({ content_l1: NARRATION }),
      mem({ mem_id: 'mem_rj_2' }),
    ]);
    const vector = new JsVectorBackend();
    await vector.upsert('mem_rj_1', NARRATION, { project_id: 'P1' });
    await vector.upsert('mem_rj_2', GOOD, { project_id: 'P1' });

    const report = await rejudgeRows({ storage, vector, ...ok });
    expect(report).toMatchObject({ purge: 1, purged: 1, restamped: 1, failed: 0 });

    const left = await storage.listMemories({ include_deleted: true });
    expect(left).toHaveLength(1);
    expect(left[0].mem_id).toBe('mem_rj_2');
    // 放行行：正文/层级/version 一字不改，只多一个版本戳
    expect(left[0].content).toBe(GOOD);
    expect(left[0].content_l1).toBe(GOOD);
    expect(left[0].version).toBe(1);
    expect(left[0].quality_gate_v).toBe(QUALITY_GATE_VERSION);

    // 被删行的向量已摘除：按它的文本检索不再命中它（存活行的向量保留）
    const hitsAfterPurge = await vector.search(embedSync(NARRATION), 5, { project_id: 'P1' });
    expect(hitsAfterPurge.some((h) => h.mem_id === 'mem_rj_1')).toBe(false);
    expect((await vector.search(embedSync(GOOD), 5, { project_id: 'P1' })).some((h) => h.mem_id === 'mem_rj_2')).toBe(true);

    const audits = await storage.queryAudit({ request_id: 'req_rj_1' });
    const perRow = audits.filter((a) => a.action === 'memory_op' && a.detail?.op === 'rejudge_purge');
    expect(perRow).toHaveLength(1);
    expect(perRow[0].detail).toMatchObject({ mem_id: 'mem_rj_1', filter_code: 'narration', gate_version: QUALITY_GATE_VERSION });
    const summary = audits.filter((a) => a.action === 'security_change');
    expect(summary).toHaveLength(1);
    expect(summary[0].detail).toMatchObject({ op: 'rules_rejudge', purged: 1, restamped: 1, by_code: { narration: 1 } });
  });

  it('pinned / locked 命中也不删，只如实计数', async () => {
    const storage = await seeded([
      mem({ content_l1: NARRATION, pinned: true }),
      mem({ mem_id: 'mem_rj_2', content_l1: IDENTITY, locked: true }),
    ]);
    const report = await rejudgeRows({ storage, ...ok, request_id: 'req_rj_prot' });
    expect(report).toMatchObject({ purge: 2, purged: 0, skipped_protected: 2 });
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(2);
  });

  it('缺 L1 正文的行不判定、不删除（交给遗留账本清理，本模块不猜）', async () => {
    const storage = await seeded([mem({ content: '', content_l1: undefined })]);
    const report = await rejudgeRows({ storage, ...ok, request_id: 'req_rj_nol1' });
    expect(report).toMatchObject({ missing_l1: 1, skipped_no_l1: 1, purged: 0, restamped: 0 });
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(1);
  });

  it('缺管理员身份 → 拒绝且一条不删', async () => {
    const storage = await seeded([mem({ content_l1: NARRATION })]);
    await expect(rejudgeRows({ storage, request_id: 'req_x', now: NOW, backup_confirmed: true } as never))
      .rejects.toThrow(/管理员/);
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(1);
  });

  it('未确认备份 → 拒绝且一条不删（删除不可逆，备份是唯一退路）', async () => {
    const storage = await seeded([mem({ content_l1: NARRATION })]);
    await expect(rejudgeRows({ storage, admin_user_id: 'admin', request_id: 'req_x', now: NOW } as never))
      .rejects.toThrow(/备份/);
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(1);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('单行失败不中断整轮：失败行数与 id 如实回显，其余照常处理', async () => {
    const storage = await seeded([
      mem({ content_l1: NARRATION }),
      mem({ mem_id: 'mem_rj_2', content_l1: IDENTITY }),
      mem({ mem_id: 'mem_rj_3', content_l1: '好的好的好的' }),
    ]);
    const wrapped = Object.create(storage) as InMemoryStorage;
    const orig = storage.deleteMemory.bind(storage);
    wrapped.deleteMemory = async (id: string) => {
      if (id === 'mem_rj_2') throw new Error('写盘被拒绝');
      await orig(id);
    };
    const report = await rejudgeRows({ storage: wrapped, ...ok, request_id: 'req_rj_fail' });
    expect(report).toMatchObject({ purge: 3, purged: 2, failed: 1 });
    expect(report.failed_ids).toEqual(['mem_rj_2']);
  });

  it('幂等：第二轮没有应删行、版本戳已最新 → 零改写（预览数字与回执必然一致）', async () => {
    const storage = await seeded([mem({ content_l1: NARRATION }), mem({ mem_id: 'mem_rj_2' })]);
    const first = await rejudgeRows({ storage, ...ok, request_id: 'req_rj_a' });
    const secondPreview = await scanRowsForRejudge(storage);
    const second = await rejudgeRows({ storage, ...ok, request_id: 'req_rj_b' });
    expect(first.purged).toBe(1);
    expect(secondPreview).toMatchObject({ purge: 0, keep_restamp: 0, keep_unchanged: 1 });
    expect(second).toMatchObject({ purged: 0, restamped: 0, failed: 0 });
    expect(secondPreview.purge).toBe(second.purge);
  });

  it('filter 生效：只重判指定项目，其它项目一行不碰', async () => {
    const storage = await seeded([
      mem({ content_l1: NARRATION }),
      mem({ mem_id: 'mem_rj_2', project_id: 'P2', content_l1: NARRATION }),
    ]);
    const report = await rejudgeRows({ storage, ...ok, request_id: 'req_rj_filter', filter: { project_id: 'P1' } });
    expect(report).toMatchObject({ total: 1, purged: 1 });
    expect(await storage.getMemory('mem_rj_2')).toBeTruthy();
  });
});
