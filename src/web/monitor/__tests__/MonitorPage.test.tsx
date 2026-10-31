import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonitorPage } from '../MonitorPage.tsx';
import { AlertTimeline } from '../AlertTimeline.tsx';
import { SEED_ALERTS } from './fixtures.ts';
import { resetKernelForTests } from '../../kernel.ts';

// 页面接真：指标卡 = 真实账本实算（无数据口径显「—」未采集），告警时间线 = 真实账本 monitor_alert 审计。
// jsdom/浏览器 = 内存态空账本 → 诚实空态（metrics-empty / alerts-empty），绝不伪造演示数字。
// SEED_ALERTS / SEED_METRICS 仅作 AlertTimeline 组件单测夹具，页面不渲染。
describe('MonitorPage (P6-T5 编排·真实账本接真版)', () => {
  beforeEach(() => resetKernelForTests());
  afterEach(() => vi.restoreAllMocks());

  it('空账本（jsdom 内存态）→ 14 张卡全部「—」未采集 + 无告警诚实空态（不伪造演示数字）', async () => {
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('metric-grid')).toBeInTheDocument());
    const cards = [...document.querySelectorAll('[data-testid^="metric-"]')]
      .filter((el) => el.getAttribute('data-testid') !== 'metric-grid');
    expect(cards).toHaveLength(14);
    // 诚实口径：账本为空 → 每个数值位都是「—」，不出现伪造数字
    const vals = [...document.querySelectorAll('.mval')].map((el) => el.textContent?.trim() ?? '');
    expect(vals).toHaveLength(14);
    expect(vals.every((v) => v.startsWith('—'))).toBe(true);
    await waitFor(() => expect(screen.getByTestId('alerts-empty')).toBeInTheDocument());
    expect(screen.getByTestId('alerts-empty')).toHaveTextContent('无 monitor_alert 告警记录');
  });

  it('有真实账本（loadRealMonitorData 返回非空）→ 渲染指标网格 + 告警时间线', async () => {
    const cards = await (await import('../useMonitorReal.ts')).metricsFromLedger(
      [{ mem_id: 'm1', content: 'x', category: 'fact', project_id: 'P1', layer: 'L2', decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: Date.now() } as never,
       { mem_id: 'm2', content: 'y', category: 'fact', project_id: 'P1', layer: 'L2', decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: Date.now(), conflict_id: 'c1' } as never],
      [{ request_id: 'r1', action: 'recall', form: 'web', ts: Date.now() } as never,
       { request_id: 'r2', action: 'recall', form: 'web', ts: Date.now() } as never,
       { request_id: 'r3', action: 'monitor_alert', form: 'web', ts: Date.now(), detail: { entry: SEED_ALERTS[0] } } as never],
    );
    vi.spyOn(await import('../useMonitorReal.ts'), 'loadRealMonitorData')
      .mockResolvedValue({ available: true, memCount: 2, auditCount: 3, metrics: cards, alerts: [SEED_ALERTS[0]] });
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('metric-grid')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId(/^alert-\d+$/)).toHaveLength(1));
  });

  it('筛选 crit → 时间线只剩严重告警（真实告警过滤）', async () => {
    vi.spyOn(await import('../useMonitorReal.ts'), 'loadRealMonitorData')
      .mockResolvedValue({ available: true, memCount: 0, auditCount: 0, metrics: [], alerts: SEED_ALERTS });
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^alert-\d+$/)).toHaveLength(SEED_ALERTS.length));
    fireEvent.change(screen.getByTestId('f-level'), { target: { value: 'crit' } });
    // SEED_ALERTS 中 crit 级 2 条（熔断 OPEN + 哈希校验失败）
    expect(screen.getAllByTestId(/^alert-\d+$/).length).toBe(2);
  });

  // 批次25 P0-7：内核读不到 ≠ 账本为空（原来 catch 里保持空 → 指标卡全「—」被当成没数据）
  it('内核不可达 → 显示内核原因与重试，绝不显示「指标未采集 / 无告警」空态', async () => {
    vi.spyOn(await import('../useMonitorReal.ts'), 'loadRealMonitorData')
      .mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('metrics-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alerts-empty')).not.toBeInTheDocument();
  });
});

describe('AlertTimeline (T3 · 组件单测用种子夹具)', () => {
  it('空筛选显示占位', () => {
    render(<AlertTimeline alerts={[]} />);
    expect(screen.getByTestId('alert-empty')).toBeInTheDocument();
  });
  it('memory_id 可点', () => {
    render(<AlertTimeline alerts={SEED_ALERTS} />);
    expect(screen.getByTestId('alert-mem-0')).toBeInTheDocument();
  });
});
