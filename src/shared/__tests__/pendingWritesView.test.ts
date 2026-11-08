// S5：待重放队列摘要必须只出计数与可排查字段，绝不把正文递到渲染层
import { describe, expect, it } from 'vitest';
import { PENDING_SUMMARY_LIMIT, summarizePendingWrites } from '../pendingWritesView.ts';
import type { PendingWrite } from '../../core/memagent/pendingWrites.ts';

function rec(over: Partial<PendingWrite> = {}): PendingWrite {
  return {
    id: 'pend_1',
    status: 'pending',
    created_at: 1000,
    content: '这是正文，绝不允许出现在摘要里',
    category: 'fact',
    project_id: 'P-1',
    source_agent: 'claude-code',
    user_id: 'u1',
    session_id: 's1',
    tags: ['a', 'b', 'c'],
    importance: 0.6,
    confidence: 0.8,
    half_life_days: 30,
    ...over,
  };
}

describe('summarizePendingWrites', () => {
  it('摘要不含正文字段，只保留字数', () => {
    const { items } = summarizePendingWrites([rec()]);
    const json = JSON.stringify(items);
    expect(json).not.toContain('这是正文');
    expect(items[0].content_chars).toBe(rec().content.length);
    expect(items[0]).toMatchObject({
      id: 'pend_1', project_id: 'P-1', source_agent: 'claude-code',
      category: 'fact', tags: 3, importance: 0.6, confidence: 0.8, half_life_days: 30,
    });
  });

  it('按入队时间倒序，并截断到上限且标记 truncated', () => {
    const many = Array.from({ length: PENDING_SUMMARY_LIMIT + 3 }, (_, i) =>
      rec({ id: `pend_${i}`, created_at: i }));
    const out = summarizePendingWrites(many);
    expect(out.items).toHaveLength(PENDING_SUMMARY_LIMIT);
    expect(out.truncated).toBe(true);
    expect(out.items[0].created_at).toBe(PENDING_SUMMARY_LIMIT + 2);
  });

  it('空队列返回空数组且不标记截断', () => {
    expect(summarizePendingWrites([])).toEqual({ items: [], truncated: false });
  });

  it('可选字段缺失时为 null（不补 0、不编默认值）', () => {
    const { items } = summarizePendingWrites([rec({
      source_agent: undefined, user_id: undefined, session_id: undefined,
      importance: undefined, confidence: undefined, half_life_days: undefined, tags: undefined,
    })]);
    expect(items[0].source_agent).toBeNull();
    expect(items[0].user_id).toBeNull();
    expect(items[0].session_id).toBeNull();
    expect(items[0].importance).toBeNull();
    expect(items[0].confidence).toBeNull();
    expect(items[0].half_life_days).toBeNull();
    expect(items[0].tags).toBe(0);
  });
});
