// REQ-004 T11 宿主集成冒烟：AgentConversationDemo（接真口径）渲染 agent 切换器 + 统一记忆库标识
// 接真后：数据真相 = 内核账本（jsdom/浏览器 = 内存态空账本 → 诚实空态，绝不伪造演示数据）。
// 「所有接入的 agent 使用同一个记忆库，不区分来源」口径：
//   切换 agent 只改变窗口头部标识，召回池始终是全部真实记忆（不按 created_by_agent 过滤）。
// 测试断言：① 接入页真实持久化的 agent 名单驱动切换器 ② 有 agent 无记忆 → 诚实空态 ③ 切 agent 同账本 ④ off 降级。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentConversationDemo } from '../AgentConversationDemo.tsx';
import { getKernelWithSeed, resetKernelForTests } from '../../kernel.ts';

/** 写入接入页真实持久化状态（接入页一键接入后会写入该键） */
function seedOnboard(agentNames: string[]) {
  localStorage.setItem('agentOnboardState', JSON.stringify({
    lastOnboardAt: Date.now(),
    agentNames,
    source: 'host',
  }));
}

beforeEach(() => {
  resetKernelForTests();
  localStorage.clear(); // 隔离 localStorage 残留（agentOnboardState / agentOnboardDetectedAgents）
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
});
