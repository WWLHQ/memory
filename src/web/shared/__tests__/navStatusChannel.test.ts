// REQ-014 / T6（C8）：侧栏真实状态回传通道契约测试。
// 重点：读不到就**不产出**条目（不拿 0 / 'idle' 冒充成功读数）、非法条目只丢该条、
// 顶层窗口空操作、嵌入窗口同源回传。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NAV_STATUS_MSG, buildNavStatus, parseNavStatus, publishNavStatus,
} from '../navStatusChannel.ts';
import type { NavStatusItem } from '../navStatusChannel.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('REQ-014 T6 · parseNavStatus（外部消息校验）', () => {
  it('合法包原样解析，计数取整', () => {
    const p = parseNavStatus({ v: 1, at: 1234, items: [{ key: 'refine', label: '精炼队列 3 条', tone: 'busy', count: 3.7 }] });
    expect(p).toEqual({ v: 1, at: 1234, items: [{ key: 'refine', label: '精炼队列 3 条', tone: 'busy', count: 3 }] });
  });

  it('版本不符 / 缺 items / at 非法 → null（不猜）', () => {
    expect(parseNavStatus({ v: 2, at: 1, items: [] })).toBeNull();
    expect(parseNavStatus({ v: 1, at: 1 })).toBeNull();
    expect(parseNavStatus({ v: 1, at: 0, items: [] })).toBeNull();
    expect(parseNavStatus({ v: 1, at: Number.NaN, items: [] })).toBeNull();
    expect(parseNavStatus(null)).toBeNull();
  });

  it('单条非法只丢该条，其余条目保留（一条脏数据不该清空状态区）', () => {
    const p = parseNavStatus({
      v: 1, at: 9,
      items: [
        { key: 'ok', label: '采集进行中', tone: 'busy' },
        { key: '', label: 'x', tone: 'busy' },
        { key: 'badtone', label: 'x', tone: 'weird' },
        { key: 'nolabel', tone: 'busy' },
        { key: 'neg', label: 'x', tone: 'warn', count: -1 },
      ],
    });
    expect(p!.items).toHaveLength(2);
    expect(p!.items[0].key).toBe('ok');
    expect(p!.items[1]).toEqual({ key: 'neg', label: 'x', tone: 'warn' });  // 负数计数被丢弃，条目仍在
  });
});

describe('REQ-014 T6 · publishNavStatus（回传）', () => {
  const postMessage = vi.fn();
  const ORIGIN = 'http://127.0.0.1:6000';

  it('顶层窗口（非嵌入）→ 空操作，不发消息', () => {
    const top = { parent: null as unknown, location: { origin: ORIGIN } };
    top.parent = top;   // 自引用 = 顶层
    publishNavStatus([{ key: 'refine', label: '精炼进行中', tone: 'busy' }], 100, top);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('无 window（Node 环境）→ 空操作不抛错', () => {
    expect(() => publishNavStatus([], 1, null)).not.toThrow();
  });

  it('嵌入窗口 → 向父窗口同源回传 {NAV_STATUS_MSG: payload}', () => {
    const items: NavStatusItem[] = [{ key: 'collector', label: '采集进行中', tone: 'busy' }];
    const child = {
      parent: { postMessage },
      location: { origin: ORIGIN },
    };
    publishNavStatus(items, 777, child);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg, origin] = postMessage.mock.calls[0];
    expect(origin).toBe(ORIGIN);      // 同源，绝不写 '*'
    expect(msg[NAV_STATUS_MSG]).toEqual({ v: 1, at: 777, items });
  });
});

describe('REQ-014 T6 · buildNavStatus（真实状态 → 条目）', () => {
  it('什么都没读到 → 空数组（壳层不显示状态区，不拿"空闲"冒充）', () => {
    expect(buildNavStatus({})).toEqual([]);
    expect(buildNavStatus({ collector: {}, pendingWrites: {}, refine: {}, sync: {} })).toEqual([]);
  });

  it('写入兜底积压 → warn + 计数（pending ≠ 成功）', () => {
    expect(buildNavStatus({ pendingWrites: { count: 2 } })).toEqual([
      { key: 'l0-pending', label: '写入兜底 2 条待解冻', tone: 'warn', count: 2 },
    ]);
    expect(buildNavStatus({ pendingWrites: { count: 0 } })).toEqual([]);  // 0 不出条目
  });

  it('精炼：running 优先于 queued；只有 queued 时给计数', () => {
    expect(buildNavStatus({ refine: { running: true, queued: 5 } })).toEqual([
      { key: 'refine', label: '精炼进行中', tone: 'busy' },
    ]);
    expect(buildNavStatus({ refine: { queued: 5 } })).toEqual([
      { key: 'refine', label: '精炼队列 5 条', tone: 'busy', count: 5 },
    ]);
  });

  it('采集：运行中 / 停自动重试 / 连续失败 ≥3 轮 三态互斥', () => {
    expect(buildNavStatus({ collector: { running: true, autoRetryStopped: true } })[0].label).toBe('采集进行中');
    expect(buildNavStatus({ collector: { running: false, autoRetryStopped: true } })[0]).toEqual({
      key: 'collector', label: '采集已停自动重试', tone: 'warn',
    });
    expect(buildNavStatus({ collector: { running: false, consecutiveFails: 4 } })[0].label).toBe('采集连续失败 4 轮');
    expect(buildNavStatus({ collector: { running: false, consecutiveFails: 2 } })).toEqual([]);  // <3 不报
  });

  it('同步：进行中优先，其次上次失败', () => {
    expect(buildNavStatus({ sync: { active: true, lastError: 'x' } })[0]).toEqual({ key: 'sync', label: '同步进行中', tone: 'busy' });
    expect(buildNavStatus({ sync: { active: false, lastError: 'timeout' } })[0]).toEqual({ key: 'sync', label: '上次同步失败', tone: 'warn' });
    expect(buildNavStatus({ sync: { lastError: '' } })).toEqual([]);   // 空串不是失败
  });

  it('多来源并发：四条按固定顺序产出，key 稳定可用于壳层布局', () => {
    const items = buildNavStatus({
      pendingWrites: { count: 1 },
      refine: { queued: 2 },
      collector: { running: true },
      sync: { active: true },
    });
    expect(items.map((i) => i.key)).toEqual(['l0-pending', 'refine', 'collector', 'sync']);
    expect(items.map((i) => i.tone)).toEqual(['warn', 'busy', 'busy', 'busy']);
  });

  it('T4 加固 · 客户端 MCP 开关：真实读到已禁用 → 产出 warn 条目且 label 含客户端名', () => {
    const items = buildNavStatus({ mcpSwitch: { name: 'WorkBuddy' } });
    expect(items).toContainEqual({ key: 'mcp-switch', label: 'WorkBuddy MCP 开关已关闭', tone: 'warn' });
  });

  it('① 待生效：pending=true → 条目标题变「已清除，待生效」而不是「已关闭」', () => {
    const items = buildNavStatus({ mcpSwitch: { name: 'Trae Code CN', pending: true } });
    expect(items).toContainEqual({ key: 'mcp-switch', label: 'Trae Code CN MCP 已清除，待生效', tone: 'warn' });
  });

  it('T4 加固 · 读不到 / 未禁用 → 不产任何 mcp-switch 条目（不冒充已连接）', () => {
    expect(buildNavStatus({})).not.toContainEqual(expect.objectContaining({ key: 'mcp-switch' }));
    expect(buildNavStatus({ mcpSwitch: null })).not.toContainEqual(expect.objectContaining({ key: 'mcp-switch' }));
    expect(buildNavStatus({ mcpSwitch: { name: '' } })).not.toContainEqual(expect.objectContaining({ key: 'mcp-switch' }));
  });

  it('T4 加固 · 与其它来源共存时 mcp-switch 固定在最后（顺序稳定）', () => {
    const items = buildNavStatus({
      pendingWrites: { count: 1 },
      refine: { queued: 2 },
      collector: { running: true },
      mcpSwitch: { name: 'WorkBuddy' },
    });
    expect(items.map((i) => i.key)).toEqual(['l0-pending', 'refine', 'collector', 'mcp-switch']);
  });

  // 2026-11-24 新增：MCP / 网页接入异常
  it('2026-11-24 · MCP 配置异常：任一项 >0 才产出，计数汇总、文案只列读到的两类', () => {
    const items = buildNavStatus({ mcpIssue: { conflict: 0, invalid: 3 } });
    expect(items).toContainEqual({
      key: 'mcp-issue', label: 'MCP 接入 3 项配置异常（冲突 0 · 配置错误 3）', tone: 'warn', count: 3,
    });
    expect(buildNavStatus({ mcpIssue: { conflict: 0, invalid: 0 } })).toEqual([]);
    expect(buildNavStatus({ mcpIssue: {} })).toEqual([]);
    expect(buildNavStatus({ mcpIssue: null })).toEqual([]);
  });

  it('2026-11-24 · 网页异常：重新登录/失败合计，0 与读不到都不产出', () => {
    const items = buildNavStatus({ webIssue: { needRelogin: 2, failed: 3 } });
    expect(items).toContainEqual({
      key: 'web-issue', label: '网页接入 5 站需处理（重新登录 2 · 失败 3）', tone: 'warn', count: 5,
    });
    expect(buildNavStatus({ webIssue: { needRelogin: 0, failed: 0 } })).toEqual([]);
    expect(buildNavStatus({ webIssue: null })).toEqual([]);
  });

  it('2026-11-24 · 两类接入异常与 mcp-switch 可共存，顺序为 mcp-switch → mcp-issue → web-issue', () => {
    const items = buildNavStatus({
      mcpSwitch: { name: 'Trae', pending: true },
      mcpIssue: { conflict: 1, invalid: 0 },
      webIssue: { needRelogin: 1, failed: 0 },
    });
    expect(items.map((i) => i.key)).toEqual(['mcp-switch', 'mcp-issue', 'web-issue']);
  });
});
