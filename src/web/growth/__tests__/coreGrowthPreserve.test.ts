// 7.2 回归：页面保存生长配置**不得**抹掉 mode_dispatch 快照。
// 背景：生长页没有分流快照的输入口（只有进化轮/采纳通道写），若 coreSaveGrowthConfig 不继承它，
// 用户随手点一次「保存进化设置」就会把刚采纳的分流词表静默退回内核基线（无任何提示）。
import { describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { growthConfigFromLedger, saveGrowthConfigToLedger } from '../../../core/memagent/paramsSnapshot.ts';
import { dispatchBaseline } from '../../../core/memagent/evolution/modeDispatchRegression.ts';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, normalizeGrowthConfig } from '../../../shared/growthConfig.ts';

const storage = new InMemoryStorage();

vi.mock('../../kernel.ts', () => ({
  getKernel: () => ({}),
  getKernelStorage: () => storage,
  getTenant: () => ({ enterprise_id: '', team_id: '' }),
  newRequestId: () => 'req_gr_preserve',
}));

const { coreSaveGrowthConfig } = await import('../coreGrowth.ts');

describe('coreSaveGrowthConfig：只改判重/进化参数不重置分流快照', () => {
  it('账本已有 mode_dispatch → 页面保存后原样保留（不被清成 null）', async () => {
    const base = dispatchBaseline(null)!.base;
    const cfg0 = normalizeGrowthConfig(null);
    await saveGrowthConfigToLedger(storage, { ...cfg0, mode_dispatch: base }, { requestId: 'seed', form: 'web' });

    await coreSaveGrowthConfig({
      weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS,
      schedule: cfg0.schedule,
      evolution: { ...cfg0.evolution, sample_top_n: 25 },
    }, 'req_save_1');

    const after = growthConfigFromLedger(await storage.listMemories({}));
    expect(after.mode_dispatch).not.toBeNull();
    expect(after.mode_dispatch?.feature_words.top_insight.words).toEqual(base.feature_words.top_insight.words);
    expect(after.evolution.sample_top_n).toBe(25); // 本次真改的字段照常生效
  });
});
