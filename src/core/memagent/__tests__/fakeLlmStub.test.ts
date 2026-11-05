// 批次42 阶段3-A Gate C（变异杀手）：锁定 FakeLlmProvider 已退化为「零模型纯 stub」。
// 任何重新植入假模型表 / 假 call 输出的动作都必须使本文件失效（测试变红）。
import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../llm.ts';
import type { ModelInfo } from '../types.ts';

// 一个真实（由调用方经快照传入）的模型，用于证明 listModels 是纯透传、不硬编码兜底。
const REAL: ModelInfo = { model: 'real-refine', tier: 'free', price: 0, quota: 1000, used: 0 };

describe('FakeLlmProvider 零模型纯 stub（阶段3-A）', () => {
  it('默认零模型：listModels() 返回空数组（无内置假模型表 claude-free/gpt4o-mini/local-small）', () => {
    const p = new FakeLlmProvider();
    const ms = p.listModels();
    expect(Array.isArray(ms)).toBe(true);
    expect(ms).toHaveLength(0);
    // 双保险：任何硬编码假模型名都不得出现
    expect(ms.map((m) => m.model)).not.toContain('claude-free');
    expect(ms.map((m) => m.model)).not.toContain('gpt4o-mini');
    expect(ms.map((m) => m.model)).not.toContain('local-small');
  });

  it('纯透传：仅返回调用方显式传入的模型，不掺杂、不改写', () => {
    const p = new FakeLlmProvider([REAL]);
    const ms = p.listModels();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject(REAL);
    // 不得有任何硬编码兜底项混入
    expect(ms.map((m) => m.model)).toHaveLength(1);
  });

  it('call() 抛 E_QUOTA（诚实无可用模型，绝不伪造 L2–L6 输出）', async () => {
    const p = new FakeLlmProvider();
    await expect(p.call('real-refine', 'prompt', { request_id: 'r1', usage: 'test' }))
      .rejects.toMatchObject({ code: 'E_QUOTA' });
  });

  it('isStub 显式标记，供写入管线只落 L1', () => {
    const p = new FakeLlmProvider();
    expect(p.isStub).toBe(true);
  });
});
