// 批次45-A2 存量账本租户归一：把历史行的 team_id/enterprise_id 重盖成 tenant.json 规范值（user_id 保留原值）。
// 背景（批次45-A1 之后仍遗留的事实）：45-A1 收敛了**新写入**的三元组真源，但存量账本里还压着
// 「页面现造 u_<ulid>/team_local/ent_local」时代的混住行——按 team/enterprise 硬过滤（45-A3 前置）
// 之前必须把它们归一，否则同一台账本按团队过滤会漏召回 / 误隔离。
// 与 rejudge / ledgerReset / rebuild 的分工：那几个会删行或重造正文，**本模块只重盖两个归属字段**——
//   正文、层级、version、updated_at、user_id、质量门戳、L0 一概不动；幂等（已归一零写盘）。
// 设计原则（与 fieldBackfill 等同目录改写模块一致）：
//   · 纯函数、只做数据改写；备份、IPC/bootstrap 门禁都在主进程做（本模块可单测）。
//   · 改写账本前先备份是项目不变量 → 强制 backup_confirmed，缺失即抛错拒绝。
//   · 审计成对：每改一行一条 memory_op（op='tenant_normalize'，只记改了哪个字段与新旧值），
//     整轮一条 security_change（op='tenant_normalize'，计数 + 分布 + 样本 id）。
//   · 幂等：第二次跑 mismatched=0，一行都不写盘。
import type { Memory, StorageBackend } from './types.ts';

/** 归一目标（来自主进程 tenant.json 真源；user_id 不在目标里——本模块绝不改 user_id） */
export interface TenantNormalizeTarget {
  team_id: string;
  enterprise_id: string;
}

export interface TenantNormalizeDecision {
  mem_id: string;
  project_id: string;
  /** 行上旧值（如 'team_local'/'ent_local' 或缺失） */
  old_team_id: string;
  old_enterprise_id: string;
  /** 归一后写入的规范值 */
  new_team_id: string;
  new_enterprise_id: string;
  /** 该行已有规范值，本轮不写盘 */
  already_canonical: boolean;
  /** 已删除行：不归一（保留原样，诚实计数） */
  tombstone: boolean;
  /** pinned 或 locked：照样归一（只改归属字段不碰内容），但回执里单列 */
  protected: boolean;
  reason?: string;
}

export interface TenantNormalizePreview {
  /** 扫描行数（含墓碑，与账本总行数一致） */
  total: number;
  tombstones: number;
  /** 归一目标的行数（本轮会写盘的行数；幂等第二次跑恒为 0） */
  mismatched: number;
  /** 会写盘的行里 pinned/locked 的条数 */
  protected_rows: number;
  /** 只差 team_id / 只差 enterprise_id / 两者都差的行数 */
  by_field: { team_id_only: number; enterprise_id_only: number; both: number };
  /** 会写盘的行按旧 user_id 分布（user_id 保留不动，只作观测） */
  by_user: Record<string, number>;
  /** 审计与 UI 只留样本，绝不把上千个 id 塞进账本 */
  sample: TenantNormalizeDecision[];
}

function decide(m: Memory, target: TenantNormalizeTarget): TenantNormalizeDecision {
  const oldTeam = m.team_id ?? '';
  const oldEnt = m.enterprise_id ?? '';
  const teamDiff = oldTeam !== target.team_id;
  const entDiff = oldEnt !== target.enterprise_id;
  const reasons: string[] = [];
  if (teamDiff) reasons.push(`team_id ${oldTeam || '（缺失）'} → ${target.team_id}`);
  if (entDiff) reasons.push(`enterprise_id ${oldEnt || '（缺失）'} → ${target.enterprise_id}`);
  return {
    mem_id: m.mem_id,
    project_id: m.project_id,
    old_team_id: oldTeam,
    old_enterprise_id: oldEnt,
    new_team_id: target.team_id,
    new_enterprise_id: target.enterprise_id,
    already_canonical: !teamDiff && !entDiff,
    tombstone: Boolean(m.deleted),
    protected: Boolean(m.pinned || m.locked),
    reason: reasons.length ? reasons.join('；') : undefined,
  };
}

function summarize(list: Memory[], target: TenantNormalizeTarget): TenantNormalizePreview {
  const out: TenantNormalizePreview = {
    total: list.length, tombstones: 0, mismatched: 0, protected_rows: 0,
    by_field: { team_id_only: 0, enterprise_id_only: 0, both: 0 }, by_user: {}, sample: [],
  };
  for (const m of list) {
    const d = decide(m, target);
    if (d.tombstone) { out.tombstones++; continue; }
    if (d.already_canonical) continue;
    out.mismatched++;
    if (d.protected) out.protected_rows++;
    const teamDiff = d.old_team_id !== target.team_id;
    const entDiff = d.old_enterprise_id !== target.enterprise_id;
    if (teamDiff && entDiff) out.by_field.both++;
    else if (teamDiff) out.by_field.team_id_only++;
    else out.by_field.enterprise_id_only++;
    const u = m.user_id || '（缺失）';
    out.by_user[u] = (out.by_user[u] ?? 0) + 1;
    if (out.sample.length < 20) out.sample.push(d);
  }
  return out;
}

/** 只读预览：这一轮会归一多少行、各差哪个字段（绝不改数据） */
export async function scanRowsForTenantNormalize(storage: StorageBackend, target: TenantNormalizeTarget): Promise<TenantNormalizePreview> {
  return summarize(await storage.listMemories({ include_deleted: true }), target);
}

export interface TenantNormalizeReport extends TenantNormalizePreview {
  /** 实际写入的行数 */
  normalized: number;
  /** 写盘失败的行数（单行失败不中止整轮） */
  failed: number;
  failed_ids: string[];
}

export interface TenantNormalizeCtx {
  storage: StorageBackend;
  target: TenantNormalizeTarget;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成备份并确认。缺失 → 抛错拒绝（批量改写账本前先备份是项目不变量）。 */
  backup_confirmed: true;
}

/**
 * 执行归一：逐行判定 → team_id/enterprise_id 重盖为规范值（user_id 与其余字段原样保留）→
 * 每行一条审计，最后一条汇总审计。已规范行零写盘，所以二次运行必然 mismatched=0。
 */
export async function normalizeTenantFields(ctx: TenantNormalizeCtx): Promise<TenantNormalizeReport> {
  const { storage, target, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('存量租户归一需要管理员身份（admin_user_id 为空）');
  if (!target.team_id || !target.enterprise_id) {
    throw new Error('归一目标缺失（target.team_id/enterprise_id 为空）——拒绝把账本归一到空值');
  }
  if (ctx.backup_confirmed !== true) {
    throw new Error('存量租户归一前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const list = await storage.listMemories({ include_deleted: true });
  const preview = summarize(list, target);
  const report: TenantNormalizeReport = { ...preview, normalized: 0, failed: 0, failed_ids: [] };

  storage.beginBatch?.();
  try {
    for (const m of list) {
      const d = decide(m, target);
      if (d.tombstone || d.already_canonical) continue;
      const next: Memory = { ...m, team_id: target.team_id, enterprise_id: target.enterprise_id };
      try {
        await storage.putMemory(next);
        report.normalized++;
        await storage.appendAudit({
          request_id, action: 'memory_op', user_id: admin_user_id, ts: now,
          project_id: m.project_id,
          detail: {
            op: 'tenant_normalize', mem_id: m.mem_id, layer: m.layer,
            // 只记归属字段的新旧值（字符串，非正文），user_id 原样保留不动
            old_team_id: d.old_team_id, new_team_id: d.new_team_id,
            old_enterprise_id: d.old_enterprise_id, new_enterprise_id: d.new_enterprise_id,
            user_id_kept: m.user_id ?? null, protected: d.protected,
          },
        });
      } catch {
        report.failed++;
        if (report.failed_ids.length < 20) report.failed_ids.push(m.mem_id);
      }
    }
  } finally {
    storage.commitBatch?.();
  }

  await storage.appendAudit({
    request_id, action: 'security_change', user_id: admin_user_id, ts: now,
    detail: {
      op: 'tenant_normalize',
      target: { team_id: target.team_id, enterprise_id: target.enterprise_id },
      total: report.total, tombstones: report.tombstones, mismatched: report.mismatched,
      normalized: report.normalized, failed: report.failed,
      protected_rows: report.protected_rows, by_field: report.by_field, by_user: report.by_user,
      sample_ids: report.sample.map((s) => s.mem_id),
    },
  });
  return report;
}
