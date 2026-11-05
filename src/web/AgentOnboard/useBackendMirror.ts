// 真实后端镜像（接T13/T14）：把 UI 动作 best-effort 打到后端，并在挂载时 GET /agents 回填、
// GET /audit 汇总每家 Agent 的真实统计（测试次数/通过率/最近轮换）。
// ⚠ 不改变原型视觉与同步交互：失败仅静默（页面与原型完全一致）。
import { useCallback, useEffect, useRef } from 'react';
import { AgentOnboardService } from '../../agentOnboard/service.ts';
import { AgentOnboardClient } from '../../agentOnboard/client.ts';
import type { AgentCard, AgentCardInput, AgentRealStats, Form, UiAgentCard } from '../../types/agentOnboard.ts';
import type { AuditEntry, TestResult } from '../../agentOnboard/service.ts';
import { onboardBaseUrl } from '../backend.ts';
import { currentSessionId } from '../shared/session.ts';

/** 默认本地 T13 后端（ONBOARD_BASE）；?agentBackend= → ?backend= 可覆盖，空值表示纯前端。 */
export function resolveBackendUrl(): string {
  return onboardBaseUrl();
}

export function createService(url: string): AgentOnboardService<AgentOnboardClient | null> {
  return url
    ? new AgentOnboardService<AgentOnboardClient>(new AgentOnboardClient(url, globalThis.fetch, () => currentSessionId()))
    : new AgentOnboardService();
}

/** UiAgentCard（原型形状）→ 服务层入参（只取可映射字段） */
export function toServiceInput(a: UiAgentCard): AgentCardInput {
  return {
    agent_name: a.name,
    priority: a.badge.toUpperCase() as AgentCardInput['priority'],
    circuit: a.circuit === 'HALF_OPEN' ? 'HALF_OPEN' : a.circuit === 'OPEN' ? 'OPEN' : 'CLOSED',
    tenantManual: false, // R1：租户仅全局注入
    mcpTools: {
      recall_memory: { project_id: 'p1', scene: a.tools.recall.scene, mode: a.tools.recall.mode || null, top_k: a.tools.recall.topk },
      write_memory: { project_id: 'p1' },
      get_preferences: { user_id: 'u1' },
    },
    channels: { webhook: a.chan.webhook, apiPull: a.chan.api },
  };
}

/**
 * Agent 名归一化：本机扫描 / 审计 / 卡片三处写法可能只差大小写或空白
 * （如 `deepseek harness` vs `DeepSeek Harness`），匹配一律按此键，避免指标静默丢失。
 */
export function normalizeAgentKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 按归一化名取指标（页面 stats[a.name] 的容错版：精确名不命中时再按归一化名找） */
export function statsForAgent(
  stats: Record<string, AgentRealStats> | undefined,
  name: string,
): AgentRealStats | undefined {
  if (!stats) return undefined;
  if (stats[name]) return stats[name];
  const key = normalizeAgentKey(name);
  for (const [k, v] of Object.entries(stats)) {
    if (normalizeAgentKey(k) === key) return v;
  }
  return undefined;
}

/**
 * 从接入后端审计流（GET /audit）汇总每家 Agent 的真实统计（纯函数，可单测）：
 *  · tests/passed：test 与 auto_bind（登录自动接入）的次数与通过次数 → 真实连通成功率
 *  · lastRtt/avgRtt：审计里记录的真实探测耗时（服务端 Date.now 差值）→ 最近/平均延时
 *  · lastRotateAt：最近一次 rotate 动作 ts → 真实轮换时间
 *  · 审计暂不可读时用 /agents 卡片的 lastTest（含服务端真实 durationMs）兜底，
 *    保证接入后卡片仍有成功率/延时样本；审计有该 Agent 记录时以审计为准（不重复计数）。
 * 批次22：
 *  · 旧版 auto_bind 只有绑定动作、没有 status/result → 不计入分母（历史无结论样本不算失败）；
 *  · 审计样本都缺 durationMs、或只剩旧样本时，用 /agents lastTest 的真实耗时/结论补 1 个样本；
 *  · 指标键按归一化名合并，输出用卡片展示名（无卡片时用审计里的首个写法）。
 */
export function computeAgentStats(
  entries: AuditEntry[], cards: AgentCard[] = [],
): Record<string, AgentRealStats> {
  /** 归一化名 → 展示名（卡片名优先，保证 UI 用卡片上的名字查得到） */
  const display = new Map<string, string>();
  const byKey = new Map<string, AgentRealStats>();
  const rttSum = new Map<string, { sum: number; n: number }>();
  const ensure = (key: string, fallbackName: string): AgentRealStats => {
    if (!display.has(key)) display.set(key, fallbackName);
    let cur = byKey.get(key);
    if (!cur) {
      cur = { tests: 0, passed: 0 };
      byKey.set(key, cur);
    }
    return cur;
  };
  for (const c of cards) {
    const n = typeof c?.agent_name === 'string' ? c.agent_name.trim() : '';
    if (!n) continue;
    const key = normalizeAgentKey(n);
    if (!display.has(key)) display.set(key, n);
  }
  for (const e of entries) {
    const agent = typeof e.agent === 'string' ? e.agent.trim() : '';
    if (!agent) continue;
    const key = normalizeAgentKey(agent);
    const cur = ensure(key, agent);
    const ts = typeof e.ts === 'number' ? e.ts : undefined;
    if (e.action === 'test' || e.action === 'auto_bind') {
      const status = String((e as { status?: unknown }).status ?? '').toUpperCase();
      const result = String((e as { result?: unknown }).result ?? '').toLowerCase();
      // 旧版 auto_bind 只有「已绑定」事实，无法判定成败：留时间但不计入分母
      const hasOutcome = status !== '' || result !== '';
      if (hasOutcome) {
        cur.tests += 1;
        if (status.includes('CONNECTED') || result === 'pass') cur.passed += 1;
        const ms = Number((e as { durationMs?: unknown }).durationMs);
        if (Number.isFinite(ms) && ms >= 0) {
          const agg = rttSum.get(key) ?? { sum: 0, n: 0 };
          agg.sum += ms;
          agg.n += 1;
          rttSum.set(key, agg);
          cur.avgRtt = Math.round(agg.sum / agg.n);
          cur.lastRtt = Math.round(ms);
        }
      }
      if (ts !== undefined && (cur.lastTestAt === undefined || ts > cur.lastTestAt)) cur.lastTestAt = ts;
    } else if (e.action === 'rotate') {
      if (ts !== undefined && (cur.lastRotateAt === undefined || ts > cur.lastRotateAt)) cur.lastRotateAt = ts;
    }
  }
  const out: Record<string, AgentRealStats> = {};
  for (const [key, cur] of byKey) out[display.get(key) ?? key] = cur;
  // /agents 兜底：全部卡片都建条目，UI 可区分「0 样本」而非一直显示加载中
  for (const c of cards) {
    const name = typeof c?.agent_name === 'string' ? c.agent_name.trim() : '';
    if (!name) continue;
    const key = normalizeAgentKey(name);
    if (!display.has(key)) display.set(key, name);
    const disp = display.get(key)!;
    let cur = byKey.get(key);
    if (!cur) {
      cur = { tests: 0, passed: 0 };
      byKey.set(key, cur);
      out[disp] = cur;
    }
    const lt = c.lastTest;
    const ltAt = lt && typeof lt.at === 'number' ? lt.at : undefined;
    const ltMs = lt && typeof lt.durationMs === 'number' && Number.isFinite(lt.durationMs) && lt.durationMs >= 0
      ? Math.round(lt.durationMs) : undefined;
    // 最近拨测时间取审计与卡片中更晚的真实时间（有审计样本时不重复计次数）
    if (ltAt !== undefined && (cur.lastTestAt === undefined || ltAt > cur.lastTestAt)) cur.lastTestAt = ltAt;
    // 旧样本无结论（或完全无样本）→ 用卡片最近一次真实拨测补 1 个样本，成功率不再永久「—」
    if (cur.tests === 0 && lt && ltAt !== undefined) {
      cur.tests = 1;
      cur.passed = lt.ok ? 1 : 0;
    }
    // 审计样本都没带耗时 → 用卡片 lastTest 的真实耗时补延时（不增加次数，不覆盖已有均值）
    if (cur.avgRtt === undefined && cur.lastRtt === undefined && ltMs !== undefined) {
      cur.lastRtt = ltMs;
      cur.avgRtt = ltMs;
    }
    if (cur.lastRotateAt === undefined && typeof c.keyRotatedAt === 'number') cur.lastRotateAt = c.keyRotatedAt;
  }
  return out;
}

/** 「测试接入」真实回执：via=backend（后端确认）/ local（后端不可达，本地校验） */
export interface TestOutcome {
  ok: boolean;
  /** 本地实测往返耗时（ms，含 fetch 全程） */
  rtt: number;
  requestId?: string;
  via: 'backend' | 'local';
  /** 真实拨测失败原因 / 通过证据（UI 如实展示，不谎报连通） */
  reason?: string;
  /** 服务层落定的卡片状态（CONNECTED / DEGRADED …），UI 据此同步状态点 */
  status?: string;
}

export interface BackendMirror {
  svc: AgentOnboardService<AgentOnboardClient | null>;
  test: (name: string) => Promise<TestOutcome>;
  /** 真实轮换：后端不可达/卡片不存在 → ok:false + reason（UI 不得先报成功） */
  rotate: (name: string) => Promise<{ ok: boolean; reason?: string }>;
  save: (a: UiAgentCard) => void;
  discover: (names: Array<{ name: string; priority: string; signal: string }>, form: Form) => void;
  unbind: (name: string) => void;
  /** 重新拉取 /agents + /audit（登录自动接入完成后刷新卡片指标） */
  refresh: () => Promise<void>;
}

/** 后端卡片回执（GET /agents 合并回填用）：circuit/priority/status 为真实状态机输出 */
export interface BackendCardEcho {
  agent_name: string;
  circuit?: string;
  priority?: string;
  status?: string;
  /** 最近一次真实拨测（失败原因如实回填，UI 不回退成「已连通」） */
  lastTest?: { ok: boolean; reason: string; at?: number; durationMs?: number };
}

/**
 * 挂载一个后端镜像。test 返回真实回执（含 RTT）；其余方法 fire-and-forget：
 * 后端不可达时不抛、不阻塞 UI（原型语义优先）。
 * onCards：挂载时后端已有卡片回填回调（合并式：按 agent_name 匹配，仅同步状态字段）。
 * onStats：挂载时后端审计汇总的真实统计回调。
 */
export function useBackendMirror(
  onCards?: (cards: BackendCardEcho[]) => void,
  onStats?: (stats: Record<string, AgentRealStats>) => void,
): BackendMirror {
  const svcRef = useRef<ReturnType<typeof createService> | null>(null);
  if (!svcRef.current) svcRef.current = createService(resolveBackendUrl());
  /** 并发重拉时只认最后一次，避免慢响应把新统计覆盖成旧值 */
  const loadSeq = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const svc = svcRef.current!;
    const seq = ++loadSeq.current;
    let cards: AgentCard[] = [];
    // ① 后端已有卡片 → 合并回填（失败静默，页面仍与原型一致）
    try {
      const got = await Promise.resolve(svc.getCards());
      if (seq !== loadSeq.current) return;
      if (Array.isArray(got)) {
        cards = got;
        if (cards.length > 0 && onCards) {
          onCards(cards.map((c) => ({
            agent_name: String(c.agent_name ?? ''),
            circuit: c.circuit,
            priority: c.priority,
            status: c.status,
            lastTest: c.lastTest,
          })));
        }
      }
    } catch { /* 后端不可达：保持本地卡片 */ }
    // ② 后端审计流 → 每家 Agent 真实统计（连通成功率 / 平均延时 / 最近轮换）
    //    审计不可读时仍用 /agents 的 lastTest（含真实 durationMs）兜底，避免接入后指标一直是「—」
    try {
      const entries = await Promise.resolve(svc.getAudit());
      if (seq !== loadSeq.current) return;
      if (Array.isArray(entries)) {
        onStats?.(computeAgentStats(entries as AuditEntry[], cards));
      }
    } catch {
      if (seq !== loadSeq.current) return;
      if (cards.length > 0) onStats?.(computeAgentStats([], cards));
    }
  }, [onCards, onStats]);

  useEffect(() => { void load(); }, [load]);

  const bg = (fn: (svc: ReturnType<typeof createService>) => unknown) => {
    const svc = svcRef.current!;
    try {
      const r = fn(svc);
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
    } catch {
      /* 后端不可达：忽略，保持原型同步交互 */
    }
  };

  return {
    svc: svcRef.current,
    test: (name) => {
      const t0 = Date.now();
      const finish = (
        ok: boolean, requestId: string | undefined, via: 'backend' | 'local',
        reason?: string, status?: string,
      ): TestOutcome => ({ ok, requestId, via, rtt: Date.now() - t0, reason, status });
      try {
        return Promise.resolve(svcRef.current!.testConnect(name))
          .then((res) => {
            const r = res as TestResult;
            return finish(Boolean(r?.ok), r?.requestId, 'backend', r?.reason, r?.card?.status);
          })
          .catch(() => finish(false, undefined, 'local', '接入后端不可达，本地未验证'));
      } catch {
        return Promise.resolve(finish(false, undefined, 'local', '接入后端不可达，本地未验证'));
      }
    },
    rotate: (name) => {
      try {
        return Promise.resolve(svcRef.current!.rotateKey(name))
          .then((res) => {
            const r = res as { ok?: boolean; reason?: string };
            return { ok: Boolean(r?.ok), reason: r?.reason };
          })
          .catch(() => ({ ok: false, reason: '接入后端不可达，密钥未轮换' }));
      } catch {
        return Promise.resolve({ ok: false, reason: '接入后端不可达，密钥未轮换' });
      }
    },
    save: (a) => bg((s) => s.configure(toServiceInput(a))),
    discover: (agents, f) => bg((s) => s.oneClickOnboard(agents as never, f)),
    unbind: (name) => bg((s) => s.revokeBind(name)),
    refresh: load,
  };
}
