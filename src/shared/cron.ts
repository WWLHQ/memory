// 确定性 cron 计算（批次48 A23.2）：5 段表达式 + **固定时区偏移**，纯函数、无 I/O。
//
// 为什么不用系统本地时区 / 库：
//   · 主进程调度必须可单测、可复现 —— 同一输入在任何机器任何时刻都得到同一结果；
//   · 本地时区偏移由调用方显式传入（东为正，如 Asia/Shanghai = +480），不读夏令时表。
//     DST 地区在切换日会偏离一小时，本机（Asia/Shanghai）无夏令时，口径稳定；
//     将来要支持 DST 只需在调用方按日期换算偏移，不影响本模块语义。
//
// 语法（与 Vixie cron 一致）：
//   `*`、`n`、`a-b`、`a-b/step`、`*/step`、逗号列表；字段范围 分 0-59 / 时 0-23 /
//   日 1-31 / 月 1-12 / 周 0-7（0 与 7 都表示周日）。
//   「日」与「周」同时受限时采用 OR 语义（任一命中即触发），与 Vixie cron 相同。

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: readonly FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 7 },
];

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** 该字段是否被显式限制（以 `*` 开头的字段视为「不限制」） */
  domRestricted: boolean;
  dowRestricted: boolean;
}

/** 单个字段 → 取值集合；非法返回 null（不做任何猜测性修正） */
function parseField(raw: string, spec: FieldSpec): Set<number> | null {
  const out = new Set<number>();
  for (const piece of raw.split(',')) {
    if (!piece) return null;
    const [rangePart, stepPart] = piece.split('/');
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return null;

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = spec.min;
      hi = spec.max;
    } else if (/^\d+$/.test(rangePart)) {
      lo = Number(rangePart);
      // `n/step` 的含义是「从 n 起按 step 到最大值」
      hi = stepPart !== undefined ? spec.max : lo;
    } else {
      const m = /^(\d+)-(\d+)$/.exec(rangePart);
      if (!m) return null;
      lo = Number(m[1]);
      hi = Number(m[2]);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (lo < spec.min || hi > spec.max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

/** 解析 5 段表达式；非法返回 null */
export function parseCron(expr: string): CronSpec | null {
  if (typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const s = parseField(parts[i], FIELDS[i]);
    if (!s) return null;
    sets.push(s);
  }
  // 周日 7 归一为 0（Vixie 兼容）
  if (sets[4].has(7)) {
    sets[4].delete(7);
    sets[4].add(0);
  }
  return {
    minute: sets[0],
    hour: sets[1],
    dom: sets[2],
    month: sets[3],
    dow: sets[4],
    domRestricted: !parts[2].startsWith('*'),
    dowRestricted: !parts[4].startsWith('*'),
  };
}

/** 搜索上限：8 年（覆盖闰日 2/29 与月末边界；超出说明该表达式实际不可达） */
const MAX_SEARCH_DAYS = 8 * 366;

/** 升序数组（Set 的插入序不可依赖） */
function ascending(s: Set<number>): number[] {
  return [...s].sort((a, b) => a - b);
}

/**
 * 下一个到期时刻（严格大于 fromMs 的分钟边界）。
 * @param expr 5 段 cron
 * @param fromMs 起点（通常为上次真实运行时间）
 * @param tzOffsetMin 本地时区偏移（分钟，东为正；Asia/Shanghai = 480）
 * @returns UTC 毫秒；表达式非法/不可达返回 null
 */
export function nextDue(expr: string, fromMs: number, tzOffsetMin: number): number | null {
  const spec = parseCron(expr);
  if (!spec) return null;
  if (!Number.isFinite(fromMs) || !Number.isFinite(tzOffsetMin)) return null;
  if (tzOffsetMin < -24 * 60 || tzOffsetMin > 24 * 60) return null;

  const offsetMs = Math.round(tzOffsetMin) * MINUTE;
  // 起点取「严格大于 fromMs 的下一分钟」：from=02:00:00 → 02:01，不会在同分钟重复触发
  const startUtc = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
  const firstDay = Math.floor((startUtc + offsetMs) / DAY);
  const hours = ascending(spec.hour);
  const minutes = ascending(spec.minute);

  for (let d = 0; d < MAX_SEARCH_DAYS; d++) {
    // dayStartLocal：本地 00:00 在「本地纪元」下的毫秒数，用 UTC getter 读年月日/星期
    const dayStartLocal = (firstDay + d) * DAY;
    const cal = new Date(dayStartLocal);
    if (!spec.month.has(cal.getUTCMonth() + 1)) continue;
    const domOk = spec.dom.has(cal.getUTCDate());
    const dowOk = spec.dow.has(cal.getUTCDay());
    const dayOk = spec.domRestricted && spec.dowRestricted ? (domOk || dowOk) : (domOk && dowOk);
    if (!dayOk) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const candidateUtc = dayStartLocal + h * HOUR + m * MINUTE - offsetMs;
        if (candidateUtc >= startUtc) return candidateUtc;
      }
    }
  }
  return null;
}
