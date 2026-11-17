// 按来源清理「网页导出的旧条目」（2026-11-17 用户明确）。
//
// 为什么需要它：插件 0.5.3 给抽取层补上了结构（列表符号 / 代码围栏 / 表格 / 行内标记），
// 同一段对话抽出来的文本变了 → 采集侧幂等键 `SHA-256(content + session_id + seq)` 也变了
// → 重导后的内容会被当成「新内容」再入库一遍，和旧格式条目并存。旧条目此刻只是噪声：
// 它们丢掉了列表层级与代码围栏，留着既污染召回，又让「重导」看起来像「翻倍」。
//
// 判据（唯一来源，别再写第二套）：`created_by_agent` 以 `collector:webchat-export` 开头。
// 采集项来源标识由 sessionCollector.agentFor 产出，形如 `collector:webchat-export:deepseek`。
// 因此按站点过滤就是精确比 `collector:webchat-export:<site>`，绝不靠字符串包含去猜。
//
// 与 ledgerReset 同一套纪律：
//   · 纯函数、只做数据改写；备份与 IPC 门禁在主进程（本模块可单测）。
//   · 不可逆 → 必须带 backup_confirmed，缺了直接拒绝。
//   · 一并摘除向量索引，否则会召回到已经删掉的正文。
//   · 审计留痕：删了多少、按站点/层级分布、样本 id；不全量塞 id。

import type { Memory, StorageBackend, VectorBackend } from './types.ts';

/** 网页导出采集项的来源前缀（sessionCollector.agentFor 的产出约定） */
export const WEBCHAT_AGENT_PREFIX = 'collector:webchat-export';

/** 这条记忆是不是网页导出进来的（精确到前缀边界，避免 `collector:webchat-exports` 这种误命中） */
export function isWebchatExportAgent(agent: unknown): boolean {
  const a = typeof agent === 'string' ? agent.trim() : '';
  if (!a) return false;
  return a === WEBCHAT_AGENT_PREFIX || a.startsWith(`${WEBCHAT_AGENT_PREFIX}:`);
}

/** 从来源标识取站点名（`collector:webchat-export:deepseek` → `deepseek`）；取不到返回 null，不猜 */
export function webchatSiteFromAgent(agent: unknown): string | null {
  if (!isWebchatExportAgent(agent)) return null;
  const rest = String(agent).trim().slice(WEBCHAT_AGENT_PREFIX.length);
  if (!rest.startsWith(':')) return null;
  const site = rest.slice(1).trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(site) ? site : null;
}

/** 只读预览（供二次确认卡展示；不改任何数据） */
export interface WebchatPurgePreview {
  /** 将被删除的行数（不含已是墓碑的行——那些早就不可见，删不删都不影响召回） */
  total: number;
  /** 按站点分布，如 { deepseek: 1058, doubao: 203 } */
  by_site: Record<string, number>;
  /** 按层级分布 */
  by_layer: Record<string, number>;
  /** 其中带 L0 原始数据的行数：删掉后原文只能从备份恢复 */
  with_l0_cipher: number;
  /** 已经是墓碑的行数（不在 total 里，只是让人知道库里还有这些残留） */
  tombstones: number;
  /** 审计只留样本，不全量 id 进账本 */
  sample_ids: string[];
}

/**
 * 挑出待删行。
 * @param site 只清某个站点（如 'deepseek'）；不传 = 所有网页导出站点
 */
export function selectWebchatExportMemories(
  rows: Memory[],
  opts: { site?: string } = {},
): { candidates: Memory[]; preview: WebchatPurgePreview } {
  const site = typeof opts.site === 'string' && opts.site.trim() ? opts.site.trim().toLowerCase() : '';
  const preview: WebchatPurgePreview = {
    total: 0, by_site: {}, by_layer: {}, with_l0_cipher: 0, tombstones: 0, sample_ids: [],
  };
  const candidates: Memory[] = [];
  for (const m of rows) {
    if (!isWebchatExportAgent(m.created_by_agent)) continue;
    const agentSite = webchatSiteFromAgent(m.created_by_agent);
    if (site && agentSite !== site) continue;
    if (m.deleted) {
      preview.tombstones += 1;
      continue;
    }
    candidates.push(m);
    preview.total += 1;
    const key = agentSite ?? '<未知>';
    preview.by_site[key] = (preview.by_site[key] ?? 0) + 1;
    preview.by_layer[m.layer] = (preview.by_layer[m.layer] ?? 0) + 1;
    if (m.has_l0 || (typeof m.content_l0_enc === 'string' && m.content_l0_enc.length > 0)) preview.with_l0_cipher += 1;
    if (preview.sample_ids.length < 10) preview.sample_ids.push(m.mem_id);
  }
  return { candidates, preview };
}

export interface WebchatPurgeReport extends WebchatPurgePreview {
  /** 实际删除行数 */
  purged: number;
  /** 删除失败行数（单行失败不中断整批，如实计数并回显样本） */
  failed: number;
  failed_ids: string[];
  /** 向量摘除失败行数（行已删但索引没摘干净 → 召回可能命中空正文） */
  vector_failed: number;
}

export interface WebchatPurgeCtx {
  storage: StorageBackend;
  /** 进程内向量索引（可选）：删行时同步摘除 */
  vector?: VectorBackend;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成备份并确认；缺失 → 抛错拒绝（删除不可逆） */
  backup_confirmed: true;
  site?: string;
}

/**
 * 执行清理：逐行 deleteMemory + 向量摘除，一批落盘一次，最后写审计。
 * 只删记忆行，不动导出文件、不动采集游标——重导由插件侧负责（那是另一件事，
 * 混在一起会导致「文件删了账没清」或「账清了文件还在」的错位）。
 */
export async function purgeWebchatExports(ctx: WebchatPurgeCtx): Promise<WebchatPurgeReport> {
  const { storage, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('清理网页导出条目需要管理员身份（admin_user_id 为空）');
  if (ctx.backup_confirmed !== true) {
    throw new Error('清理网页导出条目之前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const rows = await storage.listMemories({ include_deleted: true });
  const { candidates, preview } = selectWebchatExportMemories(rows, { site: ctx.site });
  const report: WebchatPurgeReport = {
    ...preview, purged: 0, failed: 0, failed_ids: [], vector_failed: 0,
  };

  storage.beginBatch?.();
  try {
    for (const m of candidates) {
      try {
        await storage.deleteMemory(m.mem_id);
        report.purged += 1;
      } catch {
        report.failed += 1;
        if (report.failed_ids.length < 20) report.failed_ids.push(m.mem_id);
        continue;
      }
      if (ctx.vector) {
        try {
          await ctx.vector.remove(m.mem_id);
        } catch {
          report.vector_failed += 1;
        }
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
      op: 'webchat_export_purge',
      site: ctx.site ?? '',
      total: report.total,
      purged: report.purged,
      failed: report.failed,
      vector_failed: report.vector_failed,
      tombstones: report.tombstones,
      with_l0_cipher: report.with_l0_cipher,
      by_site: report.by_site,
      by_layer: report.by_layer,
      sample_ids: report.sample_ids,
    },
  });
  return report;
}
