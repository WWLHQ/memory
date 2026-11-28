// MCP 客户端接入面板单测（批次15）：真实状态渲染 / 管理员门禁 / 一键写入回执 / 浏览器降级
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { McpClientsPanel } from '../McpClientsPanel.tsx';
import { clearStoredSessionId, storeSessionId } from '../../Home/crossTabAuth.ts';

const realFetch = globalThis.fetch;

function baseRow(over: Record<string, unknown>) {
  return {
    format: 'json', writable: true, installed: true, hasAuth: false,
    rulesHint: '工作区 AGENTS.md', ...over,
  };
}

const SCAN = {
  endpoint: 'http://127.0.0.1:8204/mcp',
  scannedAt: Date.UTC(2026, 0, 1, 0, 0, 0), // UTC+08:00 → 08:00:00
  clients: [
    baseRow({
      id: 'qoder-cn', name: 'Qoder CN', badge: 'p3', displayPath: '~/.qoder-cn/settings.json',
      state: 'wired', hasAuth: true,
    }),
    baseRow({
      id: 'claude-code', name: 'Claude Code', badge: 'p1', displayPath: '~/.claude.json',
      state: 'missing_auth', note: '已有同名条目时只补齐 Authorization',
    }),
    baseRow({
      id: 'codex', name: 'Codex', badge: 'p2', displayPath: '~/.codex/config.toml',
      format: 'toml', writable: true, state: 'missing_entry',
    }),
    baseRow({
      id: 'trae-cn', name: 'Trae Code CN', badge: 'p3', displayPath: null, path: null,
      format: 'unknown', writable: false, installed: true, state: 'manual', note: '手工添加',
    }),
    // 未安装：不得显示（用户明确要求 Cursor/Gemini CLI 这类未扫描到的不占位）
    baseRow({
      id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json',
      installed: false, state: 'missing_entry',
    }),
  ],
};

function setHost(opts: {
  list?: () => Promise<unknown>;
  wire?: (id: string, sid: string) => Promise<unknown>;
  snippet?: (id: string, sid: string) => Promise<unknown>;
  enable?: (id: string, sid: string) => Promise<unknown>;
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    mcpClients: {
      list: opts.list ?? (() => Promise.resolve(SCAN)),
      wire: opts.wire ?? (() => Promise.resolve({ ok: true, changed: true, path: 'C:/x/.claude.json', backupPath: 'C:/x/.claude.json.bak' })),
      snippet: opts.snippet ?? (() => Promise.resolve({ ok: true, snippet: '{"mcpServers":{}}' })),
      enable: opts.enable ?? (() => Promise.resolve({ ok: true, changed: true })),
    },
  };
}

function clearHost() {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

function mockRole(role: 'admin' | 'member') {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ context: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', role } }),
  }));
}

beforeEach(() => {
  localStorage.clear();
  storeSessionId('sid_test');
});

afterEach(() => {
  clearHost();
  clearStoredSessionId();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('McpClientsPanel', () => {
  test('T3：客户端开关已关闭 → 红色状态 + 一键打开；成功后保持待生效不跳绿', async () => {
    const enable = vi.fn(() => Promise.resolve({ ok: true, changed: true }));
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: 'http://127.0.0.1:8204/mcp',
        scannedAt: Date.UTC(2026, 0, 1),
        clients: [baseRow({
          id: 'workbuddy', name: 'WorkBuddy', badge: 'p0',
          displayPath: '~/.workbuddy/mcp.json', state: 'wired', hasAuth: true, disabled: true,
        })],
      }),
      enable,
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('客户端已关闭'));
    expect((document.querySelector('[data-client="workbuddy"]') as HTMLElement).dataset.switch).toBe('off');
    await userEvent.click(screen.getByRole('button', { name: '一键打开' }));
    await waitFor(() => expect(enable).toHaveBeenCalledWith('workbuddy', 'sid_test'));
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('已清除标记 · 待生效'));
    expect(screen.queryByRole('button', { name: '一键打开' })).toBeNull();
    expect(screen.getByRole('button', { name: '去设置手动打开' })).toBeTruthy();
  });

  test('待生效：点「去设置手动打开」→ 提示展开在该客户端卡片内（不甩到页面底部）', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [baseRow({ id: 'workbuddy', name: 'WorkBuddy', badge: 'p0', displayPath: '~/.workbuddy/mcp.json', state: 'wired', hasAuth: true, disabled: true })],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('客户端已关闭'));
    await userEvent.click(screen.getByRole('button', { name: '一键打开' }));
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('已清除标记 · 待生效'));
    expect(screen.queryByTestId('manual-hint-workbuddy')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '去设置手动打开' }));
    const hint = screen.getByTestId('manual-hint-workbuddy');
    expect(hint.textContent).toContain('重新打开软件');
    // 用户 2026-11-15 实机反馈「点了像没反应」：提示必须是可见块（af-alert warn），不能是 11px 灰字
    expect(hint.className).toContain('af-alert');
    expect(hint.className).toContain('warn');
    expect(hint.className).not.toContain('method');
    // 批次48 表格化后：提示在该客户端行的紧邻详情行里（按钮旁），不是页面底部的全局消息
    const row = document.querySelector('[data-client="workbuddy"]') as HTMLElement;
    expect(hint.closest('tr')?.previousElementSibling).toBe(row.closest('tr'));
  });

  test('T3：非 JSON 配置不提供一键打开，如实只给状态提示', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: 'http://127.0.0.1:8204/mcp',
        scannedAt: Date.UTC(2026, 0, 1),
        clients: [baseRow({
          id: 'codex', name: 'Codex', badge: 'p2', displayPath: '~/.codex/config.toml',
          format: 'toml', state: 'wired', hasAuth: true, disabled: true,
        })],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-codex').textContent).toBe('客户端已关闭'));
    expect(screen.queryByRole('button', { name: '一键打开' })).toBeNull();
  });

  test('浏览器模式：如实降级为只读说明，不伪造客户端列表或「已接入」', async () => {
    render(<McpClientsPanel />);
    expect(screen.getByTestId('mcp-browser-note')).toBeInTheDocument();
    expect(document.querySelectorAll('#mcp-client-rows tr[data-client]')).toHaveLength(0);
    expect(screen.queryByText('已接入')).toBeNull();
    // 浏览器模式没有宿主能力 → 刷新禁用
    expect((screen.getByRole('button', { name: '刷新状态' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('宿主扫描失败：如实提示状态未知，不把通用说明当作「已接入」', async () => {
    mockRole('admin');
    setHost({ list: () => Promise.reject(new Error('IPC rejected')) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('mcp-scan-error').textContent).toContain('IPC rejected'));
    expect(screen.getByText('扫描失败')).toBeInTheDocument();
    expect(screen.queryByText('已接入')).toBeNull();
    expect(document.querySelectorAll('#mcp-client-rows tr[data-client]')).toHaveLength(0);
  });

  test('只显示本机真实检出的客户端（未安装的 Cursor 不占位）', async () => {
    mockRole('admin');
    setHost({ list: () => Promise.resolve(SCAN) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    expect(document.querySelectorAll('#mcp-client-rows tr[data-client]')).toHaveLength(4);
    expect(document.querySelector('[data-client="cursor"]')).toBeNull();
    expect(screen.queryByText('Cursor')).toBeNull();
  });

  test('仅残留目录的客户端不进已安装清单，单列为「仅发现残留目录」', async () => {
    mockRole('admin');
    const scan = {
      ...SCAN,
      clients: [
        ...SCAN.clients.slice(0, 1),
        baseRow({
          id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json',
          installed: true, installEvidence: 'marker', state: 'missing_entry',
        }),
      ],
    };
    setHost({ list: () => Promise.resolve(scan) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    expect(document.querySelectorAll('#mcp-client-rows tr[data-client]')).toHaveLength(1);
    expect(document.querySelector('[data-client="cursor"]')).toBeNull();
    const trace = screen.getByTestId('mcp-trace-only');
    expect(trace.textContent).toContain('Cursor');
    expect(trace.textContent).toContain('不计入上面「已安装」清单');
  });

  test('Zcode 身份头写错 → 显式「不符：xxx」并可补写；YAML 行用等宽徽标补位，不留空槽', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [
          // Zcode：有稳定配置文件、已接入，但身份头被写成了 deepseek-harness
          baseRow({
            id: 'zcode', name: 'Zcode', badge: 'p3', displayPath: '~/.zcode/mcp.json',
            state: 'wired', hasAuth: true, hasClientId: false, foundClientId: 'deepseek-harness',
            transport: 'http',
          }),
          // deepseek harness：插件式 YAML 配置，不支持本服务改写免令牌形态
          baseRow({
            id: 'deepseek-harness', name: 'deepseek harness', badge: 'p0',
            displayPath: '~/.dsh/profiles/desktop/cordis.patch.yml',
            format: 'yaml', writable: true, state: 'wired', hasAuth: true, hasClientId: true,
            transport: 'http',
          }),
        ],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-zcode').textContent).toBe('已接入'));

    // 配置路径列不再出现「无稳定配置路径」，而是真实文件
    const zcodeRow = document.querySelector('[data-client="zcode"]')!;
    const dshRow = document.querySelector('[data-client="deepseek-harness"]')!;
    expect(zcodeRow.textContent).toContain('~/.zcode/mcp.json');
    expect(dshRow.textContent).toContain('cordis.patch.yml');
    expect(document.body.textContent).not.toContain('无稳定配置路径');

    // 身份头值不符要显式说出来（不能只显示「缺失」或「—」）
    expect(screen.getByTestId('clientid-wrong-zcode').textContent).toContain('不符：deepseek-harness');
    expect(screen.getByTestId('wire-zcode').textContent).toBe('补身份头');

    // YAML 行没有「改用免令牌方式」，但槽位由等宽徽标补上（动作列不留空）
    expect(screen.queryByTestId('stdio-deepseek-harness')).toBeNull();
    expect(screen.getByTestId('stdio-na-deepseek-harness').textContent).toBe('免令牌不适用');
    // 两行的动作列都有「复制片段」，不是一行有按钮一行空着
    for (const id of ['zcode', 'deepseek-harness']) {
      expect(document.querySelector(`[data-client="${id}"] [data-act="mcp-copy"]`)).toBeTruthy();
    }
  });

  test('检出数与清单同口径：无配置文件路径的痕迹客户端（Zcode / deepseek harness）也是真安装，必须进清单', async () => {
    mockRole('admin');
    const scan = {
      endpoint: SCAN.endpoint,
      scannedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
      clients: [
        ...SCAN.clients.filter((c) => c.installed !== false),
        // 无稳定配置文件（configPath=null）→ 只能是 marker；但客户端确实装了，必须进清单按「需手工」呈现
        baseRow({
          id: 'zcode', name: 'Zcode', badge: 'p3', displayPath: null, path: null,
          writable: false, installEvidence: 'marker', state: 'manual',
        }),
        baseRow({
          id: 'deepseek-harness', name: 'deepseek harness', badge: 'p0', displayPath: null, path: null,
          writable: false, installEvidence: 'marker', state: 'manual',
        }),
        // 本该有配置文件却读不到 → 这才是「仅痕迹 · 可能已卸载」，不进清单
        baseRow({
          id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json',
          installEvidence: 'marker', state: 'missing_entry',
        }),
      ],
    };
    setHost({ list: () => Promise.resolve(scan) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));

    // 清单 6 行（含两个无配置文件路径的），用户说的「本来就有 8 个」不再被吃掉 2 个
    expect(document.querySelectorAll('#mcp-client-rows tr[data-client]')).toHaveLength(6);
    expect(document.querySelector('[data-client="zcode"]')).toBeTruthy();
    expect(document.querySelector('[data-client="deepseek-harness"]')).toBeTruthy();
    // 真·残留目录只出现在弱提示里
    expect(document.querySelector('[data-client="cursor"]')).toBeNull();
    const trace = screen.getByTestId('mcp-trace-only');
    expect(trace.textContent).toContain('Cursor');
    expect(trace.textContent).not.toContain('Zcode');
    expect(trace.textContent).toContain('不计入上面「已安装」清单');

    // 回执数字与清单一致：6，并把 1 个真残留单独交代
    await userEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent)
      .toContain('已重新扫描：检出 6 个已安装客户端'));
    expect(screen.getByTestId('mcp-message').textContent).toContain('另有 1 个仅安装痕迹、配置缺失，不计入清单');
  });

  test('扫描成功但未检出任何客户端 → 诚实空态（不列未安装客户端）', async () => {
    mockRole('admin');
    setHost({ list: () => Promise.resolve({ endpoint: SCAN.endpoint, clients: [] }) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeInTheDocument());
    expect(document.querySelectorAll('#mcp-client-rows tr[data-client]')).toHaveLength(0);
  });

  test('刷新状态：按钮进入扫描中并回显真实扫描结果与时间（UTC+08:00）', async () => {
    mockRole('admin');
    let resolveScan: ((v: unknown) => void) | undefined;
    const list = vi.fn((): Promise<unknown> => new Promise((resolve) => { resolveScan = resolve; }));
    setHost({ list });
    render(<McpClientsPanel />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    resolveScan?.(SCAN);
    await waitFor(() => expect(screen.getByTestId('mcp-scanned-at').textContent).toContain('08:00:00'));

    await userEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '扫描中…' })).toBeDisabled());
    resolveScan?.(SCAN);
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('已重新扫描：检出 4 个已安装客户端'));
    expect(screen.getByTestId('mcp-message').textContent).toContain('08:00:00');
  });

  test('管理员：按真实扫描渲染状态，缺令牌可一键补齐并显示备份回执', async () => {
    mockRole('admin');
    const list = vi.fn(() => Promise.resolve(SCAN));
    const wire = vi.fn(() => Promise.resolve({
      ok: true, changed: true, path: 'C:/Users/u/.claude.json', backupPath: 'C:/Users/u/.claude.json.bak-2026',
    }));
    setHost({ list, wire });

    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    expect(screen.getByTestId('state-claude-code').textContent).toContain('缺令牌');
    // 批次48 表格状态列用短徽标文案（完整语义在 title 与详情折叠里）
    expect(screen.getByTestId('state-codex').textContent).toBe('未配置');
    expect(screen.getByTestId('state-trae-cn').textContent).toBe('需手工');

    const claudeRow = document.querySelector('[data-client="claude-code"]') as HTMLElement;
    await userEvent.click(claudeRow.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement);

    await waitFor(() => expect(wire).toHaveBeenCalledWith('claude-code', 'sid_test'));
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('已写入 Claude Code'));
    expect(screen.getByTestId('mcp-message').textContent).toContain('.bak-2026');
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2); // 写入后刷新真实状态
  });

  test('管理员：已接入不可重复写入；TOML 客户端可一键接入；手工客户端给出具体接通指引', async () => {
    mockRole('admin');
    setHost({ list: () => Promise.resolve(SCAN) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));

    const qoderRow = document.querySelector('[data-client="qoder-cn"]') as HTMLElement;
    const qoderBtn = qoderRow.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(qoderBtn.disabled).toBe(true);
    expect(qoderBtn.textContent).toBe('已接入');

    // TOML（Codex）现在可自动写入；手工客户端不提供一键写入按钮，但必须给出具体设置位置
    const codexRow = document.querySelector('[data-client="codex"]') as HTMLElement;
    const codexBtn = codexRow.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(codexBtn).not.toBeNull();
    expect(codexBtn.disabled).toBe(false);
    expect(codexBtn.textContent).toBe('一键接入');
    expect(screen.getByTestId('guide-codex').textContent).toContain('~/.codex/config.toml');
    expect(screen.getByTestId('guide-codex').textContent).toContain('multiagent_memory');

    const traeRow = document.querySelector('[data-client="trae-cn"]') as HTMLElement;
    expect(traeRow.querySelector('[data-act="mcp-wire"]')).toBeNull();
    expect(screen.getByTestId('guide-trae-cn').textContent).toContain('Trae CN → 设置 → MCP');
    expect(screen.getByTestId('guide-trae-cn').textContent).toContain('http://127.0.0.1:8204/mcp');
  });

  test('管理员：一键适配全部 —— 自动写入所有可写 JSON/TOML 客户端，并为无法写入的客户端生成片段', async () => {
    mockRole('admin');
    // 让 Qoder CN 也处于「未配置本服务」→ 三个可写目标（Qoder CN + Claude Code + Codex TOML）
    const scan = {
      ...SCAN,
      clients: SCAN.clients.map((c) => (((c as unknown as { id?: string }).id === 'qoder-cn')
        ? { ...c, state: 'missing_entry', hasAuth: true }
        : c)),
    };
    const list = vi.fn(() => Promise.resolve(scan));
    const wire = vi.fn((id: string) => Promise.resolve(
      id === 'qoder-cn'
        ? { ok: true, changed: false }
        : { ok: true, changed: true, backupPath: `C:/x/${id}.bak` },
    ));
    const snippet = vi.fn(() => Promise.resolve({ ok: true, snippet: '["手工片段"]' }));
    setHost({ list, wire, snippet });

    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-claude-code').textContent).toContain('缺令牌'));
    const all = screen.getByTestId('mcp-wire-all') as HTMLButtonElement;
    expect(all.textContent).toContain('一键适配全部（自动 3 + 片段 1）');
    expect(all.disabled).toBe(false);

    await userEvent.click(all);
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('一键适配完成'));
    expect(wire).toHaveBeenCalledTimes(3);
    expect(snippet).toHaveBeenCalledWith('trae-cn', 'sid_test');
    const msg = screen.getByTestId('mcp-message').textContent ?? '';
    expect(msg).toContain('自动写入 2 个');
    expect(msg).toContain('已是最新 1 个');
    expect(msg).toContain('生成配置片段 1 份');
    expect(screen.getByTestId('snippet-trae-cn').textContent).toContain('手工片段');
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2); // 完成后刷新真实状态
  });

  test('管理员：全部可写客户端已接入时按钮仍可点，点击生成手工客户端片段而不是禁用', async () => {
    mockRole('admin');
    // Qoder/Claude/Codex 已接入；Trae 只能手工 → 无自动写入目标，但按钮必须可用并生成片段
    const scan = {
      ...SCAN,
      clients: SCAN.clients.map((c) => {
        const id = (c as unknown as { id?: string }).id;
        return id === 'trae-cn' ? c : { ...c, state: 'wired', hasAuth: true };
      }),
    };
    const snippet = vi.fn(() => Promise.resolve({ ok: true, snippet: '["trae 手工片段"]' }));
    setHost({ list: () => Promise.resolve(scan), snippet });

    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    const all = screen.getByTestId('mcp-wire-all') as HTMLButtonElement;
    expect(all.disabled).toBe(false);
    expect(all.textContent).toContain('生成 1 份片段');

    await userEvent.click(all);
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('一键适配完成'));
    expect(snippet).toHaveBeenCalledWith('trae-cn', 'sid_test');
    const msg = screen.getByTestId('mcp-message').textContent ?? '';
    expect(msg).toContain('生成配置片段 1 份');
    expect(msg).toContain('请按行内接通指引手工添加');
    expect(screen.getByTestId('snippet-trae-cn').textContent).toContain('trae 手工片段');
  });

  test('管理员：冲突/无法解析不自动覆盖，但给出手工修复文件、当前端点与具体步骤', async () => {
    mockRole('admin');
    const issues = {
      endpoint: SCAN.endpoint,
      clients: [
        baseRow({
          id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json',
          state: 'conflict', foundUrl: 'http://127.0.0.1:9999/mcp',
        }),
        baseRow({
          id: 'workbuddy', name: 'WorkBuddy', badge: 'p0', displayPath: null, path: null,
          format: 'unknown', writable: false, state: 'invalid', error: 'Unexpected token',
        }),
      ],
    };
    setHost({ list: () => Promise.resolve(issues) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-cursor').textContent).toContain('冲突'));

    const cursorGuide = screen.getByTestId('guide-cursor').textContent ?? '';
    expect(cursorGuide).toContain('~/.cursor/mcp.json');
    expect(cursorGuide).toContain('MultiAgent Memory');
    expect(cursorGuide).toContain('http://127.0.0.1:9999/mcp');
    expect(cursorGuide).toContain('http://127.0.0.1:8204/mcp');

    const workbuddyGuide = screen.getByTestId('guide-workbuddy').textContent ?? '';
    expect(workbuddyGuide).toContain('~/.workbuddy/mcp.json'); // 批次28-D：实机确认稳定配置路径
    expect(workbuddyGuide).toContain('Unexpected token');
    expect(workbuddyGuide).toContain('刷新状态');

    // 冲突客户端虽可写也不得自动覆盖
    const cursorRow = document.querySelector('[data-client="cursor"]') as HTMLElement;
    const cursorBtn = cursorRow.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(cursorBtn.disabled).toBe(true);
  });

  test('无法解析：状态旁给「怎么处理」按钮，点开显示路径、真实错误与修复步骤', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [baseRow({
          id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json',
          state: 'invalid', error: "Unexpected token '1', '1m'... is not valid JSON",
        })],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-cursor').textContent).toContain('无法解析'));
    expect(screen.queryByTestId('fix-hint-cursor')).toBeNull();

    await userEvent.click(screen.getByTestId('fix-hint-btn-cursor'));
    const hint = screen.getByTestId('fix-hint-cursor').textContent ?? '';
    expect(hint).toContain('怎么处理');
    expect(hint).toContain('~/.cursor/mcp.json');
    expect(hint).toContain('JSON 语法');
    expect(hint).toContain("Unexpected token '1'");
    expect(hint).toContain('刷新状态');
    expect(hint).toContain('一键接入');
  });

  test('普通成员：复制/写入均禁用并提示需管理员', async () => {
    mockRole('member');
    setHost({ list: () => Promise.resolve(SCAN) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('mcp-admin-gate')).toBeInTheDocument());
    const copy = document.querySelector('[data-act="mcp-copy"]') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect((screen.getByTestId('mcp-wire-all') as HTMLButtonElement).disabled).toBe(true);
    const claudeRow = document.querySelector('[data-client="claude-code"]') as HTMLElement;
    expect((claudeRow.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test('普通成员：一键打开（只清自己机器上的禁用标记）可用；复制/接入仍卡管理员', async () => {
    const enable = vi.fn(() => Promise.resolve({ ok: true, changed: true }));
    mockRole('member');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [baseRow({
          id: 'workbuddy', name: 'WorkBuddy', badge: 'p0',
          displayPath: '~/.workbuddy/mcp.json', state: 'wired', hasAuth: true, disabled: true,
        })],
      }),
      enable,
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('客户端已关闭'));
    const btn = screen.getByRole('button', { name: '一键打开' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // 成员也能修自己机器上的开关（下放成员）
    await userEvent.click(btn);
    await waitFor(() => expect(enable).toHaveBeenCalledWith('workbuddy', 'sid_test'));
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('已清除标记 · 待生效'));
    // 写含令牌条目 / 复制片段仍只给管理员
    expect((document.querySelector('[data-act="mcp-copy"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test('客户端第一列统一三行：名称 / 形态+启动态（未启动紧跟 HTTP）/ 实测；CLI 无进程面如实说「不可测」', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [
          baseRow({ id: 'workbuddy', name: 'WorkBuddy', badge: 'p0', displayPath: '~/.workbuddy/mcp.json', state: 'wired', hasAuth: true, transport: 'http', running: true, live: { ok: true, status: 200, tools: 14, at: Date.UTC(2026, 0, 1, 0, 0, 0) } }),
          baseRow({ id: 'qoder-cn', name: 'Qoder CN', badge: 'p3', displayPath: '~/.qoder-cn/settings.json', state: 'wired', hasAuth: true, transport: 'stdio', running: false }),
          baseRow({ id: 'claude-code', name: 'Claude Code', badge: 'p1', displayPath: '~/.claude.json', state: 'wired', hasAuth: true, transport: 'http' }),
          // 未接入：形态未定，也要占住三个槽位，保证每行格式一致
          baseRow({ id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json', state: 'missing_entry' }),
        ],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-workbuddy').textContent).toBe('已接入'));

    // 每个客户端都必须是同一个三行结构（不允许某些行少一行、也不允许名称把徽标挤到同一行）
    for (const id of ['workbuddy', 'qoder-cn', 'claude-code', 'cursor']) {
      const cell = screen.getByTestId(`client-${id}`);
      expect(cell.className).toContain('af-client');
      const rows = cell.querySelectorAll(':scope > div');
      expect(rows).toHaveLength(3);
      expect(rows[0].className).toContain('af-client-name');
      expect(rows[1].className).toContain('af-client-form');
      expect(rows[2].className).toContain('af-client-meta');
      // 2026-11-28 用户要求（按截图对齐）：第一行只放名称；第二行 = 形态 + 启动态；第三行 = 实测
      expect(rows[0].querySelector('b')?.textContent).toBeTruthy();
      expect(rows[0].querySelector(`[data-testid="transport-${id}"]`)).toBeNull();
      expect(rows[0].querySelector(`[data-testid="run-${id}"]`)).toBeNull();
      expect(rows[1].querySelector(`[data-testid="transport-${id}"]`)).toBeTruthy();
      expect(rows[1].querySelector(`[data-testid="run-${id}"]`)).toBeTruthy();
      // 2026-11-28 用户要求：启动态排在形态之前（「已启动」在「HTTP 直连」上面）
      const formKids = Array.from(rows[1].children) as HTMLElement[];
      expect(formKids[0].getAttribute('data-testid')).toBe(`run-${id}`);
      expect(formKids[1].getAttribute('data-testid')).toBe(`transport-${id}`);
      expect(rows[2].querySelector(`[data-testid="live-${id}"]`)).toBeTruthy();
      expect(rows[2].querySelector(`[data-testid="run-${id}"]`)).toBeNull();
    }

    expect(screen.getByTestId('transport-workbuddy').textContent).toBe('HTTP 直连');
    expect(screen.getByTestId('transport-qoder-cn').textContent).toBe('stdio 免令牌');
    // 2026-11-28 用户要求「把工作做完」：未接入也不再留「形态未定」——片段本身就是 HTTP 直连，
    // 徽标给确定形态，title 说明这是「将以此形态接入」。
    expect(screen.getByTestId('transport-cursor').textContent).toBe('HTTP 直连');
    expect(screen.getByTestId('transport-cursor').getAttribute('title')).toContain('将以此形态接入');
    expect(screen.getByTestId('run-workbuddy').textContent).toBe('已启动');
    expect(screen.getByTestId('run-qoder-cn').textContent).toBe('未启动');
    // CLI 无稳定进程面 → 不可测，绝不误报「未启动」
    expect(screen.getByTestId('run-claude-code').textContent).toBe('不可测');
    expect(screen.getByTestId('run-claude-code').getAttribute('title')).toContain('不臆测');

    // 2026-11-28 用户要求：HTTP 连接成功也要绿色（判据只认实测 tools/list 成功）
    expect(screen.getByTestId('transport-workbuddy').className).toContain('ok');
    expect(screen.getByTestId('transport-workbuddy').getAttribute('title')).toContain('实测已连通');
    // 没实测过的 HTTP 行不得假装绿色
    expect(screen.getByTestId('transport-claude-code').className).not.toContain('ok');
  });

  test('无稳定配置文件的客户端也要「把工作做完」：形态确定、实测带口径、操作槽位不缺', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [
          // Zcode：配置存应用内部（configPath=null），只能复制片段手工粘贴
          baseRow({
            id: 'zcode', name: 'Zcode', badge: 'p3', format: 'json', writable: false,
            displayPath: null, path: null, state: 'manual',
            live: { ok: true, status: 200, tools: 14, at: Date.UTC(2026, 0, 1, 0, 0, 0), via: 'current' },
          }),
          // deepseek harness：无独立配置面、随宿主下发，实测用宿主令牌
          baseRow({
            id: 'deepseek-harness', name: 'deepseek harness', badge: 'p0', format: 'unknown',
            writable: true, displayPath: null, path: null, state: 'wired', transport: 'http',
            live: { ok: true, status: 200, tools: 14, at: Date.UTC(2026, 0, 1, 0, 0, 0), via: 'host' },
          }),
        ],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-deepseek-harness').textContent).toBe('已接入'));

    // ① 形态不再是「形态未定」：由规格推导为 HTTP 直连
    expect(screen.getByTestId('transport-zcode').textContent).toBe('HTTP 直连');
    expect(screen.getByTestId('transport-zcode').getAttribute('title')).toContain('将以此形态接入');
    expect(screen.getByTestId('transport-deepseek-harness').textContent).toBe('HTTP 直连');

    // ② 实测不再是「—」：给确定结果，但必须标清用哪份令牌（不许冒充它自己的配置）
    expect(screen.getByTestId('live-zcode').textContent).toContain('实测 ✓ 14 工具');
    expect(screen.getByTestId('live-zcode').textContent).toContain('片段令牌');
    expect(screen.getByTestId('live-deepseek-harness').textContent).toContain('经宿主令牌');
    // 实测通过 ⇒ 形态徽标同步转绿（HTTP 连通即绿）
    expect(screen.getByTestId('transport-zcode').className).toContain('ok');

    // ③ 操作列槽位不缺：不可代写的客户端给「需手工粘贴」，且「复制片段」是主按钮
    expect(screen.getByTestId('manual-zcode').textContent).toBe('需手工粘贴');
    const zcodeRow = document.querySelector('[data-client="zcode"]') as HTMLElement;
    expect((zcodeRow.querySelector('[data-act="mcp-copy"]') as HTMLElement).className).toContain('pri');
    // 可代写的继承客户端仍走一键接入，不该出现「需手工粘贴」
    expect(screen.queryByTestId('manual-deepseek-harness')).toBeNull();

    // ④ 三行结构不变（这两类客户端也不许少一行）
    for (const id of ['zcode', 'deepseek-harness']) {
      expect(screen.getByTestId(`client-${id}`).querySelectorAll(':scope > div')).toHaveLength(3);
    }
  });

  test('管理员：复制片段 → 展示一次性片段并写剪贴板（含令牌不外泄到日志）', async () => {
    mockRole('admin');
    const snippet = '{\n  "mcpServers": { "memagent": { "headers": { "Authorization": "Bearer t" } } }\n}\n';
    const snippetFn = vi.fn(() => Promise.resolve({ ok: true, snippet }));
    setHost({ list: () => Promise.resolve(SCAN), snippet: snippetFn });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));

    const claudeRow = document.querySelector('[data-client="claude-code"]') as HTMLElement;
    await userEvent.click(claudeRow.querySelector('[data-act="mcp-copy"]') as HTMLButtonElement);

    await waitFor(() => expect(snippetFn).toHaveBeenCalledWith('claude-code', 'sid_test'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snippet));
    expect(screen.getByTestId('snippet-claude-code').textContent).toBe(snippet);
    expect(screen.getByTestId('mcp-message').textContent).toContain('已复制');
  });
});

describe('批次41-X 显式身份头（面板补写口径）', () => {
  test('已接入但缺身份头 → 按钮变「补身份头」且可点，指引写明头名与配方 id', async () => {
    mockRole('admin');
    const scan = {
      ...SCAN,
      clients: SCAN.clients.map((c) => ((c as unknown as { id?: string }).id === 'qoder-cn'
        ? { ...c, state: 'wired', hasAuth: true, hasClientId: false }
        : c)),
    };
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: true, backupPath: 'C:/x/.qoder-cn.bak' }));
    setHost({ list: () => Promise.resolve(scan), wire });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));

    const row = document.querySelector('[data-client="qoder-cn"]') as HTMLElement;
    const btn = row.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('补身份头');
    expect(screen.getByTestId('guide-qoder-cn').textContent).toContain('X-Memagent-Client');
    expect(screen.getByTestId('guide-qoder-cn').textContent).toContain('qoder-cn');

    await userEvent.click(btn);
    await waitFor(() => expect(wire).toHaveBeenCalledWith('qoder-cn', 'sid_test'));
  });

  test('已接入且身份头齐全 → 仍是禁用的「已接入」，不重复写盘', async () => {
    mockRole('admin');
    const scan = {
      ...SCAN,
      clients: SCAN.clients.map((c) => ((c as unknown as { id?: string }).id === 'qoder-cn'
        ? { ...c, state: 'wired', hasAuth: true, hasClientId: true }
        : c)),
    };
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: false }));
    setHost({ list: () => Promise.resolve(scan), wire });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));

    const row = document.querySelector('[data-client="qoder-cn"]') as HTMLElement;
    const btn = row.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('已接入');
    expect(screen.getByTestId('guide-qoder-cn').textContent).not.toContain('补身份头');
    expect(screen.getByTestId('guide-qoder-cn').textContent).toContain('已在配置中确认');
  });

  test('一键适配全部把「已接入但缺身份头」计入自动写入目标', async () => {
    mockRole('admin');
    const scan = {
      ...SCAN,
      clients: SCAN.clients.map((c) => {
        const id = (c as unknown as { id?: string }).id;
        if (id === 'qoder-cn') return { ...c, state: 'wired', hasAuth: true, hasClientId: false };
        if (id === 'claude-code') return { ...c, state: 'wired', hasAuth: true, hasClientId: true };
        if (id === 'codex') return { ...c, state: 'wired', hasAuth: true, hasClientId: true };
        return c;
      }),
    };
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: true }));
    const snippet = vi.fn(() => Promise.resolve({ ok: true, snippet: '["trae 手工片段"]' }));
    setHost({ list: () => Promise.resolve(scan), wire, snippet });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));

    const all = screen.getByTestId('mcp-wire-all') as HTMLButtonElement;
    expect(all.disabled).toBe(false);
    expect(all.textContent).toContain('一键适配全部（自动 1 + 片段 1）');
    await userEvent.click(all);
    await waitFor(() => expect(wire).toHaveBeenCalledTimes(1));
    expect(wire).toHaveBeenCalledWith('qoder-cn', 'sid_test');
    expect(snippet).toHaveBeenCalledWith('trae-cn', 'sid_test');
  });

  test('身份头无从判定（无文件面的审计证据升级）→ 不出现「补身份头」，也不谎报缺头', async () => {
    mockRole('admin');
    const scan = {
      ...SCAN,
      clients: SCAN.clients.map((c) => ((c as unknown as { id?: string }).id === 'qoder-cn'
        ? { ...c, state: 'wired', hasAuth: true, hasClientId: undefined }
        : c)),
    };
    setHost({ list: () => Promise.resolve(scan) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    expect(screen.getByTestId('guide-qoder-cn').textContent).not.toContain('X-Memagent-Client');
    const row = document.querySelector('[data-client="qoder-cn"]') as HTMLElement;
    expect((row.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement).textContent).toBe('已接入');
  });
  // ── 2026-11-18：stdio 零维护形态（用户：客户端配置改成 stdio launcher 现读令牌，从此轮换零维护）──
  test('传输形态徽标：stdio 显示「零维护」，http 显示「HTTP」（别让用户以为两者等价）', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: 'http://127.0.0.1:8204/mcp',
        clients: [
          baseRow({ id: 'qoder-cn', name: 'Qoder CN', badge: 'p3', displayPath: '~/.qoder-cn/settings.json', state: 'wired', hasAuth: true, transport: 'stdio' }),
          baseRow({ id: 'claude-code', name: 'Claude Code', badge: 'p1', displayPath: '~/.claude.json', state: 'wired', hasAuth: true, transport: 'http', hasClientId: true }),
        ],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('transport-qoder-cn').textContent).toBe('stdio 免令牌'));
    expect(screen.getByTestId('transport-claude-code').textContent).toBe('HTTP 直连');
    // stdio 行的指引要说清「令牌轮换/数据根搬家都不用改配置」，而不是笼统「无需操作」
    expect(screen.getByTestId('guide-qoder-cn').textContent).toContain('零维护');
  });

  test('「改用 stdio」→ 以 mode=stdio 调主进程；成功后回执说明配置里不再有令牌', async () => {
    mockRole('admin');
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: true, path: 'C:/h/.claude.json', backupPath: 'C:/h/.claude.json.bak' }));
    setHost({ list: () => Promise.resolve(SCAN), wire });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('stdio-qoder-cn')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('stdio-qoder-cn'));
    // 第三个参数必须是 'stdio'：不带它主进程会按 HTTP 写回带令牌的配置（这就是要避免的事）
    await waitFor(() => expect(wire).toHaveBeenCalledWith('qoder-cn', 'sid_test', 'stdio'));
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('零维护'));
    expect(screen.getByTestId('mcp-message').textContent).toContain('不再有令牌');
  });

  test('已是 stdio 形态的行不再出现「改用 stdio」；冲突/无法解析的行也不出现（先修配置）', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: 'http://127.0.0.1:8204/mcp',
        clients: [
          baseRow({ id: 'qoder-cn', name: 'Qoder CN', badge: 'p3', displayPath: '~/.qoder-cn/settings.json', state: 'wired', hasAuth: true, transport: 'stdio' }),
          baseRow({ id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json', state: 'conflict', foundUrl: 'http://other/mcp' }),
          baseRow({ id: 'gemini-cli', name: 'Gemini CLI', badge: 'p3', displayPath: '~/.gemini/settings.json', state: 'invalid', error: '坏 JSON' }),
        ],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('transport-qoder-cn').textContent).toBe('stdio 免令牌'));
    expect(screen.queryByTestId('stdio-qoder-cn')).toBeNull();
    expect(screen.queryByTestId('stdio-cursor')).toBeNull();
    expect(screen.queryByTestId('stdio-gemini-cli')).toBeNull();
  });

  test('「⇄ 全改 stdio」：只对可写且还不是 stdio 的客户端发 mode=stdio，数量如实标出', async () => {
    mockRole('admin');
    const wire = vi.fn(() => Promise.resolve({ ok: true, changed: true }));
    setHost({ list: () => Promise.resolve(SCAN), wire });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    // SCAN 里可写的三个（qoder-cn / claude-code / codex）都是 HTTP 形态 → 全部计入
    const all = screen.getByTestId('mcp-stdio-all') as HTMLButtonElement;
    expect(all.textContent).toContain('全部改用免令牌（3）');
    await userEvent.click(all);
    await waitFor(() => expect(wire).toHaveBeenCalledTimes(3));
    for (const id of ['qoder-cn', 'claude-code', 'codex']) {
      expect(wire).toHaveBeenCalledWith(id, 'sid_test', 'stdio');
    }
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('全部改用免令牌完成'));
  });
});

describe('McpClientsPanel · 一键修复配置格式（BOM/注释/尾逗号）', () => {
  test('可修复行：显示「格式可一键修复」徽标 + 「一键修复并接入」按钮，点击走写入并回显修复结果', async () => {
    mockRole('admin');
    const wire = vi.fn(async () => ({ ok: true, changed: true, repaired: true, backupPath: '~/.cursor/mcp.json.bak-1' }));
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [baseRow({
          id: 'cursor', name: 'Cursor', badge: 'p3', displayPath: '~/.cursor/mcp.json',
          state: 'missing_entry', repairable: true,
        })],
      }),
      wire,
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('repairable-cursor')).toBeInTheDocument());
    expect(screen.getByTestId('repairable-cursor').textContent).toContain('格式可一键修复');

    const guide = screen.getByTestId('guide-cursor').textContent ?? '';
    expect(guide).toContain('一键修复并接入');
    expect(guide).toContain('无需手工改文件');

    const row = document.querySelector('[data-client="cursor"]') as HTMLElement;
    const btn = row.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('一键修复并接入');
    expect(btn.title).toContain('BOM');

    await userEvent.click(btn);
    await waitFor(() => expect(wire).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('mcp-message').textContent).toContain('修复配置格式'));
  });
});

describe('McpClientsPanel · 已接入但需修格式（wired + repairable）', () => {
  test('按钮必须是可点的主按钮：disabled=false 且不用 .off 灰样式（否则用户以为选不了）', async () => {
    mockRole('admin');
    setHost({
      list: () => Promise.resolve({
        endpoint: SCAN.endpoint,
        clients: [baseRow({
          id: 'qoder-cn', name: 'Qoder CN', badge: 'p3', displayPath: '~/.qoder-cn/settings.json',
          state: 'wired', hasAuth: true, repairable: true,
        })],
      }),
    });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('repairable-qoder-cn')).toBeInTheDocument());
    const btn = screen.getByTestId('wire-qoder-cn') as HTMLButtonElement;
    expect(btn.textContent).toContain('一键修复并接入');
    expect(btn.disabled).toBe(false);
    expect(btn.className).toContain('pri');
    expect(btn.className).not.toContain('off');
    expect(btn.title).toContain('BOM');
  });
});
