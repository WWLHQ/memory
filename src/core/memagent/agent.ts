// createMemAgent（§1 入口）：内核装配 + 9 核心API + 全动作审计（§3.2）
import { MemAgentError } from './errors.ts';
import { routeProxy } from './llm.ts';
import { coreBrowse, coreFeedback, coreGc, coreMemoryOp, coreWrite } from './memories.ts';
import { hardFilter, scoreMemory } from './forgetting.ts';
import {
  BACKGROUND_MAX_TOKENS, computeRecallSavings, estTokens, selectRecallBackground,
} from './recallInsight.ts';
import { cosine, embedSync, DEFAULT_VECTOR_DIM } from './vector.ts';
import type { L0BlobStore } from './l0Store.ts';
import { ulid } from './ulid.ts';
import type {
  AuditRecord, BrowseResult, DiscoverReq, DiscoverResult, DiscoverSignal, FeedbackKind, FeedbackResult, Form, GcReq, GcReport,
  Hit, L0AccessRequest, L0AccessRequestResult, L0AdminPort, L0GrantReq, L0GrantResult, L0GrantView, L0HeartbeatResult,
  L0MigrationResult, L0RequestView, L0UnlockReq, L0UnlockResult, L0VaultStatus,
  LogItem, LogPage, LogReq, MemAgent, MemAgentOptions, MemAgentSeedHooks, MemOp, MemOpPatch, MemOpResult, MemReq, Memory, Pref, RecallReq,
  RecallResult, SyncReq, SyncReport, WriteResult,
} from './types.ts';

/** form 能力矩阵（19.9 R⑥ / 19.10）：proc 信号仅本地端可用 */
const SIGNAL_CAPABILITY: Record<DiscoverSignal, Form[]> = {
  mcp: ['desktop', 'web', 'mobile', 'mac', 'linux', 'cli'],
  proc: ['desktop', 'mac', 'linux', 'cli'],   // web/mobile 不渲染"扫本机进程"
  hb: ['desktop', 'web', 'mobile', 'mac', 'linux', 'cli'],
  manual: ['desktop', 'web', 'mobile', 'mac', 'linux', 'cli'],
};

/** 召回预算（2.4.1）：soft 1500 / warn 2000 / hard 3000 */
const BUDGET = { soft: 1500, warn: 2000, hard: 3000 } as const;

export function createMemAgent(opts: MemAgentOptions): MemAgent & MemAgentSeedHooks {
  const { form, account, llm, vector, storage } = opts;
  let usedToday = 0; // 反代理当日花费（19.8 cost_cap）

  function newRequestId(): string {
    return `req_${ulid()}`;
  }

  /** 单记忆操作（17.3/P4）：locked 约束 + 钳制 + 版本 + 审计，端壳状态变更唯一通道 */
  async function memoryOp(mem_id: string, op: MemOp, patch?: MemOpPatch): Promise<MemOpResult> {
    return coreMemoryOp(mem_id, op, { storage, vector, request_id: newRequestId(), now: Date.now() }, patch);
  }

  /** 用户反馈（17.4）：trust_delta 内核计算（confirm +0.1 / reject −0.05 / disputed 挂裁决） */
  async function feedback(mem_id: string, kind: FeedbackKind): Promise<FeedbackResult> {
    return coreFeedback(mem_id, kind, { storage, request_id: newRequestId(), now: Date.now() });
  }

  async function audit(
    request_id: string, action: AuditRecord['action'], detail: Record<string, unknown>,
    extra: { agent?: string; project_id?: string; user_id?: string } = {},
  ): Promise<void> {
    await storage.appendAudit({
      request_id, action, form, agent: extra.agent, project_id: extra.project_id,
      user_id: extra.user_id, ts: Date.now(), detail,
    });
  }

  async function recall(req: RecallReq): Promise<RecallResult> {
    const request_id = newRequestId();
    const now = Date.now();
    const topK = req.top_k ?? 5;
    if (topK < 1 || topK > 10) throw new MemAgentError('E_VECTOR', 'top_k 须在 1–10');
    // 16.5：critical 禁 minimal（模式分流红线）
    const scene = req.scene ?? 'default';
    let mode = req.mode ?? null;
    if (scene === 'critical' && mode === 'minimal') {
      mode = 'fact_first'; // 禁 minimal → 降为事实优先
    }
    const [qvec] = await vector.embed([req.query]);
    const all = await storage.listMemories({ project_id: req.project_id });
    const minimal = mode === 'minimal';

    // 17.8 第一层：硬过滤（pinned 免检直进候选；默认只扫 Hot/Warm，AC-11）
    const candidates = all.filter((m) => hardFilter(m) && (!minimal || m.decay_class === 'hot' || m.decay_class === 'warm'));

    // 17.8 第二层：轻量打分（relevance=cosine × 17.5 四分量，pinned +0.15）
    const scored = candidates
      .map((m) => ({
        m,
        relevance: m.embedding ? cosine(qvec, m.embedding) : 0,
      }))
      .map(({ m, relevance }) => ({ m, relevance, score: scoreMemory(m, relevance, now) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    let hits: Hit[] = scored.map(({ m, score }) => ({
      mem_id: m.mem_id, content: m.content, layer: m.layer, decay_class: m.decay_class,
      pinned: m.pinned, locked: m.locked, score: Math.round(score * 1000) / 1000,
      evidence_ref: `l0:${m.mem_id}`,
    }));
    // 背景去重口径：topK + 冷回填已考虑过的记忆都不得再以「背景」身份注入（防止被裁命中借道回灌）
    const consideredIds = new Set(scored.map(({ m }) => m.mem_id));

    // 2.4.1/R9：超硬熔断 3000t → 按分数从低到高丢弃直到预算内。
    // 初始命中与冷回填后都必须走同一裁剪，payload_tokens 必须按最终 hits 重算。
    const applyHardCap = (list: Hit[]): { hits: Hit[]; payload: number } => {
      let payload = list.reduce((a, h) => a + estTokens(h.content), 0);
      if (payload <= BUDGET.hard) return { hits: list, payload };
      const drop = new Set<string>();
      for (const h of [...list].sort((a, b) => a.score - b.score)) {
        if (payload <= BUDGET.hard) break;
        payload -= estTokens(h.content);
        drop.add(h.mem_id);
      }
      const kept = list.filter((h) => !drop.has(h.mem_id));
      return { hits: kept, payload: kept.reduce((a, h) => a + estTokens(h.content), 0) };
    };
    // 省量口径：硬熔断前（topK）的 token 快照；冷回填后再累加
    let preCapTokens = hits.reduce((a, h) => a + estTokens(h.content), 0);
    let capped = applyHardCap(hits);
    hits = capped.hits;
    let payload_tokens = capped.payload;

    // 2.4.3 逃生阀：零命中/全低分 → 补查 cold（15.3：sim≥0.85 强信号放行）
    let evidence_thin: boolean | undefined;
    if (hits.every((h) => h.score < 0.3)) {
      evidence_thin = true;
      const backfill = all
        .filter((m) => !minimal && (m.decay_class === 'cold' || m.decay_class === 'archived' || m.decay_class === 'dormant') && m.embedding)
        .map((m) => ({ m, sim: cosine(qvec, m.embedding!) }))
        .filter(({ sim }) => sim >= 0.85)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);
      if (backfill.length > 0) {
        for (const { m, sim } of backfill) {
          hits.push({
            mem_id: m.mem_id, content: m.content, layer: m.layer, decay_class: m.decay_class,
            pinned: m.pinned, locked: m.locked, score: Math.round(scoreMemory(m, sim, now) * 1000) / 1000,
            evidence_ref: `l0:${m.mem_id}`,
          });
          consideredIds.add(m.mem_id);
        }
        preCapTokens += backfill.reduce((a, { m }) => a + estTokens(m.content), 0);
        // 补查也要守 3000t 硬熔断：回填后重算并按同一规则裁剪（否则逃生阀可击穿预算）
        capped = applyHardCap(hits);
        hits = capped.hits;
        payload_tokens = capped.payload;
      }
    }

    // 批次11：项目背景与省量（背景走硬熔断余量，payload + background 永不超过 3000t）
    const background = selectRecallBackground(all, consideredIds, {
      minimal,
      maxTokens: Math.min(BACKGROUND_MAX_TOKENS, Math.max(0, BUDGET.hard - payload_tokens)),
    });
    const savings = computeRecallSavings({ memories: all, hits, background, preCapTokens });

    // 17.4：召回命中计数（不含 confirm/reinforce）
    for (const h of hits) {
      const m = await storage.getMemory(h.mem_id);
      if (m) await storage.putMemory({ ...m, access_count: (m.access_count ?? 0) + 1, last_access_time: now });
    }

    const budgetStatus = payload_tokens >= BUDGET.hard ? 'fused' : payload_tokens >= BUDGET.warn ? 'warn' : 'ok';
    const result: RecallResult = {
      hits, payload_tokens, pipeline_llm_tokens: 0,
      budget: { ...BUDGET, status: budgetStatus },
      evidence_thin,
      mode: mode ?? 'auto',
      request_id,
      scanned_memories: all.length,
      background,
      savings,
    };
    // 阶段4-I / B8：把真实可采的监控字段写进审计 detail（监控页与审计页据此实算，历史缺字段的行不计入）。
    //  · evidence_thin：2.4.3 逃生阀的真实结果（undefined = 未触发，落 false，不拿「无字段」冒充 false 之外的语义）；
    //  · latency_ms：本次召回的真实墙钟耗时（业务侧，含 embed/扫描/打分/裁剪，不含审计写入本身）；
    //  · pipeline_llm_tokens：RecallResult 的诚实值（当前恒 0 —— 召回管线不调用 LLM，网关真实 usage 未接入）；
    //    监控页不得拿这些 0 算 p95 冒充「已接通」，见 useMonitorReal.ts 的未采集说明。
    const latency_ms = Date.now() - now;
    await audit(request_id, 'recall', {
      query: req.query, hits: hits.length, payload_tokens, scene, mode: result.mode,
      evidence_thin: evidence_thin ?? false,
      latency_ms,
      pipeline_llm_tokens: result.pipeline_llm_tokens,
      // 批次15：区分是哪个 Agent 真的调用了召回（未识别时不写，避免伪归属）
      ...(req.client ? { client: req.client } : {}),
      mems: hits.map((h) => h.mem_id),
      scanned_memories: all.length,
      background_tokens: background.tokens,
      bg_mems: background.items.map((i) => i.mem_id),
      corpus_tokens: savings.corpus_tokens,
      injected_tokens: savings.injected_tokens,
      saved_tokens: savings.saved_tokens,
      budget_trimmed_tokens: savings.budget_trimmed_tokens,
    }, { project_id: req.project_id, user_id: req.user_id });
    return result;
  }

  async function write(req: MemReq): Promise<WriteResult> {
    const request_id = newRequestId();
    // LLM 用途（write 精炼）走反代理路由（19.8）；选中模型但精炼未产出 → 回退本地语义。
    const pick = routeProxy(llm.listModels(), /* price_cap */ 0.01, /* cost_cap */ 2, usedToday);
    const r = await coreWrite(req, {
      storage, vector, account, request_id, now: Date.now(), llm, llmModel: pick.model ?? undefined,
      l0: opts.l0,
    });
    // 显式 stub = 本就没有真实 LLM，不属于"代理失败回退"，不写 llm_fallback 噪音。
    // 逐层管道下只有真的调用过 LLM 却没产出 L2+ 才算回退（L1 层直接嫁接/过滤不算）。
    const realLlm = llm.isStub !== true;
    const attemptedLlm = (r.layer_decisions ?? []).some((d) => d.by === 'llm');
    // Provider 未实现 refine/refineLayer → 管道在 L2 前 skipped（L1 直接嫁接不产生该决策）
    const llmUnavailable = (r.layer_decisions ?? []).some((d) => d.action === 'skipped');
    if (realLlm && pick.model && r.refined_by === 'llm') {
      usedToday += pick.cost;
      await audit(request_id, 'llm_proxy', {
        llm_proxy_source: pick.source, source: pick.source, model: pick.model, cost: pick.cost, mode: 'auto',
        reason: pick.reason, layers: Object.keys(r.layers ?? {}),
      });
    } else if (realLlm && pick.model && (attemptedLlm || llmUnavailable)) {
      await audit(request_id, 'llm_fallback', {
        llm_proxy_source: pick.source, source: pick.source, model: pick.model,
        reason: r.refine_error ?? (llmUnavailable && !attemptedLlm
          ? 'Provider 未实现 refine/refineLayer，无法生成 L2–L6'
          : 'LLM 未产出合规的 L2–L6，已回退已生成层'),
        code: 'E_LLM_FALLBACK', spec_violations: r.spec_violations ?? [],
      });
    } else if (realLlm && !pick.model && r.dedup.action !== 'filtered') {
      await audit(request_id, 'llm_fallback', {
        llm_proxy_source: pick.source, source: pick.source, reason: pick.reason, code: 'E_LLM_FALLBACK',
      });
    }
    return {
      ...r,
      layers: r.layers ? { ...r.layers } : undefined,
      audit: { request_id, action: 'write' as const },
    };
  }

  async function gc(req: GcReq): Promise<GcReport> {
    const request_id = newRequestId();
    return coreGc(req, { storage, request_id, now: Date.now() });
  }

  async function getPrefs(user_id: string): Promise<Pref[]> {
    // 19.4：user_id 级跨 Agent 偏好（contract 级从存储读 preference 类）
    const mems = await storage.listMemories({});
    return mems
      .filter((m) => m.category === 'preference' && m.user_id === user_id)
      .map((m) => ({ user_id, key: m.content.slice(0, 12), value: m.content }));
  }

  async function discover(req: DiscoverReq): Promise<DiscoverResult> {
    const request_id = newRequestId();
    const skipped: DiscoverSignal[] = [];
    const agents: DiscoverResult['agents'] = [];
    // 只绑定调用方真实扫到的候选；能力不支持的信号整段剔除（E_FORM_DISABLED 语义）
    for (const sig of req.signals) {
      if (!SIGNAL_CAPABILITY[sig].includes(req.form)) skipped.push(sig);
    }
    for (const f of req.found ?? []) {
      if (skipped.includes(f.signal) || !req.signals.includes(f.signal)) continue;
      agents.push({ name: f.name, signal: f.signal, bound: true });
    }
    for (const a of agents) {
      await audit(request_id, 'auto_bind', { agent: a.name, signal: a.signal, form: req.form }, { agent: a.name });
    }
    return { agents, skipped, audit: { request_id, action: 'auto_bind' } };
  }

  async function sync(req: SyncReq): Promise<SyncReport> {
    const request_id = newRequestId();
    // 诚实边界（阶段4-H）：**同步引擎已实现且有集成测试** —— sync.ts 的 SyncHub /
    // syncUp / syncDown / reconcile，以及 pgSyncHub.ts 的 Postgres 中枢落地；
    // 但它们**尚未接入内核 API 与桌面主进程**（MemAgent 无 hub 注入口、主进程零调用方）。
    // 因此本 API 如实报「未接入」，绝不拿本地条数或内存中枢伪造 pushed/pulled 云端同步成功。
    await audit(request_id, 'sync', {
      direction: req.direction, project_id: req.project_id,
      implemented: false, reason: 'sync engine implemented but not wired into kernel API / desktop main process',
    });
    throw new MemAgentError('E_NOT_IMPLEMENTED', '云端同步未接入内核 API：同步引擎已实现，但本版本未装配同步中枢（§REQ-008）', {
      direction: req.direction, project_id: req.project_id, request_id,
    });
  }

  async function browse(req: Parameters<MemAgent['browse']>[0]): Promise<BrowseResult> {
    const request_id = newRequestId();
    // L0 只认连续会话（coreBrowse 内校验 + 审计），DEK 由端壳主进程持有
    return coreBrowse(req, {
      storage, request_id, now: Date.now(), l0: opts.l0, user_id: account.user_id, form,
      // 批次37：拆库后行上只有 has_l0，信封在 L0 原数据库；存储后端自带优先，其次显式注入
      l0Blobs: opts.l0Blobs ?? (storage as { l0Store?: L0BlobStore }).l0Store,
    });
  }

  async function logs(req: LogReq): Promise<LogPage> {
    const request_id = newRequestId();
    const audits = await storage.queryAudit({
      action: req.action as AuditRecord['action'], since: req.since,
    });
    let items: LogItem[] = audits.map((a) => {
      // 异常特指：熔断 OPEN、同步失败、反代理额度超限、L0 解密失败、向量后端报错（§4.2）
      const abnormal =
        String(a.detail.reason ?? '').includes('回退本地') ||
        String(a.detail.reason ?? '').includes('封顶') ||
        (a.action === 'sync' && a.detail.conflicts) ||
        a.action === 'llm_fallback';
      return {
        ts: a.ts, level: abnormal ? 'error' : 'info', form: a.form ?? form,
        action: a.action, agent: a.agent, request_id: a.request_id,
        message: JSON.stringify(a.detail).slice(0, 120), ref_audit: a.request_id,
      };
    });
    if (req.level) items = items.filter((i) => i.level === req.level);
    if (req.form) items = items.filter((i) => i.form === req.form);
    items.sort((a, b) => (a.level === 'error' ? -1 : 1) - (b.level === 'error' ? -1 : 1) || b.ts - a.ts); // error 置顶
    const limit = req.limit ?? 50;
    const cursor = req.cursor ? Number(req.cursor) : 0;
    const page = items.slice(cursor, cursor + limit);
    const result: LogPage = { items: page, next_cursor: cursor + limit < items.length ? String(cursor + limit) : undefined };
    await audit(request_id, 'log_view', { count: page.length, level: req.level ?? 'all' });
    return result;
  }

  async function unbind(agent: string): Promise<void> {
    const request_id = newRequestId();
    await audit(request_id, 'unbound', { agent, form }, { agent });
  }

  /** 种子写入的 L0 加密：必须注入 L0Port（测试假实现），绝不接受明文密码 */
  async function sealL0ForSeed(plain: string): Promise<string> {
    if (!opts.l0) {
      throw new MemAgentError('E_L0_LOCKED', 'L0 写密钥未接入：无法加密种子记忆（需注入 L0Port，§4.4.4）');
    }
    return opts.l0.seal(plain);
  }

  async function seedMemory(
    m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'> & { l0?: boolean },
  ): Promise<Memory> {
    // L0：仅在显式 l0=true 且注入 L0Port 时加密（v2）；绝不接受明文密码
    const l0Enc = m.content_l0_enc ?? (m.l0 ? await sealL0ForSeed(m.content) : undefined);
    const mem: Memory = {
      mem_id: m.mem_id ?? `mem_${ulid()}`,
      project_id: m.project_id,
      user_id: m.user_id,
      enterprise_id: account.enterprise_id,
      team_id: account.team_id,
      category: m.category,
      layer: m.layer ?? 'L2',
      content_l0_enc: l0Enc,
      content: m.content,
      decay_class: m.decay_class ?? 'hot',
      pinned: m.pinned ?? false,
      locked: m.locked ?? false,
      conflict_id: m.conflict_id,
      half_life_days: m.half_life_days,
      last_access_time: m.last_access_time,
      version: m.version ?? 1,
      created_by_agent: m.created_by_agent,
      created_at: m.created_at ?? Date.now(),
    };
    mem.embedding = embedSync(m.content, vector.dim ?? DEFAULT_VECTOR_DIM);
    await storage.putMemory(mem);
    await vector.upsert(mem.mem_id, m.content, { project_id: m.project_id, layer: mem.layer });
    return mem;
  }

  // ─── L0 授权与会话（§4.4）：桌面壳经 kernel.hostL0Ports() 真注入 HostL0Admin（主进程 L0Vault IPC）；
  //      仅当纯浏览器 / 测试未提供端口时才 E_NOT_IMPLEMENTED —— 这是诚实降级，不是功能缺失。 ───
  function l0Admin(): L0AdminPort {
    if (!opts.l0Admin) {
      throw new MemAgentError('E_NOT_IMPLEMENTED', 'L0 授权端口未注入：桌面壳由主进程 L0Vault 提供，纯浏览器不提供（§4.4）');
    }
    return opts.l0Admin;
  }

  async function l0RequestAccess(req: L0AccessRequest): Promise<L0AccessRequestResult> {
    return l0Admin().requestAccess({ ...req, user_id: account.user_id });
  }
  async function l0ListRequests(): Promise<L0RequestView[]> {
    return l0Admin().listRequests();
  }
  async function l0ListGrants(): Promise<L0GrantView[]> {
    return l0Admin().listGrants();
  }
  async function l0GrantAccess(req: L0GrantReq): Promise<L0GrantResult> {
    return l0Admin().grantAccess({ ...req, admin_user_id: account.user_id });
  }
  async function l0DenyRequest(request_id: string, reason?: string): Promise<void> {
    return l0Admin().denyRequest({ request_id, admin_user_id: account.user_id, reason });
  }
  async function l0RevokeGrant(grant_id: string, reason?: string): Promise<void> {
    return l0Admin().revokeGrant({ grant_id, admin_user_id: account.user_id, reason });
  }
  async function l0Unlock(req: L0UnlockReq): Promise<L0UnlockResult> {
    return l0Admin().unlock({ ...req, user_id: account.user_id });
  }
  async function l0Heartbeat(l0_session_id: string): Promise<L0HeartbeatResult> {
    return l0Admin().heartbeat(l0_session_id);
  }
  async function l0Lock(l0_session_id: string): Promise<void> {
    return l0Admin().lock(l0_session_id);
  }
  async function l0UnlockWrite(password: string): Promise<void> {
    return l0Admin().unlockWrite({ password, admin_user_id: account.user_id });
  }
  async function l0LockWrite(): Promise<void> {
    return l0Admin().lockWrite({ admin_user_id: account.user_id });
  }
  async function l0Status(): Promise<L0VaultStatus> {
    return l0Admin().status();
  }
  async function l0SetupAdminPassword(password: string): Promise<void> {
    return l0Admin().setupAdminPassword(password, account.user_id);
  }
  async function l0ChangeAdminPassword(oldPassword: string, newPassword: string): Promise<void> {
    return l0Admin().changeAdminPassword(oldPassword, newPassword, account.user_id);
  }
  async function l0Migrate(oldPassword?: string): Promise<L0MigrationResult> {
    return l0Admin().migrate({ admin_user_id: account.user_id, oldPassword });
  }

  return {
    recall, write, gc, getPrefs, discover, sync, browse, logs, unbind,
    l0RequestAccess, l0ListRequests, l0ListGrants, l0GrantAccess, l0DenyRequest, l0RevokeGrant,
    l0Unlock, l0Heartbeat, l0Lock, l0UnlockWrite, l0LockWrite, l0Status,
    l0SetupAdminPassword, l0ChangeAdminPassword, l0Migrate,
    // 测试专用钩子（批次27 P3-1：已移出公开 MemAgent 接口）—— 仅测试灌数，页面代码不得调用
    _seedMemory: seedMemory, _memoryOp: memoryOp, _feedback: feedback,
  };
}
