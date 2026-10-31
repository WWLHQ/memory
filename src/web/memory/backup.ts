// 记忆库管理页 · 自动备份（P8 扩展）：渲染层经 hostCall 走 preload IPC 调主进程备份能力。
// 浏览器/宿主桥不可达时诚实降级（返回 ok:false + 原因），UI 据此显示。
import { hostCapability, hostCall } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export interface BackupConfigView {
  enabled: boolean;
  dir: string;      // 备份位置；空 = 默认 <数据根目录>/backups
  hour: number;
  minute: number;
  keepCount: number;
  lastRun?: string;
  lastOk?: boolean;
}

export interface BackupItem {
  name: string;
  time: string;
  size: number;
}

export type BackupOpResult<T = unknown> =
  | ({ ok: true; data?: unknown } & T)
  | ({ ok: false; error: string } & T);

/** 能力探测：native/bridge = 桌面壳可真实备份；none = 浏览器模式，仅展示不可操作 */
export function backupAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

export async function backupGetConfig(): Promise<BackupOpResult<{ cfg?: BackupConfigView }>> {
  try {
    const cfg = await hostCall<BackupConfigView>('backup:getConfig');
    return { ok: true, cfg };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 保存备份配置（敏感操作）：主进程按 sessionId 校验管理员 */
export async function backupSaveConfig(patch: Partial<BackupConfigView>): Promise<BackupOpResult<{ cfg?: BackupConfigView }>> {
  try {
    const res = await hostCall<{ ok: boolean; cfg?: BackupConfigView; error?: string }>(
      'backup:saveConfig', [patch, getStoredSessionId()],
    );
    if (!res.ok) return { ok: false, error: res.error ?? '保存失败（需要管理员权限）' };
    return { ok: true, cfg: res.cfg };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 选择备份目录（敏感操作）：主进程按 sessionId 校验管理员 */
export async function backupChooseDir(): Promise<BackupOpResult<{ dir?: string }>> {
  try {
    const res = await hostCall<{ ok: boolean; dir: string; error?: string }>(
      'backup:chooseDir', [getStoredSessionId()],
    );
    return res.ok ? { ok: true, dir: res.dir } : { ok: false, error: res.error ?? '已取消选择' };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 立即备份（敏感操作）：主进程按 sessionId 校验管理员 */
export async function backupRunNow(): Promise<BackupOpResult<{ file?: string }>> {
  try {
    const res = await hostCall<{ ok: boolean; file?: string; error?: string }>(
      'backup:runNow', [getStoredSessionId()],
    );
    if (res.ok) return { ok: true, file: res.file };
    return { ok: false, error: res.error ?? '备份失败' };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export async function backupList(): Promise<BackupOpResult<{ dir?: string; items?: BackupItem[] }>> {
  try {
    const res = await hostCall<{ dir: string; items: BackupItem[] }>('backup:list');
    return { ok: true, dir: res.dir, items: res.items };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
