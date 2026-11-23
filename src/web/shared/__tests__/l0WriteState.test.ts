// shared/l0WriteState：写锁状态的**唯一读取口**。
// 这里只钉「映射是否诚实」：读得到就是 true/false，读不到必须是 null（不许冒充 false）。
import { describe, expect, it, beforeEach, vi } from 'vitest';

const k = vi.hoisted(() => ({ getWriteStatus: vi.fn(), hasL0Channel: undefined as undefined | (() => boolean) }));
vi.mock('../../kernel.ts', () => ({ getKernel: () => ({ getWriteStatus: k.getWriteStatus, get hasL0Channel() { return k.hasL0Channel; } }) }));

import { readL0WriteState } from '../l0WriteState.ts';

describe('readL0WriteState · 写锁状态唯一读取口', () => {
  beforeEach(() => { k.getWriteStatus.mockReset(); k.hasL0Channel = undefined; });

  it('内核说已解锁 → unlocked: true，pending 原样带出，source=kernel', async () => {
    k.getWriteStatus.mockResolvedValue({ l0_unlocked: true, writeDek_present: true, pending_count: 3 });
    await expect(readL0WriteState()).resolves.toEqual({ unlocked: true, pending: 3, source: 'kernel', detail: null });
  });

  it('内核说锁定 → unlocked: false（如实回 false，不是 null）', async () => {
    k.getWriteStatus.mockResolvedValue({ l0_unlocked: false, writeDek_present: false, pending_count: 0 });
    const st = await readL0WriteState();
    expect(st.unlocked).toBe(false);
    expect(st.pending).toBe(0);
  });

  it('内核报错（浏览器 / 宿主桥未就绪）→ unlocked: null + 真实 detail，绝不冒充未解锁', async () => {
    k.getWriteStatus.mockRejectedValue(new Error('宿主桥未就绪'));
    const st = await readL0WriteState();
    expect(st.unlocked).toBeNull();
    expect(st.pending).toBeNull();
    expect(st.source).toBe('unavailable');
    expect(st.detail).toContain('宿主桥未就绪');
  });

  it('内核明确没有 L0 通道 → unavailable，不把退化出来的 false 当成「未解锁」', async () => {
    k.hasL0Channel = () => false;
    k.getWriteStatus.mockResolvedValue({ l0_unlocked: false, writeDek_present: false, pending_count: 0 });
    const st = await readL0WriteState();
    expect(k.getWriteStatus).not.toHaveBeenCalled();
    expect(st.unlocked).toBeNull();
    expect(st.pending).toBeNull();
    expect(st.source).toBe('unavailable');
    expect(st.detail).toContain('无 L0 通道');
  });
});
