// REQ-004 T1 验收：内联标识领域类型自洽性（tsc 编译期契约 + 运行时样例断言）
import { describe, it, expect } from 'vitest';
import type {
  MemoryInjectionMark,
  TokenSaving,
  BackgroundMark,
  AgingWarnMark,
  WriteBackMark,
  AttributionConfig,
  FeedbackAction,
  TrustDelta,
} from '../inlineAttribution.ts';

describe('REQ-004 内联标识类型', () => {
  it('MemoryInjectionMark 字段齐备且 decay_class 受限于四档', () => {
    const m: MemoryInjectionMark = {
      memory_id: 'mem_005',
      summaryL2: '约束：API 响应 < 200ms',
      decay_class: 'cold',
      aging_hint: '',
      request_id: 'req_017',
    };
    const valid: MemoryInjectionMark['decay_class'][] = ['hot', 'warm', 'cold', 'dormant'];
    expect(valid).toContain(m.decay_class);
    expect(m.evidence_thin).toBeUndefined();
  });

  it('TokenSaving.saved = full_baseline − actual_payload', () => {
    const t: TokenSaving = {
      actual_payload: 780,
      full_baseline: 1500,
      saved: 720,
      breakdown: [{ reason: '极简模式', tokens: 400 }, { reason: 'L2 占位符', tokens: 320 }],
    };
    const sum = t.breakdown.reduce((s, b) => s + b.tokens, 0);
    expect(t.full_baseline - t.actual_payload).toBe(t.saved);
    expect(sum).toBeLessThanOrEqual(t.saved);
  });

  it('BackgroundMark 条数与 items 一致', () => {
    const b: BackgroundMark = {
      count: 2,
      items: [
        { id: 'mem_002', kind: 'stack', text: 'Python 3.11 / FastAPI' },
        { id: 'mem_009', kind: 'decision', text: '选 FastAPI 而非 Django' },
      ],
    };
    expect(b.items.length).toBe(b.count);
  });

  it('AgingWarnMark 区分 aging 与 evidence_thin 两类', () => {
    const aging: AgingWarnMark = { kind: 'aging', text: '45 天前记录', request_id: 'req_017' };
    const thin: AgingWarnMark = { kind: 'evidence_thin', text: '证据不足', request_id: 'req_017' };
    expect(aging.kind).toBe('aging');
    expect(thin.kind).toBe('evidence_thin');
  });

  it('WriteBackMark 携带 request_id 供审计溯源', () => {
    const w: WriteBackMark = { memory_id: 'mem_030', request_id: 'req_018', summary: '新结论自动写入' };
    expect(w.request_id).toMatch(/^req_/);
  });

  it('AttributionConfig 默认开 + full 级别', () => {
    const cfg: AttributionConfig = { show_memory_attribution: true, attribution_level: 'full' };
    expect(cfg.show_memory_attribution).toBe(true);
    expect(['full', 'token_only', 'off']).toContain(cfg.attribution_level);
  });

  it('FeedbackAction → TrustDelta 数值契约', () => {
    const actions: FeedbackAction[] = ['confirm', 'reject', 'disputed'];
    const deltas: Record<FeedbackAction, number> = { confirm: 0.1, reject: -0.05, disputed: 0 };
    actions.forEach((a) => {
      const td: TrustDelta = { action: a, delta: deltas[a], toConflictQueue: a === 'disputed' };
      expect(td.delta).toBe(deltas[a]);
      expect(td.toConflictQueue).toBe(a === 'disputed');
    });
  });
});
