// 按来源清理网页导出条目（2026-11-17）：判据必须精确（不误伤 workbuddy 等其它来源）、
// 预览只读、无管理员/无备份一律拒绝且不动数据、单行失败不中断整批、审计成对落账。
import { describe, expect, it } from 'vitest';
import {
  WEBCHAT_AGENT_PREFIX,
  isWebchatExportAgent,
  purgeWebchatExports,
  selectWebchatExportMemories,
  webchatSiteFromAgent,
} from '../webchatPurge.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync } from '../vector.ts';
import type { Memory } from '../types.ts';

const NOW = 1_800_000_000_000;

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_wp_1',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'context',
    layer: 'L1',
    content: '个人做的记忆系统怎么变现',
    content_l1: '个人做的记忆系统怎么变现',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: NOW,
    created_by_agent: `${WEBCHAT_AGENT_PREFIX}:deepseek`,
    ...over,
  };
}

async function seeded(mems: Memory[]) {
  const storage = new InMemoryStorage();
  for (const m of mems) await storage.putMemory(m);
  return storage;
}

describe('来源判据：只认 collector:webchat-export（含 :站点）', () => {
  it('三个真来源命中，其它来源一个都不能命中', () => {
    expect(isWebchatExportAgent('collector:webchat-export')).toBe(true);
    expect(isWebchatExportAgent('collector:webchat-export:deepseek')).toBe(true);
    expect(isWebchatExportAgent('collector:webchat-export:doubao')).toBe(true);
    // 别家的对话采集不能被顺手删掉
    expect(isWebchatExportAgent('collector:workbuddy')).toBe(false);
    expect(isWebchatExportAgent('collector:workbuddy-projects')).toBe(false);
    expect(isWebchatExportAgent('collector:deepseek-harness')).toBe(false);
    expect(isWebchatExportAgent('collector:webchat-exports')).toBe(false); // 前缀边界不吞近似名
    expect(isWebchatExportAgent('webchat-export')).toBe(false);            // 少了 collector: 前缀
    expect(isWebchatExportAgent('')).toBe(false);
    expect(isWebchatExportAgent(undefined)).toBe(false);
  });

  it('站点名从来源标识精确取，取不到就 null（不猜）', () => {
    expect(webchatSiteFromAgent('collector:webchat-export:deepseek')).toBe('deepseek');
    expect(webchatSiteFromAgent('collector:webchat-export:Doubao')).toBe('doubao');
    expect(webchatSiteFromAgent('collector:webchat-export')).toBeNull();       // 没站点段
    expect(webchatSiteFromAgent('collector:webchat-export:../evil')).toBeNull(); // 非法站点段
    expect(webchatSiteFromAgent('collector:workbuddy')).toBeNull();
  });
});

describe('selectWebchatExportMemories：只读预览', () => {
  const rows = [
    mem({ mem_id: 'a', created_by_agent: 'collector:webchat-export:deepseek', has_l0: true }),
    mem({ mem_id: 'b', created_by_agent: 'collector:webchat-export:deepseek' }),
    mem({ mem_id: 'c', created_by_agent: 'collector:webchat-export:doubao', layer: 'L2' }),
    mem({ mem_id: 'd', created_by_agent: 'collector:workbuddy' }),
    mem({ mem_id: 'e', created_by_agent: 'collector:webchat-export:deepseek', deleted: true }),
  ];

  it('按站点/层级统计，墓碑单列且不进待删数', () => {
    const { candidates, preview } = selectWebchatExportMemories(rows);
    expect(candidates.map((m) => m.mem_id)).toEqual(['a', 'b', 'c']);
    expect(preview.total).toBe(3);
    expect(preview.by_site).toEqual({ deepseek: 2, doubao: 1 });
    expect(preview.by_layer).toEqual({ L1: 2, L2: 1 });
    expect(preview.with_l0_cipher).toBe(1);
    expect(preview.tombstones).toBe(1);
    expect(preview.sample_ids).toContain('a');
  });

  it('指定站点时只挑该站点', () => {
    const { candidates, preview } = selectWebchatExportMemories(rows, { site: 'doubao' });
    expect(candidates.map((m) => m.mem_id)).toEqual(['c']);
    expect(preview.by_site).toEqual({ doubao: 1 });
  });
});

describe('purgeWebchatExports：执行、门禁与审计', () => {
  it('无管理员 / 未确认备份 → 抛错且一行都不删', async () => {
    const storage = await seeded([mem({ mem_id: 'a' })]);
    await expect(purgeWebchatExports({
      storage, admin_user_id: '', request_id: 'r1', now: NOW, backup_confirmed: true,
    })).rejects.toThrow(/管理员/);
    await expect(purgeWebchatExports({
      storage, admin_user_id: 'u1', request_id: 'r1', now: NOW,
      backup_confirmed: false as unknown as true,
    })).rejects.toThrow(/备份/);
    expect(await storage.getMemory('a')).not.toBeNull();
  });

  it('只删网页导出来源，其它来源原样保留；向量同步摘除', async () => {
    const vector = new JsVectorBackend();
    const keep = mem({ mem_id: 'keep', created_by_agent: 'collector:workbuddy' });
    const gone = mem({ mem_id: 'gone' });
    const storage = await seeded([keep, gone]);
    // 真实签名：upsert(mem_id, text, filter) / search(vec, k, filter)
    await vector.upsert('gone', gone.content_l1 ?? gone.content, { project_id: 'P1' });
    await vector.upsert('keep', keep.content_l1 ?? keep.content, { project_id: 'P1' });

    const report = await purgeWebchatExports({
      storage, vector, admin_user_id: 'u1', request_id: 'r2', now: NOW, backup_confirmed: true,
    });

    expect(report.total).toBe(1);
    expect(report.purged).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.by_site).toEqual({ deepseek: 1 });
    expect(await storage.getMemory('gone')).toBeNull();
    expect(await storage.getMemory('keep')).not.toBeNull();
    // 向量索引里不能再留已删正文（否则召回会命中空壳）
    const hits = await vector.search(embedSync('个人做的记忆系统怎么变现'), 5, { project_id: 'P1' });
    expect(hits.map((h) => h.mem_id)).not.toContain('gone');
    expect(hits.map((h) => h.mem_id)).toContain('keep');
  });

  it('单行失败不中断整批，如实计数并留样本 id', async () => {
    const storage = await seeded([mem({ mem_id: 'a' }), mem({ mem_id: 'boom' }), mem({ mem_id: 'c' })]);
    const failing: StorageBackendFail = storage as unknown as StorageBackendFail;
    const original = failing.deleteMemory.bind(failing);
    failing.deleteMemory = async (id: string) => {
      if (id === 'boom') throw new Error('E_IO');
      return original(id);
    };

    const report = await purgeWebchatExports({
      storage, admin_user_id: 'u1', request_id: 'r3', now: NOW, backup_confirmed: true,
    });

    expect(report.purged).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.failed_ids).toEqual(['boom']);
    expect(await storage.getMemory('boom')).not.toBeNull(); // 失败就是没删，不假装删了
  });

  it('审计落一条 security_change/op=webchat_export_purge，数量与分布都在', async () => {
    const storage = await seeded([
      mem({ mem_id: 'a' }),
      mem({ mem_id: 'b', created_by_agent: 'collector:webchat-export:doubao' }),
    ]);
    await purgeWebchatExports({
      storage, admin_user_id: 'u1', request_id: 'r4', now: NOW, backup_confirmed: true,
    });
    const audits = await storage.queryAudit({ action: 'security_change' });
    const hit = audits.find((a) => (a.detail as { op?: string }).op === 'webchat_export_purge');
    expect(hit).toBeTruthy();
    const d = hit!.detail as { total: number; purged: number; by_site: Record<string, number>; sample_ids: string[] };
    expect(d.total).toBe(2);
    expect(d.purged).toBe(2);
    expect(d.by_site).toEqual({ deepseek: 1, doubao: 1 });
    expect(Array.isArray(d.sample_ids)).toBe(true);
  });

  it('空库 / 没有网页导出条目 → 幂等：0 条、不抛错', async () => {
    const storage = await seeded([mem({ mem_id: 'k', created_by_agent: 'collector:workbuddy' })]);
    const report = await purgeWebchatExports({
      storage, admin_user_id: 'u1', request_id: 'r5', now: NOW, backup_confirmed: true,
    });
    expect(report.total).toBe(0);
    expect(report.purged).toBe(0);
  });
});

/** 只用来给 deleteMemory 打桩的最小形状（避免在测试里造完整 StorageBackend 类型） */
interface StorageBackendFail {
  deleteMemory: (id: string) => Promise<unknown>;
}
