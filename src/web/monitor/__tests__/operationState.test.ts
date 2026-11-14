// REQ-013 / C5：异步操作状态机回归（409=排队中不算失败 + 状态机 + 退避 + 审计聚合）
import { describe, it, expect, vi } from 'vitest';
import {
  classifyOperationOutcome, isTerminal, shouldKeepPolling, nextPollDelay,
  operationLabel, summarizeOperations, operationStatusFromAudits, pollOperationUntilTerminal,
  operationEntriesFromAudits, OPERATION_ACTION_SPECS,
} from '../operationState.ts';

describe('REQ-013 / C5 操作状态分类（409 语义）', () => {
  it('409 = 排队中（非失败）；2xx=成功；其余=失败；未知=进行中', () => {
    expect(classifyOperationOutcome(409)).toBe('queued');
    expect(classifyOperationOutcome(200)).toBe('succeeded');
    expect(classifyOperationOutcome(204)).toBe('succeeded');
    expect(classifyOperationOutcome(500)).toBe('failed');
    expect(classifyOperationOutcome(404)).toBe('failed');
    expect(classifyOperationOutcome(undefined)).toBe('running');
  });

  it('文案把「排队中」与「失败」明确区分', () => {
    expect(operationLabel('queued')).toBe('排队中');
    expect(operationLabel('running')).toBe('进行中');
    expect(operationLabel('failed')).toBe('失败');
  });
});

describe('REQ-013 / C5 状态机（终态 / 继续轮询 / 退避）', () => {
  it('queued/running 非终态、继续轮询；succeeded/failed 终态、停止', () => {
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(shouldKeepPolling('queued')).toBe(true);
    expect(shouldKeepPolling('running')).toBe(true);
    expect(shouldKeepPolling('succeeded')).toBe(false);
    expect(shouldKeepPolling('failed')).toBe(false);
  });

  it('退避延迟指数递增并封顶', () => {
    expect(nextPollDelay(1, 2000, 30_000)).toBe(2000);
    expect(nextPollDelay(2, 2000, 30_000)).toBe(4000);
    expect(nextPollDelay(3, 2000, 30_000)).toBe(8000);
    expect(nextPollDelay(20, 2000, 30_000)).toBe(30_000);
  });

  it('汇总计数覆盖四态', () => {
    expect(summarizeOperations(['queued', 'queued', 'failed', 'succeeded']))
      .toEqual({ queued: 2, running: 0, succeeded: 1, failed: 1 });
  });
});

describe('REQ-013 / C5 轮询直到终态', () => {
  it('409 排队中不判失败，继续轮询；2xx 才停', async () => {
    const seq = [409, 409, 200];
    let i = 0;
    const sleep = vi.fn(async () => {});
    const out = await pollOperationUntilTerminal(async () => seq[i++], { sleep, baseMs: 1, capMs: 1 });
    expect(out).toBe('succeeded');
    expect(i).toBe(3); // 前两次 409 继续、第三次 200 终态
  });

  it('5xx 立即判失败并停（不再空转）', async () => {
    const sleep = vi.fn(async () => {});
    const out = await pollOperationUntilTerminal(async () => 500, { sleep });
    expect(out).toBe('failed');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('超过 maxAttempts 仍排队 → 返回 queued（诚实，不谎报失败）', async () => {
    const sleep = vi.fn(async () => {});
    const out = await pollOperationUntilTerminal(async () => 409, { sleep, maxAttempts: 3 });
    expect(out).toBe('queued');
  });
});

describe('REQ-013 / C5 从审计聚合操作状态（复用 audit.jsonl，只读）', () => {
  it('sync_fail→failed，sync_up→succeeded，按 request_id 取最新', () => {
    const now = Date.now();
    const audits = [
      { request_id: 'r1', action: 'sync_up', ts: now - 100 },
      { request_id: 'r1', action: 'sync_fail', ts: now - 50 }, // 最新 → failed
      { request_id: 'r2', action: 'sync_down', ts: now - 10 },
    ] as never;
    const out = operationStatusFromAudits(audits, now);
    expect(out.sort()).toEqual(['failed', 'succeeded']);
  });

  it('窗口外 / 非同步 action 忽略；无同步审计 → 空数组（诚实空态）', () => {
    const now = Date.now();
    const audits = [
      { request_id: 'r1', action: 'sync_up', ts: now - 48 * 3600 * 1000 }, // 窗口外
      { request_id: 'r2', action: 'recall', ts: now - 10 }, // 非同步
    ] as never;
    expect(operationStatusFromAudits(audits, now, 24 * 3600 * 1000)).toEqual([]);
    expect(operationStatusFromAudits([], now)).toEqual([]);
  });
});

// REQ-013 / C5（T6-A）：本机真会产生的多来源审计 → 后台操作状态（只读派生，不新增审计写入）
describe('REQ-013 / C5（T6-A）多来源审计映射', () => {
  const now = Date.now();

  it('schedule_run：status=ok → 已完成；error/failed → 失败；缺字段 → 进行中（不臆造终态）', () => {
    const spec = OPERATION_ACTION_SPECS.schedule_run;
    expect(spec.status({ status: 'ok' })).toBe('succeeded');
    expect(spec.status({ status: 'error' })).toBe('failed');
    expect(spec.status({ status: 'failed' })).toBe('failed');
    expect(spec.status({})).toBe('running');
  });

  it('memory_op / graft / gc：完成记录默认已完成，detail.error 有值 → 失败', () => {
    for (const action of ['memory_op', 'graft', 'gc']) {
      const spec = OPERATION_ACTION_SPECS[action];
      expect(spec.status({ op: 'layer_refine', stop_code: 'too_short' })).toBe('succeeded');
      expect(spec.status({ error: 'E_L0_LOCKED' })).toBe('failed');
    }
  });

  it('auto_bind：result=pass 或 status=CONNECTED → 已完成；其余 → 失败', () => {
    const spec = OPERATION_ACTION_SPECS.auto_bind;
    expect(spec.status({ result: 'pass' })).toBe('succeeded');
    expect(spec.status({ status: 'CONNECTED' })).toBe('succeeded');
    expect(spec.status({ result: 'fail', status: 'FAILED' })).toBe('failed');
  });

  it('entries 按 request_id 取最新 + 时间倒序 + 带中文标签', () => {
    const audits = [
      { request_id: 'a', action: 'schedule_run', ts: now - 300, detail: { status: 'error' } },
      { request_id: 'a', action: 'schedule_run', ts: now - 100, detail: { status: 'ok' } }, // 最新 → succeeded
      { request_id: 'b', action: 'gc', ts: now - 200, detail: { task: 'forgetting_cycle' } },
      { request_id: 'c', action: 'recall', ts: now - 50 }, // 未收录 → 忽略
    ] as never;
    const out = operationEntriesFromAudits(audits, now);
    expect(out.map((e) => e.request_id)).toEqual(['a', 'b']); // 倒序 + recall 被忽略
    expect(out[0]).toMatchObject({ action: 'schedule_run', label: '定时任务', status: 'succeeded' });
    expect(out[1]).toMatchObject({ action: 'gc', label: '遗忘周期', status: 'succeeded' });
  });

  it('operationStatusFromAudits 是 entries 的派生（同一份口径，不是第二套）', () => {
    const audits = [
      { request_id: 'x', action: 'memory_op', ts: now - 10, detail: { op: 'layer_refine' } },
      { request_id: 'y', action: 'auto_bind', ts: now - 20, detail: { result: 'fail' } },
    ] as never;
    expect(operationStatusFromAudits(audits, now).sort()).toEqual(['failed', 'succeeded']);
    expect(operationStatusFromAudits(audits, now).length).toBe(operationEntriesFromAudits(audits, now).length);
  });
});
