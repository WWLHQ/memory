// createMemAgent（§1 入口）：内核装配 + 9 核心API + 全动作审计（§3.2）
import { MemAgentError } from './errors.ts';
import { routeProxy } from './llm.ts';
import { coreBrowse, coreGc, coreWrite } from './memories.ts';
import { hardFilter, scoreMemory } from './forgetting.ts';
import { cosine, embedSync } from './vector.ts';
import { ulid } from './ulid.ts';
import type {
  AuditRecord, BrowseResult, DiscoverReq, DiscoverResult, DiscoverSignal, Form, GcReq, GcReport,
  Hit, LogItem, LogPage, LogReq, MemAgent, MemAgentOptions, MemReq, Memory, Pref, RecallReq,
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

/** 粗略 token 估算（契约级演示：≈ chars/2） */
const estTokens = (s: string) => Math.ceil(s.length / 2);

export function createMemAgent(opts: MemAgentOptions): MemAgent {
  const { form, account, llm, vector, storage } = opts;
  let usedToday = 0; // 反代理当日花费（19.8 cost_cap）

  function newRequestId(): string {
    return `req_${ulid()}`;
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

    let payload_tokens = hits.reduce((a, h) => a + estTokens(h.content), 0);
    // 2.4.1/R9：超硬熔断 3000t → 按分数从低到高丢弃直到预算内
    if (payload_tokens > BUDGET.hard) {
      const sorted = [...hits].sort((a, b) => a.score - b.score);
      let pt = payload_tokens;
      const drop = new Set<string>();
      for (const h of sorted) {
        if (pt <= BUDGET.hard) break;
        pt -= estTokens(h.content);
        drop.add(h.mem_id);
      }
      hits = hits.filter((h) => !drop.has(h.mem_id));
      payload_tokens = hits.reduce((a, h) => a + estTokens(h.content), 0);
    }

    // 2.4.3 逃生阀：零命中/全低分 → 补查 cold（15.3：sim≥0.85 强信号放行）
    let evidence_thin: boolean | undefined;
    if (hits.length === 0 || hits.every((h) => h.score < 0.3)) {
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
        }
      }
    }

    // 17.4：召回命中计数（不含 confirm/reinforce）
    for (const h of hits) {
      const m = await storage.getMemory(h.mem_id);
      if (m) await storage.putMemory({ ...m, access_count: (m.access_count ?? 0) + 1, last_access_time: now });
    }

    const budgetStatus = payload_tokens >= BUDGET.hard ? 'fused' : payload_tokens >= BUDGET.warn ? 'warn' : 'ok';
    const result: RecallResult = {
      hits, payload_tokens, pipeline_llm_tokens: 0,
      budget: { soft: 1500, warn: 2000, hard: 3000, status: budgetStatus },
      evidence_thin,
      mode: mode ?? 'auto',
      request_id,
    };
    await audit(request_id, 'recall', {
      query: req.query, hits: hits.length, payload_tokens, scene, mode: result.mode,
    }, { project_id: req.project_id, user_id: req.user_id });
    return result;
  }

  async function write(req: MemReq): Promise<WriteResult> {
    const request_id = newRequestId();
    // LLM 用途（write 抽取）走反代理路由（19.8），失败回退本地 → E_LLM_FALLBACK 语义
    const pick = routeProxy(llm.listModels(), /* price_cap */ 0.01, /* cost_cap */ 2, usedToday);
    if (pick.model) {
      await llm.call(pick.model, req.content, { request_id, usage: 'write' });
      usedToday += pick.cost;
      await audit(request_id, 'llm_proxy', { source: pick.source, cost: pick.cost, mode: 'auto', reason: pick.reason });
    } else {
      await audit(request_id, 'llm_fallback', { source: pick.source, reason: pick.reason, code: 'E_LLM_FALLBACK' });
    }
    const r = await coreWrite(req, { storage, vector, account, request_id, now: Date.now() });
    return { ...r, audit: { request_id, action: 'write' } };
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
    for (const sig of req.signals) {
      if (!SIGNAL_CAPABILITY[sig].includes(req.form)) {
        skipped.push(sig); // E_FORM_DISABLED 语义：能力自动剔除
        continue;
      }
      agents.push({ name: `agent-${sig}-${agents.length + 1}`, signal: sig, bound: true });
    }
    for (const a of agents) {
      await audit(request_id, 'auto_bind', { agent: a.name, signal: a.signal, form: req.form }, { agent: a.name });
    }
    return { agents, skipped, audit: { request_id, action: 'auto_bind' } };
  }

  async function sync(req: SyncReq): Promise<SyncReport> {
    const request_id = newRequestId();
    const mems = await storage.listMemories({ project_id: req.project_id });
    const conflicts = mems.filter((m) => m.conflict_id).length;
    if (conflicts > 0) {
      // 版本冲突待裁决 → 进 9.7 裁决队列（P8）
      throw new MemAgentError('E_SYNC_CONFLICT', '版本冲突待裁决', { conflicts, project_id: req.project_id });
    }
    const report: SyncReport = {
      pushed: req.direction === 'push' ? mems.length : 0,
      pulled: req.direction === 'pull' ? mems.length : 0,
      conflicts: 0, request_id, audit: { request_id, action: 'sync' },
    };
    await audit(request_id, 'sync', { ...report, direction: req.direction });
    return report;
  }

  async function browse(req: Parameters<MemAgent['browse']>[0]): Promise<BrowseResult> {
    const request_id = newRequestId();
    // 契约级演示：账号视为管理员（真实实现由端壳鉴权注入）
    return coreBrowse(req, { storage, accountAdmin: true, request_id, now: Date.now() });
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

  async function seedMemory(m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'>): Promise<Memory> {
    const mem: Memory = {
      mem_id: m.mem_id ?? `mem_${ulid()}`,
      project_id: m.project_id,
      user_id: m.user_id,
      enterprise_id: account.enterprise_id,
      team_id: account.team_id,
      category: m.category,
      layer: m.layer ?? 'L2',
      content_l0_enc: m.content_l0_enc ?? `ENC(${m.content.slice(0, 32)})`,
      content: m.content,
      decay_class: m.decay_class ?? 'hot',
      pinned: m.pinned ?? false,
      locked: m.locked ?? false,
      conflict_id: m.conflict_id,
      version: m.version ?? 1,
      created_by_agent: m.created_by_agent,
      created_at: Date.now(),
    };
    mem.embedding = embedSync(m.content);
    await storage.putMemory(mem);
    await vector.upsert(mem.mem_id, m.content, { project_id: m.project_id, layer: mem.layer });
    return mem;
  }

  return { recall, write, gc, getPrefs, discover, sync, browse, logs, unbind, _seedMemory: seedMemory };
}
