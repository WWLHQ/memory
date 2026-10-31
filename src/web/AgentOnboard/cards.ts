// 接入卡片构造与恢复：只由「真实接入过」的 agent 名单生成卡片，无任何演示卡片。
//  - 卡片静态字段（badge/label/method）来自规格映射；
//  - 运行指标（连通率/延迟/失败次数）账本无采样时为 0，UI 呈现「未测速」，不伪造百分比；
//  - 名单来源：agentOnboardState（一键接入结果）+ agentOnboardDetectedAgents（手动新增）。
import type { BadgeClass, DiscoveredAgent, UiAgentCard } from '../../types/agentOnboard.ts';
import { getTenant } from '../kernel.ts';
import { listDetectedAgents } from './store.ts';
import { readOnboardState } from './onboardState.ts';

export interface AgentSpec {
  badge: BadgeClass;
  label: string;
  method: string;
}

/** 已知 agent 的接入规格（19.2 自有 P0 / 19.3 样板 P1 / 兜底 P2） */
export const AGENT_SPECS: Record<string, AgentSpec> = {
  'deepseek harness': { badge: 'p0', label: 'MVP·P0', method: 'MCP + Webhook 直连（自有）' },
  'workbuddy': { badge: 'p0', label: '自有·P0', method: 'MCP + Webhook 直连（自有）' },
  'claude code': { badge: 'p1', label: 'MVP·P1', method: 'MCP 工具 + 会话日志兜底（第三方样板）' },
  'codex': { badge: 'p2', label: '兜底·P2', method: 'MCP（若支持）+ API 拉取兜底' },
  'cursor': { badge: 'p3', label: '扩展·P3', method: 'MCP 注册表 + 本机进程' },
};

export function specOf(name: string): AgentSpec {
  return AGENT_SPECS[name.trim().toLowerCase()] ?? { badge: 'p3', label: '扩展·P3', method: 'MCP 工具接入' };
}

/**
 * 按真实规格构造一张接入卡片（指标未采样 = 0，不伪造）。
 * state 缺省 'onboard'：只有真实拨测/宿主真扫命中才允许标「已连通」。
 */
export function makeCard(name: string, spec: AgentSpec = specOf(name), state: UiAgentCard['state'] = 'onboard'): UiAgentCard {
  const t = getTenant();
  return {
    name,
    badge: spec.badge,
    label: spec.label,
    method: spec.method,
    conn: 0,
    circuit: 'CLOSED',
    latency: 0,
    fail: 0,
    recover: 0,
    tenant: `${t.enterprise_id} / ${t.team_id}`,
    tools: {
      recall: { on: true, topk: 5, scene: 'default', mode: '' },
      write: { on: true },
      pref: { on: true },
    },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' },
    key: { mask: `[API_KEY:${name.toLowerCase().replace(/\s+/g, '-')}]`, last: '未记录', grace: 24 },
    state,
  };
}

/** 恢复已接入卡片：持久化名单 ∪ 本机检测快照（有快照用快照，否则按规格重建） */
export function restoreCards(): UiAgentCard[] {
  const names: string[] = [];
  const snapshots = new Map<string, UiAgentCard>();
  for (const s of listDetectedAgents()) {
    if (!s?.name) continue;
    names.push(s.name);
    if (s.card) snapshots.set(s.name, s.card);
  }
  const state = readOnboardState();
  for (const n of state?.agentNames ?? []) {
    if (typeof n === 'string' && n.trim()) names.push(n);
  }
  const out: UiAgentCard[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(snapshots.get(name) ?? makeCard(name));
  }
  return out;
}

/** 已绑定的发现行（来自持久化接入状态，供「一键接入」段回显） */
export function restoreDiscovered(): DiscoveredAgent[] {
  const state = readOnboardState();
  if (!state) return [];
  // 批次16：优先恢复登录/手动接入时的真实发现行（保留信号与来源）
  if (Array.isArray(state.discovered) && state.discovered.length > 0) {
    return state.discovered.filter((d) => d && typeof d.name === 'string' && d.name.trim());
  }
  return state.agentNames
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => {
      const spec = specOf(n);
      return {
        name: n,
        badge: spec.badge,
        label: spec.label,
        signal: state.source === 'host' ? '宿主真扫' : '内核 discover（非本机）',
        bound: true,
        ok: true,
        source: state.source,
      };
    });
}
