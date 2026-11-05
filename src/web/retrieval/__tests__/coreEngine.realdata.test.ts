// 批次42 阶段2 · Gate C 变异验证（2-A / 2-B）
// 目的：锁定 coreEngine 不得回退到任何「写死 / 伪造」的真实数据。
// 变异算子：① pipeline_llm_tokens 640→0 反向；② breach_detail 写死估算文案；③ payload_tokens 伪造 3100；④ project_id 写死 'P1'。
// 任一变异若未被本文件断言拦截，即视为 Gate C 失效（测试无法「杀死」变异）。
import { describe, it, expect, beforeEach } from 'vitest';
import { coreEngine } from '../coreEngine.ts';
import { resetKernelForTests, getKernelWithSeed } from '../../kernel.ts';

const SEED = { content: '缓存 TTL 设为 300s（生产默认）', category: 'fact', project_id: 'P-real' } as const;

describe('coreEngine 真实数据不变量（Gate C 变异验证）', () => {
  beforeEach(() => resetKernelForTests());

  it('pipeline_llm_tokens 恒为 0（不得回退写死 640）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c1');
    expect(r.budget.pipeline_llm_tokens).toBe(0);
  });

  it('breach_detail 恒为 undefined（不得回退写死估算文案 "L2 摘要 × 1 条"）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c2');
    expect(r.budget.breach_detail).toBeUndefined();
  });

  it('payload_tokens 来自内核真 recall（不得是伪造 3100，命中为真实正数值）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c3');
    expect(r.budget.payload_tokens).not.toBe(3100);
    expect(r.budget.payload_tokens).toBeGreaterThan(0);
  });

  it('project_id 从 listProjectIds 真实派生（写死 P1 会因项目过滤导致 0 命中）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c4');
    // 真实派生 → 命中真实项目下的记忆；若写死 'P1' 则过滤掉 'P-real' → 0 命中
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
  });
});
