// 存量「补齐缺失的 sha256 与向量」（批次41-T）：批次41-B 之后新写的每一行都带这两个字段，
// 但字段是随提交 `843282c`（2026-10-31）才引入的——那之前写入的历史行行上就是空的。
// 本机实测（2026-11-04 12:40 UTC+08:00，只读真实账本）：1532 活行里 **533 行缺 sha256、1 行缺 embedding**，
// 且 533 行全是 layer=L1、refined_by=stub、创建时刻集中在 2026-10-30（UTC）。
// 缺这两个字段的代价是有边界的、可查证的：
//   · 缺 embedding → 语义召回恒 0 分（agent.ts 按行上 m.embedding 打分），这行召不回来；
//   · 缺 sha256 → §5.4 幂等指纹为空，云端同步的每日全量对账会把它列进 missing（sync.ts），
//     也就是说这 533 行是**批次42 里 sync 尚未接入内核 API 的前置事实**。
// 与 rejudge / ledgerReset / rebuild 的分工：那几个会删行或重造正文，**本模块只填两个空字段**——
//   正文、层级、version、updated_at、质量门戳、L0 一概不动；填不出就跳过并如实计数，绝不猜。
// 设计原则（与同目录其它改写模块一致）：
//   · 纯函数、只做数据改写；备份、IPC 门禁、向量索引注入都在主进程做（本模块可单测）。
//   · 改写账本前先备份是项目不变量 → 强制 backup_confirmed，缺失即抛错拒绝。
//   · 审计成对：每补一行一条 memory_op（op='field_backfill'，只记填了哪个字段与长度），
//     整轮一条 security_change（op='field_backfill'，计数 + 原因码分布 + 样本 id）；正文与 L1 不进账本。
//   · 幂等：第二次跑 fillable=0，一行都不写盘。
import type { Filter, Memory, StorageBackend, VectorBackend } from './types.ts';
import { embedSync, DEFAULT_VECTOR_DIM } from './vector.ts';
import { sha256hex } from './sync.ts';
import { buildSourceExcerpt } from './memories.ts';

/** 一行能不能补、补哪两个字段（预览与执行共用同一判定，绝不让两边口径分家） */
export interface BackfillDecision {
  mem_id: string;
  layer: string;
  /** 行上 sha256 为空 */
  need_sha256: boolean;
  /** 行上 embedding 为空 */
  need_embedding: boolean;
  /** 缺 sha256 且能从行上 content 算出来 */
  fill_sha256: boolean;
  /** 缺 embedding 且能从 content_l1 算出来 */
  fill_embedding: boolean;
  /** 行上 source_excerpt 为空 */
  need_source_excerpt: boolean;
  /** 缺 source_excerpt 且能从 content_l1 明文派生（L0 密文永不参与，绝不猜） */
  fill_source_excerpt: boolean;
  /** pinned 或 locked：本模块照样补（填字段不删不改内容），但回执里单列，用户看得见 */
  protected: boolean;
  /** 该行已有 sha256 时它的指纹来源是否就是行上 content（只作观测，不参与判定） */
  sha_matches_content: boolean | null;
  /** 缺且算不出的原因码（能补的那一半不受影响）；无缺口时为空数组 */
  codes: BackfillSkipCode[];
  reason?: string;
}

export type BackfillSkipCode =
  | 'complete'      // 三个字段都齐，本轮不写盘
  | 'no_content'    // 缺 sha256 但行上没有可算指纹的正文
  | 'no_l1'         // 缺 embedding / source_excerpt 但没有 content_l1（两者都只源自 L1 明文，不从别的层凑）
  | 'no_excerpt'    // 缺 source_excerpt 但 content_l1 脱敏后为空（不写空串、不伪造保真）
  | 'tombstone';    // 已删除行

export interface BackfillPreview {
  /** 扫描行数（含墓碑，与账本总行数一致） */
  total: number;
  tombstones: number;
  /** 行上 sha256 为空的行数（含算不出的那部分，见 unfillable_sha256） */
  missing_sha256: number;
  /** 行上 embedding 为空的行数（含算不出的那部分，见 unfillable_embedding） */
  missing_embedding: number;
  /** 行上 source_excerpt 为空的行数（仅当 fields 含 source_excerpt 时统计，否则恒 0） */
  missing_source_excerpt: number;
  /** 本轮会写盘的行数（启用字段任一能补即算一行） */
  fillable_rows: number;
  /** 会写盘的行里 pinned/locked 的条数 */
  protected_rows: number;
  /** 缺 sha256 且算不出（行上无正文）：不猜，原样留着 */
  unfillable_sha256: number;
  /** 缺 embedding 且算不出（无 L1）：不猜，原样留着 */
  unfillable_embedding: number;
  /** 缺 source_excerpt 且算不出（无 L1 或脱敏后为空）：不猜，原样留着 */
  unfillable_source_excerpt: number;
  /** 启用字段都齐、本轮不动的行数 */
  already_complete: number;
  /** 本轮会写盘的行按原 layer 分布，如 { L1: 533 } */
  by_layer: Record<string, number>;
  /** 审计与 UI 只留样本，绝不把上千个 id 塞进账本 */
  sample: BackfillDecision[];
}

const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

function dimOf(vector: { readonly dim?: number } | undefined): number {
  return vector?.dim ?? DEFAULT_VECTOR_DIM;
}

/** 可回填的字段集合。默认只补历史两字段（sha256/embedding），保证既有调用行为逐字不变；
 *  source_excerpt 为 opt-in——只有显式列入 fields 才判定/写盘（REQ-014 C6-B 存量回填）。 */
export type BackfillField = 'sha256' | 'embedding' | 'source_excerpt';
export const DEFAULT_BACKFILL_FIELDS: readonly BackfillField[] = ['sha256', 'embedding'];

/** 校验外部传入的 fields（IPC 边界）：非法/空 → 回落默认两字段，非法值被忽略不猜。
 *  返回 null 表示入参非空但全是非法值（调用方据此如实报错，不静默改写）。 */
export function parseBackfillFields(input: unknown): readonly BackfillField[] | null {
  if (input === undefined || input === null) return DEFAULT_BACKFILL_FIELDS;
  if (!Array.isArray(input)) return null;
  const valid: BackfillField[] = [];
  for (const v of input) {
    if (v === 'sha256' || v === 'embedding' || v === 'source_excerpt') {
      if (!valid.includes(v)) valid.push(v);
    }
  }
  return valid.length > 0 ? valid : null;
}

function decide(m: Memory, fields: readonly BackfillField[]): BackfillDecision {
  const wantSha = fields.includes('sha256');
  const wantEmb = fields.includes('embedding');
  const wantExcerpt = fields.includes('source_excerpt');
  const needSha = wantSha && !m.sha256;
  const needEmb = wantEmb && (!m.embedding || m.embedding.length === 0);
  const needExcerpt = wantExcerpt && !m.source_excerpt;
  const canSha = needSha && hasText(m.content);
  const canEmb = needEmb && hasText(m.content_l1);
  // 摘录只从 content_l1 明文派生（buildSourceExcerpt 内部走 sanitizeL1）；L0 密文永不参与。
  const excerpt = needExcerpt && hasText(m.content_l1) ? buildSourceExcerpt(m.content_l1!) : undefined;
  const canExcerpt = needExcerpt && Boolean(excerpt);
  const codes: BackfillSkipCode[] = [];
  if (m.deleted) codes.push('tombstone');
  else if (!needSha && !needEmb && !needExcerpt) codes.push('complete');
  else {
    if (needSha && !canSha) codes.push('no_content');
    if (needEmb && !canEmb) codes.push('no_l1');
    if (needExcerpt && !canExcerpt) codes.push(hasText(m.content_l1) ? 'no_excerpt' : 'no_l1');
  }
  const reasons: string[] = [];
  if (codes.includes('no_content')) reasons.push('缺 sha256 且行上没有可算指纹的正文——不猜，原样留着');
  if (codes.includes('no_l1')) reasons.push('缺 embedding / source_excerpt 但没有 content_l1（只源自 L1 明文）——不猜，原样留着');
  if (codes.includes('no_excerpt')) reasons.push('缺 source_excerpt 但 content_l1 脱敏后为空——不写空串、不伪造保真');
  return {
    mem_id: m.mem_id,
    layer: m.layer,
    need_sha256: needSha,
    need_embedding: needEmb,
    need_source_excerpt: needExcerpt,
    fill_sha256: canSha,
    fill_embedding: canEmb,
    fill_source_excerpt: canExcerpt,
    protected: Boolean(m.pinned || m.locked),
    sha_matches_content: m.sha256 ? m.sha256 === sha256hex(m.content ?? '') : null,
    codes,
    reason: reasons.length ? reasons.join('；') : undefined,
  };
}

function summarize(list: Memory[], fields: readonly BackfillField[]): BackfillPreview {
  const out: BackfillPreview = {
    total: list.length, tombstones: 0, missing_sha256: 0, missing_embedding: 0, missing_source_excerpt: 0,
    fillable_rows: 0, protected_rows: 0, unfillable_sha256: 0, unfillable_embedding: 0, unfillable_source_excerpt: 0,
    already_complete: 0, by_layer: {}, sample: [],
  };
  for (const m of list) {
    const d = decide(m, fields);
    if (d.codes.includes('tombstone')) { out.tombstones++; continue; }
    if (d.codes.includes('complete')) { out.already_complete++; continue; }
    // 缺口按「字段是否为空」计（含算不出的），可补与否单独计——UI 要能诚实说「缺 533，其中 N 行补不了」
    if (d.need_sha256) { out.missing_sha256++; if (!d.fill_sha256) out.unfillable_sha256++; }
    if (d.need_embedding) { out.missing_embedding++; if (!d.fill_embedding) out.unfillable_embedding++; }
    if (d.need_source_excerpt) { out.missing_source_excerpt++; if (!d.fill_source_excerpt) out.unfillable_source_excerpt++; }
    if (!d.fill_sha256 && !d.fill_embedding && !d.fill_source_excerpt) continue;
    out.fillable_rows++;
    if (d.protected) out.protected_rows++;
    out.by_layer[m.layer] = (out.by_layer[m.layer] ?? 0) + 1;
    if (out.sample.length < 20) out.sample.push(d);
  }
  return out;
}

/** 只读预览：这一轮会补多少、哪些算不出（供确认卡展示，绝不改数据）。
 *  fields 缺省 = 历史两字段，既有调用行为逐字不变；要补 source_excerpt 须显式传入。 */
export async function scanRowsForBackfill(storage: StorageBackend, filter: Filter = {}, fields: readonly BackfillField[] = DEFAULT_BACKFILL_FIELDS): Promise<BackfillPreview> {
  return summarize(await storage.listMemories({ ...filter, include_deleted: true }), fields);
}

export interface BackfillReport extends BackfillPreview {
  /** 实际写入 sha256 的行数 */
  sha256_filled: number;
  /** 实际写入 embedding 的行数 */
  embedding_filled: number;
  /** 实际写入 source_excerpt 的行数（未启用该字段时恒 0） */
  source_excerpt_filled: number;
  /** 新建向量后进了索引的行数（没注入 vector 后端时恒为 0，不假装建过索引） */
  indexed: number;
  /** 写盘失败的行数（单行失败不中止整轮） */
  failed: number;
  failed_ids: string[];
}

export interface BackfillCtx {
  storage: StorageBackend;
  /** 进程内向量索引（可选）：只在新建了 embedding 的行上 upsert，与写入路径同 layer 口径 */
  vector?: VectorBackend;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成备份并确认。缺失 → 抛错拒绝（批量改写账本前先备份是项目不变量）。 */
  backup_confirmed: true;
  filter?: Filter;
  /** 本轮要补的字段；缺省 = 历史两字段（守恒）。补 source_excerpt 须显式列入。 */
  fields?: readonly BackfillField[];
}

/**
 * 执行回填：逐行判定 → 缺什么补什么 → 每行一条审计，最后一条汇总审计。
 * 正文 / 层级 / version / updated_at / 质量门戳 / L0 一律不动，所以二次运行必然 fillable=0。
 */
export async function backfillMissingFields(ctx: BackfillCtx): Promise<BackfillReport> {
  const { storage, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('存量字段回填需要管理员身份（admin_user_id 为空）');
  if (ctx.backup_confirmed !== true) {
    throw new Error('存量字段回填前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const list = await storage.listMemories({ ...ctx.filter, include_deleted: true });
  const fields = ctx.fields ?? DEFAULT_BACKFILL_FIELDS;
  const preview = summarize(list, fields);
  const dim = dimOf(ctx.vector);
  const report: BackfillReport = {
    ...preview, sha256_filled: 0, embedding_filled: 0, source_excerpt_filled: 0, indexed: 0, failed: 0, failed_ids: [],
  };

  storage.beginBatch?.();
  try {
    for (const m of list) {
      const d = decide(m, fields);
      if (!d.fill_sha256 && !d.fill_embedding && !d.fill_source_excerpt) continue;
      const next: Memory = { ...m };
      const filled: string[] = [];
      if (d.fill_sha256) {
        next.sha256 = sha256hex(m.content);
        filled.push('sha256');
      }
      if (d.fill_embedding) {
        next.embedding = embedSync(m.content_l1!, dim);
        filled.push('embedding');
      }
      if (d.fill_source_excerpt) {
        // 复用写入侧同一个 buildSourceExcerpt（sanitizeL1 脱敏 + ≤200 字），口径不另立；
        // decide 已判过非空，这里再取一次必然有值（不为 ts 断言伪造）。
        const excerpt = buildSourceExcerpt(m.content_l1!);
        if (excerpt) { next.source_excerpt = excerpt; filled.push('source_excerpt'); }
      }
      try {
        await storage.putMemory(next);
        if (d.fill_sha256) report.sha256_filled++;
        if (d.fill_source_excerpt && filled.includes('source_excerpt')) report.source_excerpt_filled++;
        if (d.fill_embedding) {
          report.embedding_filled++;
          if (ctx.vector) {
            await ctx.vector.upsert(m.mem_id, m.content_l1!, { project_id: m.project_id, layer: m.layer });
            report.indexed++;
          }
        }
        await storage.appendAudit({
          request_id, action: 'memory_op', user_id: admin_user_id, ts: now,
          project_id: m.project_id,
          detail: {
            op: 'field_backfill', mem_id: m.mem_id, layer: m.layer, filled,
            protected: d.protected, skip_codes: d.codes,
            // 只记长度与字段名，正文与 L1 一个字都不进账本
            content_chars: (m.content ?? '').length,
            l1_chars: (m.content_l1 ?? '').length,
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
      op: 'field_backfill',
      total: report.total,
      tombstones: report.tombstones,
      fillable_rows: report.fillable_rows,
      sha256_filled: report.sha256_filled,
      embedding_filled: report.embedding_filled,
      source_excerpt_filled: report.source_excerpt_filled,
      indexed: report.indexed,
      protected_rows: report.protected_rows,
      unfillable_sha256: report.unfillable_sha256,
      unfillable_embedding: report.unfillable_embedding,
      unfillable_source_excerpt: report.unfillable_source_excerpt,
      already_complete: report.already_complete,
      fields: [...fields],
      failed: report.failed,
      by_layer: report.by_layer,
      sample_ids: report.sample.map((s) => s.mem_id),
      vector_injected: Boolean(ctx.vector),
    },
  });
  return report;
}
