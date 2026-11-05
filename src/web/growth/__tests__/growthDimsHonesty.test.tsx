// 批次42 阶段4（4-E / B4）：五维判重样本「兜底填数」接真的变异杀手。
// 旧实现给无 sim 的记忆编造 semantic=0.5、用层号自造 structure、把未接 LLM 的 judge 记 0
// 并在 UI 显示 0.00，注释却自称「诚实口径」。接真后：无可信测量的维度记 null、
// UI 显示「未测量」，综合分按已测维度权重归一化（与内核 fourDimScore 无 LLM 口径一致）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Memory } from '../../../core/memagent/types.ts';
import { samplesFromMemories } from '../useGrowthReal.ts';
import { weightedScore } from '../logic.ts';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../spec.ts';
import { DedupCard } from '../DedupCards.tsx';
import type { DedupSample, DimKey } from '../types.ts';

function mem(o: Partial<Memory> & { mem_id: string; content: string }): Memory {
  return {
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1', category: 'fact', layer: 'L1',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: 1000,
    ...o,
  };
}

describe('B4：五维样本只填有可信测量的维度（不再兜底填数）', () => {
  it('杀手①：无 sim / 无 LLM 仲裁 → semantic/structure/llm_judge 均为 null', () => {
    const [s] = samplesFromMemories(
      [mem({ mem_id: 'a', content: '部署脚本必须校验 Redis 连接', layer: 'L4' })], 1,
    );
    const dims = s.dims as Record<DimKey, number | null>;
    expect(dims.semantic).toBeNull();   // 不再是编造的 0.5
    expect(dims.structure).toBeNull();  // 不再是 0.2+0.2×(层号−1)
    expect(dims.llm_judge).toBeNull();  // 不再是「0 分」
    expect(dims.keyword).toBeGreaterThan(0);
    expect(typeof dims.entity).toBe('number');
  });

  it('杀手②：账本行上有真实 sim → 原值透传（不编造、不覆盖）', () => {
    const [s] = samplesFromMemories([mem({ mem_id: 'b', content: 'deploy docker guide', sim: 0.83 })], 1);
    expect(s.dims.semantic).toBe(0.83);
    expect(s.dims.llm_judge).toBeNull();
  });

  it('杀手③：weightedScore 按已测维度权重归一化，五维齐全时保持原契约', () => {
    const full: Record<DimKey, number | null> = {
      semantic: 0.91, keyword: 0.62, entity: 0.70, structure: 0.55, llm_judge: 0.88,
    };
    expect(weightedScore(full, DEFAULT_WEIGHTS)).toBe(0.779); // 既有 logic.test.ts 契约不变
    const partial: Record<DimKey, number | null> = {
      semantic: null, keyword: 0.5, entity: 0.5, structure: null, llm_judge: null,
    };
    // 只累加 keyword(0.20)+entity(0.15)，按 0.35 归一化 → 0.5（不是把 null 当 0 拉低成 0.175）
    expect(weightedScore(partial, DEFAULT_WEIGHTS)).toBe(0.5);
    expect(weightedScore({
      semantic: null, keyword: null, entity: null, structure: null, llm_judge: null,
    }, DEFAULT_WEIGHTS)).toBe(0);
  });

  it('杀手④（UI）：未测量维显示「未测量」，不显示 0.00；综合分只按已测维算', () => {
    const sample: DedupSample = {
      id: 'x', label: '真实记忆样本', target: 'L1',
      dims: { semantic: null, keyword: 0.5, entity: 0.5, structure: null, llm_judge: null },
    };
    render(<DedupCard
      sample={sample} weights={DEFAULT_WEIGHTS} thresholds={DEFAULT_THRESHOLDS} onResample={() => {}}
    />);
    expect(screen.getByTestId('dim-semantic').textContent).toBe('未测量');
    expect(screen.getByTestId('dim-structure').textContent).toBe('未测量');
    expect(screen.getByTestId('dim-llm_judge').textContent).toBe('未测量');
    expect(screen.getByTestId('dim-keyword').textContent).toBe('0.50');
    expect(screen.getByTestId('dedup-score').textContent).toContain('0.500');
  });
});

describe('B4：源码不得回流演示级兜底填数', () => {
  // cwd 字符串路径：本机 fs shim 不接受 vitest 转换后的 URL 对象（见 4-C 记录）
  const src = readFileSync(resolve(process.cwd(), 'src/web/growth/useGrowthReal.ts'), 'utf8');

  it('杀手⑤：不出现 0.5 兜底 / 层号自造公式 / judge 记 0', () => {
    expect(src).not.toMatch(/m\.sim \?\? 0\.5/);
    expect(src).not.toMatch(/0\.2 \+ 0\.2 \*/);
    expect(src).not.toMatch(/llm_judge = 0/);
    expect(src).toMatch(/semantic: m\.sim \?\? null/);
  });
});
