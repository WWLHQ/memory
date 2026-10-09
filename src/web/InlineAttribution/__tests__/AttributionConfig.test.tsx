// REQ-004 T9 验收：配置上下文 isVisible 矩阵（诚实约束）+ Toggle 渲染
import { describe, it, expect } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import { AttributionConfigProvider, useAttributionConfig, type MarkKind } from '../AttributionConfig.tsx';
import { AttributionToggle } from '../AttributionToggle.tsx';
import type { AttributionLevel } from '../../../types/inlineAttribution.ts';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AttributionConfigProvider>{children}</AttributionConfigProvider>
);

describe('AttributionConfigProvider.isVisible 矩阵', () => {
  const kinds: MarkKind[] = ['injection', 'token', 'background', 'writeback', 'aging', 'evidence_thin'];

  it('full：全部显示', () => {
    const { result } = renderHook(() => useAttributionConfig(), { wrapper });
    const visible = kinds.filter((k) => result.current.isVisible(k));
    expect(visible).toEqual(kinds);
  });

  it('token_only：仅 injection 隐藏，aging/evidence_thin 仍显示', () => {
    const { result } = renderHook(() => useAttributionConfig(), {
      wrapper: ({ children }) => <AttributionConfigProvider value={{ show_memory_attribution: true, attribution_level: 'token_only' }}>{children}</AttributionConfigProvider>,
    });
    expect(result.current.isVisible('injection')).toBe(false);
    expect(result.current.isVisible('token')).toBe(true);
    expect(result.current.isVisible('background')).toBe(true);
    expect(result.current.isVisible('writeback')).toBe(true);
    expect(result.current.isVisible('aging')).toBe(true);
    expect(result.current.isVisible('evidence_thin')).toBe(true);
  });

  it('off：仅 aging/evidence_thin 恒显示（诚实约束）', () => {
    const { result } = renderHook(() => useAttributionConfig(), {
      wrapper: ({ children }) => <AttributionConfigProvider value={{ show_memory_attribution: true, attribution_level: 'off' }}>{children}</AttributionConfigProvider>,
    });
    expect(result.current.isVisible('injection')).toBe(false);
    expect(result.current.isVisible('token')).toBe(false);
    expect(result.current.isVisible('background')).toBe(false);
    expect(result.current.isVisible('writeback')).toBe(false);
    expect(result.current.isVisible('aging')).toBe(true);
    expect(result.current.isVisible('evidence_thin')).toBe(true);
  });

  it('show_memory_attribution=false：非诚实类全隐', () => {
    const { result } = renderHook(() => useAttributionConfig(), {
      wrapper: ({ children }) => <AttributionConfigProvider value={{ show_memory_attribution: false, attribution_level: 'full' }}>{children}</AttributionConfigProvider>,
    });
    expect(result.current.isVisible('injection')).toBe(false);
    expect(result.current.isVisible('aging')).toBe(true);
  });

  it('setLevel 生效', () => {
    const { result } = renderHook(() => useAttributionConfig(), { wrapper });
    act(() => result.current.setLevel('off' as AttributionLevel));
    expect(result.current.level).toBe('off');
    expect(result.current.isVisible('injection')).toBe(false);
  });
});

describe('AttributionToggle', () => {
  it('渲染三个级别且可切换', () => {
    const onChange = (l: AttributionLevel) => l;
    const { getByLabelText, container } = render(
      <AttributionConfigProvider>
        <AttributionToggle onChange={onChange} />
      </AttributionConfigProvider>,
    );
    expect(container.querySelectorAll('input[type=radio]')).toHaveLength(3);
    expect(getByLabelText(/完整/)).toBeChecked();
  });
});
