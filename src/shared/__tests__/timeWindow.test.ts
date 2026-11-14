// REQ-013 / C1 单测：覆盖东八区边界（早上7点不落到前一天）、绝对日期词、N 单位前/后、
// 时段词、显式小时、extractQueryTimestamp 零命中回退、hitTimeWindow 边界。
import { describe, it, expect } from 'vitest';
import {
  parseRelativeTime,
  extractQueryTimestamp,
  hitTimeWindow,
  DAY_MS,
} from '../timeWindow.ts';

// 固定参考时间：2026-11-14 09:00:00 本地（用本地构造，断言不依赖机器时区）
const REF = new Date(2026, 10, 14, 9, 0, 0);

function dayOf(ts: number): number {
  return new Date(ts).getDate();
}

describe('C1 parseRelativeTime 绝对日期词', () => {
  it('今天 → 当天 00:00，无时间粒度', () => {
    const r = parseRelativeTime('今天', REF);
    expect(r.kind).toBe('absolute');
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14);
      expect(r.hasTimeOfDay).toBe(false);
    }
  });

  it('昨天 / 前天 → 对应偏移日 00:00', () => {
    const y = parseRelativeTime('昨天', REF);
    const bf = parseRelativeTime('前天', REF);
    if (y.kind === 'absolute') expect(dayOf(y.ts)).toBe(13);
    if (bf.kind === 'absolute') expect(dayOf(bf.ts)).toBe(12);
  });

  it('明天 / 后天 → 对应偏移日 00:00', () => {
    const t = parseRelativeTime('明天', REF);
    const af = parseRelativeTime('后天', REF);
    if (t.kind === 'absolute') expect(dayOf(t.ts)).toBe(15);
    if (af.kind === 'absolute') expect(dayOf(af.ts)).toBe(16);
  });
});

describe('C1 parseRelativeTime N 单位前/后', () => {
  it('3天前 → d-3 00:00', () => {
    const r = parseRelativeTime('3天前', REF);
    if (r.kind === 'absolute') expect(dayOf(r.ts)).toBe(11);
  });

  it('2周后 → d+14 00:00', () => {
    const r = parseRelativeTime('2周后', REF);
    if (r.kind === 'absolute') expect(dayOf(r.ts)).toBe(28);
  });

  it('1个月前（跨月）→ 10-14', () => {
    const r = parseRelativeTime('1个月前', REF);
    // 2026-11-14 减 1 月 = 2026-10-14
    if (r.kind === 'absolute') {
      const d = new Date(r.ts);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(9); // 10 月
      expect(d.getDate()).toBe(14);
    }
  });

  it('2年前（跨年）→ 2024-11-14', () => {
    const r = parseRelativeTime('2年前', REF);
    if (r.kind === 'absolute') {
      const d = new Date(r.ts);
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMonth()).toBe(10);
      expect(d.getDate()).toBe(14);
    }
  });
});

describe('C1 parseRelativeTime 时段词 / 显式小时（东八区边界）', () => {
  it('早上7点 → 当天 07:00，且不落到前一天（东八区边界）', () => {
    const r = parseRelativeTime('早上7点', REF);
    expect(r.kind).toBe('absolute');
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14); // 关键：不能因时区偏移落到 13 号
      const d = new Date(r.ts);
      expect(d.getHours()).toBe(7);
      expect(r.hasTimeOfDay).toBe(true);
    }
  });

  it('7am → 当天 07:00', () => {
    const r = parseRelativeTime('7am', REF);
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14);
      expect(new Date(r.ts).getHours()).toBe(7);
    }
  });

  it('下午3点 → 当天 15:00（12 小时制转 24）', () => {
    const r = parseRelativeTime('下午3点', REF);
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14);
      expect(new Date(r.ts).getHours()).toBe(15);
    }
  });

  it('晚上8点 → 当天 20:00', () => {
    const r = parseRelativeTime('晚上8点', REF);
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14);
      expect(new Date(r.ts).getHours()).toBe(20);
    }
  });

  it('今天早上 → 当天 07:00', () => {
    const r = parseRelativeTime('今天早上', REF);
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14);
      expect(new Date(r.ts).getHours()).toBe(7);
    }
  });

  it('昨天下午 → 昨天 15:00', () => {
    const r = parseRelativeTime('昨天下午', REF);
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(13);
      expect(new Date(r.ts).getHours()).toBe(15);
    }
  });

  it('中午 → 当天 12:00', () => {
    const r = parseRelativeTime('中午', REF);
    if (r.kind === 'absolute') {
      expect(dayOf(r.ts)).toBe(14);
      expect(new Date(r.ts).getHours()).toBe(12);
    }
  });
});

describe('C1 parseRelativeTime 无时间意图', () => {
  it('纯时间无关问句（不含任何日期/时段词）→ none', () => {
    // 注：含日期词的问句（如「今天天气」）会命中时间意图——这属于调用方（T2/agent）的产品级
    // 判断（是否对天气/新闻类非召回查询排除时间窗），不在本纯函数边界内。本用例只验证真正无时间词的输入。
    for (const q of ['如何配置密钥', '查看所有记忆', '帮我总结', '这个 bug 怎么修']) {
      expect(parseRelativeTime(q).kind).toBe('none');
    }
  });
});

describe('C1 extractQueryTimestamp', () => {
  it('有意图 → detected true 且 ts 为解析值', () => {
    const r = extractQueryTimestamp('昨天写的方案', REF);
    expect(r.detected).toBe(true);
    expect(dayOf(r.ts)).toBe(13);
  });

  it('无意图 → detected false 且 ts 回退为 ref 本地时间（零命中仍注入本地时间）', () => {
    const r = extractQueryTimestamp('如何配置', REF);
    expect(r.detected).toBe(false);
    expect(r.ts).toBe(REF.getTime());
  });
});

describe('C1 hitTimeWindow', () => {
  it('间隔 12 小时 → 命中', () => {
    expect(hitTimeWindow(REF.getTime(), REF.getTime() - 12 * 3600_000)).toBe(true);
  });

  it('间隔 2 天 → 不命中', () => {
    expect(hitTimeWindow(REF.getTime(), REF.getTime() - 2 * DAY_MS)).toBe(false);
  });

  it('间隔正好 1 天（边界，<=）→ 命中', () => {
    expect(hitTimeWindow(REF.getTime(), REF.getTime() - DAY_MS)).toBe(true);
  });

  it('间隔 1 天 + 1ms → 不命中', () => {
    expect(hitTimeWindow(REF.getTime(), REF.getTime() - DAY_MS - 1)).toBe(false);
  });
});
