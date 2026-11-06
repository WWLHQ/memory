// 批次48 A24：price_cap / cost_cap 持久化进参数快照，模拟与内核真实路由共用同一取值；
// 未设置按「未设置」处理，不回落到旧的 0.01 / 2；usedToday 从账本当日实算。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coreLoadProxyCaps, coreLoadSources, coreSaveProxyCaps, coreSimulateAuto,
} from '../coreModels.ts';
import { autoPick, manualPick, proxyEligible, validatePriceCap } from '../logic.ts';
import { applyHostLlmSnapshot, type LlmGatewaySnapshot } from '../../hostLlm.ts';
import { getKernelStorage, resetKernelForTests } from '../../kernel.ts';
import { coreLoadParams, coreSaveParams } from '../../params/coreParams.ts';
import { DEFAULT_CONFIG, DEFAULT_DEV, DEFAULT_KB_POLICIES } from '../../params/defaults.ts';
import { clearModelConfig } from '../modelConfig.ts';
import type { ProxySource } from '../types.ts';

const SNAP: LlmGatewaySnapshot = {
  usable: true,
  engines: [
    { id: 'c', name: 'Cloud', enabled: true, baseURL: 'https://api.deepseek.com', model: 'cloud-a', needsKey: true, keySet: true, lastLatencyMs: 5, lastProbeAt: 1, lastProbeOk: true },
  ],
  presets: [],
};

beforeEach(() => {
  clearModelConfig();
  resetKernelForTests();
  applyHostLlmSnapshot(null);
});

describe('封顶持久化（A24）', () => {
  it('默认未设置：coreLoadProxyCaps → null / null（不回落 0.01 / 2）', async () => {
    expect(await coreLoadProxyCaps()).toEqual({ price_cap: null, cost_cap: null });
  });

  it('coreSaveProxyCaps 写参数快照并保留其它 cfg 字段；值未变不重复写', async () => {
    await coreSaveParams(
      { ...DEFAULT_CONFIG, auto_organize: false, proxy_price_cny_per_kcall: 0.02, proxy_daily_quota: 5000 },
      DEFAULT_KB_POLICIES, DEFAULT_DEV, 'req_a24_save',
    );
    const first = await coreSaveProxyCaps({ price_cap: 0.03, cost_cap: 2 });
    expect(first.changed).toBe(true);
    expect(await coreLoadProxyCaps()).toEqual({ price_cap: 0.03, cost_cap: 2 });

    // 参数页其它字段没被清掉（delete + put 整条快照，带旧 cfg）
    const params = await coreLoadParams();
    expect(params?.cfg.auto_organize).toBe(false);
    expect(params?.cfg.proxy_price_cny_per_kcall).toBe(0.02);
    expect(params?.cfg.proxy_daily_quota).toBe(5000);

    const again = await coreSaveProxyCaps({ price_cap: 0.03, cost_cap: 2 });
    expect(again).toEqual({ changed: false, version: null });
    expect(await coreLoadProxyCaps()).toEqual({ price_cap: 0.03, cost_cap: 2 });

    // 参数页再保存一次也不得清掉封顶（A24 交叉覆盖防护）
    await coreSaveParams(DEFAULT_CONFIG, DEFAULT_KB_POLICIES, DEFAULT_DEV, 'req_a24_params');
    expect(await coreLoadProxyCaps()).toEqual({ price_cap: 0.03, cost_cap: 2 });
  });

  it('空值/非法值一律按未设置处理（normalizeProxyCap）', async () => {
    await coreSaveProxyCaps({ price_cap: Number.NaN, cost_cap: -1 });
    expect(await coreLoadProxyCaps()).toEqual({ price_cap: null, cost_cap: null });
  });
});

describe('模拟与真实路由同一份取值（A24）', () => {
  it('未设置 price_cap → 低价档不入选（仅免费可代理），设置后才命中低价', async () => {
    applyHostLlmSnapshot(SNAP);
    await coreSaveParams(
      { ...DEFAULT_CONFIG, proxy_price_cny_per_kcall: 0.02, proxy_daily_quota: 5000 },
      DEFAULT_KB_POLICIES, DEFAULT_DEV, 'req_a24_price',
    );
    const simUnset = await coreSimulateAuto();
    expect(simUnset.source).toBeNull();
    expect(simUnset.reason).toContain('price_cap 未设置');

    // 显式落封顶（模型页路径）
    await coreSaveProxyCaps({ price_cap: 0.03, cost_cap: null });
    const simSet = await coreSimulateAuto();
    expect(simSet.source?.agent).toBe('Cloud');
    expect(simSet.reason).toContain('低价');
  });

  it('cost_cap 未设置 → 不封顶；设置后按账本当日实算花费判定', async () => {
    applyHostLlmSnapshot(SNAP);
    await coreSaveParams(
      { ...DEFAULT_CONFIG, proxy_price_cny_per_kcall: 0.02, proxy_daily_quota: 5000 },
      DEFAULT_KB_POLICIES, DEFAULT_DEV, 'req_a24_cost',
    );
    await coreSaveProxyCaps({ price_cap: 0.03, cost_cap: null });
    expect((await coreSimulateAuto()).source?.agent).toBe('Cloud'); // 不封顶

    const storage = getKernelStorage();
    await storage.appendAudit({
      request_id: 'req_a24_seed', action: 'llm_proxy', ts: Date.now(),
      detail: { llm_proxy_source: 'agent:cloud-a', model: 'cloud-a', cost: 2.5 },
    });
    await coreSaveProxyCaps({ price_cap: 0.03, cost_cap: 2 });
    const capped = await coreSimulateAuto();
    expect(capped.source).toBeNull();
    expect(capped.reason).toContain('成本封顶');

    // 窗口外的花费不计入（重启不归零 = 账本当日实算；超过 24h 的旧账不算）
    await storage.appendAudit({
      request_id: 'req_a24_old', action: 'llm_proxy', ts: Date.now() - 25 * 3600 * 1000,
      detail: { llm_proxy_source: 'agent:cloud-a', model: 'cloud-a', cost: 9.9 },
    });
    expect((await coreLoadSources()).find((s) => s.model === 'cloud-a')?.used).toBe(1);
  });
});

describe('页面逻辑 null 语义（A24）', () => {
  const free: ProxySource = { agent: 'L', model: 'local-a', tier: 'free', price: 0, quota: Number.POSITIVE_INFINITY, used: 0 };
  const cheap: ProxySource = { agent: 'C', model: 'cloud-a', tier: 'cheap', price: 0.02, quota: 5000, used: 0 };

  it('priceCap=null：免费可代理、低价不可；validatePriceCap 如实「未设置」', () => {
    expect(proxyEligible(free, null)).toBe(true);
    expect(proxyEligible(cheap, null)).toBe(false);
    expect(validatePriceCap(null)).toMatchObject({ ok: true, freeOnly: false, msg: expect.stringContaining('未设置') });
    expect(autoPick([cheap], null, Date.now()).source).toBeNull();
    expect(autoPick([cheap], 0.03, Date.now()).source?.agent).toBe('C');
    expect(manualPick([cheap], null, Date.now()).reason).toContain('price_cap 未设置');
  });
});
