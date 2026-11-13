// statusbar.loadL0Write：把 shared/l0WriteState 的中性结果映射成状态栏单元格。
// 要点：读得到才给 ok；读不到必须 unavailable 并带上真实 detail，不能把 null 折成 false。
import { describe, expect, it, beforeEach, vi } from 'vitest';

const m = vi.hoisted(() => ({ readL0WriteState: vi.fn() }));
vi.mock('../../shared/l0WriteState.ts', () => ({ readL0WriteState: m.readL0WriteState, onL0WriteStateChanged: () => () => {} }));

import { loadL0Write } from '../statusbar.ts';

describe('loadL0Write · 写锁单元格', () => {
  beforeEach(() => m.readL0WriteState.mockReset());

  it('已解锁 → ok + unlocked:true + pending 原样', async () => {
    m.readL0WriteState.mockResolvedValue({ unlocked: true, pending: 2, source: 'kernel', detail: null });
    await expect(loadL0Write()).resolves.toEqual({ status: 'ok', view: { unlocked: true, pending: 2 } });
  });

  it('锁定 → ok + unlocked:false（真值就是 false，不是不可用）', async () => {
    m.readL0WriteState.mockResolvedValue({ unlocked: false, pending: 0, source: 'kernel', detail: null });
    await expect(loadL0Write()).resolves.toEqual({ status: 'ok', view: { unlocked: false, pending: 0 } });
  });

  it('读不到 → unavailable，并说明原因（不冒充未解锁）', async () => {
    m.readL0WriteState.mockResolvedValue({ unlocked: null, pending: null, source: 'unavailable', detail: '宿主桥未就绪' });
    const r = await loadL0Write();
    expect(r.status).toBe('unavailable');
    expect(r.status === 'unavailable' && r.detail).toContain('宿主桥未就绪');
  });
});
