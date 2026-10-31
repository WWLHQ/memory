// Phase C3 验收：模型配置真落盘 / dry-run 模拟 / 向量连通测试如实
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USAGES } from '../catalog.ts';
import { coreLoadSources, coreSaveConfig, coreSimulateAuto, coreVectorCount, coreVectorProbe } from '../coreModels.ts';
import { clearModelConfig, hydrateUsages, readModelConfig, sanitizeUsages, writeModelConfig } from '../modelConfig.ts';
import { getKernel, getKernelStorage, getKernelWithSeed, rebuildKernelFromModelConfig, resetKernelForTests } from '../../kernel.ts';
import type { UsageConfig } from '../types.ts';

beforeEach(() => {
  clearModelConfig();
  resetKernelForTests();
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
    expect(out.entry.kind).toBe('model_config');

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

describe('模拟 dry-run（Phase C3）', () => {
  it('coreSimulateAuto 不写审计、不扣额度，重复模拟结果稳定', async () => {
    const storage = getKernelStorage();
    const out1 = await coreSimulateAuto(0.01, 2);
    expect(out1.dryRun).toBe(true);
    expect(out1.source?.agent).toBe('claude-code'); // 免费优先
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
      detail: { llm_proxy_source: 'agent:codex', model: 'gpt4o-mini', cost: 2.5, mode: 'auto' },
    });
    const out = await coreSimulateAuto(0.01, 3); // 当日已花 ¥2.5 ≤ cap ¥3 → 免费优先
    expect(out.source?.agent).toBe('claude-code');
    const sources = await coreLoadSources();
    expect(sources.find((s) => s.model === 'gpt4o-mini')?.used).toBe(1);

    const capped = await coreSimulateAuto(0.01, 2); // 已花 ¥2.5 > cap ¥2 → 回退本地
    expect(capped.source).toBeNull();
    expect(capped.reason).toContain('回退本地');
  });
});

describe('向量连通测试（Phase C3 如实）', () => {
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
