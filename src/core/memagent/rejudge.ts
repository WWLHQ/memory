// 存量「按当前规则重判」（批次36-C）：规则收紧后，已落库的行不会自己变干净——本模块把
// 生产质量门（qualityGate.checkL0ToL1Quality）重新跑一遍存量，拦下的行删除、放行的行重盖版本戳。
// 与 ledgerReset.ts（整库清空重采）的分工：
//   · ledgerReset = 全删 + 游标归零 + 重新采集（需要 L0 写密钥才能重新入库，动静大）；
//   · rejudge     = 只删「按当前口径本来就不该进库」的行，保留的行的 L1–L6 正文一字不改，
//     不解密、不调 LLM、不动采集游标——判定规则更新后的常规收尾动作。
// 设计原则（与 ledgerReset 同口径）：
//   · 纯函数、只做数据改写；备份、IPC 门禁、口令都在主进程做（本模块可单测）。
//   · 不可逆：唯一退路是调用方执行前落的备份 → 强制 backup_confirmed，缺失即抛错拒绝。
//   · 判定只喂 content_l1（缺失才退回 content）：L0 是密文，重判不参与、也不要求解锁写密钥。
//   · pinned / locked 受保护：命中也不删，只计数回显——用户钉住的行由用户自己处置。
//   · 审计成对：每删一行一条 memory_op（op='rejudge_purge'，含拦截码），整轮一条 security_change
//     （op='rules_rejudge'，计数 + 码分布 + 样本 id），单行失败不中止整轮并如实计数。
import type { Filter, Memory, StorageBackend, VectorBackend } from './types.ts';
import { checkL0ToL1Quality, QUALITY_GATE_VERSION, type QualityBlockCode } from './qualityGate.ts';

/** 一行重判的结论（预览与执行共用同一判定，绝不让预览口径和执行口径分家） */
export interface RejudgeDecision {
  mem_id: string;
  layer: string;
  /** purge = 按当前规则应删；keep = 放行（可能重盖版本戳）；skip = 不判定并说明原因 */
  action: 'purge' | 'keep' | 'skip';
  code?: QualityBlockCode | 'no_l1' | 'unspecified';
  reason?: string;
  /** 该行入库时盖的版本戳（历史行无字段 → 1，绝不猜最新） */
  row_gate_v: number;
  /** pinned 或 locked：受保护，执行时不删 */
  protected: boolean;
}

export interface RejudgePreview {
  /** 本轮实际生效的质量门版本 */
  gate_version: number;
  /** 扫描行数（含墓碑，与账本总行数一致） */
  total: number;
  /** 墓碑行：已删除，不重判 */
  tombstones: number;
  /** 缺 L1 正文（content_l1 与 content 都为空）：交给「遗留账本清理」，本模块不猜也不删 */
  missing_l1: number;
  /** 判定为应删（含受保护那部分） */
  purge: number;
  /** 应删里被 pinned/locked 保护、执行时会跳过的行数 */
  purge_protected: number;
  /**
   * 批次41-O：真正会被删（purge 且非受保护）的行里，带 L0 密文原文的条数。
   * 删行同步销毁 L0 信封（不可逆），预览与回执都上报它——「连带销毁 N 条 L0 原文」。
   */
  with_l0_cipher: number;
  /** 放行且需要重盖版本戳的行数 */
  keep_restamp: number;
  /** 放行且版本戳已是最新：执行时不写盘 */
  keep_unchanged: number;
  /** 按拦截码分布，如 { narration: 36, thin: 17 } */
  by_code: Record<string, number>;
  /** 应删行按原 layer 分布 */
  by_layer: Record<string, number>;
  /** 账本行按已有版本戳分布，如 { v1: 1642 } */
  by_row_gate_version: Record<string, number>;
  /** 审计与 UI 只留样本，绝不把上千个 id 塞进账本 */
  sample: RejudgeDecision[];
}

/** 取重判要喂给质量门的文本：只认 L1（§2.2 不变量 7：检索/查重也以 L1 为准） */
function judgeableText(m: Memory): string {
  const l1 = typeof m.content_l1 === 'string' ? m.content_l1.trim() : '';
  if (l1) return l1;
  return typeof m.content === 'string' ? m.content.trim() : '';
}

/** 批次41-O：这行是否带 L0 原文（与 ledgerReset.ts 同一判据：行上明文 / 已拆的 L0 库 / has_l0 标记） */
function hasL0Source(m: Memory): boolean {
  const txt = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
  return txt(m.content_orig) || txt(m.content_l0_enc) || Boolean(m.has_l0);
}

function decide(m: Memory): RejudgeDecision {
  const base: RejudgeDecision = {
    mem_id: m.mem_id, layer: m.layer, action: 'keep',
    row_gate_v: m.quality_gate_v ?? 1,
    protected: Boolean(m.pinned || m.locked),
  };
  const text = judgeableText(m);
  if (!text) return { ...base, action: 'skip', code: 'no_l1', reason: '缺 L1 正文，未判定' };
  const r = checkL0ToL1Quality(text);
  if (r.ok) return { ...base, action: 'keep' };
  return { ...base, action: 'purge', code: r.code ?? 'unspecified', reason: r.reason ?? '' };
}

function summarize(list: Memory[]): RejudgePreview {
  const out: RejudgePreview = {
    gate_version: QUALITY_GATE_VERSION,
    total: list.length, tombstones: 0, missing_l1: 0,
    purge: 0, purge_protected: 0, with_l0_cipher: 0, keep_restamp: 0, keep_unchanged: 0,
    by_code: {}, by_layer: {}, by_row_gate_version: {}, sample: [],
  };
  for (const m of list) {
    if (m.deleted) { out.tombstones++; continue; }
    const v = m.quality_gate_v ?? 1;
    out.by_row_gate_version[`v${v}`] = (out.by_row_gate_version[`v${v}`] ?? 0) + 1;
    const d = decide(m);
    if (d.action === 'skip') { out.missing_l1++; continue; }
    if (d.action === 'purge') {
      out.purge++;
      out.by_code[d.code ?? 'unspecified'] = (out.by_code[d.code ?? 'unspecified'] ?? 0) + 1;
      out.by_layer[m.layer] = (out.by_layer[m.layer] ?? 0) + 1;
      if (d.protected) out.purge_protected++;
      else if (hasL0Source(m)) out.with_l0_cipher++;
    } else if (v !== QUALITY_GATE_VERSION) out.keep_restamp++;
    else out.keep_unchanged++;
    if (out.sample.length < 20) out.sample.push(d);
  }
  return out;
}

/** 只读预览：按当前规则这一轮会删多少、码怎么分布（供二次确认卡展示，绝不改数据） */
export async function scanRowsForRejudge(storage: StorageBackend, filter: Filter = {}): Promise<RejudgePreview> {
  return summarize(await storage.listMemories({ ...filter, include_deleted: true }));
}

export interface RejudgeReport extends RejudgePreview {
  /** 实际删除行数 */
  purged: number;
  /** 实际重盖版本戳的行数 */
  restamped: number;
  /** 受保护跳过的行数（pinned/locked） */
  skipped_protected: number;
  /** 缺 L1 跳过的行数 */
  skipped_no_l1: number;
  /** 删除/改写失败的行数（单行失败不中断整轮） */
  failed: number;
  failed_ids: string[];
}

export interface RejudgeCtx {
  storage: StorageBackend;
  /** 进程内向量索引（可选）：删行时同步摘除，避免召回到已删内容 */
  vector?: VectorBackend;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成备份并确认。缺失 → 抛错拒绝（删除不可逆，备份是唯一退路）。 */
  backup_confirmed: true;
  filter?: Filter;
}

/**
 * 执行重判：逐行判定 → 应删的删除（+ 向量摘除 + 每行审计）、放行的按需重盖版本戳，
 * 最后一条汇总审计。只读预览与实际执行走同一个 decide()，回执数字与预览必然一致。
 */
export async function rejudgeRows(ctx: RejudgeCtx): Promise<RejudgeReport> {
  const { storage, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('存量重判需要管理员身份（admin_user_id 为空）');
  if (ctx.backup_confirmed !== true) {
    throw new Error('存量重判前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const list = await storage.listMemories({ ...ctx.filter, include_deleted: true });
  const preview = summarize(list);
  const report: RejudgeReport = {
    ...preview, purged: 0, restamped: 0, skipped_protected: 0,
    skipped_no_l1: preview.missing_l1, failed: 0, failed_ids: [],
  };

  storage.beginBatch?.();
  try {
    for (const m of list) {
      if (m.deleted) continue;
      const d = decide(m);
      try {
        if (d.action === 'skip') continue;
        if (d.action === 'purge') {
          if (d.protected) { report.skipped_protected++; continue; }
          await storage.deleteMemory(m.mem_id);
          if (ctx.vector) await ctx.vector.remove(m.mem_id);
          report.purged++;
          await storage.appendAudit({
            request_id, action: 'memory_op', user_id: admin_user_id, ts: now,
            project_id: m.project_id,
            detail: {
              op: 'rejudge_purge', mem_id: m.mem_id, layer: m.layer,
              filter_code: d.code, reason: d.reason,
              row_gate_v: d.row_gate_v, gate_version: QUALITY_GATE_VERSION,
            },
          });
        } else if (d.row_gate_v !== QUALITY_GATE_VERSION) {
          // 重盖版本戳是元数据改写：正文、层级、向量、version 都不动
          await storage.putMemory({ ...m, quality_gate_v: QUALITY_GATE_VERSION });
          report.restamped++;
        }
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
      op: 'rules_rejudge',
      gate_version: QUALITY_GATE_VERSION,
      total: report.total,
      purge: report.purge,
      purged: report.purged,
      restamped: report.restamped,
      skipped_protected: report.skipped_protected,
      skipped_no_l1: report.skipped_no_l1,
      with_l0_cipher: report.with_l0_cipher,
      failed: report.failed,
      by_code: report.by_code,
      by_layer: report.by_layer,
      by_row_gate_version: report.by_row_gate_version,
      sample_ids: report.sample.map((s) => s.mem_id),
    },
  });
  return report;
}
