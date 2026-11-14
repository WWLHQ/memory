// REQ-014 / T7（C8）：侧栏状态卡的数据映射与轮询口径。
// 重点：读不到的来源必须留空（不产出状态项），而不是被当成"空闲"或 0。
import { describe, expect, it } from 'vitest';
import { SHELL_STATUS_POLL_MS, toNavStatusSource, type ShellStatusSnapshot } from '../shellStatus.ts';
import { buildNavStatus } from '../../shared/navStatusChannel.ts';

const collectorOk = (over: Partial<{ running: boolean; autoRetryStopped: boolean; consecutiveFails: number | null }> = {}) => ({
  status: 'ok' as const,
  view: {
    running: false,
    intervalMs: 300_000,
    lastAt: 1,
    lastCollected: 3,
    autoRetryStopped: false,
    consecutiveFails: null,
    ...over,
  },
});

function snap(p: Partial<ShellStatusSnapshot> = {}): ShellStatusSnapshot {
  return {
    pendingWrites: { status: 'ok', view: 0 },
    refine: { status: 'ok', view: { pending: 0, failed: 0, enabled: true } },
    collector: collectorOk(),
    ...p,
  };
}

describe('REQ-014 T7 · toNavStatusSource（读不到就不进状态源）', () => {
  it('三源都 ok 但都空闲 → 状态源齐全但 buildNavStatus 不产出条目', () => {
    const src = toNavStatusSource(snap());
    expect(src.pendingWrites).toEqual({ count: 0 });
    expect(src.collector?.running).toBe(false);
    expect(buildNavStatus(src)).toEqual([]);
  });

  it('unavailable / error 的来源留 undefined（不拿 0 冒充"队列为空"）', () => {
    const src = toNavStatusSource(snap({
      pendingWrites: { status: 'unavailable', detail: '未登录' },
      refine: { status: 'error', detail: '主进程未返回 ok' },
      collector: { status: 'error', detail: 'bridge down' },
    }));
    expect(src.pendingWrites).toBeUndefined();
    expect(src.refine).toBeUndefined();
    expect(src.collector).toBeUndefined();
    expect(buildNavStatus(src)).toEqual([]);
  });

  it('真实积压/排队/失败能穿透到状态项', () => {
    const src = toNavStatusSource(snap({
      pendingWrites: { status: 'ok', view: 2 },
      refine: { status: 'ok', view: { pending: 5, failed: 0, enabled: true } },
      collector: collectorOk({ autoRetryStopped: true }),
    }));
    expect(buildNavStatus(src).map((i) => i.key)).toEqual(['l0-pending', 'refine', 'collector']);
  });

  it('collector 的 consecutiveFails=null 不产出"连续失败"条目', () => {
    const src = toNavStatusSource(snap({ collector: collectorOk({ consecutiveFails: null }) }));
    expect(buildNavStatus(src)).toEqual([]);
  });

  it('轮询间隔在 10–15s 区间（轻量轮询，不是 25s 长轮询）', () => {
    expect(SHELL_STATUS_POLL_MS).toBeGreaterThanOrEqual(10_000);
    expect(SHELL_STATUS_POLL_MS).toBeLessThanOrEqual(15_000);
    expect(SHELL_STATUS_POLL_MS).not.toBe(25_000);
  });
});
