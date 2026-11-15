// M0-4：自生长效果结论卡 + 参数差异表 —— 用户能感知「好了还是坏了」，参数变化体现效果。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvolutionEffectCard } from '../GrowthPanels.tsx';
import type { RegressionRecord } from '../types.ts';

const adoptedRec: RegressionRecord = {
  requestId: 'reg_e', ts: 5000, kind: 'adopted', applied: true,
  before: { f1: 0.60, precision: 0.80 }, after: { f1: 0.65, precision: 0.79 },
  counts: { total: 40, positives: 10, negatives: 30, window_days: 30 },
  weightsBefore: { semantic: 0.35, keyword: 0.20, entity: 0.15, structure: 0.10, llm_judge: 0.20 },
  weightsAfter: { semantic: 0.30, keyword: 0.28, entity: 0.15, structure: 0.12, llm_judge: 0.20 },
  thresholdsBefore: { L1: 0.60, L2: 0.65, L3: 0.80, L4: 0.85, L5: 0.90, L6: 0.95 },
  thresholdsAfter: { L1: 0.60, L2: 0.65, L3: 0.78, L4: 0.85, L5: 0.90, L6: 0.95 },
};

describe('EvolutionEffectCard（M0-4）', () => {
  it('adopted：结论卡 good + 参数差异表含五维/六层 + llm_judge 固定保留标注', () => {
    render(<EvolutionEffectCard records={[adoptedRec]} />);
    const v = screen.getByTestId('evolution-verdict');
    expect(v.getAttribute('data-dir')).toBe('good');
    expect(v.textContent).toContain('改善了判重');
    expect(screen.getByTestId('param-diff-table')).toBeInTheDocument();
    expect(screen.getByTestId('threshold-diff-table')).toBeInTheDocument();
    // 变化项标注「已调整」
    expect(screen.getByTestId('dim-status-semantic').textContent).toBe('已调整');
    expect(screen.getByTestId('layer-status-L3').textContent).toBe('已调整');
    // 未变项标注「未变化」
    expect(screen.getByTestId('dim-status-entity').textContent).toBe('未变化');
    // llm_judge 固定保留（不参与调优）
    expect(screen.getByTestId('dim-status-llm_judge').textContent).toBe('固定保留（不参与调优）');
  });

  it('空记录：结论卡 empty + 参数差异表占位', () => {
    render(<EvolutionEffectCard records={[]} />);
    const v = screen.getByTestId('evolution-verdict');
    expect(v.getAttribute('data-dir')).toBe('empty');
    expect(screen.getByTestId('param-diff-empty')).toBeInTheDocument();
  });

  it('insufficient_samples：结论卡提示样本积累中（不得冒充「无变化」）', () => {
    const rec: RegressionRecord = {
      requestId: 'reg_i', ts: 1000, kind: 'insufficient_samples',
      counts: { total: 12, positives: 3, negatives: 9, window_days: 30 },
    } as RegressionRecord;
    render(<EvolutionEffectCard records={[rec]} />);
    const v = screen.getByTestId('evolution-verdict');
    expect(v.getAttribute('data-dir')).toBe('empty');
    expect(v.textContent).toContain('样本积累中');
  });

  it('not_adopted：结论卡 flat + 文本说明未达门槛未改动', () => {
    const rec: RegressionRecord = {
      requestId: 'reg_n', ts: 2000, kind: 'not_adopted', reason: 'f1_gain_below_threshold',
      before: { f1: 0.60, precision: 0.80 }, after: { f1: 0.61, precision: 0.79 },
    } as RegressionRecord;
    render(<EvolutionEffectCard records={[rec]} />);
    const v = screen.getByTestId('evolution-verdict');
    expect(v.getAttribute('data-dir')).toBe('flat');
    expect(v.textContent).toContain('未达采纳门槛');
  });
});
