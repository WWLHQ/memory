// T3 · 客户端 MCP 开关状态派生（三处 UI 的单一真源）。
// 重点：优先级、不冒充已连接、一键打开只在「服务端在线 + 确读到已禁用」时可用。
import { describe, expect, it } from 'vitest';
import {
  deriveMcpSwitch, MCP_SWITCH_LABEL, MCP_SWITCH_POLL_MS,
  MCP_MANUAL_HINT, MCP_LAUNCH_HINT,
} from '../mcpSwitch.ts';
import { SHELL_STATUS_POLL_MS } from '../../shell/shellStatus.ts';

const base = { healthOk: true, mcpOk: true, clients: [] as Array<{ id: string; name?: string; disabled?: boolean }> };

describe('T3 · deriveMcpSwitch（状态派生）', () => {
  it('服务端在线 + 确读到已禁用 → off，可一键并给出目标客户端', () => {
    const s = deriveMcpSwitch({ ...base, clients: [{ id: 'workbuddy', disabled: true }, { id: 'qoder-cn' }] });
    expect(s.view).toBe('off');
    expect(s.canEnable).toBe(true);
    expect(s.enableId).toBe('workbuddy');
    expect(s.title).toContain('开关已关闭');
    expect(s.footnote).toContain('重新打开软件');
  });

  it('标题点名「真被禁用」的客户端，绝不写死成 WorkBuddy（错标修复）', () => {
    const s = deriveMcpSwitch({
      ...base,
      clients: [{ id: 'trae-cn', name: 'Trae Code CN', disabled: true }, { id: 'workbuddy', name: 'WorkBuddy' }],
    });
    expect(s.view).toBe('off');
    expect(s.enableId).toBe('trae-cn');
    expect(s.title).toBe('Trae Code CN 的 MCP 开关已关闭');
    expect(s.title).not.toContain('WorkBuddy');
  });

  it('禁用客户端缺名字时退回泛称（不冒充具体某一家）', () => {
    const s = deriveMcpSwitch({ ...base, clients: [{ id: 'trae-cn', disabled: true }] });
    expect(s.view).toBe('off');
    expect(s.title).toBe('客户端 MCP 开关已关闭');
  });

  it('① 共享待生效信号：配置已清（无 disabled）但 pendingIds 非空 → 待生效并点名客户端', () => {
    const s = deriveMcpSwitch({
      ...base,
      clients: [{ id: 'trae-cn', name: 'Trae Code CN' }], // 已被一键清掉 disabled
      pendingIds: ['trae-cn'],
    });
    expect(s.view).toBe('pending');
    expect(s.canEnable).toBe(false);
    expect(s.title).toBe('Trae Code CN 已清除禁用标记，待生效');
  });

  it('① pendingIds 为空且无禁用 → 正常（不无端挂待生效）', () => {
    const s = deriveMcpSwitch({ ...base, clients: [{ id: 'trae-cn', name: 'Trae Code CN' }], pendingIds: [] });
    expect(s.view).toBe('ok');
  });

  it('正常 → ok，不产生提示条文案，也不能一键', () => {
    const s = deriveMcpSwitch({ ...base, clients: [{ id: 'workbuddy' }] });
    expect(s.view).toBe('ok');
    expect(s.label).toBe('已接入');
    expect(s.title).toBe('');
    expect(s.canEnable).toBe(false);
    expect(s.enableId).toBeNull();
  });

  it('服务端离线优先于一切，且不提供一键打开', () => {
    const s = deriveMcpSwitch({ ...base, healthOk: false, clients: [{ id: 'workbuddy', disabled: true }] });
    expect(s.view).toBe('down');
    expect(s.canEnable).toBe(false);
    expect(s.title).toContain('记忆服务端未启动');
    expect(s.detail).toContain('不是客户端开关问题');
  });

  it('客户端配置读不到 → unknown，不冒充已连接', () => {
    const s = deriveMcpSwitch({ ...base, mcpOk: false });
    expect(s.view).toBe('unknown');
    expect(s.label).toBe('未知');
    expect(s.canEnable).toBe(false);
    expect(s.detail).toContain('不能据此判断');
  });

  it('一键后待生效优先于已禁用/正常，状态不跳绿', () => {
    const s = deriveMcpSwitch({ ...base, pending: true, clients: [{ id: 'workbuddy', disabled: true }] });
    expect(s.view).toBe('pending');
    expect(s.label).toBe('待生效');
    expect(s.canEnable).toBe(false);
    expect(s.detail).toContain('原配置已备份');
    const afterRefresh = deriveMcpSwitch({ ...base, pending: true, clients: [] });
    expect(afterRefresh.view).toBe('pending');
  });

  it('非布尔 true 不算禁用标记（字符串/数字不猜）', () => {
    const weird = [{ id: 'workbuddy', disabled: 'true' as unknown as boolean }];
    expect(deriveMcpSwitch({ ...base, clients: weird }).view).toBe('ok');
    const numeric = [{ id: 'workbuddy', disabled: 1 as unknown as boolean }];
    expect(deriveMcpSwitch({ ...base, clients: numeric }).view).toBe('ok');
  });

  it('优先级：离线 > 读不到 > 待生效 > 已禁用', () => {
    const all = { clients: [{ id: 'workbuddy', disabled: true }], pending: true };
    expect(deriveMcpSwitch({ ...base, ...all, healthOk: false, mcpOk: false }).view).toBe('down');
    expect(deriveMcpSwitch({ ...base, ...all, mcpOk: false }).view).toBe('unknown');
    expect(deriveMcpSwitch({ ...base, ...all }).view).toBe('pending');
    expect(deriveMcpSwitch({ ...base, clients: all.clients }).view).toBe('off');
  });
});

describe('T3 · 文案与轮询口径', () => {
  it('所有状态文案只说人话：不含字段名 / 英文枚举 / 原始配置痕迹', () => {
    const views = ['off', 'ok', 'down', 'pending', 'unknown'] as const;
    for (const v of views) {
      const s = deriveMcpSwitch({
        ...base,
        healthOk: v !== 'down', mcpOk: v !== 'unknown', pending: v === 'pending',
        clients: v === 'off' ? [{ id: 'workbuddy', disabled: true }] : [],
      });
      const text = `${s.title}${s.detail}${s.footnote}${s.label}`;
      expect(text).not.toMatch(/disabled|wired|payload|JSON\.stringify|mcpServers|ECONNREFUSED/);
      expect(MCP_SWITCH_LABEL[s.view]).toBeTruthy();
    }
  });

  it('手动打开与启动桌面端的提示都给了明确出路', () => {
    expect(MCP_MANUAL_HINT).toContain('MCP 服务管理');
    expect(MCP_MANUAL_HINT).toContain('重新打开软件');
    expect(MCP_LAUNCH_HINT).toContain('桌面端');
  });

  it('轮询与壳层状态卡同口径（12 秒）', () => {
    expect(MCP_SWITCH_POLL_MS).toBe(12_000);
    expect(MCP_SWITCH_POLL_MS).toBe(SHELL_STATUS_POLL_MS);
  });
});
