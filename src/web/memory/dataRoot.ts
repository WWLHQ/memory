// 数据存放位置（批次6）：记忆库/采集游标/日志/MCP 令牌/备份配置等全部数据挂在用户选定目录。
// 渲染层经 hostCall 走 preload IPC（或 iframe 宿主桥）；浏览器模式诚实禁用。
import { hostCapability, hostCall } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export interface AuditLogInfo {
  path: string;
  /** 轮转出的旧审计行所在目录（与审计账本同目录下的 audit-archive/） */
  archive_dir: string;
  rows: number;
  bytes: number;
  archive_files: number;
  archive_bytes: number;
  archived_rows: number;
  /** 读不动的坏行数（只计数、绝不静默丢弃） */
  skipped_lines: number;
  readonly: boolean;
  /** 本次启动从主库文件里搬进独立账本的历史审计行数（0 = 早已搬完或本来就没有） */
  migrated_rows: number;
  /** 主库文件里仍留着的旧审计行数（只读镜像会有值：不迁移，查询时合并） */
  legacy_rows_in_ledger: number;
  corruption: { db_path: string; backup_path: string | null; error: string; ts: string } | null;
}

export interface DataRootInfo {
  root: string;
  defaultRoot: string;
  isDefault: boolean;
  pointer: string;
  activeDbPath: string;
  /** 批次37-A：L0 原数据库文件（密文独立成库；旧数据根尚无此文件时主进程返回其目标路径） */
  activeL0Path?: string;
  /** 批次37-A：L0 库被其它进程持有写锁 → 只读（写入会被拒） */
  l0ReadOnly?: boolean;
  /** 批次41-A：内核审计账本（追加式 JSONL，跟记忆库同目录）位置与体量 */
  activeAuditPath?: string;
  audit?: AuditLogInfo;
  /** 动作日志文件（批次7）：<数据根>/actions.log */
  actionsLogPath?: string;
}

export interface DataRootChangeResult {
  ok: boolean;
  root?: string;
  path?: string;
  restartRequired?: boolean;
  canceled?: boolean;
  error?: string;
}

export function dataRootAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

export async function getDataRoot(): Promise<{ ok: true; info: DataRootInfo } | { ok: false; error: string }> {
  try {
    return { ok: true, info: await hostCall<DataRootInfo>('dataRoot:get') };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export async function openDataRoot(): Promise<DataRootChangeResult> {
  try {
    return await hostCall<DataRootChangeResult>('dataRoot:open');
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 更改数据位置（敏感操作）：主进程按 sessionId 校验管理员 */
export async function changeDataRoot(): Promise<DataRootChangeResult> {
  try {
    return await hostCall<DataRootChangeResult>('dataRoot:change', [getStoredSessionId()]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 恢复默认数据位置（敏感操作）：主进程按 sessionId 校验管理员 */
export async function restoreDefaultDataRoot(): Promise<DataRootChangeResult> {
  try {
    return await hostCall<DataRootChangeResult>('dataRoot:restoreDefault', [getStoredSessionId()]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
