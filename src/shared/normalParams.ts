// 批次48 A17：参数页「普通配置」折算表 —— Web 展示与内核遗忘调度共用这一份真源。
// 此前两处各写一套：web/params/logic.ts 有折算函数但只有 UI 用，内核只读 auto_organize；
// 结果「遗忘速度 / 保留时长 / 重要程度」保存后不改任何实际行为（审计报告 P2-4「参数多数不生效」）。
// 约定：折算值只作为全局覆盖下发；记忆行自带 half_life_days 时仍以行上为准（17.5）。
export const FORGET_SPEED_HALF_LIFE_DAYS = { slow: 60, mid: 30, fast: 7 } as const;
export const RETENTION_ARCHIVE_DAYS = { long: 365, months: 180, weeks: 90, short: 30 } as const;

export type ForgetSpeed = keyof typeof FORGET_SPEED_HALF_LIFE_DAYS;
export type Retention = keyof typeof RETENTION_ARCHIVE_DAYS;

const SPEEDS = Object.keys(FORGET_SPEED_HALF_LIFE_DAYS) as ForgetSpeed[];
const RETENTIONS = Object.keys(RETENTION_ARCHIVE_DAYS) as Retention[];

/** 非法/缺省 → undefined（不覆盖内核默认策略，而不是悄悄当成某个值） */
export function halfLifeDaysOf(speed: unknown): number | undefined {
  return typeof speed === 'string' && (SPEEDS as string[]).includes(speed)
    ? FORGET_SPEED_HALF_LIFE_DAYS[speed as ForgetSpeed]
    : undefined;
}

/** 非法/缺省 → undefined（保留内核按类别的 auto_archive_days） */
export function autoArchiveDaysOf(retention: unknown): number | undefined {
  return typeof retention === 'string' && (RETENTIONS as string[]).includes(retention)
    ? RETENTION_ARCHIVE_DAYS[retention as Retention]
    : undefined;
}
