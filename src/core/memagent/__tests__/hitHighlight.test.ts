// 批次59：回显命中片段（方案 C）——纯函数层。
// 这层的判定直接决定「用户看到的黄色片段是不是真的命中依据」，所以正反两面都要锁：
// 命中的要标准，没命中的**必须不标**（宁可不标，不能拿最长句冒充）。
import { describe, expect, it } from 'vitest';
import { displayTerms, matchedTerms, pickHitSpans } from '../hitHighlight.ts';

const QUERY = '接口超时怎么调';
const MEMORY = '该服务 P99 延迟必须 <200ms；超时重试上限 3 次；本地缓存 TTL 60s';

describe('matchedTerms：命中依据来自 query∩正文（与召回打分同一套 tokenize）', () => {
  it('中文 2-gram 命中：query 里的「超时」确实出现在正文', () => {
    const terms = matchedTerms(QUERY, MEMORY);
    expect(terms).toContain('超时');
  });

  it('完全没有共有词 → 空数组（渲染层据此不高亮）', () => {
    expect(matchedTerms('数据库迁移', MEMORY)).toEqual([]);
  });

  it('空 query / 空正文 → 空数组，不抛错', () => {
    expect(matchedTerms('', MEMORY)).toEqual([]);
    expect(matchedTerms(QUERY, '')).toEqual([]);
  });

  it('虚词不进命中依据：英文停用词与单字母被挡掉', () => {
    const terms = matchedTerms('the timeout is', 'the timeout is 3s');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
    expect(terms).toContain('timeout');
  });

  it('纯标点/空白构成的 token 不算命中', () => {
    expect(matchedTerms('，。', '，。')).toEqual([]);
  });

  it('大小写不敏感：Timeout 与 timeout 互相命中', () => {
    expect(matchedTerms('Timeout', 'set timeout to 3')).toContain('timeout');
  });

  it('limit 生效：长片段优先', () => {
    const terms = matchedTerms('连接池超时重试上限', '连接池超时重试上限 3 次', 3);
    expect(terms).toHaveLength(3);
    expect(terms[0].length).toBeGreaterThanOrEqual(terms[1].length);
  });
});

describe('pickHitSpans：在正文里定位区间（合并相邻、不跨句、不硬标）', () => {
  it('单个命中词定位到正确 offset', () => {
    const spans = pickHitSpans(['超时'], MEMORY);
    expect(spans).toHaveLength(1);
    expect(MEMORY.slice(spans[0].start, spans[0].end)).toBe('超时');
  });

  it('相邻 bigram 合并成一片：「接口」「口超」「超时」→ 整段「接口超时」', () => {
    const text = '接口超时的排查';
    const spans = pickHitSpans(['接口', '口超', '超时'], text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe('接口超时');
  });

  it('跨句不合并：中间有「。」时保持两片', () => {
    const text = '超时。重试';
    const spans = pickHitSpans(['超时', '重试'], text);
    expect(spans).toHaveLength(2);
    expect(text.slice(spans[0].start, spans[0].end)).toBe('超时');
    expect(text.slice(spans[1].start, spans[1].end)).toBe('重试');
  });

  it('terms 为空 → 空区间（不高亮）', () => {
    expect(pickHitSpans([], MEMORY)).toEqual([]);
  });

  it('命中词在截断后的文本里已不存在 → 空区间，绝不标别处', () => {
    const clipped = '该服务 P99 延迟必须 <200ms';
    expect(pickHitSpans(['超时'], clipped)).toEqual([]);
  });

  it('maxSpans 限制片段数，取最长的几片', () => {
    const text = '甲超时 乙重试 丙缓存';
    const spans = pickHitSpans(['超时', '重试', '缓存'], text, { maxSpans: 2 });
    expect(spans).toHaveLength(2);
  });

  it('重叠命中不重复出片（同一位置只标一次）', () => {
    const text = '超时重试';
    const spans = pickHitSpans(['超时', '时重', '重试'], text);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ start: 0, end: 4 });
  });

  it('minLen 可调：把阈值抬到 5，两字命中就不标了', () => {
    expect(pickHitSpans(['超时'], '超时', { minLen: 5 })).toEqual([]);
  });
});

describe('displayTerms：给用户看的命中词清单', () => {
  it('按正文出现顺序排列，而不是按 token 长度', () => {
    expect(displayTerms(['重试', '超时'], MEMORY)).toEqual(['超时', '重试']);
  });

  it('去重 + 最多 n 个', () => {
    expect(displayTerms(['超时', '超时', '重试'], MEMORY, 2)).toEqual(['超时', '重试']);
  });

  it('没有命中词 → 空数组（不回显「🎯 」空标签）', () => {
    expect(displayTerms(undefined, MEMORY)).toEqual([]);
    expect(displayTerms([], MEMORY)).toEqual([]);
  });
});
