// 记忆库清空重采回归（批次35）：预览只读、清空全删（含墓碑）、审计成对、
// 无管理员/无备份一律拒绝且不动数据、单行失败不中断整库、空库幂等。
import { describe, expect, it } from 'vitest';
import { purgeLedger, scanLedgerForReset } from '../ledgerReset.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync } from '../vector.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
const L1_TEXT = '需求：做一个 SolidWorks 批量导出 STEP 的插件，要求支持整个装配体目录。';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_purge_1',
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

describe('scanLedgerForReset 只读预览', () => {
  it('按层/来源分布统计，含 L0 密文、真实 LLM 产物与墓碑计数；不改动任何数据', async () => {
    const storage = await seeded([
      mem(),
      mem({ mem_id: 'mem_purge_2', layer: 'L2', content_l2: '摘要', refined_by: 'llm' }),
      mem({ mem_id: 'mem_purge_3', created_by_agent: undefined, content_orig: 'AES-256-GCM:…' }),
      mem({ mem_id: 'mem_purge_4', deleted: true }),
    ]);
    const before = await storage.listMemories({ include_deleted: true });
    const p = await scanLedgerForReset(storage);
    expect(p).toMatchObject({ total: 4, with_l0_cipher: 1, llm_refined: 1, tombstones: 1 });
    expect(p.by_layer).toEqual({ L1: 3, L2: 1 });
    expect(p.by_source).toEqual({ 'claude-code': 3, '<未知>': 1 });
    expect(p.sample_ids).toHaveLength(4);
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(before.length);
    expect(await storage.queryAudit({})).toHaveLength(0); // 预览不写审计
  });
});

describe('purgeLedger 整库清空', () => {
  const ok = { admin_user_id: 'admin', request_id: 'req_purge_1', now: NOW, backup_confirmed: true } as const;

  it('删光全部行（含墓碑）并同步摘除向量，留一条 security_change/ledger_purge 审计', async () => {
    const storage = await seeded([mem(), mem({ mem_id: 'mem_purge_2' }), mem({ mem_id: 'mem_purge_3', deleted: true })]);
    const vector = new JsVectorBackend();
    await vector.upsert('mem_purge_1', L1_TEXT, { project_id: 'P1' });

    const report = await purgeLedger({ storage, vector, ...ok });
    expect(report).toMatchObject({ total: 3, purged: 3, failed: 0 });
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(0);

    const hits = await vector.search(embedSync(L1_TEXT), 5, { project_id: 'P1' });
    expect(hits).toHaveLength(0);

    const audits = await storage.queryAudit({ request_id: 'req_purge_1' });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('security_change');
    expect(audits[0].detail?.op).toBe('ledger_purge');
    expect(audits[0].detail?.purged).toBe(3);
  });

  it('缺管理员身份 → 拒绝且一条不删', async () => {
    const storage = await seeded([mem()]);
    await expect(purgeLedger({ storage, request_id: 'req_x', now: NOW, backup_confirmed: true } as never))
      .rejects.toThrow(/管理员/);
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(1);
  });

  it('未确认备份 → 拒绝且一条不删（清空不可逆，备份是唯一退路）', async () => {
    const storage = await seeded([mem()]);
    await expect(purgeLedger({ storage, admin_user_id: 'admin', request_id: 'req_x', now: NOW } as never))
      .rejects.toThrow(/备份/);
    expect(await storage.listMemories({ include_deleted: true })).toHaveLength(1);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('单行删除失败不中断整库：失败行数与 id 如实回显', async () => {
    const storage = await seeded([mem(), mem({ mem_id: 'mem_purge_2' }), mem({ mem_id: 'mem_purge_3' })]);
    const wrapped = Object.create(storage) as InMemoryStorage;
    const orig = storage.deleteMemory.bind(storage);
    wrapped.deleteMemory = async (id: string) => {
      if (id === 'mem_purge_2') throw new Error('写盘被拒绝');
      await orig(id);
    };
    const report = await purgeLedger({ storage: wrapped, ...ok });
    expect(report).toMatchObject({ total: 3, purged: 2, failed: 1 });
    expect(report.failed_ids).toEqual(['mem_purge_2']);
  });

  it('空库幂等：purged=0，重复执行仍然 0', async () => {
    const storage = new InMemoryStorage();
    const first = await purgeLedger({ storage, ...ok, request_id: 'req_purge_a' });
    expect(first).toMatchObject({ total: 0, purged: 0, failed: 0 });
    const second = await purgeLedger({ storage, ...ok, request_id: 'req_purge_b' });
    expect(second.purged).toBe(0);
  });
});
