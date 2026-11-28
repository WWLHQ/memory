// #46 统计口径迁移：resolveEvidenceThin 归一真源的单测（含变异反向验证）。
import { describe, it, expect } from 'vitest';
import {
  resolveEvidenceThin,
  recomputeFromDetail,
  EVIDENCE_THIN_RULE,
} from '../evidenceThin.ts';

// 一周窗口真实 mems_detail 行形状：[mem_id, relevance, f, imp, conf, boost]
const detail = (relevance: number) => ({
  mems_detail: [['mem_x', relevance, 0.5, 0.5, 0.5, 1]],
});

describe('resolveEvidenceThin 优先级', () => {
  it('1. corrected 字段优先于一切（回填真值）', () => {
    expect(resolveEvidenceThin({
      evidence_thin_corrected: false,
      evidence_thin: true,
      evidence_thin_rule: 'relevance',
      mems_detail: [['mem_x', 0.1, 0, 0, 0, 1]],
    })).toEqual({ thin: false, source: 'corrected' });
  });

  it('2. 新口径自证行（rule=relevance）直接用原值', () => {
    expect(resolveEvidenceThin({
      evidence_thin: true,
      evidence_thin_rule: EVIDENCE_THIN_RULE,
      // 注意：这条 mems_detail 的 relevance 高，rule 分支必须优先于重算
      mems_detail: [['mem_x', 0.9, 0, 0, 0, 1]],
    })).toEqual({ thin: true, source: 'relevance' });
  });

  it('3. 历史行有 mems_detail → 按 relevance 实时重算（低相关判 thin）', () => {
    expect(resolveEvidenceThin(detail(0.1))).toEqual({ thin: true, source: 'recomputed' });
  });

  it('3b. 历史行重算：高相关不判 thin（纠正旧 score 口径假象）', () => {
    expect(resolveEvidenceThin({ evidence_thin: true, ...detail(0.9) }))
      .toEqual({ thin: false, source: 'recomputed' });
  });

  it('4. 无 rule、无 mems_detail 的历史行 → null 不可用（旧 score 假象不冒充真值）', () => {
    expect(resolveEvidenceThin({ evidence_thin: true }))
      .toEqual({ thin: null, source: 'legacy' });
    expect(resolveEvidenceThin({ evidence_thin: false }))
      .toEqual({ thin: null, source: 'legacy' });
  });

  it('5. 无可信口径 → null（不拿 false 冒充）', () => {
    expect(resolveEvidenceThin({})).toEqual({ thin: null, source: 'unknown' });
    expect(resolveEvidenceThin(null)).toEqual({ thin: null, source: 'unknown' });
    expect(resolveEvidenceThin(undefined)).toEqual({ thin: null, source: 'unknown' });
    expect(resolveEvidenceThin('x')).toEqual({ thin: null, source: 'unknown' });
  });
});

describe('recomputeFromDetail 边界', () => {
  it('无 mems_detail / 空数组 → null', () => {
    expect(recomputeFromDetail({})).toBeNull();
    expect(recomputeFromDetail({ mems_detail: [] })).toBeNull();
  });

  it('有 mems_detail 但 relevance 全部不可解析 → null（不拿 score 冒充）', () => {
    expect(recomputeFromDetail({ mems_detail: [['mem_x', 'bad', 0, 0, 0, 1]] })).toBeNull();
  });

  it('阈值边界：恰好 0.3 不算 thin（every(<0.3)）', () => {
    expect(recomputeFromDetail(detail(0.3))).toBe(false);
    expect(recomputeFromDetail(detail(0.299))).toBe(true);
  });

  it('兼容对象形状 { relevance }（工具侧解析）', () => {
    expect(recomputeFromDetail({ mems_detail: [{ relevance: 0.1 }] })).toBe(true);
  });

  it('多条命中：全部 <0.3 才 thin，有一条高相关即非 thin', () => {
    expect(recomputeFromDetail({ mems_detail: [['a', 0.1, 0, 0, 0, 1], ['b', 0.8, 0, 0, 0, 1]] })).toBe(false);
  });
});
