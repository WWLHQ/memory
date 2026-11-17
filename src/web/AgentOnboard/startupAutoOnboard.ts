// 应用启动即自动发现并接入本机 Agent（2026-11-16 用户要求）。
//
// 为什么不能挂在接入页上：agentonboard.html 是中心区 iframe，只有用户主动点「Agent 接入」才挂载。
// 用户整场会话都不点它 → 「自动发现」一次都不会跑，看上去像「没发现本机 Agent」。
// 壳层 workspace.html 是应用启动必挂载的顶层页面，且宿主 preload 只注入顶层 frame
// （宿主真扫 / 安装痕迹 / MCP 配置写入这些能力只在这里可用），所以启动扫描只能放这里。
//
// 诚实边界：
// - 未登录不扫：写入 MCP 配置要真实会话校验管理员权限，扫了也只能记一堆「无会话」；
//   登录成功那条链路（LoginModal / 壳层 effect）会补扫。
// - 同一窗口只扫一轮（会话内标记 + 本模块单次闸），切页/重挂不会重复三路真扫。
import type { Form } from '../../types/agentOnboard.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';
import { detectForm } from '../shared/detectForm.ts';
import { hostLog } from '../../desktop/hostBridge.ts';
import {
  hasAutoScannedSession, runAutoOnboard, type AutoOnboardOutcome,
} from './autoOnboard.ts';

export interface StartupAutoOnboardOptions {
  /** 登录会话角色（写 MCP 配置需管理员；缺省按无权限处理） */
  role?: 'admin' | 'member' | null;
  /** 登录会话 id；缺省读本机存储的 sessionId */
  sid?: string | null;
  /** 端形态（auto_bind 审计 form 字段）；缺省按 UA 判 */
  form?: Form;
  /** 启动后延迟多久再扫（毫秒）：先让壳层画出来，别和首屏抢主进程。缺省 1200 */
  delayMs?: number;
  /** 测试用：忽略「本窗口已发起过」闸，强制再跑一轮 */
  force?: boolean;
}

/** 本窗口是否已发起过启动扫描（StrictMode 双挂载 / 多个 effect 只算一次） */
let launched = false;
let pending: Promise<AutoOnboardOutcome | null> | null = null;

/** 测试用：重置本模块的单次闸（不影响会话内标记） */
export function resetStartupAutoOnboardForTest(): void {
  launched = false;
  pending = null;
}

function schedule(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
}

/**
 * 启动扫描入口（壳层挂载后调用；可重复调用，只有第一次真正起扫描）。
 * 返回 null 表示「本轮没有起扫描」（未登录 / 本窗口已扫过 / 该会话已扫过），原因已写动作日志。
 */
export function runStartupAutoOnboard(opts: StartupAutoOnboardOptions = {}): Promise<AutoOnboardOutcome | null> {
  if (!opts.force && launched) return pending ?? Promise.resolve(null);
  // 语义要分清：undefined = 调用方没给（自己去存储里找）；null = 明确「当前没有会话」。
  // 用 ?? 会把 null 也当成「没给」→ 拿旧 sid 去扫，正好把「未登录不扫」这条边界吃掉。
  const sid = opts.sid !== undefined ? opts.sid : getStoredSessionId();
  if (!sid) {
    hostLog('onboarding', 'startup-auto-onboard', { skipped: 'no-session' });
    return Promise.resolve(null);
  }
  // 登录链路已经扫过这一轮 → 不重复三路真扫（扫描很重：宿主进程/安装痕迹/MCP 配置）
  if (!opts.force && hasAutoScannedSession(sid)) {
    hostLog('onboarding', 'startup-auto-onboard', { skipped: 'already-scanned' });
    return Promise.resolve(null);
  }
  launched = true;
  const delayMs = opts.delayMs ?? 1200;
  hostLog('onboarding', 'startup-auto-onboard', { scheduled: true, delayMs, role: opts.role ?? null });
  pending = schedule(delayMs)
    .then(() => runAutoOnboard({
      role: opts.role ?? null,
      sid,
      form: opts.form ?? detectForm(),
      trigger: 'auto',
    }))
    .then((out) => {
      hostLog('onboarding', 'startup-auto-onboard:done', {
        ok: out.ok,
        discovered: out.discovered.length,
        installed: out.installed.length,
        backendOk: out.backendOk,
        mcp: out.mcp
          ? { wired: out.mcp.wired.length, changed: out.mcp.changed.length, failed: out.mcp.failed.length }
          : null,
        reason: out.reason ?? null,
        ms: out.ms,
      }, out.ok ? {} : { level: 'warn' });
      return out;
    })
    .catch((e: unknown) => {
      // 壳层不因自动接入失败而受影响：接入页会按持久化的失败快照如实展示原因
      hostLog('onboarding', 'startup-auto-onboard:error', {
        error: String((e as Error)?.message ?? e),
      }, { level: 'error' });
      return null;
    })
    .finally(() => { pending = null; });
  return pending;
}
