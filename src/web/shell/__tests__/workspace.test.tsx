// 壳层渲染行为（批次48 S1）：导航、不可用态、状态栏诚实口径、底部标签。
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestOverride } from '../../Home/crossTabAuth.ts';
import { SELECTION_MSG } from '../../shared/selectionChannel.ts';

// 概览条的数据加载走真实内核/网络；组件单测只验证渲染契约，故固定快照。
vi.mock('../overview.ts', () => ({
  loadOverview: vi.fn(async () => ({
    loadedAt: 1,
    kernelMode: 'host' as const,
    storageError: null,
    gains: [
      { icon: 'x', title: '累计记忆', big: '7', desc: '内核记忆主表条数', src: '内核账本·实时' },
      { icon: 'x', title: '累计动作', big: '12', desc: '审计流水累计条数', src: '内核账本·实时' },
      { icon: 'x', title: '近 1h 调用', big: '2', desc: '审计 ts ≥ now−60min', src: '内核账本·实时' },
      { icon: 'x', title: '待裁决', big: '1', desc: '9.7 冲突队列', src: '内核账本·实时' },
    ],
    health: { status: 'ok' as const, detail: 'HTTP 200', checkedAt: 1 },
    session: false,
    billing: { status: 'unavailable' as const, detail: '需登录后查询（余额视图按会话鉴权）' },
  })),
}));

vi.mock('../taskpane.ts', () => ({
  loadPendingWrites: vi.fn(),
}));

// 底部面板/状态栏数据源走真实宿主与账本；渲染测试替换加载器，契约不变。
vi.mock('../dock.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dock.ts')>();
  return {
    ...actual,
    loadOutputLog: vi.fn(),
    loadScheduleRuns: vi.fn(),
    loadAuditForMemory: vi.fn(),
  };
});

vi.mock('../statusbar.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../statusbar.ts')>();
  return {
    ...actual,
    loadStatusbar: vi.fn(),
  };
});

vi.mock('../layers.ts', () => ({
  loadLayerPanel: vi.fn(),
}));

import { Workspace } from '../Workspace.tsx';
import { loadAuditForMemory, loadOutputLog, loadScheduleRuns } from '../dock.ts';
import { loadStatusbar } from '../statusbar.ts';
import { loadLayerPanel } from '../layers.ts';
import { loadPendingWrites } from '../taskpane.ts';

beforeEach(() => {
  localStorage.clear();
  setTestOverride(false);
  vi.mocked(loadPendingWrites).mockReset();
  vi.mocked(loadPendingWrites).mockResolvedValue({
    status: 'unavailable',
    detail: '浏览器模式：没有主进程，读不到 MCP 写入兜底队列；请用桌面端查看。',
  });
  vi.mocked(loadOutputLog).mockReset();
  vi.mocked(loadOutputLog).mockResolvedValue({
    status: 'unavailable',
    detail: '浏览器模式：没有主进程，读不到本机 actions.log；请在桌面端查看。',
  });
  vi.mocked(loadScheduleRuns).mockReset();
  vi.mocked(loadScheduleRuns).mockResolvedValue({
    status: 'unavailable',
    detail: '未登录：浏览器使用进程内内存账本，读不到主进程的调度运行记录；请在桌面端查看。',
  });
  vi.mocked(loadAuditForMemory).mockReset();
  vi.mocked(loadAuditForMemory).mockResolvedValue({ status: 'ok', view: [] });
  vi.mocked(loadStatusbar).mockReset();
  vi.mocked(loadStatusbar).mockResolvedValue({
    location: { status: 'ok', view: { kind: 'file', path: 'C:\\data\\memories.db.json', source: 'ipc' } },
    l0: { status: 'ok', view: { has_admin_wrap: true, write_unlocked: false, active_sessions: 0, active_grants: 0 } },
    collector: {
      status: 'ok',
      view: { running: true, intervalMs: 60_000, lastAt: 1_790_000_000_000, lastCollected: 12, autoRetryStopped: false, consecutiveFails: 0 },
    },
  });
  vi.mocked(loadLayerPanel).mockReset();
  vi.mocked(loadLayerPanel).mockResolvedValue({
    status: 'ok',
    view: {
      total: 7,
      layers: [
        { layer: 'L6', count: 1 }, { layer: 'L5', count: 2 }, { layer: 'L4', count: 0 },
        { layer: 'L3', count: null }, { layer: 'L2', count: 1 }, { layer: 'L1', count: 2 },
      ],
      failed: ['L3'],
      l0: { status: 'ok', view: { has_admin_wrap: true, write_unlocked: false, active_sessions: 0, active_grants: 0 } },
      kernelMode: 'host',
      loadedAt: 1_790_000_000_000,
    },
  });
});

/** 渲染并等待概览异步加载落地（避免 act 警告，也确保断言发生在真实渲染之后） */
async function renderShell() {
  const r = render(<Workspace />);
  await screen.findByTestId('sb-overview-refresh');
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe('工作台壳层', () => {
  it('默认打开概览，中心区嵌入真实 index.html（iframe 而非假内容）', async () => {
    const { container } = await renderShell();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    const frames = container.querySelectorAll('iframe.page-frame');
    expect(frames.length).toBe(1);
    expect((frames[0] as HTMLIFrameElement).getAttribute('src')).toContain('/index.html');
  });

  it('概览页整页渲染在 iframe 内：壳层不再叠旧首页数据条，未登录显示只读条', async () => {
    const { container } = await renderShell();
    // 旧 ov-strip（4 卡 + chips）已移除，避免与概览页统计卡叠层重复
    expect(container.querySelector('.ov-strip')).toBeNull();
    expect(screen.queryByText('累计记忆')).toBeNull();
    // 未登录：按程序实际能力标为只读，并提供真实登录入口
    expect(screen.getByTestId('auth-readonly-strip')).toBeInTheDocument();
    expect(screen.getByTestId('auth-readonly-strip').textContent).toContain('本地账本仍可读');
    // 成本余额需会话：如实不可用，不显示编造余额
    expect(screen.getByTestId('sb-billing').textContent).toContain('不可用');
    expect(screen.getByTestId('sb-billing').getAttribute('title')).toContain('需登录');
  });

  it('登录与会话是主导航里的真实页面 login.html', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('treeitem', { name: /登录与会话/ }));
    const frames = container.querySelectorAll('iframe.page-frame');
    expect(frames.length).toBe(2);
    expect((frames[1] as HTMLIFrameElement).getAttribute('src')).toContain('/login.html');
  });

  it('演示通览不进主导航', async () => {
    await renderShell();
    expect(screen.queryByText(/通览/)).toBeNull();
  });

  it('个人记忆为不可用态：不出现 iframe，不显示任何计数，只给原因', async () => {
    const { container } = await renderShell();
    const node = screen.getByRole('treeitem', { name: /个人记忆/ });
    fireEvent.click(node);
    expect(screen.getAllByText(/个人记忆 · 不可用/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/程序暂无个人记忆数据模型/).length).toBeGreaterThan(0);
    // 仍只有概览那个 iframe，个人记忆没有被包装成空壳页面
    expect(container.querySelectorAll('iframe.page-frame').length).toBe(1);
    const empty = container.querySelector('.shell-empty');
    expect(empty?.textContent ?? '').not.toMatch(/\d/);
  });

  it('工具栏不可用命令被禁用并给出原因，不伪造结果', async () => {
    await renderShell();
    const help = screen.getByRole('button', { name: /快捷键/ });
    expect(help).toBeDisabled();
    expect(help.getAttribute('title')).toContain('未提供快捷键清单页');
  });

  it('底部终端标签如实说明不可用', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /终端/ }));
    expect(screen.getByText(/程序未提供终端命令通道/)).toBeInTheDocument();
  });

  it('状态栏接真实读数：库/L0/后台/已选/行高可追溯，且无「—」占位', async () => {
    const { container } = await renderShell();
    await screen.findByTestId('sb-l0');
    const bar = container.querySelector('.statusbar') as HTMLElement;
    expect(bar.textContent).not.toMatch(/—/);
    expect(screen.getByTestId('sb-storage').textContent).toContain('memories.db.json');
    expect(screen.getByTestId('sb-storage').getAttribute('title')).toContain('C:\\data\\memories.db.json');
    expect(screen.getByTestId('sb-l0').textContent).toContain('已锁定');
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('有效授权 0');
    expect(screen.getByTestId('sb-bg').textContent).toContain('运行中');
    expect(screen.getByTestId('sb-bg').getAttribute('title')).toContain('间隔 60000 ms');
    expect(screen.getByTestId('sb-selected').textContent).toContain('无');
    expect(bar.textContent).toContain('行高 26 px');
  });

  it('状态栏不可用态写原因，不用 0 或「—」冒充读数', async () => {
    vi.mocked(loadStatusbar).mockResolvedValue({
      location: { status: 'ok', view: { kind: 'memory', source: 'browser-memory' } },
      l0: { status: 'unavailable', detail: '浏览器模式：L0 会话由桌面主进程的 L0Vault 保管，浏览器读不到。' },
      collector: { status: 'error', detail: '主进程未返回 ok（采集器状态不可读）' },
    });
    const { container } = await renderShell();
    await screen.findByTestId('sb-l0');
    const bar = container.querySelector('.statusbar') as HTMLElement;
    expect(screen.getByTestId('sb-storage').textContent).toContain('内存态');
    expect(screen.getByTestId('sb-l0').textContent).toContain('不可用');
    expect(screen.getByTestId('sb-l0').getAttribute('title')).toContain('L0Vault');
    expect(screen.getByTestId('sb-bg').textContent).toContain('异常');
    expect(bar.textContent).not.toMatch(/—/);
  });

  it('主题切换会写到 html[data-theme]，并被状态栏按钮反映', async () => {
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('S3 深链接线（D4）：壳层把初值真的交给目标真实页面', () => {
  function activeFrameSrc(container: HTMLElement): string | null {
    const frame = container.querySelector('.page-pane.active iframe.page-frame');
    return frame ? frame.getAttribute('src') : null;
  }

  it('Ribbon「归档（需登录）」开独立标签，iframe src 带 ?status=archived', async () => {
    // 该动作按程序能力需登录：临时置会话有效，验证深链初值确实交给目标页
    setTestOverride(true);
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /归档（需登录）/ }));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory.html');
    expect(src).toContain('status=archived');
    // 归档与「全部记忆」是同一页面不同初值 → 必须是独立标签，不能复用旧标签
    expect(container.querySelector('.tabstrip')?.textContent ?? '').toContain('归档（需登录）');
    setTestOverride(false);
  });

  it('未登录时「需登录」动作按程序实际能力禁用并给出原因', async () => {
    await renderShell();
    const archive = screen.getByRole('button', { name: /归档（需登录）/ });
    expect(archive).toBeDisabled();
    expect(archive.getAttribute('title')).toContain('未登录（会话 401）');
  });

  it('导航「L0 密文（需解锁）」指向层级页并带 #l0bar 锚点', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('treeitem', { name: /L0 密文（需解锁）/ }));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory-layered.html');
    expect(src).toContain('#l0bar');
    // 顺手等分层条真实读数落地，避免异步状态更新落在 act 之外
    await screen.findByTestId('layer-strip');
  });

  it('无 href 的命令仍复用原有标签，不凭空新增重复标签', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/ }));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory.html');
    expect(src).not.toContain('status=archived');
  });
});

describe('S4 属性检查器：只显示真实页面回传的选中项', () => {
  const PAYLOAD = {
    v: 1 as const,
    page: 'memory.html',
    title: '记忆 mem_1',
    subtitle: '真实账本记录 · 状态 active',
    fields: [
      { k: 'ID', v: 'mem_1', mono: true },
      { k: '状态', v: 'active' },
    ],
  };

  async function dispatchTo(container: HTMLElement, payload: unknown, opts: { origin?: string } = {}) {
    const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement | null;
    expect(frame?.contentWindow).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { [SELECTION_MSG]: payload },
        origin: opts.origin ?? window.location.origin,
        source: frame!.contentWindow,
      }));
    });
  }

  it('收到当前页合法回传 → 检查器显示字段与来源，不显示「尚未接入」占位', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/ }));
    await dispatchTo(container, PAYLOAD);
    expect(screen.getByText(/记忆 mem_1/)).toBeInTheDocument();
    expect(screen.getByText('mem_1')).toBeInTheDocument();
    expect(screen.getByText(/来源：memory.html 回传的真实账本字段/)).toBeInTheDocument();
    expect(screen.queryByText(/中心页尚未回传选中项/)).toBeNull();
  });

  it('回传 null → 检查器退回诚实空态（不保留上一份选区）', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/ }));
    await dispatchTo(container, PAYLOAD);
    await dispatchTo(container, null);
    expect(screen.queryByText('mem_1')).toBeNull();
    expect(screen.getByText(/中心页尚未回传选中项/)).toBeInTheDocument();
  });

  it('非同源来源的回传被丢弃', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/ }));
    await dispatchTo(container, PAYLOAD, { origin: 'http://evil.example' });
    expect(screen.queryByText('mem_1')).toBeNull();
  });

  it('页面与当前激活标签不符的回传被丢弃（避免后台标签串数据）', async () => {
    const { container } = await renderShell();
    // 当前激活仍是概览 index.html
    await dispatchTo(container, PAYLOAD);
    expect(screen.queryByText('mem_1')).toBeNull();
  });

  it('形状不合法的回传被丢弃', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /记忆列表/ }));
    await dispatchTo(container, { v: 1, page: 'memory.html', title: 'x', fields: [] });
    expect(screen.queryByText('x')).toBeNull();
  });
});

describe('S5 任务窗「待重放写入」：只读，不可用就说原因', () => {
  async function openTaskPane() {
    const r = await renderShell();
    // 状态栏的任务窗开关（Ribbon 里也有同名 title，这里限定在状态栏内取）
    const cell = r.container.querySelector('.statusbar [title="任务窗格"]') as HTMLElement | null;
    expect(cell).toBeTruthy();
    await act(async () => {
      fireEvent.click(cell!);
      await Promise.resolve();
    });
    return r;
  }

  it('浏览器模式如实不可用，不显示 0 条冒充空队列', async () => {
    await openTaskPane();
    const note = await screen.findByTestId('pending-unavailable');
    expect(note.textContent).toContain('浏览器模式');
    expect(screen.queryByTestId('pending-count')).toBeNull();
  });

  it('主进程返回真实队列 → 显示计数与每条摘要，且不含正文', async () => {
    vi.mocked(loadPendingWrites).mockResolvedValue({
      status: 'ok',
      view: {
        ok: true,
        count: 2,
        items: [
          { id: 'pend_2', created_at: 2000, project_id: 'P-1', source_agent: 'claude-code', category: 'fact', user_id: 'u1', session_id: null, content_chars: 12, tags: 1, importance: 0.6, confidence: null, half_life_days: null },
          { id: 'pend_1', created_at: 1000, project_id: 'P-1', source_agent: null, category: 'fact', user_id: null, session_id: null, content_chars: 8, tags: 0, importance: null, confidence: null, half_life_days: null },
        ],
        truncated: false,
        source: 'MCP 写入兜底队列（主进程内存 · 与 8202/8204 MCP 共用）',
        note: '只读摘要，不含正文与密钥材料。',
        captured_at: '2026-11-08T00:00:00.000Z',
      },
    });
    await openTaskPane();
    await screen.findByTestId('pending-count');
    expect(screen.getByTestId('pending-count').textContent).toContain('2');
    expect(screen.getAllByTestId('pending-item')).toHaveLength(2);
    expect(screen.getByText('pend_2')).toBeInTheDocument();
    // 无 source_agent 时说明缺失原因，而不是用「—」填充
    expect(screen.getByText(/未标注（请求无 source_agent）/)).toBeInTheDocument();
    expect(screen.getByText(/不含正文与密钥材料/)).toBeInTheDocument();
  });

  it('真实空队列 → 明确的空队列说明，而不是不可用', async () => {
    vi.mocked(loadPendingWrites).mockResolvedValue({
      status: 'ok',
      view: {
        ok: true, count: 0, items: [], truncated: false,
        source: 'MCP 写入兜底队列（主进程内存）',
        note: '进程重启即清空。',
        captured_at: '2026-11-08T00:00:00.000Z',
      },
    });
    await openTaskPane();
    await screen.findByTestId('pending-count');
    expect(screen.getByText(/队列为空：当前没有因 L0 写密钥未解锁而暂存的写入/)).toBeInTheDocument();
    expect(screen.queryByTestId('pending-unavailable')).toBeNull();
  });

  it('读取失败 → 显示原因与刷新入口，不渲染任何队列数字', async () => {
    vi.mocked(loadPendingWrites).mockResolvedValue({ status: 'error', detail: '宿主能力缺失: window.api.l0.pendingWrites' });
    await openTaskPane();
    const err = await screen.findByTestId('pending-error');
    expect(err.textContent).toContain('宿主能力缺失');
    expect(screen.queryByTestId('pending-count')).toBeNull();
    const pane = document.querySelector('.taskpane') as HTMLElement;
    expect(within(pane).getByRole('button', { name: '刷新' })).toBeInTheDocument();
  });
});

describe('S6 底部五标签：只渲染真实数据，不可用就给原因', () => {
  const RUN = {
    requestId: 'req_sched_1',
    taskKey: 'decay',
    label: '记忆衰减（遗忘曲线推进）',
    trigger: 'cron',
    status: 'ok',
    startedAt: 1_790_000_000_000,
    durationMs: 42,
    nextDueAt: 1_790_030_000_000,
    error: null,
  };

  function badge(container: HTMLElement, label: string): string | null {
    const tab = Array.from(container.querySelectorAll('.bp-tab')).find((b) => (b.textContent ?? '').includes(label));
    return tab?.querySelector('.bn')?.textContent ?? null;
  }

  /** 底部标签栏里的同名按钮（避免与 Ribbon 的「查看审计」等按钮撞名） */
  function tabButton(container: HTMLElement, label: string): HTMLButtonElement {
    const el = Array.from(container.querySelectorAll('.bp-head .bp-tab'))
      .find((b) => (b.textContent ?? '').includes(label));
    if (!el) throw new Error(`找不到底部标签：${label}`);
    return el as HTMLButtonElement;
  }

  it('输出：浏览器模式如实不可用，且不显示任何角标数字', async () => {
    const { container } = await renderShell();
    const note = await screen.findByTestId('dock-log-unavailable');
    expect(note.textContent).toContain('浏览器模式');
    expect(container.querySelectorAll('.bp-tab .bn')).toHaveLength(0);
  });

  it('输出：真实尾读行按原样展示，问题标签只派生 warn/error 并带真实计数', async () => {
    vi.mocked(loadOutputLog).mockResolvedValue({
      status: 'ok',
      view: {
        path: 'C:\\Users\\x\\actions.log',
        scanLines: 3,
        capturedAt: 1_790_000_100_000,
        lines: [
          { raw: 'a', ts: '2026-11-08T01:00:00.000Z', level: 'info', scope: 'kernel', action: 'server:start', message: '已监听 8201' },
          { raw: 'b', ts: '2026-11-08T01:00:01.000Z', level: 'warn', scope: 'sched', action: 'tick-slow', message: 'tick 超过 100ms' },
          { raw: 'c', ts: '2026-11-08T01:00:02.000Z', level: 'error', scope: 'sync', action: 'pull:fail', message: '后端不可达' },
        ],
      },
    });
    const { container } = await renderShell();
    const rows = await screen.findAllByTestId('dock-log-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByText(/tick 超过 100ms/)).toBeInTheDocument();
    expect(screen.getByText(/C:\\Users\\x\\actions.log/)).toBeInTheDocument();
    expect(badge(container, '输出')).toBe('3');
    // 问题标签 = 同一真实日志里的 warn/error（2 条），不是演示聚合
    await act(async () => { fireEvent.click(tabButton(container, '问题')); });
    expect((await screen.findAllByTestId('dock-problem-row')).length).toBe(2);
    expect(badge(container, '问题')).toBe('2');
    expect(screen.getByText(/由最近的动作日志派生（不是独立问题库）/)).toBeInTheDocument();
  });

  it('问题：真实日志没有 warn/error → 明确说没有，而不是不可用', async () => {
    vi.mocked(loadOutputLog).mockResolvedValue({
      status: 'ok',
      view: { path: null, scanLines: 2, capturedAt: 1, lines: [
        { raw: 'a', ts: null, level: 'info', scope: 'k', action: 'a', message: 'ok' },
      ] },
    });
    const { container } = await renderShell();
    await screen.findByTestId('dock-log-row');
    await act(async () => { fireEvent.click(tabButton(container, '问题')); });
    expect(await screen.findByTestId('dock-problems-empty')).toBeInTheDocument();
    expect(badge(container, '问题')).toBe('0');
  });

  it('任务：真实 schedule_run 记录展示任务名/触发/耗时/下次到期', async () => {
    vi.mocked(loadScheduleRuns).mockResolvedValue({ status: 'ok', view: [RUN] });
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '任务')); });
    const row = await screen.findByTestId('dock-task-row');
    expect(row.textContent).toContain('记忆衰减（遗忘曲线推进）');
    expect(row.textContent).toContain('触发 cron');
    expect(row.textContent).toContain('耗时 42 ms');
    expect(row.textContent).toContain('下次到期');
    expect(badge(container, '任务')).toBe('1');
  });

  it('任务：真实空集 → 说明是空集，不补演示任务也不显示 0 冒充未接入', async () => {
    vi.mocked(loadScheduleRuns).mockResolvedValue({ status: 'ok', view: [] });
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '任务')); });
    expect(await screen.findByTestId('dock-tasks-empty')).toBeInTheDocument();
    expect(badge(container, '任务')).toBe('0');
  });

  it('任务：浏览器未登录 → 不可用原因，不查询、不显示 0', async () => {
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '任务')); });
    const note = await screen.findByTestId('dock-tasks-unavailable');
    expect(note.textContent).toContain('读不到主进程的调度运行记录');
    expect(badge(container, '任务')).toBeNull();
  });

  it('审计：未选中对象不查询也不显示计数', async () => {
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '审计')); });
    expect(await screen.findByTestId('dock-audit-no-selection')).toBeInTheDocument();
    expect(loadAuditForMemory).not.toHaveBeenCalled();
    expect(badge(container, '审计')).toBeNull();
  });

  it('审计：选中真实对象后按 ID 过滤真实审计行', async () => {
    const PAYLOAD = {
      v: 1 as const,
      page: 'memory.html',
      title: '记忆 mem_1',
      subtitle: '真实账本记录',
      fields: [{ k: 'ID', v: 'mem_1', mono: true }],
    };
    vi.mocked(loadAuditForMemory).mockResolvedValue({
      status: 'ok',
      view: [{ requestId: 'req_audit_1', action: 'memory_op', ts: 1_790_000_000_000, summary: '{"mem_id":"mem_1","op":"pin"}' }],
    });
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /记忆列表/ })); });
    const frame = container.querySelector('.page-pane.active iframe.page-frame') as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { [SELECTION_MSG]: PAYLOAD },
        origin: window.location.origin,
        source: frame.contentWindow,
      }));
    });
    await act(async () => { fireEvent.click(tabButton(container, '审计')); });
    const row = await screen.findByTestId('dock-audit-row');
    expect(row.textContent).toContain('memory_op');
    expect(row.textContent).toContain('"op":"pin"');
    expect(loadAuditForMemory).toHaveBeenCalledWith('mem_1');
    expect(badge(container, '审计')).toBe('1');
    expect(screen.getByTestId('sb-selected').textContent).toContain('1 条');
  });

  it('终端仍为不可用（程序确实没有命令通道）', async () => {
    const { container } = await renderShell();
    await act(async () => { fireEvent.click(tabButton(container, '终端')); });
    expect(await screen.findByTestId('dock-term-unavailable')).toBeInTheDocument();
    expect(screen.getByText(/程序未提供终端命令通道/)).toBeInTheDocument();
  });
});

describe('S7 分层 L1–L6 / L0 面板：只在分层页出现，数字全部来自真实 browse', () => {
  it('打开分层页才出现分层条；失败层显示读取失败而不是 0', async () => {
    await renderShell();
    expect(screen.queryByTestId('layer-strip')).toBeNull();
    fireEvent.click(screen.getByText('分层 L1–L6'));
    const strip = await screen.findByTestId('layer-strip');
    await waitFor(() => expect(strip.textContent).toContain('账本 7 条'));
    expect(strip.textContent).toContain('L6 1');
    expect(strip.textContent).toContain('L4 0');
    expect(strip.textContent).toContain('L3 读取失败');
    expect(screen.getByTestId('layer-strip-l0').textContent).toContain('已锁定');
    expect(loadLayerPanel).toHaveBeenCalledTimes(1);
  });

  it('分层读取失败 → 给原因，不渲染任何数字', async () => {
    vi.mocked(loadLayerPanel).mockResolvedValue({ status: 'error', detail: '账本读取失败：E_LEDGER_LOCKED' });
    await renderShell();
    fireEvent.click(screen.getByText('分层 L1–L6'));
    expect((await screen.findByTestId('layer-strip-error')).textContent).toContain('E_LEDGER_LOCKED');
    expect(screen.queryByText(/账本 7 条/)).toBeNull();
  });
});
