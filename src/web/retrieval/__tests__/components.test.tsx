import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryBar, type QueryBarValue } from '../QueryBar.tsx';
import { ResultList } from '../ResultList.tsx';
import { ModeBanner } from '../ModeBanner.tsx';
import { BudgetPanel } from '../BudgetPanel.tsx';
import { ContextPanel } from '../ContextPanel.tsx';
import { RecentRecallsCard, fmtClock } from '../RecentRecallsCard.tsx';
import { useRetrieval } from '../useRetrieval.ts';
import { renderHook, act as actHook } from '@testing-library/react';
import { SEED_HITS } from './fixtures.ts';
import { getKernelWithSeed, resetKernelForTests } from '../../kernel.ts';
import type { ModeBannerData, BudgetData } from '../types.ts';

const base: QueryBarValue = { query: '', scene: 'default', mode: null };

describe('QueryBar (T3)', () => {
  it('空查询禁用检索按钮', () => {
    render(<QueryBar value={base} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    expect(screen.getByTestId('q-submit')).toBeDisabled();
  });
  it('critical → minimal 胶囊禁用 + 重排徽章', () => {
    render(<QueryBar value={{ ...base, scene: 'critical' }} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    const opts = screen.getAllByTitle(/16\.5/);
    expect(opts.length).toBeGreaterThan(0);
    expect(screen.getByTestId('mode-minimal')).toBeDisabled();
    expect(screen.getByTestId('rerank-chip')).toHaveTextContent('重排');
  });
  it('点模式胶囊 → onChange 带该模式（自动 = null）', () => {
    const onChange = vi.fn();
    render(<QueryBar value={base} onChange={onChange} onSubmit={() => {}} loading={false} />);
    fireEvent.click(screen.getByTestId('mode-fact_first'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fact_first' }), null);
    fireEvent.click(screen.getByTestId('mode-auto'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: null }), null);
  });
  it('当前模式胶囊高亮（active 唯一）', () => {
    render(<QueryBar value={{ ...base, mode: 'fact_first' }} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    const active = document.querySelectorAll('.ret-pill.active');
    expect(active.length).toBe(1);
    expect(active[0]).toHaveTextContent('事实优先');
  });
  it('短查询出现极简提示', () => {
    render(<QueryBar value={{ ...base, query: '修一下空指针' }} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    expect(screen.getByTestId('minimal-hint')).toHaveTextContent('极简');
  });
  it('session 上下文只读（R1）', () => {
    render(<QueryBar value={base} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    expect(screen.getByTestId('ctx-note')).toHaveTextContent('只读');
  });
});

describe('ResultList / ResultRow (T4)', () => {
  const doRender = () => render(
    <ResultList
      hits={SEED_HITS}
      selectedId={null}
      onView={() => {}}
      onRemember={() => {}}
      onForget={() => {}}
      onFeedback={() => {}}
    />,
  );
  it('pinned 置顶第一行（R3）', () => {
    doRender();
    const first = screen.getAllByTestId(/^hit-\d+$/)[0];
    expect(first).toHaveAttribute('data-mid', 'mem_p01');
  });
  it('cold 行只给 L2 占位（R2）+ 补查角标', () => {
    doRender();
    fireEvent.click(screen.getByTestId('load-more')); // cold mem_060 在 Top 6
    const coldRow = screen.getAllByTestId(/^hit-content-\d+$/).find((el) => el.textContent?.includes('冷存档'));
    expect(coldRow).toHaveTextContent('L2 摘要占位');
  });
  it('冲突行有 ⚡ 徽标', () => {
    doRender();
    expect(screen.getAllByTestId(/hit-conflict-\d+/)[0]).toHaveTextContent('⚡');
  });
  it('记住/忘记/反馈按钮存在', () => {
    doRender();
    expect(screen.getAllByTestId(/^remember-\d+$/).length).toBe(5);
    expect(screen.getAllByTestId(/^forget-\d+$/).length).toBe(5);
    expect(screen.getAllByTestId(/^fb-\d+$/).length).toBe(5);
  });
  it('加载更多至 Top 10', () => {
    doRender();
    fireEvent.click(screen.getByTestId('load-more'));
    expect(screen.getAllByTestId(/^hit-\d+$/).length).toBe(6);
  });
});

const banner: ModeBannerData = {
  scene: 'critical', mode: 'fact_first', fallback: false,
  hit_keywords: ['fact'], request_id: 'req_r1',
  secondary_mode_hint: { mode: 'minimal', note: '≤200t' },
  evidence_thin: 'backfill_hit', cold_recall: true,
};

describe('ModeBanner (T5)', () => {
  it('chip/关键词/request_id 可点', () => {
    const onReq = vi.fn();
    render(<ModeBanner data={banner} onRequestId={onReq} onFactRetry={() => {}} />);
    fireEvent.click(screen.getByTestId('banner-req'));
    expect(onReq).toHaveBeenCalledWith('req_r1');
    expect(screen.getByTestId('banner-cold')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-hint')).toBeInTheDocument();
  });
  it('evidence_thin 黄条 + 切事实优先按钮', () => {
    render(<ModeBanner data={banner} onRequestId={() => {}} onFactRetry={() => {}} />);
    expect(screen.getByTestId('evidence-thin')).toHaveTextContent('已追加 1 条冷层摘要');
    expect(screen.getByTestId('fact-retry')).toBeInTheDocument();
  });
  // A9：自动极简观测档（applied='auto'）下，横幅不能一边显示「极简轻量」一边说「本轮按默认口径执行」。
  it('A9 · 自动极简观测档：横幅写「自动」并与内核回显同口径，不冒充极简已生效', () => {
    const observed: ModeBannerData = {
      ...banner,
      mode: 'minimal', fallback: true,
      dispatch: {
        source: 'auto', suggested: 'minimal', applied: 'auto', secondary: null,
        reason: '自动分流：default 零命中 + 短查询触发极简', weights_source: 'growth:v1',
      },
    };
    render(<ModeBanner data={observed} onRequestId={() => {}} onFactRetry={() => {}} />);
    const chip = screen.getByTestId('banner-mode').textContent ?? '';
    expect(chip).toContain('自动');
    expect(chip).toContain('分流建议极简轻量');
    expect(chip).toContain('本轮按默认口径执行');
    expect(chip).not.toMatch(/^模式: 极简轻量/);
  });
});

const budget: BudgetData = {
  payload_tokens: 1800, pipeline_llm_tokens: 640, stage1_count: 6, stage2_count: 5,
  rerank_applied: true, budget_breach: true, breach_detail: ['L2 摘要 × 1 条'],
};

describe('BudgetPanel (T5)', () => {
  it('三档变色：1800 → trim 状态', () => {
    render(<BudgetPanel data={budget} />);
    expect(screen.getByTestId('budget-level')).toHaveTextContent('已裁剪');
    expect(screen.getByTestId('breach-detail')).toHaveTextContent('超支被裁');
  });
  it('3001 → 硬熔断', () => {
    render(<BudgetPanel data={{ ...budget, payload_tokens: 3001 }} />);
    expect(screen.getByTestId('budget-level')).toHaveTextContent('硬熔断');
  });
  it('右侧栏口径：占比按注入总量、漏斗与裁剪明细取真实计数', () => {
    render(<BudgetPanel data={{
      ...budget,
      payload_tokens: 1460, budget_tokens: 3000, injected_total_tokens: 1840,
      scanned_count: 1467, background_tokens: 220, background_count: 42,
      stage1_count: 42, injected_count: 3, dropped_count: 39, budget_breach: false,
    }} />);
    expect(screen.getByTestId('budget-pct')).toHaveTextContent('61');
    const funnel = screen.getByTestId('funnel');
    expect(funnel).toHaveTextContent('1467');
    expect(funnel).toHaveTextContent('42');
    expect(funnel).toHaveTextContent('3');
    const trim = screen.getByTestId('trim-detail');
    expect(trim).toHaveTextContent('项目背景 220t');
    expect(trim).toHaveTextContent('命中 42 条 1460t');
    expect(trim).toHaveTextContent('合计 1840t');
    expect(trim).toHaveTextContent('未注入 39 条');
  });
  it('审计快照口径：无注入条数就写「命中」，只渲染审计里有值的那几行', () => {
    render(<BudgetPanel data={{
      payload_tokens: 1460, pipeline_llm_tokens: 0, stage1_count: 3, stage2_count: 3,
      rerank_applied: false, budget_breach: false, budget_tokens: 3000,
      scanned_count: 4508, background_tokens: 265, injected_total_tokens: 1725,
      trimmed_tokens: 3464, injected_count: undefined, dropped_count: undefined,
    }} sourceNote="最近一次召回 · 16:20:53" />);
    const funnel = screen.getByTestId('funnel');
    expect(funnel).toHaveTextContent('命中');
    expect(funnel).not.toHaveTextContent('注入');
    expect(screen.getByTestId('trim-trimmed')).toHaveTextContent('熔断裁掉 3464t');
    // 审计没记录未注入条数 → 这一行根本不渲染（不写「—」冒充读数）
    expect(screen.queryByTestId('trim-dropped')).toBeNull();
    expect(screen.getByTestId('budget-source')).toHaveTextContent('最近一次召回 · 16:20:53');
  });
  it('注入总量缺省 → 回落 payload，不出现 NaN/0%', () => {
    render(<BudgetPanel data={{ ...budget, payload_tokens: 750, budget_tokens: 3000, budget_breach: false }} />);
    expect(screen.getByTestId('budget-pct')).toHaveTextContent('25');
    expect(screen.getByTestId('budget-pct').textContent).not.toContain('NaN');
  });
});

describe('ContextPanel (T5)', () => {
  it('cold 条仅 L2 + 审计展开（R2）', () => {
    const cold = SEED_HITS.find((h) => h.l2_only)!;
    render(<ContextPanel hit={cold} query="数据库" onLifecycle={() => {}} onAudit={() => {}} />);
    expect(screen.getByTestId('ctx-content')).toHaveTextContent('L2 摘要占位');
    fireEvent.click(screen.getByTestId('ctx-reveal'));
    expect(screen.getByTestId('ctx-content')).toHaveTextContent('旧数据库选型');
  });
});

describe('RecentRecallsCard（右栏最近召回）', () => {
  const rows = [
    { request_id: 'req_a', ts: Date.UTC(2026, 10, 19, 8, 0, 0), query: 'SolidWorks 插件 批量转换', hits: 3, injected_tokens: 1840 },
    { request_id: 'req_b', ts: Date.UTC(2026, 10, 19, 7, 12, 44), query: 'MCP 身份头 串号归并', hits: 2, injected_tokens: 960 },
  ];
  it('时间按北京时间显示（UTC 08:00 → 16:00:00）', () => {
    expect(fmtClock(Date.UTC(2026, 10, 19, 8, 0, 0))).toBe('16:00:00');
  });
  it('列出时间 / query / 命中 / 注入 t，并显示今日次数', () => {
    render(<RecentRecallsCard phase="ready" rows={rows} today={38} onRefresh={() => {}} onOpenAudit={() => {}} />);
    expect(screen.getByTestId('recent-today')).toHaveTextContent('今日 38 次');
    const first = screen.getByTestId('recent-row-req_a');
    expect(first).toHaveTextContent('16:00:00');
    expect(first).toHaveTextContent('SolidWorks 插件 批量转换');
    expect(first).toHaveTextContent('3');
    expect(first).toHaveTextContent('1840');
  });
  it('点一行 → 带 request_id 打开审计', () => {
    const open = vi.fn();
    render(<RecentRecallsCard phase="ready" rows={rows} today={2} onRefresh={() => {}} onOpenAudit={open} />);
    fireEvent.click(screen.getByTestId('recent-row-req_b'));
    expect(open).toHaveBeenCalledWith('req_b');
  });
  it('账本零记录 → 如实写 0 条，不塞演示行', () => {
    render(<RecentRecallsCard phase="ready" rows={[]} today={0} onRefresh={() => {}} onOpenAudit={() => {}} />);
    expect(screen.getByTestId('recent-empty')).toHaveTextContent('真实 0 条');
    expect(document.querySelectorAll('.ret-recent-row').length).toBe(0);
  });
});

describe('useRetrieval (T6 状态机)', () => {
  beforeEach(() => {
    resetKernelForTests();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('IDLE→LOADING→RESULT（真实内核 recall，空库如实 EMPTY）', async () => {
    // 真实内核账本预置一条命中记忆（recall 走内核，空库会如实返回 EMPTY）
    await getKernelWithSeed()._seedMemory({ content: '缓存 TTL 设为 300s（生产默认）', category: 'fact', project_id: 'P1' });
    const { result: r } = renderHook(() => useRetrieval());
    expect(r.current.phase).toBe('IDLE');
    actHook(() => r.current.search('缓存 TTL 是多少', 'default', null));
    expect(r.current.phase).toBe('LOADING');
    await actHook(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(r.current.phase).toBe('RESULT');
  });
});
