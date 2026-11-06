// 批次48 A23：内核查重确实按账本策略（权重/阈值）执行，不再只读常量
import { describe, expect, it } from 'vitest';
import type { Memory } from '../types.ts';
import { findDuplicate, weightedDedupScore, type DedupPolicy } from '../dedup.ts';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../../../shared/growthConfig.ts';

function mem(text: string): Memory {
  return { mem_id: 'm1', content_l1: text } as unknown as Memory;
}

describe('findDuplicate 按账本策略执行', () => {
  it('阈值取 policy.thresholds，而不是 DEDUP_THRESHOLDS 常量', async () => {
    const policy: DedupPolicy = { weights: DEFAULT_WEIGHTS, thresholds: { ...DEFAULT_THRESHOLDS, L1: 0.99 } };
    const out = await findDuplicate(
      '内存泄漏排查：进程 RSS 持续上涨，dump 后定位到缓存未释放',
      'L1',
      [mem('内存泄漏排查：RSS 持续上涨，抓 dump 后确认缓存没有释放')],
      { dim: 64, request_id: 't-policy', policy },
    );
    expect(out.threshold).toBe(0.99);
    expect(out.best).not.toBeNull();
    expect(out.best!.score).toBeLessThan(0.99);
  });

  it('权重取 policy.weights：关键词权重更高时同一组维度分更高', () => {
    const dims = { semantic: 0.2, keyword: 0.9, entity: 0.3, structure: 0.4 };
    const base = weightedDedupScore(dims, DEFAULT_WEIGHTS);
    const keywordHeavy = weightedDedupScore(dims, {
      semantic: 0.05, keyword: 0.60, entity: 0.20, structure: 0.05, llm_judge: 0.10,
    });
    expect(keywordHeavy).toBeGreaterThan(base);
  });
});
