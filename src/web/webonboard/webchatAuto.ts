// 网页端接入页 ·「网页会话自动采集」卡的渲染层桥（2026-11-19 自参数页迁入）。
//
// 语义边界：页面只显示主进程回执的真值（本轮结果 / 下次时间 / 是否在跑），
// 不在渲染层推断「站点登录有没有过期」——那只能由真跑一轮才知道。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export type AutoSiteStatus = 'exported' | 'no_new' | 'need_relogin' | 'dom_changed' | 'error' | 'skipped';

/** 状态枚举的中文名（唯一来源；页面不许自己再写一套） */
export const AUTO_STATUS_LABEL: Record<AutoSiteStatus, string> = {
  exported: '已导出',
  no_new: '无新增',
  need_relogin: '需要重新登录',
  dom_changed: '页面结构变了',
  error: '失败',
  skipped: '已跳过',
};

export interface AutoConfigView {
  enabled: boolean;
  intervalMinutes: number;
  /** 定时轮每轮最多收几条新的（已采过的不占名额） */
  perRound: number;
  sites: string[];
}

export interface AutoSiteResult {
  site: string;
  status: AutoSiteStatus;
  scanned: number;
  /** 已在册（导出目录里已有同名文件）而跳过的条数 */
  skipped?: number;
  exported: number;
  /** 发现了但抽取失败的条数 */
  missing?: number;
  reason?: string;
}

export interface AutoRoundView {
  at: number;
  trigger: 'timer' | 'manual' | 'startup' | 'sweep';
  results: AutoSiteResult[];
}

export interface AutoStateView {
  ok: boolean;
  error?: string;
  config: AutoConfigView;
  running: boolean;
  lastRound: AutoRoundView | null;
  nextAt: number | null;
  loginWindows: string[];
  sites: Array<{ key: string; label: string }>;
  blocked: string;
  /** 站点最近一次重新登录时间；晚于 lastRound.at 的 need_relogin 已被处理，计数剔除 */
  relogins: Record<string, number>;
}

/** 失败站点摘要（页面摘要卡与卡片明细共用；只带主进程真值，不推断原因） */
export interface AutoFailureBrief {
  site: string;
  label: string;
  status: AutoSiteStatus;
  reason: string;
  advice: string;
}

/**
 * 失败态的中文处理建议（唯一真源；页面与卡片共用）。
 * 只按主进程已经给出的 reason 归类，不编造未给出的原因；所有动作都在本页有真实按钮。
 */
export function failureAdvice(status: AutoSiteStatus, reason: string): string {
  if (status === 'dom_changed') {
    return reason.includes('地址都没变')
      ? '页面结构变了：点过会话但页面没切换（侧栏条目可能不是会话链接）。先点「打开登录窗」确认登录态，再点「立即采一轮」；仍失败在「采集站点」取消勾选该站点，等适配后再启用。'
      : '页面结构变了：先点该站点「打开登录窗」重新登录，再点「立即采一轮」；仍失败看下方本轮明细的诊断。';
  }
  if (reason.includes('页面执行失败') || reason.includes('WebFrame')) {
    return '隐藏页面在脚本执行前被关闭：点「立即采一轮」重试；仍失败在「采集站点」取消勾选该站点，等适配后再启用。';
  }
  if (reason.includes('接收端未就绪')) {
    return '本机接收端未就绪：确认桌面端仍在运行、导出目录可写，再点「立即采一轮」。';
  }
  if (reason.includes('入口地址')) {
    return '该站点没有配置入口地址：在上方「采集站点」里取消勾选它。';
  }
  if (reason.includes('导出失败')) {
    return '导出落盘失败：检查导出目录权限与剩余空间，再点「补齐历史会话」。';
  }
  return '按上面的原因处理后点「立即采一轮」；连续失败看下方本轮明细与动作日志。';
}

export interface AutoResult {
  ok: boolean;
  state: AutoStateView | null;
  error: string | null;
}

export interface AutoPatch {
  enabled?: boolean;
  intervalMinutes?: number;
  perRound?: number;
  sites?: string[];
}

export function webchatAutoAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

const NO_HOST = '当前不是桌面宿主环境：自动采集要起隐藏浏览器并写进本机接收端，浏览器模式没有它';

function toResult(r: AutoStateView | null | undefined, action: string): AutoResult {
  if (!r) return { ok: false, state: null, error: `${action}：主进程没有回执（宿主桥可能不可用）` };
  if (r.ok !== true) {
    // 失败回执可能只有 { ok:false, error }（未授权 / 接收端未就绪 / 采集抛错），根本没有 config。
    // 把它当 state 交给组件会让 `config.sites` 直接崩在渲染里——失败时宁可不更新状态。
    const looksLikeState = r.config && Array.isArray(r.config.sites);
    return { ok: false, state: looksLikeState ? r : null, error: r.error ?? `${action}失败` };
  }
  return { ok: true, state: r, error: null };
}

async function call(
  method: 'webchatAuto:state' | 'webchatAuto:set' | 'webchatAuto:run' | 'webchatAuto:sweep', args: unknown[], action: string,
): Promise<AutoResult> {
  if (!webchatAutoAvailable()) return { ok: false, state: null, error: NO_HOST };
  try {
    const raw = await hostCall<AutoStateView & { state?: AutoStateView }>(method, [...args, getStoredSessionId()]);
    // run 的回执是 {ok, summary, state}：真值在 state 里，summary 只用于账本
    const view = (raw && typeof raw === 'object' && 'state' in raw && raw.state) ? raw.state : raw;
    return toResult(view as AutoStateView, action);
  } catch (e) {
    return { ok: false, state: null, error: String((e as Error)?.message ?? e) };
  }
}

export const webchatAutoState = (): Promise<AutoResult> => call('webchatAuto:state', [], '读取自动采集状态');
export const webchatAutoSet = (patch: AutoPatch): Promise<AutoResult> => call('webchatAuto:set', [patch], '保存自动采集设置');
export const webchatAutoRun = (): Promise<AutoResult> => call('webchatAuto:run', [], '立即采一轮');
/**
 * 补齐历史（现语义：全量对账同步）：每批都从侧栏顶部发现会话，与导出目录里的 <会话ID>.md 做差集。
 * 没有游标、没有「上次停在第几条」，删掉某个 md 文件后点它就能把那条重新采回来。
 */
export const webchatAutoSweep = (): Promise<AutoResult> => call('webchatAuto:sweep', [], '补齐历史');

/** 打开登录窗口（可见窗口，用户自己登；登录态落在该站点的持久 partition 里） */
export async function webchatAutoLogin(site: string): Promise<{ ok: boolean; error?: string }> {
  if (!webchatAutoAvailable()) return { ok: false, error: NO_HOST };
  try {
    return await hostCall<{ ok: boolean; error?: string }>('webchatAuto:login', [site, getStoredSessionId()]);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 网页对话导出目录：路径只从主进程读，渲染层不硬编码、不猜 */
export interface ExportDirView {
  ok: boolean;
  dir?: string;
  pluginDir?: string | null;
  aligned?: boolean | null;
  error?: string;
}

export async function webchatExportDir(): Promise<ExportDirView> {
  if (!webchatAutoAvailable()) return { ok: false, error: NO_HOST };
  try {
    return await hostCall<ExportDirView>('chatExports:get', []);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 在系统文件管理器里打开当前导出目录 */
export async function webchatExportOpen(): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!webchatAutoAvailable()) return { ok: false, error: NO_HOST };
  try {
    return await hostCall<{ ok: boolean; path?: string; error?: string }>('chatExports:open', []);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 弹系统目录选择框改导出目录；取消 = 现状不变 */
export async function webchatExportSet(): Promise<{ ok: boolean; dir?: string; canceled?: boolean; error?: string }> {
  if (!webchatAutoAvailable()) return { ok: false, error: NO_HOST };
  try {
    return await hostCall<{ ok: boolean; dir?: string; canceled?: boolean; error?: string }>('chatExports:set', []);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
