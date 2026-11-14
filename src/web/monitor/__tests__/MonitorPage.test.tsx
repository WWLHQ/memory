import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonitorPage } from '../MonitorPage.tsx';
import { AlertTimeline } from '../AlertTimeline.tsx';
import { SEED_ALERTS } from './fixtures.ts';
import { resetKernelForTests } from '../../kernel.ts';

// 页面接真：指标卡 = 真实账本实算（无数据口径值位标「未采集」，不拿「—」冒充读数），告警时间线 = 真实账本 monitor_alert 审计。
// jsdom/浏览器 = 内存态空账本 → 诚实空态（metrics-empty / alerts-empty），绝不伪造演示数字。
// SEED_ALERTS / SEED_METRICS 仅作 AlertTimeline 组件单测夹具，页面不渲染。
describe('MonitorPage (P6-T5 编排·真实账本接真版)', () => {
  beforeEach(() => resetKernelForTests());
  afterEach(() => vi.restoreAllMocks());

  it('空账本（jsdom 内存态）→ 14 张卡值位全标「未采集」+ 无告警诚实空态（不伪造演示数字）', async () => {
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('metric-grid')).toBeInTheDocument());
    const cards = [...document.querySelectorAll('[data-testid^="metric-"]')]
      .filter((el) => el.getAttribute('data-testid') !== 'metric-grid');
    expect(cards).toHaveLength(14);
    // 诚实口径：账本为空 → 每个值位都如实标「未采集」，不出现「—」冒充读数或伪造数字
    const vals = [...document.querySelectorAll('.mval')].map((el) => el.textContent?.trim() ?? '');
    expect(vals).toHaveLength(14);
    expect(vals.every((v) => v === '未采集')).toBe(true);
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

  it('REQ-013 / C5（T6-A）：有真实后台操作审计 → 渲染汇总 + 最近明细；无则整块不渲染', async () => {
    const now = Date.now();
    const entries = [
      { request_id: 'a', action: 'schedule_run', label: '定时任务', status: 'succeeded' as const, ts: now - 1000 },
      { request_id: 'b', action: 'gc', label: '遗忘周期', status: 'failed' as const, ts: now - 2000 },
    ];
    const spy = vi.spyOn(await import('../useMonitorReal.ts'), 'loadRealMonitorData')
      .mockResolvedValue({ available: true, memCount: 0, auditCount: 2, metrics: [], alerts: [], operations: entries.map((e) => e.status), operationEntries: entries });
    const first = render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('operations-status')).toBeInTheDocument());
    expect(screen.getByTestId('operations-summary')).toHaveTextContent('已完成 1');
    expect(screen.getByTestId('operations-summary')).toHaveTextContent('失败 1');
    expect(screen.getByTestId('operations-list')).toHaveTextContent('定时任务·已完成');
    expect(screen.getByTestId('operations-list')).toHaveTextContent('遗忘周期·失败');
    first.unmount();
    // 无相关审计 → 整块不渲染（诚实空态，不显示全 0 假卡）
    spy.mockResolvedValue({ available: true, memCount: 0, auditCount: 0, metrics: [], alerts: [], operations: [], operationEntries: [] });
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('monitor-page')).toBeInTheDocument());
    expect(screen.queryByTestId('operations-status')).toBeNull();
  });

  it('待裁决 = 当前冲突记忆数；历史 conflict_resolve 审计不冒充待办（批次48 A15）', async () => {
    const { metricsFromLedger } = await import('../useMonitorReal.ts');
    const mkMem = (id: string, conflict?: string) => ({
      mem_id: id, content: 'x', category: 'fact', project_id: 'P1', layer: 'L2', decay_class: 'hot',
      pinned: false, locked: false, version: 1, created_at: Date.now(), conflict_id: conflict,
    });
    const mems = [mkMem('m1', 'c1'), mkMem('m2', 'c2'), mkMem('m3')];
    // 100 条历史已处置记录：旧实现 Math.max(100, 2)=100 → 虚高
    const audits = Array.from({ length: 100 }, (_, i) => ({
      request_id: `r${i}`, action: 'conflict_resolve', form: 'web', ts: Date.now(),
    }));
    const cards = metricsFromLedger(mems as never, audits as never);
    const pending = cards.find((c) => c.group === '人工审核' && c.metric === '待裁决');
    expect(pending?.value).toBe(2);
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
