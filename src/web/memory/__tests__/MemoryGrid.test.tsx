// 记忆库表格组件测试（2026-11-22 第四轮）：
// 1) 表头分隔线拖拽改列宽，并写入 localStorage —— 刷新/切页/重登/重启后读回同一组宽度；
// 2) 动作列补齐真实能力（查看 + 更多：编辑 / 复制 ID / 复制内容 / 跳分层 / 打开记忆文件 / 删除）。
// 浏览器 E2E 的账本为空（禁止种子数据），因此这里用真实 MemoryGrid + 真实指针事件覆盖拖拽与持久化。
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryGrid, COL_WIDTHS_DEFAULT, COL_WIDTHS_KEY } from '../MemoryManagementPage.tsx';
import type { MemoryRecord } from '../types.ts';

function rec(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem_e2e_1',
    content: '评审前先跑一遍类型检查',
    type: 'pitfall',
    layer: 'L2',
    importance: 0.72,
    access_count: 3,
    updated_at: Date.now(),
    created_at: Date.now(),
    locked: false,
    decay_class: 'active',
    source_agent: 'manual',
    sync_state: 'synced',
    ...over,
  } as MemoryRecord;
}

function pagedOf(items: MemoryRecord[]) {
  return { items, total: items.length } as unknown as Parameters<typeof MemoryGrid>[0]['paged'];
}

function renderGrid(items: MemoryRecord[] = [rec()]) {
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onGotoLayer = vi.fn();
  const onToast = vi.fn();
  const onOpenFile = vi.fn();
  const utils = render(
    <MemoryGrid
      paged={pagedOf(items)}
      selectedId={null}
      onSelect={onSelect}
      onOpenFile={onOpenFile}
      canOpenFile
      onRowContext={vi.fn()}
      onEdit={onEdit}
      onDelete={onDelete}
      onGotoLayer={onGotoLayer}
      onToast={onToast}
    />,
  );
  return { ...utils, onSelect, onEdit, onDelete, onGotoLayer, onToast, onOpenFile };
}

describe('记忆库表格 · 列宽拖拽与动作列', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('动作列 = 查看 + 更多；更多菜单含全部真实动作（编辑/复制ID/复制内容/跳分层/打开文件/删除）', () => {
    const h = renderGrid();
    const actions = document.querySelector('[data-testid="memory-row-mem_e2e_1"] .mm-row-actions') as HTMLElement;
    expect(actions.querySelectorAll('button')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('mm-more-mem_e2e_1'));
    const menu = screen.getByTestId('mm-more-menu');
    for (const id of ['mm-more-edit', 'mm-more-copy-id', 'mm-more-copy-content', 'mm-more-goto-layer', 'mm-more-delete']) {
      expect(menu.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }
    expect(menu.textContent).toContain('查看详情');
    expect(menu.textContent).toContain('打开记忆文件');

    fireEvent.click(screen.getByTestId('mm-more-edit'));
    expect(h.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'mem_e2e_1' }));
    // 点菜单项后关闭
    expect(screen.queryByTestId('mm-more-menu')).toBeNull();
  });

  it('复制 ID / 复制内容走真实剪贴板调用；跳分层/删除回调携带真实记录', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const h = renderGrid();

    fireEvent.click(screen.getByTestId('mm-more-mem_e2e_1'));
    fireEvent.click(screen.getByTestId('mm-more-copy-id'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('mem_e2e_1'));

    fireEvent.click(screen.getByTestId('mm-more-mem_e2e_1'));
    fireEvent.click(screen.getByTestId('mm-more-copy-content'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('评审前先跑一遍类型检查'));

    fireEvent.click(screen.getByTestId('mm-more-mem_e2e_1'));
    fireEvent.click(screen.getByTestId('mm-more-goto-layer'));
    expect(h.onGotoLayer).toHaveBeenCalledWith('L2');

    fireEvent.click(screen.getByTestId('mm-more-mem_e2e_1'));
    fireEvent.click(screen.getByTestId('mm-more-delete'));
    expect(h.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'mem_e2e_1' }));
  });

  it('拖拽表头分隔线：列宽变化并持久化，重新挂载（=刷新/切页/重登/重启）后仍生效', () => {
    const h = renderGrid();
    const cols = () => Array.from(document.querySelectorAll('col')).map((c) => (c as HTMLElement).style.width);

    expect(cols()[3]).toBe(`${COL_WIDTHS_DEFAULT[3]}px`);
    const resizer = screen.getByTestId('mm-col-resizer-3');
    fireEvent.pointerDown(resizer, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 160 });
    fireEvent.pointerUp(window);
    expect(cols()[3]).toBe(`${COL_WIDTHS_DEFAULT[3] + 60}px`);

    // 落盘：真实 localStorage + 合法数值
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw as string) as number[];
    expect(saved[3]).toBe(COL_WIDTHS_DEFAULT[3] + 60);
    expect(saved).toHaveLength(COL_WIDTHS_DEFAULT.length);

    // 重新挂载等价于刷新 / 切页回来 / 重登 / 重启：宽度从本地读回
    h.unmount();
    renderGrid();
    expect(cols()[3]).toBe(`${COL_WIDTHS_DEFAULT[3] + 60}px`);
  });

  it('拖拽有真实上下限（44–520），并拒绝损坏的持久化值（回落默认，不写坏账）', () => {
    renderGrid();
    fireEvent.pointerDown(screen.getByTestId('mm-col-resizer-1'), { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: -9999 });
    fireEvent.pointerUp(window);
    expect((document.querySelectorAll('col')[1] as HTMLElement).style.width).toBe('44px');
    fireEvent.pointerDown(screen.getByTestId('mm-col-resizer-1'), { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 9999 });
    fireEvent.pointerUp(window);
    expect((document.querySelectorAll('col')[1] as HTMLElement).style.width).toBe('520px');

    cleanup();
    localStorage.setItem(COL_WIDTHS_KEY, '{"bad":true}');
    renderGrid();
    expect((document.querySelectorAll('col')[1] as HTMLElement).style.width).toBe(`${COL_WIDTHS_DEFAULT[1]}px`);
  });
});
