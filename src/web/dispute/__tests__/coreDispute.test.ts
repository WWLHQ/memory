// 批次46-3：端壳下沉到内核裁决 API —— 移除硬编码 project_id:'P1' 与 conflict_score:0.8，
// 保持 DisputePage 既有行为回归（对手缺失不抛错、toast/审计行仍可用）。
import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import type { Memory } from '../../../core/memagent/types.ts';
import { coreConflicts, coreVerdict } from '../coreDispute.ts';

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;
const PID = 'P_REAL_NOT_P1';
const CID = 'cf_shell_46_3';

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: o.mem_id ?? 'm', project_id: PID, enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: o.content ?? '部署脚本必须校验 Redis 连接，避免超时',
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: NOW - 2 * DAY,
    ...o,
  };
}

async function seed(storage: InMemoryStorage): Promise<void> {
  await storage.putMemory(mem({
    mem_id: 'old', conflict_id: CID, created_at: NOW - 2 * DAY, confidence: 0.5,
  }));
  await storage.putMemory(mem({
    mem_id: 'new', conflict_id: CID, created_at: NOW - DAY, confidence: 0.6,
    content: '部署脚本必须校验 TLS 证书，避免中间人',
  }));
}

describe('46-3 端壳：配对与裁决均下沉内核（无硬编码）', () => {
  it('coreConflicts 由内核配对：score/type 如实 null，不再硬编码 0.8 与猜测类型', async () => {
    const storage = new InMemoryStorage();
    await seed(storage);
    const list = await coreConflicts({ storage });
    expect(list).toHaveLength(1);
    expect(list[0].conflict_score).toBeNull();
    expect(list[0].conflict_type).toBeNull();
    expect(list[0].old_id).toBe('old');
    expect(list[0].new_id).toBe('new');
    expect(list[0].dispute_flag).toBe(true);
  });

  it('auto_override 走内核：状态真变，审计 project_id 取真实归属而非硬编码 P1', async () => {
    const storage = new InMemoryStorage();
    await seed(storage);
    const [rec] = await coreConflicts({ storage });
    const out = await coreVerdict(rec, 'auto_override', { storage });

    expect(out.kernel_request_ids.length).toBeGreaterThan(0);
    expect((await storage.getMemory('old'))?.decay_class).toBe('archived');
    expect((await storage.getMemory('new'))?.confidence).toBeCloseTo(0.7, 5);
    const audits = await storage.queryAudit({ action: 'conflict_resolve' });
    expect(audits).toHaveLength(1);
    expect(audits[0].project_id).toBe(PID);
    expect(audits[0].detail).toMatchObject({ old_id: 'old', new_id: 'new', pending: false });
  });

  it('merge 走内核：合并记忆归属真实项目，不是 P1', async () => {
    const storage = new InMemoryStorage();
    await seed(storage);
    const [rec] = await coreConflicts({ storage });
    const out = await coreVerdict(rec, 'merge', { storage });
    expect(out.merged_mem_id).toBeDefined();
    expect((await storage.getMemory(out.merged_mem_id!))?.project_id).toBe(PID);
    expect((await storage.getMemory('old'))?.decay_class).toBe('archived');
  });

  it('user_confirm / hold：库状态不变，审计仍记真实项目与 pending=true', async () => {
    for (const v of ['user_confirm', 'hold'] as const) {
      const storage = new InMemoryStorage();
      await seed(storage);
      const [rec] = await coreConflicts({ storage });
      const before = (await storage.listMemories({})).map((m) => ({ ...m }));
      await coreVerdict(rec, v, { storage });
      expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
      const audits = await storage.queryAudit({ action: 'conflict_resolve' });
      expect(audits).toHaveLength(1);
      expect(audits[0].project_id).toBe(PID);
      expect(audits[0].detail).toMatchObject({ pending: true, verdict: v });
    }
  });

  it('对手缺失（测试夹具 ID）→ 如实空态不抛错、零写入，保住 DisputePage toast 回归', async () => {
    const storage = new InMemoryStorage();
    const fake = {
      id: 'cf_fake', old_id: 'mem_020', new_id: 'mem_021',
      old_content: '默认端口 8080', new_content: '默认端口 8443',
      old_confidence: 0.7, new_confidence: 0.8,
      conflict_type: null, conflict_score: null, dispute_flag: true,
      overdue_days: 1, created_at: new Date(NOW).toISOString(),
    };
    const out = await coreVerdict(fake, 'auto_override', { storage });
    expect(out.kernel_request_ids.length).toBeGreaterThan(0);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });
});
