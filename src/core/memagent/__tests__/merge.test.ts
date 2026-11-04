// 分支嫁接回归（§6.2）：命中即嫁接停止；新记忆保留自身 L0/L1..Lk；目标文本一字不改，只增 grafted_from/confidence/last_access
import { beforeAll, describe, expect, it } from 'vitest';
import { coreWrite } from '../memories.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync } from '../vector.ts';
import { sha256hex } from '../sync.ts';
import type { LlmProvider, L0Port, Memory } from '../types.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault, TEST_ADMIN_PW } from './l0Kit.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const NOW = 1_000_000;
// 批次40：深度上限按 L1 有效字数给（≥240 才允许炼到 L5），且逐层产物必须**一层比一层短**
// （压缩不是扩写），所以下面这条原文与五层样本是实测过的链：L1 320 字 → L2 171 → L3 115 → L4 62 → L5 52。
const BASE = 'staging 集群部署复盘：docker compose v2 在 alpha 与 beta 两套环境的编排文件一致，升级后 beta 环境缺少健康检查配置项 healthcheck.interval=30s，' +
  '滚动发布时流量打到未就绪容器，网关 502 状态码激增，错误码 SQLSTATE 08001 同步上升。补齐 healthcheck 并把 deploy.replicas 从 2 调到 4 之后恢复，回滚演练通过。' +
  '联系人：张三，电话 13800138000。复盘结论：多环境发布必须先在 beta 环境校验编排配置项再推进 alpha。' +
  '同类隐患在订单查询链路也出现过一次，当时同样靠扩副本恢复，没有留下压测记录，这次一并补齐到发布手册里。';
/** 只够炼到 L2 的中等原文（批次40 深度闸门：有效字 59 → cap L2） */
const MID = 'docker compose v2 在 beta 环境的部署校验与回滚演练记录：健康检查配置项补齐后 502 状态码归零，副本从 2 扩到 4。';
/** MID 的合规 L2（源文 72 字 → 允许 29–72 字，且必须保留源文里的「配置项 / 状态码」） */
const L2_MID = 'compose v2 升级后 beta 环境补齐健康检查配置项，502 状态码归零，副本扩到 4。';

/** 各层合规产物（供逐层假 Provider 使用；L4/L5 按格式契约开头） */
const LAYERS: Record<string, string> = {
  L2: 'staging 集群部署复盘：docker compose v2 升级后 beta 环境缺少健康检查配置项，滚动发布把流量打到未就绪容器，' +
    '网关 502 状态码与错误码 SQLSTATE 08001 一起上升；补齐 healthcheck、副本 2→4 后恢复，回滚演练通过。' +
    '结论：多环境发布要先在 beta 校验编排配置项再推进 alpha。',
  L3: '成功点：值班补齐 healthcheck 并扩副本，服务很快恢复；失败点：升级 compose 时只按 alpha 校验配置项，beta 漏检导致 502；' +
    '经验教训：多环境发布前必须在 beta 复现一遍编排校验，并留下压测记录。',
  L4: '适用场景：多环境滚动发布与回滚演练。编排配置项要在每套环境各自校验，不能只按首套环境通过就推进，副本数需与健康检查一起复核。',
  L5: '边界条件：仅适用于同一 project_id 下的 compose 多环境部署，单环境发布仍需另做演练。',
  L6: JSON.stringify({
    keywords: ['compose', 'healthcheck', '502', 'SQLSTATE 08001', '多环境'],
    projections: [{ layer: 'L2', relevance: 0.9 }, { layer: 'L4', relevance: 0.8 }],
  }),
};

/** 逐层 Provider：每层返回合规产物；overrides 可注入违规/异常层 */
function layerLlm(overrides: Partial<Record<string, string | Error>> = {}): LlmProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listModels: () => [],
    call: async () => ({ text: '', tokens: 0 }),
    isStub: false,
    refineLayer: async (_model, layer) => {
      calls.push(layer);
      const v = overrides[layer] ?? LAYERS[layer] ?? '';
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

/** 旧 Provider：一次返回全部层（兼容路径，内核只以 L1 调用一次） */
function legacyLlm(): LlmProvider & { calls: number } {
  const self = {
    calls: 0,
    listModels: () => [],
    call: async () => ({ text: '', tokens: 0 }),
    isStub: false,
    refine: async () => {
      self.calls++;
      return {
        content_l1: '',
        content_l2: LAYERS.L2,
        content_l3: LAYERS.L3,
        content_l4: LAYERS.L4,
        content_l5: LAYERS.L5,
        content_l6: LAYERS.L6,
      };
    },
  };
  return self;
}

// 共享写密钥（PBKDF2 只跑一次）；各用例只读共享 vault，会话另行创建。
let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

function setup() {
  const storage = new InMemoryStorage();
  const vector = new JsVectorBackend();
  const ctx = (over: { llm?: LlmProvider; llmModel?: string; l0?: L0Port } = {}) => ({
    storage, vector, account: ACCOUNT, request_id: 'req_graft', now: NOW, l0: sharedVault, ...over,
  });
  return { storage, vector, ctx };
}

function seed(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2',
    content: '旧摘要', content_l1: '报表导出与权限审计：每季度复核，审计留痕归档', content_l2: '旧摘要',
    decay_class: 'hot', pinned: false, locked: false, version: 3, created_at: 100,
    ...over,
  };
}

describe('分支嫁接（§6.2）', () => {
  it('无 LLM：L1 命中 → grafted；新记忆保留自身 L1，目标文本不变', async () => {
    const { storage, vector, ctx } = setup();
    await storage.putMemory(seed());
    await vector.upsert('m1', seed().content_l1!, { project_id: 'P1', layer: 'L2' });

    const r = await coreWrite(
      // 批次40-B 门槛：短（有效字 <30）但带硬事实（每季度复核 3 次）→ 放行；纯短无事实才拦
      { content: '报表导出与权限审计：每季度复核 3 次，审计留痕归档，复核结果归档', category: 'fact', project_id: 'P1' },
      ctx(),
    );
    expect(r.dedup.action).toBe('grafted');
    expect(r.dedup.graft_to).toBe('m1');
    expect(r.dedup.graft_layer).toBe('L1');
    expect(r.dedup.sim).toBeGreaterThanOrEqual(0.70);
    expect(r.mem_id).not.toBe('m1');

    const created = (await storage.getMemory(r.mem_id))!;
    expect(created.layer).toBe('L1');
    expect(created.refined_by).toBe('stub');
    expect(created.content_l1).toContain('复核结果归档');
    expect(created.graft_to).toBe('m1');
    expect(created.graft_layer).toBe('L1');
    expect(created.embedding).toEqual(embedSync(created.content_l1!));
    expect(created.sha256).toBe(sha256hex(created.content));

    // 目标：文本与层内容不变，只记录嫁接分支 / 刷新置信度与访问时间
    const target = (await storage.getMemory('m1'))!;
    expect(target.content_l1).toBe(seed().content_l1);
    expect(target.content_l2).toBe('旧摘要');
    expect(target.grafted_from).toEqual([created.mem_id]);
    expect(target.version).toBe(4);
    expect(target.last_access_time).toBe(NOW);
    expect(Number(target.confidence)).toBeCloseTo(0.51, 5);

    const graftAudit = await storage.queryAudit({ action: 'graft' });
    expect(graftAudit).toHaveLength(1);
    expect(graftAudit[0].detail).toMatchObject({
      new_id: created.mem_id, target_id: 'm1', layer: 'L1', threshold: 0.70,
    });
    // 两条记忆都进向量索引
    const hits = await vector.search(embedSync(created.content_l1!), 5, {});
    expect(hits.map((h) => h.mem_id)).toContain(created.mem_id);
    expect(hits.map((h) => h.mem_id)).toContain('m1');
  });

  it('深层命中：L1 不重复、L2 重复 → graft@L2，停止生成 L3–L6', async () => {
    const { storage, ctx } = setup();
    await storage.putMemory(seed({ content_l2: L2_MID }));
    const llm = layerLlm({ L2: L2_MID });

    const r = await coreWrite(
      { content: MID, category: 'fact', project_id: 'P1' },
      ctx({ llm, llmModel: 'real-model' }),
    );
    expect(r.dedup.action).toBe('grafted');
    expect(r.dedup.graft_layer).toBe('L2');
    expect(r.dedup.graft_to).toBe('m1');
    expect(llm.calls).toEqual(['L2']); // 命中即停，不再生成 L6 索引
    expect(r.layer_decisions?.map((d) => d.layer)).toEqual(['L1', 'L2']);
    expect(r.layer_decisions?.[1]).toMatchObject({ layer: 'L2', action: 'duplicate', threshold: 0.75 });

    const created = (await storage.getMemory(r.mem_id))!;
    expect(created.layer).toBe('L2');
    expect(created.refined_by).toBe('llm');
    expect(created.content_l2).toBe(L2_MID);
    expect(created.content_l3).toBeUndefined();
    expect(Object.keys(created.layer_specs ?? {})).toEqual(['L1', 'L2']);
  });

  it('全层无重复：逐层生成 L2–L6（5 次调用），layer=L6/content=L6', async () => {
    const { storage, ctx } = setup();
    const llm = layerLlm();
    const r = await coreWrite(
      { content: BASE, category: 'fact', project_id: 'P1' },
      ctx({ llm, llmModel: 'real-model' }),
    );
    expect(r.dedup.action).toBe('new');
    expect(r.refined_by).toBe('llm');
    expect(llm.calls).toEqual(['L2', 'L3', 'L4', 'L5', 'L6']);
    expect(r.spec_violations).toEqual([]);

    const m = (await storage.getMemory(r.mem_id))!;
    expect(m.layer).toBe('L6');
    expect(m.content).toBe(LAYERS.L6);
    expect(m.content_l3).toBe(LAYERS.L3);
    expect(m.content_l4).toBe(LAYERS.L4);
    expect(m.content_l5).toBe(LAYERS.L5);
    expect(Object.keys(m.layer_specs ?? {})).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);

    const [writeAudit] = await storage.queryAudit({ action: 'write' });
    expect(writeAudit.detail).toMatchObject({
      dedup: 'new', refined_by: 'llm', llm_calls: 5, layers: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
    });
  });

  it('旧 Provider（一次返回多层）：只以 L1 调用一次，L0 原文永不送 LLM', async () => {
    const { storage, ctx } = setup();
    const llm = legacyLlm();
    const r = await coreWrite(
      { content: BASE, category: 'fact', project_id: 'P1' },
      ctx({ llm, llmModel: 'real-model' }),
    );
    expect(llm.calls).toBe(1);
    expect(r.refined_by).toBe('llm');
    const m = (await storage.getMemory(r.mem_id))!;
    expect(m.layer).toBe('L6');
    expect(m.content_l2).toBe(LAYERS.L2);
  });

  it('某层违规 → 该层不落 + 停止更深层；layer=最高连续层（L6 独立通道照常产出）', async () => {
    const { storage, ctx } = setup();
    const llm = layerLlm({ L4: '太短' });
    const r = await coreWrite(
      { content: BASE, category: 'fact', project_id: 'P1' },
      ctx({ llm, llmModel: 'real-model' }),
    );
    expect(r.dedup.action).toBe('new');
    expect(r.refined_by).toBe('llm_partial'); // 批次27 P2-4：L4 违规停梯，L5 缺失
    expect(r.spec_violations?.join()).toContain('L4');
    expect(llm.calls).toEqual(['L2', 'L3', 'L4', 'L6']); // L5 不再调用；L6 是索引，照炼
    expect(r.layer_decisions?.find((d) => d.layer === 'L4')).toMatchObject({ layer: 'L4', action: 'invalid' });

    const m = (await storage.getMemory(r.mem_id))!;
    // 批次40-C：绝不能因为「L6 也产出了」就把这行标成 L6——层深只数连续的叙事层
    expect(m.layer).toBe('L3');
    expect(m.content).toBe(LAYERS.L3);
    expect(m.content_l4).toBeUndefined();
    expect(m.content_l5).toBeUndefined();
    expect(m.content_l6).toBe(LAYERS.L6);
    expect(Object.keys(m.layer_specs ?? {})).toEqual(['L1', 'L2', 'L3', 'L6']);
  });

  it('LLM 调用异常 → 保留已生成层，refine_error 如实返回', async () => {
    const { storage, ctx } = setup();
    const llm = layerLlm({ L3: new Error('upstream 502') });
    const r = await coreWrite(
      { content: BASE, category: 'fact', project_id: 'P1' },
      ctx({ llm, llmModel: 'real-model' }),
    );
    expect(r.refine_error).toContain('upstream 502');
    expect(r.refined_by).toBe('llm_partial'); // 批次27 P2-4：仅 L2 已生成即异常中断
    const m = (await storage.getMemory(r.mem_id))!;
    expect(m.layer).toBe('L2');
    expect(m.content_l3).toBeUndefined();
  });
});

describe('分支嫁接的 L0 语义（新记忆各自加密，绝不并入目标）', () => {
  it('加密记忆被命中 → 新记忆带自己的 L0 密文；目标密文原样保留', async () => {
    const { storage, ctx } = setup();
    const first = await coreWrite(
      { content: 'deploy vault service alpha cluster', category: 'fact', project_id: 'P1' },
      ctx(),
    );
    const before = (await storage.getMemory(first.mem_id))!;
    expect(before.content_l0_enc).toBeTruthy();

    const second = await coreWrite(
      { content: 'deploy vault service alpha cluster beta', category: 'fact', project_id: 'P1' },
      ctx(),
    );
    expect(second.dedup.action).toBe('grafted');
    expect(second.dedup.graft_to).toBe(first.mem_id);

    const created = (await storage.getMemory(second.mem_id))!;
    expect(created.content_orig).toBeUndefined();
    expect(created.content_l0_enc).toBeTruthy();
    expect(created.content_l0_enc).not.toContain('beta'); // v2 密文不含原文
    const unlock = await sharedVault.unlock({ password: TEST_ADMIN_PW, user_id: 'u1' });
    await expect(sharedVault.decrypt({
      l0_session_id: unlock.l0_session_id, project_id: 'P1', mem_id: created.mem_id, envelope: created.content_l0_enc!,
    })).resolves.toContain('beta');

    const target = (await storage.getMemory(first.mem_id))!;
    expect(target.content_l0_enc).toBe(before.content_l0_enc); // 目标不被重加密/并入
    expect(target.content_l1).toBe(before.content_l1);
    expect(target.grafted_from).toEqual([created.mem_id]);
  });

  it('写密钥已锁定 → 写入直接 E_L0_LOCKED（不落明文、不产生嫁接）', async () => {
    const { storage, ctx } = setup();
    const first = await coreWrite(
      { content: 'deploy vault service alpha cluster', category: 'fact', project_id: 'P1' },
      ctx(),
    );
    const locked = (await createTestVault()).vault;
    await locked.lockWrite({ admin_user_id: 'admin' });
    await expect(coreWrite(
      { content: 'deploy vault service alpha cluster gamma', category: 'fact', project_id: 'P1' },
      ctx({ l0: locked }),
    )).rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    const mems = await storage.listMemories({});
    expect(mems).toHaveLength(1); // 只有首条；锁定后无新记忆
    expect((await storage.getMemory(first.mem_id))!.content_orig).toBeUndefined();
  });
});
