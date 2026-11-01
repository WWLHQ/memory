// 页面级集成测试（对应旧 browser.test.js 的护栏作用 + §8 场景点击级验证）
// 接真口径：卡片/发现行来自接入页真实持久化名单（agentOnboardState），租户来自内核登录身份（bindTenant），
// 一键接入以宿主真扫结果为唯一真相（mock 主进程扫描，不走伪造回退）。无任何演示种子卡片。
// ⚠ 选择器与文案严格对齐 design/ui/Agent接入页_原型.html。
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentOnboardPage } from '../AgentOnboardPage.tsx';
import { ONBOARD_AUTOSCAN_KEY } from '../autoOnboard.ts';
import { ONBOARD_STATE_KEY, writeOnboardState } from '../onboardState.ts';
import { bindTenant, resetKernelForTests, setKernelStorageForTests } from '../../kernel.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { setTestOverride } from '../../Home/crossTabAuth.ts';

// 测试环境无 sessionStorage，强制 hasActiveSession()=true 绕过登录门控
setTestOverride(true);

/** 写入「一键接入完成」的真实持久化状态（页面卡片的唯一来源） */
function seedOnboard(agentNames = ['deepseek harness', 'Claude Code', 'Codex'], source: 'host' | 'kernel' = 'kernel') {
  writeOnboardState({ lastOnboardAt: Date.now(), agentNames, source });
}

/** mock 主进程宿主真扫（Electron preload 能力） */
function mockHostScan(found: Array<{ name: string; badge: 'p0' | 'p1' | 'p2'; label: string; source: string; signal: 'mcp' | 'proc' | 'hb' }>) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    hostScan: {
      run: () => Promise.resolve({ found, evidence: { processNames: found.map((f) => f.source) }, platform: 'win32', ok: true, scannedAt: Date.now() }),
    },
  };
}

function clearHostScan() {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

interface InstalledEcho {
  agent: string; via: string; source: string; version?: string;
  badge: 'p0' | 'p1' | 'p2' | 'p3'; label: string;
}

/** mock 三路宿主能力（进程/安装痕迹/MCP 客户端配置），用于登录自动接入链路 */
function mockHostApis(o: {
  found?: Array<{ name: string; badge: 'p0' | 'p1' | 'p2'; label: string; source: string; signal: 'mcp' | 'proc' | 'hb' }>;
  installed?: InstalledEcho[];
  installedProbes?: Record<string, string>;
  mcpClients?: Array<Record<string, unknown>>;
  wire?: (id: string, sid: string) => { ok: boolean; changed?: boolean; error?: string };
} = {}) {
  const found = o.found ?? [];
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    hostScan: {
      run: () => Promise.resolve({
        found, evidence: { processNames: found.map((f) => f.source) },
        platform: 'win32', ok: true, scannedAt: Date.now(),
      }),
    },
    hostAgentDetect: {
      run: () => Promise.resolve({
        found: o.installed ?? [], probes: o.installedProbes ?? {}, err: null,
      }),
    },
    mcpClients: {
      list: () => Promise.resolve({ endpoint: 'http://127.0.0.1:8204/mcp', clients: o.mcpClients ?? [] }),
      wire: (id: string, sid: string) => Promise.resolve(o.wire ? o.wire(id, sid) : { ok: true }),
    },
  };
}

/* ---------- mock 接入后端（T13 HTTP）：拨测/轮换回执按真实契约返回 ---------- */
type BackendReply = { ok: boolean; [k: string]: unknown };
const realFetch = globalThis.fetch;

function mockAgentBackend(route: (path: string) => BackendReply, cards: Array<Record<string, unknown>> = []) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const body: BackendReply = path === '/agents'
      ? { ok: true, cards }
      : path === '/audit'
        ? { ok: true, audit: [] }
        : route(path);
    return Promise.resolve({
      ok: body.ok, status: body.ok ? 200 : 422,
      json: () => Promise.resolve(body),
    }) as unknown as Promise<Response>;
  }) as typeof fetch;
}

beforeEach(() => {
  resetKernelForTests();
  // 批次28-A：mock 会话会让账本走 HTTP 数据面，单测仍用内存账本
  setKernelStorageForTests(new InMemoryStorage());
  localStorage.clear();
  sessionStorage.clear();
  bindTenant({ user_id: 'u_test', team_id: 'team_99', enterprise_id: 'ent_42' });
  setTestOverride(true);
});

afterEach(() => {
  setTestOverride(false);
  clearHostScan();
  globalThis.fetch = realFetch;
});

describe('AgentOnboardPage', () => {
  it('首屏：已接入 3 卡 + 3 发现项 + 端徽标 + 手动检测入口（效果证据四卡已迁至首页）', async () => {
    seedOnboard();
    render(<AgentOnboardPage />);
    await waitFor(() => {
      expect(document.querySelectorAll('#cards > .card')).toHaveLength(3);
    });
    expect(document.querySelector('#gains')).toBeNull();
    expect(document.querySelectorAll('#found > .found')).toHaveLength(3);
    expect(document.querySelectorAll('#stages .stage')).toHaveLength(4);
    expect(document.querySelector('#formBadge')?.textContent).toContain('当前端');
    expect(screen.getAllByText('deepseek harness').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Codex').length).toBeGreaterThan(0);
    // 本机检测（CLI + 桌面端 App）已合并进一键接入卡（#localAgentDetect 独立卡已移除）
    expect(document.querySelector('#localAgentDetect')).toBeNull();
    expect(document.querySelector('[data-testid="manual-detect"]')).not.toBeNull();
  });

  it('登录自动接入在其他 iframe 完成 → storage 事件即时恢复徽章/发现行/卡片', async () => {
    mockAgentBackend(() => ({ ok: true }));
    render(<AgentOnboardPage />);
    expect(screen.queryByText('✅ 已自动接入 · 切页/重载保持')).toBeNull();
    act(() => {
      writeOnboardState({
        lastOnboardAt: Date.now(),
        agentNames: ['Claude Code'],
        source: 'host',
        discovered: [{
          name: 'Claude Code', badge: 'p1', label: 'MVP·P1',
          signal: 'cli · where claude', bound: true, ok: true, source: 'host',
        }],
        seq: Date.now(),
      });
      window.dispatchEvent(new StorageEvent('storage', { key: ONBOARD_STATE_KEY }));
    });
    await waitFor(() => {
      expect(screen.getByText('✅ 已自动接入 · 切页/重载保持')).toBeInTheDocument();
      expect(document.querySelector('#scanState')?.textContent).toContain('完成 · 发现并绑定 1 个');
      expect(document.querySelectorAll('#cards > .card')).toHaveLength(1);
      expect(document.querySelectorAll('#found > .found')).toHaveLength(1);
    });
  });

  it('真实租户：卡片 tenant 字段来自内核登录身份（bindTenant 落盘）', async () => {
    seedOnboard();
    render(<AgentOnboardPage />);
    await waitFor(() => {
      expect(document.querySelectorAll('#cards > .card')).toHaveLength(3);
    });
    expect(screen.getAllByText('ent_42 / team_99')).toHaveLength(3);
    expect(screen.queryByText('ent_001 / team_001')).not.toBeInTheDocument();
  });

  it('R4：双通道全关 → 报错并禁保存；恢复一路即解除', async () => {
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
    const save = card.querySelector('[data-act="save"]') as HTMLButtonElement;

    await userEvent.click(card.querySelector('input[data-chan="webhook"]') as HTMLInputElement);
    await userEvent.click(card.querySelector('input[data-chan="api"]') as HTMLInputElement);

    await waitFor(() => {
      expect(card.querySelector('[data-err]')?.textContent).toContain('R4');
    });
    expect(save.disabled).toBe(true);

    await userEvent.click(card.querySelector('input[data-chan="webhook"]') as HTMLInputElement);
    await waitFor(() => {
      expect(card.querySelector('[data-err]')?.textContent).toBe('');
    });
    expect(save.disabled).toBe(false);
  });

  it('R2：关共享且开写 → 保存时提示须带 project_id', async () => {
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
    await userEvent.click(card.querySelector('input[data-iso="projShare"]') as HTMLInputElement);
    await userEvent.click(card.querySelector('[data-act="save"]') as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByText(/R2：记忆读写须带 project_id/)).toBeInTheDocument();
    });
  });

  it('测试接入（真实拨测通过）→ 回执 toast + 状态点已连通 + 注入预览；轮换密钥 → toast', async () => {
    mockAgentBackend((path) => {
      if (path.endsWith('/test')) {
        return {
          ok: true, requestId: 'req_mock_pass',
          card: { agent_name: 'deepseek harness', status: 'CONNECTED', lastTest: { ok: true, reason: '命中安装证据（cli）：deepseek-harness' } },
        };
      }
      if (path.endsWith('/rotate-key')) {
        return { ok: true, card: { agent_name: 'deepseek harness', status: 'CONNECTED' } };
      }
      return { ok: false, reason: 'unexpected' };
    });
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
    const inject = card.querySelector('[data-inject]') as HTMLElement;
    expect(inject.style.display).toBe('none');

    await userEvent.click(card.querySelector('[data-act="test"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText(/测试通过：deepseek harness · req_mock_pass/)).toBeInTheDocument());
    expect(inject.style.display).not.toBe('none');
    expect(inject.textContent).toContain('账本暂无可注入记忆');
    await waitFor(() => expect(card.querySelector('.statusdot.st-connected')).not.toBeNull());

    await userEvent.click(card.querySelector('[data-act="rotate"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText(/已轮换，旧 Key 24h 内有效/)).toBeInTheDocument());
  });

  it('Phase C 验收：断开 Agent 后测通 → 卡片不得出现 CONNECTED（降级 + 真实原因）', async () => {
    const reason = '未检测到「deepseek harness」的本机安装痕迹（CLI/安装目录/开始菜单/配置/注册表均未命中）';
    mockAgentBackend((path) => {
      if (path.endsWith('/test')) {
        return {
          ok: false, requestId: 'req_mock_fail', reason,
          card: { agent_name: 'deepseek harness', status: 'DEGRADED', lastTest: { ok: false, reason } },
        };
      }
      return { ok: false, reason: 'unexpected' };
    });
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;

    await userEvent.click(card.querySelector('[data-act="test"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText(new RegExp(`测试未通过：deepseek harness —— .*未检测到`))).toBeInTheDocument());
    await waitFor(() => expect(card.querySelector('.statusdot.st-degraded')).not.toBeNull());
    expect(card.querySelector('.statusdot.st-connected')).toBeNull();
    expect(card.textContent).toContain('降级（仅补偿）');
    expect(card.querySelector('.warn.show')?.textContent).toContain('最近一次真实拨测未通过');
    expect(card.textContent).toContain(reason);
  });

  it('轮换失败（后端不可达）→ 如实提示，不宣称已轮换', async () => {
    mockAgentBackend((path) => {
      if (path.endsWith('/rotate-key')) return { ok: false, reason: 'no-card' };
      return { ok: false, reason: 'unexpected' };
    });
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;

    await userEvent.click(card.querySelector('[data-act="rotate"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText(/轮换失败：deepseek harness —— no-card/)).toBeInTheDocument());
    expect(screen.queryByText(/已轮换，旧 Key 24h 内有效/)).not.toBeInTheDocument();
  });

  it('一键接入（宿主真扫）：四段跑完 → 完成文案 + 真实扫描结果建卡', async () => {
    mockAgentBackend((path) => (path === '/discover' ? { ok: true, cards: [] } : { ok: false, reason: 'unexpected' }));
    mockHostScan([
      { name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', source: 'deepseek.exe', signal: 'proc' },
      { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', source: 'claude.exe', signal: 'proc' },
      { name: 'Codex', badge: 'p2', label: '兜底·P2', source: 'codex.exe', signal: 'proc' },
    ]);
    render(<AgentOnboardPage />);
    expect(document.querySelectorAll('#cards > .card')).toHaveLength(0); // 未接入过 → 无卡

    await userEvent.click(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ }));

    await waitFor(() => {
      expect(document.querySelectorAll('#stages .stage.done')).toHaveLength(4);
    }, { timeout: 4000 });
    await waitFor(() => {
      expect(screen.getByText(/完成 · 发现并绑定 3 个 · 宿主真扫/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/一键接入完成：自动发现 3 个 Agent 并绑定/)).toBeInTheDocument();
    });
    await waitFor(() => expect(document.querySelectorAll('#cards > .card')).toHaveLength(3));
    expect(document.querySelectorAll('#found > .found')).toHaveLength(3);
    // 持久化生效：再次进入可直接恢复
    expect(localStorage.getItem('agentOnboardState')).toContain('deepseek harness');
  });

  it('撤销自动绑定 → 该卡片回到未配置（R9）', async () => {
    // 后端已有卡片（真实状态机输出 CONNECTED）→ 挂载合并回填为「已连通」
    mockAgentBackend(
      () => ({ ok: true }),
      [
        { agent_name: 'deepseek harness', status: 'CONNECTED' },
        { agent_name: 'Claude Code', status: 'CONNECTED' },
        { agent_name: 'Codex', status: 'DEGRADED' },
      ],
    );
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
    await waitFor(() => expect(card.querySelector('.statusdot.st-connected')).not.toBeNull());

    await userEvent.click(document.querySelector('[data-unbind="0"]') as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByText(/已撤销 deepseek harness 的自动绑定/)).toBeInTheDocument();
    });
    expect(card.textContent).toContain('未配置');
    expect(document.querySelector('[data-unbind="0"]')).toBeNull(); // 已撤销 → 按钮消失
  });

  it('request_id 点击 → 跳审计提示（18.2-E）；未测试不伪造回执', async () => {
    mockAgentBackend((path) => (path.endsWith('/test')
      ? { ok: true, requestId: 'req_page_1', card: { agent_name: 'deepseek harness', status: 'CONNECTED' } }
      : { ok: false, reason: 'unexpected' }));
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
    // 未测试 → 如实显示「尚未测试」，不伪造 request_id，点击不跳转
    expect(card.querySelector('[data-rid]')?.textContent).toBe('尚未测试 · 点「▶ 测试接入」');
    await userEvent.click(card.querySelector('[data-rid]') as HTMLElement);
    expect(screen.queryByText(/定位 deepseek harness 的 request_id 链路/)).toBeNull();

    // 真实拨测拿到后端回执后，rid 才可点
    await userEvent.click(card.querySelector('[data-act="test"]') as HTMLButtonElement);
    await waitFor(() => expect(card.querySelector('[data-rid]')?.textContent).toBe('req_page_1'));
    await userEvent.click(card.querySelector('[data-rid]') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText(/定位 deepseek harness 的 request_id 链路/)).toBeInTheDocument();
    });
  });

  it('一键接入（宿主真扫）：只展示真实命中，未命中不伪造行', async () => {
    mockAgentBackend((path) => (path === '/discover' ? { ok: true, cards: [] } : { ok: false, reason: 'unexpected' }));
    mockHostScan([
      { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', source: 'claude.exe', signal: 'proc' },
    ]);
    render(<AgentOnboardPage />);
    await userEvent.click(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ }));
    await waitFor(() => {
      expect(screen.getByText(/完成 · 发现并绑定 1 个 · 宿主真扫/)).toBeInTheDocument();
    }, { timeout: 4000 });
    // 只有 1 行真实命中（不为未命中 agent 补伪造发现行）
    expect(document.querySelectorAll('#found > .found')).toHaveLength(1);
    const row = document.querySelector('[data-disc="0"]') as HTMLElement;
    expect(row.textContent).toContain('已绑定');
    expect(row.textContent).toContain('proc · claude.exe');
    expect(row.textContent).toContain('宿主真扫');
    expect(document.querySelector('[data-disc="1"]')).toBeNull();
  });

  it('三路真扫合并：安装痕迹 + 进程 + MCP 配置 → 去重发现行 + 自动建卡 + MCP 摘要', async () => {
    mockAgentBackend((path) => (path === '/discover'
      ? {
          ok: true,
          cards: [
            { agent_name: 'deepseek harness', status: 'CONNECTED' },
            { agent_name: 'Claude Code', status: 'CONNECTED' },
          ],
        }
      : { ok: false, reason: 'unexpected' }));
    mockHostApis({
      found: [
        { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', source: 'claude.exe', signal: 'proc' },
      ],
      installed: [
        { agent: 'deepseek harness', via: 'cli', source: 'deepseek-harness --version → 0.9.1', version: '0.9.1', badge: 'p0', label: 'MVP·P0' },
        { agent: 'Claude Code', via: 'config', source: '~/.claude.json', badge: 'p1', label: 'MVP·P1' },
      ],
      mcpClients: [
        {
          id: 'claude-code', name: 'Claude Code', badge: 'p1', state: 'wired', writable: true,
          format: 'json', installed: true, displayPath: '~/.claude.json', hasAuth: true,
          rulesHint: '仓库根 CLAUDE.md（@AGENTS.md）',
        },
        {
          // 批次28-B：deepseek harness 宿主继承 —— 宿主 Qoder 已接入即本客户端 wired（无需独立配置）
          id: 'deepseek-harness', name: 'deepseek harness', badge: 'p0', state: 'wired', writable: true,
          format: 'unknown', installed: true, displayPath: null, hasAuth: true,
          rulesHint: '工作区 AGENTS.md',
        },
      ],
    });
    render(<AgentOnboardPage />);
    await userEvent.click(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ }));

    await waitFor(() => {
      expect(screen.getByText(/完成 · 发现并绑定 2 个 · 宿主真扫/)).toBeInTheDocument();
    }, { timeout: 4000 });
    // 两路命中同一 Agent → 合并为一行（不重复建卡/建行）
    expect(document.querySelectorAll('#found > .found')).toHaveLength(2);
    expect(document.querySelectorAll('#cards > .card')).toHaveLength(2);
    const claudeRow = document.querySelector('[data-disc="1"]') as HTMLElement;
    expect(claudeRow.textContent).toContain('安装痕迹（config）');
    expect(claudeRow.textContent).toContain('proc · claude.exe');
    // 已 wired 的 Claude Code 与宿主继承接通的 deepseek harness 都计入「已写入」
    const summary = document.querySelector('[data-testid="mcp-wire-summary"]') as HTMLElement;
    expect(summary.textContent).toContain('Claude Code');
    expect(summary.textContent).toContain('deepseek harness');
  });

  it('非桌面壳（浏览器）：自动接入如实失败 → 失败提示 + 指向「手动检测」', async () => {
    mockAgentBackend(() => ({ ok: false, reason: 'unexpected' }));
    render(<AgentOnboardPage />);
    await userEvent.click(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ }));

    await waitFor(() => {
      expect(screen.getByTestId('onboard-failure').textContent).toContain('非桌面壳环境');
    }, { timeout: 4000 });
    expect(screen.getByTestId('onboard-failure').textContent).toContain('手动检测');
    expect(screen.getByTestId('manual-detect')).toBeInTheDocument();
    expect(document.querySelectorAll('#cards > .card')).toHaveLength(0); // 无宿主信号 → 不伪造卡片
  });

  it('页面启动补扫：有会话 + 无历史状态 → 自动扫描并接入（无需点击）', async () => {
    localStorage.setItem('session:realpage', 'sid_auto_scan');
    mockAgentBackend((path) => {
      if (path === '/api/me') {
        return {
          ok: true,
          context: {
            enterprise_id: 'ent_42', team_id: 'team_99', user_id: 'u_test',
            perspective: 'team', session_id: 'sid_auto_scan', role: 'admin',
          },
        };
      }
      if (path === '/discover') return { ok: true, cards: [] };
      return { ok: true };
    });
    mockHostApis({
      found: [{ name: 'Claude Code', badge: 'p1', label: 'MVP·P1', source: 'claude.exe', signal: 'proc' }],
      mcpClients: [{
        id: 'claude-code', name: 'Claude Code', badge: 'p1', state: 'wired', writable: true,
        format: 'json', installed: true, displayPath: '~/.claude.json', hasAuth: true,
        rulesHint: '仓库根 CLAUDE.md（@AGENTS.md）',
      }],
    });

    render(<AgentOnboardPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('#cards > .card')).toHaveLength(1);
    }, { timeout: 4000 });
    expect(document.querySelector('#scanState')?.textContent).toContain('完成 · 发现并绑定 1 个');
    expect(document.querySelectorAll('#found > .found')).toHaveLength(1);
  });

  it('页面启动补扫：本次登录会话已扫过 → 切回接入页不重复扫描（批次33-A，按 sid 记账不再是 60s 窗口）', async () => {
    localStorage.setItem('session:realpage', 'sid_auto_skip');
    seedOnboard(); // 已有「一键接入完成」持久化状态 → 挂载初始态直接回填卡片
    sessionStorage.setItem(ONBOARD_AUTOSCAN_KEY, 'sid_auto_skip'); // 本次登录已扫过
    let meCalls = 0;
    mockAgentBackend((path) => {
      if (path === '/api/me') {
        meCalls += 1;
        return {
          ok: true,
          context: {
            enterprise_id: 'ent_42', team_id: 'team_99', user_id: 'u_test',
            perspective: 'team', session_id: 'sid_auto_skip', role: 'admin',
          },
        };
      }
      return { ok: true };
    });
    let hostScanCalls = 0;
    (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = {
      hostScan: {
        run: () => {
          hostScanCalls += 1;
          return Promise.resolve({ found: [], evidence: {}, platform: 'win32', ok: true, scannedAt: Date.now() });
        },
      },
      hostAgentDetect: { run: () => Promise.resolve({ found: [], probes: {}, err: null }) },
      mcpClients: { list: () => Promise.resolve({ endpoint: 'http://127.0.0.1:8204/mcp', clients: [] }) },
    };

    render(<AgentOnboardPage />);
    await waitFor(() => expect(meCalls).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(hostScanCalls).toBe(0);
    expect(document.querySelector('#scanState')?.textContent).toContain('完成 · 发现并绑定 3 个');
    expect(screen.queryByTestId('onboard-failure')).toBeNull();
  });

  it('页面启动补扫：换了登录会话（sid 没扫过）→ 即使有历史接入状态仍补扫一轮', async () => {
    localStorage.setItem('session:realpage', 'sid_auto_new');
    seedOnboard();
    sessionStorage.setItem(ONBOARD_AUTOSCAN_KEY, 'sid_other_login'); // 上一轮登录的标记，不算本次
    mockAgentBackend((path) => {
      if (path === '/api/me') {
        return {
          ok: true,
          context: {
            enterprise_id: 'ent_42', team_id: 'team_99', user_id: 'u_test',
            perspective: 'team', session_id: 'sid_auto_new', role: 'admin',
          },
        };
      }
      if (path === '/discover') return { ok: true, cards: [] };
      return { ok: true };
    });
    let hostScanCalls = 0;
    (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = {
      hostScan: {
        run: () => {
          hostScanCalls += 1;
          return Promise.resolve({ found: [], evidence: {}, platform: 'win32', ok: true, scannedAt: Date.now() });
        },
      },
      hostAgentDetect: { run: () => Promise.resolve({ found: [], probes: {}, err: null }) },
      mcpClients: { list: () => Promise.resolve({ endpoint: 'http://127.0.0.1:8204/mcp', clients: [] }) },
    };

    render(<AgentOnboardPage />);
    await waitFor(() => expect(hostScanCalls).toBe(1), { timeout: 4000 });
    // 起扫即记账：扫描进行中切页再挂载，也不会再起第二轮
    expect(sessionStorage.getItem(ONBOARD_AUTOSCAN_KEY)).toBe('sid_auto_new');
  });

  it('页面启动补扫：无真实会话 → 登录门禁，不触发扫描', async () => {
    setTestOverride(false);
    let hostScanCalls = 0;
    (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
    (window as unknown as { api: unknown }).api = {
      hostScan: {
        run: () => {
          hostScanCalls += 1;
          return Promise.resolve({ found: [], evidence: {}, platform: 'win32', ok: true, scannedAt: Date.now() });
        },
      },
    };

    render(<AgentOnboardPage />);
    expect(screen.getByText('请先登录')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hostScanCalls).toBe(0);
    setTestOverride(true);
  });

  it('卡片指标：后端审计成功率 + 平均延时 + 熔断 + 租户在首次挂载即显示', async () => {
    // /audit 返回真实结构（test + auto_bind，各带 durationMs）
    (globalThis as unknown as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const now = Date.now();
      const body = path === '/audit'
        ? {
            ok: true,
            audit: [
              { ts: now - 3000, action: 'auto_bind', agent: 'deepseek harness', status: 'CONNECTED', result: 'pass', durationMs: 100 },
              { ts: now - 2000, action: 'test', agent: 'deepseek harness', status: 'DEGRADED', result: 'fail', durationMs: 300 },
            ],
          }
        : path === '/agents'
          ? {
              ok: true,
              cards: [
                { agent_name: 'deepseek harness', status: 'DEGRADED', circuit: 'OPEN', priority: 'P0', lastTest: { ok: false, reason: '探测未命中' } },
              ],
            }
          : { ok: false, reason: 'unexpected' };
      return Promise.resolve({
        ok: body.ok, status: body.ok ? 200 : 422,
        json: () => Promise.resolve(body),
      }) as unknown as Promise<Response>;
    }) as typeof fetch;
    seedOnboard();
    render(<AgentOnboardPage />);
    const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
    await waitFor(() => {
      expect(card.querySelector('.statusdot.st-degraded')).not.toBeNull();
    });
    await waitFor(() => {
      const metrics = [...card.querySelectorAll('.metric .v')].map((n) => n.textContent);
      expect(metrics[0]).toBe('50%'); // 1 次通过 / 2 次连通尝试
      expect(metrics[1]).toBe('OPEN'); // 真实熔断状态
      expect(metrics[2]).toBe('200ms'); // (100 + 300) / 2
      expect(metrics[3]).toBe('ent_42 / team_99'); // 真实租户（内核登录身份）
    });
    expect((card.querySelector('[data-act="test"]') as HTMLButtonElement).disabled).toBe(true);
    expect(card.textContent).toContain('主通道 Webhook 熔断 OPEN');
  });
});
