// Phase C3 验收：模型配置真落盘 / dry-run 模拟 / 向量嵌入探测如实
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USAGES } from '../catalog.ts';
import { coreLoadSources, coreSaveConfig, coreSimulateAuto, coreVectorCount, coreVectorProbe } from '../coreModels.ts';
import { clearModelConfig, hydrateUsages, readModelConfig, sanitizeUsages, writeModelConfig } from '../modelConfig.ts';
import { getKernel, getKernelStorage, getKernelWithSeed, rebuildKernelFromModelConfig, resetKernelForTests } from '../../kernel.ts';
import { applyHostLlmSnapshot, type LlmGatewaySnapshot } from '../../hostLlm.ts';
import { coreSaveParams } from '../../params/coreParams.ts';
import { DEFAULT_CONFIG, DEFAULT_DEV, DEFAULT_KB_POLICIES } from '../../params/defaults.ts';
import type { UsageConfig } from '../types.ts';

beforeEach(() => {
  clearModelConfig();
  resetKernelForTests();
  applyHostLlmSnapshot(null); // 还原快照：默认无网关（诚实空态），模拟测试另行注入
});

function usagesWithKey(apiKey: string): Record<'write' | 'judge' | 'rerank' | 'growth', UsageConfig> {
  return {
    ...hydrateUsages(),
    write: { ...DEFAULT_USAGES.write, apiKey },
  };
}

describe('模型配置持久化（Phase C3）', () => {
  it('writeModelConfig/readModelConfig：非法数据回读为 null', () => {
    localStorage.setItem('mam.modelConfig.v1', JSON.stringify({ vectorKey: 'nope', dims: 64 }));
    expect(readModelConfig()).toBeNull();
    localStorage.setItem('mam.modelConfig.v1', JSON.stringify({ vectorKey: 'st', dims: -1 }));
    expect(readModelConfig()).toBeNull();
    localStorage.setItem('mam.modelConfig.v1', '{ broken json');
    expect(readModelConfig()).toBeNull();
  });

  it('sanitizeUsages 去除 API Key 明文（R2）；hydrateUsages 回填默认值', () => {
    const persisted = sanitizeUsages(usagesWithKey('sk-secret'));
    expect('apiKey' in persisted.write).toBe(false);
    const hydrated = hydrateUsages(persisted);
    expect(hydrated.write.apiKey).toBe('');
    expect(hydrated.judge.temperature).toBe(0); // R4 默认
    expect(hydrated.write.local).toBe(true);
  });

  it('内核按已落盘维度构造：配置 768 维 → 新记忆 embedding = 768', async () => {
    writeModelConfig({ vectorKey: 'ds', dims: 768, updatedAt: Date.now() });
    resetKernelForTests(); // 清账本与内核单例，配置保留
    const m = await getKernelWithSeed()._seedMemory({ content: '维度接线验证 memory dim wiring', category: 'fact', project_id: 'P1' });
    expect(m.embedding).toHaveLength(768);
  });

  it('coreSaveConfig：落盘 + API Key 不落盘 + 已入库记忆按新维度重嵌入 + 内核重建', async () => {
    const seeded = await getKernelWithSeed()._seedMemory({ content: '配置前写入的记忆 pre-config memory', category: 'fact', project_id: 'P1' });
    expect(seeded.embedding).toHaveLength(64); // JS 起步默认维度

    const out = await coreSaveConfig('bge-m3', 'bge-m3（本地）', 1024, usagesWithKey('sk-should-not-persist'));
    expect(out.persisted).toBe(true);
    expect(out.reembedded).toBe(1);
    expect(out.entry.event).toBe('model_config'); // B6：真实事件类型，不再映射成 llm_proxy
    expect('llm_proxy_source' in out.entry).toBe(false);
    expect('cost' in out.entry).toBe(false);
    expect('mode' in out.entry).toBe(false);

    const cfg = readModelConfig();
    expect(cfg).toMatchObject({ vectorKey: 'bge-m3', dims: 1024 });
    expect('apiKey' in (cfg?.usages?.write ?? {})).toBe(false);

    const stored = await getKernelStorage().getMemory(seeded.mem_id);
    expect(stored?.embedding).toHaveLength(1024);

    // 内核已重建：后续写入使用新维度，且与新查询同维可比（cosine > 0）
    const after = await getKernelWithSeed()._seedMemory({ content: '配置后写入的记忆 post-config memory', category: 'fact', project_id: 'P1' });
    expect(after.embedding).toHaveLength(1024);
    const hits = await getKernel().recall({ query: 'post-config memory', project_id: 'P1' });
    expect(hits.hits.length).toBeGreaterThan(0);
    expect(hits.hits[0].score).toBeGreaterThan(0);

    // 维度未变 → 再次保存不重嵌入
    const again = await coreSaveConfig('bge-m3', 'bge-m3（本地）', 1024, usagesWithKey(''));
    expect(again.reembedded).toBe(0);
  });

  it('rebuildKernelFromModelConfig：重建后 getKernel 使用新维度且不丢账本', async () => {
    const before = await getKernelWithSeed()._seedMemory({ content: '账本保留验证 ledger survives rebuild', category: 'fact', project_id: 'P1' });
    writeModelConfig({ vectorKey: 'st', dims: 384, updatedAt: Date.now() });
    rebuildKernelFromModelConfig();
    expect(await coreVectorCount()).toBe(1);
    const next = await getKernelWithSeed()._seedMemory({ content: '重建后写入 after rebuild', category: 'fact', project_id: 'P1' });
    expect(next.embedding).toHaveLength(384);
    expect(await getKernelStorage().getMemory(before.mem_id)).not.toBeNull();
  });
});

describe('模拟 dry-run（Phase C3 / 阶段3-B 单一真源）', () => {
  // 反代理源单一真源：主进程网关快照（PROXY_CATALOG 已删除）。这里注入一份真实形态快照。
  const SNAPSHOT: LlmGatewaySnapshot = {
    usable: true,
    engines: [
      { id: 'e1', name: 'Local Ollama', enabled: true, baseURL: 'http://localhost:11434', model: 'local-llama', needsKey: false, keySet: false, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null },
      { id: 'e2', name: 'Cloud DeepSeek', enabled: true, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', needsKey: true, keySet: true, lastLatencyMs: 30, lastProbeAt: Date.now(), lastProbeOk: true },
    ],
    presets: [],
  };

  beforeEach(() => {
    applyHostLlmSnapshot(SNAPSHOT);
  });

  it('coreSimulateAuto 不写审计、不扣额度，免费优先，结果稳定', async () => {
    const storage = getKernelStorage();
    const out1 = await coreSimulateAuto(0.01, 2);
    expect(out1.dryRun).toBe(true);
    expect(out1.source?.agent).toBe('Local Ollama'); // 本地免费优先（isLocalBase）
    expect(await storage.queryAudit({})).toHaveLength(0);

    const out2 = await coreSimulateAuto(0.01, 2);
    expect(out2.source?.agent).toBe(out1.source?.agent);
    expect(await storage.queryAudit({})).toHaveLength(0);

    const sources = await coreLoadSources();
    expect(sources.every((s) => s.used === 0)).toBe(true);
  });

  it('账本中真实 llm_proxy 花费参与 cost_cap 判定（模拟仅读取）', async () => {
    const storage = getKernelStorage();
    await storage.appendAudit({
      request_id: 'req_cost_1', action: 'llm_proxy', ts: Date.now(),
      detail: { llm_proxy_source: 'agent:deepseek-chat', model: 'deepseek-chat', cost: 2.5, mode: 'auto' },
    });
    const out = await coreSimulateAuto(0.01, 3); // 当日已花 ¥2.5 ≤ cap ¥3 → 本地免费优先
    expect(out.source?.agent).toBe('Local Ollama');
    const sources = await coreLoadSources();
    expect(sources.find((s) => s.model === 'deepseek-chat')?.used).toBe(1);

    const capped = await coreSimulateAuto(0.01, 2); // 已花 ¥2.5 > cap ¥2 → 回退本地
    expect(capped.source).toBeNull();
    expect(capped.reason).toContain('回退本地');
  });
});

describe('反代理源单一真源不变式（阶段3-B 变异杀手）', () => {
  it('无网关快照（null）→ coreLoadSources 返回 []（绝不回退硬编码目录）', async () => {
    applyHostLlmSnapshot(null);
    const s = await coreLoadSources();
    expect(Array.isArray(s)).toBe(true);
    expect(s).toEqual([]); // 若有人重新硬编码 PROXY_CATALOG，这里会非空 → 失败
  });

  it('coreLoadSources 仅含快照引擎（与任何硬编码目录脱钩，多/少/伪造都不行）', async () => {
    applyHostLlmSnapshot({
      usable: true,
      engines: [
        { id: 'x', name: 'G1', enabled: true, baseURL: 'http://localhost:11434', model: 'only-snap-a', needsKey: false, keySet: false, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null },
        { id: 'y', name: 'G2', enabled: true, baseURL: 'https://api.deepseek.com', model: 'only-snap-b', needsKey: true, keySet: true, lastLatencyMs: 1, lastProbeAt: 1, lastProbeOk: true },
      ],
      presets: [],
    });
    const s = await coreLoadSources();
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.model).sort()).toEqual(['only-snap-a', 'only-snap-b']);
    // 双保险：任何遗留硬编码模型名都不得混入
    expect(s.some((x) => ['claude-free', 'glm-free', 'deepseek-v3', 'gpt4o-mini'].includes(x.model))).toBe(false);
    // 本地/云端档位映射正确（isLocalBase）
    expect(s.find((x) => x.agent === 'G1')?.tier).toBe('free');
    expect(s.find((x) => x.agent === 'G2')?.tier).toBe('cheap');
  });
});

describe('反代理单价/配额来自参数快照（批次48 A16）', () => {
  const SNAP: LlmGatewaySnapshot = {
    usable: true,
    engines: [
      { id: 'l', name: 'Local', enabled: true, baseURL: 'http://localhost:11434', model: 'local-a', needsKey: false, keySet: false, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null },
      { id: 'c', name: 'Cloud', enabled: true, baseURL: 'https://api.deepseek.com', model: 'cloud-a', needsKey: true, keySet: true, lastLatencyMs: 5, lastProbeAt: 1, lastProbeOk: true },
    ],
    presets: [],
  };

  it('未设置 → 云端 price/quota 为 null（如实未设置），本地=free/不限量；保存快照后真实生效', async () => {
    applyHostLlmSnapshot(SNAP);
    const before = await coreLoadSources();
    expect(before.find((s) => s.agent === 'Local')?.quota).toBe(Number.POSITIVE_INFINITY);
    expect(before.find((s) => s.agent === 'Cloud')?.price).toBeNull();
    expect(before.find((s) => s.agent === 'Cloud')?.quota).toBeNull();
    // 未设置的云端源不进入内核路由 → 自动模拟只可能选本地
    const sim0 = await coreSimulateAuto(0.05, 10);
    expect(sim0.source?.agent).toBe('Local');

    // 参数页真实保存链路（preference 快照，pinned）
    await coreSaveParams(
      { ...DEFAULT_CONFIG, proxy_price_cny_per_kcall: 0.02, proxy_daily_quota: 5000 },
      DEFAULT_KB_POLICIES, DEFAULT_DEV, 'req_a16',
    );
    // 重新读取账本快照（等价于刷新/重启后的回读路径）
    const after = await coreLoadSources();
    expect(after.find((s) => s.agent === 'Cloud')?.price).toBe(0.02);
    expect(after.find((s) => s.agent === 'Cloud')?.quota).toBe(5000);
  });
});

describe('向量嵌入探测（Phase C3 如实 / 阶段4-F 重标注）', () => {
  it('本地档真实嵌入成功，文案注明 hash 起步实现', async () => {
    const r = await coreVectorProbe('st', '');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('JsVectorBackend');
    expect(r.message).toContain('384 维');
    expect(r.message).toContain('权重尚未加载');
  });

  it('云端档未接入通道 → 未验证（不得谎报通过）', async () => {
    const noKey = await coreVectorProbe('ds', '');
    expect(noKey.ok).toBe(false);
    expect(noKey.message).toContain('未验证');
    const withKey = await coreVectorProbe('ds', 'sk-demo');
    expect(withKey.ok).toBe(false);
    expect(withKey.message).toContain('云端嵌入通道尚未接入');
  });
});
