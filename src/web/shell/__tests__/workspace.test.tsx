// 壳层渲染行为（批次48 S1）：导航、不可用态、状态栏诚实口径、底部标签。
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { Workspace } from '../Workspace.tsx';
import { loadPendingWrites } from '../taskpane.ts';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadPendingWrites).mockReset();
  vi.mocked(loadPendingWrites).mockResolvedValue({
    status: 'unavailable',
    detail: '浏览器模式：没有主进程，读不到 MCP 写入兜底队列；请用桌面端查看。',
  });
});

/** 渲染并等待概览异步加载落地（避免 act 警告，也确保断言发生在真实渲染之后） */
async function renderShell() {
  const r = render(<Workspace />);
  await screen.findByText('累计记忆');
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

  it('概览条显示内核真实读数，并给每个字段标注来源', async () => {
    await renderShell();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getAllByText('内核账本·实时').length).toBe(4);
    expect(screen.getByText(/内核 桌面 IPC/)).toBeInTheDocument();
    expect(screen.getByText(/后端 可达/)).toBeInTheDocument();
    // 未登录时成本查询如实不可用，不显示编造余额
    expect(screen.getByText(/成本 不可用/)).toBeInTheDocument();
    expect(screen.getByText(/成本 不可用/).getAttribute('title')).toContain('需登录');
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

  it('状态栏只写未接入，不用「—」冒充真实读数', async () => {
    const { container } = await renderShell();
    const bar = container.querySelector('.statusbar');
    expect(bar?.textContent ?? '').not.toMatch(/—/);
    expect(bar?.textContent ?? '').toContain('未接入');
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
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('button', { name: /归档（需登录）/ }));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory.html');
    expect(src).toContain('status=archived');
    // 归档与「全部记忆」是同一页面不同初值 → 必须是独立标签，不能复用旧标签
    expect(container.querySelector('.tabstrip')?.textContent ?? '').toContain('归档（需登录）');
  });

  it('导航「L0 密文（需解锁）」指向层级页并带 #l0bar 锚点', async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByRole('treeitem', { name: /L0 密文（需解锁）/ }));
    const src = activeFrameSrc(container);
    expect(src).toContain('/memory-layered.html');
    expect(src).toContain('#l0bar');
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
