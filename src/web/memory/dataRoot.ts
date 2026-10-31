// 数据存放位置（批次6）：记忆库/采集游标/日志/MCP 令牌/备份配置等全部数据挂在用户选定目录。
// 渲染层经 hostCall 走 preload IPC（或 iframe 宿主桥）；浏览器模式诚实禁用。
import { hostCapability, hostCall } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export interface DataRootInfo {
  root: string;
  defaultRoot: string;
  isDefault: boolean;
  pointer: string;
  activeDbPath: string;
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
