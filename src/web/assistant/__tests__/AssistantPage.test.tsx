// 记忆助手整页（2026-11-10：原壳层浮窗改为独立页面 assistant.html）契约：
// - 页面自行读取真实账本快照（loadOverview，与首页/状态栏同源），不依赖壳层传 props；
// - 回答只转述本次快照；账本读不到就如实说「没读到」，绝不拿 0 冒充；
// - 刷新约定：页面内「重读」只重取数据（不重挂页面）；壳层 F5 才重挂 iframe（全站刷新）。
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  loadOverview: vi.fn(),
  defaultOverview: {
    loadedAt: 1,
    kernelMode: 'host' as const,
    storageError: null,
    gains: [],
    health: { status: 'ok' as const, detail: 'HTTP 200', checkedAt: 1 },
    session: false,
    billing: { status: 'unavailable' as const, detail: '需登录后查询' },
    raw: { gains: [] as unknown[], anomalies: [] as unknown[], activeMemories: [] as unknown[], todos: [] as unknown[] },
    pendingSync: 0,
    facts: { memories: 7, audits: 12, writeToday: 0, recallToday: 2, conflicts: 1 },
    strata: [],
    effectGains: [],
    graph: { nodes: [] as unknown[], edges: [] as unknown[] },
    recentAudits: { status: 'ok' as const, detail: '', items: [] as unknown[] },
    today: { status: 'ok' as const, detail: '', value: 0 },
    token: { status: 'ok' as const, detail: '', value: 0 },
    refine: { status: 'ok' as const, detail: '', items: [] as unknown[] },
    mcp: { status: 'ok' as const, detail: '', items: [] as unknown[] },
    engines: { status: 'ok' as const, detail: '', items: [] as unknown[] },
    dataRoot: { available: false, root: null, error: '组件单测：不探主进程' },
    l0Write: { available: true, unlocked: false, detail: null },
  },
}));

vi.mock('../../shell/overview.ts', () => ({ loadOverview: m.loadOverview }));

import { AssistantPage } from '../AssistantPage.tsx';
import { answerOverviewQuestion } from '../../overview/overviewPageData.ts';

beforeEach(() => {
  vi.clearAllMocks();
  m.loadOverview.mockResolvedValue(m.defaultOverview);
});

describe('记忆助手整页', () => {
  it('挂载即自取真实账本快照，并给出建议问题入口', async () => {
    render(<AssistantPage />);
    await waitFor(() => expect(m.loadOverview).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('memory-assistant-page')).toBeTruthy();
    expect(screen.getByTestId('ma-state').textContent).toContain('只转述本次快照');
    // 建议问题可点
    expect(screen.getByRole('button', { name: '账本里有多少条记忆？' })).toBeTruthy();
  });

  it('回答只转述本次快照的真实数字', async () => {
    render(<AssistantPage />);
    await waitFor(() => expect(m.loadOverview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '账本里有多少条记忆？' }));
    const answer = screen.getByTestId('ma-answer');
    expect(answer.textContent).toContain('账本里有 7 条记忆');
    expect(answer.textContent).toContain('累计审计 12 条');
  });

  it('问登录/权限：未登录如实说账本查询也需要登录，不再声称「本地账本仍可读」（2026-11-16）', () => {
    const out = answerOverviewQuestion('现在的登录状态怎么样？', m.defaultOverview as never);
    expect(out.lead).toContain('需要先登录');
    expect(out.body).toContain('账本查询同样需要登录');
    expect(`${out.lead}${out.body}`).not.toContain('本地账本仍可读');
    expect(`${out.lead}${out.body}`).not.toContain('不受影响');
    // 登录态照常如实回答，不把未登录提示挂到已登录用户身上
    const loggedIn = answerOverviewQuestion('现在的登录状态怎么样？', { ...m.defaultOverview, session: true } as never);
    expect(loggedIn.lead).toContain('已登录');
    expect(loggedIn.body).toContain('已登录会话下账本可查询');
  });

  it('页面内「重读」只重新取数，不重挂页面（与 F5 全站刷新分层）', async () => {
    render(<AssistantPage />);
    await waitFor(() => expect(m.loadOverview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('ma-refresh'));
    await waitFor(() => expect(m.loadOverview).toHaveBeenCalledTimes(2));
    // 页面仍在（未被卸载重建）
    expect(screen.getByTestId('memory-assistant-page')).toBeTruthy();
  });

  it('空输入不发送；Enter 发送后输入框清空', async () => {
    render(<AssistantPage />);
    await waitFor(() => expect(m.loadOverview).toHaveBeenCalled());
    const input = screen.getByRole('textbox', { name: '问账本' });
    expect(screen.getByTestId('ma-send')).toBeDisabled();
    fireEvent.change(input, { target: { value: '审计里有什么异常？' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('ma-answer')).toBeTruthy());
    expect(screen.getByTestId('ma-answer').textContent).toContain('审计里没有异常');
    expect(input).toHaveValue('');
  });

  it('账本读取失败时如实回答「没读到」，不拿 0 冒充', async () => {
    m.loadOverview.mockResolvedValueOnce({
      ...m.defaultOverview,
      storageError: 'E_LEDGER_LOCKED',
      facts: null,
    } as never);
    render(<AssistantPage />);
    await waitFor(() => expect(m.loadOverview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '账本里有多少条记忆？' }));
    const answer = await screen.findByTestId('ma-answer');
    expect(answer.textContent).toContain('账本没读到，无法回答');
    expect(answer.textContent).toContain('账本暂时被占用，请稍后重试');
    expect(answer.textContent).not.toContain('E_LEDGER_LOCKED');
  });
});
