// 批次42 阶段2 · Gate C 变异验证（2-C）
// 目的：锁定 WritePage 的 session_id 由 newRequestId('sess') 真实生成，不得回退演示值 's1'。
// 变异算子：把 session_id 写死为 's1' → 本文件断言 not.toBe('s1') 必失败，变异被「杀死」。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WritePage } from '../WritePage.tsx';
import { resetKernelForTests, setKernelL0ForTests } from '../../kernel.ts';
import { createTestVault } from '../../../core/memagent/__tests__/l0Kit.ts';
import * as coreWriteMod from '../coreWrite.ts';

vi.mock('../coreWrite.ts', () => ({
  coreWrite: vi.fn(async () => ({
    dedup_action: 'create',
    mem_id: 'mem_test',
    layers: {},
    sim: 1,
    refined_by: 'stub',
  })),
  coreListExisting: vi.fn(async () => []),
}));

const typedCoreWrite = coreWriteMod.coreWrite as ReturnType<typeof vi.fn>;

describe('WritePage session_id 真实唯一（Gate C 变异验证）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetKernelForTests();
    const { vault } = await createTestVault();
    setKernelL0ForTests({ l0: vault, l0Admin: vault });
  });

  it('session_id 由 newRequestId 生成（非演示值 s1，且格式为 sess_ 前缀）', async () => {
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: 'session 唯一性验证内容' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(typedCoreWrite).toHaveBeenCalled());
    const callArg = typedCoreWrite.mock.calls[0]![0];
    expect(callArg.session_id).not.toBe('s1');
    expect(callArg.session_id).toMatch(/^sess_/);
  });

  it('两个独立 WritePage 实例 session_id 不同', async () => {
    const { unmount } = render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '第一次写入内容' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(typedCoreWrite).toHaveBeenCalled());
    const id1 = typedCoreWrite.mock.calls[0]![0].session_id;
    unmount();
    vi.clearAllMocks();
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '第二次写入内容' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(typedCoreWrite).toHaveBeenCalled());
    const id2 = typedCoreWrite.mock.calls[0]![0].session_id;
    expect(id1).not.toBe(id2);
  });
});
