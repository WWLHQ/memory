// MCP 遗忘引擎报告编排（批次44-D5-3）：gc_report。
// TCP(8202) 与 HTTP(8204) 共用同一份参数校验、作用域校验与报告口径，避免两端漂移。
//
// 红线（决策③「诚实原则」）：
// ① 只回内核真实统计字段 decayed / merged / conflicts_resolved；
//    目标契约 §7 示例的 freshness_updated / migrated / summaries_created /
//    summaries_filtered / merged_originals / compressed 在本系统没有对应统计量，
//    不改名冒充、也不补 0 假装统计过，差异写进 note 明确告知。
// ② dry_run 缺省 true（MCP 入口默认只演算）：不改记忆、不写审计；
//    只有显式 dry_run=false 才落库。内核 API ma.gc() 未传 dry_run 仍保持原行为。
// ③ 内核未实现冲突裁决（conflicts_resolved 恒 0），故不暴露 resolve_conflicts；
//    客户端若传该参数则明确拒绝，绝不静默忽略。
// ④ project_id 显式必填且必须落在令牌作用域内，不猜项目、不越界演算。
import { projectInScope } from './mcpAuth.ts';
import { McpToolError } from './mcpRecall.ts';
import type { MemAgent } from './types.ts';

export const GC_REPORT_NOTE =
  '本项目内核仅统计 decayed / merged / conflicts_resolved 三项；'
  + '契约示例中的 freshness_updated / migrated / summaries_created / summaries_filtered / '
  + 'merged_originals / compressed 在本系统没有对应统计量，未改名冒充、未补 0 伪装统计。';

export interface GcReportToolResult {
  ok: true;
  dry_run: boolean;
  project_id: string;
  /** 内核真实字段，不含任何伪造的摘要/合并统计 */
  report: {
    decayed: number;
    merged: number;
    conflicts_resolved: number;
  };
  request_id: string;
  /** dry_run=true 恒 false：演算未落审计，不伪造审计回执 */
  audit_written: boolean;
  /** 与目标契约字段差异的如实说明 */
  note: string;
}

export async function runGcReportTool(
  ma: MemAgent,
  args: Record<string, unknown>,
  scope?: string[],
): Promise<GcReportToolResult> {
  const pid = args.project_id;
  if (typeof pid !== 'string' || !pid.trim()) {
    throw new McpToolError('gc_report.project_id 必填且须为非空字符串（不猜项目）');
  }
  const projectId = pid.trim();
  if (!projectInScope(scope, projectId)) {
    throw new McpToolError(`当前 MCP 令牌作用域不含项目 ${projectId}（scope 校验）`);
  }
  if (args.resolve_conflicts !== undefined) {
    throw new McpToolError(
      'gc_report.resolve_conflicts 不受支持：内核 coreGc 未实现冲突裁决（conflicts_resolved 恒 0），不静默忽略该参数',
    );
  }
  const dryRun = args.dry_run === undefined ? true : args.dry_run;
  if (typeof dryRun !== 'boolean') {
    throw new McpToolError('gc_report.dry_run 须为布尔值（缺省 true = 只演算不落库）');
  }

  const r = await ma.gc({ project_id: projectId, dry_run: dryRun });
  return {
    ok: true,
    dry_run: dryRun,
    project_id: projectId,
    report: {
      decayed: r.decayed,
      merged: r.merged,
      conflicts_resolved: r.conflicts_resolved,
    },
    request_id: r.request_id,
    // 以内核真实回执判断，而不是按入参猜：dry_run 时 coreGc 回 audit=null
    audit_written: r.audit !== null,
    note: GC_REPORT_NOTE,
  };
}
