// 批次61 GAP-2 单元用例（规格 B2/B3/B4）：反馈回灌的纯函数与只读聚合。
// 这些用例只吃审计/账本快照，不碰 UI，确保「规则可复算、不猜、不补零」。
import { describe, expect, it } from 'vitest';
import {
  CONFLICT_PAIR_MIN_SIM, countRejects, downgradeClass, feedbackPolicyFromLedger,
  findConflictCounterpart, isLiveForConflict, readFeedbackSignals, summarizeFeedbackSignals, tallyRejects,
} from '../feedbackSignal.ts';
import { InMemoryStorage } from '../storage.ts';
import { DEFAULT_VECTOR_DIM, embedSync } from '../vector.ts';
import { DEFAULT_FEEDBACK_POLICY } from '../../../shared/growthConfig.ts';
import type { AuditRecord, Memory } from '../types.ts';

const NOW = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const POLICY = { enabled: true, window_days: 7, reject_downgrade_threshold: 2 };
const OFF = { ...DEFAULT_FEEDBACK_POLICY };

function mem(o: Partial<Memory> = {}): Memory {
  const content = o.content ?? 'some content';
  return {
    mem_id: o.mem_id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content,
    embedding: embedSync(content, DEFAULT_VECTOR_DIM),
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW - DAY,
    ...o,
  };
}

function opAudit(memId: string, op: string, ts: number): AuditRecord {
  return {
    request_id: `req_${memId}_${ts}`, action: 'memory_op', form: 'desktop', project_id: 'P1', ts,
    detail: { op, mem_id: memId },
  } as AuditRecord;
}

function recallAudit(ts: number, thin = false): AuditRecord {
  return {
    request_id: `req_r_${ts}`, action: 'recall', form: 'desktop', project_id: 'P1', ts,
    detail: { hits: 2, evidence_thin: thin },
  } as AuditRecord;
}

describe('降档表（只降不升、不推 dormant）', () => {
  it('hot→warm→cold，cold/archived/dormant 到底为止', () => {
    expect(downgradeClass('hot')).toBe('warm');
    expect(downgradeClass('warm')).toBe('cold');
    // dormant 没有自动回温路径，误推 = 永久丢召回
    expect(downgradeClass('cold')).toBeNull();
    expect(downgradeClass('archived')).toBeNull();
    expect(downgradeClass('dormant')).toBeNull();
  });
});

describe('countRejects / tallyRejects（B1 默认不启用）', () => {
  const audits = [
    opAudit('m1', 'reject', NOW - 1 * DAY),
    opAudit('m1', 'reject', NOW - 2 * DAY),
    opAudit('m1', 'confirm', NOW - 3 * DAY),
    opAudit('m1', 'reject', NOW - 20 * DAY),  // 窗外
    opAudit('m2', 'reject', NOW - 1 * DAY),   // 别人的
    { request_id: 'req_x', action: 'memory_op', form: 'desktop', ts: NOW, detail: { op: 'reject' } } as AuditRecord, // 无 mem_id
  ];

  it('只认 memory_op + op=reject + 同一 mem_id + 窗口内', () => {
    expect(countRejects(audits, 'm1', NOW - 7 * DAY)).toBe(2);
    expect(countRejects(audits, 'm2', NOW - 7 * DAY)).toBe(1);
    expect(countRejects(audits, 'm1', 0)).toBe(3); // 放宽窗口才含 20 天前那条
  });

  it('enabled=false → 次数够也不达阈（改造前行为逐字不变）', () => {
    // 默认窗口 30 天 → 含 20 天前那条：3 条历史 + 本次 1 次
    const t = tallyRejects(audits, 'm1', NOW, OFF);
    expect(t.rejects).toBe(4);
    expect(t.reached).toBe(false);  // 开关关着，次数再多也不降档
  });

  it('本次 +1 参与判定：历史 1 次 + 本次 = 2 达到阈值 2', () => {
    const single = [opAudit('m1', 'reject', NOW - DAY)];
    expect(tallyRejects(single, 'm1', NOW, POLICY)).toMatchObject({ rejects: 2, reached: true });
    expect(tallyRejects([], 'm1', NOW, POLICY)).toMatchObject({ rejects: 1, reached: false });
  });
});

describe('findConflictCounterpart（B3 配对）', () => {
  it('同项目 live 且相似 → 配上，sim 如实记账', () => {
    const target = mem({ mem_id: 'a', content: '部署环境是 k8s 集群' });
    const mate = mem({ mem_id: 'b', content: '部署环境是 k8s 集群' });
    const r = findConflictCounterpart(target, [target, mate], 'cf_1');
    expect(r.counterpart).toMatchObject({ mem_id: 'b', existing: false });
    expect(r.counterpart!.sim).toBeGreaterThanOrEqual(CONFLICT_PAIR_MIN_SIM);
  });

  it('跨项目 / 不 live / 已在别的冲突对 → 一律不配，并给出原因', () => {
    const target = mem({ mem_id: 'a', content: 'k8s 集群部署' });
    const otherProject = mem({ mem_id: 'b', content: 'k8s 集群部署', project_id: 'P2' });
    const archived = mem({ mem_id: 'c', content: 'k8s 集群部署', decay_class: 'archived' });
    const deleted = mem({ mem_id: 'd', content: 'k8s 集群部署', deleted: true });
    const inOtherPair = mem({ mem_id: 'e', content: 'k8s 集群部署', conflict_id: 'cf_other' });
    const r = findConflictCounterpart(target, [target, otherProject, archived, deleted, inOtherPair], 'cf_1');
    expect(r.counterpart).toBeNull();
    expect(r.reason).toContain('无相似度');
  });

  it('无关内容不硬配（相似度不足）', () => {
    const target = mem({ mem_id: 'a', content: '部署环境是 k8s 集群' });
    const unrelated = mem({ mem_id: 'b', content: '今晚吃番茄炒蛋' });
    expect(findConflictCounterpart(target, [target, unrelated], 'cf_1').counterpart).toBeNull();
  });

  it('已有同 id 的对手 → 幂等返回 existing:true（不重复写第三条）', () => {
    const target = mem({ mem_id: 'a', content: 'k8s 集群部署', conflict_id: 'cf_1' });
    const mate = mem({ mem_id: 'b', content: 'k8s 集群部署', conflict_id: 'cf_1' });
    const third = mem({ mem_id: 'c', content: 'k8s 集群部署' });
    const r = findConflictCounterpart(target, [target, mate, third], 'cf_1');
    expect(r.counterpart).toEqual({ mem_id: 'b', sim: 1, existing: true });
  });

  it('isLiveForConflict 与 conflict.ts 同口径（archived/dormant/deleted 均不 live）', () => {
    expect(isLiveForConflict(mem())).toBe(true);
    expect(isLiveForConflict(mem({ decay_class: 'archived' }))).toBe(false);
    expect(isLiveForConflict(mem({ decay_class: 'dormant' }))).toBe(false);
    expect(isLiveForConflict(mem({ deleted: true }))).toBe(false);
    expect(isLiveForConflict(mem({ decay_class: 'cold' }))).toBe(true);
  });
});

describe('summarizeFeedbackSignals（只读聚合，不估算不补零）', () => {
  it('窗口内计数 + reject_ratio + 被 reject 的记忆去重', () => {
    const audits = [
      recallAudit(NOW - 1000, true), recallAudit(NOW - 2000), recallAudit(NOW - 3000),
      opAudit('m1', 'reject', NOW - 1000), opAudit('m1', 'reject', NOW - 2000),
      opAudit('m2', 'reject', NOW - 1500), opAudit('m3', 'confirm', NOW - 1200),
      opAudit('m4', 'disputed', NOW - 1100),
      opAudit('m5', 'reject', NOW - 40 * DAY), // 窗外
    ];
    const s = summarizeFeedbackSignals(audits, NOW, 30);
    expect(s.recalls).toBe(3);
    expect(s.evidence_thin).toBe(1);
    expect(s.verdicts).toEqual({ confirm: 1, reject: 3, disputed: 1 });
    expect(s.reject_ratio).toBe(0.6);         // 3/5
    expect(s.rejected_mem_ids).toBe(2);       // m1、m2（去重，不是 3 次）
  });

  it('空账本 → 全 0（页面据此显示「暂无数据」而不是「已采集 0」）', () => {
    const s = summarizeFeedbackSignals([], NOW);
    expect(s).toMatchObject({ recalls: 0, evidence_thin: 0, reject_ratio: 0, rejected_mem_ids: 0 });
    expect(s.verdicts).toEqual({ confirm: 0, reject: 0, disputed: 0 });
    expect(s.window_days).toBe(DEFAULT_FEEDBACK_POLICY.window_days);
  });

  it('readFeedbackSignals：审计读不到 → ok:false 带原因（不冒充「没有反馈」）', async () => {
    class BadStorage extends InMemoryStorage {
      override async queryAudit(): Promise<AuditRecord[]> {
        throw new Error('audit store unreadable');
      }
    }
    const r = await readFeedbackSignals(new BadStorage(), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unreadable');
  });

  it('readFeedbackSignals：正常账本 → ok:true 且与纯函数一致', async () => {
    const s = new InMemoryStorage();
    await s.appendAudit(opAudit('m1', 'reject', NOW - 1000));
    await s.appendAudit(recallAudit(NOW - 500));
    const r = await readFeedbackSignals(s, NOW, 30);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toMatchObject({ recalls: 1, verdicts: { reject: 1, confirm: 0, disputed: 0 } });
  });

  it('feedbackPolicyFromLedger：旧账本无 feedback_policy → 默认关闭', () => {
    expect(feedbackPolicyFromLedger([])).toEqual(DEFAULT_FEEDBACK_POLICY);
    expect(feedbackPolicyFromLedger([]).enabled).toBe(false);
  });
});
