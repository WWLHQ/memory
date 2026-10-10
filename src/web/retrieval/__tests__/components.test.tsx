import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryBar, type QueryBarValue } from '../QueryBar.tsx';
import { ResultList } from '../ResultList.tsx';
import { ModeBanner } from '../ModeBanner.tsx';
import { BudgetPanel } from '../BudgetPanel.tsx';
import { ContextPanel } from '../ContextPanel.tsx';
import { useRetrieval } from '../useRetrieval.ts';
import { renderHook, act as actHook } from '@testing-library/react';
import { SEED_HITS } from '../seed.ts';
import type { ModeBannerData, BudgetData } from '../types.ts';

const base: QueryBarValue = { query: '', scene: 'default', mode: null };

describe('QueryBar (T3)', () => {
  it('空查询禁用检索按钮', () => {
    render(<QueryBar value={base} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    expect(screen.getByTestId('q-submit')).toBeDisabled();
  });
  it('critical → minimal 选项禁用 + 重排徽章', () => {
    render(<QueryBar value={{ ...base, scene: 'critical' }} onChange={() => {}} onSubmit={() => {}} loading={false} />);
    const opts = screen.getAllByTitle(/16\.5/);
    expect(opts.length).toBeGreaterThan(0);
    expect(screen.getByTestId('rerank-chip')).toHaveTextContent('重排');
  });
  it('critical 下选 minimal → 回落自动 + toast（§7.5）', () => {
    const onChange = vi.fn();
    render(<QueryBar value={{ ...base, scene: 'critical' }} onChange={onChange} onSubmit={() => {}} loading={false} />);
    fireEvent.change(screen.getByTestId('q-mode'), { target: { value: 'minimal' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scene: 'critical', mode: null }), expect.stringContaining('16.5'));
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
    expect(screen.getByTestId('evidence-thin')).toHaveTextContent('已追加 1 条 Cold');
    expect(screen.getByTestId('fact-retry')).toBeInTheDocument();
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

describe('useRetrieval (T6 状态机)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('IDLE→LOADING→RESULT；硬熔断→ERROR + 冷却 3s', async () => {
    const { result: r } = renderHook(() => useRetrieval());
    expect(r.current.phase).toBe('IDLE');
    actHook(() => r.current.search('缓存 TTL 是多少', 'default', null));
    expect(r.current.phase).toBe('LOADING');
    await actHook(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(r.current.phase).toBe('RESULT');
    actHook(() => r.current.search('x', 'default', null, { forceBreach: true }));
    await actHook(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(r.current.phase).toBe('ERROR');
    expect(r.current.cooldown).toBe(true);
  });
});
