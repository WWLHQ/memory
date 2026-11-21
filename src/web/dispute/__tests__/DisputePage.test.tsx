import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisputePage } from '../DisputePage.tsx';
import { DisputeQueue } from '../DisputeQueue.tsx';
import { DisputeVerdict } from '../DisputeVerdict.tsx';
import { SEED_CONFLICTS } from './fixtures.ts';

const NOW = new Date('2026-10-10T09:00:00.000Z').getTime();

// 页面接真：队列 = 真实账本（jsdom/浏览器 = 内存态空账本 → 诚实空态，绝不伪造种子冲突）。
// SEED_CONFLICTS 仅作单元测试夹具（DisputeQueue/DisputeVerdict 组件直渲用法），页面不渲染。
describe('DisputePage (P7-T5 编排·真实账本接真版)', () => {
  it('空账本（jsdom 内存态）→ 诚实空态（不渲染种子冲突）', async () => {
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('dispute-empty')).toBeInTheDocument());
    expect(screen.getByTestId('dispute-empty')).toHaveTextContent('当前账本无待裁决冲突');
    // 批次54：空态与截图同构——面板内保留队列表头骨架（列头齐全），不是光秃秃一张说明卡
    expect(screen.getByTestId('dispute-empty').textContent).toContain('conflict_id');
    expect(screen.getByTestId('dispute-empty').textContent).toContain('old 置信度');
    expect(screen.getByTestId('dispute-empty').textContent).toContain('冲突队列（0）');
    // 诚实口径：无真实冲突 → 不渲染种子 cf_001~cf_005 队列项
    expect(screen.queryByTestId('queue')).toBeNull();
  });

  it('有真实冲突（coreConflicts 返回非空）→ 渲染队列 + 裁决面板', async () => {
    // 注入 1 条真实冲突（模拟账本有 pending 冲突）
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    expect(screen.getAllByTestId(/^queue-item-/)[0]).toHaveTextContent(SEED_CONFLICTS[0].old_content);
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-old')).toBeInTheDocument();
    expect(screen.getByTestId('panel-new')).toBeInTheDocument();
  });

  it('批次63 对齐设计稿：双栏对比标题含 conflict_id、hint 含 mem_id 候选、旧值 del / 新值 ins 差异标记', async () => {
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    // 面板头：双栏对比 · <conflict_id> + <old_id> → <new_id> 候选
    expect(screen.getByText(`双栏对比 · ${SEED_CONFLICTS[0].id}`)).toBeInTheDocument();
    expect(screen.getByText(`${SEED_CONFLICTS[0].old_id} → ${SEED_CONFLICTS[0].new_id} 候选`)).toBeInTheDocument();
    // 旧值 <del> / 新值 <ins>（文本仍在，标记包裹）
    expect(screen.getByTestId('panel-old').querySelector('del')).toBeTruthy();
    expect(screen.getByTestId('panel-old').querySelector('del')?.textContent).toBe(SEED_CONFLICTS[0].old_content);
    expect(screen.getByTestId('panel-new').querySelector('ins')).toBeTruthy();
    expect(screen.getByTestId('panel-new').querySelector('ins')?.textContent).toBe(SEED_CONFLICTS[0].new_content);
  });

  it('裁决走内核（_memoryOp + 成对审计）→ 审计历史 + toast', async () => {
    const live = [SEED_CONFLICTS[0]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    fireEvent.click(screen.getByTestId('verdict-auto_override'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/旧值 deprecated/));
    expect(screen.getByTestId('audit-log')).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent(/req_/);
  });

  // 批次25 P0-7：内核读不到 ≠ 无待裁决冲突（原来 catch 里保持空列表 → 被说成「无冲突」）
  it('内核不可达 → 显示内核原因与重试，绝不显示「无待裁决冲突」', async () => {
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('本机服务响应超时，请重试');
    expect(screen.getByTestId('kernel-error-reason').textContent).not.toContain('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('dispute-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue')).not.toBeInTheDocument();
  });
  // 2026-11-21：参考稿筛选行 / 裁决方式 / 真实裁决历史
  it('筛选行：超期 >7 天为真实筛选，类型筛选因内核未采样禁用并写原因', async () => {
    // 夹具 0 超期 3 天、夹具 1 超期 9 天：筛选必须按真实 overdue_days 生效
    const live = [SEED_CONFLICTS[0], SEED_CONFLICTS[1]];
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue(live);
    render(<DisputePage load={async () => live} loadHistory={async () => []} />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(2));
    // 类型筛选：禁用且原因可见
    const typeBtn = screen.getByTestId('dispute-filter-type');
    expect(typeBtn).toBeDisabled();
    expect(typeBtn.getAttribute('title')).toContain('未采样');
    // 超期筛选：只剩 9 天那条，切回全部恢复两条
    expect(screen.getByTestId('dispute-filter-all')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('dispute-filter-overdue'));
    expect(screen.getByTestId('dispute-filter-overdue')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    expect(screen.getAllByTestId(/^queue-item-/)[0]).toHaveTextContent(SEED_CONFLICTS[1].id);
    fireEvent.click(screen.getByTestId('dispute-filter-all'));
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(2));
  });

  it('超期筛选无可匹配项 → 如实提示筛选为空，不伪造行', async () => {
    const fresh = { ...SEED_CONFLICTS[0], overdue_days: 0, created_at: new Date().toISOString(), wait_text: '刚刚' };
    vi.spyOn(await import('../coreDispute.ts'), 'coreConflicts').mockResolvedValue([fresh]);
    render(<DisputePage />);
    await waitFor(() => expect(screen.getByTestId('dispute-filter-overdue')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('dispute-filter-overdue'));
    await waitFor(() => expect(screen.getByTestId('queue-filter-empty')).toBeInTheDocument());
    expect(screen.getByTestId('queue-filter-empty')).toHaveTextContent(/账本共 1 条/);
    expect(screen.queryAllByTestId(/^queue-item-/).length).toBe(0);
  });

  it('裁决方式：人工可用；AI 裁决未接内核 → 禁用并写原因', async () => {
    render(<DisputePage load={async () => [SEED_CONFLICTS[0]]} loadHistory={async () => []} />);
    await waitFor(() => expect(screen.getAllByTestId(/^queue-item-/).length).toBe(1));
    fireEvent.click(screen.getAllByTestId(/^queue-item-/)[0]);
    expect(screen.getByTestId('dispute-mode-human')).toHaveAttribute('aria-pressed', 'true');
    const ai = screen.getByTestId('dispute-mode-ai');
    expect(ai).toBeDisabled();
    expect(ai.getAttribute('title')).toContain('内核未提供 AI 裁决通道');
  });

  it('裁决历史：读账本 conflict_resolve 审计（真实 request_id 与 pending/merged 如实展示）', async () => {
    render(<DisputePage
      load={async () => [SEED_CONFLICTS[0]]}
      loadHistory={async () => [
        {
          request_id: 'req_hist_01', verdict: 'user_confirm', pending: true, resolved: false,
          old_id: 'mem_a', new_id: 'mem_b', ts: 2, note: '人工确认 · 保持 pending（未落定）',
        },
        {
          request_id: 'req_hist_02', verdict: 'merge', pending: false, resolved: true,
          merged_mem_id: 'mem_merged', old_id: 'mem_c', new_id: 'mem_d', ts: 1,
          note: '合并 · 已落定 · 合并记忆 mem_merged',
        },
      ]}
    />);
    await waitFor(() => expect(screen.getByTestId('dispute-history')).toBeInTheDocument());
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent('req_hist_01');
    expect(screen.getByTestId('audit-row-0')).toHaveTextContent('保持 pending');
    expect(screen.getByTestId('audit-row-1')).toHaveTextContent('mem_merged');
  });
});

describe('DisputeQueue (T3)', () => {
  it('空队列显示占位', () => {
    render(<DisputeQueue list={[]} onSelect={() => {}} />);
    expect(screen.getByTestId('queue-empty')).toHaveTextContent(/暂无/);
  });

  it('超期高亮 + 类型徽章渲染（测试夹具 SEED_CONFLICTS，仅组件单测用）', () => {
    render(<DisputeQueue list={SEED_CONFLICTS} now={NOW} onSelect={() => {}} />);
    const item = screen.getByText(/默认端口 8080/).closest('li');
    expect(item).toHaveClass('overdue');
    expect(screen.getAllByText('直接矛盾').length).toBe(2);
    expect(screen.getByText('部分重叠')).toBeInTheDocument();
  });
});

describe('DisputeVerdict (T4)', () => {
  const base = SEED_CONFLICTS[0];
  it('渲染 4 按钮，且不预生成假 request_id（真实 id 只能由内核裁决返回，批次48 A19）', () => {
    render(<DisputeVerdict record={base} onVerdict={() => {}} />);
    expect(screen.queryByText(/req_[0-9A-Za-z]+/)).toBeNull();
    expect(screen.getByTestId('req-hint')).toHaveTextContent('内核裁决返回');
    expect(screen.getByTestId('verdict-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^verdict-(auto_override|user_confirm|merge|hold)$/).length).toBe(4);
  });
});
