// REQ-004 T11 宿主集成冒烟：AgentConversationDemo 渲染四类标识 + 开关降级
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { AgentConversationDemo } from '../AgentConversationDemo.tsx';

describe('AgentConversationDemo 宿主集成', () => {
  it('默认 full：渲染 🧠×3（对话气泡）/ 📎 / ⚡ / ⚠️×2 / 💾', () => {
    render(<AgentConversationDemo />);
    // 对话气泡内共 3 个 🧠（INJ_005 / INJ_009 / INJ_021）
    expect(screen.getAllByText('🧠').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/已带项目背景/)).toBeInTheDocument();
    expect(screen.getByText(/本次召回/)).toBeInTheDocument();
    expect(screen.getAllByText(/⚠️/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/已自动 write_memory/)).toBeInTheDocument();
  });

  it('切 off：🧠/⚡/📎/💾 隐藏，⚠️ 仍显示（诚实约束）', () => {
    render(<AgentConversationDemo />);
    fireEvent.click(screen.getByLabelText(/关闭 \(off\)/));
    // 对话气泡内 🧠 应全隐藏；右侧图例用的独立 badge 不受 config 影响（仅演示），不影响诚实约束
    expect(screen.queryAllByText('🧠').length).toBe(0);
    expect(screen.queryByText(/本次召回/)).toBeNull();
    expect(screen.queryByText(/已带项目背景/)).toBeNull();
    expect(screen.queryByText(/已自动 write_memory/)).toBeNull();
    // 诚实约束：⚠️ 恒显示
    expect(screen.getAllByText(/⚠️/).length).toBeGreaterThanOrEqual(2);
  });

  it('点 🧠 弹层可触发记住反馈 toast（内核 _feedback 回执驱动）', async () => {
    render(<AgentConversationDemo />);
    fireEvent.click(screen.getAllByText('🧠')[0]);
    const pop = screen.getByText(/记忆注入 · mem_005/).closest('.pop') as HTMLElement;
    fireEvent.click(within(pop).getByText('记住 +0.1'));
    await waitFor(() => expect(screen.getByText(/已「记住」mem_005/)).toBeInTheDocument());
  });
});
