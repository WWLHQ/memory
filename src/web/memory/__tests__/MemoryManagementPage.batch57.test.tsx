// 批次57 验收：记忆库页签精简（全部/活跃/休眠/归档/弃用/分层）+ 语义派生状态 + 行右键常驻详情菜单。
// 数据全部来自真实账本播种（getStorage），不注入演示状态。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryManagementPage } from '../MemoryManagementPage.tsx';
import { getStorage, deriveMemoryStatus } from '../coreMemoryOps.ts';
import type { Memory } from '../../../core/memagent/types.ts';

const NOW = Date.now();

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
  // jsdom 跨用例共享 location：清掉上个用例 goTab 写入的 ?tab=…
  window.history.replaceState(null, '', '/');
  const storage = getStorage();
  for (const m of await storage.listMemories({})) {
    await storage.deleteMemory(m.mem_id);
  }
});

describe('deriveMemoryStatus 语义派生（批次57 用户确认口径）', () => {
  it('弃用 = merged_into 非空（旧值让位）', () => {
    expect(deriveMemoryStatus({ decay_class: 'hot', merged_into: 'mem_new' })).toBe('deprecated');
    expect(deriveMemoryStatus({ decay_class: 'cold', merged_into: 'mem_new' })).toBe('deprecated');
  });
  it('归档 = decay_class archived', () => {
    expect(deriveMemoryStatus({ decay_class: 'archived' })).toBe('archived');
  });
  it('休眠 = decay_class dormant 或 cold（冷记忆不活跃）', () => {
    expect(deriveMemoryStatus({ decay_class: 'dormant' })).toBe('dormant');
    expect(deriveMemoryStatus({ decay_class: 'cold' })).toBe('dormant');
  });
  it('活跃 = hot / warm', () => {
    expect(deriveMemoryStatus({ decay_class: 'hot' })).toBe('active');
    expect(deriveMemoryStatus({ decay_class: 'warm' })).toBe('active');
  });
});

describe('MemoryManagementPage 批次57 页签精简', () => {
  it('六个页签齐全，旧页签（个人/冲突/待重放/L0）不再出现', async () => {
    render(<MemoryManagementPage />);
    await waitFor(() => expect(screen.getByTestId('mm-tab-all')).toBeInTheDocument());
    for (const id of ['all', 'active', 'dormant', 'archived', 'deprecated', 'layers']) {
      expect(screen.getByTestId(`mm-tab-${id}`)).toBeInTheDocument();
    }
    for (const id of ['personal', 'conflict', 'review', 'l0']) {
      expect(screen.queryByTestId(`mm-tab-${id}`)).toBeNull();
    }
  });

  it('状态页签计数来自语义派生的真实账本（弃用=merged_into 1 条、休眠=cold 1 条）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'b57_hot', content: '活跃条目' }));
    await storage.putMemory(mem({ mem_id: 'b57_cold', content: '冷条目', decay_class: 'cold' }));
    await storage.putMemory(mem({ mem_id: 'b57_arch', content: '归档条目', decay_class: 'archived' }));
    await storage.putMemory(mem({ mem_id: 'b57_merged', content: '被合并的旧值', merged_into: 'b57_hot' }));

    render(<MemoryManagementPage />);
    await waitFor(() => expect(screen.getByTestId('mm-head-count').textContent).toContain('4 条记忆'));
    await waitFor(() => {
      expect(screen.getByTestId('mm-tab-active').textContent).toContain('1');
      expect(screen.getByTestId('mm-tab-dormant').textContent).toContain('1');
      expect(screen.getByTestId('mm-tab-archived').textContent).toContain('1');
      expect(screen.getByTestId('mm-tab-deprecated').textContent).toContain('1');
    });

    // 弃用页签：表格只显示被合并的旧值行
    fireEvent.click(screen.getByTestId('mm-tab-deprecated'));
    await waitFor(() => expect(screen.getByTestId('memory-row-b57_merged')).toBeInTheDocument());
    expect(screen.queryByTestId('memory-row-b57_hot')).toBeNull();
    expect(screen.getByTestId('memory-row-b57_merged').textContent).toContain('被合并的旧值');

    // 休眠页签：只显示 cold 条目
    fireEvent.click(screen.getByTestId('mm-tab-dormant'));
    await waitFor(() => expect(screen.getByTestId('memory-row-b57_cold')).toBeInTheDocument());
    expect(screen.queryByTestId('memory-row-b57_merged')).toBeNull();
  });

  it('状态筛选下拉只有四态（蛰伏/陈旧/组合选项已随精简删除）', async () => {
    render(<MemoryManagementPage />);
    const select = await waitFor(() => screen.getByLabelText('状态筛选')) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['all', 'active', 'dormant', 'archived', 'deprecated']);
  });
});

describe('MemoryManagementPage 批次57 行右键常驻详情菜单', () => {
  async function seedTwo() {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'b57_ctx_a', content: '右键详情甲内容' }));
    await storage.putMemory(mem({ mem_id: 'b57_ctx_b', content: '右键详情乙内容' }));
  }

  it('右键行打开常驻详情菜单（含字段与内容）；点外部不关闭', async () => {
    await seedTwo();
    render(<MemoryManagementPage />);
    const rowA = await waitFor(() => screen.getByTestId('memory-row-b57_ctx_a'));
    fireEvent.contextMenu(rowA);
    const menu = screen.getByTestId('mm-ctx-menu');
    expect(menu).toBeInTheDocument();
    expect(menu.textContent).toContain('右键详情甲内容');
    expect(menu.textContent).toContain('b57_ctx_a');
    expect(menu.textContent).toContain('常驻 · 点外部不关闭');

    // 点页面其它地方（空白区）→ 菜单仍在（常驻，不随外部点击消失）
    fireEvent.click(document.body);
    expect(screen.getByTestId('mm-ctx-menu')).toBeInTheDocument();
  });

  it('右键另一行切换内容；Esc 或 × 关闭', async () => {
    await seedTwo();
    render(<MemoryManagementPage />);
    const rowA = await waitFor(() => screen.getByTestId('memory-row-b57_ctx_a'));
    fireEvent.contextMenu(rowA);
    expect(screen.getByTestId('mm-ctx-menu').textContent).toContain('右键详情甲内容');

    // 右键另一行 → 切换内容
    fireEvent.contextMenu(screen.getByTestId('memory-row-b57_ctx_b'));
    expect(screen.getByTestId('mm-ctx-menu').textContent).toContain('右键详情乙内容');
    expect(screen.getByTestId('mm-ctx-menu').textContent).not.toContain('右键详情甲内容');

    // Esc 关闭
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('mm-ctx-menu')).toBeNull();

    // 再打开，× 关闭
    fireEvent.contextMenu(screen.getByTestId('memory-row-b57_ctx_a'));
    expect(screen.getByTestId('mm-ctx-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mm-ctx-close'));
    expect(screen.queryByTestId('mm-ctx-menu')).toBeNull();
  });
});
