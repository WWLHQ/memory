// 批次62 · 硬前置召回 A/B/C 三层开关的渲染层桥。
// 语义边界：这里只说「用户意图」与「主进程回执的真值」，绝不在页面里推断网关是否在跑 / 门禁是否生效。
// 浏览器模式没有主进程 → available()=false，卡片如实显示不可用（不拿本地内存冒充）。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';
import type { RecallHardConfig } from '../../shared/recallHardConfig.ts';

export interface RecallHardStateView {
  ok: boolean;
  error?: string;
  config: RecallHardConfig;
  a: {
    enabled: boolean;
    /** 宿主 settings.json 里是否真装了本钩子（真值，不是配置） */
    installed: boolean;
    hostPath: string;
    hookScript: string;
    /** 钩子脚本文件是否真的存在 */
    scriptExists: boolean;
    note: string;
    /** hooks 不热加载：本次运行内改过 A 才需要重启宿主 */
    needsRestart: boolean;
  };
  b: {
    enabled: boolean;
    /** 网关监听是否真在跑（真值） */
    running: boolean;
    port: number;
    upstream: string;
    /** 给客户端填的 base_url */
    baseUrl: string;
    error?: string;
  };
  c: {
    enabled: boolean;
    /** 服务端**当前**求值结果（切换即时生效，等于 enabled 才算真生效） */
    effective: boolean;
  };
}

export interface RecallHardResult {
  ok: boolean;
  state: RecallHardStateView | null;
  error: string | null;
}

export function recallHardAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

const noHost = '当前不是桌面宿主环境：A/B/C 三层开关由主进程执行，浏览器模式没有它';

function toResult(r: RecallHardStateView | null | undefined, action: string): RecallHardResult {
  if (!r) return { ok: false, state: null, error: `${action}：主进程没有回执（宿主桥可能不可用）` };
  if (r.ok !== true) return { ok: false, state: r, error: r.error ?? `${action}失败（需要管理员权限？）` };
  return { ok: true, state: r, error: null };
}

async function call(method: 'recallHard:state' | 'recallHard:set', args: unknown[], action: string): Promise<RecallHardResult> {
  if (!recallHardAvailable()) return { ok: false, state: null, error: noHost };
  try {
    return toResult(await hostCall<RecallHardStateView>(method, [...args, getStoredSessionId()]), action);
  } catch (e) {
    return { ok: false, state: null, error: String((e as Error)?.message ?? e) };
  }
}

export const recallHardState = (): Promise<RecallHardResult> =>
  call('recallHard:state', [], '读取硬前置召回状态');

/** 只发送显式改动的字段：主进程按字段判断哪一层需要 reconcile。 */
export const recallHardSet = (patch: Partial<RecallHardConfig>): Promise<RecallHardResult> =>
  call('recallHard:set', [patch], '保存硬前置召回开关');
