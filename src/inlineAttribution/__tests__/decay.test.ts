// REQ-004 T2 验收：衰减/老化/证据判定纯逻辑
import { describe, it, expect } from 'vitest';
import { decayClassFromAge, agingHintText, isEvidenceThin, summarizeAttribution } from '../decay.ts';
import type { MemoryInjectionMark, TokenSaving, WriteBackMark } from '../../types/inlineAttribution.ts';

const mk = (over: Partial<MemoryInjectionMark> = {}): MemoryInjectionMark => ({
  memory_id: 'mem_x',
  summaryL2: '摘要',
  decay_class: 'hot',
  aging_hint: '',
  request_id: 'req_x',
  ...over,
});

describe('decayClassFromAge', () => {
  it('四档边界', () => {
    expect(decayClassFromAge(0)).toBe('hot');
    expect(decayClassFromAge(7)).toBe('hot');
    expect(decayClassFromAge(8)).toBe('warm');
    expect(decayClassFromAge(45)).toBe('warm');
    expect(decayClassFromAge(46)).toBe('cold');
    expect(decayClassFromAge(180)).toBe('cold');
    expect(decayClassFromAge(181)).toBe('dormant');
  });
});

describe('agingHintText', () => {
  it('aging_hint 非空原样返回', () => {
    expect(agingHintText(mk({ aging_hint: '45 天前请校验' }))).toBe('45 天前请校验');
  });
  it('cold/dormant 给默认 9.6 提示', () => {
    expect(agingHintText(mk({ decay_class: 'cold' }))).toContain('校验');
    expect(agingHintText(mk({ decay_class: 'dormant' }))).toContain('校验');
  });
  it('hot/warm 未老化返回空', () => {
    expect(agingHintText(mk({ decay_class: 'hot' }))).toBe('');
    expect(agingHintText(mk({ decay_class: 'warm' }))).toBe('');
  });
});

describe('isEvidenceThin', () => {
  it('仅 evidence_thin=true 为真', () => {
    expect(isEvidenceThin(mk({ evidence_thin: true }))).toBe(true);
    expect(isEvidenceThin(mk())).toBe(false);
  });
});

describe('summarizeAttribution', () => {
  it('仅注入', () => {
    expect(summarizeAttribution([mk(), mk()], null, null)).toBe('来自 2 条记忆');
  });
  it('注入 + 省 token', () => {
    const saving: TokenSaving = { actual_payload: 780, full_baseline: 1500, saved: 720, breakdown: [] };
    expect(summarizeAttribution([mk()], saving, null)).toBe('来自 1 条记忆 · 省 720 token');
  });
  it('全字段', () => {
    const saving: TokenSaving = { actual_payload: 780, full_baseline: 1500, saved: 720, breakdown: [] };
    const wb: WriteBackMark = { memory_id: 'mem_030', request_id: 'req_018', summary: '新结论' };
    expect(summarizeAttribution([mk(), mk(), mk()], saving, wb)).toBe('来自 3 条记忆 · 省 720 token · 新沉淀 1 条记忆');
  });
});
