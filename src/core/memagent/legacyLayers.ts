// 遗留账本清理（批次24）：把「未接真实 LLM 却带 L2–L6」的历史行诚实降级回 L1。
// 背景：§2.2 规则落地前，stub 精炼器给每条记忆都编满 L2–L6 套话，且可召回正文 content
// 取的是 stub L2；规则落地后写入只落 L1（refined_by=stub）。本模块只修历史行，
// 判定口径是 refined_by !== 'llm'——没有真实 LLM 产出的深层内容一律视为无效产物。
import type { Filter, Memory, StorageBackend } from './types.ts';
import { layerSpecOf } from './layerRules.ts';
import { sha256hex } from './sync.ts';

/** L2–L6 精炼产物字段名 */
const DEEP_FIELDS = ['content_l2', 'content_l3', 'content_l4', 'content_l5', 'content_l6'] as const;
const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 遗留脏行判定：带 L2–L6 内容，但不是真实 LLM 产出的（refined_by 缺失或为 stub；
 *  批次27 P2-4：llm_partial 也是真实 LLM 产物（中途失败），不降级） */
export function isStubDeepLayered(m: Memory): boolean {
  if (m.refined_by === 'llm' || m.refined_by === 'llm_partial') return false;
  return DEEP_FIELDS.some((k) => hasText(m[k]));
}

/** 只读预览：账本里有多少条需要降级（不改任何数据） */
export interface LegacyScan {
  scanned: number;
  /** 命中降级的条数 */
  hits: number;
  /** 命中但缺 content_l1：无法诚实回填正文，跳过并如实计数 */
  missing_l1: number;
  /** 命中行按原 layer 分布，如 { L2: 986 } */
  by_layer: Record<string, number>;
}

export async function scanStubLayers(storage: StorageBackend, filter: Filter = {}): Promise<LegacyScan> {
  const list = await storage.listMemories({ ...filter });
  const out: LegacyScan = { scanned: list.length, hits: 0, missing_l1: 0, by_layer: {} };
  for (const m of list) {
    if (!isStubDeepLayered(m)) continue;
    out.hits++;
    out.by_layer[m.layer] = (out.by_layer[m.layer] ?? 0) + 1;
    if (!hasText(m.content_l1)) out.missing_l1++;
  }
  return out;
}

export interface LegacyDemoteReport extends LegacyScan {
  /** 实际改写条数 */
  demoted: number;
  /** 未改动条数（含命中但缺 L1） */
  skipped: number;
  /** 审计里只留样本 ID，986 条全量 id 不进账本 */
  sample_ids: string[];
}

export interface LegacyDemoteCtx {
  storage: StorageBackend;
  /** 管理员身份：审计与动作日志都记这条操作是谁做的 */
  admin_user_id: string;
  request_id: string;
  now: number;
  filter?: Filter;
}

/**
 * 降级为 L1：content ← content_l1、删掉 L2–L6、layer_specs 只留 L1、
 * refined_by=stub、按新正文重算 sha256、版本 +1。
 * embedding 保持不动：本机真实账本实测 986 条历史脏行的向量与 embedSync(content_l1)
 * 余弦 = 1.000（与 content / stub L2 分别只有 0.69~0.90），说明旧向量本来就是按 L1 算的，
 * 降级后仍然有效，重算只会白改数据。
 * 不刷向量索引：本体内唯一的 VectorBackend（JsVectorBackend）是进程内临时索引，
 * 召回走存储全量扫描而非 vector.search，主进程里没有需要跟着改 layer 的持久索引。
 */
export async function demoteStubLayers(ctx: LegacyDemoteCtx): Promise<LegacyDemoteReport> {
  const { storage, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('遗留账本清理需要管理员身份（admin_user_id 为空）');
  const filter = ctx.filter ?? {};

  const list = await storage.listMemories({ ...filter });
  const report: LegacyDemoteReport = {
    scanned: list.length, hits: 0, missing_l1: 0, by_layer: {},
    demoted: 0, skipped: 0, sample_ids: [],
  };

  storage.beginBatch?.();
  try {
    for (const m of list) {
      if (!isStubDeepLayered(m)) continue;
      report.hits++;
      report.by_layer[m.layer] = (report.by_layer[m.layer] ?? 0) + 1;

      if (!hasText(m.content_l1)) {
        report.missing_l1++;
        report.skipped++;
        continue;
      }
      const l1 = m.content_l1.trim();
      const next: Memory = {
        ...m,
        layer: 'L1',
        content: l1,
        content_l1: l1,
        content_l2: undefined,
        content_l3: undefined,
        content_l4: undefined,
        content_l5: undefined,
        content_l6: undefined,
        layer_specs: { L1: `v1:${layerSpecOf('L1').name}` },
        refined_by: 'stub',
        sha256: sha256hex(l1),
        version: m.version + 1,
        updated_at: now,
      };
      await storage.putMemory(next);
      report.demoted++;
      if (report.sample_ids.length < 20) report.sample_ids.push(m.mem_id);
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
      op: 'legacy_layer_demote',
      scanned: report.scanned,
      hits: report.hits,
      demoted: report.demoted,
      missing_l1: report.missing_l1,
      by_layer: report.by_layer,
      sample_ids: report.sample_ids,
    },
  });
  return report;
}
