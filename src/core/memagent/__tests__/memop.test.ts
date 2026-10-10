// coreMemoryOp 契约测试（17.3 / P4 调参迁移：G4 约束 + 钳制 + 版本 + 审计）
import { describe, expect, it } from 'vitest';
import { coreMemoryOp } from '../memories.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync } from '../vector.ts';
import type { Memory } from '../types.ts';

function seed(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: 'op target memory',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: 0,
    importance: 0.5, confidence: 0.5, access_count: 0, reinforce_count: 0, half_life_days: 30,
    ...over,
  };
}

function ctx(storage: InMemoryStorage, now = 1_800_000_000_000) {
  return { storage, vector: new JsVectorBackend(), request_id: 'req_test1', now };
}

describe('coreMemoryOp（17.3 / P4）', () => {
  it('remember：importance/confidence +0.2，reinforce_count 分家计数', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed());
    const r = await coreMemoryOp('m1', 'remember', ctx(s));
    expect(r.ok).toBe(true);
    expect(r.mem?.importance).toBeCloseTo(0.7);
    expect(r.mem?.confidence).toBeCloseTo(0.7);
    expect(r.mem?.reinforce_count).toBe(1);
    expect(r.mem?.version).toBe(2);
  });

  it('remember 钳制：importance 0.9 → 1（不超上界）；forget 钳到下限', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ importance: 0.9 }));
    const r = await coreMemoryOp('m1', 'remember', ctx(s));
    expect(r.mem?.importance).toBe(1);
    await coreMemoryOp('m1', 'forget', ctx(s));
    await coreMemoryOp('m1', 'forget', ctx(s));
    await coreMemoryOp('m1', 'forget', ctx(s));
    const m = await s.getMemory('m1');
    expect(m?.importance).toBeCloseTo(0.4); // 1 - 0.2×3
    expect(m?.confidence).toBeGreaterThanOrEqual(0.05); // 下限钳制
  });

  it('G4：locked 拒绝 remember/forget/archive 等，仅 unlock 放行', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ locked: true }));
    const r1 = await coreMemoryOp('m1', 'remember', ctx(s));
    expect(r1.ok).toBe(false);
    expect(r1.blocked_locked).toBe(true);
    const r2 = await coreMemoryOp('m1', 'forget', ctx(s));
    expect(r2.ok).toBe(false);
    const r3 = await coreMemoryOp('m1', 'unlock', ctx(s));
    expect(r3.ok).toBe(true);
    expect(r3.mem?.locked).toBe(false);
    // 解锁后可操作
    const r4 = await coreMemoryOp('m1', 'remember', ctx(s));
    expect(r4.ok).toBe(true);
  });

  it('archive → archived；restore → hot（恢复即回温）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed());
    const r1 = await coreMemoryOp('m1', 'archive', ctx(s));
    expect(r1.mem?.decay_class).toBe('archived');
    const r2 = await coreMemoryOp('m1', 'restore', ctx(s));
    expect(r2.mem?.decay_class).toBe('hot');
  });

  it('pin/lock：标记位翻转 + pinned 免检语义由 gc/hardFilter 消费', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed());
    const r = await coreMemoryOp('m1', 'pin', ctx(s));
    expect(r.mem?.pinned).toBe(true);
    const r2 = await coreMemoryOp('m1', 'unpin', ctx(s));
    expect(r2.mem?.pinned).toBe(false);
  });

  it('param：P4 调参走内核钳制（importance 下限 0.1 / half_life ≥1）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed());
    const r = await coreMemoryOp('m1', 'param', ctx(s), { importance: 0.01, confidence: 2, half_life_days: 0, pinned: true });
    expect(r.mem?.importance).toBe(0.1);
    expect(r.mem?.confidence).toBe(1);
    expect(r.mem?.half_life_days).toBe(1);
    expect(r.mem?.pinned).toBe(true);
  });

  it('migrate：目标温度由端壳六态映射，内核只认 decay_class', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ decay_class: 'hot' }));
    const r = await coreMemoryOp('m1', 'migrate', ctx(s), { decay_class: 'cold' });
    expect(r.mem?.decay_class).toBe('cold');
  });

  it('delete：主表 + 向量索引清理，返回 mem=null', async () => {
    const s = new InMemoryStorage();
    const v = new JsVectorBackend();
    await s.putMemory(seed());
    await v.upsert('m1', 'op target memory', { project_id: 'P1', layer: 'L2' });
    const r = await coreMemoryOp('m1', 'delete', { storage: s, vector: v, request_id: 'req_test1', now: 0 });
    expect(r.ok).toBe(true);
    expect(r.mem).toBeNull();
    expect(await s.getMemory('m1')).toBeNull();
    const hits = await v.search(embedSync('op target memory'), 5, {});
    expect(hits.find((h) => h.mem_id === 'm1')).toBeUndefined();
  });

  it('不存在的 mem_id → ok=false', async () => {
    const r = await coreMemoryOp('nope', 'remember', ctx(new InMemoryStorage()));
    expect(r.ok).toBe(false);
  });

  it('每次操作写 memory_op 审计（detail.op 归因，G6）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed());
    await coreMemoryOp('m1', 'remember', ctx(s));
    await coreMemoryOp('m1', 'archive', ctx(s));
    const audits = await s.queryAudit({ action: 'memory_op' });
    expect(audits.length).toBe(2);
    expect(audits[0].detail.op).toBe('remember');
    expect(audits[1].detail.op).toBe('archive');
    expect(audits[0].request_id).toBe('req_test1');
  });
});
