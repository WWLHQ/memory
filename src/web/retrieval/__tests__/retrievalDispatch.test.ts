// A6（消除第三套口径）：检索页的模式 / 命中词 / 次模式必须取内核 RecallResult，不得本地再算一遍。
// 断言口径：banner 与内核 dispatch 逐字段一致；history_query 原样下传；无次模式时不得编造提示。
import { describe, it, expect, beforeEach } from 'vitest';
import { coreEngine } from '../coreEngine.ts';
import { getKernelWithSeed, resetKernelForTests } from '../../kernel.ts';

const HIT = { content: '架构选型记录：内核缓存分层', category: 'fact', project_id: 'P-a' } as const;

describe('A6 · banner 读内核分流事实', () => {
  beforeEach(() => resetKernelForTests());

  it('自动档：banner.mode / hit_keywords / dispatch 与内核一致', async () => {
    await getKernelWithSeed()._seedMemory(HIT);
    const r = await coreEngine('架构选型怎么定', 'task_start', null, 'req_a6_auto');
    expect(r.banner.mode).toBe('top_insight');
    expect(r.banner.hit_keywords).toEqual(['架构', '选型']);
    expect(r.banner.dispatch).toMatchObject({ source: 'auto', suggested: 'top_insight', applied: 'top_insight' });
    expect(r.banner.fallback).toBe(true);
  });

  it('手动档：banner 标注用户指定，且不产生分流关键词', async () => {
    await getKernelWithSeed()._seedMemory(HIT);
    const r = await coreEngine('架构选型怎么定', 'task_start', 'fact_first', 'req_a6_manual');
    expect(r.banner.mode).toBe('fact_first');
    expect(r.banner.hit_keywords).toEqual([]);
    expect(r.banner.dispatch).toMatchObject({ source: 'manual', applied: 'fact_first', weights_source: 'manual' });
    expect(r.banner.fallback).toBe(false);
  });

  it('history_query 原样下传：只有事件复盘能命中的查询，不得回落到 default 候选集', async () => {
    await getKernelWithSeed()._seedMemory(HIT);
    const r = await coreEngine('复盘', 'history_query', null, 'req_a6_hq');
    // 旧实现把 history_query 降级成 default，该查询会走「零命中 + 短查询」→ minimal/auto
    expect(r.banner.mode).toBe('event_replay');
    expect(r.banner.dispatch?.suggested).toBe('event_replay');
  });

  it('次模式提示取内核真值；内核没有次模式时为 null（不再硬编码「极简 200t」）', async () => {
    const ma = getKernelWithSeed();
    // 次模式只从「没进命中」的池里挑：先灌满 5 条强命中，再留一条不会被选中的 L2 背景
    for (let i = 0; i < 5; i += 1) {
      await ma._seedMemory({ content: `复盘报错日志记录第${i}条：构建失败排查经过`, category: 'fact', project_id: 'P-a' });
    }
    await ma._seedMemory({
      content: '与本次查询无关的长期背景：桌面端安装包存放路径约定', category: 'context', project_id: 'P-a',
      layer: 'L2', decay_class: 'warm',
    });
    const withSecondary = await coreEngine('复盘 报错 日志', 'history_query', null, 'req_a6_sec');
    expect(withSecondary.banner.mode).toBe('fact_first');
    expect(withSecondary.banner.secondary_mode_hint?.mode).toBe('event_replay');
    expect(withSecondary.banner.secondary_mode_hint?.content).toContain('安装包');

    const withoutSecondary = await coreEngine('报错 日志', 'critical', null, 'req_a6_nosec');
    expect(withoutSecondary.banner.mode).toBe('fact_first');
    expect(withoutSecondary.banner.secondary_mode_hint).toBeNull();
  });
});
