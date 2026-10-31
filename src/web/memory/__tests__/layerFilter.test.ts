// 记忆层级管理页 · 每层过滤+分页纯逻辑单测
import { describe, it, expect } from 'vitest';
import { filterLayerPaged, LAYER_DEFAULT_FILTER, LAYER_DEFAULT_PAGE_SIZE, LAYER_PAGE_SIZES } from '../layerFilter.ts';
import { filterMemories } from '../memoryFilter.ts';
import type { MemoryRecord } from '../types.ts';

const base: MemoryRecord = {
  id: 'm1', content: 'hello', type: 'fact', tags: [],
  importance: 0.5, confidence: 0.5, access_count: 1, reinforce_count: 0,
  pinned: false, locked: false, archived: false, status: 'active',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ageDays: 0, halfLifeDays: 30,
};

function rec(over: Partial<MemoryRecord>): MemoryRecord {
  return { ...base, ...over };
}

describe('LAYER_DEFAULT_FILTER / 默认值', () => {
  it('默认每页 5 条、第 1 页、全 all', () => {
    expect(LAYER_DEFAULT_PAGE_SIZE).toBe(5);
    expect(LAYER_PAGE_SIZES).toContain(5);
    expect(LAYER_DEFAULT_FILTER.page).toBe(1);
    expect(LAYER_DEFAULT_FILTER.pageSize).toBe(5);
    expect(LAYER_DEFAULT_FILTER.type).toBe('all');
  });
});

describe('filterLayerPaged', () => {
  it('createdFrom/createdTo 日期区间过滤（层内新增维度）', () => {
    const withTime = [
      rec({ id: 't1', created_at: '2026-01-01T00:00:00.000Z' }),
      rec({ id: 't2', created_at: '2026-06-01T00:00:00.000Z' }),
      rec({ id: 't3', created_at: '2026-09-01T00:00:00.000Z' }),
    ];
    const r = filterLayerPaged(withTime, { ...LAYER_DEFAULT_FILTER, createdFrom: '2026-07-01' }, { page: 1, pageSize: 5 }, () => true);
    expect(r.total).toBe(1);
    expect(r.items.map((x) => x.id)).toEqual(['t3']);
    // 区间两端
    const r2 = filterLayerPaged(withTime, { ...LAYER_DEFAULT_FILTER, createdFrom: '2026-05-01', createdTo: '2026-07-01' }, { page: 1, pageSize: 5 }, () => true);
    expect(r2.items.map((x) => x.id)).toEqual(['t2']);
  });

  const list = [
    rec({ id: 'a', content: '部署 React 应用', type: 'fact', status: 'active' }),
    rec({ id: 'b', content: 'MCP 配置记录', type: 'decision', status: 'archived' }),
    rec({ id: 'c', content: '用户偏好暗色', type: 'preference', status: 'active' }),
    rec({ id: 'd', content: '踩坑：端口冲突', type: 'pitfall', status: 'active' }),
    rec({ id: 'e', content: '项目结构说明', type: 'project', status: 'active' }),
    rec({ id: 'f', content: '反馈：响应快', type: 'feedback', status: 'active' }),
  ];

  it('hasContent=true（全层都有内容）→ 默认每页 5 条', () => {
    const r = filterLayerPaged(list, LAYER_DEFAULT_FILTER, { page: 1, pageSize: 5 }, () => true);
    expect(r.total).toBe(6);
    expect(r.items.length).toBe(5);
    expect(r.totalPages).toBe(2);
    expect(r.page).toBe(1);
  });

  it('第 2 页剩余 1 条', () => {
    const r = filterLayerPaged(list, LAYER_DEFAULT_FILTER, { page: 2, pageSize: 5 }, () => true);
    expect(r.items.length).toBe(1);
    expect(r.total).toBe(6);
  });

  it('hasContent 过滤（只有 3 条有该层内容）→ total=3', () => {
    const onlyA = (m: MemoryRecord) => m.id === 'a' || m.id === 'b' || m.id === 'c';
    const r = filterLayerPaged(list, LAYER_DEFAULT_FILTER, { page: 1, pageSize: 5 }, onlyA);
    expect(r.total).toBe(3);
    expect(r.items.map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('type 过滤 + hasContent 组合', () => {
    const onlyFactPitfall = (m: MemoryRecord) => m.type === 'fact' || m.type === 'pitfall';
    const r = filterLayerPaged(
      list,
      { ...LAYER_DEFAULT_FILTER, type: 'all' },
      { page: 1, pageSize: 5 },
      onlyFactPitfall,
    );
    // a(fact) + d(pitfall) 有内容
    expect(r.total).toBe(2);
  });

  it('search 过滤 + 分页 clamp', () => {
    const r = filterLayerPaged(
      list,
      { ...LAYER_DEFAULT_FILTER, search: '端口' },
      { page: 99, pageSize: 5 },
      () => true,
    );
    expect(r.total).toBe(1); // 只有 d
    expect(r.page).toBe(1); // clamp 到 totalPages=1
    expect(r.items.map((x) => x.id)).toEqual(['d']);
  });

  it('status=archived 过滤', () => {
    const r = filterLayerPaged(
      list,
      { ...LAYER_DEFAULT_FILTER, status: 'archived' },
      { page: 1, pageSize: 5 },
      () => true,
    );
    expect(r.total).toBe(1);
    expect(r.items.map((x) => x.id)).toEqual(['b']);
  });

  it('source=collected 过滤（source_agent 非空且非 manual）', () => {
    const withSrc = [
      rec({ id: 'x', source_agent: 'webhook' }),
      rec({ id: 'y', source_agent: 'manual' }),
      rec({ id: 'z', source_agent: '' }),
    ];
    const r = filterLayerPaged(
      withSrc,
      { ...LAYER_DEFAULT_FILTER, source: 'collected' },
      { page: 1, pageSize: 5 },
      () => true,
    );
    expect(r.total).toBe(1);
    expect(r.items.map((x) => x.id)).toEqual(['x']);
  });

  it('hasContent=false 全层无内容 → total=0, items=[]', () => {
    const r = filterLayerPaged(list, LAYER_DEFAULT_FILTER, { page: 1, pageSize: 5 }, () => false);
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.items).toEqual([]);
  });

  it('createdFrom 时间过滤 + 分页（层内过滤维度复用 memoryFilter）', () => {
    const withTime = [
      rec({ id: 't1', created_at: '2026-01-01T00:00:00.000Z' }),
      rec({ id: 't2', created_at: '2026-06-01T00:00:00.000Z' }),
      rec({ id: 't3', created_at: '2026-09-01T00:00:00.000Z' }),
    ];
    // LayerFilterState 无 createdFrom，直接走 memoryFilter 维度验证时间过滤可用
    const r = filterMemories(withTime, { createdFrom: '2026-07-01' });
    expect(r.length).toBe(1);
    expect(r.map((x) => x.id)).toEqual(['t3']);
  });
});
