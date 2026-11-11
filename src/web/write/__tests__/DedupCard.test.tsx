import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DedupCard } from '../DedupCard.tsx';
import { DEDUP_THRESHOLDS } from '../../../core/memagent/layerRules.ts';
import type { DedupResult } from '../types.ts';

const make = (over: Partial<DedupResult> = {}): DedupResult => ({
  score: 0.86,
  threshold: DEDUP_THRESHOLDS.L1,
  layer: 'L1',
  is_duplicate: true,
  ...over,
});

describe('DedupCard（批次25 P0-3 诚实化）', () => {
  it('只画一条真实词面分，不再画五条假刻度', () => {
    render(<DedupCard result={make({})} />);
    expect(screen.getAllByTestId('dedup-bar')).toHaveLength(1);
    expect(screen.getByTestId('dedup-score')).toHaveTextContent('0.86');
    expect(screen.getByTestId('dedup-bar').getAttribute('style')).toContain('86%');
  });

  it('不出现 semantic/keyword/entity/structure/llm_judge 这些没实算过的维度名', () => {
    render(<DedupCard result={make({})} />);
    for (const dim of ['semantic', 'keyword', 'entity', 'structure', 'llm_judge']) {
      expect(screen.queryByText(new RegExp(dim))).not.toBeInTheDocument();
    }
  });

  it('命中 → hit 高亮 + 说明是预览而非入库判定', () => {
    render(<DedupCard result={make({ is_duplicate: true })} />);
    expect(screen.getByTestId('dedup-card').className).toContain('hit');
    expect(screen.getByTestId('dedup-verdict')).toHaveTextContent('词面 0.86 / 阈值 0.70');
    expect(screen.getByTestId('dedup-verdict')).toHaveTextContent('预览提示可能重复');
  });

  it('未命中 → 不高亮', () => {
    render(<DedupCard result={make({ is_duplicate: false, score: 0.2 })} />);
    expect(screen.getByTestId('dedup-card').className).toBe('wf-card wf-dedup');
    expect(screen.getByTestId('dedup-verdict')).toHaveTextContent('预览未见重复');
  });

  it('说明真判重在内核提交时按四维执行，且未接大模型时只查 L1', () => {
    render(<DedupCard result={make({})} />);
    expect(screen.getByTestId('dedup-note')).toHaveTextContent('内核');
    expect(screen.getByTestId('dedup-note')).toHaveTextContent('四维');
    expect(screen.getByTestId('dedup-note')).toHaveTextContent('未接入大模型时只查 L1');
  });

  it('命中既有记忆 → 展示跳转链接', () => {
    render(<DedupCard result={make({ matched: { id: 'mem_001', content: 'x' } })} />);
    expect(screen.getByTestId('matched-link')).toHaveAttribute('href', '/memory.html');
  });

  it('不再提供点了不生效的「合并/覆盖/保留」三模式按钮', () => {
    render(<DedupCard result={make({})} />);
    for (const id of ['op-merge', 'op-overwrite', 'op-keep']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });
});
