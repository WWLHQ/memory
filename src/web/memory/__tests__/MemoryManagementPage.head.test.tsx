// v5 页头（批次 B）验收：记忆库页必须有 p0-pagehead（20px 标题 + tagline + 分隔符元信息行），
// 元信息条数取真实账本（不注入演示数据）；表底用 p0-pager 数字窗口；页签条保持 vtab 结构。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryManagementPage } from '../MemoryManagementPage.tsx';
import { getStorage } from '../coreMemoryOps.ts';
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
  const storage = getStorage();
  for (const m of await storage.listMemories({})) {
    await storage.deleteMemory(m.mem_id);
  }
});

describe('MemoryManagementPage v5 页头（批次 B）', () => {
  it('渲染 p0-pagehead：标题「记忆库」+ 元信息行条数 = 真实账本条数', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'mem_v5_1', content: 'v5 页头验证 A' }));
    await storage.putMemory(mem({ mem_id: 'mem_v5_2', content: 'v5 页头验证 B' }));

    render(<MemoryManagementPage />);
    const head = await waitFor(() => {
      const el = screen.getByTestId('mm-head');
      expect(el.textContent).toContain('记忆库');
      return el;
    });
    expect(screen.getByTestId('mm-head-count').textContent).toContain('2 条记忆');
    // 2026-11-22：删掉 tagline，标题下只剩一行真实读数（不再有第二行元信息，也不留空行）
    expect(head.querySelector('.p0-tagline')).toBeNull();
    expect(head.querySelector('.p0-ph-meta')).toBeNull();
    const truth = screen.getByTestId('mm-truthline');
    for (const t of ['2 条记忆', '账本', '会话', 'L0', '冲突', '快照']) {
      expect(truth.textContent).toContain(t);
    }
    expect(truth.textContent).not.toContain('六个视图同源');
    // 右侧主操作：刷新 + 新建记忆
    expect(screen.getByText('新建记忆')).toBeInTheDocument();
  });

  it('空账本 → 页头条数如实为 0 条（不伪造）', async () => {
    render(<MemoryManagementPage />);
    await waitFor(() => expect(screen.getByTestId('mm-head-count').textContent).toContain('0 条记忆'));
  });

  it('表底 pager：数字窗口渲染当前页（.on 高亮）且 ‹ › 可用', async () => {
    const storage = getStorage();
    for (let i = 0; i < 3; i++) {
      await storage.putMemory(mem({ mem_id: `mem_v5_p${i}`, content: `v5 分页验证 ${i}` }));
    }
    render(<MemoryManagementPage />);
    await waitFor(() => expect(screen.getByTestId('mm-head-count').textContent).toContain('3 条记忆'));
    await waitFor(() => expect(screen.getByTestId('mm-page-1')).toBeInTheDocument());
    expect(screen.getByTestId('mm-page-1').className).toContain('on');
    expect(screen.getByTestId('mm-page-prev')).toBeDisabled();
    expect(screen.getByTestId('mm-page-next')).toBeDisabled();
  });
});
