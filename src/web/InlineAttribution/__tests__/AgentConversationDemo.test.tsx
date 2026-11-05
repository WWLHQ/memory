// REQ-004 T11 宿主集成冒烟：AgentConversationDemo（接真口径）渲染 agent 切换器 + 统一记忆库标识
// 接真后：数据真相 = 内核账本（jsdom/浏览器 = 内存态空账本 → 诚实空态，绝不伪造演示数据）。
// 「所有接入的 agent 使用同一个记忆库，不区分来源」口径：
//   切换 agent 只改变窗口头部标识，召回池始终是全部真实记忆（不按 created_by_agent 过滤）。
// 测试断言：① 接入页真实持久化的 agent 名单驱动切换器 ② 有 agent 无记忆 → 诚实空态 ③ 切 agent 同账本 ④ off 降级。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentConversationDemo } from '../AgentConversationDemo.tsx';
import { getKernelWithSeed, resetKernelForTests, setKernelStorageForTests } from '../../kernel.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { SESSION_STORAGE_KEY } from '../../../shared/sessionKey.ts';

/** /api/me 返回的真实租户（阶段5-D：本页只认这个来源的身份） */
const REAL_CTX = {
  enterprise_id: 'ent_real',
  team_id: 'team_real',
  user_id: 'user_real',
  perspective: 'team' as const,
  session_id: 'sess_real_123',
};

/** 写入接入页真实持久化状态（接入页一键接入后会写入该键） */
function seedOnboard(agentNames: string[]) {
  localStorage.setItem('agentOnboardState', JSON.stringify({
    lastOnboardAt: Date.now(),
    agentNames,
    source: 'host',
  }));
}

/** 阶段5-D：种真实 session + 提供 /api/me 真响应，让用例走接真登录态而非绕过门控 */
function seedRealTenant() {
  localStorage.setItem(SESSION_STORAGE_KEY, REAL_CTX.session_id);
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: unknown) => {
    if (String(input).endsWith('/api/me')) {
      return { ok: true, json: async () => ({ context: REAL_CTX }) };
    }
    // 其它请求（内核数据面等）保持原行为，绝不返回伪造响应破坏账本加载
    return realFetch
      ? realFetch(input as RequestInfo, init as RequestInit)
      : Promise.reject(new Error('no fetch in test env'));
  }));
}

beforeEach(() => {
  resetKernelForTests();
  // 阶段5-D：真 session 会让账本切到 HTTP 数据面（同批次28-A），单测固定走内存账本
  setKernelStorageForTests(new InMemoryStorage());
  localStorage.clear(); // 隔离 localStorage 残留（agentOnboardState / agentOnboardDetectedAgents）
  seedRealTenant();
});
afterEach(() => {
  vi.restoreAllMocks(); // 「内核不可达」用例的 loadRealInline spy 不得泄漏到后续用例
  vi.unstubAllGlobals();
});

describe('AgentConversationDemo 宿主集成（接真口径·统一记忆库不区分来源）', () => {
  it('接入页持久化的 agent 名单驱动切换器（去重后按真实来源呈现）', async () => {
    seedOnboard(['deepseek harness', 'Claude Code', 'Codex']);
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByTestId('agent-switcher')).toBeInTheDocument());
    const sel = screen.getByTestId('agent-select') as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toEqual(['deepseek harness', 'Claude Code', 'Codex']);
    expect(sel.value).toBe('deepseek harness');
    expect(screen.getByTestId('agent-switcher')).toHaveTextContent('统一记忆库·不区分来源');
  });

  it('无任何已接入 agent → 诚实空态（不伪造 agent / 不伪造注入）', async () => {
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByTestId('inline-empty')).toBeInTheDocument());
    expect(screen.getByTestId('inline-empty')).toHaveTextContent('当前无任何已接入 agent');
    expect(screen.getByTestId('inline-empty')).toHaveTextContent('空账本不伪造数据');
  });

  it('有 agent 但账本无记忆 → 统一共享账本诚实空态（不伪造 🧠 注入）', async () => {
    seedOnboard(['deepseek harness']);
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByTestId('inline-shared-empty')).toBeInTheDocument());
    expect(screen.getByTestId('inline-shared-empty')).toHaveTextContent('统一记忆库中暂无可读记忆');
    expect(screen.getByTestId('inline-shared-empty')).toHaveTextContent('所有已接入 agent 共享');
  });

  it('切换 agent：底层同一共享账本，召回池不随 agent 变化', async () => {
    seedOnboard(['deepseek harness', 'Claude Code']);
    await getKernelWithSeed()._seedMemory({
      content: '项目技术栈约束：Node 20 + SQLite + React', category: 'fact', project_id: 'P1',
      created_by_agent: 'claude-code',
    });
    render(<AgentConversationDemo />);
    const sel = await screen.findByTestId('agent-select') as HTMLSelectElement;
    await waitFor(() => expect(screen.getByText(/基于记忆回答/)).toBeInTheDocument());
    fireEvent.change(sel, { target: { value: 'Claude Code' } });
    await waitFor(() => expect(sel.value).toBe('Claude Code'));
    // 切换后仍走同一账本：注入标记不变（不按来源 agent 过滤）
    await waitFor(() => expect(screen.getByText(/Claude Code · 基于记忆回答/)).toBeInTheDocument());
    expect(screen.queryByTestId('inline-shared-empty')).toBeNull();
  });

  it('off 级别：降级统计行出现（19.7 诚实约束）', async () => {
    seedOnboard(['deepseek harness']);
    await getKernelWithSeed()._seedMemory({ content: '部署约束：仅内网访问', category: 'preference', project_id: 'P1' });
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByLabelText(/关闭 \(off\)/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/关闭 \(off\)/));
    await waitFor(() => expect(screen.getByText(/点击恢复完整标识/)).toBeInTheDocument());
  });

  // 批次25 P0-7：内核读不到 ≠ 无已接入 agent（原来 catch 里保持 null → 被说成「无 agent」）
  it('内核不可达 → 显示内核原因与重试，绝不显示「当前无任何已接入 agent」', async () => {
    vi.spyOn(await import('../useInlineReal.ts'), 'loadRealInline')
      .mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('inline-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-switcher')).not.toBeInTheDocument();
  });

  // ── 阶段5-D / A13：接真登录态 ──────────────────────────────────────────
  it('阶段5-D：未登录 → 登录门禁，不渲染账本数据或身份占位', async () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    seedOnboard(['deepseek harness']);
    render(<AgentConversationDemo />);
    expect(await screen.findByTestId('inline-login-gate')).toBeInTheDocument();
    expect(screen.getByTestId('inline-goto-login')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-switcher')).toBeNull();
    expect(screen.queryByTestId('inline-empty')).toBeNull();
    expect(screen.queryByTestId('inline-tenant')).toBeNull();
    expect(screen.queryByText(/project=P1|user=U1/)).toBeNull();
  });

  it('阶段5-D：/api/me 失败 → 保持门禁，绝不回落到演示身份', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    seedOnboard(['deepseek harness']);
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByTestId('inline-login-gate')).toBeInTheDocument());
    expect(screen.queryByTestId('agent-switcher')).toBeNull();
    expect(screen.queryByText(/project=P1|user=U1|演示占位/)).toBeNull();
  });

  it('阶段5-D：已登录 → 头部只显示 /api/me 的真实租户标识', async () => {
    seedOnboard(['deepseek harness']);
    render(<AgentConversationDemo />);
    await waitFor(() => expect(screen.getByTestId('agent-switcher')).toBeInTheDocument());
    const tenant = screen.getByTestId('inline-tenant');
    expect(tenant).toHaveTextContent('user=user_real');
    expect(tenant).toHaveTextContent('ent_real/team_real');
    expect(tenant.textContent).not.toContain('project=P1');
    expect(tenant.textContent).not.toContain('演示占位');
    expect(screen.queryByTestId('inline-login-gate')).toBeNull();
  });
});
