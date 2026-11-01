// 批次33-C：一次性明细页票据表纯函数测试（id 不可枚举 / TTL 过期 / 条数封顶淘汰最早 / 不落盘）
import { describe, expect, it } from 'vitest';
import { RECALL_DETAIL_MAX_TICKETS, RECALL_DETAIL_TTL_MS, RecallDetailTickets } from '../recallDetailTickets.ts';

const T0 = Date.UTC(2026, 10, 1, 1, 33, 0);

describe('RecallDetailTickets（批次33-C）', () => {
  it('签发的 id 由 16 字节随机数生成（22 位 base64url，可进明细页路由白名单）且互不相同', () => {
    const t = new RecallDetailTickets<string>();
    const a = t.issue('页面A', T0);
    const b = t.issue('页面B', T0);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{16,32}$/);
    expect(a.id).toHaveLength(22);
    expect(a.id).not.toBe(b.id);
    expect(a.expiresAt).toBe(T0 + RECALL_DETAIL_TTL_MS);
    // 明细正文只在内存里，绝不写数据根
    expect(t.take(a.id, T0)).toBe('页面A');
    expect(t.take(b.id, T0)).toBe('页面B');
  });

  it('默认 30 分钟 TTL：到期前后可读，过期当场回收', () => {
    const t = new RecallDetailTickets<string>();
    const { id } = t.issue('页面', T0);
    expect(t.take(id, T0 + RECALL_DETAIL_TTL_MS - 1)).toBe('页面');
    expect(t.size).toBe(1);
    expect(t.take(id, T0 + RECALL_DETAIL_TTL_MS)).toBeNull(); // expiresAt <= now 视为失效
    expect(t.size).toBe(0);
    expect(t.take('未知id_未知id_未知id', T0)).toBeNull();
  });

  it('有效期内可重复打开（刷新/误关不丢），但不落盘：clear 后即取不回', () => {
    const t = new RecallDetailTickets<string>();
    const { id } = t.issue('页面', T0);
    expect(t.take(id, T0 + 1000)).toBe('页面');
    expect(t.take(id, T0 + 2000)).toBe('页面');
    t.clear();
    expect(t.take(id, T0 + 3000)).toBeNull();
  });

  it('封顶 200 条并淘汰最早条目；过期条目在签发时先行回收', () => {
    const t = new RecallDetailTickets<string>();
    const first = t.issue('最早', T0);
    for (let i = 1; i <= RECALL_DETAIL_MAX_TICKETS; i++) t.issue(`第${i}条`, T0);
    // 第 201 次签发才触顶：evict 先按插入序淘汰「最早」，再写入新条目 → 总量不超上限
    expect(t.size).toBe(RECALL_DETAIL_MAX_TICKETS);
    expect(t.take(first.id, T0)).toBeNull();

    const t2 = new RecallDetailTickets<string>();
    const old = t2.issue('已过期', T0);
    t2.issue('仍在期', T0 + RECALL_DETAIL_TTL_MS); // 这次 evict 清掉过期条目
    expect(t2.take(old.id, T0 + RECALL_DETAIL_TTL_MS)).toBeNull();
    expect(t2.size).toBe(1);
  });

  it('可注入 payload 类型（明细页 HTML 之外也能复用同一张表）', () => {
    const t = new RecallDetailTickets<{ html: string; project_id: string }>();
    const { id } = t.issue({ html: '<!doctype html>', project_id: 'P1' }, T0);
    expect(t.take(id, T0)).toEqual({ html: '<!doctype html>', project_id: 'P1' });
  });
});
