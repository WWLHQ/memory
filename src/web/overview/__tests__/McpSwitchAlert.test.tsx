// T3 落点① · 首页客户端 MCP 开关提示条（对齐 design/ui/客户端MCP开关状态_原型.html ①）。
// 重点：一键成功后只显示待生效；服务端离线不提供一键打开；正常态不渲染。
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSwitchAlert } from '../McpSwitchAlert.tsx';
import { deriveMcpSwitch } from '../../shared/mcpSwitch.ts';

const base = { healthOk: true, mcpOk: true, clients: [] as Array<{ id: string; name?: string; disabled?: boolean }> };
const handlers = () => ({
  onEnable: vi.fn(), onManual: vi.fn(), onLaunch: vi.fn(), onReload: vi.fn(),
});

const stateOf = (over: Partial<Parameters<typeof deriveMcpSwitch>[0]> = {}) =>
  deriveMcpSwitch({ ...base, ...over });

describe('T3 · 首页 MCP 开关提示条', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正常态不渲染任何提示条', () => {
    const { container } = render(<McpSwitchAlert state={stateOf()} {...handlers()} />);
    expect(container.firstChild).toBeNull();
  });

  it('已关闭 → 红条 + 一键打开 + 去设置手动打开，点击分别触发回调', async () => {
    const h = handlers();
    render(<McpSwitchAlert state={stateOf({ clients: [{ id: 'workbuddy', name: 'WorkBuddy', disabled: true }] })} {...h} />);
    expect(screen.getByTestId('home-mcp-switch-alert').className).toContain('bad');
    expect(screen.getByText('WorkBuddy 的 MCP 开关已关闭')).toBeTruthy();
    await userEvent.click(screen.getByTestId('mcp-switch-enable'));
    await userEvent.click(screen.getByTestId('mcp-switch-manual'));
    expect(h.onEnable).toHaveBeenCalledTimes(1);
    expect(h.onManual).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/清除禁用标记后需重新打开软件/)).toBeTruthy();
  });

  it('待生效 → 不显示一键打开，只给手动打开与「不冒充已连接」脚注', () => {
    render(<McpSwitchAlert state={stateOf({ pending: true })} {...handlers()} />);
    expect(screen.getByTestId('home-mcp-switch-alert').className).toContain('warn');
    expect(screen.getByText('已清除禁用标记，待生效')).toBeTruthy();
    expect(screen.queryByTestId('mcp-switch-enable')).toBeNull();
    expect(screen.getByTestId('mcp-switch-manual')).toBeTruthy();
    expect(screen.getByText(/不冒充已连接/)).toBeTruthy();
  });

  it('服务端未启动 → 不提供一键打开，只给去启动桌面端', () => {
    render(<McpSwitchAlert state={stateOf({ healthOk: false })} {...handlers()} />);
    expect(screen.getByText('记忆服务端未启动')).toBeTruthy();
    expect(screen.queryByTestId('mcp-switch-enable')).toBeNull();
    expect(screen.getByTestId('mcp-switch-launch')).toBeTruthy();
    expect(screen.getByText(/不是客户端开关问题/)).toBeTruthy();
  });

  it('读不到配置 → 未知 + 重读，不冒充已连接', () => {
    render(<McpSwitchAlert state={stateOf({ mcpOk: false })} {...handlers()} />);
    expect(screen.getByText('客户端 MCP 开关状态未知')).toBeTruthy();
    expect(screen.getByTestId('mcp-switch-reload')).toBeTruthy();
    expect(screen.getByText(/不能据此判断/)).toBeTruthy();
  });

  it('一键失败如实显示原因，不假装成功', () => {
    render(<McpSwitchAlert state={stateOf({ clients: [{ id: 'workbuddy', name: 'WorkBuddy', disabled: true }] })}
      error="需管理员" {...handlers()} />);
    expect(screen.getByTestId('mcp-switch-error').textContent).toContain('需管理员');
  });

  // 用户 2026-11-15 实机反馈：点「去设置手动打开」后提示看不见（排在脚注后的小灰字）。
  // 锁死两点：① 提示必须是醒目块（af-alert warn，不是 af-note 小灰字）；
  //          ② 提示紧贴按钮所在提示条下方，排在脚注之前。
  it('手动打开提示是醒目块，且紧贴按钮下方（在脚注之前）', () => {
    render(<McpSwitchAlert state={stateOf({ pending: true })} hint="请在设置中打开开关" {...handlers()} />);
    const hint = screen.getByTestId('mcp-switch-hint');
    expect(hint.className).toContain('af-alert');
    expect(hint.className).toContain('warn');
    expect(hint.className).not.toContain('af-note');
    expect(hint.textContent).toContain('手动打开位置');
    // 顺序：提示条 → 提示块 → 脚注
    const alert = screen.getByTestId('home-mcp-switch-alert');
    const footnote = screen.getByText(/不冒充已连接/);
    expect(alert.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
