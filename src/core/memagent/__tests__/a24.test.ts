// 批次48 A24：内核真实路由的封顶与当日花费取账本真值；llm_proxy 记真实 usage 与 cost。
import { beforeAll, describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault } from './l0Kit.ts';
import type { LlmProvider, Memory, ModelInfo } from '../types.ts';
import { PARAMS_PREF_PREFIX } from '../paramsSnapshot.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

const CONTENT = '线上事故复盘（2026-10-12 支付链路）：支付接口大面积超时，值班排查后确认根因是连接池配置项 pool_size=5 过小，' +
  '高峰期活跃连接被打满后请求排队，网关侧 504 状态码激增。临时把 pool_size 调到 50 并同步调大 connect_timeout=800ms 后恢复，' +
  '错误码 SQLSTATE 40001 也随之消失。联系人：张三，电话 13800138000，数据库地址 tcp://prod-db:5432/app，api_key: sk-abcdef1234567890abcdef。' +
  '复盘结论：容量类参数必须压测验证后再上线，压测环境要复现生产并发量，不能只按单机配置推算；' +
  '同类隐患在订单查询链路也出现过一次，当时的处置同样是先扩连接池再查慢查询，没有留下压测记录，这次要补齐。';

const REFINED = {
  content_l1: '',
  content_l2: '支付链路超时复盘：根因是连接池配置项过小（pool_size=5），高峰连接打满后请求排队，网关 504 状态码激增；' +
    '调到 pool_size=50、connect_timeout=800ms 后恢复，错误码随之下清。结论是容量类参数须压测验证后再上线。',
  content_l3: '成功点：值班快速定位到连接池配置项根因并恢复；失败点：上线前没做并发压测，容量参数只按单机推算；经验教训：容量类参数必须压测验证。',
  content_l4: '适用场景：支付链路与网关容量评审。连接池、超时这类配置项要与生产并发量一起核对，不能只按单机默认值上线。',
  content_l5: '边界条件：仅适用于同 project_id 且网关前置的部署环境，非支付链路仍需另做压测。',
  content_l6: JSON.stringify({ keywords: ['连接池', '超时', '504'], projections: [{ layer: 'L2', relevance: 0.9 }] }),
};

const CHEAP: ModelInfo = { model: 'cheap-x', tier: 'cheap', price: 0.02, quota: 1000, used: 0 };

let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

function createAgent(llm: LlmProvider) {
  const storage = new InMemoryStorage();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm, vector: new JsVectorBackend(), storage, l0: sharedVault,
  });
  return { ma, storage };
}

/** 写一条参数快照 preference（params:v1: JSON） */
async function putSnapshot(storage: InMemoryStorage, cfg: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const mem: Memory = {
    mem_id: 'params_a24_test', project_id: 'P_SYSTEM', user_id: 'system', enterprise_id: '', team_id: '',
    category: 'preference', layer: 'L2',
    content: `${PARAMS_PREF_PREFIX}${JSON.stringify({ cfg, kbs: [], dev: {} })}`,
    decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: now, updated_at: now,
  };
  await storage.putMemory(mem);
}

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    listModels: () => [CHEAP],
    refine: async () => REFINED,
    call: async () => ({ text: '', tokens: 0 }),
    isStub: false,
    ...over,
  };
}

describe('A24 封顶取参数快照（不回落 0.01 / 2）', () => {
  it('未设置 price_cap → 低价源不入选，回退本地（不再默认 0.01）', async () => {
    const { ma, storage } = createAgent(provider());
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [fb] = await storage.queryAudit({ action: 'llm_fallback' });
    expect(fb.detail.code).toBe('E_LLM_FALLBACK');
    expect(String(fb.detail.reason)).toContain('price_cap 未设置');
    expect(await storage.queryAudit({ action: 'llm_proxy' })).toHaveLength(0);
  });

  it('快照 price_cap=0.03 → 真实路由命中低价源并记 llm_proxy', async () => {
    const { ma, storage } = createAgent(provider());
    await putSnapshot(storage, { proxy_price_cap: 0.03, proxy_cost_cap: null });
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [a] = await storage.queryAudit({ action: 'llm_proxy' });
    expect(a.detail.model).toBe('cheap-x');
    expect(a.detail.reason).toContain('低价');
  });
});

describe('A24 llm_proxy 记真实 usage 与 cost', () => {
  it('usage × 单价：tokens=100、单价 3 元/百万 → cost=0.0003', async () => {
    const { ma, storage } = createAgent(provider({ takeUsage: () => ({ tokens: 100 }) }));
    await putSnapshot(storage, { proxy_price_cap: 0.03, cost_cny_per_mtok: 3 });
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [a] = await storage.queryAudit({ action: 'llm_proxy' });
    expect(a.detail.tokens).toBe(100);
    expect(a.detail.unit_price_cny_per_mtok).toBe(3);
    expect(a.detail.cost).toBeCloseTo(100 * 3 / 1_000_000, 10);
  });

  it('上游无 usage → tokens/cost 均为 null（不按文本长度估算）', async () => {
    const { ma, storage } = createAgent(provider({ takeUsage: () => ({ tokens: null }) }));
    await putSnapshot(storage, { proxy_price_cap: 0.03, cost_cny_per_mtok: 3 });
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [a] = await storage.queryAudit({ action: 'llm_proxy' });
    expect(a.detail.tokens).toBeNull();
    expect(a.detail.cost).toBeNull();
  });

  it('单价未设置 → cost 为 null（不拿 0 冒充已计费）', async () => {
    const { ma, storage } = createAgent(provider({ takeUsage: () => ({ tokens: 100 }) }));
    await putSnapshot(storage, { proxy_price_cap: 0.03 });
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [a] = await storage.queryAudit({ action: 'llm_proxy' });
    expect(a.detail.tokens).toBe(100);
    expect(a.detail.cost).toBeNull();
  });
});

describe('A24 usedToday 从账本当日实算（重启不归零）', () => {
  it('账本已有 ¥2.0 当日花费 + cost_cap=2 → 本次封顶回退（进程内计数已不再参与）', async () => {
    const { ma, storage } = createAgent(provider());
    await putSnapshot(storage, { proxy_price_cap: 0.03, proxy_cost_cap: 2 });
    await storage.appendAudit({
      request_id: 'req_seed_cost', action: 'llm_proxy', ts: Date.now(),
      detail: { llm_proxy_source: 'agent:cheap-x', model: 'cheap-x', cost: 2.0 },
    });
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [fb] = await storage.queryAudit({
      action: 'llm_fallback',
    });
    expect(String(fb.detail.reason)).toContain('成本封顶');
    expect(fb.detail.reason).toContain('2.00');
    // 本次没有新 llm_proxy
    expect(await storage.queryAudit({ action: 'llm_proxy' })).toHaveLength(1);
  });
});
