// 程序运行日志窗口的纯函数（批次17 建，批次19 起由日志记录页使用）：解析 actions.log 行、UTC+08:00 时间展示、诊断文本与剪贴板复制。
// 行格式真源见 src/shared/actionLog.ts（[ISO] [level] [scope:action] [rid] {json}）。
import type { ActionLogLevel } from '../../shared/actionLog.ts';

export interface ProgramLogLine {
  /** 原始单行（复制诊断信息时原样带出） */
  raw: string;
  /** ISO 时间；无法解析时为 null */
  ts: string | null;
  level: ActionLogLevel | 'unknown';
  scope: string;
  action: string;
  /** detail 正文（截断）：原文视图直接展示，人话视图作为摘要来源 */
  message: string;
}

const LINE_RE = /^\[([^\]]+)\]\s+\[(info|warn|error)\]\s+\[([^:\]]+):([^\]]+)\](?:\s+\[[^\]]+\])?\s*(.*)$/;

/** 解析一行动作日志；畸形行不丢弃，按 unknown 原样展示（诚实原则：不隐藏真实输出） */
export function parseProgramLogLine(raw: string, maxMessage = 160): ProgramLogLine {
  const text = raw.trim();
  const m = LINE_RE.exec(text);
  if (!m) {
    return {
      raw,
      ts: null,
      level: 'unknown',
      scope: '',
      action: '',
      message: text.length > maxMessage ? `${text.slice(0, maxMessage)}…` : text,
    };
  }
  const detail = m[5] ?? '';
  return {
    raw,
    ts: m[1],
    level: m[2] as ActionLogLevel,
    scope: m[3],
    action: m[4],
    message: detail.length > maxMessage ? `${detail.slice(0, maxMessage)}…` : detail,
  };
}

/** ISO 时间 → UTC+08:00 的 HH:mm:ss（用户口径固定本地时间，不依赖机器时区） */
export function formatLogClock(iso: string | null): string {
  if (!iso) return '--:--:--';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '--:--:--';
  return new Date(t + 8 * 3600_000).toISOString().slice(11, 19);
}

/** ISO 时间 → UTC+08:00 的 YYYY-MM-DD（与 formatLogClock 同一口径，供只展示日期的列复用） */
export function formatLogDate(iso: string | null): string {
  if (!iso) return '--';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '--';
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 当前时间 → UTC+08:00 的 YYYY-MM-DD HH:mm:ss */
export function formatLocalDateTime(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

export function countErrors(lines: ProgramLogLine[]): number {
  return lines.filter((l) => l.level === 'error').length;
}

/** 反馈用诊断文本：时间/页面/日志路径 + 最近原始日志（日志已由主进程脱敏） */
export function buildDiagnostics(input: {
  path: string | null;
  lines: ProgramLogLine[];
  page?: string;
  now?: Date;
}): string {
  const page = input.page ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return [
    'MultiAgent Memory 程序诊断信息',
    `时间: ${formatLocalDateTime(input.now)} (+08:00)`,
    `页面: ${page}`,
    `日志文件: ${input.path ?? '(未初始化)'}`,
    '最近日志:',
    ...input.lines.map((l) => l.raw),
  ].join('\n');
}

/** 复制到剪贴板：优先 Clipboard API，失败回退 textarea + execCommand；返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 权限/安全上下文限制 → 走回退 */
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
