// coreMemoryOp 契约测试（17.3 / P4 调参迁移：G4 约束 + 钳制 + 版本 + 审计）
import { describe, expect, it } from 'vitest';
import { coreFeedback, coreMemoryOp } from '../memories.ts';
import { coreListConflicts } from '../conflict.ts';
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

  it('delete：墓碑隐藏 + 向量索引清理 + 待同步（D2 删除传播）', async () => {
    const s = new InMemoryStorage();
    const v = new JsVectorBackend();
    await s.putMemory(seed({ content_orig: 'op target memory' }));
    await v.upsert('m1', 'op target memory', { project_id: 'P1', layer: 'L2' });
    const r = await coreMemoryOp('m1', 'delete', { storage: s, vector: v, request_id: 'req_test1', now: 0 });
    expect(r.ok).toBe(true);
    expect(r.mem).toBeNull();
    expect(await s.getMemory('m1')).toBeNull();
    expect((await s.listMemories({})).length).toBe(0);
    // 墓碑留档：正文/加密/原文/指纹清空，版本推进，待上行
    const tomb = (await s.listMemories({ include_deleted: true })).find((m) => m.mem_id === 'm1');
    expect(tomb?.deleted).toBe(true);
    expect(tomb?.deleted_at).toBe(0);
    expect(tomb?.content).toBe('');
    expect(tomb?.content_orig).toBeUndefined();
    expect(tomb?.content_l1).toBeUndefined();
    expect(tomb?.sha256).toBeUndefined();
    expect(tomb?.version).toBe(2);
    expect(tomb?.pending_sync).toBe(true);
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

describe('coreFeedback（17.4 trust_delta）', () => {
  it('confirm：confidence +0.1 + reinforce_count 分家 +1', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ confidence: 0.6 }));
    const r = await coreFeedback('m1', 'confirm', { storage: s, request_id: 'req_fb1', now: 0 });
    expect(r.ok).toBe(true);
    expect(r.trust_delta).toBe(0.1);
    expect(r.mem?.confidence).toBeCloseTo(0.7);
    expect(r.mem?.reinforce_count).toBe(1);
    expect(r.mem?.version).toBe(2);
  });

  it('reject：confidence −0.05，下限钳制 0.05 不破底', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ confidence: 0.08 }));
    const r = await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_fb2', now: 0 });
    expect(r.trust_delta).toBe(-0.05);
    expect(r.mem?.confidence).toBe(0.05);
    // 连续 reject 不再下探
    await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_fb3', now: 0 });
    const m = await s.getMemory('m1');
    expect(m?.confidence).toBe(0.05);
  });

  it('disputed：trust 分不动，挂 9.7 裁决（conflict_id）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ confidence: 0.7 }));
    const r = await coreFeedback('m1', 'disputed', { storage: s, request_id: 'req_fb4', now: 0 });
    expect(r.trust_delta).toBe(0);
    expect(r.mem?.confidence).toBeCloseTo(0.7);
    expect(r.mem?.conflict_id).toMatch(/^cf_/);
  });

  it('反馈写 memory_op 审计（detail.trust_delta 归因）+ 未知 mem_id 拒绝', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed());
    await coreFeedback('m1', 'confirm', { storage: s, request_id: 'req_fb5', now: 0 });
    const audits = await s.queryAudit({ action: 'memory_op' });
    expect(audits[0].detail.op).toBe('confirm');
    expect(audits[0].detail.trust_delta).toBe(0.1);
    const bad = await coreFeedback('nope', 'confirm', { storage: s, request_id: 'req_fb6', now: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.mem).toBeNull();
  });
});

// 批次61 GAP-2（规格 B1/B2/B3）：反馈信号回灌净化因果链。
// 红线：默认策略必须「不启用」，即升级后老账本行为与改造前逐字一致。
const NOW2 = 1_800_000_000_000;

/** 把 growth:v1 配置写进 P_SYSTEM 账本（与 product 路径同一前缀与载体） */
async function seedGrowth(s: InMemoryStorage, policy: Record<string, unknown>): Promise<void> {
  await s.putMemory(seed({
    mem_id: 'growth_seed', project_id: 'P_SYSTEM', category: 'preference', user_id: 'system',
    content: `growth:v1:${JSON.stringify({ feedback_policy: policy })}`,
    decay_class: 'hot', pinned: true, created_at: NOW2 - 1000, updated_at: NOW2 - 1000,
  }));
}

describe('GAP-2 反馈回灌（B1/B2/B3）', () => {
  it('B1：policy 未启用（缺省）→ 连打 5 次 reject 也只降 confidence，不降档、不写 growth_op', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ confidence: 0.9 }));
    for (let i = 0; i < 5; i++) {
      await coreFeedback('m1', 'reject', { storage: s, request_id: `req_b1_${i}`, now: NOW2 + i });
    }
    const m = await s.getMemory('m1');
    expect(m?.confidence).toBeCloseTo(0.65);
    expect(m?.decay_class).toBe('hot');                                  // 档位一字不动
    expect(await s.queryAudit({ action: 'growth_op' })).toHaveLength(0); // 不产生回灌审计
  });

  it('B2：启用阈值（3 次）→ 第 3 次 reject 触发 hot→warm，并落可追溯 growth_op', async () => {
    const s = new InMemoryStorage();
    await seedGrowth(s, { enabled: true, window_days: 30, reject_downgrade_threshold: 3 });
    await s.putMemory(seed({ confidence: 0.9 }));

    await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_b2_1', now: NOW2 });
    await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_b2_2', now: NOW2 + 1 });
    expect((await s.getMemory('m1'))?.decay_class).toBe('hot'); // 差一次，不动
    expect(await s.queryAudit({ action: 'growth_op' })).toHaveLength(0);

    await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_b2_3', now: NOW2 + 2 });
    expect((await s.getMemory('m1'))?.decay_class).toBe('warm');

    const ops = await s.queryAudit({ action: 'growth_op' });
    expect(ops).toHaveLength(1);
    const entry = (ops[0].detail as { entry: Record<string, unknown> }).entry;
    expect(entry.event).toBe('reject_downgrade');
    const payload = JSON.parse(String(entry.payload)) as Record<string, unknown>;
    expect(payload).toMatchObject({ mem_id: 'm1', rejects: 3, threshold: 3, from: 'hot', to: 'warm', applied: true });
  });

  it('B2：窗口外的历史 reject 不计入（不会一启用就批量降档）', async () => {
    const s = new InMemoryStorage();
    // 阈值 4：窗口 7 天
    await seedGrowth(s, { enabled: true, window_days: 7, reject_downgrade_threshold: 4 });
    await s.putMemory(seed({ confidence: 0.95 }));
    // 30 天前连打 3 次：当时各自累计最多 3 次，均未达阈
    for (let i = 0; i < 3; i++) {
      await coreFeedback('m1', 'reject', {
        storage: s, request_id: `req_b2o_${i}`, now: NOW2 - 30 * 24 * 3600_000 - i,
      });
    }
    expect((await s.getMemory('m1'))?.decay_class).toBe('hot');
    // 今天再打第 4 次：若按「全历史」算就会达阈（3+1=4）；按 7 天窗算只有 1 次 → 不降档
    await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_b2o_now', now: NOW2 });
    expect((await s.getMemory('m1'))?.decay_class).toBe('hot');
    expect(await s.queryAudit({ action: 'growth_op' })).toHaveLength(0);
  });

  it('B2：已是 cold 时达阈不硬推 dormant，审计 applied:false 如实标注', async () => {
    const s = new InMemoryStorage();
    await seedGrowth(s, { enabled: true, window_days: 30, reject_downgrade_threshold: 1 });
    await s.putMemory(seed({ confidence: 0.9, decay_class: 'cold' }));
    await coreFeedback('m1', 'reject', { storage: s, request_id: 'req_b2c', now: NOW2 });
    expect((await s.getMemory('m1'))?.decay_class).toBe('cold');
    const ops = await s.queryAudit({ action: 'growth_op' });
    const payload = JSON.parse(String((ops[0].detail as { entry: Record<string, unknown> }).entry.payload));
    expect(payload).toMatchObject({ from: 'cold', to: null, applied: false });
  });

  it('B3：disputed 补齐对手 → conflict.ts 路径 1 真能列出这一对', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ mem_id: 'm1', content: '部署环境是 k8s 集群', created_at: NOW2 - 2000 }));
    await s.putMemory(seed({ mem_id: 'm2', content: '部署环境是 k8s 集群', created_at: NOW2 - 1000 }));

    const r = await coreFeedback('m1', 'disputed', { storage: s, request_id: 'req_b3', now: NOW2 });
    const cid = r.mem?.conflict_id;
    expect(cid).toMatch(/^cf_/);
    // 对手被挂上同一个 conflict_id，且只动 conflict_id + 版本钟
    const m2 = await s.getMemory('m2');
    expect(m2?.conflict_id).toBe(cid);
    expect(m2?.content).toBe('部署环境是 k8s 集群');
    expect(m2?.decay_class).toBe('hot');

    const pairs = await coreListConflicts(s);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].conflict_id).toBe(cid);
    expect([pairs[0].old_id, pairs[0].new_id].sort()).toEqual(['m1', 'm2']);
    // 分数与类型如实为 null（内核没有检测引擎）
    expect(pairs[0].conflict_score).toBeNull();
  });

  it('B3：找不到对手 → 如实单条保留，审计写明原因（不伪造第二条）', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ mem_id: 'm1', content: '部署环境是 k8s 集群' }));
    await s.putMemory(seed({ mem_id: 'm2', content: '今晚吃番茄炒蛋' })); // 语义无关

    const r = await coreFeedback('m1', 'disputed', { storage: s, request_id: 'req_b3n', now: NOW2 });
    expect((await s.getMemory('m2'))?.conflict_id).toBeUndefined();
    const audit = (await s.queryAudit({ action: 'memory_op' }))[0];
    const pair = (audit.detail as { conflict_pair: { counterpart: unknown; reason?: string } }).conflict_pair;
    expect(pair.counterpart).toBeNull();
    expect(pair.reason).toBeTruthy();
    expect(await coreListConflicts(s)).toHaveLength(0); // 单条不成对，队列如实为空
    expect(r.mem?.conflict_id).toMatch(/^cf_/);
  });

  it('B3：重复 disputed 幂等——不会把第三条拉进同一冲突 id', async () => {
    const s = new InMemoryStorage();
    await s.putMemory(seed({ mem_id: 'm1', content: '部署环境是 k8s 集群', created_at: NOW2 - 3000 }));
    await s.putMemory(seed({ mem_id: 'm2', content: '部署环境是 k8s 集群', created_at: NOW2 - 2000 }));
    await s.putMemory(seed({ mem_id: 'm3', content: '部署环境是 k8s 集群', created_at: NOW2 - 1000 }));
    await coreFeedback('m1', 'disputed', { storage: s, request_id: 'req_b3i1', now: NOW2 });
    await coreFeedback('m1', 'disputed', { storage: s, request_id: 'req_b3i2', now: NOW2 + 1 });
    expect((await s.getMemory('m3'))?.conflict_id).toBeUndefined();
    expect(await coreListConflicts(s)).toHaveLength(1);
  });
});
