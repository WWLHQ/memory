import { describe, it, expect } from 'vitest';
import {
  estimateTokens, needsRefine, validateDraft, scoreDedup, thresholdForLayer, composeReceipt, jaccard,
} from '../logic.ts';
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

describe('scoreDedup', () => {
  const existing = [{ id: 'm1', content: '内存泄漏踩坑' }];
  it('完全重复 → composite 高 → is_duplicate', () => {
    const r = scoreDedup('内存泄漏踩坑', existing, 'L3');
    expect(r.composite).toBeGreaterThanOrEqual(r.threshold);
    expect(r.is_duplicate).toBe(true);
    expect(r.matched?.id).toBe('m1');
  });
  it('完全不同 → composite 低 → 非重复', () => {
    const r = scoreDedup('天气晴朗宜出行', existing, 'L3');
    expect(r.is_duplicate).toBe(false);
    expect(r.matched).toBeUndefined();
  });
  it('阈值随层升高（L1 0.7 … L6 0.9）', () => {
    expect(thresholdForLayer('L1')).toBeLessThan(thresholdForLayer('L6'));
    expect(thresholdForLayer('L6')).toBe(0.9);
    expect(thresholdForLayer('L1')).toBe(0.7);
  });
  it('五维加权和 = composite', () => {
    const r = scoreDedup('内存泄漏踩坑', existing, 'L3');
    const expectComposite = Math.round(
      (r.dims.semantic * 0.35 + r.dims.keyword * 0.2 + r.dims.entity * 0.15 + r.dims.structure * 0.1 + r.dims.llm_judge * 0.2) * 100,
    ) / 100;
    expect(r.composite).toBe(expectComposite);
  });
});

describe('composeReceipt', () => {
  it('生成 memory_id 与 L1–L6 层，L1 仅审计展开', () => {
    const r = composeReceipt('某记忆内容');
    expect(r.memory_id).toMatch(/^mem_/);
    expect(Object.keys(r.layers)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(r.layers.L1.auditOnly).toBe(true);
    expect(r.layers.L2.auditOnly).toBeFalsy();
    expect(r.dedup_action).toBe('create');
  });
});
