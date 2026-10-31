// 主进程动作日志（批次7）：把 shared/actionLog 的条目追加到 <数据根>/actions.log。
// 设计取舍：
// - 同步 append：崩溃前的最后动作也能落盘；日志量级低（点击/IPC/HTTP 每动作一行），不构成瓶颈。
// - 大小轮转：超过 maxBytes 后 actions.log → actions.1.log …，最多保留 keep 份，防无限膨胀。
// - 任何失败都静默：日志问题绝不能影响业务主流程。
// - 未初始化（数据根尚未就绪）时调用 = 空操作，避免启动早期 ReferenceError。
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  createActionLogEntry,
  formatActionLine,
  type ActionLogOptions,
  type ActionLogTailResult,
} from '../shared/actionLog.ts';

export interface ActionLogInitOptions {
  /** actions.log 绝对路径（应位于数据根目录） */
  file: string;
  /** 单文件上限（字节），缺省 5 MiB */
  maxBytes?: number;
  /** 轮转保留份数，缺省 3 */
  keep?: number;
  /** 是否同时镜像到控制台（开发/诊断用），缺省 true */
  mirrorConsole?: boolean;
}

interface ActionLogState {
  file: string;
  maxBytes: number;
  keep: number;
  mirrorConsole: boolean;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP = 3;

let state: ActionLogState | null = null;

/** 初始化（bootstrap 内 USER_DATA 确定后调用一次；重复调用以最后一次为准） */
export function initActionLog(opts: ActionLogInitOptions): void {
  state = {
    file: opts.file,
    maxBytes: Math.max(64 * 1024, opts.maxBytes ?? DEFAULT_MAX_BYTES),
    keep: Math.max(1, opts.keep ?? DEFAULT_KEEP),
    mirrorConsole: opts.mirrorConsole !== false,
  };
  try {
    mkdirSync(dirname(opts.file), { recursive: true });
  } catch {
    /* 目录不可写：后续 append 失败也会静默 */
  }
}

/** 当前日志文件路径（未初始化返回 null；供「日志在哪」展示） */
export function actionLogPath(): string | null {
  return state?.file ?? null;
}

/** 轮转：actions.log → actions.1.log，旧文件依次后移，超出 keep 的删除 */
function rotate(s: ActionLogState): void {
  try {
    if (s.keep <= 1) {
      unlinkSync(s.file);
      return;
    }
    const oldest = `${s.file}.${s.keep - 1}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = s.keep - 2; i >= 1; i--) {
      const from = `${s.file}.${i}`;
      if (existsSync(from)) renameSync(from, `${s.file}.${i + 1}`);
    }
    renameSync(s.file, `${s.file}.1`);
  } catch {
    /* 轮转失败：继续写当前文件，宁可超出上限也不丢日志 */
  }
}

/**
 * 写一条动作日志。scope/action 为必填；detail 会自动脱敏与截断。
 * 未初始化时返回 false（调用方可判空，但通常无需关心）。
 */
export function actionLog(
  scope: string,
  action: string,
  detail?: unknown,
  opts: ActionLogOptions = {},
): boolean {
  const s = state;
  if (!s) return false;
  const entry = createActionLogEntry(scope, action, detail, opts);
  const line = formatActionLine(entry) + '\n';
  try {
    try {
      if (statSync(s.file).size > s.maxBytes) rotate(s);
    } catch {
      /* 文件尚不存在 / 无法 stat：直接 append 即可 */
    }
    appendFileSync(s.file, line, 'utf8');
  } catch {
    /* 日志失败不影响业务 */
  }
  if (s.mirrorConsole) {
    try {
      if (entry.level === 'error') console.error(line.trimEnd());
      else if (entry.level === 'warn') console.warn(line.trimEnd());
      else console.log(line.trimEnd());
    } catch {
      /* console 不可用 */
    }
  }
  return true;
}

/** 便捷：错误级日志（异常对象自动转 name/message） */
export function actionLogError(scope: string, action: string, err: unknown, detail?: unknown): void {
  actionLog(scope, action, { ...(detail && typeof detail === 'object' ? detail : {}), error: err }, { level: 'error' });
}

/** 尾读窗口上限：单行日志最长约 1KB（detail 截断 500 字），128KB 足够覆盖 50 行且不整文件读入 */
const TAIL_CHUNK_BYTES = 128 * 1024;
const TAIL_MAX_LINES = 50;

/** 从文件末尾读取最后 limit 行；文件不存在/不可读返回空数组（绝不抛错打断调用方） */
function readTailLines(file: string, limit: number): string[] {
  if (limit <= 0) return [];
  let fd: number | null = null;
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size <= 0) return [];
    const readBytes = Math.min(st.size, TAIL_CHUNK_BYTES);
    const buf = Buffer.allocUnsafe(readBytes);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, readBytes, st.size - readBytes);
    const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0);
    // 只读了文件尾部：首行可能被截断，丢弃它避免展示半行
    if (readBytes < st.size) lines.shift();
    return lines.slice(-limit);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* 关闭失败不影响读取结果 */
      }
    }
  }
}

/**
 * 尾读动作日志（程序运行日志窗口，批次19 起由日志记录页使用）。
 * - 顺序为「旧 → 新」，最多 limit 条（1..50，批次24 起日志窗口可回看整段）；
 * - 当前文件不足时回退到 actions.log.1 / .2 …，跨轮转仍能看到最近的连续日志；
 * - 未初始化返回 ok=false；文件尚未创建返回 ok=true + 空数组（界面显示真实空态）。
 */
export function tailActionLog(limit = 5): ActionLogTailResult {
  const s = state;
  if (!s) return { ok: false, path: null, lines: [], error: '程序日志尚未初始化（数据根未就绪）' };
  const want = Number.isFinite(limit) ? Math.min(TAIL_MAX_LINES, Math.max(1, Math.floor(limit))) : 5;
  const files = [s.file];
  for (let i = 1; i <= s.keep; i++) files.push(`${s.file}.${i}`);

  const out: string[] = [];
  for (const file of files) {
    if (out.length >= want) break;
    const part = readTailLines(file, want - out.length);
    if (part.length > 0) out.unshift(...part);
  }
  return { ok: true, path: s.file, lines: out.slice(-want) };
}

/** 测试专用：重置初始化状态 */
export function resetActionLog(): void {
  state = null;
}
