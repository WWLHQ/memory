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
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    mcpClients: {
      list: opts.list ?? (() => Promise.resolve(SCAN)),
      wire: opts.wire ?? (() => Promise.resolve({ ok: true, changed: true, path: 'C:/x/.claude.json', backupPath: 'C:/x/.claude.json.bak' })),
      snippet: opts.snippet ?? (() => Promise.resolve({ ok: true, snippet: '{"mcpServers":{}}' })),
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
  test('浏览器模式：如实降级为只读说明，不伪造客户端列表或「已接入」', async () => {
    render(<McpClientsPanel />);
    expect(screen.getByTestId('mcp-browser-note')).toBeInTheDocument();
    expect(document.querySelectorAll('#mcp-client-rows .found')).toHaveLength(0);
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
    expect(document.querySelectorAll('#mcp-client-rows .found')).toHaveLength(0);
  });

  test('只显示本机真实检出的客户端（未安装的 Cursor 不占位）', async () => {
    mockRole('admin');
    setHost({ list: () => Promise.resolve(SCAN) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('state-qoder-cn').textContent).toBe('已接入'));
    expect(document.querySelectorAll('#mcp-client-rows .found')).toHaveLength(4);
    expect(document.querySelector('[data-client="cursor"]')).toBeNull();
    expect(screen.queryByText('Cursor')).toBeNull();
  });

  test('扫描成功但未检出任何客户端 → 诚实空态（不列未安装客户端）', async () => {
    mockRole('admin');
    setHost({ list: () => Promise.resolve({ endpoint: SCAN.endpoint, clients: [] }) });
    render(<McpClientsPanel />);
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeInTheDocument());
    expect(document.querySelectorAll('#mcp-client-rows .found')).toHaveLength(0);
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
    expect(screen.getByTestId('state-codex').textContent).toBe('未配置本服务');
    expect(screen.getByTestId('state-trae-cn').textContent).toBe('需手工添加');

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
    expect(workbuddyGuide).toContain('WorkBuddy → 连接器中心');
    expect(workbuddyGuide).toContain('Unexpected token');
    expect(workbuddyGuide).toContain('刷新状态');

    // 冲突客户端虽可写也不得自动覆盖
    const cursorRow = document.querySelector('[data-client="cursor"]') as HTMLElement;
    const cursorBtn = cursorRow.querySelector('[data-act="mcp-wire"]') as HTMLButtonElement;
    expect(cursorBtn.disabled).toBe(true);
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
