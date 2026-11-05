import { describe, it, expect } from 'vitest';
import {
  estimateTokens, needsRefine, validateDraft, scoreDedup, thresholdForLayer, composeReceipt, jaccard,
} from '../logic.ts';
import { DEDUP_THRESHOLDS } from '../../../core/memagent/layerRules.ts';
import type { MemoryDraft } from '../types.ts';

const draft = (over: Partial<MemoryDraft>): MemoryDraft => ({
  content: 'x', category: 'fact', tags: [], source: 'conversation', session_id: 's1', project_id: 'p1', ...over,
});

describe('estimateTokens', () => {
  it('CJK ≈ 2 token/字', () => {
    expect(estimateTokens('你好世界')).toBe(8); // 4 字 * 2
  });
  it('英文词 ≈ 1.3 token/词（空格被剥离，按连续字母计）', () => {
    expect(estimateTokens('helloworld')).toBe(1); // 1 个连续字母串 * 1.3 → 1
    expect(estimateTokens('abc')).toBe(1);
  });
});

describe('needsRefine', () => {
  it('≥500 字触发精炼提示', () => {
    expect(needsRefine('字'.repeat(500))).toBe(true);
    expect(needsRefine('字'.repeat(499))).toBe(false);
  });
});

describe('validateDraft', () => {
  it('content 空 → 不通过', () => {
    const r = validateDraft(draft({ content: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('内容不能为空');
  });
  it('project_id 空 → 不通过（R2）', () => {
    const r = validateDraft(draft({ project_id: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('project_id 必填（全局注入，不可为空）');
  });
  it('有效草稿 → 通过', () => {
    expect(validateDraft(draft({ content: 'abc' })).ok).toBe(true);
  });
});

describe('jaccard', () => {
  it('完全相同 → 1', () => {
    expect(jaccard('内存泄漏踩坑', '内存泄漏踩坑')).toBe(1);
  });
  it('完全不同 → 0', () => {
    expect(jaccard('内存泄漏踩坑', '天气晴朗')).toBe(0);
  });
});

describe('scoreDedup（批次25 P0-3：单值本地词面预览，不再伪造五维）', () => {
  const existing = [{ id: 'm1', content: '内存泄漏踩坑' }];
  it('完全重复 → 词面分 = 1 → 命中', () => {
    const r = scoreDedup('内存泄漏踩坑', existing, 'L3');
    expect(r.score).toBe(1);
    expect(r.is_duplicate).toBe(true);
    expect(r.matched?.id).toBe('m1');
  });
  it('返回值只有词面分：没有 dims / composite 这类合成维度', () => {
    const r = scoreDedup('内存泄漏踩坑', existing, 'L3');
    expect(r).not.toHaveProperty('dims');
    expect(r).not.toHaveProperty('composite');
    expect(Object.keys(r).sort()).toEqual(['is_duplicate', 'layer', 'matched', 'score', 'threshold']);
  });
  it('部分重合 → 分数就是 Jaccard 本身（不做仿射放大）', () => {
    const content = '内存泄漏踩坑复盘';
    const r = scoreDedup(content, existing, 'L3');
    expect(r.score).toBeCloseTo(jaccard(content, '内存泄漏踩坑'), 10);
    // 词面 0.75 < L3 阈值 0.80 → 未命中（旧版把这 0.75 摊成五条维度分再加权，判定依据是假的）
    expect(r.is_duplicate).toBe(false);
  });
  it('完全不同 → 0 分 → 非重复、无匹配', () => {
    const r = scoreDedup('天气晴朗宜出行', existing, 'L3');
    expect(r.score).toBe(0);
    expect(r.is_duplicate).toBe(false);
    expect(r.matched).toBeUndefined();
  });
  it('无候选（空账本）→ 0 分、未命中，不假装有比对对象', () => {
    const r = scoreDedup('任意内容', [], 'L3');
    expect(r.score).toBe(0);
    expect(r.is_duplicate).toBe(false);
    expect(r.matched).toBeUndefined();
  });
  it('阈值取内核单一真源 DEDUP_THRESHOLDS（页面不得另立一套；L5 曾写 0.88，内核是 0.90）', () => {
    for (const ln of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const) {
      expect(thresholdForLayer(ln)).toBe(DEDUP_THRESHOLDS[ln]);
    }
    expect(thresholdForLayer('L5')).toBe(0.9);
    expect(scoreDedup('内存泄漏踩坑', existing, 'L5').threshold).toBe(DEDUP_THRESHOLDS.L5);
  });
  it('默认按 L1 预览：未接入大模型时内核只对 L1 查重（原来是硬写 L3）', () => {
    const r = scoreDedup('内存泄漏踩坑', existing);
    expect(r.layer).toBe('L1');
    expect(r.threshold).toBe(DEDUP_THRESHOLDS.L1);
  });
});

describe('composeReceipt', () => {
  it('无 LLM：只标 L1 产出，L2–L6 明确「未精炼」', () => {
    const r = composeReceipt('某记忆内容', 'create', {
      memoryId: 'mem_real_1',
      layers: { content_l1: '某记忆内容' },
      refinedBy: 'stub',
    });
    expect(r.memory_id).toBe('mem_real_1');
    expect(Object.keys(r.layers)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(r.layers.L1.produced).toBe(true);
    expect(r.layers.L1.auditOnly).toBe(true);
    expect(r.layers.L1.text).toBeUndefined(); // L1 原文仅审计展开
    for (const ln of ['L2', 'L3', 'L4', 'L5', 'L6'] as const) {
      expect(r.layers[ln].produced).toBe(false);
      expect(r.layers[ln].summary).toContain('未精炼');
    }
    expect(r.refined_by).toBe('stub');
    expect(r.dedup_action).toBe('create');
  });

  it('LLM 真实产物：对应层展示真实文本', () => {
    const r = composeReceipt('x', 'create', {
      layers: { content_l1: 'l1', content_l2: '真实 L2 摘要' },
      refinedBy: 'llm',
    });
    expect(r.layers.L2.produced).toBe(true);
    expect(r.layers.L2.text).toBe('真实 L2 摘要');
    expect(r.layers.L3.produced).toBe(false);
    expect(r.layers.L3.summary).toContain('未精炼');
  });

  it('重复保留（duplicated→keep）：回执说明本次未新建层', () => {
    // 阶段5-E / B10：内核不存在 merge 动作，旧用例用伪造的 'merge' 测同一分支，改走真实 keep。
    const r = composeReceipt('x', 'keep');
    expect(r.layers.L1.produced).toBe(false);
    expect(r.layers.L1.summary).toContain('已保留原记忆');
    expect(r.layers.L1.summary).toContain('未新建层');
  });

  it('分支嫁接：本次新建的分支层照实展示，不伪装成合并且不丢层', () => {
    const r = composeReceipt('x', 'graft', {
      layers: { content_l1: 'l1' },
      refinedBy: 'stub',
    });
    expect(r.dedup_action).toBe('graft');
    expect(r.layers.L1.produced).toBe(true);
    expect(r.layers.L1.summary).toContain('分支嫁接');
    expect(r.layers.L2.produced).toBe(false);
  });
});
