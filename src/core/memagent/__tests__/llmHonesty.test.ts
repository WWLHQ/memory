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
const CONTENT = '支付接口超时复盘：连接池配置过小，调整为 50 后恢复；需在上线前压测连接池容量。';

const FREE_MODEL: ModelInfo = { model: 'free-refine', tier: 'free', price: 0, quota: 1000, used: 0 };

// 共享写密钥（PBKDF2 只跑一次）：写入即加密 L0（§4.4.4）
let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

const REFINED = {
  content_l1: '',
  content_l2: '[来源:Agent会话][类型:pitfall] 支付接口超时复盘：根因是连接池配置过小，调整后恢复；结论可供同项目复用。',
  content_l3: '成功点：定位连接池根因；失败点：上线前未压测；经验教训：容量类配置需在发布流程中验证。',
  content_l4: '模式归纳：容量类故障先核对连接池与超时配置。适用场景：支付链路压测与扩容评审。',
  content_l5: '容量假设需随流量演进复核；边界：仅适用于同 project_id 的部署环境。',
  content_l6: JSON.stringify({ keywords: ['连接池', '超时'], projections: [{ layer: 'L2', relevance: 0.9 }] }),
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
