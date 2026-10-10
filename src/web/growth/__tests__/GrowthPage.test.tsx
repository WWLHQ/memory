// GrowthPage 接真内核验收：动作审计真写账本 + 挂载回放 + mirror 上抛钩子存在
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GrowthPage } from '../GrowthPage.tsx';
import { coreLoadGrowthAudit } from '../coreGrowth.ts';
import { useGrowthMirror } from '../useGrowthMirror.ts';

describe('GrowthPage × 内核审计账本', () => {
  it('手动触发 → toast + 曲线追加 + weight_tuned 审计真写内核（detail.entry 保真）', async () => {
    render(<GrowthPage />);
    // 挂载回放完成（无历史 → 无审计行）后点触发
    await waitFor(() => expect(screen.getByTestId('growth-page')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('manual-trigger'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/weight_tuned/));
    await waitFor(() => expect(screen.getAllByTestId('tuned-point')).toHaveLength(2)); // 种子周日点 + 触发点
    await waitFor(() => expect(screen.getByTestId('growth-audit')).toHaveTextContent(/manual/));
    // 内核账本可查（事件/动作保真）
    const entries = await coreLoadGrowthAudit();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.event === 'weight_tuned' && e.action === 'regress_mode_weights')).toBe(true);
  });

  it('调度停用 → schedule_changed 审计真写内核', async () => {
    render(<GrowthPage />);
    await waitFor(() => expect(screen.getByTestId('growth-page')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sched-check-verdict_reminder')); // 非 required 项可停
    await waitFor(async () => {
      const entries = await coreLoadGrowthAudit();
      expect(entries.some((e) => e.event === 'schedule_changed')).toBe(true);
    });
  });

  it('重挂载 → 内核账本历史回放（growth-audit 区可见 weight_tuned）', async () => {
    const first = render(<GrowthPage />);
    await waitFor(() => expect(screen.getByTestId('growth-page')).toBeInTheDocument());
    first.unmount();
    render(<GrowthPage />);
    await waitFor(() => expect(screen.getByTestId('growth-audit')).toHaveTextContent(/weight_tuned/));
  });

  it('useGrowthMirror 暴露上抛回调（fire-and-forget）', () => {
    expect(typeof useGrowthMirror).toBe('function');
  });
});
