// token 节省口径单测（批次11）：基线必须来自同一批记忆全文，缺对照时不虚构节省。
import { describe, it, expect } from 'vitest';
import { tokenSavingFromMarks } from '../useInlineReal.ts';
import type { Memory } from '../../../core/memagent/types.ts';
import type { MemoryInjectionMark } from '../../../types/inlineAttribution.ts';

function mark(id: string, summary: string): MemoryInjectionMark {
  return { memory_id: id, summaryL2: summary, decay_class: 'hot', aging_hint: '', request_id: `req_${id}` };
}

function mem(id: string, content: string): Memory {
  return {
    mem_id: id, project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content, decay_class: 'hot',
    pinned: false, locked: false, version: 1, created_at: 1,
  };
}

describe('tokenSavingFromMarks（estTokens 同口径）', () => {
  it('基线 = 同批记忆全文 token（只算被注入的 memory_id）', () => {
    const saving = tokenSavingFromMarks(
      [mark('m1', 'a'.repeat(20))],
      [mem('m1', 'b'.repeat(200)), mem('m2', 'c'.repeat(400))],
    );
    expect(saving.actual_payload).toBe(10);
    expect(saving.full_baseline).toBe(100);
    expect(saving.saved).toBe(90);
  });

  it('无全文对照 → 基线 = 实际，saved 0（不虚构倍数）', () => {
    const saving = tokenSavingFromMarks([mark('m1', 'x'.repeat(20))]);
    expect(saving.full_baseline).toBe(saving.actual_payload);
    expect(saving.saved).toBe(0);
  });

  it('空注入 → 全 0', () => {
    const saving = tokenSavingFromMarks([], [mem('m1', 'ffff')]);
    expect(saving).toMatchObject({ actual_payload: 0, full_baseline: 0, saved: 0 });
  });
});
