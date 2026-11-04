// 按 L0 重建 L1–L6（批次37-E）：用户口径「删的只是 L1–L6 那一份库，不用重新采集，直接从 L0 重新生成」。
// 本模块把记忆库里每一行按其 **L0 原文**重走一遍写入管道的第 1 步与第 3 步：
//   L0 原文 →（生产质量门）→ 新 L1 →（有真实 LLM 才）逐层 L2…L6（每层过 checkLayerSpec）
//   → 重算 sha256 / 语义向量（embedSync(新 L1)）/ layer_specs / layers_generated_at / quality_gate_v。
// 与相邻模块的分工（不要混用）：
//   · rejudge（批次36-C）= 只喂行上已有的 content_l1 重判，不读 L0、不调 LLM、正文一字不改；
//   · ledgerReset（批次35）= 整库清空 + 游标归零 + 重新采集（要 L0 写密钥，动静最大）；
//   · l0Split（批次37-C）= 只搬 L0 原文的位置，一行都不删；
//   · 本模块 = **不重新采集**地用已有 L0 把可检索层重炼一遍：规则/提示词升级后正文跟着变，
//     按当前质量门本来就不该进库的行删掉（这批是 rejudge 判不出来的——它只看旧 L1，此处看的是原文）。
// 设计原则（与 rejudge / l0Split 同口径）：
//   · 纯函数、只改数据；备份、IPC 门禁、口令、L0 查阅会话都留在主进程（本模块可单测）。
//   · 不可逆：旧 L1–L6 正文会被覆盖，唯一退路是执行前的双库备份 → 强制 backup_confirmed，缺失即抛错拒绝。
//   · 读不到原文的行**一律不碰**（无明文、断链、未解锁查阅、信封解不开）：重建不是「顺手清理」，
//     没有证据就删等于凭空丢数据。
//   · pinned / locked 一律不碰（既不删也不改写）：用户钉住的行由用户自己处置。
//   · L0 原文只进判定、绝不进审计/日志/回执；每行审计只记来源字段、产出层名与计数。
//   · 审计成对：每改/删一行一条 memory_op（op='l0_rebuild_row' / 'rebuild_purge'），
//     整轮一条 security_change（op='layers_rebuild'）；单行失败不中断整轮并如实计数。
import type { Filter, LlmProvider, Memory, StorageBackend, VectorBackend } from './types.ts';
import { checkL0ToL1Quality, QUALITY_GATE_VERSION, type QualityBlockCode } from './qualityGate.ts';
import {
  LAYER_ORDER, checkLayerSpecDetailed, headlineLayer, isFullyRefined, layerSpecOf, meaningfulLength,
  targetLayers, type RefineLayer,
} from './layerRules.ts';
import { DEFAULT_VECTOR_DIM, embedSync } from './vector.ts';
import { sha256hex } from './sync.ts';
import type { L0BlobStore } from './l0Store.ts';
import { buildL6Input, layerSpecsFrom, makeLayerGenerator } from './memories.ts';

/** 原文取不到时的原因码（预览与执行共用，绝不在执行时改口径） */
export type RebuildUnavailableCode =
  /** 行上没有明文、也没有 has_l0 / 信封 —— 无从重建 */
  | 'no_source'
  /** 行说有 L0（has_l0 或残留信封），L0 原数据库里取不到 —— 断链 */
  | 'broken_link'
  /** 原文是密文，但本次没有可用的 L0 查阅会话来解密 */
  | 'view_locked'
  /** 信封存在但解不出正文（口令不对 / v1 遗留 / 内容损坏） */
  | 'bad_envelope';

/** 一行 L0 原文的读取结果：`from` 说明正文从哪来，重建后的行不改动 L0 的位置 */
export type RebuildSource =
  | { ok: true; from: 'row_plaintext' | 'l0_store'; text: string }
  | { ok: false; code: RebuildUnavailableCode; reason: string };

export type L0Reader = (m: Memory) => Promise<RebuildSource>;

export interface L0ReaderOptions {
  /** L0 原数据库（批次37-A 的独立文件）；只读取信封，绝不写 */
  l0Blobs?: Pick<L0BlobStore, 'get'>;
  /**
   * 信封 → 原文（主进程 = 用管理员的 L0 查阅会话调 `L0Vault.decrypt`）。
   * 不传 = 密文一律判 `view_locked`：本模块不猜正文，也绝不绕过查阅门禁。
   */
  decrypt?: (m: Memory, envelope: string) => Promise<string>;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 默认读取器：行上明文优先，其次行上残留信封，最后按 has_l0 去 L0 原数据库取。
 * 「明文优先」是真实历史形态（批次37-C 之前原文一直躺在行上），不是给重建开后门——
 * 解不开的密文照样判失败，绝不返回空串冒充原文。
 */
export function makeL0Reader(opts: L0ReaderOptions): L0Reader {
  return async (m: Memory): Promise<RebuildSource> => {
    const orig = text(m.content_orig).trim();
    if (orig) return { ok: true, from: 'row_plaintext', text: orig };
    const envelope = text(m.content_l0_enc).trim()
      || (m.has_l0 ? text((await opts.l0Blobs?.get(m.mem_id))?.envelope) : '');
    if (!envelope) {
      return {
        ok: false,
        code: m.has_l0 ? 'broken_link' : 'no_source',
        reason: m.has_l0
          ? '行上记着 has_l0，但 L0 原数据库取不到信封（断链，需从备份恢复）'
          : '该行没有 L0 原文（既无明文，也没有 has_l0）',
      };
    }
    if (!opts.decrypt) {
      return { ok: false, code: 'view_locked', reason: 'L0 是密文：本次没有可用的查阅会话来解密' };
    }
    try {
      const plain = text(await opts.decrypt(m, envelope)).trim();
      if (!plain) return { ok: false, code: 'bad_envelope', reason: '信封解出空正文' };
      return { ok: true, from: m.has_l0 && !text(m.content_l0_enc) ? 'l0_store' : 'row_plaintext', text: plain };
    } catch (e) {
      return {
        ok: false, code: 'bad_envelope',
        reason: `信封解密失败：${String((e as Error)?.message ?? e).slice(0, 120)}`,
      };
    }
  };
}

/** 一行本轮怎么处理（预览与执行共用同一个 decide，两边数字必然一致） */
export interface RebuildDecision {
  mem_id: string;
  layer: string;
  category: string;
  /** rebuild = 按原文重炼；purge = 按当前质量门原文就不该进库；skip = 不判定并说明原因 */
  action: 'rebuild' | 'purge' | 'skip';
  code?: QualityBlockCode | RebuildUnavailableCode | 'protected' | 'tombstone' | 'unspecified';
  reason?: string;
  /** L0 原文来源；skip 且取不到时为 none */
  source: 'row_plaintext' | 'l0_store' | 'none';
  /** pinned 或 locked：受保护，执行时既不删也不改写 */
  protected: boolean;
  /** 新 L1 与行上现有 L1 不同 = 正文真的会变（相同则只重盖时间/版本戳） */
  l1_changed: boolean;
  /** 该行当前是否带着 L2–L6 深层正文（不调 LLM 重建时这些会被清空并记 refined_by=stub） */
  has_deep: boolean;
}

function hasDeepLayers(m: Memory): boolean {
  return LAYER_ORDER.some((id) => id !== 'L1' && text(m[`content_${id.toLowerCase()}` as keyof Memory]).trim() !== '');
}

function decide(m: Memory, src: RebuildSource): RebuildDecision {
  const base: RebuildDecision = {
    mem_id: m.mem_id, layer: m.layer, category: m.category, action: 'skip',
    source: 'none', protected: Boolean(m.pinned || m.locked),
    l1_changed: false, has_deep: hasDeepLayers(m),
  };
  if (m.deleted) return { ...base, code: 'tombstone', reason: '墓碑行（已删除，不重建）' };
  if (base.protected) return { ...base, code: 'protected', reason: 'pinned/locked 受保护：既不删也不改写' };
  if (!src.ok) return { ...base, code: src.code, reason: src.reason };
  base.source = src.from;
  const quality = checkL0ToL1Quality(src.text);
  if (!quality.ok) {
    return { ...base, action: 'purge', code: quality.code ?? 'unspecified', reason: quality.reason ?? '' };
  }
  const currentL1 = text(m.content_l1).trim() || text(m.content).trim();
  return {
    ...base, action: 'rebuild',
    l1_changed: quality.content !== currentL1,
    reason: quality.content === currentL1 ? '新 L1 与现有 L1 一致' : undefined,
  };
}

function summarize(rows: Array<{ m: Memory; d: RebuildDecision }>, llmAvailable: boolean): RebuildPreview {
  const out: RebuildPreview = {
    gate_version: QUALITY_GATE_VERSION,
    total: rows.length, tombstones: 0,
    rebuild: 0, rebuild_l1_changed: 0, rebuild_deep_cleared: 0,
    purge: 0, protected_total: 0,
    unavailable: 0, by_unavailable: {}, by_code: {}, by_layer: {},
    sample: [], llm_available: llmAvailable,
  };
  for (const { m, d } of rows) {
    if (d.code === 'tombstone') { out.tombstones++; continue; }
    if (d.protected) out.protected_total++;
    if (d.action === 'skip') {
      if (d.code === 'protected') continue;
      out.unavailable++;
      const key = String(d.code ?? 'unspecified');
      out.by_unavailable[key] = (out.by_unavailable[key] ?? 0) + 1;
      continue;
    }
    if (d.action === 'purge') {
      out.purge++;
      out.by_code[String(d.code ?? 'unspecified')] = (out.by_code[String(d.code ?? 'unspecified')] ?? 0) + 1;
      out.by_layer[m.layer] = (out.by_layer[m.layer] ?? 0) + 1;
    } else {
      out.rebuild++;
      if (d.l1_changed) out.rebuild_l1_changed++;
      if (d.has_deep && !llmAvailable) out.rebuild_deep_cleared++;
    }
    if (out.sample.length < 20) out.sample.push(d);
  }
  return out;
}

export interface RebuildPreview {
  /** 本轮实际生效的质量门版本 */
  gate_version: number;
  /** 扫描行数（含墓碑，与账本总行数一致） */
  total: number;
  tombstones: number;
  /** 会按原文重炼的行数 */
  rebuild: number;
  /** 其中新 L1 与现有 L1 不同（正文真的会变） */
  rebuild_l1_changed: number;
  /** 其中当前带深层正文、但本次不调 LLM → L2–L6 会被清空的行数 */
  rebuild_deep_cleared: number;
  /** 判定为应删的行数（受保护的行在 decide 里已经走 skip，不会计进来） */
  purge: number;
  /** pinned/locked 行数：执行时一行都不碰 */
  protected_total: number;
  /** 取不到原文因而不动的行数（不删、不改，等 L0 恢复或另行处置） */
  unavailable: number;
  /** 取不到原文的原因分布，如 { view_locked: 1641 } */
  by_unavailable: Record<string, number>;
  /** 应删行按拦截码分布 */
  by_code: Record<string, number>;
  /** 应删行按原 layer 分布 */
  by_layer: Record<string, number>;
  /** 审计与 UI 只留样本，绝不把上千个 id 塞进账本 */
  sample: RebuildDecision[];
  /** 调用方告知：本次有没有真实 LLM 可炼 L2–L6（本模块不猜） */
  llm_available: boolean;
}

export interface RebuildScanOptions {
  storage: StorageBackend;
  readL0: L0Reader;
  /** 主进程把「本次是否启用 LLM 精炼」原样传进来，只用于统计 deep_cleared，不改判定 */
  llmAvailable?: boolean;
  filter?: Filter;
}

/**
 * 只读预览：按 L0 原文这一轮会重炼多少、删多少、多少行取不到原文。
 * 如实声明：它会**读取** L0 原文（行上明文，或经查阅会话解密），但不写任何东西。
 */
export async function scanRowsForRebuild(opts: RebuildScanOptions): Promise<RebuildPreview> {
  const list = await opts.storage.listMemories({ ...opts.filter, include_deleted: true });
  const rows: Array<{ m: Memory; d: RebuildDecision }> = [];
  for (const m of list) rows.push({ m, d: decide(m, await opts.readL0(m)) });
  return summarize(rows, opts.llmAvailable === true);
}

export interface RebuildReport extends RebuildPreview {
  /** 实际改写行数（含正文变化与仅重盖戳） */
  rebuilt: number;
  rebuilt_l1_changed: number;
  /** 实际删除行数 */
  purged: number;
  /** 受保护跳过（不删不改） */
  skipped_protected: number;
  /** 取不到原文跳过 */
  skipped_unavailable: number;
  /** 实际清空了 L2–L6 的行数 */
  deep_cleared: number;
  /** 实际新产出的深层（L2–L6）层数合计 */
  deep_generated: number;
  /** 真调 LLM 的次数（每次层级调用一次） */
  llm_calls: number;
  /** LLM 调用失败/产物判废的行数（该行仍会落新 L1，深层如实留空） */
  refine_failed: number;
  /** 写盘/删除失败的行数（单行失败不中断整轮） */
  failed: number;
  failed_ids: string[];
}

export interface RebuildCtx {
  storage: StorageBackend;
  /** 进程内向量索引：重建后按新 L1 重算 upsert，删行时同步摘除 */
  vector?: VectorBackend;
  readL0: L0Reader;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成双库备份并确认。缺失 → 抛错拒绝（旧正文被覆盖，唯一退路是备份）。 */
  backup_confirmed: true;
  filter?: Filter;
  /** 真实 LLM Provider（主进程 = LlmGatewayProvider）；缺省或 stub → 只落 L1 */
  llm?: LlmProvider;
  llmModel?: string;
  /** 显式关掉深层精炼（即便有 LLM）：只重建 L1，L2–L6 清空并记 refined_by=stub */
  useLlm?: boolean;
}

/**
 * 执行重建：逐行取原文 → 质量门 → 新 L1 →（可选）逐层 L2–L6 → 改写行 + 重算指纹/向量 + 每行审计，
 * 最后一条汇总审计。预览与执行共用 decide()，回执数字与预览必然一致。
 * 不做层间查重/嫁接：重建的是**已有行自己**的正文，嫁接到别的行等于把两条历史合并，那不是本模块的职责。
 */
export async function rebuildLayersFromL0(ctx: RebuildCtx): Promise<RebuildReport> {
  const { storage, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('按 L0 重建需要管理员身份（admin_user_id 为空）');
  if (ctx.backup_confirmed !== true) {
    throw new Error('重建 L1–L6 前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const useLlm = ctx.useLlm !== false && Boolean(ctx.llm && ctx.llmModel);
  const list = await storage.listMemories({ ...ctx.filter, include_deleted: true });
  const readRows: Array<{ m: Memory; src: RebuildSource }> = [];
  for (const m of list) readRows.push({ m, src: await ctx.readL0(m) });
  const preview = summarize(readRows.map((r) => ({ m: r.m, d: decide(r.m, r.src) })), useLlm);
  const report: RebuildReport = {
    ...preview,
    rebuilt: 0, rebuilt_l1_changed: 0, purged: 0,
    skipped_protected: preview.protected_total, skipped_unavailable: preview.unavailable,
    deep_cleared: 0, deep_generated: 0, llm_calls: 0, refine_failed: 0,
    failed: 0, failed_ids: [],
  };
  const dim = ctx.vector?.dim ?? DEFAULT_VECTOR_DIM;

  storage.beginBatch?.();
  try {
    for (const { m, src } of readRows) {
      const d = decide(m, src);
      if (d.action === 'skip' || !src.ok) continue;
      try {
        if (d.action === 'purge') {
          await storage.deleteMemory(m.mem_id);
          if (ctx.vector) await ctx.vector.remove(m.mem_id);
          report.purged++;
          await storage.appendAudit({
            request_id, action: 'memory_op', user_id: admin_user_id, ts: now, project_id: m.project_id,
            detail: {
              op: 'rebuild_purge', mem_id: m.mem_id, layer: m.layer, source: d.source,
              filter_code: d.code, reason: d.reason, gate_version: QUALITY_GATE_VERSION,
            },
          });
          continue;
        }
        const quality = checkL0ToL1Quality(src.text);
        const contentL1 = quality.content!;
        // 批次40-C：这一行重建后应当炼到哪几层，由新 L1 的有效字数决定
        const targets = targetLayers(meaningfulLength(contentL1));
        const generated: Partial<Record<RefineLayer, string>> = { L1: contentL1 };
        let refineError: string | undefined;
        let violations = 0;
        const generator = makeLayerGenerator(
          useLlm ? ctx.llm : undefined, useLlm ? ctx.llmModel : undefined, m.category, request_id,
        );
        if (generator.canLlm) {
          // L6 是独立通道：中间层判废也要跳过去再试一次索引
          for (let i = 1; i < targets.length; i++) {
            const layer = targets[i];
            const upstream = layer === 'L6' ? buildL6Input(generated) : generated[targets[i - 1]];
            if (!upstream) break;
            let out = '';
            try {
              out = await generator.call(layer, upstream);
            } catch (e) {
              refineError = String((e as Error)?.message ?? e).slice(0, 200);
              break;
            }
            const bad = checkLayerSpecDetailed(layerSpecOf(layer), out, upstream);
            if (bad.length > 0) {
              violations++;
              const l6 = targets.indexOf('L6');
              if (layer !== 'L6' && l6 > i) { i = l6 - 1; continue; }
              break;
            }
            generated[layer] = out;
          }
          report.llm_calls += generator.calls();
          if (refineError) report.refine_failed++;
        }
        const produced = LAYER_ORDER.filter((id) => generated[id] !== undefined);
        const deepest = headlineLayer(produced, targets);
        const mainContent = generated[deepest]!;
        const llmTouched = produced.some((id) => id !== 'L1');
        const refinedBy: 'stub' | 'llm' | 'llm_partial' = !llmTouched
          ? 'stub'
          : isFullyRefined(produced, targets) ? 'llm' : 'llm_partial';
        await storage.putMemory({
          ...m,
          layer: deepest,
          content: mainContent,
          content_l1: contentL1,
          content_l2: generated.L2,
          content_l3: generated.L3,
          content_l4: generated.L4,
          content_l5: generated.L5,
          content_l6: generated.L6,
          refined_by: refinedBy,
          layer_specs: layerSpecsFrom(generated),
          layers_generated_at: now,
          quality_gate_v: QUALITY_GATE_VERSION,
          version: m.version + 1,
          updated_at: now,
          sha256: sha256hex(mainContent),
          embedding: embedSync(contentL1, dim),
        });
        if (ctx.vector) await ctx.vector.upsert(m.mem_id, contentL1, { project_id: m.project_id, layer: deepest });
        report.rebuilt++;
        if (d.l1_changed) report.rebuilt_l1_changed++;
        if (llmTouched) report.deep_generated += produced.length - 1;
        else if (d.has_deep) report.deep_cleared++;
        if (violations > 0) report.refine_failed++;
        // 审计只记来源字段、产出层名与计数：L0 原文与新正文一个字都不进账本
        await storage.appendAudit({
          request_id, action: 'memory_op', user_id: admin_user_id, ts: now, project_id: m.project_id,
          detail: {
            op: 'l0_rebuild_row', mem_id: m.mem_id, source: d.source, from_layer: m.layer,
            to_layer: deepest, layers: produced, refined_by: refinedBy,
            l1_changed: d.l1_changed, spec_violations: violations, refine_error: refineError,
            gate_version: QUALITY_GATE_VERSION,
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
      op: 'layers_rebuild',
      gate_version: QUALITY_GATE_VERSION,
      use_llm: useLlm,
      llm_available: report.llm_available,
      total: report.total,
      rebuild: report.rebuilt,
      rebuild_l1_changed: report.rebuilt_l1_changed,
      purge: report.purged,
      deep_cleared: report.deep_cleared,
      deep_generated: report.deep_generated,
      llm_calls: report.llm_calls,
      refine_failed: report.refine_failed,
      skipped_protected: report.skipped_protected,
      skipped_unavailable: report.skipped_unavailable,
      failed: report.failed,
      by_code: report.by_code,
      by_unavailable: report.by_unavailable,
      sample_ids: report.sample.map((s) => s.mem_id),
      failed_ids: report.failed_ids,
    },
  });
  return report;
}
