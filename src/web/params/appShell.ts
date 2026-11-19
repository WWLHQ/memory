// 阶段 A · 参数页两个开关（托盘常驻 / 开机自启）的渲染层桥。
//
// 语义边界：页面只显示**主进程回执的真值**（keepInTray / autoStart / applied / trayActive），
// 绝不在渲染层推断「关窗后会不会退出」「系统登录项写没写」——这些只有主进程知道。
// 浏览器模式没有主进程 → available()=false，卡片如实说不可用，不拿 localStorage 冒充。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export interface AppShellStateView {
  ok: boolean;
  error?: string;
  /** 关窗是否只隐藏（托盘常驻）——主进程已落盘的值 */
  keepInTray: boolean;
  /** 是否开机自启——主进程已落盘的值（无常驻时必然为 false） */
  autoStart: boolean;
  platform: string;
  /** 系统里**真有没有**登录项：true/false；null = 无法确认（非 Windows / 开发态 / 读取失败） */
  applied: boolean | null;
  /** 托盘对象当前是否真的存在 */
  trayActive: boolean;
  /** 无法确认时的人话原因，空串=可用 */
  autostartNote: string;
}

export interface AppShellPatch {
  keepInTray?: boolean;
  autoStart?: boolean;
}

export interface AppShellResult {
  ok: boolean;
  state: AppShellStateView | null;
  error: string | null;
}

export function appShellAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

const NO_HOST = '当前不是桌面宿主环境：托盘常驻与开机自启由主进程执行（改窗口生命周期 / 写系统登录项），浏览器模式没有它';

function toResult(r: AppShellStateView | null | undefined, action: string): AppShellResult {
  if (!r) return { ok: false, state: null, error: `${action}：主进程没有回执（宿主桥可能不可用）` };
  if (r.ok !== true) return { ok: false, state: r, error: r.error ?? `${action}失败（需要登录会话）` };
  return { ok: true, state: r, error: null };
}

async function call(method: 'appShell:state' | 'appShell:set', args: unknown[], action: string): Promise<AppShellResult> {
  if (!appShellAvailable()) return { ok: false, state: null, error: NO_HOST };
  try {
    return toResult(await hostCall<AppShellStateView>(method, [...args, getStoredSessionId()]), action);
  } catch (e) {
    return { ok: false, state: null, error: String((e as Error)?.message ?? e) };
  }
}

export const appShellState = (): Promise<AppShellResult> =>
  call('appShell:state', [], '读取壳层设置');

/** 只发显式改动的字段（另一项不动），回执是新真值 */
export const appShellSet = (patch: AppShellPatch): Promise<AppShellResult> =>
  call('appShell:set', [patch], '保存壳层设置');
