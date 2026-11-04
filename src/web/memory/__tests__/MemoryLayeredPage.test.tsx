// 层级管理页写回验收（批次25 P0-1）：点「保存修改」必须真写内核账本，被拒时必须可见。
// 旧实现只 window.dispatchEvent('layered-memory-save')（全仓无监听）→ 页面看似已保存、账本没动。
// 测试不 mock：沿用本仓约定，直接读写共享内核账本（getStorage）。
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { coreListMemories, getStorage } from '../coreMemoryOps.ts';
import { MemoryLayeredPage } from '../MemoryLayeredPage.tsx';
import type { Memory } from '../../../core/memagent/types.ts';

const NOW = Date.now();

function mem(over: Partial<Memory> & Pick<Memory, 'mem_id' | 'content'>): Memory {
  return {
    project_id: 'P1',
    enterprise_id: 'e_demo',
    team_id: 't_demo',
    category: 'fact',
    layer: 'L1',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    importance: 0.8,
    confidence: 0.9,
    access_count: 1,
    reinforce_count: 0,
    half_life_days: 30,
    tags: ['test'],
    last_access_time: NOW,
    ...over,
  } as Memory;
}

function editContentRows(): Promise<number> {
  return getStorage()
    .queryAudit({ action: 'memory_op' })
    .then((rows) => rows.filter((a) => a.detail?.op === 'edit_content').length);
}

/** 渲染 → 等该行在指定层表格出现 → 点它打开右栏详情 */
async function openRow(layer: 'L1' | 'L2', memId: string): Promise<HTMLElement> {
  render(<MemoryLayeredPage />);
  const row = await waitFor(() => {
    const el = within(screen.getByTestId(`${layer}-table`)).queryByTestId(`lrow-${memId}`);
    if (!el) throw new Error(`${layer} 行未就绪`);
    return el;
  });
  fireEvent.click(row);
  return screen.getByTestId('edit');
}

beforeEach(async () => {
  const storage = getStorage();
  for (const m of await storage.listMemories({})) await storage.deleteMemory(m.mem_id);
});

describe('MemoryLayeredPage 保存写回（批次25 P0-1）', () => {
  it('保存 → 真写回内核账本（content + version + memory_op 审计）', async () => {
    const auditBefore = await editContentRows();
    await getStorage().putMemory(mem({ mem_id: 'mem_w1', content: '原始层级内容等待改写', content_l1: '原始层级内容等待改写' }));
    const edit = await openRow('L1', 'mem_w1');
    await waitFor(() => expect(edit).toHaveValue('原始层级内容等待改写'));

    fireEvent.change(edit, { target: { value: '改写后的层级内容已生效，超时阈值 300ms' } });
    fireEvent.click(screen.getByTestId('save'));

    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('保存修改'));
    const m = await getStorage().getMemory('mem_w1');
    expect(m?.content).toBe('改写后的层级内容已生效，超时阈值 300ms');
    expect(m?.content_l1).toBe('改写后的层级内容已生效，超时阈值 300ms');
    expect(m?.version).toBe(2);
    expect(await editContentRows()).toBe(auditBefore + 1);
  });

  it('内核拒绝 → 错误可见、账本原样不变、草稿保留（不冒充已保存）', async () => {
    await getStorage().putMemory(mem({ mem_id: 'mem_w2', content: '不该被清空的内容正文', content_l1: '不该被清空的内容正文' }));
    const edit = await openRow('L1', 'mem_w2');
    await waitFor(() => expect(edit).toHaveValue('不该被清空的内容正文'));

    fireEvent.change(edit, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('save'));

    await waitFor(() => expect(screen.getByTestId('save-error')).toBeInTheDocument());
    expect(screen.getByTestId('save-error')).toHaveTextContent('内容不能为空');
    const m = await getStorage().getMemory('mem_w2');
    expect(m?.content).toBe('不该被清空的内容正文');
    expect(m?.version).toBe(1);
    expect(edit).toHaveValue('   ');
  });

  it('派生层（非记忆自身最深层）只读：不把该层文本写进主内容', async () => {
    await getStorage().putMemory(mem({
      mem_id: 'mem_w3', content: 'L1 主内容', content_l1: 'L1 主内容', content_l2: '遗留 L2 摘要文本',
    }));
    const edit = await openRow('L2', 'mem_w3');
    await waitFor(() => expect(edit).toHaveValue('遗留 L2 摘要文本'));

    expect(edit).toHaveAttribute('readonly');
    expect(screen.getByTestId('derived-note')).toBeInTheDocument();
    expect(screen.getByTestId('save')).toBeDisabled();
    const m = await getStorage().getMemory('mem_w3');
    expect(m?.content).toBe('L1 主内容');
    expect(m?.content_l2).toBe('遗留 L2 摘要文本');
  });

  it('保存成功 → 右栏文本与层卡片同步为改写后的内容', async () => {
    await getStorage().putMemory(mem({ mem_id: 'mem_w4', content: '内容四号原始文本', content_l1: '内容四号原始文本' }));
    const edit = await openRow('L1', 'mem_w4');
    await waitFor(() => expect(edit).toHaveValue('内容四号原始文本'));
    fireEvent.change(edit, { target: { value: '改写后的内容四号文本，回滚耗时 120 秒' } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('保存修改'));
    expect((await getStorage().getMemory('mem_w4'))?.content).toBe('改写后的内容四号文本，回滚耗时 120 秒');
    await waitFor(() => expect(edit).toHaveValue('改写后的内容四号文本，回滚耗时 120 秒'));
    expect(within(screen.getByTestId('L1-table')).getByTestId('lrow-mem_w4')).toHaveTextContent('改写后的内容四号文本，回滚耗时 120 秒');
  });
});

// 批次25 P0-7：内核读不到 ≠ 账本为空，也不再永远停在「加载中」。
describe('MemoryLayeredPage 内核加载三态（批次25 P0-7）', () => {
  it('内核不可达 → 显示内核原因与重试，绝不显示「记忆账本还是空的」', async () => {
    render(<MemoryLayeredPage load={() => Promise.reject(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'))} />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('memory-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('L1-table')).not.toBeInTheDocument();
  });

  it('错误态点「重试」→ 重新读账本并渲染层级表格', async () => {
    await getStorage().putMemory(mem({ mem_id: 'mem_r1', content: '重试后应出现的层级内容', content_l1: '重试后应出现的层级内容' }));
    let fail = true;
    const load = async () => {
      if (fail) throw new Error('记忆库被其它进程锁定');
      return coreListMemories();
    };
    render(<MemoryLayeredPage load={load} />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    fail = false;
    fireEvent.click(screen.getByTestId('kernel-retry'));
    await waitFor(() => {
      const el = within(screen.getByTestId('L1-table')).queryByTestId('lrow-mem_r1');
      if (!el) throw new Error('L1 行未就绪');
      expect(el).toHaveTextContent('重试后应出现的层级内容');
    });
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
  });

  it('真空账本 → 诚实空态，不显示错误卡', async () => {
    render(<MemoryLayeredPage />);
    await waitFor(() => expect(screen.getByTestId('memory-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
  });
});
