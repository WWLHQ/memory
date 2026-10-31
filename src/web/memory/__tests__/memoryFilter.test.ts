// 记忆管理页（REQ-006 / P8）· 过滤 + 分页纯逻辑单测
import { describe, it, expect } from 'vitest';
import { filterMemories, filterAndPaged, isCollected } from '../memoryFilter.ts';
import type { MemoryRecord } from '../types.ts';

const base: MemoryRecord = {
  id: 'm1', content: '前端部署', type: 'fact', tags: ['deploy'],
  importance: 0.5, confidence: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, archived: false, status: 'active',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ageDays: 0, halfLifeDays: 30,
};

function rec(over: Partial<MemoryRecord>): MemoryRecord {
  return { ...base, ...over };
}

describe('isCollected', () => {
  it('source_agent 非空且非 manual → 采集', () => {
    expect(isCollected(rec({ source_agent: 'webhook' }))).toBe(true);
    expect(isCollected(rec({ source_agent: 'collector:claude-code' }))).toBe(true);
  });
  it('manual / 空 → 非采集', () => {
    expect(isCollected(rec({ source_agent: 'manual' }))).toBe(false);
    expect(isCollected(rec({}))).toBe(false);
  });
});

describe('filterMemories', () => {
  const list = [
    rec({ id: 'a', content: 'React 部署', type: 'fact', tags: ['react'], status: 'active', source_agent: 'webhook' }),
    rec({ id: 'b', content: 'MCP 配置', type: 'decision', tags: ['mcp'], status: 'archived', source_agent: 'mcp' }),
    rec({ id: 'c', content: '用户偏好暗色', type: 'preference', tags: ['theme'], status: 'active' }),
    rec({ id: 'd', content: '踩坑记录', type: 'pitfall', tags: ['bug'], status: 'stale', source_agent: 'manual' }),
  ];

  it('search 匹配 content / id / tags（大小写不敏感）', () => {
    expect(filterMemories(list, { search: 'react' }).map((r) => r.id)).toEqual(['a']);
    expect(filterMemories(list, { search: 'MCP' }).map((r) => r.id)).toEqual(['b']); // id 或 content 或 tag
    expect(filterMemories(list, { search: 'bug' }).map((r) => r.id)).toEqual(['d']); // tag
    expect(filterMemories(list, { search: '不存在' }).length).toBe(0);
  });

  it('type 过滤', () => {
    expect(filterMemories(list, { type: 'fact' }).map((r) => r.id)).toEqual(['a']);
    expect(filterMemories(list, { type: 'pitfall' }).map((r) => r.id)).toEqual(['d']);
    expect(filterMemories(list, { type: 'all' }).length).toBe(4); // all 不过滤
  });

  it('status 过滤', () => {
    expect(filterMemories(list, { status: 'active' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterMemories(list, { status: 'archived' }).map((r) => r.id)).toEqual(['b']);
  });

  it('source 过滤：all / collected / manual / 具体来源', () => {
    expect(filterMemories(list, { source: 'all' }).length).toBe(4);
    expect(filterMemories(list, { source: 'collected' }).map((r) => r.id)).toEqual(['a', 'b']); // webhook + mcp
    expect(filterMemories(list, { source: 'manual' }).map((r) => r.id)).toEqual(['c', 'd']); // 无 source_agent + manual
    expect(filterMemories(list, { source: 'webhook' }).map((r) => r.id)).toEqual(['a']);
    expect(filterMemories(list, { source: 'mcp' }).map((r) => r.id)).toEqual(['b']);
  });

  it('多维度 AND 组合', () => {
    expect(filterMemories(list, { search: 'MCP', type: 'decision' }).map((r) => r.id)).toEqual(['b']);
    expect(filterMemories(list, { type: 'fact', status: 'active', source: 'collected' }).map((r) => r.id)).toEqual(['a']);
    expect(filterMemories(list, { type: 'fact', status: 'archived' }).length).toBe(0); // a 是 active 非 archived
  });

  it('createdFrom / createdTo 创建时间区间过滤（闭区间）', () => {
    const d = [
      rec({ id: 'd1', created_at: '2026-01-01T00:00:00.000Z' }),
      rec({ id: 'd2', created_at: '2026-03-15T00:00:00.000Z' }),
      rec({ id: 'd3', created_at: '2026-06-01T00:00:00.000Z' }),
      rec({ id: 'd4', created_at: '2026-09-20T00:00:00.000Z' }),
    ];
    // 只取 3 月 1 日 ~ 6 月 30 日
    expect(filterMemories(d, { createdFrom: '2026-03-01', createdTo: '2026-06-30' }).map((r) => r.id))
      .toEqual(['d2', 'd3']);
    // 只取起点（≥ 6 月 1 日）
    expect(filterMemories(d, { createdFrom: '2026-06-01' }).map((r) => r.id))
      .toEqual(['d3', 'd4']);
    // 只取终点（≤ 3 月 15 日）
    expect(filterMemories(d, { createdTo: '2026-03-15' }).map((r) => r.id))
      .toEqual(['d1', 'd2']);
    // 空条件不过滤
    expect(filterMemories(d, {}).length).toBe(4);
    // 时间区间 + 类型组合
    expect(filterMemories(d, { createdFrom: '2026-06-01', type: 'all' }).map((r) => r.id))
      .toEqual(['d3', 'd4']);
  });

  it('空条件返回全量（不改原数组）', () => {
    const out = filterMemories(list, {});
    expect(out.length).toBe(4);
    expect(out).not.toBe(list); // 浅拷贝或新数组（filter 总返回新数组）
  });
});

describe('filterAndPaged', () => {
  const list = [
    rec({ id: 'p1', content: '第一条', confidence: 0.9, pinned: false }),
    rec({ id: 'p2', content: '第二条', confidence: 0.8, pinned: true }),
    rec({ id: 'p3', content: '第三条', confidence: 0.7 }),
    rec({ id: 'p4', content: '踩坑记录', confidence: 0.6 }),
    rec({ id: 'p5', content: '第五条', confidence: 0.5 }),
    rec({ id: 'p6', content: '第六条', confidence: 0.4 }),
  ];

  it('排序 + 分页：pinned 置顶，每页 2 条', () => {
    // 排序后：p2(pinned) → p1(0.9) → p3(0.7) → p4(0.6) → p5(0.5) → p6(0.4)
    const r1 = filterAndPaged(list, {}, { page: 1, pageSize: 2 });
    expect(r1.items.map((r) => r.id)).toEqual(['p2', 'p1']);
    expect(r1.total).toBe(6);
    expect(r1.totalPages).toBe(3);
    expect(r1.page).toBe(1);

    const r2 = filterAndPaged(list, {}, { page: 2, pageSize: 2 });
    expect(r2.items.map((r) => r.id)).toEqual(['p3', 'p4']);

    const r3 = filterAndPaged(list, {}, { page: 3, pageSize: 2 });
    expect(r3.items.map((r) => r.id)).toEqual(['p5', 'p6']);
  });

  it('pageSize 非法值 clamp（0/负 → 1）', () => {
    const r = filterAndPaged(list, {}, { page: 1, pageSize: 0 });
    expect(r.pageSize).toBe(1);
    expect(r.totalPages).toBe(6); // 6 条 / 每页 1
    expect(r.items.length).toBe(1);
  });

  it('page 越界 clamp（>totalPages → 末页；<1 → 第 1 页）', () => {
    const rBig = filterAndPaged(list, {}, { page: 99, pageSize: 2 });
    expect(rBig.page).toBe(3); // clamp 到 totalPages
    expect(rBig.items.map((r) => r.id)).toEqual(['p5', 'p6']);

    const rSmall = filterAndPaged(list, {}, { page: 0, pageSize: 2 });
    expect(rSmall.page).toBe(1);
  });

  it('过滤后为空 → totalPages=1, items=[]', () => {
    const r = filterAndPaged(list, { type: 'decision' }, { page: 1, pageSize: 2 });
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.items).toEqual([]);
  });

  it('过滤 + 分页组合（search 命中单条，page 越界 clamp 回 1）', () => {
    // p4 的 content='踩坑记录' → 唯一命中，totalPages=1，page=2 越界 → clamp 回 1
    const r = filterAndPaged(list, { search: '踩坑记录' }, { page: 2, pageSize: 1 });
    expect(r.total).toBe(1);
    expect(r.page).toBe(1);
    expect(r.items.map((r) => r.id)).toEqual(['p4']);
  });
});
