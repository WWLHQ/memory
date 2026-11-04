// 存量拆分迁移（批次37-C）：把「还躺在记忆库行上」的 L0 原文搬进独立的 L0 原数据库。
// 动机（本机实测账本，2026-11-02 校正）：1642 行里 1641 行带着**明文** content_orig（约 5.5 MB），
// content_l0_enc 为 0 行——L0 从未真正加密过，而批次37-A 之后 L0 的归处是 memories.l0.json，不是记忆库。
// 本模块做三件事，且只做这三件：
//   ① 明文 content_orig → 用 L0 写密钥封存成 v2 信封（不解密就别想搬：没解锁一律拒绝，绝不搬明文）；
//   ② 行上已有的 content_l0_enc（v2 或遗留 v1）→ 原样搬走，不重新加密（重封是 l0:migrate 的活）；
//   ③ 搬完把行改成 has_l0=true 并清空这两个字段——记忆库里从此不再有任何 L0 原文。
// 与相邻模块的分工：
//   · l0vault.migrateLegacy = 明文→密文 / v1→v2 的**再加密**；本模块 = **换地方存**（顺带把明文交给 seal）。
//   · FileStorage 的写入拦截（批次37-A）是「新行」的自动搬家；本模块负责「存量」并给出逐行回执。
//   · ledgerReset = 整库删掉重采；本模块一行都不删。
// 设计原则（与 rejudge / ledgerReset 同口径）：纯函数、只改数据；备份、IPC 门禁、口令留在主进程。
//   · 不可逆：搬完行上就没了原件，唯一退路是执行前的备份 → 强制 backup_confirmed，缺失即抛错拒绝。
//   · 审计成对：每搬一行一条 memory_op（op='l0_split'，只记字段与字节数，绝不记正文），整轮一条
//     security_change（op='l0_split'，计数 + 完整性核对 + 样本 id）；单行失败不中断整轮并如实计数。
//   · 幂等：再跑一遍 to_move=0、零写盘（回执会显示「本轮没有要搬的」）。
import type { Filter, Memory, StorageBackend } from './types.ts';
import type { L0BlobStore } from './l0Store.ts';
import { isSealedL0, L0NotSealedError } from './l0Store.ts';
import { parseL0EnvelopeV2 } from './crypto.ts';
import { MemAgentError } from './errors.ts';

/** 一行本轮要不要动、怎么动（预览与执行共用同一判定，绝不让两边口径分家） */
export interface SplitDecision {
  mem_id: string;
  layer: string;
  /** move_plaintext = 明文封存后搬走；move_cipher = 行上密文原样搬走；none = 本轮不动 */
  action: 'move_plaintext' | 'move_cipher' | 'none';
  /** 不动的原因码：invalid_envelope = 行上的字段解析不出信封（既不搬也不删，如实点名） */
  code?: 'invalid_envelope';
  reason?: string;
  /** 搬运体量：明文长度或信封字符数（只记大小，绝不记内容） */
  bytes: number;
}

export interface SplitPreview {
  /** 扫描行数（含墓碑，与账本总行数一致） */
  total: number;
  tombstones: number;
  /** 带着明文 content_orig 的行（必须封存才能搬，执行时需要 L0 写密钥） */
  plaintext_orig: number;
  /** 行上还留着 content_l0_enc 的行（只需搬家，不需要密钥） */
  on_row_cipher: number;
  /** 行上密文里 v2 / 遗留 v1 各多少（v1 仍待 l0:migrate 用旧密码重封） */
  on_row_cipher_v: { v2: number; legacy_v1: number };
  /** 行上的 content_l0_enc 解析不出信封（既不搬也不删，如实点名） */
  invalid_envelope: number;
  /** 已经拆好的行（has_l0=true） */
  already_split: number;
  /** 本轮会写入 L0 原数据库的行数 */
  to_move: number;
  /** L0 原数据库现状 */
  l0_count: number;
  l0_bytes: number;
  /** 完整性核对：L0 库里有信封，但没有任何未删行认领（孤儿密文） */
  orphan_blobs: number;
  /** 完整性核对：行说有自己的 L0（has_l0），L0 库却取不到 → 查阅必然报断链 */
  broken_links: number;
  broken_link_ids: string[];
  /** 审计与 UI 只留样本，绝不把上千个 id 塞进账本 */
  sample_ids: string[];
}

function text(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

/** 本行本轮怎么处理：明文 > 行上密文 > 已拆好 > 不动 */
function decide(m: Memory): SplitDecision {
  const base: SplitDecision = {
    mem_id: m.mem_id, layer: m.layer, action: 'none', bytes: 0,
  };
  if (m.deleted) return { ...base, reason: '墓碑行（原文随删除一并销毁，不搬）' };
  const orig = text(m.content_orig);
  if (orig) return { ...base, action: 'move_plaintext', bytes: orig.length };
  const enc = text(m.content_l0_enc);
  if (enc) {
    if (!isSealedL0(enc)) {
      return {
        ...base, action: 'none', code: 'invalid_envelope', bytes: enc.length,
        reason: '行上的 content_l0_enc 不是可识别信封，不搬（避免把垃圾当密文入库）',
      };
    }
    return { ...base, action: 'move_cipher', bytes: enc.length };
  }
  if (m.has_l0) return { ...base, reason: '已在 L0 原数据库' };
  return { ...base, reason: '没有 L0 原文' };
}

function summarize(list: Memory[], l0Count: number, l0Bytes: number, l0Ids: string[]): SplitPreview {
  const out: SplitPreview = {
    total: list.length, tombstones: 0, plaintext_orig: 0, on_row_cipher: 0,
    on_row_cipher_v: { v2: 0, legacy_v1: 0 }, invalid_envelope: 0, already_split: 0,
    to_move: 0, l0_count: l0Count, l0_bytes: l0Bytes,
    orphan_blobs: 0, broken_links: 0, broken_link_ids: [], sample_ids: [],
  };
  const claimed = new Set<string>();
  const l0Set = new Set(l0Ids);
  for (const m of list) {
    const d = decide(m);
    if (m.deleted) { out.tombstones++; continue; }
    claimed.add(m.mem_id);
    if (d.action === 'move_plaintext') { out.plaintext_orig++; out.to_move++; }
    if (d.action === 'move_cipher') {
      out.on_row_cipher++; out.to_move++;
      if (parseL0EnvelopeV2(text(m.content_l0_enc))) out.on_row_cipher_v.v2++;
      else out.on_row_cipher_v.legacy_v1++;
    }
    if (d.code === 'invalid_envelope') out.invalid_envelope++;
    if (m.has_l0) out.already_split++;
    if (out.sample_ids.length < 20 && d.action !== 'none') out.sample_ids.push(m.mem_id);
  }
  // 完整性核对（只读）：孤儿 = 库里没人认领；断链 = 行认领了库里没有
  for (const id of l0Ids) if (!claimed.has(id)) out.orphan_blobs++;
  for (const m of list) {
    if (m.deleted || !m.has_l0) continue;
    if (!l0Set.has(m.mem_id)) {
      out.broken_links++;
      if (out.broken_link_ids.length < 20) out.broken_link_ids.push(m.mem_id);
    }
  }
  return out;
}

/** 只读预览：两个文件现在各有什么、本轮会搬多少、有没有断链（供二次确认卡展示，绝不改数据） */
export async function scanLedgerForSplit(
  storage: StorageBackend,
  l0?: L0BlobStore,
  filter: Filter = {},
): Promise<SplitPreview> {
  const list = await storage.listMemories({ ...filter, include_deleted: true });
  const l0Ids = l0 ? await l0.ids() : [];
  return summarize(list, l0Ids.length, l0 ? l0.bytes() : 0, l0Ids);
}

export interface SplitReport extends SplitPreview {
  /** 实际搬走的行数 */
  moved: number;
  /** 其中由明文封存而来的行数（执行前必须解锁 L0 写密钥） */
  sealed_from_plaintext: number;
  /** 其中行上密文原样搬迁的行数 */
  cipher_moved: number;
  /** 本轮写盘失败的行数（单行失败不中止整轮） */
  failed: number;
  failed_ids: string[];
}

export interface SplitCtx {
  storage: StorageBackend;
  /** L0 原数据库（批次37-A 的独立文件）——缺失一律拒绝，否则等于把原文丢掉 */
  l0Blobs: L0BlobStore;
  /** L0 写密钥封存口（主进程 = L0Vault.seal）。有明文行时缺失 → E_L0_LOCKED，整轮不执行。 */
  seal?: (plain: string) => Promise<string>;
  admin_user_id: string;
  request_id: string;
  now: number;
  /** 调用方已完成双库备份并确认。缺失 → 抛错拒绝。 */
  backup_confirmed: true;
  filter?: Filter;
}

/**
 * 执行存量拆分：逐行决定 → 写入 L0 原数据库 → 改写记忆库行（清字段 + has_l0），
 * 每行一条 memory_op、整轮一条 security_change。预览与执行共用 decide()，回执数字必然与预览一致。
 * 顺序固定「先写 L0 库、后改记忆库行」：反过来等于先删原件再放副本，中途失败即永久丢失。
 */
export async function splitLedger(ctx: SplitCtx): Promise<SplitReport> {
  const { storage, l0Blobs, admin_user_id, request_id, now } = ctx;
  if (!admin_user_id) throw new Error('存量拆分需要管理员身份（admin_user_id 为空）');
  if (ctx.backup_confirmed !== true) {
    throw new Error('存量拆分前必须先完成备份（backup_confirmed 未置真，已拒绝）');
  }
  const list = await storage.listMemories({ ...ctx.filter, include_deleted: true });
  const idsBefore = await l0Blobs.ids();
  const preview = summarize(list, idsBefore.length, l0Blobs.bytes(), idsBefore);
  if (preview.plaintext_orig > 0 && !ctx.seal) {
    throw new MemAgentError('E_L0_LOCKED',
      `有 ${preview.plaintext_orig} 行带着明文原文：请先在安全页解锁 L0 写密钥再执行拆分（§4.4.4，绝不把明文当 L0 存）`);
  }

  const report: SplitReport = {
    ...preview, moved: 0, sealed_from_plaintext: 0, cipher_moved: 0, failed: 0, failed_ids: [],
  };

  storage.beginBatch?.();
  l0Blobs.beginBatch?.();
  try {
    for (const m of list) {
      const d = decide(m);
      if (d.action === 'none') continue;
      try {
        const envelope = d.action === 'move_plaintext'
          ? await ctx.seal!(text(m.content_orig))
          : text(m.content_l0_enc);
        if (!isSealedL0(envelope)) {
          throw new L0NotSealedError('封存结果不是可识别信封，拒绝写入 L0 原数据库');
        }
        await l0Blobs.put(m.mem_id, { envelope, sealed_at: now });
        await storage.putMemory({
          ...m,
          content_orig: undefined,
          content_l0_enc: undefined,
          has_l0: true,
          version: m.version + 1,
          updated_at: now,
        });
        report.moved++;
        if (d.action === 'move_plaintext') report.sealed_from_plaintext++;
        else report.cipher_moved++;
        await storage.appendAudit({
          request_id, action: 'memory_op', user_id: admin_user_id, ts: now, project_id: m.project_id,
          detail: {
            op: 'l0_split', mem_id: m.mem_id, from: d.action === 'move_plaintext' ? 'content_orig' : 'content_l0_enc',
            bytes: d.bytes, sealed: d.action === 'move_plaintext',
          },
        } as never);
      } catch {
        report.failed++;
        if (report.failed_ids.length < 20) report.failed_ids.push(m.mem_id);
      }
    }
  } finally {
    l0Blobs.commitBatch?.();
    storage.commitBatch?.();
  }

  // 执行后重新核对（孤儿/断链以落盘后的真实两个文件为准，不拿执行前的数字冒充）
  const idsAfter = await l0Blobs.ids();
  const after = summarize(await storage.listMemories({ ...ctx.filter, include_deleted: true }), idsAfter.length, l0Blobs.bytes(), idsAfter);
  report.l0_count = after.l0_count;
  report.l0_bytes = after.l0_bytes;
  report.orphan_blobs = after.orphan_blobs;
  report.broken_links = after.broken_links;
  report.broken_link_ids = after.broken_link_ids;
  report.plaintext_orig = after.plaintext_orig;
  report.on_row_cipher = after.on_row_cipher;
  report.already_split = after.already_split;
  report.to_move = after.to_move;

  await storage.appendAudit({
    request_id, action: 'security_change', user_id: admin_user_id, ts: now,
    detail: {
      op: 'l0_split',
      scanned: preview.total,
      moved: report.moved,
      sealed_from_plaintext: report.sealed_from_plaintext,
      cipher_moved: report.cipher_moved,
      failed: report.failed,
      l0_count: report.l0_count,
      l0_bytes: report.l0_bytes,
      orphan_blobs: report.orphan_blobs,
      broken_links: report.broken_links,
      sample_ids: preview.sample_ids,
      failed_ids: report.failed_ids,
    },
  } as never);
  return report;
}
