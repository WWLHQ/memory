// 记忆库清空重采（批次35）：按新入库口径「彻底重来」的纯函数层。
// 背景：用户拍板「现在库内内容全部删除、重新按入库规则拉取」——旧库里已经灌进的助手自述/
// 过程旁白等噪声，光靠收紧质量门救不回来（它们早已落库），只能整库清空后重采。
// 设计原则（与 legacyLayers.ts 同口径）：
//   · 纯函数、只做数据改写；备份、游标重置、IPC 门禁都在主进程做（本模块可单测）。
//   · 不可逆：唯一的退路是调用方在执行前落的备份——因此 ctx 强制要求 backup_confirmed，
//     没带就等于没备份，直接抛错拒绝（绝不「顺手清一下」）。
//   · 审计留痕：清了多少、按层/来源怎么分布、样本 id，落 security_change/op='ledger_purge'。
//   · 墓碑也清：预览与删除都走 include_deleted，避免重采后残留不可见行把 id 占住。
import type { Filter, Memory, StorageBackend, VectorBackend } from './types.ts';

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 清空前只读预览：库里到底有什么（供二次确认卡展示，绝不改数据） */
export interface LedgerResetPreview {
  /** 将被删除的行数（含墓碑行） */
  total: number;
  /** 按主层级分布，如 { L1: 1641, L2: 1 } */
  by_layer: Record<string, number>;
  /** 按写入来源分布（created_by_agent；无名归 '<未知>'） */
  by_source: Record<string, number>;
  /** 其中带 L0 原始数据的行数：删掉后原文只能从备份恢复（批次37：信封可能在行上，也可能已拆进 L0 原数据库） */
  with_l0_cipher: number;
  /** 其中带真实 LLM 精炼产物（refined_by=llm/llm_partial）的行数：删了不会再自动生成 */
  llm_refined: number;
  /** 墓碑行数（deleted=true） */
  tombstones: number;
  /** 审计只留样本，绝不全量 id 进账本 */
  sample_ids: string[];
}

function summarize(list: Memory[]): LedgerResetPreview {
  const out: LedgerResetPreview = {
    total: list.length, by_layer: {}, by_source: {}, with_l0_cipher: 0,
    llm_refined: 0, tombstones: 0, sample_ids: [],
  };
  for (const m of list) {
    out.by_layer[m.layer] = (out.by_layer[m.layer] ?? 0) + 1;
    const src = (m.created_by_agent ?? '').trim() || '<未知>';
    out.by_source[src] = (out.by_source[src] ?? 0) + 1;
    if (hasText(m.content_orig) || hasText(m.content_l0_enc) || m.has_l0) out.with_l0_cipher++;
    if (m.refined_by === 'llm' || m.refined_by === 'llm_partial') out.llm_refined++;
    if (m.deleted) out.tombstones++;
    if (out.sample_ids.length < 20) out.sample_ids.push(m.mem_id);
  }
  return out;
}

export async function scanLedgerForReset(storage: StorageBackend, filter: Filter = {}): Promise<LedgerResetPreview> {
  return summarize(await storage.listMemories({ ...filter, include_deleted: true }));
}

export interface LedgerPurgeReport extends LedgerResetPreview {
  /** 实际删除行数 */
  purged: number;
  /** 删除失败行数（单行失败不中断整库清空，如实计数并回显样本） */
  failed: number;
  failed_ids: string[];
}

export interface LedgerPurgeCtx {
  storage: StorageBackend;
  /** 进程内向量索引（可选）：删行时同步摘除，避免召回到已删内容 */
  vector?: VectorBackend;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成备份并确认。缺失 → 抛错拒绝（清空不可逆，备份是唯一退路）。 */
  backup_confirmed: true;
  filter?: Filter;
}

/**
 * 整库清空：逐行 deleteMemory（+ 向量摘除），一批只落盘一次，最后写审计。
 * 只删记忆行，不动采集游标——游标重置由调用方（主进程）负责，两者分开才能
 * 在「清空成功但游标重置失败」时如实回显，而不是把状态搅成一团。
 */
export async function purgeLedger(ctx: LedgerPurgeCtx): Promise<LedgerPurgeReport> {
  const { storage, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('清空记忆库需要管理员身份（admin_user_id 为空）');
  if (ctx.backup_confirmed !== true) {
    throw new Error('清空记忆库前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const filter = ctx.filter ?? {};
  const list = await storage.listMemories({ ...filter, include_deleted: true });
  const base = summarize(list);
  const report: LedgerPurgeReport = { ...base, purged: 0, failed: 0, failed_ids: [] };

  storage.beginBatch?.();
  try {
    for (const m of list) {
      try {
        await storage.deleteMemory(m.mem_id);
        if (ctx.vector) await ctx.vector.remove(m.mem_id);
        report.purged++;
      } catch {
        report.failed++;
        if (report.failed_ids.length < 20) report.failed_ids.push(m.mem_id);
      }
    }
  } finally {
    storage.commitBatch?.();
  }

  await storage.appendAudit({
    request_id,
    action: 'security_change',
    user_id: admin_user_id,
    ts: now,
    detail: {
      op: 'ledger_purge',
      total: report.total,
      purged: report.purged,
      failed: report.failed,
      with_l0_cipher: report.with_l0_cipher,
      llm_refined: report.llm_refined,
      tombstones: report.tombstones,
      by_layer: report.by_layer,
      by_source: report.by_source,
      sample_ids: report.sample_ids,
    },
  });
  return report;
}
