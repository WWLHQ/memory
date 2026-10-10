// P13 纯逻辑单测：覆盖 R1–R12 红线与 C3/C7/C8/C9/C11/C13 用例
import { describe, expect, it } from 'vitest';
import { SEED_SOURCES, SEED_USAGES } from '../seed.ts';
import {
  FALLBACK_ALWAYS_ON,
  auditProxy,
  autoPick,
  manualPick,
  maskKey,
  proxyBudgetOf,
  proxyEligible,
  rebuildEta,
  remainingOf,
  validatePriceCap,
  validateUsage,
  vectorInfo,
} from '../logic.ts';
import type { ProxySource, UsageConfig } from '../types.ts';

const NOW = 1_700_000_000_000;
const src = (o: Partial<ProxySource>): ProxySource => ({
  agent: 'a', model: 'm', tier: 'free', price: 0, quota: 1000, used: 0, ...o,
});

describe('向量模型（13.2）', () => {
  it('vectorInfo：st=384 本地 / ds=768 云端需 Key', () => {
    expect(vectorInfo('st').dims).toBe(384);
    expect(vectorInfo('st').deploy).toBe('本地');
    expect(vectorInfo('ds').needsKey).toBe(true);
    expect(vectorInfo('bge-m3').dims).toBe(1024);
  });

  it('rebuildEta：384→1024 估时按维度比例放大', () => {
    expect(rebuildEta(384, 1024, 1000)).toBe(6);
    expect(rebuildEta(1024, 384, 1000)).toBe(1);
  });
});

describe('R2 Key 脱敏', () => {
  it('maskKey 只露前 2 位', () => {
    expect(maskKey('sk-abcdef123456')).toBe('[API_KEY:sk****]');
    expect(maskKey('')).toBe('');
  });
});

describe('用途校验（R1/C3/R4）', () => {
  it('R1：本地/网络全不勾 → 报错', () => {
    const cfg: UsageConfig = { local: false, net: false, endpoint: '', apiKey: '', temperature: 0.3, timeoutSec: 30 };
    expect(validateUsage('write', cfg).errors.some((e) => e.includes('R1'))).toBe(true);
  });

  it('C3：勾网络通道必须配端点', () => {
    const cfg: UsageConfig = { local: false, net: true, endpoint: '', apiKey: '', temperature: 0.3, timeoutSec: 30 };
    expect(validateUsage('write', cfg).errors.some((e) => e.includes('C3'))).toBe(true);
    const ok = { ...cfg, endpoint: 'https://api.example.com/v1' };
    expect(validateUsage('write', ok).errors).toEqual([]);
  });

  it('R4：judge 温度非 0 被归一化为 0', () => {
    const r = validateUsage('judge', SEED_USAGES.judge);
    expect(r.normalized.temperature).toBe(0);
    const hot = { ...SEED_USAGES.judge, temperature: 0.9 };
    expect(validateUsage('judge', hot).normalized.temperature).toBe(0);
    // 其他用途温度不受锁
    expect(validateUsage('write', SEED_USAGES.write).normalized.temperature).toBe(0.3);
  });

  it('R3：fallback_local 恒开', () => {
    expect(FALLBACK_ALWAYS_ON).toBe(true);
  });
});

describe('反代理预算与资格（R7/R8/R12）', () => {
  it('R8：预算 = 声明额度 × 0.9', () => {
    expect(proxyBudgetOf(src({ quota: 1000 }))).toBe(900);
    expect(remainingOf(src({ quota: 1000, used: 120 }))).toBe(780);
  });

  it('R7/R12：free 恒可 / cheap 看 cap / paid 永不', () => {
    expect(proxyEligible(src({ tier: 'free' }), 0)).toBe(true);
    expect(proxyEligible(src({ tier: 'cheap', price: 0.01 }), 0.01)).toBe(true);
    expect(proxyEligible(src({ tier: 'cheap', price: 0.03 }), 0.01)).toBe(false);
    expect(proxyEligible(src({ tier: 'paid', price: 0.1 }), 10)).toBe(false);
  });

  it('C13：price_cap ≥ 0；=0 仅免费', () => {
    expect(validatePriceCap(-1).ok).toBe(false);
    const zero = validatePriceCap(0);
    expect(zero.ok).toBe(true);
    expect(zero.freeOnly).toBe(true);
    expect(validatePriceCap(0.02).freeOnly).toBe(false);
  });
});

describe('auto 择优（C7/C8/C13）', () => {
  it('C7：免费有余量者优先', () => {
    const r = autoPick(SEED_SOURCES, 0.01, NOW);
    expect(r.source?.agent).toBe('claude-code');
    expect(r.reason).toContain('免费优先');
  });

  it('C8：余量耗尽的免费源被剔除（cursor-trial used 480 > 0.9×500）', () => {
    const only = [src({ agent: 'cursor-trial', quota: 500, used: 480 })];
    const r = autoPick(only, 0.02, NOW);
    expect(r.source).toBeNull();
    expect(r.reason).toContain('R12');
  });

  it('C13：price_cap=0 时超限演示源之外无免费 → 回退本地（付费被禁）', () => {
    const r = autoPick([src({ agent: 'x-agent', tier: 'cheap', price: 0.03, quota: 100, used: 100 })], 0, NOW);
    expect(r.source).toBeNull();
  });

  it('免费全耗尽 → 低价 ≤ cap 中价低者优先', () => {
    const srcs = [
      src({ agent: 'codex', tier: 'cheap', price: 0.01, quota: 1000, used: 100 }),
      src({ agent: 'x-agent', tier: 'cheap', price: 0.03, quota: 1000, used: 100 }),
    ];
    const r = autoPick(srcs, 0.02, NOW);
    expect(r.source?.agent).toBe('codex');
  });
});

describe('manual 择优（C9/C11/R7）', () => {
  it('C9/R7：勾选含 paid / 超 cap 源 → 拒绝', () => {
    const bad = [src({ agent: 'x-agent', tier: 'cheap', price: 0.03 })];
    expect(manualPick(bad, 0.01, NOW).reason).toContain('R7 拒绝');
    const paid = [src({ agent: 'p', tier: 'paid', price: 0.5 })];
    expect(manualPick(paid, 10, NOW).source).toBeNull();
  });

  it('C11：勾选源全耗尽 → 回退本地，不转其他', () => {
    const r = manualPick([src({ agent: 'a', quota: 100, used: 100 })], 0.01, NOW);
    expect(r.source).toBeNull();
    expect(r.reason).toContain('C11');
  });

  it('勾选源可用 → 用第一个可用者', () => {
    const r = manualPick([src({ agent: 'claude-code', used: 10 }), src({ agent: 'codex', tier: 'cheap', price: 0.01, used: 10 })], 0.01, NOW);
    expect(r.source?.agent).toBe('claude-code');
  });
});

describe('审计与种子（R8/R10）', () => {
  it('R10：审计条目含 agent:<name> + 花费 + 模式', () => {
    const e = auditProxy(SEED_SOURCES[2], 0.35, 'auto');
    expect(e.event).toBe('llm_proxy');
    expect(e.llm_proxy_source).toBe('agent:codex');
    expect(e.cost).toBe(0.35);
    expect(e.mode).toBe('auto');
    const local = auditProxy(null, 0, 'auto');
    expect(local.llm_proxy_source).toBe('agent:local');
    expect(local.mode).toBe('local');
  });

  it('种子反代理映射：x-agent 演示超限（余量 < 0）', () => {
    const x = SEED_SOURCES.find((s) => s.agent === 'x-agent')!;
    expect(remainingOf(x)).toBeLessThan(0);
  });
});
