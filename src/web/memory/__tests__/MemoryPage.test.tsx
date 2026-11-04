import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryPage } from '../MemoryPage.tsx';
import { coreListMemories, getStorage } from '../coreMemoryOps.ts';
import type { Memory } from '../../../core/memagent/types.ts';

const NOW = Date.now();

/** 直接往真实账本（共享 storage）写测试记忆 —— 页面不注入任何演示数据，测试数据也是显式写入 */
function mem(over: Partial<Memory> & Pick<Memory, 'mem_id' | 'content'>): Memory {
  return {
    project_id: 'P1',
    enterprise_id: 'e_demo',
    team_id: 't_demo',
    category: 'fact',
    layer: 'L2',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    importance: 0.8,
    confidence: 0.9,
    access_count: 3,
    reinforce_count: 1,
    half_life_days: 30,
    tags: ['test'],
    last_access_time: NOW,
    ...over,
  } as Memory;
}

beforeEach(async () => {
  // 每个用例前清空真实账本，保证「无演示数据」语义下的确定性
  const storage = getStorage();
  for (const m of await storage.listMemories({})) {
    await storage.deleteMemory(m.mem_id);
  }
});

/** 数据真相 = 真实账本异步加载，等首屏到位 */
async function renderLoaded() {
  render(<MemoryPage />);
  await waitFor(() => expect(screen.getByTestId('memory-table')).toBeInTheDocument());
}

describe('MemoryPage 集成（T5）', () => {
  it('空账本 → 诚实空态 + 引导去写入页（禁止演示数据）', async () => {
    render(<MemoryPage />);
    await waitFor(() => expect(screen.getByTestId('memory-empty')).toBeInTheDocument());
    expect(screen.getByTestId('goto-write')).toBeInTheDocument();
    expect(screen.queryByTestId('memory-table')).not.toBeInTheDocument();
  });

  it('渲染真实账本记忆（挂载即读账本，无种子）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '真实记忆 A' }));
    await storage.putMemory(mem({ mem_id: 'mem_t2', content: '真实记忆 B' }));
    await renderLoaded();
    expect(screen.getByTestId('row-mem_t1')).toBeInTheDocument();
    expect(screen.getByTestId('row-mem_t2')).toBeInTheDocument();
  });

  it('点击「📖 打开」按钮打开详情抽屉并可编辑内容', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '原始内容' }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_t1')).getByTestId('op-open'));
    expect(screen.getByTestId('memory-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('edit-content')).toHaveValue('原始内容');
  });

  it('抽屉编辑保存 → 写回真实账本（version+1 + 审计）', async () => {
    const storage = getStorage();
    const edited = '修改后的内容：上线前必须校验数据库迁移脚本，回滚耗时 120 秒';
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '原始内容' }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_t1')).getByTestId('op-open'));
    // 未修改 → 保存禁用
    expect((screen.getByTestId('drawer-save') as HTMLButtonElement).disabled).toBe(true);
    // 修改内容 → 保存可用
    fireEvent.change(screen.getByTestId('edit-content'), { target: { value: edited } });
    expect((screen.getByTestId('drawer-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('已保存修改'));
    // 账本真实写入
    const saved = await storage.getMemory('mem_t1');
    expect(saved?.content).toBe(edited);
    expect(saved?.version).toBe(2);
    const audits = await storage.queryAudit({ action: 'memory_op' });
    expect(audits.some((a) => (a.detail as { op?: string })?.op === 'edit_content')).toBe(true);
    // 列表同步刷新
    await waitFor(() => expect(screen.getByTestId('row-mem_t1')).toHaveTextContent(edited));
  });

  it('批次10：编辑内容未过 L0→L1 质量门 → 拒绝并诚实提示，账本不变', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '原始内容' }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_t1')).getByTestId('op-open'));
    fireEvent.change(screen.getByTestId('edit-content'), { target: { value: '你好，我是一个 AI 助手' } });
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('质量门'));
    const saved = await storage.getMemory('mem_t1');
    expect(saved?.content).toBe('原始内容'); // 未写入
    expect(saved?.version).toBe(1);
    const audits = await storage.queryAudit({ action: 'memory_op' });
    const rejected = audits.find((a) => (a.detail as { action?: string })?.action === 'filtered_l0_to_l1');
    expect(rejected).toBeTruthy();
    expect(rejected?.detail.source).toBe('manual_edit');
  });

  it('locked 记忆抽屉只读：保存禁用 + 提示先解锁', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_lk', content: '锁定内容', locked: true }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_lk')).getByTestId('op-open'));
    const ta = screen.getByTestId('edit-content') as HTMLTextAreaElement;
    expect(ta.readOnly).toBe(true);
    expect(screen.getByText(/已锁定 · 只读/)).toBeInTheDocument();
  });

  it('抽屉展示「记忆存储位置」（诚实标注，非演示）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '真实记忆 A' }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_t1')).getByTestId('op-open'));
    // 存储位置区存在且非空（浏览器测试环境 = 内存态；桌面壳下 = 真实文件路径）
    const loc = await screen.findByTestId('store-location');
    expect(loc.textContent && loc.textContent.length).toBeGreaterThan(0);
    // 断言其为三类诚实标注之一（不出现「演示」「seed」字样）
    expect(loc.textContent).toMatch(/账本|内存态|未知|账本位置/);
  });

  it('点击「记住」弹出 17.3 toast（经内核 ma._memoryOp）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '真实记忆 A' }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_t1')).getByTestId('op-remember'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('已提升这条信息的优先级。'));
  });

  it('点击「忘记」弹出 17.3 toast', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '真实记忆 A' }));
    await renderLoaded();
    fireEvent.click(within(screen.getByTestId('row-mem_t1')).getByTestId('op-forget'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('这条信息已降权'));
  });

  it('点击行打开详情抽屉', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '真实记忆 A', category: 'pitfall' }));
    await renderLoaded();
    fireEvent.click(screen.getByTestId('row-mem_t1'));
    expect(screen.getByTestId('memory-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-close')).toBeInTheDocument();
  });

  it('locked 行记住按钮禁用（G4）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_locked', content: '锁定的合规记忆', locked: true }));
    await renderLoaded();
    const row = screen.getByTestId('row-mem_locked');
    expect(within(row).getByTestId('op-remember')).toBeDisabled();
    expect(within(row).getByTestId('op-unlock')).not.toBeDisabled();
  });

  it('点击记住后该行仍渲染且内核回执生效（importance 钳制上界内）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_t1', content: '真实记忆 A', category: 'pitfall' }));
    await renderLoaded();
    const row = screen.getByTestId('row-mem_t1');
    expect(within(row).getByText('pitfall')).toBeInTheDocument();
    fireEvent.click(within(row).getByTestId('op-remember'));
    // 内核异步回执后：该行仍渲染（未被删除），toast 出现
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('已提升这条信息的优先级。'));
    expect(screen.getByTestId('row-mem_t1')).toBeInTheDocument();
  });

  it('「📂 打开」按钮：点击有反馈，浏览器环境诚实报错（不静默无反应）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_f1', content: '真实记忆 F' }));
    await renderLoaded();
    const row = screen.getByTestId('row-mem_f1');
    expect(within(row).getByTestId('op-open')).toBeInTheDocument();
    // 浏览器测试环境（非桌面壳）：hostCall 抛「宿主能力不可用」→ 按钮仍要给出明确 toast 反馈
    fireEvent.click(within(row).getByTestId('op-open'));
    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/无法打开文件|正在打开/),
    );
  });

  // 批次25 P0-7：内核读不到 ≠ 账本为空（原来 catch 里 setMemories([]) → 1642 行真账本被说成空库）
  it('内核不可达 → 显示内核原因与重试，绝不显示「记忆账本还是空的」', async () => {
    render(<MemoryPage load={() => Promise.reject(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'))} />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('memory-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goto-write')).not.toBeInTheDocument();
  });

  it('错误态点「重试」→ 重新读账本；真空账本才显示空态', async () => {
    let fail = true;
    const load = async () => {
      if (fail) throw new Error('记忆库被其它进程锁定');
      return coreListMemories();
    };
    render(<MemoryPage load={load} />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    fail = false;
    fireEvent.click(screen.getByTestId('kernel-retry'));
    await waitFor(() => expect(screen.getByTestId('memory-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
  });
});
