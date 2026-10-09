// REQ-004 T7 验收：反馈闭环（applyFeedback 数值 + LocalMock 写审计）
import { describe, it, expect, vi } from 'vitest';
import { applyFeedback, LocalMockFeedbackPort } from '../feedback.ts';

describe('applyFeedback', () => {
  it('confirm +0.1 / reject -0.05 / disputed → 冲突队列', () => {
    expect(applyFeedback('confirm')).toEqual({ action: 'confirm', delta: 0.1, toConflictQueue: false });
    expect(applyFeedback('reject')).toEqual({ action: 'reject', delta: -0.05, toConflictQueue: false });
    expect(applyFeedback('disputed')).toEqual({ action: 'disputed', delta: 0, toConflictQueue: true });
  });
});

describe('LocalMockFeedbackPort', () => {
  it('writeAudit 记录 + 回调', () => {
    const onWrite = vi.fn();
    const port = new LocalMockFeedbackPort(onWrite);
    port.writeAudit('req_017', applyFeedback('confirm'));
    expect(port.audits).toHaveLength(1);
    expect(port.audits[0]).toEqual({ req: 'req_017', delta: { action: 'confirm', delta: 0.1, toConflictQueue: false } });
    expect(onWrite).toHaveBeenCalledWith('req_017', expect.objectContaining({ action: 'confirm' }));
  });
});
