import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FeedbackPage } from '../FeedbackPage.tsx';
import { bindTenant, getTenant, getKernelStorage, resetKernelForTests } from '../../kernel.ts';
import { seedFeedbackMemories } from './fixtures.ts';

/** 下拉候选从真实账本异步加载 → 等到目标 memory 出现 */
async function waitOption(id: string) {
  await waitFor(() =>
    expect(screen.getByTestId('f-memory').querySelector(`option[value="${id}"]`)).toBeTruthy(),
  );
}

describe('FeedbackPage (P9-T4 编排)', () => {
  beforeEach(async () => {
    resetKernelForTests();
    bindTenant({ user_id: 'user_001', team_id: 'team_001', enterprise_id: 'ent_001' });
    await seedFeedbackMemories();
  });

  it('挂载渲染表单与统计卡；R1 注入只读（租户来自真实登录绑定）', async () => {
    render(<FeedbackPage />);
    expect(screen.getByTestId('feedback-page')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-form')).toBeInTheDocument();
    expect(screen.getByTestId('stat-cards')).toBeInTheDocument();
    expect(getTenant().user_id).toBe('user_001');
    expect(screen.getByTestId('ctx-user')).toHaveTextContent('user_001');
    // rating 默认 3
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });

  it('memory_id 必填拦截', () => {
    render(<FeedbackPage />);
    fireEvent.click(screen.getByTestId('fb-submit'));
    expect(screen.getByTestId('toast')).toHaveTextContent('必填');
  });

  it('选中 memory_id 带出摘要 + confirm 提交 toast trust_delta（内核 17.4）', async () => {
    render(<FeedbackPage />);
    await waitOption('mem_001');
    fireEvent.change(screen.getByTestId('f-memory'), { target: { value: 'mem_001' } });
    expect(screen.getByTestId('memory-summary')).toHaveTextContent(/项目技术栈/);
    fireEvent.click(screen.getByTestId('fb-submit'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('+0.1'));
  });

  it('disputed 提交 → 提示转 P7（内核挂 conflict_id）', async () => {
    render(<FeedbackPage />);
    await waitOption('mem_020');
    fireEvent.change(screen.getByTestId('f-memory'), { target: { value: 'mem_020' } });
    fireEvent.click(screen.getByTestId('action-disputed'));
    expect(screen.getByTestId('disputed-hint')).toHaveTextContent('P7');
    fireEvent.click(screen.getByTestId('fb-submit'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('P7'));
  });

  it('星级可点调整', () => {
    render(<FeedbackPage />);
    fireEvent.click(screen.getByTestId('star-5'));
    expect(screen.getByText('5/5')).toBeInTheDocument();
  });

  it('reject 无原因显示 warning', async () => {
    render(<FeedbackPage />);
    await waitOption('mem_012');
    fireEvent.change(screen.getByTestId('f-memory'), { target: { value: 'mem_012' } });
    fireEvent.click(screen.getByTestId('action-reject'));
    expect(screen.getByTestId('fb-warning')).toHaveTextContent(/自生长/);
  });

  it('评分真实落账本：星级 + 原因写进 memory_op 审计，统计卡按真实分布（批次48 A13）', async () => {
    render(<FeedbackPage />);
    await waitOption('mem_001');
    fireEvent.change(screen.getByTestId('f-memory'), { target: { value: 'mem_001' } });
    fireEvent.click(screen.getByTestId('star-4'));
    fireEvent.change(screen.getByTestId('f-comment'), { target: { value: '结论可直接复用' } });
    fireEvent.click(screen.getByTestId('fb-submit'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('+0.1'));

    const audits = await getKernelStorage().queryAudit({ action: 'memory_op' });
    const last = audits[audits.length - 1].detail as { rating?: number; comment?: string; mem_id?: string };
    expect(last.mem_id).toBe('mem_001');
    expect(last.rating).toBe(4);                          // 真实评分，不是默认 3
    expect(last.comment).toBe('结论可直接复用');
    // 统计卡读真实记录：4★×1（不是 3★×1）
    expect(screen.getByTestId('dist-4')).toHaveTextContent('4★×1');
    expect(screen.getByTestId('dist-3')).toHaveTextContent('3★×0');
  });

  it('页面挂载读历史真实评分：账本里 rating=5 的记录直接出现在分布与均分（批次48 A13）', async () => {
    await getKernelStorage().appendAudit({
      request_id: 'req_seed_rating', action: 'memory_op', ts: Date.now(),
      detail: { op: 'confirm', mem_id: 'mem_001', trust_delta: 0.1, rating: 5, comment: '真实历史评分' },
    });
    render(<FeedbackPage />);
    await waitFor(() => expect(screen.getByTestId('dist-5')).toHaveTextContent('5★×1'));
    expect(screen.getByTestId('dist-3')).toHaveTextContent('3★×0'); // 不是默认 3 星
    expect(screen.getByTestId('stat-avg')).toHaveTextContent('均分 5');
  });
});
