// A29：Agent 接入状态写内核账本 + 页面状态从账本重建。
// 口径（与 src/agentOnboard/service.ts 一致）：
//  · 接入/一键接入 → agent_onboard / auto_bind；测试 → agent_test；轮换 → agent_rotate；吊销 → agent_revoke；撤销绑定 → unbound
//  · 同步范围 = local-only（接入卡片是本机密钥/安装痕迹，不随记忆同步上行/下行）
//  · 防衰减 = 天然豁免（接入卡片不是 Memory 行，不进 gc/遗忘周期，无需 pin）
//  · 租户归属写在 detail（enterprise_id/team_id）；重建时按当前租户过滤，跨租户不串读
//  · 同一 Agent 名（归一化后）只对应一条状态：重复发现/重复接入只更新，不新增
import type { AuditAction, AuditRecord, StorageBackend, Form } from '../../core/memagent/types.ts';
import { ulid } from '../../core/memagent/ulid.ts';
import type { UiAgentCard } from '../../types/agentOnboard.ts';
import { makeCard, specOf } from './cards.ts';

/** 接入状态相关的内核审计动作（页面只从这些动作重建状态） */
export const AGENT_LEDGER_ACTIONS: readonly AuditAction[] = [
  'agent_onboard', 'agent_test', 'agent_rotate', 'agent_revoke', 'auto_bind', 'unbound',
];

const ONBOARD_SYNC_SCOPE = 'local-only';
const ONBOARD_DECAY_EXEMPT = true;

export interface OnboardTenant {
  enterprise_id: string;
  team_id: string;
  user_id?: string;
}

export interface AgentLedgerAgent {
  name: string;
  status?: string;
  priority?: string;
  circuit?: string;
  lastTest?: { ok: boolean; reason: string; at: number; durationMs?: number };
  keyTail?: string;
  keyRevoked?: boolean;
  keyRotatedAt?: number;
  /**
   * 绑定态：true=已接入；false=已撤销绑定（已有卡片回落「未接入」、页面不补卡）；
   * undefined=只在测试/轮换等事件里出现，绑定态未知（不改写现有卡片的接入态）。
   */
  bound?: boolean;
  /** 乐观并发版本（与 service 卡片 rev 同源） */
  rev: number;
  updatedAt: number;
  /** 该 Agent 的账本事件数（重复发现只累加 events，不新增卡） */
  events: number;
}

export interface AgentLedger {
  agents: AgentLedgerAgent[];
  entries: number;
  lastAt?: number;
}

export interface AgentActionInput {
  action: Extract<AuditAction, 'agent_onboard' | 'agent_test' | 'agent_rotate' | 'agent_revoke' | 'auto_bind' | 'unbound'>;
  agent: string;
  tenant: OnboardTenant;
  op?: string;
  result?: string;
  status?: string;
  priority?: string;
  circuit?: string;
  reason?: string;
  durationMs?: number;
  keyTail?: string;
  form?: Form;
  rev?: number;
  requestId?: string;
}

function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function detailOf(rec: AuditRecord): Record<string, unknown> {
  return (rec.detail && typeof rec.detail === 'object' ? rec.detail : {}) as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 写入一条接入动作审计（内核账本；页面状态以它为准） */
export async function recordAgentAction(storage: StorageBackend, input: AgentActionInput): Promise<AuditRecord> {
  const rec: AuditRecord = {
    request_id: input.requestId ?? `req_${ulid()}`,
    action: input.action,
    agent: input.agent,
    form: input.form ?? 'desktop',
    ...(input.tenant.user_id ? { user_id: input.tenant.user_id } : {}),
    ts: Date.now(),
    detail: {
      enterprise_id: input.tenant.enterprise_id,
      team_id: input.tenant.team_id,
      ...(input.op ? { op: input.op } : {}),
      ...(input.result ? { result: input.result } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.circuit ? { circuit: input.circuit } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.keyTail ? { keyTail: input.keyTail } : {}),
      ...(input.rev !== undefined ? { rev: input.rev } : {}),
      // 审计页资源维度：接入动作挂在 agent 资源上（不冒充 memory 行）
      resource_type: 'agent',
      resource_id: input.agent,
      sync_scope: ONBOARD_SYNC_SCOPE,
      decay_exempt: ONBOARD_DECAY_EXEMPT,
    },
  };
  await storage.appendAudit(rec);
  return rec;
}

/** 该记录是否属于当前租户（缺租户字段的旧记录不串读） */
function belongsTo(rec: AuditRecord, tenant: OnboardTenant): boolean {
  const d = detailOf(rec);
  const ent = str(d.enterprise_id);
  const team = str(d.team_id);
  return ent === tenant.enterprise_id && team === tenant.team_id;
}

/**
 * 账本 → 页面状态（纯函数）。
 * 同一 Agent 只保留一条；按 ts 顺序回放，后写覆盖前写（并发版本只增不减）。
 */
export function rebuildAgentLedger(records: AuditRecord[], tenant?: OnboardTenant): AgentLedger {
  const list = records
    .filter((r) => AGENT_LEDGER_ACTIONS.includes(r.action))
    .filter((r) => (tenant ? belongsTo(r, tenant) : true))
    .slice()
    .sort((a, b) => a.ts - b.ts);
  const byKey = new Map<string, AgentLedgerAgent>();

  for (const rec of list) {
    const d = detailOf(rec);
    // 并发/版本冲突被拒绝的写入不改变状态
    if (str(d.result) === 'rejected') continue;
    const name = String(rec.agent ?? d.agent ?? '').trim();
    if (!name) continue;
    const key = normName(name);
    const prev = byKey.get(key);
    const rev = num(d.rev) ?? ((prev?.rev ?? 0) + 1);
    const base: AgentLedgerAgent = prev ?? {
      name, rev: 0, updatedAt: rec.ts, events: 0,
    };
    base.events += 1;
    base.updatedAt = Math.max(base.updatedAt, rec.ts);
    base.rev = Math.max(base.rev, rev);

    if (rec.action === 'agent_onboard' || rec.action === 'auto_bind') {
      base.bound = true;
      base.status = str(d.status) ?? base.status;
      if (str(d.priority)) base.priority = str(d.priority);
      if (str(d.circuit)) base.circuit = str(d.circuit);
      if (rec.action === 'auto_bind') {
        const ok = str(d.result) === 'pass';
        base.lastTest = {
          ok,
          reason: str(d.reason) ?? '',
          at: rec.ts,
          ...(num(d.durationMs) !== undefined ? { durationMs: num(d.durationMs) } : {}),
        };
      }
    } else if (rec.action === 'agent_test') {
      base.lastTest = {
        ok: str(d.result) === 'pass',
        reason: str(d.reason) ?? '',
        at: rec.ts,
        ...(num(d.durationMs) !== undefined ? { durationMs: num(d.durationMs) } : {}),
      };
      if (str(d.status)) base.status = str(d.status);
    } else if (rec.action === 'agent_rotate') {
      if (str(d.keyTail)) base.keyTail = str(d.keyTail);
      base.keyRevoked = false;
      base.keyRotatedAt = rec.ts;
    } else if (rec.action === 'agent_revoke') {
      base.keyRevoked = true;
      if (str(d.status)) base.status = str(d.status);
    } else if (rec.action === 'unbound') {
      base.bound = false;
    }
    byKey.set(key, base);
  }

  return {
    agents: [...byKey.values()],
    entries: list.length,
    ...(list.length > 0 ? { lastAt: list[list.length - 1].ts } : {}),
  };
}

/** 从内核账本读取并重建（租户隔离：只回放当前租户的接入事件） */
export async function loadAgentLedger(storage: StorageBackend, tenant: OnboardTenant): Promise<AgentLedger> {
  const audits = await storage.queryAudit({});
  return rebuildAgentLedger(audits, tenant);
}

function uiStateOf(status?: string): UiAgentCard['state'] {
  switch (status) {
    case 'CONNECTED': return 'connected';
    case 'DEGRADED': return 'degraded';
    case 'CONFIGURED':
    case 'ONBOARD': return 'onboard';
    default: return 'onboard';
  }
}

/**
 * 账本状态 → 页面卡片（纯函数）。
 *  · 已存在卡片：只覆盖连通态/熔断/密钥尾号/版本，不动用户配置；
 *  · 账本有、页面无（本地缓存被清）：按真实规格补一张；
 *  · 已撤销绑定（bound=false）：不补卡，已有卡片回落「未接入」。
 */
export function mergeLedgerIntoCards(cards: UiAgentCard[], ledger: AgentLedger): UiAgentCard[] {
  if (ledger.agents.length === 0) return cards;
  const out = [...cards];
  for (const a of ledger.agents) {
    const key = normName(a.name);
    const idx = out.findIndex((c) => normName(c.name) === key);
    if (idx >= 0) {
      const prev = out[idx];
      out[idx] = {
        ...prev,
        ...(a.status ? { state: uiStateOf(a.status) } : {}),
        ...(a.circuit ? { circuit: a.circuit as UiAgentCard['circuit'] } : {}),
        ...(a.keyTail ? { key: { ...prev.key, last: a.keyTail, ...(a.keyRevoked ? { rotated: true } : {}) } } : {}),
        ...(a.keyTail && a.keyRevoked ? { state: 'onboard' as const } : {}),
        ...(a.rev ? { rev: a.rev } : {}),
      };
      if (a.bound === false) out[idx] = { ...out[idx], state: 'onboard' };
    } else if (a.bound !== false) {
      const card = makeCard(a.name, specOf(a.name), a.status ? uiStateOf(a.status) : 'onboard');
      out.push({
        ...card,
        ...(a.circuit ? { circuit: a.circuit as UiAgentCard['circuit'] } : {}),
        ...(a.keyTail ? { key: { ...card.key, last: a.keyTail } } : {}),
        ...(a.rev ? { rev: a.rev } : {}),
      });
    }
  }
  return out;
}
