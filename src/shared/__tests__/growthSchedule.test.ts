// M0 调度计划纯函数：锁住「改频率后旧 next_due 必须作废」这条最容易静默漂移的规则。
// 时间断言全部用 Date.UTC 硬编码（不依赖测试机时区），时区偏移固定 +480（Asia/Shanghai）。
import { describe, expect, it } from 'vitest';
import { advanceNextDue, isAuditPlanStale, planNextDue, SCHEDULE_FALLBACK_MS } from '../growthSchedule.ts';
import { DEFAULT_SCHEDULE_EXPRS } from '../growthConfig.ts';

const TZ = 480;
/** 本地 2026-01-01 08:00（周四）——所有用例的统一起算点 */
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const DAY = 24 * 3600_000;

describe('isAuditPlanStale（历史 next_due 是否还可信）', () => {
  it('审计 expr 与当前一致 → 可信', () => {
    expect(isAuditPlanStale({ key: 'self_growth', expr: '0 3 * * 0', audit_expr: '0 3 * * 0' })).toBe(false);
  });

  it('审计 expr 与当前不同 → 失效（那条 next_due 是按旧节奏算的）', () => {
    expect(isAuditPlanStale({ key: 'self_growth', expr: '0 5 * * 1', audit_expr: '0 3 * * 0' })).toBe(true);
  });

  it('旧审计无 expr 且当前仍是默认 → 可信（改造前历史行的正常情形）', () => {
    expect(isAuditPlanStale({
      key: 'self_growth', expr: DEFAULT_SCHEDULE_EXPRS.self_growth, audit_expr: null,
    })).toBe(false);
  });

  it('旧审计无 expr 但当前已改过 → 失效（宁可重算，不留「改了不生效」）', () => {
    expect(isAuditPlanStale({ key: 'self_growth', expr: '0 2 * * *', audit_expr: null })).toBe(true);
  });
});

describe('planNextDue（启动恢复）', () => {
  const oldNextDue = Date.UTC(2026, 0, 3, 19, 0, 0); // 本地 2026-01-04 03:00（周日，旧表达式口径）

  it('历史可信 → 原样沿用审计里的 next_due_at（不重算、不漂移）', () => {
    expect(planNextDue({
      key: 'self_growth', expr: '0 3 * * 0', audit_expr: '0 3 * * 0',
      audit_next_due: oldNextDue, last_run_ts: BASE, tz_offset_min: TZ,
    })).toBe(oldNextDue);
  });

  it('表达式已改 → 旧 next_due 作废，按新表达式重算（AC M0-4 核心）', () => {
    const got = planNextDue({
      key: 'self_growth',
      expr: '0 2 * * *',       // 改成每天 02:00
      audit_expr: '0 3 * * 0', // 历史是每周日 03:00
      audit_next_due: oldNextDue,
      last_run_ts: BASE,
      tz_offset_min: TZ,
    });
    expect(got).not.toBe(oldNextDue);
    // 本地 2026-01-02 02:00 = UTC 2026-01-01 18:00
    expect(got).toBe(Date.UTC(2026, 0, 1, 18, 0, 0));
    expect(got).toBeLessThan(oldNextDue); // 改密后应更早到期，而不是继续等旧日期
  });

  it('旧审计无 expr 但配置已改 → 同样重算，不沿用旧值', () => {
    const got = planNextDue({
      key: 'self_growth', expr: '0 2 * * *', audit_expr: null,
      audit_next_due: oldNextDue, last_run_ts: BASE, tz_offset_min: TZ,
    });
    expect(got).toBe(Date.UTC(2026, 0, 1, 18, 0, 0));
  });

  it('审计缺 next_due_at → 按当前表达式重算', () => {
    expect(planNextDue({
      key: 'decay', expr: '0 2 * * *', audit_expr: '0 2 * * *',
      audit_next_due: null, last_run_ts: BASE, tz_offset_min: TZ,
    })).toBe(Date.UTC(2026, 0, 1, 18, 0, 0));
  });

  it('next_due_at 非有限数（NaN/Infinity）→ 视为缺失并重算，绝不把脏值传下去', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planNextDue({
        key: 'decay', expr: '0 2 * * *', audit_expr: '0 2 * * *',
        audit_next_due: bad, last_run_ts: BASE, tz_offset_min: TZ,
      })).toBe(Date.UTC(2026, 0, 1, 18, 0, 0));
    }
  });

  it('表达式不可达 → 退 last_run + 24h（与改造前兜底逐字一致）', () => {
    expect(planNextDue({
      key: 'archive', expr: '0 2 30 2 *', audit_expr: '0 2 30 2 *',
      audit_next_due: null, last_run_ts: BASE, tz_offset_min: TZ,
    })).toBe(BASE + SCHEDULE_FALLBACK_MS);
  });
});

describe('advanceNextDue（运行期推进）', () => {
  it('每周日 → 下一次仍是 7 天后（本地 2026-01-03 19:00Z 之后）', () => {
    // 从本地 2026-01-04 03:00 刚跑完 → 下一次应为 2026-01-11 03:00 本地
    expect(advanceNextDue('0 3 * * 0', Date.UTC(2026, 0, 3, 19, 0, 0), TZ))
      .toBe(Date.UTC(2026, 0, 10, 19, 0, 0));
  });

  it('每日 02:00 → 恰好 +1 天', () => {
    expect(advanceNextDue('0 2 * * *', Date.UTC(2026, 0, 1, 18, 0, 0), TZ))
      .toBe(Date.UTC(2026, 0, 1, 18, 0, 0) + DAY);
  });

  it('不可达表达式 → +24h 兜底，不返回 NaN', () => {
    expect(advanceNextDue('0 2 30 2 *', BASE, TZ)).toBe(BASE + SCHEDULE_FALLBACK_MS);
  });
});
