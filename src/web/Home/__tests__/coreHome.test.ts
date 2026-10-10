// coreHome 溯源查询验收：按 request_id 过滤 home 账本 + 后端不在时安全空
import { describe, expect, it, vi } from 'vitest';
import { coreTraceLookup } from '../coreHome.ts';

describe('coreTraceLookup（首页 .rid 溯源真查 home 账本）', () => {
  it('命中条目按 request_id 过滤并映射字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { seq: 1, source: 'params', action: 'params_save', request_id: 'req_a' },
          { seq: 2, source: 'growth', action: 'weight_tuned', request_id: 'req_b' },
          { seq: 3, source: 'growth', action: 'schedule_changed', request_id: 'req_a' },
          { source: 'bad' }, // 缺字段容错
        ],
        total: 4,
      }),
    })));
    const hits = await coreTraceLookup('req_a');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ source: 'params', action: 'params_save', request_id: 'req_a', seq: 1 });
    vi.unstubAllGlobals();
  });

  it('后端不在（mirrorBackendUrl 空串）→ 空数组不抛', async () => {
    // location 未定义分支在 jsdom 有 location；用 ?backend= 空覆盖模拟关闭后端
    const url = new URL(location.href);
    url.searchParams.set('backend', ' ');
    history.replaceState(null, '', url.toString());
    const hits = await coreTraceLookup('req_x');
    expect(hits).toEqual([]);
    history.replaceState(null, '', location.pathname);
  });
});
