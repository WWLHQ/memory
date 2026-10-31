// 批次16：三路真扫合并 + 自动写 MCP 的单元测试（mock window.api，不触真机）
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  autoWireMcpForAgents, mcpSpecForAgent, scanLocalAgents,
} from '../autoDiscovery.ts';
import { MCP_ENDPOINT } from '../../../agentOnboard/mcpClients.ts';
import type { InstalledAgent } from '../../../types/agentOnboard.ts';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

function setApi(api: unknown) {
  w.__ELECTRON__ = true;
  w.api = api;
}

function installRow(agent: string, via: InstalledAgent['via'], source: string, version?: string): InstalledAgent {
  return {
    agent, via, source, ...(version ? { version } : {}),
    badge: agent === 'deepseek harness' ? 'p0' : 'p1',
    label: agent === 'deepseek harness' ? 'MVP·P0' : 'MVP·P1',
  };
}

afterEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
});

describe('scanLocalAgents（三路真实扫描合并）', () => {
  it('安装痕迹 + 进程命中同一 Agent → 去重并保留两路证据；MCP 配置状态原样带出', async () => {
    const found = [
      { name: 'Claude Code', badge: 'p1' as const, label: 'MVP·P1', source: 'claude.exe', signal: 'proc' as const },
    ];
    setApi({
      hostScan: {
        run: () => Promise.resolve({ found, evidence: {}, platform: 'win32', ok: true, scannedAt: Date.now() }),
      },
      hostAgentDetect: {
        run: () => Promise.resolve({
          found: [
            installRow('deepseek harness', 'cli', 'where deepseek-harness → C:\\bin\\deepseek-harness.exe', '0.9.1'),
            installRow('Claude Code', 'config', '~/.claude.json'),
          ],
          probes: { cli: 'ok', config: 'ok' },
          err: null,
        }),
      },
      mcpClients: {
        list: () => Promise.resolve({
          endpoint: MCP_ENDPOINT,
          clients: [{ id: 'claude-code', name: 'Claude Code', state: 'wired', writable: true, format: 'json', installed: true }],
        }),
      },
    });
    const s = await scanLocalAgents();
    expect(s.ok).toBe(true);
    expect(s.capability).toBe('native');
    expect(s.source).toBe('host');
    expect(s.discovered.map((d) => d.name)).toEqual(['deepseek harness', 'Claude Code']); // p0 在前
    expect(s.discovered[0].signal).toContain('安装痕迹（cli）');
    expect(s.discovered[1].signal).toContain('安装痕迹（config）');
    expect(s.discovered[1].signal).toContain('proc · claude.exe'); // 两路证据都保留，不覆盖
    expect(s.mcpClients[0]).toMatchObject({ id: 'claude-code', state: 'wired' });
    expect(s.installedProbes).toMatchObject({ cli: 'ok' });
    expect(s.errors).toEqual([]);
  });

  it('一路失败不影响其它路：成功路照常合并，失败路错误如实保留', async () => {
    setApi({
      hostScan: {
        run: () => Promise.resolve({
          found: [{ name: 'Codex', badge: 'p2' as const, label: '兜底·P2', source: 'codex.exe', signal: 'proc' as const }],
          evidence: {}, platform: 'win32', ok: true, scannedAt: Date.now(),
        }),
      },
      hostAgentDetect: { run: () => Promise.resolve({ found: [], probes: {}, err: null }) },
      // 缺 mcpClients → 该路抛「宿主能力缺失」，不得当成「没有 MCP 客户端」
    });
    const s = await scanLocalAgents();
    expect(s.ok).toBe(true);
    expect(s.discovered.map((d) => d.name)).toEqual(['Codex']);
    expect(s.mcpClients).toEqual([]);
    expect(s.errors.some((e) => e.includes('MCP 客户端配置扫描失败'))).toBe(true);
  });

  it('纯浏览器（无宿主能力）→ ok=false + 真实原因，绝不返回空列表冒充「未安装」', async () => {
    delete w.api;
    const s = await scanLocalAgents();
    expect(s.ok).toBe(false);
    expect(s.capability).toBe('none');
    expect(s.source).toBe('browser');
    expect(s.errors[0]).toContain('非桌面壳环境');
    expect(s.discovered).toEqual([]);
  });
});

describe('autoWireMcpForAgents（连通后自动写 MCP）', () => {
  const scan = {
    capability: 'native' as const,
    endpoint: MCP_ENDPOINT,
    mcpClients: [
      { id: 'claude-code', name: 'Claude Code', state: 'missing_entry' as const, writable: true, format: 'json', installed: true },
    ],
  };

  it('管理员 + 可写 JSON 客户端 → 真实调用 mcp:clientWire（带会话），记录新增', async () => {
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: true }));
    setApi({ mcpClients: { wire } });
    const s = await autoWireMcpForAgents(['Claude Code'], scan, { sid: 'sid_admin', role: 'admin' });
    expect(wire).toHaveBeenCalledWith('claude-code', 'sid_admin');
    expect(s.wired).toEqual(['Claude Code']);
    expect(s.changed).toEqual(['Claude Code']);
    expect(s.failed).toEqual([]);
  });

  it('非管理员 → 记为失败（需管理员），不调用写入', async () => {
    const wire = vi.fn();
    setApi({ mcpClients: { wire } });
    const s = await autoWireMcpForAgents(['Claude Code'], scan, { sid: 'sid_member', role: 'member' });
    expect(wire).not.toHaveBeenCalled();
    expect(s.failed[0]).toMatchObject({ client: 'Claude Code' });
    expect(s.failed[0].reason).toContain('需管理员');
  });

  it('无登录会话 → 如实失败，不冒充已接入', async () => {
    const wire = vi.fn();
    setApi({ mcpClients: { wire } });
    const s = await autoWireMcpForAgents(['Claude Code'], scan, { sid: null, role: null });
    expect(wire).not.toHaveBeenCalled();
    expect(s.failed[0].reason).toContain('无登录会话');
  });

  it('冲突配置拒绝覆盖 / 已 wired 直接计入 / TOML 客户端自动写入 / 无稳定配置转手工', async () => {
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: true }));
    setApi({ mcpClients: { wire } });
    const s = await autoWireMcpForAgents(
      ['Claude Code', 'Cursor', 'Codex', 'WorkBuddy'],
      {
        capability: 'native',
        endpoint: MCP_ENDPOINT,
        mcpClients: [
          { id: 'claude-code', name: 'Claude Code', state: 'conflict', writable: true, format: 'json', installed: true, foundUrl: 'http://other:1234/mcp' },
          { id: 'cursor', name: 'Cursor', state: 'wired', writable: true, format: 'json', installed: true },
          { id: 'codex', name: 'Codex', state: 'missing_entry', writable: true, format: 'toml', installed: true },
        ],
      },
      { sid: 'sid_admin', role: 'admin' },
    );
    expect(wire).toHaveBeenCalledTimes(1);
    expect(wire).toHaveBeenCalledWith('codex', 'sid_admin');
    expect(s.failed[0]).toMatchObject({ client: 'Claude Code' });
    expect(s.failed[0].reason).toContain('拒绝覆盖');
    expect(s.wired).toEqual(['Cursor', 'Codex']);
    expect(s.changed).toEqual(['Codex']);
    expect(s.manual).toEqual(['WorkBuddy']); // 无稳定配置文件，只给人手指引
  });

  it('未收录 MCP 配方的 Agent（如 WorkBuddy 之外的未知名）不计数，不伪造摘要', async () => {
    const s = await autoWireMcpForAgents(['SomeUnknownAgent'], scan, { sid: 'sid', role: 'admin' });
    expect(s).toEqual({ endpoint: MCP_ENDPOINT, wired: [], changed: [], manual: [], failed: [] });
  });

  it('mcpSpecForAgent 名称大小写不敏感', () => {
    expect(mcpSpecForAgent('claude code')?.id).toBe('claude-code');
    expect(mcpSpecForAgent('Nope')).toBeUndefined();
  });
});
