// token 节省口径单测（批次11）：基线必须来自同一批记忆全文，缺对照时不虚构节省。
import { describe, it, expect } from 'vitest';
import { tokenSavingFromMarks, injectionsFromMemories } from '../useInlineReal.ts';
import type { Memory, AuditRecord } from '../../../core/memagent/types.ts';
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

describe('injectionsFromMemories request_id（批次48 A14）', () => {
  it('取该记忆最近一次真实 write 审计的 request_id', () => {
    const audits: AuditRecord[] = [
      { request_id: 'req_old', action: 'write', ts: 100, detail: { mem_id: 'm1' } },
      { request_id: 'req_new', action: 'write', ts: 300, detail: { mem_id: 'm1' } },
    ];
    const marks = injectionsFromMemories([mem('m1', '真实内容')], audits);
    expect(marks[0].request_id).toBe('req_new');
  });
  it('账本没有该记忆的 write 链路 → 空串（不再合成 req_+mem_id）', () => {
    const marks = injectionsFromMemories([mem('m1', '真实内容')], []);
    expect(marks[0].request_id).toBe('');
  });
});
