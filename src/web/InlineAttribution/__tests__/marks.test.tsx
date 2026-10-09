// REQ-004 T3/T4/T5/T6/T8 验收：四类标记渲染 + 配置可见性（诚实约束）
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttributionConfigProvider } from '../AttributionConfig.tsx';
import { MemoryInjectionTag } from '../MemoryInjectionTag.tsx';
import { TokenSavingBar } from '../TokenSavingBar.tsx';
import { BackgroundChip } from '../BackgroundChip.tsx';
import { AgingWarnTag } from '../AgingWarnTag.tsx';
import { AttributionSummary } from '../AttributionSummary.tsx';
import type {
  MemoryInjectionMark, TokenSaving, BackgroundMark, AgingWarnMark, WriteBackMark, AttributionLevel,
} from '../../../types/inlineAttribution.ts';

const inj = (over: Partial<MemoryInjectionMark> = {}): MemoryInjectionMark => ({
  memory_id: 'mem_005', summaryL2: '约束 <200ms', decay_class: 'cold', aging_hint: '', request_id: 'req_017', ...over,
});
const saving: TokenSaving = { actual_payload: 780, full_baseline: 1500, saved: 720, breakdown: [{ reason: '极简', tokens: 400 }] };
const bg: BackgroundMark = { count: 2, items: [{ id: 'mem_002', kind: 'stack', text: 'FastAPI' }, { id: 'mem_009', kind: 'decision', text: '选 FastAPI' }] };
const aging: AgingWarnMark = { kind: 'aging', text: '45 天前请校验', request_id: 'req_017' };
const thin: AgingWarnMark = { kind: 'evidence_thin', text: '证据不足', request_id: 'req_017' };
const wb: WriteBackMark = { memory_id: 'mem_030', request_id: 'req_018', summary: '新结论' };

const lvl = (level: AttributionLevel) => ({ show_memory_attribution: true, attribution_level: level });

describe('T3 MemoryInjectionTag', () => {
  it('四档衰减着色 + 仅 full 渲染', () => {
    for (const d of ['hot', 'warm', 'cold', 'dormant'] as const) {
      const { container } = render(<AttributionConfigProvider><MemoryInjectionTag mark={inj({ decay_class: d })} /></AttributionConfigProvider>);
      expect(container.querySelector(`.mem-tag.${d}`)).toBeTruthy();
    }
    const { container } = render(<AttributionConfigProvider value={lvl('token_only')}><MemoryInjectionTag mark={inj()} /></AttributionConfigProvider>);
    expect(container.querySelector('.mem-tag')).toBeNull();
  });

  it('弹层字段 + 干预回调', () => {
    const onFeedback = vi.fn();
    render(<AttributionConfigProvider><MemoryInjectionTag mark={inj()} onFeedback={onFeedback} /></AttributionConfigProvider>);
    fireEvent.click(screen.getByText('🧠'));
    expect(screen.getByText(/记忆注入 · mem_005/)).toBeTruthy();
    fireEvent.click(screen.getByText(/记住/));
    expect(onFeedback).toHaveBeenCalledWith('mem_005', 'confirm');
  });
});

describe('T4/T5/T8 普通标记', () => {
  it('off 级别不渲染', () => {
    const tree = (lv: AttributionLevel) => (
      <AttributionConfigProvider value={lvl(lv)}>
        <TokenSavingBar saving={saving} />
        <BackgroundChip mark={bg} />
        <AttributionSummary injections={[inj()]} saving={saving} writeBack={wb} />
      </AttributionConfigProvider>
    );
    const { container: off } = render(tree('off'));
    expect(off.querySelector('.tokbar')).toBeNull();
    expect(off.querySelector('.bgmark')).toBeNull();
    expect(off.querySelector('.attr-summary')).toBeNull();
    const { container: full } = render(tree('full'));
    expect(full.querySelector('.tokbar')).toBeTruthy();
    expect(full.querySelector('.bgmark')).toBeTruthy();
    expect(full.querySelector('.attr-summary')).toBeTruthy();
  });

  it('TokenSavingBar 展开分解', () => {
    render(<AttributionConfigProvider><TokenSavingBar saving={saving} /></AttributionConfigProvider>);
    expect(screen.getByText('720')).toBeTruthy();
    fireEvent.click(screen.getByText(/分解/));
    expect(screen.getByText(/极简/)).toBeTruthy();
  });
});

describe('T6 AgingWarnTag（诚实约束：恒显示）', () => {
  it('aging 在 off 仍渲染，可 confirm/reject', () => {
    const onFeedback = vi.fn();
    const { container } = render(<AttributionConfigProvider value={lvl('off')}><AgingWarnTag mark={aging} onFeedback={onFeedback} /></AttributionConfigProvider>);
    expect(container.querySelector('.warn-tag[data-kind=aging]')).toBeTruthy();
    fireEvent.click(screen.getByText(/我确认仍有效/));
    expect(onFeedback).toHaveBeenCalledWith('req_017', 'confirm');
  });
  it('evidence_thin 在 off 仍渲染，可切事实优先', () => {
    const onSwitch = vi.fn();
    const { container } = render(<AttributionConfigProvider value={lvl('off')}><AgingWarnTag mark={thin} onSwitchFactFirst={onSwitch} /></AttributionConfigProvider>);
    expect(container.querySelector('.warn-tag[data-kind=evidence_thin]')).toBeTruthy();
    fireEvent.click(screen.getByText(/切事实优先重试/));
    expect(onSwitch).toHaveBeenCalledWith('req_017');
  });
});
