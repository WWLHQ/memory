// 批次48 A31-b：余额适配器与五级降级阶梯的单元测试。
// 全部用注入的 fetchImpl（不打真实厂商端点），覆盖 A31-a 实测暴露的两类陷阱：
//  1) openrouter 普通 key 的 total_credits:0 绝不能当余额 0；
//  2) 401/403 必须降级手工并写明原因，而超时/5xx 才保留上次成功值。
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmBillingService, loadBillingCredentials, saveBillingCredential, BILLING_CREDS_FILE } from '../llmBilling.ts';
import { UNSET_MANUAL_BILLING, type ManualBilling } from '../../shared/billing.ts';
import type { LlmEngineConfig } from '../llmGateway.ts';

const manual = (over: Partial<ManualBilling> = {}): ManualBilling => ({ ...UNSET_MANUAL_BILLING, ...over });

const engine = (id: string, over: Partial<LlmEngineConfig> = {}): LlmEngineConfig => ({
  id, name: id, enabled: true, baseURL: 'https://example.invalid', model: 'm', needsKey: true,
  lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null,
  billing: { ...UNSET_MANUAL_BILLING },
  ...over,
});

interface Call { url: string }
type Reply = { status: number; body?: unknown; throws?: 'timeout' | 'network' };

/** 假 fetch：按 URL 命中回复表；未列出的 URL → 记录 404（便于断言「不该发请求」） */
function fakeFetch(table: Record<string, Reply>, calls: Call[]) {
  return async (url: string) => {
    calls.push({ url });
    const hit = table[url];
    if (!hit) return new Response('{}', { status: 404 });
    if (hit.throws === 'timeout') {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (hit.throws === 'network') throw new Error('net down');
    return new Response(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body ?? {}), { status: hit.status });
  };
}

const DS = 'https://api.deepseek.com/user/balance';
const KIMI = 'https://api.moonshot.cn/v1/users/me/balance';
const SF = 'https://api.siliconflow.cn/v1/user/info';
const OR_KEY = 'https://openrouter.ai/api/v1/key';
const OR_CREDITS = 'https://openrouter.ai/api/v1/credits';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'billing-')); });

function svc(fetchImpl: ReturnType<typeof fakeFetch>, now: () => number = () => 1_700_000_000_000) {
  return new LlmBillingService({ dataDir: dir, fetchImpl, now, ttlMs: 10 * 60_000 });
}

describe('厂商余额适配器', () => {
  it('deepseek 成功 → vendor_live，金额按 balance_infos[0].total_balance 解析', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({ [DS]: { status: 200, body: { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] } } }, calls));
    const v = await s.refreshEngine(engine('deepseek'), { deepseek: 'k' }, manual(), false);
    expect(v.provenance).toBe('vendor_live');
    expect(v.balance).toBe(110);
    expect(v.currency).toBe('CNY');
    expect(v.scope).toBe('account');
    expect(v.asOf).toBe(1_700_000_000_000);
    expect(v.status).toBe('ok');
  });

  it('kimi 401 → 凭据权限不足：降级手工并写明原因，不把旧值当实时', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({ [KIMI]: { status: 401 } }, calls), () => 1_700_000_100_000);
    const v = await s.refreshEngine(engine('kimi'), { kimi: 'k' }, manual({ balance: 88, updatedAt: 1_699_000_000_000 }), false);
    expect(v.status).toBe('auth_deficient');
    expect(v.provenance).toBe('manual');
    expect(v.balance).toBe(88);
    expect(v.lastError).toContain('凭据权限不足');
  });

  it('先成功再超时 → vendor_stale 保留上次值与其 as_of，不覆盖', async () => {
    const calls: Call[] = [];
    let t = 1_700_000_000_000;
    let reply: Reply = { status: 200, body: { data: { available_balance: 50 } } };
    const s = new LlmBillingService({
      dataDir: dir, ttlMs: 60_000, now: () => t,
      fetchImpl: async (url) => { calls.push({ url }); return new Response(JSON.stringify(reply.body), { status: reply.status }); },
    });
    const first = await s.refreshEngine(engine('kimi'), { kimi: 'k' }, manual(), false);
    expect(first.provenance).toBe('vendor_live');
    reply = { status: 503 };
    t += 30 * 60_000;
    const second = await s.refreshEngine(engine('kimi'), { kimi: 'k' }, manual(), true);
    expect(second.provenance).toBe('vendor_stale');
    expect(second.balance).toBe(50);
    expect(second.asOf).toBe(1_700_000_000_000); // 上次成功时刻，不是本次
    expect(second.status).toBe('transient');
  });

  it('无余额接口的厂商（zhipu）→ no_endpoint，且一个 HTTP 请求都不发', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({}, calls));
    const v = await s.refreshEngine(engine('zhipu'), { zhipu: 'real-key' }, manual(), true);
    expect(v.status).toBe('no_endpoint');
    expect(v.kind).toBe('none');
    expect(v.provenance).toBe('unset');
    expect(calls).toHaveLength(0);
  });

  it('无余额接口 + 手工余额 → manual，页面可如实标「手工兜底」', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({}, calls));
    const v = await s.refreshEngine(engine('groq'), { groq: 'k' }, manual({ balance: 12.5 }), false);
    expect(v.provenance).toBe('manual');
    expect(v.balance).toBe(12.5);
    expect(v.lastError).toContain('无余额接口');
    expect(calls).toHaveLength(0);
  });

  it('无凭据 → manual/unset（不发请求）；本机三家 → local_free 0 元', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({}, calls));
    const noKey = await s.refreshEngine(engine('deepseek'), {}, manual(), false);
    expect(noKey.provenance).toBe('unset');
    expect(noKey.keySet).toBe(false);
    expect(calls).toHaveLength(0);
    const local = await s.refreshEngine(engine('ollama'), {}, manual(), false);
    expect(local.provenance).toBe('local_free');
    expect(local.balance).toBe(0);
    expect(local.kind).toBe('local');
  });
});

describe('openrouter 凭据级别（A31-a 陷阱）', () => {
  it('普通 key：只读 /key 的 key 限额，scope=key_limit；绝不请求 /credits，也绝不当成余额 0', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({
      [OR_KEY]: { status: 200, body: { data: { is_management_key: false, limit: 100, limit_remaining: 42, usage: 58 } } },
      [OR_CREDITS]: { status: 200, body: { data: { total_credits: 0, total_usage: 0 } } },
    }, calls));
    const v = await s.refreshEngine(engine('openrouter'), { openrouter: 'sk-or' }, manual(), false);
    expect(v.provenance).toBe('vendor_live');
    expect(v.scope).toBe('key_limit');
    expect(v.balance).toBe(42);
    expect(v.balance).not.toBe(0);
    expect(calls.map((c) => c.url)).toEqual([OR_KEY]);
  });

  it('普通 key 且 is_management_key 缺失 → 仍走 key 限额路径（不读 credits）', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({
      [OR_KEY]: { status: 200, body: { data: { limit_remaining: 7 } } },
    }, calls));
    const v = await s.refreshEngine(engine('openrouter'), { openrouter: 'sk-or' }, manual(), false);
    expect(v.scope).toBe('key_limit');
    expect(v.balance).toBe(7);
    expect(calls.map((c) => c.url)).toEqual([OR_KEY]);
  });

  it('management key：读 /credits，余额 = total_credits - total_usage，scope=account', async () => {
    const calls: Call[] = [];
    const s = svc(fakeFetch({
      [OR_KEY]: { status: 200, body: { data: { is_management_key: true } } },
      [OR_CREDITS]: { status: 200, body: { data: { total_credits: 20, total_usage: 5 } } },
    }, calls));
    // 独立 billing 槽里的 management key 优先于推理 key
    saveBillingCredential(dir, 'openrouter', 'mgmt-key');
    const v = await s.refreshEngine(engine('openrouter'), { openrouter: 'sk-or' }, manual(), false);
    expect(v.credentialSource).toBe('billing');
    expect(v.scope).toBe('account');
    expect(v.balance).toBe(15);
    expect(v.currency).toBe('USD');
    expect(calls.map((c) => c.url)).toEqual([OR_KEY, OR_CREDITS]);
  });
});

describe('TTL 与凭据槽', () => {
  it('TTL 内不重复打厂商；force 强制重查', async () => {
    const calls: Call[] = [];
    let t = 1_700_000_000_000;
    const s = new LlmBillingService({
      dataDir: dir, ttlMs: 10 * 60_000, now: () => t,
      fetchImpl: async (url) => {
        calls.push({ url });
        return new Response(JSON.stringify({ data: { totalBalance: '9.00' } }), { status: 200 });
      },
    });
    await s.refreshEngine(engine('siliconflow'), { siliconflow: 'k' }, manual(), false);
    await s.refreshEngine(engine('siliconflow'), { siliconflow: 'k' }, manual(), false);
    expect(calls).toHaveLength(1);
    t += 11 * 60_000;
    await s.refreshEngine(engine('siliconflow'), { siliconflow: 'k' }, manual(), false);
    expect(calls).toHaveLength(2);
    await s.refreshEngine(engine('siliconflow'), { siliconflow: 'k' }, manual(), true);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(SF);
  });

  it('billing 凭据槽独立落盘；空串清除；读取不混入推理 key', () => {
    expect(existsSync(join(dir, BILLING_CREDS_FILE))).toBe(false);
    saveBillingCredential(dir, 'openrouter', 'mgmt-key');
    // 0600 在 Windows 上不生效（Node 忽略 mode），只在 POSIX 断言
    if (process.platform !== 'win32') expect(statSync(join(dir, BILLING_CREDS_FILE)).mode & 0o777).toBe(0o600);
    expect(loadBillingCredentials(dir)).toEqual({ openrouter: 'mgmt-key' });
    saveBillingCredential(dir, 'openrouter', '');
    expect(loadBillingCredentials(dir)).toEqual({});
  });
});
