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
    mcpSwitch: { status: 'ok', view: { id: '', name: '', disabled: false, conflict: 0, invalid: 0 } },
    webIssue: { status: 'ok', view: { needRelogin: 0, failed: 0 } },
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

  it('T3：客户端确实被禁用 → 产出需要关注的 mcp-switch 条目', () => {
    const src = toNavStatusSource(snap({
      mcpSwitch: { status: 'ok', view: { id: 'workbuddy', name: 'WorkBuddy', disabled: true, conflict: 0, invalid: 0 } },
    }));
    expect(src.mcpSwitch).toEqual({ name: 'WorkBuddy' });
    expect(buildNavStatus(src)).toEqual([
      { key: 'mcp-switch', label: 'WorkBuddy MCP 开关已关闭', tone: 'warn' },
    ]);
  });

  it('T3：客户端配置读不到 / 没禁用 → 不产出条目（不冒充状态）', () => {
    const unread = toNavStatusSource(snap({ mcpSwitch: { status: 'unavailable', detail: '浏览器模式' } }));
    expect(unread.mcpSwitch).toBeUndefined();
    expect(unread.mcpIssue).toBeUndefined();  // 读不到异常也不报
    expect(buildNavStatus(unread)).toEqual([]);
    const ok = toNavStatusSource(snap());
    expect(ok.mcpSwitch).toBeUndefined();
    expect(buildNavStatus(ok)).toEqual([]);
  });

  it('2026-11-24：MCP 配置异常（冲突/解析失败）穿透到 mcp-issue 条目', () => {
    const src = toNavStatusSource(snap({
      mcpSwitch: { status: 'ok', view: { id: '', name: '', disabled: false, conflict: 1, invalid: 2 } },
    }));
    expect(src.mcpIssue).toEqual({ conflict: 1, invalid: 2 });
    const items = buildNavStatus(src);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      key: 'mcp-issue',
      label: 'MCP 接入 3 项配置异常（冲突 1 · 配置错误 2）',
      tone: 'warn', count: 3,
    });
  });

  it('2026-11-24：网页接入异常（需重新登录/失败）穿透到 web-issue 条目', () => {
    const src = toNavStatusSource(snap({
      webIssue: { status: 'ok', view: { needRelogin: 2, failed: 3 } },
    }));
    expect(src.webIssue).toEqual({ needRelogin: 2, failed: 3 });
    expect(buildNavStatus(src)).toEqual([
      { key: 'web-issue', label: '网页接入 5 站需处理（重新登录 2 · 失败 3）', tone: 'warn', count: 5 },
    ]);
  });

  it('2026-11-24：网页状态读不到 → 不产出条目；真实 0 → 也不产出', () => {
    const unread = toNavStatusSource(snap({ webIssue: { status: 'error', detail: '无会话' } }));
    expect(unread.webIssue).toBeUndefined();
    expect(buildNavStatus(unread)).toEqual([]);
    expect(buildNavStatus(toNavStatusSource(snap()))).toEqual([]);
  });
});
