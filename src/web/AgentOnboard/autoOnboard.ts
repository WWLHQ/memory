// 登录/手动自动接入链路（批次16）：
//   三路真实扫描（宿主进程+配置 / 五路安装痕迹 / MCP 客户端配置）→ 自动建卡 → 后端 auto_bind 审计
//   → 对「已连通」的可写 JSON 客户端自动写入 MCP（仅管理员；失败/冲突如实记录）。
// 纯浏览器无宿主能力：如实失败并写快照，接入页提示用户点「🔍 手动检测」，绝不用内核模拟冒充本机命中。
// 结果写 localStorage（跨 iframe 共享）→ 接入页经 storage 事件即时恢复，无需等用户切页重扫。
import type { AgentCard, AgentCardInput, DiscoveredAgent, Form, InstalledAgent } from '../../types/agentOnboard.ts';
import type { OneClickResult } from '../../agentOnboard/service.ts';
import { AgentOnboardClient } from '../../agentOnboard/client.ts';
import { onboardBaseUrl } from '../backend.ts';
import { currentSessionId } from '../shared/session.ts';
import { hostLog } from '../../desktop/hostBridge.ts';
import { makeCard, specOf } from './cards.ts';
import { addAgentCard, listDetectedAgents } from './store.ts';
import {
  clearOnboardState, writeOnboardState, type OnboardMcpSummary, type OnboardState,
} from './onboardState.ts';
import { autoWireMcpForAgents, scanLocalAgents, type LocalAgentScan } from './autoDiscovery.ts';

/** 失败快照：接入失败时写入，让接入页能区分「从未接入」与「接入失败（需重接）」 */
export interface OnboardFailure {
  failed: true;
  /** 真实失败原因（非桌面壳 / 三路扫描全部失败等） */
  reason: string;
  at: number;
  /** 失败时已探到的安装痕迹（接入页仍可展示并支持手动检测） */
  installed?: InstalledAgent[];
  installedProbes?: Record<string, string>;
  source?: 'host' | 'browser';
  capability?: LocalAgentScan['capability'];
}

export const ONBOARD_FAILURE_KEY = 'agentOnboardFailure';

const BACKEND_TIMEOUT_MS = 30_000;

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

function errText(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时（${ms}ms）`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function readOnboardFailure(): OnboardFailure | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ONBOARD_FAILURE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as OnboardFailure;
    return p?.failed ? p : null;
  } catch {
    return null;
  }
}

export function clearOnboardFailure(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ONBOARD_FAILURE_KEY);
}

/**
 * 批次33-A：本次登录会话是否已经自动扫过（值 = 已扫的 sessionId）。
 * 为什么按会话而不是时间窗口：批次18 用「近 60s 内有结果就复用」，用户切走再切回接入页时
 * 窗口早已过期 → 每次切页都重跑三路真扫（宿主扫描 + 后端拨测 + MCP 面板），既慢又刷屏（用户反馈第 1 条）。
 * 标记放 sessionStorage：同一个应用窗口内切页面共享（不再重扫），关掉窗口/重启后自动清空
 * （重启恢复会话仍补扫一轮，保留批次18 的语义）；换账号登录 sid 变了也照样扫。
 * 「手动检测 / 撤销重接」不受该标记约束，永远真扫。
 */
export const ONBOARD_AUTOSCAN_KEY = 'agentOnboardAutoScanSid';

/** 优先 sessionStorage（随窗口生命周期）；宿主环境没有时退回 localStorage（最多多扫一轮，不影响功能） */
function autoScanStore(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* 隐私模式/禁用存储 → 由调用方按「未标记」处理 */
  }
  return null;
}

export function hasAutoScannedSession(sid: string): boolean {
  try {
    return autoScanStore()?.getItem(ONBOARD_AUTOSCAN_KEY) === sid;
  } catch {
    return false;
  }
}

/** 起扫即标记（失败也标：本轮已如实给出的失败原因不该被切页反复重试；重扫请点「手动检测」） */
export function markAutoScannedSession(sid: string): void {
  try {
    autoScanStore()?.setItem(ONBOARD_AUTOSCAN_KEY, sid);
  } catch {
    /* 写不进去 → 下一次挂载仍会补扫一轮 */
  }
}

export function clearAutoScannedSession(): void {
  try {
    autoScanStore()?.removeItem(ONBOARD_AUTOSCAN_KEY);
  } catch {
    /* 无存储可清 */
  }
}

export interface RunAutoOnboardOptions {
  /** 登录会话角色（写 MCP 配置需管理员；缺省按无权限处理） */
  role?: 'admin' | 'member' | null;
  /** 登录会话 id（主进程二次校验管理员身份） */
  sid?: string | null;
  /** 端形态（auto_bind 审计 form 字段） */
  form?: Form;
  /** login=登录成功触发；auto=接入页启动补扫；manual=手动检测；rebind=撤销重接 */
  trigger?: 'login' | 'auto' | 'manual' | 'rebind';
}

export interface AutoOnboardOutcome {
  ok: boolean;
  /** 失败原因（ok=false 时必填） */
  reason?: string;
  scan: LocalAgentScan;
  discovered: DiscoveredAgent[];
  installed: InstalledAgent[];
  installedProbes: Record<string, string>;
  mcp?: OnboardMcpSummary;
  state?: OnboardState;
  backendOk: boolean;
  backendError?: string;
  ms: number;
}

let inFlight: Promise<AutoOnboardOutcome> | null = null;

/**
 * 执行一次完整自动接入（登录成功 / 用户点「手动检测」/「撤销并重接」共用）。
 * 同一时刻只跑一轮（并发调用共享同一份结果）。
 */
export function runAutoOnboard(opts: RunAutoOnboardOptions = {}): Promise<AutoOnboardOutcome> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const started = Date.now();
    // 批次33-A：登录/启动补扫按「一次登录一轮」记账（手动检测与撤销重接不受约束）。
    // 先记再扫：扫描中途切页时，重新挂载的接入页看到标记就不再重复起一轮三路真扫。
    if (opts.sid && (opts.trigger === 'login' || opts.trigger === 'auto')) markAutoScannedSession(opts.sid);
    const form = opts.form ?? 'desktop';
    const scan = await scanLocalAgents();

    if (!scan.ok) {
      const reason = scan.errors[0] ?? '本机扫描不可用（未返回任何真实信号）';
      const failure: OnboardFailure = {
        failed: true, reason, at: Date.now(),
        installed: scan.installed,
        installedProbes: scan.installedProbes,
        source: scan.source,
        capability: scan.capability,
      };
      try {
        localStorage.setItem(ONBOARD_FAILURE_KEY, JSON.stringify(failure));
      } catch { /* localStorage 不可用 → 仅返回结果，页面同进程内仍可展示 */ }
      hostLog('onboarding', 'auto-onboard', {
        trigger: opts.trigger ?? 'manual', ok: false, reason, capability: scan.capability,
        installed: scan.installed.length, errors: scan.errors, ms: Date.now() - started,
      }, { level: 'warn' });
      return {
        ok: false, reason, scan, discovered: [], installed: scan.installed,
        installedProbes: scan.installedProbes, backendOk: false, ms: Date.now() - started,
      };
    }

    // 自动建卡：只补新发现的 agent，已有卡片快照保留用户配置（不覆盖）
    const existing = new Set(listDetectedAgents().map((s) => keyOf(s.name)));
    for (const d of scan.discovered) {
      if (existing.has(keyOf(d.name))) continue;
      const spec = specOf(d.name);
      const card = makeCard(d.name, { ...spec, badge: d.badge, label: d.label }, 'connected');
      addAgentCard(d.name, card);
    }

    // 后端 auto_bind：真实拨测 + 审计（卡片指标的唯一数据源）
    let backendOk = false;
    let backendError: string | undefined;
    let backendCards: AgentCard[] = [];
    if (scan.discovered.length > 0) {
      try {
        const client = new AgentOnboardClient(onboardBaseUrl(), globalThis.fetch, () => currentSessionId());
        const inputs = scan.discovered.map((d) => ({
          name: d.name,
          priority: d.badge.toUpperCase() as AgentCardInput['priority'],
          signal: d.signal,
        }));
        const res: OneClickResult = await withTimeout(client.oneClickOnboard(inputs, form), BACKEND_TIMEOUT_MS);
        backendOk = res?.ok === true && Array.isArray(res.cards);
        backendCards = backendOk ? res.cards : [];
        if (!backendOk) backendError = '接入后端返回失败（未写入 auto_bind 审计）';
      } catch (e) {
        backendError = `接入后端不可达：${errText(e)}`;
      }
    }

    // MCP 自动写入：后端拨测通过（CONNECTED）的 agent 才写；后端不可达时以宿主真扫命中为连接证据
    const connectedNames = backendOk
      ? backendCards.filter((c) => c.status === 'CONNECTED').map((c) => c.agent_name)
      : scan.discovered.map((d) => d.name);
    const mcp = connectedNames.length > 0
      ? await autoWireMcpForAgents(connectedNames, scan, { sid: opts.sid ?? null, role: opts.role ?? null })
      : undefined;

    const state: OnboardState = {
      lastOnboardAt: Date.now(),
      agentNames: scan.discovered.map((d) => d.name),
      source: 'host',
      discovered: scan.discovered,
      installed: scan.installed,
      installedProbes: scan.installedProbes,
      ...(mcp ? { mcp } : {}),
      backendOk,
      ...(backendError ? { backendError } : {}),
      seq: Date.now(),
    };
    try {
      writeOnboardState(state);
      clearOnboardFailure();
    } catch { /* 持久化失败：本次页面仍可用返回结果展示 */ }

    hostLog('onboarding', 'auto-onboard', {
      trigger: opts.trigger ?? 'manual', ok: true, found: scan.discovered.length,
      installed: scan.installed.length, source: scan.source, capability: scan.capability,
      backendOk, backend: backendError, scans: scan.errors,
      mcp: mcp ? { wired: mcp.wired.length, changed: mcp.changed.length, manual: mcp.manual.length, failed: mcp.failed.length } : null,
      ms: Date.now() - started,
    });

    return {
      ok: true, scan, discovered: scan.discovered, installed: scan.installed,
      installedProbes: scan.installedProbes, mcp, state, backendOk, backendError,
      ms: Date.now() - started,
    };
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** 登录成功后调用：后台跑一次完整扫描与接入（不阻塞登录） */
export function runAutoOnboardOnLogin(opts: RunAutoOnboardOptions = {}): Promise<AutoOnboardOutcome> {
  return runAutoOnboard({ ...opts, trigger: opts.trigger ?? 'login' });
}

/** 清除旧接入状态（登出/重接时调用）：批次33-A 一并清掉「本次登录已扫」标记，重接后允许再扫一轮 */
export function resetAutoOnboardState(): void {
  clearOnboardFailure();
  clearOnboardState();
  clearAutoScannedSession();
}

export type { OnboardMcpSummary };
