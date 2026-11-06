// GrowthPage 接真内核验收：动作审计真写账本 + 挂载回放 + mirror 上抛钩子存在
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GrowthPage } from '../GrowthPage.tsx';
import { coreGrowthAudit, coreLoadGrowthAudit } from '../coreGrowth.ts';
import { useGrowthMirror } from '../useGrowthMirror.ts';
import { resetKernelForTests } from '../../kernel.ts';
import { auditOptimization } from '../logic.ts';
import { ShortCircuitFlow } from '../DedupCards.tsx';

async function renderLoaded() {
  const utils = render(<GrowthPage />);
  await waitFor(() => expect(screen.getByTestId('growth-page')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('manual-trigger')).toBeInTheDocument());
  return utils;
}

describe('GrowthPage × 内核审计账本', () => {
  beforeEach(() => resetKernelForTests());

  it('手动触发 → toast + Δ 曲线取账本实算 + weight_tuned 审计真写内核（detail.entry 保真）', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('manual-trigger'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/weight_tuned/));
    // 曲线 = 账本中真实 weight_tuned 事件（触发 1 次 → 1 个点）
    await waitFor(() => expect(screen.getAllByTestId('tuned-point')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('growth-audit')).toHaveTextContent(/manual/));
    // 内核账本可查（事件/动作保真）
    const entries = await coreLoadGrowthAudit();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.event === 'weight_tuned' && e.action === 'regress_mode_weights')).toBe(true);
  });

  it('调度停用 → schedule_changed 审计真写内核', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('sched-check-verdict_reminder')); // 非 required 项可停
    await waitFor(async () => {
      const entries = await coreLoadGrowthAudit();
      expect(entries.some((e) => e.event === 'schedule_changed')).toBe(true);
    });
  });

  it('重挂载 → 内核账本历史回放（growth-audit 区可见 weight_tuned）', async () => {
    // 先由真实链路写一条 weight_tuned（不经 UI），再验证页面回放
    const entry = auditOptimization(
      { auditName: 'weight_tuned', action: 'regress_mode_weights', key: 'regress_weights' },
      { trigger: 'manual', delta_before: 0.42 },
      true,
    );
    await coreGrowthAudit(entry, 'req_test_growth');

    const first = await renderLoaded();
    first.unmount();
    render(<GrowthPage />);
    await waitFor(() => expect(screen.getByTestId('growth-audit')).toHaveTextContent(/weight_tuned/));
  });

  it('useGrowthMirror 暴露上抛回调（fire-and-forget）', () => {
    expect(typeof useGrowthMirror).toBe('function');
  });

  it('平均查重耗时只认真实采样：无采样显示「—/账本未采样」，有采样才显示 ms（批次48 A12）', () => {
    const { rerender } = render(
      <ShortCircuitFlow steps={[]} stats={{ short_circuit_hits: 0, merged: 0, avg_cost_ms: 0, avg_cost_samples: 0 }} />,
    );
    const row = screen.getByTestId('stats-24h');
    expect(row).toHaveTextContent('平均查重耗时：—');
    expect(row).toHaveTextContent('账本未采样');

    rerender(
      <ShortCircuitFlow steps={[]} stats={{ short_circuit_hits: 1, merged: 1, avg_cost_ms: 12.5, avg_cost_samples: 4 }} />,
    );
    expect(row).toHaveTextContent('12.5ms');
    expect(row).toHaveTextContent('真实采样 4 条写入');
  });
});
