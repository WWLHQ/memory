// 批次48 A31-c/A31-d：计费口径的纯函数测试（provenance 文案、归一化、单次推算）。
import { describe, it, expect } from 'vitest';
import {
  UNSET_MANUAL_BILLING, billingAmountText, billingMinutesAgo, billingProvenanceText,
  estimateCallCostCny, manualBillingSet, normalizeManualBilling,
} from '../billing.ts';

describe('手工兜底归一化', () => {
  it('空串/负值/NaN 一律按未填处理，不悄悄当 0', () => {
    const m = normalizeManualBilling({ balance: '', dailyQuota: -1, priceCnyPerMTok: 'abc', currency: 'usd' });
    expect(m.balance).toBeNull();
    expect(m.dailyQuota).toBeNull();
    expect(m.priceCnyPerMTok).toBeNull();
    expect(m.currency).toBe('USD');
    expect(manualBillingSet(m)).toBe(false);
  });

  it('合法值保留；配额 0 视为未设置（0 次/日等于禁用，不能当配额）', () => {
    const m = normalizeManualBilling({ balance: '12.5', dailyQuota: 100, priceCnyPerMTok: 0 });
    expect(m.balance).toBe(12.5);
    expect(m.dailyQuota).toBe(100);
    expect(m.priceCnyPerMTok).toBe(0);
    expect(manualBillingSet(m)).toBe(true);
    expect(normalizeManualBilling({ dailyQuota: 0 }).dailyQuota).toBeNull();
    expect(normalizeManualBilling(null).balance).toBeNull();
  });
});

describe('逐字段 provenance 文案（用户拍板四种措辞）', () => {
  // 2026-11-07T01:00:00Z = 北京时间 09:00
  const T0 = Date.parse('2026-11-07T01:00:00Z');

  it('vendor_live → 厂商实时 · HH:mm', () => {
    expect(billingProvenanceText({ provenance: 'vendor_live', asOf: T0, scope: 'account' }, T0)).toBe('厂商实时 · 09:00');
  });

  it('vendor_stale → 厂商上次成功 · N 分钟前（当前不可达），且带上次成功时间', () => {
    const text = billingProvenanceText({ provenance: 'vendor_stale', asOf: T0, scope: 'account' }, T0 + 30 * 60_000);
    expect(text).toBe('厂商上次成功 · 30 分钟前（当前不可达）');
    expect(billingMinutesAgo(T0, T0 + 30 * 60_000)).toBe(30);
  });

  it('manual / unset / local_free 各自措辞；未设置绝不显示金额', () => {
    expect(billingProvenanceText({ provenance: 'manual', asOf: T0 })).toBe('手工兜底（非厂商实时）');
    expect(billingProvenanceText({ provenance: 'unset', asOf: null })).toBe('未设置');
    expect(billingProvenanceText({ provenance: 'local_free', asOf: null })).toBe('本机 · 0 元不限量');
    expect(billingAmountText(null, null)).toBe('未设置');
    expect(billingAmountText(0, 'USD')).toBe('$0.00');
  });

  it('openrouter 普通 key 必须带「key 限额，非账户余额」，management key 不带', () => {
    expect(billingProvenanceText({ provenance: 'vendor_live', asOf: T0, scope: 'key_limit' }, T0))
      .toBe('厂商实时 · 09:00（key 限额，非账户余额）');
    expect(billingProvenanceText({ provenance: 'vendor_live', asOf: T0, scope: 'account' }, T0))
      .not.toContain('key 限额');
  });
});

describe('单次 cost 推算（usage × 单价）', () => {
  it('tokens × 单价 / 1e6；缺 tokens 或单价未设置 → null（不估算、不填 0）', () => {
    expect(estimateCallCostCny(1_000_000, 2)).toBe(2);
    expect(estimateCallCostCny(500_000, 2)).toBe(1);
    expect(estimateCallCostCny(0, 2)).toBe(0);
    expect(estimateCallCostCny(null, 2)).toBeNull();
    expect(estimateCallCostCny(1000, null)).toBeNull();
    expect(estimateCallCostCny(-1, 2)).toBeNull();
  });

  it('默认手工配置为全未设置', () => {
    expect(UNSET_MANUAL_BILLING.balance).toBeNull();
    expect(UNSET_MANUAL_BILLING.dailyQuota).toBeNull();
    expect(UNSET_MANUAL_BILLING.priceCnyPerMTok).toBeNull();
  });
});
