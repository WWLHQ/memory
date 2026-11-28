// 批次58：完整端点串常驻命令条右端（用户 2026-11-21 图2）。
//
// 正向用例（闸门 B）：
// 1. endpoint online → 完整串（● 在线 · HTTP 200 · 已登录 · home/onboard/mcp/webhook 四端口）
//    + online pill（绿）+ dot ok，且不再出现「系统在线」旧文案；
// 2. endpoint offline → 红 pill、dot err、HTTP 503、title 带真实原因；
// 3. 未知（未传 endpoint）→ 灰 pill：不冒充在线，仍显示完整串；
// 4. 进行中/需关注条目同条展示（warn 条目 shell-status-item.warn），端点串仍在。
// 反向断言（A）：Workspace.tsx 不再把 ShellStatusCard 挂在侧栏（StrataScale 之前），改挂在 cmdbar 内。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { ShellStatusCard, type EndpointBrief } from '../ShellStatusCard.tsx';
import type { ShellStatusSnapshot } from '../shellStatus.ts';
import type { CollectorView } from '../statusbar.ts';
import { HOME_BASE, ONBOARD_BASE } from '../../backend.ts';

vi.mock('../shellStatus.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../shellStatus.ts')>();
  return {
    ...mod,
    loadShellStatus: vi.fn(),
  };
});
vi.mock('../mcpSwitch.ts', () => ({
  MCP_MANUAL_HINT: '设置页 → Agent 接入 → 客户端 MCP 开关',
  requestEnableMcpSwitch: vi.fn(),
}));
vi.mock('../../shared/navStatusChannel.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../shared/navStatusChannel.ts')>();
  return {
    ...mod,
    publishNavStatus: vi.fn(),
  };
});

import { loadShellStatus } from '../shellStatus.ts';

const collectorOk = (running: boolean): { status: 'ok'; view: CollectorView } => ({
  status: 'ok',
  view: { running, intervalMs: null, lastAt: null, lastCollected: null, autoRetryStopped: false, consecutiveFails: null },
});

function snap(partial: Partial<ShellStatusSnapshot>): ShellStatusSnapshot {
  return {
    pendingWrites: { status: 'ok', view: 0 },
    refine: { status: 'ok', view: { pending: 0, failed: 0, enabled: false } },
    collector: collectorOk(false),
    mcpSwitch: { status: 'ok', view: { id: '', name: '', disabled: false, conflict: 0, invalid: 0 } },
    webIssue: { status: 'ok', view: { needRelogin: 0, failed: 0 } },
    ...partial,
  };
}

const online: EndpointBrief = { tone: 'online', detail: 'HTTP 200', session: '已登录' };

/** 完整串四端口：home / onboard 取自 backend.ts 单一真源，mcp / webhook 为固定端口 */
function expectFullEndpointText(pill: HTMLElement): void {
  const text = pill.textContent ?? '';
  expect(text).toContain('在线');
  expect(text).toContain('HTTP 200');
  expect(text).toContain('已登录');
  expect(text).toContain(`home :${new URL(HOME_BASE).port}`);
  expect(text).toContain(`onboard :${new URL(ONBOARD_BASE).port}`);
  expect(text).toContain('mcp :8202/:8204');
  expect(text).toContain('webhook :8203');
  expect(text).not.toContain('系统在线');
  expect(pill.querySelector('.dot')).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('批次58 ShellStatusCard：命令条右端常驻完整端点串', () => {
  it('online → 完整串可见（● 圆点 + HTTP 200 + 已登录 + 四端口），绿 pill，不再出现「系统在线」', async () => {
    vi.mocked(loadShellStatus).mockResolvedValue(snap({}));
    render(<ShellStatusCard endpoint={online} />);
    const pill = await screen.findByTestId('shell-status-net');
    expect(pill.className).toContain('online');
    expect(pill.className).not.toContain('offline');
    expectFullEndpointText(pill);
    expect(pill.getAttribute('data-health')).toBe('online');
    const dot = pill.querySelector('.dot');
    expect(dot?.className).toContain('ok');
    expect(dot?.className).not.toContain('err');
    cleanup();
  });

  it('offline → 红 pill（dot err）、HTTP 503、title 带真实原因，四端口不省略', async () => {
    vi.mocked(loadShellStatus).mockResolvedValue(snap({}));
    render(<ShellStatusCard endpoint={{ tone: 'offline', detail: 'HTTP 503', session: '未登录' }} />);
    const pill = await screen.findByTestId('shell-status-net');
    expect(pill.className).toContain('offline');
    expect(pill.className).not.toContain('online');
    expect(pill.textContent).toContain('离线');
    expect(pill.textContent).toContain('HTTP 503');
    expect(pill.textContent).toContain(`home :${new URL(HOME_BASE).port}`);
    expect(pill.textContent).toContain('webhook :8203');
    expect(pill.getAttribute('title')).toContain('HTTP 503');
    expect(pill.getAttribute('title')).toContain('未登录');
    const dot = pill.querySelector('.dot');
    expect(dot?.className).toContain('err');
    cleanup();
  });

  it('未传 endpoint → 灰「未知」：不冒充在线，仍显示完整串', async () => {
    vi.mocked(loadShellStatus).mockResolvedValue(snap({}));
    render(<ShellStatusCard />);
    const pill = await screen.findByTestId('shell-status-net');
    expect(pill.className).toContain('unknown');
    expect(pill.textContent).toContain('未知');
    expect(pill.textContent).toContain('健康检查未读取');
    expect(pill.textContent).toContain('webhook :8203');
    expect(pill.getAttribute('data-health')).toBe('unknown');
    expect(pill.querySelector('.dot')?.className).toContain('neutral');
    cleanup();
  });

  it('warn 条目同条展示（warn-soft 红字条目 + warn dot err），在线端点串仍在', async () => {
    vi.mocked(loadShellStatus).mockResolvedValue(snap({
      collector: collectorOk(false) && {
        status: 'ok' as const,
        view: { running: false, intervalMs: 60_000, lastAt: null, lastCollected: null, autoRetryStopped: false, consecutiveFails: 5 },
      },
    }));
    render(<ShellStatusCard endpoint={online} />);
    const item = await screen.findByTestId('shell-status-collector');
    expect(item.className).toContain('warn');
    expect(item.querySelector('.dot')?.className).toContain('err');
    expect(item.textContent).toContain('采集连续失败 5 轮');
    const pill = screen.getByTestId('shell-status-net');
    expect(pill.className).toContain('online');
    cleanup();
  });

  it('反向断言（影响面 A）：Workspace.tsx 侧栏不再挂 ShellStatusCard，改挂在 cmdbar 内并传真实 endpoint', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'src', 'web', 'shell', 'Workspace.tsx'), 'utf8');
    // 侧栏（StrataScale 之前）不得再有挂载点
    const navIdx = src.indexOf('<StrataScale');
    const mountIdx = src.indexOf('<ShellStatusCard');
    expect(mountIdx).toBeGreaterThan(-1);
    expect(src.slice(0, navIdx)).not.toContain('<ShellStatusCard');
    // 挂载点在 cmdbar 容器内（cmdbar div 起点之后）
    const cmdbarIdx = src.lastIndexOf('className="cmdbar"', mountIdx);
    expect(cmdbarIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(cmdbarIdx);
    // 端点串数据来自壳层真实 loadOverview 的健康 + 会话，而不是写死
    expect(src).toContain('<ShellStatusCard endpoint={{ tone: healthTone, detail: healthDetail, session: sessionWord }}');
  });
});
