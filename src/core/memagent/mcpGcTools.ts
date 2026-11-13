// MCP 遗忘引擎报告编排（批次44-D5-3 → 批次46-4）：gc_report。
// TCP(8202) 与 HTTP(8204) 共用同一份参数校验、作用域校验与报告口径，避免两端漂移。
//
// 红线（批次46 / D3 / D6 / D8）：
// ① D6 分层报告：保留 GcReport 既有三项（不删、不改名），再补齐 runForgettingCycle 的
//    六项真实字段与如实命名的 scanned；全部取自 ma.gcFull() 的真实事件计数，
//    不改名冒充、不补 0 伪装统计，口径差异写进 note 明确告知。
// ② MCP 入口不注入 VectorBackend、也不开 weeklyCompress → compressed 在本入口诚实为 0，
//    note 明说「只清向量索引副本、不动磁盘正文」，不拿冷层行数顶替成绩。
// ③ dry_run 缺省 true（MCP 入口默认只演算）：不改记忆、不写审计；
//    只有显式 dry_run=false 才落库。内核 API ma.gc() 未传 dry_run 仍保持原行为；
//    本工具走 ma.gcFull() 这条并列入口，勿同时调用以免双计。
// ④ resolve_conflicts 不是自动覆盖开关：必须与合法 verdict 同时给才处理已排队裁决；
//    只给其一明确拒绝、绝不静默忽略、绝不默认 auto_override。
//    conflicts_resolved 只数本周期经 coreResolveConflict() 真实落定的冲突对。
// ⑤ project_id 显式必填且必须落在令牌作用域内，不猜项目、不越界演算。
import { CONFLICT_VERDICTS } from './conflict.ts';
import {
  GC_CONCURRENCY_NOTE, readAgentUsage, type AgentUsageRead,
} from './agentUsage.ts';
import { projectInScope, type McpAccount } from './mcpAuth.ts';
import { McpToolError } from './mcpRecall.ts';
import type { ConflictVerdict, MemAgent, StorageBackend } from './types.ts';

export const GC_REPORT_NOTE =
  '批次46-4（D6 分层）：衰减段保留 decayed/merged/conflicts_resolved 三项既有字段；'
  + '摘要合并段给出 runForgettingCycle 的 freshness_updated/scanned/migrated/summaries_created/'
  + 'summaries_filtered/merged_originals/compressed 真实字段（均有真实事件源，未改名冒充、未补 0 伪装统计）；'
  + 'freshness_updated 实为「本轮扫描条数」而非新鲜度更新条数，scanned 为同值如实命名；'
  + 'decayed 是 migrated 的兼容别名、同一事件只出一个数，merged 为历史占位恒 0 并由 summaries_created 取代；'
  + 'MCP 入口未注入向量后端且不开每周压缩，compressed 在本入口诚实为 0（压缩只清向量索引副本、不动磁盘正文）；'
  + '冲突裁决段：conflicts_resolved 只数本周期真实落定的冲突对，'
  + '须 resolve_conflicts=true 与合法 verdict 同时给才落定，禁止自动 auto_override，未落定 / dry_run 诚实 0；'
  + 'dry_run 缺省 true 按账本快照演算、全程零写入零审计（audit_written=false），显式 false 才落库；'
  + '本工具走 ma.gcFull()，与 ma.gc() 是两条独立路径，勿同时执行以免双计；'
  + '批次61 GAP-3 新增 agent_usage：按 detail.client 聚合 recall 次数 / 省量 / 证据不足与 mcp_call 次数 / 首调合规，'
  + 'verdict 分布只能到项目级（memory_op 审计无 client 字段，不可按 Agent 拆分）；该段只读审计、不写不演算。';

export interface GcReportToolResult {
  ok: true;
  dry_run: boolean;
  project_id: string;
  /** D6：既有三项 + 六项真实字段 + scanned；字段顺序与内核 GcFullReport 对齐 */
  report: {
    decayed: number;
    merged: number;
    conflicts_resolved: number;
    freshness_updated: number;
    scanned: number;
    migrated: number;
    summaries_created: number;
    summaries_filtered: number;
    merged_originals: number;
    compressed: number;
  };
  /** 46-4：本次裁决如实回执（requested / verdict / resolved 三者互不冒充） */
  conflict_resolution: {
    requested: boolean;
    verdict: ConflictVerdict | null;
    /** 只数真实落定；dry_run / user_confirm / hold 诚实 0 */
    resolved: number;
  };
  request_id: string;
  /** dry_run=true 恒 false：演算未落审计，不伪造审计回执 */
  audit_written: boolean;
  /**
   * 批次61 GAP-3：Agent 侧使用画像（只读审计聚合）。
   * 读不到时 ok:false 带原因 —— 报告照出，绝不拿空数组冒充「没有 Agent 在用」。
   */
  agent_usage: AgentUsageRead;
  /** C5：gc 与桌面 cron decay 的互斥提示（不是统计量） */
  concurrency_note: string;
  /** 分层口径说明（D6），不是统计量 */
  note: string;
}

export interface GcReportDeps {
  /** 审计存储（读 Agent 侧聚合用）；缺省时 agent_usage 如实回 ok:false */
  storage?: StorageBackend;
  /** 注入时钟便于固定样本断言；缺省 Date.now() */
  now?: number;
  /** Agent 侧统计窗口（天），缺省 7 */
  windowDays?: number;
}

export async function runGcReportTool(
  ma: MemAgent,
  args: Record<string, unknown>,
  account: McpAccount,
  deps: GcReportDeps = {},
): Promise<GcReportToolResult> {
  const pid = args.project_id;
  if (typeof pid !== 'string' || !pid.trim()) {
    throw new McpToolError('gc_report.project_id 必填且须为非空字符串（不猜项目）');
  }
  const projectId = pid.trim();
  if (!projectInScope(account, projectId)) {
    throw new McpToolError(`当前 MCP 令牌作用域不含项目 ${projectId}（三池可见性校验，D6-2）`);
  }

  // ── 46-4 裁决参数校验（D3/D8：全部前置，绝不「先落库再报错」）──
  const rc = args.resolve_conflicts;
  if (rc !== undefined && typeof rc !== 'boolean') {
    throw new McpToolError('gc_report.resolve_conflicts 须为布尔值（不静默忽略高风险参数）');
  }
  const requested = rc === true;
  const rawVerdict = args.verdict;
  if (!requested && rawVerdict !== undefined) {
    throw new McpToolError(
      'gc_report.verdict 必须配合 resolve_conflicts=true 才有效（不静默忽略高风险参数）',
    );
  }
  let verdict: ConflictVerdict | null = null;
  if (requested) {
    if (rawVerdict === undefined) {
      throw new McpToolError(
        'gc_report.resolve_conflicts=true 必须同时显式给出 verdict（禁止自动 auto_override）',
      );
    }
    if (typeof rawVerdict !== 'string' || !CONFLICT_VERDICTS.includes(rawVerdict as ConflictVerdict)) {
      throw new McpToolError(
        `gc_report.verdict 非法：须为 ${CONFLICT_VERDICTS.join('/')}（禁止默认 auto_override）`,
      );
    }
    verdict = rawVerdict as ConflictVerdict;
  }

  const dryRun = args.dry_run === undefined ? true : args.dry_run;
  if (typeof dryRun !== 'boolean') {
    throw new McpToolError('gc_report.dry_run 须为布尔值（缺省 true = 只演算不落库）');
  }

  // 走 ma.gcFull()：一次 runForgettingCycle 同时产出衰减/摘要/压缩真值 + 可选真实裁决。
  // 不注入 VectorBackend / weeklyCompress → compressed 诚实 0（见 GC_REPORT_NOTE）。
  const r = await ma.gcFull({
    project_id: projectId,
    dry_run: dryRun,
    ...(requested ? { resolve_conflicts: true, verdict: verdict as ConflictVerdict } : {}),
  });

  // GAP-3：只读聚合，放在 gcFull 之后 —— 聚合失败不影响报告主体（与「读审计不阻断净化」同一口径）
  const agentUsage: AgentUsageRead = deps.storage
    ? await readAgentUsage(deps.storage, deps.now ?? Date.now(), deps.windowDays ?? 7)
    : { ok: false, error: '未注入审计存储：本入口无法读取 Agent 侧聚合' };

  return {
    ok: true,
    dry_run: dryRun,
    project_id: projectId,
    report: {
      decayed: r.decayed,
      merged: r.merged,
      conflicts_resolved: r.conflicts_resolved,
      freshness_updated: r.freshness_updated,
      scanned: r.scanned,
      migrated: r.migrated,
      summaries_created: r.summaries_created,
      summaries_filtered: r.summaries_filtered,
      merged_originals: r.merged_originals,
      compressed: r.compressed,
    },
    conflict_resolution: {
      requested,
      verdict,
      // 只数内核真实落定，不按入参猜：dry_run / user_confirm / hold 均为 0
      resolved: r.conflicts_resolved,
    },
    request_id: r.request_id,
    // 以内核真实回执判断，而不是按入参猜：dry_run 时 gcFull 回 audit=null
    audit_written: r.audit !== null,
    agent_usage: agentUsage,
    concurrency_note: GC_CONCURRENCY_NOTE,
    note: GC_REPORT_NOTE,
  };
}
