// 记忆管理页（REQ-006 / P8）接真内核：17.3 九操作统一走 ma._memoryOp。
// 数据真相 = 内核 StorageBackend（桌面 Electron 下 = 主进程 FileStorage 真实持久账本；
// 浏览器降级 InMemoryStorage 内存态）。
// ⚠ 硬性约定：禁止注入任何演示/种子数据 —— 列表只反映账本真实内容；
//   空账本 → 页面显示诚实空态并引导用户去写入页产生真实记忆。
import type { Memory, MemOp as CoreOp, StorageBackend } from '../../core/memagent/types.ts';
import type { MemAgent } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage, newRequestId } from '../kernel.ts';
import { currentSessionId } from '../shared/session.ts';
import { homeBaseUrl } from '../backend.ts';
import { policyFor } from '../../core/memagent/forgetting.ts';
import { checkL0ToL1Quality, filteredAuditDetail, QUALITY_GATE_VERSION } from '../../core/memagent/qualityGate.ts';
import { layerSpecOf, LAYER_SPECS } from '../../core/memagent/layerRules.ts';
import { forgettingPrefsFromSnapshot } from '../../core/memagent/paramsSnapshot.ts';
import { embedSync } from '../../core/memagent/vector.ts';
import { sha256hex } from '../../core/memagent/sync.ts';
import { configuredVectorDim } from '../models/modelConfig.ts';
import { hostCapability, hostCall } from '../../desktop/hostBridge.ts';
import type { MemoryOp, MemoryRecord, OpResult } from './types.ts';
import type { Layer, BrowseReq, BrowseResult } from '../../core/memagent/types.ts';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';

const DAY = 24 * 3600 * 1000;

/** 内核类别 → 页面六类（展示用，合并档拆不回，归 decision/insight 原类） */
const CATEGORY_TO_TYPE: Record<string, MemoryRecord['type']> = {
  decision: 'decision',
  pitfall: 'pitfall',
  preference: 'preference',
  fact: 'fact',
  context: 'fact',
  insight: 'feedback',
};

/** 共享 storage 实例（页面读列表与内核操作必须同一实例，否则桌面下写不到同一账本） */
export function getStorage(): StorageBackend {
  return getKernelStorage();
}

/** 内核单例由 kernel.ts 收敛；模型配置变更会重建单例，此处不得再缓存旧实例 */
function getAgent(): Promise<MemAgent> {
  return Promise.resolve(getKernel());
}

/** 内核 Memory → 页面 MemoryRecord（完整映射，列表/详情共用） */
export function toRecord(m: Memory): MemoryRecord {
  const ageDays = Math.max(0, Math.floor((Date.now() - (m.created_at ?? Date.now())) / DAY));
  return {
    id: m.mem_id,
    content: m.content, // L1 主内容 = 脱敏原文（未精炼记录也只有这一层真实内容）
    type: CATEGORY_TO_TYPE[m.category] ?? 'fact',
    tags: m.tags ?? [],
    importance: m.importance ?? 0.5,
    confidence: m.confidence ?? 0.5,
    access_count: m.access_count ?? 0,
    reinforce_count: m.reinforce_count ?? 0,
    pinned: m.pinned,
    locked: m.locked,
    archived: m.decay_class === 'archived',
    status: m.decay_class === 'archived' ? 'archived' : m.decay_class === 'dormant' ? 'dormant' : 'active',
    merged_from: m.merged_from,
    merged_into: m.merged_into,
    created_at: new Date(m.created_at ?? Date.now()).toISOString(),
    updated_at: new Date(m.updated_at ?? m.created_at ?? Date.now()).toISOString(),
    ageDays,
    halfLifeDays: m.half_life_days ?? policyFor(m.category).half_life_days,
    // §19.3 采集来源
    source_agent: m.created_by_agent,
    refined_by: m.refined_by,
    layer: m.layer,
    layers_generated_at: m.layers_generated_at ? new Date(m.layers_generated_at).toISOString() : undefined,
    decay_class: m.decay_class,
    version: m.version,
    pending_sync: m.pending_sync,
    conflict_id: m.conflict_id,
  };
}

/** 内核 Memory → 页面 MemoryRecord：只覆盖操作涉及的字段，展示字段沿用原记录 */
function mergeBack(prev: MemoryRecord, m: Memory): MemoryRecord {
  const d = m.decay_class;
  return {
    ...prev,
    importance: m.importance ?? prev.importance,
    confidence: m.confidence ?? prev.confidence,
    pinned: m.pinned,
    locked: m.locked,
    archived: d === 'archived',
    status: d === 'archived' ? 'archived' : d === 'dormant' ? 'dormant' : prev.status,
    updated_at: new Date(m.updated_at ?? Date.now()).toISOString(),
    version: m.version,
    pending_sync: m.pending_sync,
    conflict_id: m.conflict_id,
  };
}

/** 17.3 操作：内核执行（locked 拒绝 / 钳制 / 版本推进 / memory_op 审计）→ 映射页面回执 */
export async function coreApplyOp(rec: MemoryRecord, op: MemoryOp): Promise<OpResult> {
  const ma = await getAgent();
  const r = await ma._memoryOp(rec.id, op as CoreOp);
  if (!r.ok) {
    // G4：locked 约束拒绝（记录不变）
    return { rec, audit: 'locked_blocked', ok: false };
  }
  if (r.mem === null) {
    return { rec: null, audit: 'memory_delete', ok: true };
  }
  return { rec: mergeBack(rec, r.mem), audit: `memory_${op}`, ok: true };
}

/**
 * 账本位置（诚实标注「记忆存储在哪」）：
 * 桌面 Electron → 主进程 FileStorage 真实路径（%APPDATA%/multi-agent-memory/memories.db.json）；
 * 浏览器降级 → 内存态（无磁盘账本，明确标注）。
 * 经 hostCall 走 preload IPC（顶层窗口）或 iframe 消息桥（子页），失败时诚实标注未知。
 */
export async function storageLocation(): Promise<{ kind: 'file' | 'memory' | 'unknown'; path?: string; source: string }> {
  const cap = hostCapability();
  if (cap === 'native' || cap === 'bridge') {
    try {
      const res = await hostCall<{ path: string; source: string }>('storage:location');
      if (res?.path) return { kind: 'file', path: res.path, source: res.source ?? 'file' };
    } catch {
      /* fallthrough to unknown */
    }
  }
  // 浏览器内已登录：账本不在内存，而是经登录后端 /api/kernel/invoke 直读本机真实账本（桌面持锁时只读镜像）
  if (cap === 'none' && currentSessionId()) {
    return { kind: 'memory', path: `${homeBaseUrl()}/api/kernel/invoke`, source: 'http-backend' };
  }
  // 纯浏览器未登录：进程内空账本，诚实标注，不伪造路径
  if (cap === 'none') return { kind: 'memory', source: 'in-memory' };
  return { kind: 'unknown', source: 'ipc-unavailable' };
}

/**
 * 打开单条记忆文件：主进程把该记忆条目导出为独立 .json 文件
 * （真实落盘 userData/memories-export/），并用 OS 默认查看器/编辑器打开。
 * 桌面专属；浏览器降级诚实报错（无 shell 能力）。
 */
export async function openMemoryFile(memId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const cap = hostCapability();
  if (cap !== 'native' && cap !== 'bridge') {
    return { ok: false, error: '当前为浏览器环境，无法打开本地记忆文件（需桌面壳）' };
  }
  try {
    const res = await hostCall<{ ok: boolean; path?: string; error?: string }>('storage:openMemoryFile', [memId]);
    return res ?? { ok: false, error: 'IPC 无返回' };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/**
 * 从真实账本读全量列表（页面唯一真相源，无种子兜底）。
 * 桌面 Electron → 主进程 FileStorage（%APPDATA% 持久库）；
 * 浏览器降级 → 内存态（未写入过即为空 → 页面显示空态引导）。
 */
export async function coreListMemories(): Promise<MemoryRecord[]> {
  await getAgent();
  const mems = await getStorage().listMemories({});
  return mems.map(toRecord);
}

/** 分层 L1–L6 策略快照：层规格（字符/关键词上限）+ 遗忘参数（全局半衰期/归档阈值）。 */
export interface LayerPolicySnapshot {
  layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
  name: string;
  maxChars: number | null;
  maxKeywords?: number;
  /** 全局半衰期覆盖（天）；undefined = 按类别内核默认 */
  halfLifeDays?: number;
  /** 全局归档阈值（天）；undefined = 按类别内核默认 */
  autoArchiveDays?: number;
  /** auto_organize=false → 后台遗忘调度只记 skipped */
  forgettingEnabled: boolean;
  /** 读快照时的账本条数（真实账本，不是种子） */
  ledgerRows: number;
}

export async function coreLayerPolicy(): Promise<LayerPolicySnapshot[]> {
  await getAgent();
  const mems = await getStorage().listMemories({});
  const prefs = forgettingPrefsFromSnapshot(mems);
  return LAYER_SPECS.map((s) => ({
    layer: s.id,
    name: s.name,
    maxChars: s.maxChars,
    maxKeywords: s.maxKeywords,
    halfLifeDays: prefs.halfLifeDays,
    autoArchiveDays: prefs.autoArchiveDays,
    forgettingEnabled: prefs.enabled,
    ledgerRows: mems.length,
  }));
}

/** 编辑落在记录当前最深层：content 是主内容，对应 content_lN 同步改写（不留新旧两份） */
function layerContentPatch(layer: Memory['layer'], text: string): Partial<Memory> {
  switch (layer) {
    case 'L1': return { content_l1: text };
    case 'L2': return { content_l2: text };
    case 'L3': return { content_l3: text };
    case 'L4': return { content_l4: text };
    case 'L5': return { content_l5: text };
    case 'L6': return { content_l6: text };
    default: return {};
  }
}

/**
 * 记忆内容编辑（9.5 MEMORY.md 手动增删改）→ 写回真实账本。
 * 内核 MemOpPatch 不含 content（内容编辑属用户手动通道，非程序调参），故此处直接走
 * storage.putMemory：version+1 / updated_at 刷新 + memory_op 审计真实落账（G6）。
 * G4：locked 记忆不可编辑（与内核口径一致）。
 * 批次10：手动编辑与写入共用同一道 L0→L1 质量门（噪声/脱敏），不过门 → 拒绝并审计；
 * 过门 → 落脱敏产物、重算 sha256；L1 记录同时重算 embedding（召回依据 L1 向量）。
 * L0 密文不受影响（手动编辑只改可检索层，原文仍以密文保存）。
 */
export async function coreUpdateContent(memId: string, content: string): Promise<{ ok: boolean; rec?: MemoryRecord; error?: string }> {
  const storage = getStorage();
  const m = await storage.getMemory(memId);
  if (!m) return { ok: false, error: '记忆不存在（可能已被删除）' };
  if (m.locked) return { ok: false, error: '已锁定，先解锁才能编辑内容' };
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: '内容不能为空' };

  const gate = checkL0ToL1Quality(trimmed);
  const now = Date.now();
  if (!gate.ok) {
    await storage.appendAudit({
      request_id: newRequestId('req'),
      action: 'memory_op',
      ts: now,
      project_id: m.project_id,
      user_id: m.user_id,
      detail: {
        op: 'edit_content', mem_id: memId, source: 'manual_edit',
        ...filteredAuditDetail(trimmed, gate),
      },
    });
    return { ok: false, error: `内容未通过 L0→L1 质量门：${gate.reason}` };
  }

  const nextText = gate.content!;
  // 批次28-C：layer 不是 L1 但并非真实 LLM 产物的行（refined_by 缺失/stub，如清理前的遗留行）
  // 一律按 L1 处理 —— 手动编辑不再往遗留深层字段回写，避免「无 LLM 却保留 L2-L6」死灰复燃。
  const isRealLlmProduct = m.refined_by === 'llm' || m.refined_by === 'llm_partial';
  const effectiveLayer: Memory['layer'] = isRealLlmProduct ? m.layer : 'L1';
  const next: Memory = {
    ...m,
    content: nextText,
    version: m.version + 1,
    updated_at: now,
    layers_generated_at: now,   // 手动改写即重炼：层级生成时间跟着刷新（批次24 口径2）
    // 批次36-A：本次改写是按当前版规则过的门 → 重盖质量门版本戳
    quality_gate_v: QUALITY_GATE_VERSION,
    sha256: sha256hex(nextText),
    ...(effectiveLayer === 'L1'
      ? {
          content_l1: nextText,
          ...(m.layer !== 'L1'
            ? {
                layer: 'L1' as const,
                content_l2: undefined, content_l3: undefined, content_l4: undefined,
                content_l5: undefined, content_l6: undefined,
                layer_specs: { L1: `v1:${layerSpecOf('L1').name}` },
              }
            : {}),
        }
      : layerContentPatch(effectiveLayer, nextText)),
  };
  if (effectiveLayer === 'L1') {
    const dim = m.embedding && m.embedding.length > 0 ? m.embedding.length : configuredVectorDim();
    next.embedding = embedSync(nextText, dim);
  }
  await storage.putMemory(next);
  await storage.appendAudit({
    request_id: newRequestId('req'),
    action: 'memory_op',
    ts: now,
    project_id: m.project_id,
    user_id: m.user_id,
    detail: {
      op: 'edit_content', mem_id: memId, source: 'manual_edit',
      from_len: m.content.length, to_len: nextText.length,
      masked: nextText !== trimmed,
      l0_unchanged: true,
      embedding_recomputed: effectiveLayer === 'L1',
    },
  });
  return { ok: true, rec: toRecord(next) };
}

/**
 * 查阅某一层全部内容（§4.1 / 19.11）：L0 必须带连续会话 l0_session_id，其他层直接可读。
 * 批次27 P2-7：项目从账本真实派生（list_projects 同口径），逐项目 browse 合并；空账本回落默认项目。
 * 全部项目都失败时返回 null（如 L0 会话失效），调用方负责 UI 反馈。
 */
export async function coreBrowse(
  layer: Layer,
  l0SessionId?: string,
): Promise<{ rows: { mem_id: string; content: string }[]; l0_masked: boolean } | null> {
  const ma = await getAgent();
  const projects = await listProjectIds();
  const targets = projects.length > 0 ? projects : [DEFAULT_PROJECT_ID];
  const rows: { mem_id: string; content: string }[] = [];
  let l0_masked = false;
  let failed = 0;
  for (const project_id of targets) {
    const req: BrowseReq = {
      layer,
      project_id,
      l0_auth: layer === 'L0' && l0SessionId ? { l0_session_id: l0SessionId } : undefined,
    };
    try {
      const res: BrowseResult = await ma.browse(req);
      rows.push(...res.rows);
      l0_masked = l0_masked || res.l0_masked;
    } catch {
      // 单项目失败（如 L0 授权不覆盖该项目）只跳过该项目；全部失败才报给调用方
      failed += 1;
    }
  }
  if (failed === targets.length) return null;
  return { rows, l0_masked };
}
