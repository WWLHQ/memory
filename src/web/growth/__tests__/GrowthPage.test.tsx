// GrowthPage 接真内核验收：动作审计真写账本 + 挂载回放 + mirror 上抛钩子存在
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GrowthPage } from '../GrowthPage.tsx';
import { coreGrowthAudit, coreLoadGrowthAudit } from '../coreGrowth.ts';
import { useGrowthMirror } from '../useGrowthMirror.ts';
import { resetKernelForTests } from '../../kernel.ts';
import { auditOptimization } from '../logic.ts';
import { ShortCircuitFlow } from '../DedupCards.tsx';
import { ScheduleTimeline } from '../GrowthPanels.tsx';
import type { ScheduleItem } from '../types.ts';

async function renderLoaded() {
  const utils = render(<GrowthPage />);
  await waitFor(() => expect(screen.getByTestId('growth-page')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('manual-trigger')).toBeInTheDocument());
  return utils;
}

describe('GrowthPage × 内核审计账本', () => {
  beforeEach(() => resetKernelForTests());

  it('冷启动手动触发 → 真实回归 no-op：toast/状态显示「样本不足 · 积累样本」，不伪造 weight_tuned', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('manual-trigger'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/样本不足/));
    await waitFor(() => expect(screen.getByTestId('regression-status')).toHaveTextContent(/样本不足/));
    expect(screen.getByTestId('regression-status')).toHaveTextContent(/积累样本，非故障/);
    // 空账本没有样本 → 不会产生任何 weight_tuned 点，也不会手写假配置
    expect(screen.queryAllByTestId('tuned-point')).toHaveLength(0);
    const audits = await coreLoadGrowthAudit();
    expect(audits.some((e) => e.event === 'weight_tuned')).toBe(false);
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

/** 批次48 A23.4：调度时间轴三件事必须可见（宿主 / 最近 schedule_run / 下次到期），
 *  Web 端只能说明「调度由桌面端执行」，不得出现任何「已调度」状态。 */
describe('ScheduleTimeline × 调度架构与未调度标注（A23.4）', () => {
  const item = (run?: ScheduleItem['run']): ScheduleItem => ({
    key: 'self_growth', label: '自生长（权重回归）', cron: '周日 03:00', required: false, enabled: true, run,
  });

  it('无记录 → 三处如实标注「尚未运行 / 无记录」，并说明调度由桌面端执行', () => {
    render(<ScheduleTimeline schedule={[item(null)]} onToggle={() => {}} hostKind="none" />);
    expect(screen.getByTestId('sched-arch')).toHaveTextContent('调度由桌面端执行');
    expect(screen.getByTestId('sched-arch')).toHaveTextContent('本页不执行调度');
    expect(screen.getByTestId('sched-run-self_growth')).toHaveTextContent('尚未运行');
    expect(screen.getByTestId('sched-run-self_growth')).toHaveTextContent('schedule_run 记录');
    expect(screen.getByTestId('sched-next-self_growth')).toHaveTextContent('无记录');
    expect(screen.getByTestId('sched-host-self_growth')).toHaveTextContent('Web 端不执行调度');
    expect(screen.getByTestId('schedule-timeline')).not.toHaveTextContent('已调度');
  });

  it('有真实审计 → 显示审计时间/下次到期/审计宿主，不按 cron 推算', () => {
    const ts = new Date(2026, 10, 1, 3, 0).getTime();
    const next = new Date(2026, 10, 8, 3, 0).getTime();
    render(
      <ScheduleTimeline
        schedule={[item({
          task: 'self_growth', ts, next_due_at: next, host: 'electron-main',
          status: 'ok', duration_ms: 42, error: null, result: {},
        })]}
        onToggle={() => {}}
        hostKind="none"
      />,
    );
    expect(screen.getByTestId('sched-run-self_growth')).toHaveTextContent('2026-11-01 03:00');
    expect(screen.getByTestId('sched-run-self_growth')).toHaveTextContent('42ms');
    expect(screen.getByTestId('sched-next-self_growth')).toHaveTextContent('2026-11-08 03:00');
    // 宿主取自审计真实 host，而非当前浏览器端能力
    expect(screen.getByTestId('sched-host-self_growth')).toHaveTextContent('主进程（Electron）');
    expect(screen.getByTestId('schedule-timeline')).not.toHaveTextContent('已调度');
  });
});
