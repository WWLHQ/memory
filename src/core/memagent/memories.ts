// 内核记忆业务（§3 schema + 行为红线）：write 逐层生成/查重/分支嫁接 / browse L0 授权 / gc 衰减 / memoryOp 17.3 操作
import { isCategory } from './types.ts';
import type {
  AuditRef, BrowseReq, BrowseResult, BrowseRow, Category, Form,
  FeedbackKind, FeedbackResult,
  GcReq, GcReport, L0Port, LayerDecision, LlmProvider, MemOp, MemOpPatch, MemOpResult, Memory,
  StorageBackend, VectorBackend, WriteResult,
} from './types.ts';
import { MemAgentError } from './errors.ts';
import type { L0BlobStore } from './l0Store.ts';
import { embedSync, DEFAULT_VECTOR_DIM } from './vector.ts';
import { checkL0ToL1Quality, filteredAuditDetail, QUALITY_GATE_VERSION } from './qualityGate.ts';
import {
  LAYER_ORDER, checkLayerSpecDetailed, headlineLayer, layerSpecOf,
  isFullyRefined, meaningfulLength, targetLayers,
  type RefineLayer,
} from './layerRules.ts';
import { findDuplicate } from './dedup.ts';
import { ulid } from './ulid.ts';
import { sha256hex } from './sync.ts';
import { classifyLayer } from './forgetting.ts';

export {
  LAYER_SPECS, checkLayerSpec, checkLayerSpecDetailed, sanitizeL1, layerSpecOf, meaningfulLength,
  depthCapFor, headlineLayer, layerBand, targetLayers,
} from './layerRules.ts';
export type { LayerSpec, LayerViolation, LayerViolationCode, RefineLayer } from './layerRules.ts';

/** 17.4 钳制：importance 下限 0.1 / confidence 下限 0.05（2.4.2 规则4） */
const CLAMP = { importance: [0.1, 1] as const, confidence: [0.05, 1] as const };
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** 向量后端维度（未声明 → JS 起步实现默认维度） */
function dimOf(vector: { readonly dim?: number }): number {
  return vector.dim ?? DEFAULT_VECTOR_DIM;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ─── §2.2 逐层管道：L0 加密 → L1 脱敏 → L2…L6 逐层生成/校验/查重 ────────────────

/** 已生成层 → layer_specs 版本记录（只记录真实产出的层） */
export function layerSpecsFrom(generated: Partial<Record<RefineLayer, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of LAYER_ORDER) {
    if (generated[id] !== undefined) out[id] = `v1:${layerSpecOf(id).name}`;
  }
  return out;
}

/** L6 输入：L1–L5 全部已生成层（阶梯收敛，不把 L0 送进 LLM） */
export function buildL6Input(generated: Partial<Record<RefineLayer, string>>): string {
  return LAYER_ORDER
    .filter((id) => id !== 'L6' && generated[id] !== undefined)
    .map((id) => `[${id}] ${generated[id]}`)
    .join('\n');
}

interface LayerGenerator {
  /** 是否有真实 LLM 可生成 L2–L6（stub/无模型/未实现 → false） */
  readonly canLlm: boolean;
  call(layer: RefineLayer, input: string): Promise<string>;
  calls(): number;
}

/**
 * 逐层 LLM 调用器（§2.2 不变量 1）：L2–L6 每层一次，输入只能是上一层。
 * 旧 Provider 只实现 refine（一次返回多层）时，仅以 L1 调用一次并按层取用，
 * 保证 L0 原文永不送 LLM；新 Provider 应实现 refineLayer。
 */
export function makeLayerGenerator(
  llm: LlmProvider | undefined,
  model: string | undefined,
  category: Category,
  request_id: string,
): LayerGenerator {
  const canLlm = Boolean(
    llm && llm.isStub === false && model
    && (typeof llm.refineLayer === 'function' || typeof llm.refine === 'function'),
  );
  let calls = 0;
  let legacy: Promise<Partial<Record<RefineLayer, string>>> | null = null;
  return {
    canLlm,
    calls: () => calls,
    async call(layer, input) {
      if (!llm || !model) return '';
      if (typeof llm.refineLayer === 'function') {
        calls++;
        const out = await llm.refineLayer(model, layer, input, category, { request_id, usage: 'write' });
        return typeof out === 'string' ? out.trim() : '';
      }
      if (!legacy) {
        calls++;
        legacy = llm.refine!(model, input, category, { request_id, usage: 'write' }).then((all) => {
          const out: Partial<Record<RefineLayer, string>> = {};
          for (const id of LAYER_ORDER) {
            const v = all[`content_${id.toLowerCase()}` as keyof typeof all];
            if (typeof v === 'string' && v.trim()) out[id] = v.trim();
          }
          return out;
        });
      }
      const all = await legacy;
      return all[layer] ?? '';
    },
  };
}

// ─── coreWrite ─────────────────────────────────────────────────────────────────

export interface WriteInput {
  content: string;
  category: Category;
  project_id: string;
  user_id?: string;
  session_id?: string;
  source_agent?: string;
  /** A4（§2.3）扩展打分旋钮：显式传入才落库；未传 → scoreMemory 走默认 0.5（兼容存量） */
  importance?: number;
  confidence?: number;
  half_life_days?: number;
  tags?: string[];
}

export interface WriteCtx {
  storage: StorageBackend;
  vector: VectorBackend;
  account: { user_id: string; team_id: string; enterprise_id: string };
  request_id: string;
  now: number;
  /** 仅当明确非 stub 的 Provider 注入时才生成 L2–L6；缺省/stub → 只落 L1 */
  llm?: LlmProvider;
  /** 反代理选中的模型（与 llm.refineLayer/refine 配对；缺省 = 不走 LLM） */
  llmModel?: string;
  /** L0 写密钥端口（§4.4.4）：缺省/未解锁 → E_L0_LOCKED，绝不落明文 */
  l0?: L0Port;
}

/**
 * A4（§2.3）：MCP `write_memory` 扩展打分旋钮的统一入参校验（TCP mcp.ts / HTTP mcpHttp.ts 共用）。
 * 全部可选；非法即返回带字段名的 error 文案（调用方回 -32602 / isError），合法则产出钳制前的原始值
 * （coreWrite 落库时再做 CLAMP 钳制）。未传入的字段不出现在 knobs 里 → 记录不带该字段，
 * scoreMemory 走默认 0.5（兼容存量，不引发分数漂移）。
 */
export function parseWriteKnobs(p: Record<string, unknown>): {
  knobs: Pick<WriteInput, 'importance' | 'confidence' | 'half_life_days' | 'tags'>;
  error?: string;
} {
  const knobs: Pick<WriteInput, 'importance' | 'confidence' | 'half_life_days' | 'tags'> = {};
  if (p.importance !== undefined) {
    const v = p.importance;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      return { knobs, error: 'write_memory.importance 须为 0–1 的数字' };
    }
    knobs.importance = v;
  }
  if (p.confidence !== undefined) {
    const v = p.confidence;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      return { knobs, error: 'write_memory.confidence 须为 0–1 的数字' };
    }
    knobs.confidence = v;
  }
  if (p.half_life_days !== undefined) {
    const v = p.half_life_days;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      return { knobs, error: 'write_memory.half_life_days 须为 ≥1 的整数（天）' };
    }
    knobs.half_life_days = v;
  }
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags) || p.tags.some((t) => typeof t !== 'string')) {
      return { knobs, error: 'write_memory.tags 须为字符串数组' };
    }
    const cleaned = (p.tags as string[]).map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleaned.length > 0) knobs.tags = cleaned;
  }
  return { knobs };
}

/**
 * 写入主流程（§2.2 不变量 1–8）：
 *   质量门 → L1 → 逐层（生成 → 规格校验 → 该层查重）→ 命中即分支嫁接并停止。
 * 新记忆保留自己的 L0/L1..Lk；目标记忆只刷新 grafted_from/confidence/last_access，
 * L1–L6 文本一字不改（§6.2）。
 */
export async function coreWrite(input: WriteInput, ctx: WriteCtx): Promise<WriteResult> {
  if (!isCategory(input.category)) {
    throw new Error(`非法 category：${String(input.category)}（允许：fact/decision/pitfall/insight/preference/context）`);
  }
  const { storage, vector, account, request_id, now } = ctx;
  const dim = dimOf(vector);
  const auditRef: AuditRef = { request_id, action: 'write' };

  // 1) L0→L1 质量门（§2.1）：必须在查重之前；噪声/无意义内容不落库
  const quality = checkL0ToL1Quality(input.content);
  if (!quality.ok) {
    await storage.appendAudit({
      ...auditRef, project_id: input.project_id, user_id: input.user_id, ts: now,
      detail: { ...filteredAuditDetail(input.content, quality), source_agent: input.source_agent, session_id: input.session_id },
    });
    return {
      mem_id: '',
      dedup: { action: 'filtered', sim: -1 },
      spec_violations: [`L0→L1 质量门拦截: ${quality.reason}`],
      audit: auditRef,
    };
  }
  const contentL1 = quality.content!;

  // 1.5) L0 加密必须在任何 LLM 调用前确认（§4.4.4）：无写密钥 → E_L0_LOCKED，不落明文
  if (!ctx.l0) {
    throw new MemAgentError('E_L0_LOCKED', 'L0 写密钥未解锁：请输入 L0 管理密码解锁写密钥后再写入（桌面端安全页「L0 管理」，或写入被挡处的解锁框；§4.4.4）');
  }
  let content_l0_enc: string;
  try {
    content_l0_enc = await ctx.l0.seal(input.content);
  } catch (e) {
    if (e instanceof MemAgentError) throw e;
    throw new MemAgentError('E_L0_LOCKED', `L0 加密失败：${String((e as Error)?.message ?? e)}`);
  }

  // 2) 查重候选：同 project、未删除；层文本由 findDuplicate 按层过滤（深层记忆也含浅层）
  const candidates = (await storage.listMemories({ project_id: input.project_id })).filter((m) => !m.deleted);

  // 3) 逐层生成 → 校验 → 查重；命中即嫁接停止（不再生成下一层）
  const generator = makeLayerGenerator(ctx.llm, ctx.llmModel, input.category, request_id);
  // 批次40-C：这一行该炼到哪几层由 L1 的有效字数决定（料不够不硬凑深层，见 targetLayers）
  const targets = targetLayers(meaningfulLength(contentL1));
  const generated: Partial<Record<RefineLayer, string>> = {};
  const decisions: LayerDecision[] = [];
  const violations: string[] = [];
  let refineError: string | undefined;
  let graft: { target: Memory; layer: RefineLayer; score: number; threshold: number } | null = null;

  for (let i = 0; i < targets.length; i++) {
    const layer = targets[i];
    let text: string;
    let by: 'local' | 'llm';

    if (layer === 'L1') {
      text = contentL1;
      by = 'local';
    } else {
      if (!generator.canLlm) {
        decisions.push({ layer, action: 'skipped', by: 'none', reason: '未接入真实 LLM：只落 L1（refined_by=stub）' });
        break;
      }
      const upstream = layer === 'L6' ? buildL6Input(generated) : generated[targets[i - 1]];
      if (!upstream) {
        decisions.push({ layer, action: 'stopped', by: 'none', reason: `缺少上游 ${targets[i - 1]}，阶梯中断` });
        break;
      }
      try {
        text = await generator.call(layer, upstream);
      } catch (e) {
        refineError = String((e as Error)?.message ?? e);
        decisions.push({ layer, action: 'invalid', by: 'llm', reason: `LLM 调用失败：${refineError}` });
        break;  // 传输失败 = 该行的引擎预算已用完，不再往下烧
      }
      const bad = checkLayerSpecDetailed(layerSpecOf(layer), text, upstream);
      if (bad.length > 0) {
        violations.push(...bad.map((v) => v.reason));
        decisions.push({ layer, action: 'invalid', by: 'llm', code: bad[0].code, reason: bad.map((v) => v.reason).join('；') });
        // L6 是独立通道（检索索引，不吃上游连续性）：中间层判废也要跳过去再试它一次
        const l6 = targets.indexOf('L6');
        if (layer !== 'L6' && l6 > i) { i = l6 - 1; continue; }
        break;
      }
      by = 'llm';
    }

    generated[layer] = text;
    // 每层查重：命中 → 分支嫁接并停止；未命中 → 记录分数继续下一层
    const dup = await findDuplicate(text, layer, candidates, {
      dim, request_id, llm: ctx.llm, model: ctx.llmModel,
    });
    if (dup.best && dup.best.score >= dup.threshold) {
      decisions.push({
        layer, action: 'duplicate', by, score: dup.best.score, threshold: dup.threshold,
        candidates: dup.evaluated, reason: `命中 ${dup.best.mem.mem_id}（分支嫁接）`,
      });
      graft = { target: dup.best.mem, layer, score: dup.best.score, threshold: dup.threshold };
      break;
    }
    decisions.push({
      layer, action: 'generated', by, score: dup.best?.score, threshold: dup.threshold,
      candidates: dup.evaluated,
    });
  }

  const produced = LAYER_ORDER.filter((id) => generated[id] !== undefined);
  const deepest = headlineLayer(produced, targets);
  const mainContent = generated[deepest]!;
  // 批次27 P2-4 + 批次40-C：refined_by 诚实化。llm = 本行该炼的层全炼到了（深度按料给，
  // 不再要求每条都到 L6）；中途失败/违规的残缺产物标 llm_partial，不冒充全量精炼。
  const llmTouched = produced.some((id) => id !== 'L1');
  const refinedBy: 'stub' | 'llm' | 'llm_partial' = !llmTouched
    ? 'stub'
    : !graft && !isFullyRefined(produced, targets)
      ? 'llm_partial'
      : 'llm';

  const mem: Memory = {
    mem_id: `mem_${ulid()}`,
    project_id: input.project_id,
    user_id: input.category === 'preference' ? input.user_id : undefined,
    enterprise_id: account.enterprise_id,
    team_id: account.team_id,
    category: input.category,
    layer: deepest,
    content_l0_enc,
    // §4.4.6：v2 只存密文，content_orig 永不写入（旧数据走 l0MigrateLegacy）
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
    // 批次36-A：这一行是按哪一版质量门放进来的（历史行无字段 → 回放/重判按 v1 处理）
    quality_gate_v: QUALITY_GATE_VERSION,
    graft_to: graft?.target.mem_id,
    graft_layer: graft?.layer,
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_by_agent: input.source_agent,
    created_at: now,
    last_access_time: now,
    updated_at: now,
    sha256: sha256hex(mainContent),
  };
  mem.embedding = embedSync(contentL1, dim); // 语义向量从 L1 生成（§2.2 不变量 7）
  // A4（§2.3）：显式传入的打分旋钮才落库；未传 → 不带该字段，scoreMemory 走默认 0.5（兼容存量）
  if (input.importance !== undefined) mem.importance = clamp(input.importance, CLAMP.importance);
  if (input.confidence !== undefined) mem.confidence = clamp(input.confidence, CLAMP.confidence);
  if (input.half_life_days !== undefined) mem.half_life_days = Math.max(1, input.half_life_days);
  if (input.tags !== undefined && input.tags.length > 0) {
    mem.tags = input.tags.map((t) => String(t).trim()).filter((t) => t.length > 0);
  }
  await storage.putMemory(mem);
  await vector.upsert(mem.mem_id, contentL1, { project_id: input.project_id, layer: deepest });

  if (graft) {
    // §6.2：目标只刷新嫁接分支/置信度/访问时间，L0/L1–L6 文本一字不改
    const t = graft.target;
    const updatedTarget: Memory = {
      ...t,
      grafted_from: [...(t.grafted_from ?? []), mem.mem_id],
      confidence: clamp((t.confidence ?? 0.5) + 0.01, CLAMP.confidence),
      last_access_time: now,
      version: t.version + 1,
      updated_at: now,
    };
    await storage.putMemory(updatedTarget);
  }

  // 层键沿用 Memory 字段名（content_l1..l6），与写入回执/Webhook 预览同一口径
  const layersOut: Record<string, string> = {};
  for (const id of produced) layersOut[`content_${id.toLowerCase()}`] = generated[id]!;

  await storage.appendAudit({
    ...auditRef, project_id: input.project_id, user_id: input.user_id, ts: now,
    detail: {
      dedup: graft ? 'grafted' : 'new',
      category: input.category,
      l0_encrypted: true,
      l0_envelope_v: 2,
      layers: produced,
      refined_by: refinedBy,
      llm_calls: generator.calls(),
      layer_decisions: decisions,
      spec_violations: violations,
      refine_error: refineError,
      graft_to: graft?.target.mem_id,
      graft_layer: graft?.layer,
      score: graft ? round3(graft.score) : 0,
      threshold: graft?.threshold,
      mem_id: mem.mem_id,
    },
  });
  if (graft) {
    await storage.appendAudit({
      request_id, action: 'graft', ts: now, project_id: input.project_id, user_id: input.user_id,
      detail: {
        new_id: mem.mem_id, target_id: graft.target.mem_id, layer: graft.layer,
        score: round3(graft.score), threshold: graft.threshold,
      },
    });
  }

  return {
    mem_id: mem.mem_id,
    dedup: graft
      ? { action: 'grafted', sim: round3(graft.score), graft_to: graft.target.mem_id, graft_layer: graft.layer }
      : { action: 'new', sim: 0 },
    layers: layersOut,
    refined_by: refinedBy,
    spec_violations: violations,
    refine_error: refineError,
    layer_decisions: decisions,
    audit: auditRef,
  };
}

// ─── coreBrowse ────────────────────────────────────────────────────────────────

/**
 * browse（§4.1 / §4.4）：L0 查阅只认连续会话 `l0_session_id`（端壳主进程解密）。
 * 无会话 → 全遮罩 + l0_auth_fail(no_grant)；会话过期 → l0_auth_fail(expired) + E_L0_EXPIRED；
 * 任一命中记忆解密失败 → 整次 E_AUTH_L0（全有或全无），绝不返回部分明文。
 */
export async function coreBrowse(
  req: BrowseReq,
  ctx: {
    storage: StorageBackend; request_id: string; now: number; l0?: L0Port; user_id?: string; form?: Form;
    /** 批次37：L0 密文已拆到独立原数据库时，行只带 has_l0，信封从这里取 */
    l0Blobs?: L0BlobStore;
  },
): Promise<BrowseResult> {
  const { storage, request_id, now } = ctx;
  const mems = await storage.listMemories({ project_id: req.project_id });
  const isL0 = req.layer === 'L0';
  const sessionId = req.l0_auth?.l0_session_id;

  const FIELD: Record<string, keyof Memory> = {
    L1: 'content_l1', L2: 'content_l2', L3: 'content_l3',
    L4: 'content_l4', L5: 'content_l5', L6: 'content_l6',
  };

  if (!isL0) {
    // 批次27 P2-2：表外 layer 不再静默过滤成「空结果 + 成功审计」，直接报错
    if (!(req.layer in FIELD)) throw new Error(`E_BAD_LAYER: 非法 layer ${String(req.layer)}（允许 L0–L6）`);
    const rows = mems
      .filter((m) => {
        const v = m[FIELD[req.layer]] as string | undefined;
        return typeof v === 'string' && v.trim().length > 0;
      })
      .map((m) => ({ mem_id: m.mem_id, content: (m[FIELD[req.layer]] as string) ?? '' }));
    await storage.appendAudit({
      request_id, action: 'log_view', ts: now, project_id: req.project_id, user_id: ctx.user_id,
      detail: { layer: req.layer, form: ctx.form },
    });
    return { rows, l0_masked: false, audit: { request_id, action: 'log_view' } };
  }

  // 批次37：L0 密文可以在行上（未拆库/旧数据），也可以在**独立的 L0 原数据库**里（行只带 has_l0）。
  // 未授权时不取信封（省掉整库的 L0 库读取），只按「这条声明有自己的 L0」遮罩。
  const claims = mems.filter((m) => Boolean(m.content_l0_enc) || Boolean(m.has_l0)).map((m) => m.mem_id);
  const claimSet = new Set(claims);

  const maskedRows = (): BrowseRow[] => mems.map((m) => ({
    mem_id: m.mem_id,
    content: claimSet.has(m.mem_id) ? '[L0 已加密 · 需授权]' : '',
  }));

  if (!sessionId || !ctx.l0) {
    await storage.appendAudit({
      request_id, action: 'l0_auth_fail', ts: now, project_id: req.project_id, user_id: ctx.user_id,
      detail: { reason: 'no_grant', form: ctx.form },
    });
    return { rows: maskedRows(), l0_masked: true, audit: { request_id, action: 'l0_auth_fail' } };
  }

  let info: Awaited<ReturnType<NonNullable<L0Port['sessionInfo']>>> | undefined;
  try {
    info = await ctx.l0.sessionInfo?.(sessionId);
  } catch (e) {
    await storage.appendAudit({
      request_id, action: 'l0_auth_fail', ts: now, project_id: req.project_id, user_id: ctx.user_id,
      detail: { reason: 'expired', form: ctx.form },
    });
    throw e;
  }
  if (info && info.scope_project_ids[0] !== '*' && !info.scope_project_ids.includes(req.project_id)) {
    await storage.appendAudit({
      request_id, action: 'l0_auth_fail', ts: now, project_id: req.project_id, user_id: info.user_id,
      detail: { reason: 'no_grant', form: ctx.form, grant_id: info.grant_id },
    });
    return { rows: maskedRows(), l0_masked: true, audit: { request_id, action: 'l0_auth_fail' } };
  }

  // 已授权才取信封：行上的旧数据直接用，拆库后的行从 L0 原数据库取（有批量口就一次取完）
  const envelope = new Map<string, string>();
  for (const m of mems) if (m.content_l0_enc) envelope.set(m.mem_id, m.content_l0_enc);
  const need = claims.filter((id) => !envelope.has(id));
  if (need.length && ctx.l0Blobs) {
    if (ctx.l0Blobs.getAll) {
      for (const [id, env] of await ctx.l0Blobs.getAll(need)) envelope.set(id, env);
    } else {
      for (const id of need) {
        const blob = await ctx.l0Blobs.get(id);
        if (blob) envelope.set(id, blob.envelope);
      }
    }
  }
  // 断链（行说有 L0、库里取不到）绝不静默当空正文：记审计 + 显式报错（批次37）
  const missing = claims.filter((id) => !envelope.has(id));
  if (missing.length) {
    await storage.appendAudit({
      request_id, action: 'l0_auth_fail', ts: now, project_id: req.project_id, user_id: info?.user_id ?? ctx.user_id,
      detail: { reason: 'missing_blob', count: missing.length, mem_ids: missing.slice(0, 5), form: ctx.form },
    });
    throw new MemAgentError(
      'E_L0_MISSING_BLOB',
      `L0 原数据库取不到 ${missing.length} 条信封（记忆库行上带 has_l0）：绝不当作空正文返回`,
      { request_id, count: missing.length, mem_ids: missing.slice(0, 5) },
    );
  }

  const ids = [...envelope.keys()];
  const plain = new Map<string, string>();
  try {
    for (const mem_id of ids) {
      plain.set(mem_id, await ctx.l0.decrypt({
        l0_session_id: sessionId, project_id: req.project_id, mem_id, envelope: envelope.get(mem_id)!,
      }));
    }
  } catch (e) {
    const code = e instanceof MemAgentError ? e.code : 'E_AUTH_L0';
    await storage.appendAudit({
      request_id, action: 'l0_auth_fail', ts: now, project_id: req.project_id, user_id: info?.user_id ?? ctx.user_id,
      detail: {
        reason: code === 'E_L0_EXPIRED' ? 'expired' : 'decrypt_failed',
        count: ids.length, form: ctx.form, grant_id: info?.grant_id,
      },
    });
    throw e;
  }

  await storage.appendAudit({
    request_id, action: 'l0_view', ts: now, project_id: req.project_id, user_id: info?.user_id ?? ctx.user_id,
    detail: {
      grant_id: info?.grant_id, project_id: req.project_id,
      mem_ids: ids, form: ctx.form,
    },
  });
  const rows: BrowseRow[] = mems.map((m) => ({
    mem_id: m.mem_id,
    content: envelope.has(m.mem_id) ? (plain.get(m.mem_id) ?? '') : '',
  }));
  return { rows, l0_masked: false, audit: { request_id, action: 'l0_view' } };
}

// ─── coreGc ────────────────────────────────────────────────────────────────────

/**
 * gc（9.7/6.2）：单一衰减引擎 = forgetting.ts `classifyLayer`（17.7 规则）。
 * 半衰期解析统一为「显式 half_life_days 优先，否则 category policy」，
 * 由 classifyLayer → freshnessOf 内部完成；locked/pinned 豁免同源。
 * 同一时刻重复调用不会连续降档（时间未到 → 不推进）。
 */
export async function coreGc(
  req: GcReq,
  ctx: { storage: StorageBackend; request_id: string; now: number },
): Promise<GcReport> {
  const { storage, request_id, now } = ctx;
  const mems = await storage.listMemories({ project_id: req.project_id });
  let decayed = 0;
  for (const m of mems) {
    const next = classifyLayer(m, now);
    if (next && next !== m.decay_class) {
      await storage.putMemory({ ...m, decay_class: next, version: m.version + 1 });
      decayed++;
    }
  }
  const auditRef: AuditRef = { request_id, action: 'gc' };
  await storage.appendAudit({
    ...auditRef, ts: now, project_id: req.project_id,
    detail: { decayed, conflicts_resolved: 0 },
  });
  return { decayed, merged: 0, conflicts_resolved: 0, request_id, audit: auditRef };
}

// ─── coreMemoryOp ──────────────────────────────────────────────────────────────

/**
 * 单记忆操作（17.3 / P4 调参迁移）：端壳状态变更唯一通道。
 * G4：locked 仅可 unlock；每次变更新增审计 memory_op（detail.op 归因）+ 版本推进（同步用）。
 */
export async function coreMemoryOp(
  mem_id: string,
  op: MemOp,
  ctx: { storage: StorageBackend; vector: VectorBackend; request_id: string; now: number },
  patch: MemOpPatch = {},
): Promise<MemOpResult> {
  const { storage, vector, request_id, now } = ctx;
  const m = await storage.getMemory(mem_id);
  if (!m) return { ok: false, mem: null, request_id };

  // G4：locked 豁免一切后台/手动操作，仅可解锁（17.7 迁移规则同源）
  if (m.locked && op !== 'unlock') {
    await storage.appendAudit({
      request_id, action: 'memory_op', ts: now, project_id: m.project_id,
      detail: { op, blocked: 'locked', mem_id },
    });
    return { ok: false, blocked_locked: true, mem: m, request_id };
  }

  const bump = (di: number, dc: number): Memory => ({
    ...m,
    importance: clamp((m.importance ?? 0.5) + di, CLAMP.importance),
    confidence: clamp((m.confidence ?? 0.5) + dc, CLAMP.confidence),
    reinforce_count: (m.reinforce_count ?? 0) + (di > 0 ? 1 : 0),
  });

  let next: Memory | null = m;
  switch (op) {
    case 'remember': next = bump(+0.2, +0.2); break;          // 强化：升权 + reinforce 分家（17.4）
    case 'forget': next = bump(-0.2, -0.2); break;            // 降权不删（17.3）
    case 'pin': next = { ...m, pinned: true }; break;
    case 'unpin': next = { ...m, pinned: false }; break;
    case 'lock': next = { ...m, locked: true }; break;
    case 'unlock': next = { ...m, locked: false }; break;
    case 'archive': next = { ...m, decay_class: 'archived' }; break;
    case 'restore': next = { ...m, decay_class: 'hot' }; break; // 恢复即回温（15.3）
    case 'param': {                                            // P4 调参：内核钳制兜底
      next = {
        ...m,
        importance: patch.importance !== undefined ? clamp(patch.importance, CLAMP.importance) : m.importance,
        confidence: patch.confidence !== undefined ? clamp(patch.confidence, CLAMP.confidence) : m.confidence,
        half_life_days: patch.half_life_days !== undefined ? Math.max(1, patch.half_life_days) : m.half_life_days,
        pinned: patch.pinned ?? m.pinned,
        locked: patch.locked ?? m.locked,
      };
      break;
    }
    case 'migrate':                                            // P4 层迁移：目标温度由端壳六态映射
      next = { ...m, decay_class: patch.decay_class ?? m.decay_class };
      break;
    case 'delete': {                                           // 删除墓碑（D2）：清正文 + 待同步，删除可跨端传播
      const tombstone: Memory = {
        ...m,
        content: '',
        content_orig: undefined,
        content_l0_enc: undefined,
        // 批次37：墓碑同样清掉 L0——标了 has_l0 会让 FileStorage 把密文留在 L0 库里，
        // 与批次36「删除即销毁 L0 正文」的语义不一致（删掉的原始对话不该还能解出来）。
        has_l0: undefined,
        content_l1: undefined,
        content_l2: undefined,
        content_l3: undefined,
        content_l4: undefined,
        content_l5: undefined,
        content_l6: undefined,
        embedding: undefined,
        sha256: undefined,
        deleted: true,
        deleted_at: now,
        pending_sync: true,
        version: m.version + 1,
        updated_at: now,
      };
      await storage.putMemory(tombstone);
      await vector.remove(mem_id);
      await storage.appendAudit({
        request_id, action: 'memory_op', ts: now, project_id: m.project_id,
        detail: { op, deleted: true, mem_id, tombstone: true },
      });
      return { ok: true, mem: null, request_id };
    }
  }

  if (next) {
    next = { ...next, version: m.version + 1, updated_at: now };
    await storage.putMemory(next);
  }
  await storage.appendAudit({
    request_id, action: 'memory_op', ts: now, project_id: m.project_id,
    detail: { op, mem_id, importance: next?.importance, confidence: next?.confidence, decay_class: next?.decay_class },
  });
  return { ok: true, mem: next, request_id };
}

// ─── coreFeedback ──────────────────────────────────────────────────────────────

/**
 * 用户反馈（17.4 trust_delta，P9 提交入口）：
 * confirm confidence +0.1（reinforce_count 分家计数）；
 * reject confidence −0.05（下限钳制 0.05）；disputed 不动分，挂 9.7 裁决（conflict_id）。
 */
export async function coreFeedback(
  mem_id: string,
  kind: FeedbackKind,
  ctx: { storage: StorageBackend; request_id: string; now: number },
): Promise<FeedbackResult> {
  const { storage, request_id, now } = ctx;
  const m = await storage.getMemory(mem_id);
  if (!m) return { ok: false, mem: null, trust_delta: 0, request_id };

  let delta = 0;
  let next: Memory = m;
  if (kind === 'confirm') {
    delta = 0.1;
    next = {
      ...m,
      confidence: clamp((m.confidence ?? 0.5) + delta, CLAMP.confidence),
      reinforce_count: (m.reinforce_count ?? 0) + 1, // 用户确认与召回命中分家（17.4）
    };
  } else if (kind === 'reject') {
    delta = -0.05;
    next = { ...m, confidence: clamp((m.confidence ?? 0.5) + delta, CLAMP.confidence) };
  } else {
    // disputed：转人工（P7 冲突裁决队列），trust 分不动
    next = { ...m, conflict_id: m.conflict_id ?? `cf_${request_id.slice(-8)}` };
  }
  next = { ...next, version: m.version + 1, updated_at: now };
  await storage.putMemory(next);
  await storage.appendAudit({
    request_id, action: 'memory_op', ts: now, project_id: m.project_id,
    detail: { op: kind, trust_delta: delta, mem_id, confidence: next.confidence },
  });
  return { ok: true, mem: next, trust_delta: delta, request_id };
}
