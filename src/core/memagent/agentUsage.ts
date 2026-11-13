// 批次61 GAP-3：Agent 侧 × 桌面侧双向可观测。
//
// 断点（2026-11-12 审查 §4.1 实证）：
//  · 信号**已采集未消费**：`agent.ts:298` 写 `detail.client`、`:304–307` 写省量、
//    `mcpHttp.ts:373–436` 写 `mcp_call`（记录级 `agent` 字段 + 首调合规标记）——
//    但 `gc_report` 没有 client 维度，生长页也从不读这些。
//  · `gc` 与桌面 cron decay 各自独立调度（`main.ts`），执行记录不互通 → 双计风险无提示。
//
// 本模块只做**只读聚合**：不写任何审计、不改任何记忆。数字全部来自审计逐条计数，
// 不估算、不补零；某个维度没有数据就如实为 0 并由页面显示「暂无数据」。
//
// 诚实边界（不得美化）：
//  · `memory_op` 审计**没有 client 字段** → verdict 分布只能到项目级，不能拆到 Agent；
//    因此 `verdicts_attributable` 恒为 false，页面必须照此标注，不得把这些数摊到 Agent 头上。
//  · 缺 `client` 的 recall 审计归入「未标识」，绝不猜成某个 Agent（AC C3）。
import type { AuditRecord, StorageBackend } from './types.ts';

const DAY = 24 * 3600_000;

/** 缺 client 的审计归入此桶；不是真实 Agent 名，页面需按「未标识」样式展示 */
export const CLIENT_UNKNOWN = '未标识';

export const AGENT_USAGE_NOTE =
  '口径：全部来自审计逐条计数（recall / mcp_call / memory_op），非实时、不含本轮未落审计的调用；'
  + 'recalls / saved_tokens / evidence_thin 取自 recall 审计的 detail（client 为当时上报值，缺失归「未标识」）；'
  + 'calls / 首调合规取自 mcp_call 审计（记录级 agent 字段；首调合规率分母只算带 Mcp-Session-Id 的可靠会话）；'
  + 'verdict 分布取自 memory_op 审计，该审计无 client 字段，故只能到项目级、不可按 Agent 拆分；'
  + '本聚合只读，不写审计、不改记忆。';

export interface AgentUsageRow {
  client: string;
  /** recall_memory 被该 Agent 调用的次数 */
  recalls: number;
  /** 该 Agent 名下累计省下的 token（recall 审计 saved_tokens 求和） */
  saved_tokens: number;
  /** 证据不足次数（evidence_thin=true） */
  evidence_thin: number;
  /** MCP 工具调用次数（mcp_call 审计） */
  calls: number;
  /** 首调即 recall_memory 的会话数（仅可靠会话计入） */
  first_call_recall: number;
  /** 带 Mcp-Session-Id 的可靠会话首调总数（合规率分母） */
  reliable_first_calls: number;
}

export interface AgentUsageSummary {
  window_days: number;
  agents: AgentUsageRow[];
  totals: {
    recalls: number;
    saved_tokens: number;
    evidence_thin: number;
    calls: number;
    first_call_recall: number;
    reliable_first_calls: number;
    /** 首调合规率；分母为 0 时为 null（不是 0——「没数据」和「全不合规」不是一回事） */
    first_call_compliance: number | null;
  };
  /** 项目级 verdict 分布（memory_op 审计无 client，不可拆分） */
  verdicts: { confirm: number; reject: number; disputed: number };
  /** 恒 false：如实声明 verdict 不可按 Agent 归因 */
  verdicts_attributable: false;
  source: 'audit';
  note: string;
}

function emptyRow(client: string): AgentUsageRow {
  return {
    client, recalls: 0, saved_tokens: 0, evidence_thin: 0, calls: 0,
    first_call_recall: 0, reliable_first_calls: 0,
  };
}

/**
 * 审计 → Agent 维度画像。
 * 只统计窗口内的记录；没有 client 的 recall 归「未标识」；`mcp_call` 的 agent 在记录级而非 detail。
 */
export function summarizeAgentUsage(
  audits: AuditRecord[], now: number, windowDays = 7,
): AgentUsageSummary {
  const since = now - windowDays * DAY;
  const rows = new Map<string, AgentUsageRow>();
  const row = (client: string): AgentUsageRow => {
    const k = client || CLIENT_UNKNOWN;
    let r = rows.get(k);
    if (!r) { r = emptyRow(k); rows.set(k, r); }
    return r;
  };
  const verdicts = { confirm: 0, reject: 0, disputed: 0 };

  for (const a of audits) {
    if (a.ts < since || a.ts > now) continue;
    if (a.action === 'recall') {
      const d = a.detail as { client?: unknown; saved_tokens?: unknown; evidence_thin?: unknown } | undefined;
      const r = row(typeof d?.client === 'string' ? d.client : '');
      r.recalls += 1;
      if (typeof d?.saved_tokens === 'number' && Number.isFinite(d.saved_tokens)) r.saved_tokens += d.saved_tokens;
      if (d?.evidence_thin === true) r.evidence_thin += 1;
      continue;
    }
    if (a.action === 'mcp_call') {
      const r = row(typeof a.agent === 'string' ? a.agent : '');
      r.calls += 1;
      const d = a.detail as { reliable?: unknown; first_call?: unknown; recalled_before?: unknown } | undefined;
      // 分母只算可靠会话（带 Mcp-Session-Id）；UA 兜底会话不可靠，进分母会把合规率稀释成假象
      if (d?.reliable === true && d?.first_call === true) {
        r.reliable_first_calls += 1;
        if (d?.recalled_before === true) r.first_call_recall += 1;
      }
      continue;
    }
    if (a.action !== 'memory_op') continue;
    const op = (a.detail as { op?: unknown } | undefined)?.op;
    if (op === 'confirm' || op === 'reject' || op === 'disputed') verdicts[op] += 1;
  }

  const agents = [...rows.values()].sort(
    (x, y) => y.recalls - x.recalls || y.calls - x.calls || x.client.localeCompare(y.client),
  );
  const sum = (pick: (r: AgentUsageRow) => number): number => agents.reduce((acc, r) => acc + pick(r), 0);
  const reliable = sum((r) => r.reliable_first_calls);
  const firstOk = sum((r) => r.first_call_recall);
  return {
    window_days: windowDays,
    agents,
    totals: {
      recalls: sum((r) => r.recalls),
      saved_tokens: sum((r) => r.saved_tokens),
      evidence_thin: sum((r) => r.evidence_thin),
      calls: sum((r) => r.calls),
      first_call_recall: firstOk,
      reliable_first_calls: reliable,
      first_call_compliance: reliable > 0 ? Math.round((firstOk / reliable) * 1000) / 1000 : null,
    },
    verdicts,
    verdicts_attributable: false,
    source: 'audit',
    note: AGENT_USAGE_NOTE,
  };
}

export type AgentUsageRead =
  | { ok: true; usage: AgentUsageSummary }
  | { ok: false; error: string };

/** 读审计失败不阻断调用方（gc_report 仍要出报告）：ok:false 带原因，绝不拿空数组冒充「无使用」 */
export async function readAgentUsage(
  storage: StorageBackend, now: number, windowDays = 7,
): Promise<AgentUsageRead> {
  try {
    const audits = await storage.queryAudit({});
    return { ok: true, usage: summarizeAgentUsage(audits, now, windowDays) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * C5：`gc` 与桌面 cron decay 的互斥提示。
 * 事实来源：`main.ts` 里 decay 任务（daily 02:00）与 MCP gc_report 各自独立调度，
 * 同一批行会被两边各算一次 migrated —— 这不是 bug，但报告里必须说清楚，否则用户会对不上数。
 */
export const GC_CONCURRENCY_NOTE =
  '互斥提示：本报告走 MCP 入口（ma.gcFull），桌面端 cron decay 每日 02:00 独立调度（main.ts）；'
  + '两者对同一批记忆各算一次 migrated/summaries_created，同窗口内先后执行会双计。'
  + '需要与页面数字对齐时，请只保留一个入口或错开执行时间。';
