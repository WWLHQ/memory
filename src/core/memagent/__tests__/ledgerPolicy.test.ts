// 批次48 A23：写入查重真的按账本 growth:v1: 配置执行（默认阈值合并 / 账本抬高阈值后不合并）
import { beforeAll, describe, expect, it } from 'vitest';
import { coreWrite } from '../memories.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { GROWTH_PREF_PREFIX } from '../paramsSnapshot.ts';
import type { Memory } from '../types.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault } from './l0Kit.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const NOW = 1_000_000;
const SEED = '报表导出与权限审计：每季度复核，审计留痕归档';
const INPUT = '报表导出与权限审计：每季度复核 3 次，审计留痕归档，复核结果归档';

let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

function setup() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ctx = (request_id: string) => ({
    storage, vector, account: ACCOUNT, request_id, now: NOW, l0: sharedVault,
  });
  return { storage, ctx };
}

function seed(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2',
    content: '旧摘要', content_l1: SEED, content_l2: '旧摘要',
    decay_class: 'hot', pinned: false, locked: false, version: 3, created_at: 100,
    ...over,
  };
}

function growthPref(payload: unknown): Memory {
  return {
    mem_id: 'growth1', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: 'e1', team_id: 't1',
    category: 'preference', layer: 'L2', content: `${GROWTH_PREF_PREFIX}${JSON.stringify(payload)}`,
    decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: 100,
  };
}

describe('内核查重读取账本生长配置', () => {
  it('无 growth 记录 → 默认 L1 阈值 0.70，命中即嫁接', async () => {
    const { storage, ctx } = setup();
    await storage.putMemory(seed());
    const r = await coreWrite({ content: INPUT, category: 'fact', project_id: 'P1' }, ctx('req_default'));
    expect(r.dedup.action).toBe('grafted');
    expect(r.dedup.graft_to).toBe('m1');
  });

  it('账本把 L1 阈值抬到 0.99 → 同一对文本不再嫁接', async () => {
    const { storage, ctx } = setup();
    await storage.putMemory(seed());
    await storage.putMemory(growthPref({
      thresholds: { L1: 0.99, L2: 0.99, L3: 0.99, L4: 0.99, L5: 0.99, L6: 0.99 },
    }));
    const r = await coreWrite({ content: INPUT, category: 'fact', project_id: 'P1' }, ctx('req_strict'));
    expect(r.dedup.action).toBe('new');
    expect(r.dedup.graft_to).toBeUndefined();
  });
});
