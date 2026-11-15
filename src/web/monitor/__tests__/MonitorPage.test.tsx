import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonitorPage } from '../MonitorPage.tsx';
import { AlertTimeline } from '../AlertTimeline.tsx';
import { SEED_ALERTS } from './fixtures.ts';
import { resetKernelForTests } from '../../kernel.ts';

// 页面接真：指标卡 = 真实账本实算（无数据口径值位说「暂无数据」，不拿「—」冒充读数），告警时间线 = 真实账本告警审计。
// jsdom/浏览器 = 内存态空账本 → 诚实空态（metrics-empty / alerts-empty），绝不伪造演示数字。
// SEED_ALERTS / SEED_METRICS 仅作 AlertTimeline 组件单测夹具，页面不渲染。
describe('MonitorPage (P6-T5 编排·真实账本接真版)', () => {
  beforeEach(() => resetKernelForTests());
  afterEach(() => vi.restoreAllMocks());

  it('空账本（jsdom 内存态）→ 20 张卡诚实空态：无真值标「暂无数据」，真实 0 / 无极简如实显示 + 无告警诚信空态（不伪造演示数字）', async () => {
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('metric-grid')).toBeInTheDocument());
    const cards = [...document.querySelectorAll('[data-testid^="metric-"]')]
      .filter((el) => el.getAttribute('data-testid') !== 'metric-grid');
    expect(cards).toHaveLength(20);
    // 2026-11-15 用户要求：检索表现置顶、精炼队列（后台任务组）置底。
    // 顺序由 useMonitorReal.metricsFromLedger 的返回数组决定（groupMetrics 用 Map 保插入序），
    // 所以必须锁生产输出，锁夹具（SEED_METRICS）抓不住生产重排。
    const groups = [...document.querySelectorAll('[data-testid^="mgroup-"]')].map((el) => el.getAttribute('data-testid'));
    expect(groups).toEqual([
      'mgroup-检索性能(1h)', 'mgroup-Agent 使用(7d)', 'mgroup-Agent 健康', 'mgroup-采集与备份',
      'mgroup-冷存储', 'mgroup-安全', 'mgroup-人工审核', 'mgroup-队列',
    ]);
    // 诚实口径（B8 跨模块接真 + 批次64 新增 7 卡）：
    //   · 12 张无真实口径 → 「暂无数据」（不拿「—」/「正常」冒充读数）；    //   · 待裁决 / 超期7d / 质量门拦截 = 真实 0（空账本即真实健康态，显示「0条」而非未取数）；
    //   · MCP 调用 / 解锁失败 / 定时任务失败 = 真实 0 次（同理显示「0次」）；
    //   · 链路开销 = 真实 0（本地检索不调大模型，显示「0字」）；
    //   · 极简证据不足率 = 「近 1 天没有极简检索」（分母为 0 不说假 0%）。
    // 值位含单位（来自 recallLabels 人话文案），断言需带单位。
    const vals = [...document.querySelectorAll('.mval')].map((el) => el.textContent?.trim() ?? '');
    expect(vals).toHaveLength(20);
    const counts = vals.reduce<Record<string, number>>((m, v) => { m[v] = (m[v] ?? 0) + 1; return m; }, {});
    expect(counts['暂无数据']).toBe(12);
    expect(counts['0条']).toBe(3);
    expect(counts['0次']).toBe(3);
    expect(counts['0字']).toBe(1);
    expect(vals).toContain('近 1 天没有极简检索');
    await waitFor(() => expect(screen.getByTestId('alerts-empty')).toBeInTheDocument());
    expect(screen.getByTestId('alerts-empty')).toHaveTextContent('当前本机没有告警记录');
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
  it('内核不可达 → 显示内核原因与重试，绝不显示「指标暂无数据 / 无告警」空态', async () => {
    vi.spyOn(await import('../useMonitorReal.ts'), 'loadRealMonitorData')
      .mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('metrics-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alerts-empty')).not.toBeInTheDocument();
  });

  // 2026-11-15 实机 bug：连通率卡片级写死 `unit: ''`，而 MetricGrid 用 `c.unit ?? t.unit`——
  // 空字符串不触发 ?? 回退，真源里的 '%' 被压掉，卡上只显示「100」。这里锁到渲染层防回归。
  it('连通率有样本 → 值位带 % 单位（卡片级不得写死 unit 压掉真源）', async () => {
    const mod = await import('../useMonitorReal.ts');
    const cards = mod.applyMonitorStats(mod.metricsFromLedger([], []), {
      agent: { connectivityRate: 100, circuit: 'CLOSED', avgLatencyMs: 1, probedAt: Date.now(), windowSamples: 25 },
      writeRate: { rate: 100, success: 91, filtered: 27, failed: 0, since: Date.now() - 86_400_000 },
      checksumFail: 0,
    });
    vi.spyOn(mod, 'loadRealMonitorData')
      .mockResolvedValue({ available: true, memCount: 0, auditCount: 0, metrics: cards, alerts: [] });
    render(<MonitorPage />);
    await waitFor(() => expect(screen.getByTestId('metric-grid')).toBeInTheDocument());
    expect(screen.getByTestId('metric-连通成功率(5min)').querySelector('.mval')?.textContent?.trim()).toBe('100%');
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
