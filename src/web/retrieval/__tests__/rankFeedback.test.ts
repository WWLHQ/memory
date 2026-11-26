// 排序反馈真落账本（rank_wrong → weight_step 的入口证据，方案 MODE-FEEDBACK-TARGET-FIELD.md §2.2）。
import { describe, expect, it, afterEach } from 'vitest';
import { coreSubmitRankFeedback } from '../coreRankFeedback.ts';
import { getKernelWithSeed, getKernelStorage, resetKernelForTests } from '../../kernel.ts';

afterEach(() => resetKernelForTests());

describe('coreSubmitRankFeedback（排序反馈真写 recall_feedback）', () => {
  it('👆 点名「应该排第一」→ 审计真写 rank_wrong + expected_first_id', async () => {
    getKernelWithSeed();
    const r = await coreSubmitRankFeedback({ request_id: 'req_rank_1', expected_first_id: 'm_42' });
    expect(r.ok).toBe(true);
    const rows = await getKernelStorage().queryAudit({ request_id: 'req_rank_1', action: 'recall_feedback' });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ rank_wrong: true, expected_first_id: 'm_42' });
  });

  it('空 request_id / 空 expected_first_id → 拒绝，不写脏审计', async () => {
    getKernelWithSeed();
    expect((await coreSubmitRankFeedback({ request_id: '', expected_first_id: 'm_1' })).ok).toBe(false);
    expect((await coreSubmitRankFeedback({ request_id: 'r', expected_first_id: '' })).ok).toBe(false);
    expect(await getKernelStorage().queryAudit({ action: 'recall_feedback' })).toHaveLength(0);
  });
});
