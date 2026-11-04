// 批次3-B：agent.write 只有在真正落地 LLM 产物时才记 llm_proxy/计费；
// 选中模型但未产出（无 refine/违规/异常）必须记 llm_fallback（E_LLM_FALLBACK）。
import { beforeAll, describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault } from './l0Kit.ts';
import type { LlmProvider, ModelInfo } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

// 批次40：产物必须逐层比上游短（压缩不是扩写），所以原文取长、五层取压缩链——
// 与 refine.test.ts 同一组实测过的样本（L1 320 字 → 允许炼到 L5）。
const CONTENT = '线上事故复盘（2026-10-12 支付链路）：支付接口大面积超时，值班排查后确认根因是连接池配置项 pool_size=5 过小，' +
  '高峰期活跃连接被打满后请求排队，网关侧 504 状态码激增。临时把 pool_size 调到 50 并同步调大 connect_timeout=800ms 后恢复，' +
  '错误码 SQLSTATE 40001 也随之消失。联系人：张三，电话 13800138000，数据库地址 tcp://prod-db:5432/app，api_key: sk-abcdef1234567890abcdef。' +
  '复盘结论：容量类参数必须压测验证后再上线，压测环境要复现生产并发量，不能只按单机配置推算；' +
  '同类隐患在订单查询链路也出现过一次，当时的处置同样是先扩连接池再查慢查询，没有留下压测记录，这次要补齐。';

const FREE_MODEL: ModelInfo = { model: 'free-refine', tier: 'free', price: 0, quota: 1000, used: 0 };

// 共享写密钥（PBKDF2 只跑一次）：写入即加密 L0（§4.4.4）
let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

const REFINED = {
  content_l1: '',
  content_l2: '支付链路超时复盘：根因是连接池配置项过小（pool_size=5），高峰连接打满后请求排队，网关 504 状态码激增；' +
    '调到 pool_size=50、connect_timeout=800ms 后恢复，错误码随之下清。结论是容量类参数须压测验证后再上线。',
  content_l3: '成功点：值班快速定位到连接池配置项根因并恢复；失败点：上线前没做并发压测，容量参数只按单机推算；经验教训：容量类参数必须压测验证。',
  content_l4: '适用场景：支付链路与网关容量评审。连接池、超时这类配置项要与生产并发量一起核对，不能只按单机默认值上线。',
  content_l5: '边界条件：仅适用于同 project_id 且网关前置的部署环境，非支付链路仍需另做压测。',
  content_l6: JSON.stringify({ keywords: ['连接池', '超时', '504', 'SQLSTATE 40001', '压测'], projections: [{ layer: 'L2', relevance: 0.9 }] }),
};

function makeAgent(llm: LlmProvider, storage = new InMemoryStorage()) {
  return {
    storage,
    ma: createMemAgent({
      form: 'desktop', account: ACCOUNT, llm, vector: new JsVectorBackend(), storage, l0: sharedVault,
    }),
  };
}

function provider(over: Partial<LlmProvider>): LlmProvider {
  return { listModels: () => [FREE_MODEL], call: async () => ({ text: '', tokens: 0 }), isStub: false, ...over };
}

describe('agent.write（批次3-B）', () => {
  it('LLM 产物落地 → 记 llm_proxy 与模型来源', async () => {
    const { ma, storage } = makeAgent(provider({ refine: async () => REFINED }));
    const r = await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    expect(r.refined_by).toBe('llm');
    expect(r.layers?.content_l2).toBe(REFINED.content_l2);
    expect(r.audit.action).toBe('write');
    const [a] = await storage.queryAudit({ action: 'llm_proxy' });
    expect(a.detail).toMatchObject({ model: 'free-refine', source: 'agent:free-refine' });
    expect(await storage.queryAudit({ action: 'llm_fallback' })).toHaveLength(0);
  });

  it('批次27 P2-4：LLM 产物残缺（仅部分层）→ llm_partial + llm_fallback（不冒充全量精炼）', async () => {
    const { ma, storage } = makeAgent(provider({ refine: async () => ({ ...REFINED, content_l3: undefined, content_l4: undefined, content_l5: undefined, content_l6: undefined }) }));
    const r = await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    expect(r.refined_by).toBe('llm_partial');
    expect(r.layers?.content_l2).toBe(REFINED.content_l2);
    expect(await storage.queryAudit({ action: 'llm_proxy' })).toHaveLength(0);
    const [fb] = await storage.queryAudit({ action: 'llm_fallback' });
    expect(fb.detail.code).toBe('E_LLM_FALLBACK');
  });

  it('选中模型但 Provider 无 refine → llm_fallback（E_LLM_FALLBACK），写入仍落 L1', async () => {
    const { ma, storage } = makeAgent(provider({}));
    const r = await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    expect(r.refined_by).toBe('stub');
    const [a] = await storage.queryAudit({ action: 'llm_fallback' });
    expect(a.detail).toMatchObject({ code: 'E_LLM_FALLBACK', model: 'free-refine' });
    expect(await storage.queryAudit({ action: 'llm_proxy' })).toHaveLength(0);
  });

  it('refine 抛异常 → llm_fallback 带上游错误原因', async () => {
    const { ma, storage } = makeAgent(provider({ refine: async () => { throw new Error('upstream 502'); } }));
    const r = await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    expect(r.refined_by).toBe('stub');
    const [a] = await storage.queryAudit({ action: 'llm_fallback' });
    expect(String(a.detail.reason)).toContain('upstream 502');
    expect(a.detail.code).toBe('E_LLM_FALLBACK');
  });

  it('显式 stub Provider（本就无真实 LLM）→ 不写 llm_* 审计噪音', async () => {
    const { ma, storage } = makeAgent(provider({ isStub: true }));
    const r = await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    expect(r.refined_by).toBe('stub');
    expect(await storage.queryAudit({ action: 'llm_fallback' })).toHaveLength(0);
    expect(await storage.queryAudit({ action: 'llm_proxy' })).toHaveLength(0);
  });

  it('无合格代理源（余量耗尽）→ llm_fallback，不虚报 llm_proxy', async () => {
    const exhausted = { ...FREE_MODEL, used: FREE_MODEL.quota };
    const { ma, storage } = makeAgent(provider({ listModels: () => [exhausted] }));
    await ma.write({ content: CONTENT, category: 'pitfall', project_id: 'P1' });
    const [a] = await storage.queryAudit({ action: 'llm_fallback' });
    expect(a.detail.code).toBe('E_LLM_FALLBACK');
    expect(String(a.detail.reason)).toContain('回退本地');
    expect(await storage.queryAudit({ action: 'llm_proxy' })).toHaveLength(0);
  });
});
