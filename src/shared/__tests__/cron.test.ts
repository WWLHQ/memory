// 批次48 A23.2：cron 计算必须是确定性纯函数 —— 固定时区偏移、严格「下一次」、
// 覆盖跨日 / 月末 / 闰日 / DOM-DOW 或语义 / 非法表达式。
import { describe, expect, it } from 'vitest';
import { nextDue, parseCron } from '../cron.ts';

const HOUR = 3600_000;
const MIN = 60_000;
/** 东八区（Asia/Shanghai）固定 +480：本机无夏令时 */
const CST = 480;

describe('cron 解析（语法与边界）', () => {
  it('接受标准 5 段表达式与常用修饰（通配/列表/范围/步长）', () => {
    for (const expr of ['0 2 * * *', '0 8 * * *', '0 3 * * 0', '0 4 1 * *', '*/15 * * * *', '0 9,18 * * *', '0 0-6/2 * * *']) {
      expect(parseCron(expr)).not.toBeNull();
    }
  });

  it('拒绝字段数不对/越界/非法修饰（不做猜测性修正）', () => {
    for (const expr of ['', '* * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', 'x * * * *', '*/0 * * * *', '5-1 * * * *', '0 0 1 * * *']) {
      expect(parseCron(expr)).toBeNull();
    }
  });
});

describe('nextDue（确定性下一次到期）', () => {
  it('每日 02:00（东八区）：从当地 08:00 起 → 次日当地 02:00（跨日 + 时区偏移）', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0); // 当地 2026-01-01 08:00
    expect(nextDue('0 2 * * *', from, CST)).toBe(Date.UTC(2026, 0, 1, 18, 0)); // 当地 01-02 02:00
  });

  it('严格大于起点：恰好到点时下一次是明天，不重复同分钟', () => {
    expect(nextDue('0 2 * * *', Date.UTC(2026, 0, 1, 2, 0), 0)).toBe(Date.UTC(2026, 0, 2, 2, 0));
    expect(nextDue('0 2 * * *', Date.UTC(2026, 0, 1, 2, 0) + 5_000, 0)).toBe(Date.UTC(2026, 0, 2, 2, 0));
  });

  it('起点前一分钟 → 当天 02:00（秒级精度截断到下一分钟边界）', () => {
    expect(nextDue('0 2 * * *', Date.UTC(2026, 0, 1, 1, 59, 59), 0)).toBe(Date.UTC(2026, 0, 1, 2, 0));
  });

  it('同一表达式在不同时区偏移下得到不同 UTC 时刻（偏移真实生效）', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0);
    expect(nextDue('0 2 * * *', from, 0)).toBe(Date.UTC(2026, 0, 1, 2, 0));
    expect(nextDue('0 2 * * *', from, CST)).toBe(Date.UTC(2026, 0, 1, 18, 0));
    expect(nextDue('0 2 * * *', from, -300)).toBe(Date.UTC(2026, 0, 1, 7, 0)); // UTC-5
  });

  it('每周日 03:00：从周四起 → 本周日（东八区）', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0); // 当地周四 08:00
    expect(nextDue('0 3 * * 0', from, CST)).toBe(Date.UTC(2026, 0, 3, 19, 0)); // 当地周日 01-04 03:00
  });

  it('每月 1 日 04:00：月中出发 → 下月 1 日；月末 23:59 出发 → 次月 1 日（月末边界）', () => {
    expect(nextDue('0 4 1 * *', Date.UTC(2026, 0, 15, 0, 0), CST)).toBe(Date.UTC(2026, 0, 31, 20, 0));
    const monthEndLocal = Date.UTC(2026, 0, 31, 15, 59); // 当地 01-31 23:59
    expect(nextDue('0 4 1 * *', monthEndLocal, CST)).toBe(Date.UTC(2026, 0, 31, 20, 0)); // 当地 02-01 04:00
  });

  it('闰日 2/29 可达；不存在的 2/30 返回 null（8 年搜索仍无解）', () => {
    expect(nextDue('0 0 29 2 *', Date.UTC(2026, 2, 1), 0)).toBe(Date.UTC(2028, 1, 29, 0, 0));
    expect(nextDue('0 0 30 2 *', Date.UTC(2026, 0, 1), 0)).toBeNull();
  });

  it('DOM 与 DOW 同时受限 → OR 语义（任一命中即触发）', () => {
    // 2026-01-06 是周二；下一个「1 号或周一」= 01-12（周一）
    expect(nextDue('0 0 1 * 1', Date.UTC(2026, 0, 6, 0, 0), 0)).toBe(Date.UTC(2026, 0, 12, 0, 0));
    // 2026-01-31 12:00 出发 → 02-01（1 号）早于 02-02（周一）
    expect(nextDue('0 0 1 * 1', Date.UTC(2026, 0, 31, 12, 0), 0)).toBe(Date.UTC(2026, 1, 1, 0, 0));
  });

  it('步长与列表：*/15 每刻钟；9,18 只在两小时；0-6/2 偶数小时', () => {
    expect(nextDue('*/15 * * * *', Date.UTC(2026, 0, 1, 10, 7), 0)).toBe(Date.UTC(2026, 0, 1, 10, 15));
    expect(nextDue('0 9,18 * * *', Date.UTC(2026, 0, 1, 9, 30), 0)).toBe(Date.UTC(2026, 0, 1, 18, 0));
    expect(nextDue('0 0-6/2 * * *', Date.UTC(2026, 0, 1, 3, 0), 0)).toBe(Date.UTC(2026, 0, 1, 4, 0));
  });

  it('周日 7 与 0 等价（Vixie 兼容）', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0);
    expect(nextDue('0 3 * * 7', from, CST)).toBe(nextDue('0 3 * * 0', from, CST));
  });

  it('非法表达式 / 非法偏移 → null（不抛错、不返回伪造时刻）', () => {
    expect(nextDue('nope', Date.now(), CST)).toBeNull();
    expect(nextDue('0 2 * * *', Number.NaN, CST)).toBeNull();
    expect(nextDue('0 2 * * *', Date.now(), 2000)).toBeNull();
  });

  it('大跨度：从 1 月 1 日到 12 月 31 日的每日任务不跳过任何一天（抽样 30 个连续点）', () => {
    let t = Date.UTC(2026, 0, 1, 3, 0); // 当地 11:00，已过 02:00
    for (let i = 0; i < 30; i++) {
      const next = nextDue('0 2 * * *', t, CST)!;
      expect(next - t).toBeGreaterThanOrEqual(15 * HOUR); // 至少隔到次日 02:00
      expect(next - t).toBeLessThanOrEqual(39 * HOUR);
      expect((next % MIN)).toBe(0);
      t = next;
    }
  });
});
