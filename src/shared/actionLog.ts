// 动作日志（批次7）：全链路结构化留痕的统一格式与脱敏。
// 目标：任何动作（UI 点击 / 宿主调用 / IPC / HTTP / 服务）都产出同一格式的一行日志，
// 便于人眼扫读与 LLM 检索；密码、令牌、密钥等敏感字段绝不落盘。
//
// 行格式：[ISO] [level] [scope:action] [req_xxx] {"k":"v"}
// 纯 TS（无 Node/DOM 依赖），主进程、preload、渲染层共用。

export type ActionLogLevel = 'info' | 'warn' | 'error';

export interface ActionLogEntry {
  /** ISO 时间戳 */
  ts: string;
  level: ActionLogLevel;
  /** 作用域：ui / host / ipc / home / onboarding / backup / dataRoot / kernel / mcp / webhook */
  scope: string;
  /** 动作名：click / login_ok / storage:putMemory / http … */
  action: string;
  /** 与内核审计对齐的请求 id（可选） */
  request_id?: string;
  detail?: unknown;
}

export interface ActionLogOptions {
  level?: ActionLogLevel;
  requestId?: string;
  /** 测试注入固定时间 */
  now?: number;
}

/** 主进程 log:tail 返回：最近 N 条原始日志行（已脱敏，仅用于只读展示/诊断复制） */
export interface ActionLogTailResult {
  ok: boolean;
  /** 当前 actions.log 绝对路径；日志未初始化时为 null */
  path: string | null;
  lines: string[];
  error?: string;
}

const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
/** 敏感字段名：命中即整体替换为 ***，绝不写值 */
const SECRET_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|credential|cookie|session[-_]?id/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 递归脱敏 + 截断：深度/数组/字符串均有上限，循环引用安全 */
export function sanitizeActionDetail(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) {
      const out = value.slice(0, MAX_ARRAY).map((v) => sanitizeActionDetail(v, depth + 1, seen));
      if (value.length > MAX_ARRAY) out.push(`…(${value.length - MAX_ARRAY} more)`);
      return out;
    }
    if (value instanceof Map) return sanitizeActionDetail(Object.fromEntries(value), depth + 1, seen);
    if (value instanceof Set) return sanitizeActionDetail([...value], depth + 1, seen);
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEY.test(k)) { out[k] = '***'; continue; }
        const s = sanitizeActionDetail(v, depth + 1, seen);
        if (s !== undefined) out[k] = s;
      }
      return out;
    }
    return String(value);
  }
  return String(value);
}

/** 创建标准动作日志条目（ts/level/scope/action/detail 统一生成） */
export function createActionLogEntry(
  scope: string,
  action: string,
  detail?: unknown,
  opts: ActionLogOptions = {},
): ActionLogEntry {
  const entry: ActionLogEntry = {
    ts: new Date(opts.now ?? Date.now()).toISOString(),
    level: opts.level ?? 'info',
    scope: String(scope || 'unknown'),
    action: String(action || 'unknown'),
  };
  if (opts.requestId) entry.request_id = opts.requestId;
  const clean = sanitizeActionDetail(detail);
  if (clean !== undefined) entry.detail = clean;
  return entry;
}

/** 单行格式化：人眼可扫、便于 grep；detail 保持单行 JSON（无换行） */
export function formatActionLine(entry: ActionLogEntry): string {
  const rid = entry.request_id ? ` [${entry.request_id}]` : '';
  const detail = entry.detail === undefined ? '' : ` ${JSON.stringify(entry.detail)}`;
  return `[${entry.ts}] [${entry.level}] [${entry.scope}:${entry.action}]${rid}${detail}`;
}
