// 内联标识演示页（REQ-004 / T10）· 真实数据接真层
// 设计约定（与记忆库管理页 / 自我净化与生长页一致）：
//   数据真相 = 内核账本（桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级 = 内存态，
//   未写入过即空账本 → 诚实空态，绝不伪造数据）。
//
// 「所有接入的 agent 使用同一个记忆库，不区分来源」口径（19.4 跨 Agent 共享）：
//   · 已接入 agent 列表 = 接入页持久化状态（agentOnboardState）∪ 本机检测扩展卡 ∪ 账本 created_by_agent，去重后呈现；
//   · 记忆库统一且不区分来源：各 agent 的记忆都写入同一主进程持久账本，
//     调用记忆都从这一份账本读 —— 不按 created_by_agent / source_agent 过滤展示，
//     账本里所有真实记忆对所有已接入 agent 一视同仁（统一召回池）；
//   · 无 agent / 账本为空 → 诚实空态，绝不硬编码演示数据。
import type { Memory, AuditRecord } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { estTokens } from '../../core/memagent/recallInsight.ts';
import { getKernelStorage } from '../kernel.ts';
import type {
  AgingWarnMark,
  BackgroundMark,
  MemoryInjectionMark,
  TokenSaving,
  WriteBackMark,
} from '../../types/inlineAttribution.ts';

export type RealStorage = Pick<StorageBackend, 'listMemories' | 'queryAudit'>;

function getRealStorage(): RealStorage {
  // 全站同一份账本（桌面 = 主进程持久库；浏览器 = 进程内单例）。
  return getKernelStorage();
}

/* ---------- 已接入 agent 列表（统一口径：接入页持久化 ∪ 本机检测 ∪ 账本 created_by_agent） ---------- */

export interface ConnectedAgent {
  name: string;
  badge: 'p0' | 'p1' | 'p2' | 'p3';
  label: string;
  source: 'onboard' | 'detected' | 'ledger';
}

/** 内置 agent 显示名映射（账本 created_by_agent / 采集源内部标识 → 展示名，内联标识页只显示 agent 名不显示内部代号）
 *  · collector:X 前缀 = 周期采集器写入（X 为采集源名）
 *  · manual:X 前缀 = 手动写入页写入（X 为操作用户名，不是 agent）
 *  · 未知值（agent-MCP-N / agent-proc-N / agent-hb-N 等旧版演示代号）→ 丢弃，不进已接入 agent 列表 */
const AGENT_DISPLAY_NAMES: Record<string, { name: string; badge: ConnectedAgent['badge']; label: string }> = {
  'claude-code': { name: 'Claude Code', badge: 'p1', label: 'MVP·P1' },
  'workbuddy': { name: 'WorkBuddy', badge: 'p0', label: '自有·P0' },
  'deepseek-harness': { name: 'DeepSeek Harness', badge: 'p0', label: '自有·P0' },
  'codex': { name: 'Codex', badge: 'p2', label: '兜底·P2' },
};

/** 账本 created_by_agent 归一：collector:claude-code → claude-code；未知值返回 null（丢弃） */
function normalizeLedgerAgent(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let lower = v.toLowerCase();
  // 旧版演示代号（agent-MCP-1 / agent-proc-2 / agent-hb-3 等）不是真实 agent → 丢弃
  if (/^agent-(mcp|proc|hb|web|api)-\d*$/.test(lower)) return null;
  // manual:X = 手动写入操作用户，不是 agent 来源 → 丢弃
  if (lower.startsWith('manual:')) return null;
  // collector:X → 取 X
  if (lower.startsWith('collector:')) lower = lower.slice('collector:'.length);
  return AGENT_DISPLAY_NAMES[lower] ? lower : null;
}

function withDisplayName(a: ConnectedAgent): ConnectedAgent {
  const m = AGENT_DISPLAY_NAMES[a.name.toLowerCase()];
  if (!m) return a;
  return { ...a, name: m.name, badge: m.badge, label: m.label };
}

/** 从账本 created_by_agent 字段收集出现过的 agent（真实写入过记忆的 agent；采集源内部代号归一为展示名，未知/演示值丢弃） */
function agentsFromLedger(mems: Memory[]): ConnectedAgent[] {
  const seen = new Map<string, ConnectedAgent>();
  for (const m of mems) {
    const raw = m.created_by_agent;
    if (!raw || seen.has(raw)) continue;
    const norm = normalizeLedgerAgent(raw);
    if (!norm) continue; // 未知值 / 演示代号 / manual 操作用户 → 不进已接入 agent 列表
    seen.set(norm, {
      name: norm,
      badge: 'p3',
      label: '扩展·P3',
      source: 'ledger',
    });
  }
  return [...seen.values()];
}

/** 读取接入页持久化的已接入 agent 名单（localStorage，跨 iframe 共享；旧版演示代号 agent-MCP-N/proc-N/hb-N 过滤掉） */
function agentsFromOnboard(): ConnectedAgent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('agentOnboardState');
    if (!raw) return [];
    const p = JSON.parse(raw) as { agentNames?: string[] };
    if (!Array.isArray(p?.agentNames)) return [];
    return p.agentNames
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .filter((n) => !/^agent-(mcp|proc|hb|web|api)-\d*$/i.test(n.trim())) // 旧版演示代号不是真实 agent
      .map((n): ConnectedAgent => {
        const known = AGENT_DISPLAY_NAMES[n.toLowerCase()];
        return known
          ? { name: known.name, badge: known.badge, label: known.label, source: 'onboard' }
          : { name: n, badge: 'p3', label: '扩展·P3', source: 'onboard' };
      });
  } catch {
    return [];
  }
}

/** 读取本机检测扩展卡（localStorage，「+ 新增接入卡片」的 agent 名；旧版演示代号过滤掉） */
function agentsFromDetected(): ConnectedAgent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('agentOnboardDetectedAgents');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => (typeof s === 'string' || typeof s?.name === 'string'))
      .map((s): ConnectedAgent | null => {
        const name = typeof s === 'string' ? s : s.name;
        // 旧版演示代号（agent-MCP-N / agent-proc-N / agent-hb-N）不是真实 agent → 丢弃
        if (typeof name !== 'string' || /^agent-(mcp|proc|hb|web|api)-\d*$/i.test(name.trim())) return null;
        return { name, badge: 'p3', label: '扩展·P3', source: 'detected' };
      })
      .filter((x): x is ConnectedAgent => x !== null);
  } catch {
    return [];
  }
}

/** 汇总所有已接入 agent（去重，name 大小写不敏感；口径优先级：onboard > detected > ledger；内部代号映射为显示名） */
export function collectConnectedAgents(mems: Memory[]): ConnectedAgent[] {
  const map = new Map<string, ConnectedAgent>();
  for (const list of [agentsFromOnboard(), agentsFromDetected(), agentsFromLedger(mems)]) {
    for (const a of list) {
      const norm = withDisplayName(a);
      // 去重键：显示名（'claude-code' 与 'Claude Code' 归一为同一 agent）
      const k = norm.name.toLowerCase();
      const prev = map.get(k);
      if (!prev) { map.set(k, norm); continue; }
      const prio: Record<ConnectedAgent['source'], number> = { onboard: 3, detected: 2, ledger: 1 };
      if (prio[norm.source] > prio[prev.source]) map.set(k, norm);
    }
  }
  return [...map.values()];
}

/* ---------- 记忆库统一且不区分来源：全部真实记忆对所有已接入 agent 开放（19.4 跨 Agent 共享） ---------- */

/** 所有已接入 agent 共享同一份账本，召回池 = 全部真实记忆（不按 agent 过滤） */
export function sharedMemories(mems: Memory[]): Memory[] {
  return mems;
}

/** 真实注入标记：从统一账本全部真实记忆生成（取最近 3 条有内容者，诚实口径；不区分来源 agent） */
export function injectionsFromMemories(mems: Memory[], n = 3): MemoryInjectionMark[] {
  const withContent = mems
    .filter((m) => m.content && m.content.trim().length > 0)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, n);
  return withContent.map((m) => ({
    memory_id: m.mem_id,
    summaryL2: truncate(m.content, 60),
    decay_class: m.decay_class === 'archived' ? 'cold' : m.decay_class,
    aging_hint: agingHintOf(m),
    request_id: `req_${m.mem_id.slice(0, 12)}`,
  }));
}

/** 真实老化提示（9.6）：按 created_at 计算距今天数；>45 天提示「代码可能已改动，请校验」 */
function agingHintOf(m: Memory): string {
  const days = Math.floor((Date.now() - (m.created_at ?? Date.now())) / 86_400_000);
  if (days > 45) return `${days} 天前记录，代码可能已改动，请校验（9.6 aging_hint）`;
  if (days > 7) return `${days} 天前创建，如未更新可能已过时（9.6）`;
  return '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 真实背景免重复标记：统一账本最近 8 条记忆的项目上下文（真实数据，不区分来源 agent，不伪造） */
export function backgroundFromMemories(mems: Memory[]): BackgroundMark {
  const items = mems.slice(0, 8).map((m) => ({
    id: m.mem_id,
    kind: m.category === 'decision' ? 'decision' as const
      : m.category === 'pitfall' ? 'pitfall' as const
      : m.category === 'preference' ? 'constraint' as const
      : 'stack' as const,
    text: truncate(m.content, 50),
  }));
  return { count: items.length, items };
}

/** 本地预算单位 t 的节省估算（与内核 estTokens 同口径，非 LLM tokenizer 的真实 token）：
 *  实际 = 注入摘要的预算单位；基线 = 同一批记忆全文的预算单位（按 memory_id 对照账本）。
 *  mems 缺省或无匹配全文 → 基线 = 实际（saved 0），绝不虚构倍数。
 *  阶段5-F：这是字符数换算的本地刻度，未接网关 usage，故不再自称「真实 token」。 */
export function tokenSavingFromMarks(injections: MemoryInjectionMark[], mems: Memory[] = []): TokenSaving {
  const actual = injections.reduce((s, m) => s + estTokens(m.summaryL2), 0);
  const injectedIds = new Set(injections.map((m) => m.memory_id));
  const full = mems
    .filter((m) => injectedIds.has(m.mem_id))
    .reduce((s, m) => s + estTokens(m.content), 0);
  const baseline = Math.max(actual, full);
  return {
    actual_payload: actual,
    full_baseline: baseline,
    saved: baseline - actual,
    breakdown: [
      { reason: '内联仅注入 L2 摘要（截断 60 字），非全文（2.4.3）', tokens: actual },
    ],
  };
}

/** 真实写入沉淀标记：统一账本最近一次 write 审计（不区分来源 agent；无则 null → 不展示，诚实） */
export function writeBackFromAudits(audits: AuditRecord[]): WriteBackMark | null {
  const writes = audits
    .filter((a) => a.action === 'write')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 1);
  if (writes.length === 0) return null;
  const w = writes[0];
  const detail = w.detail as { mem_id?: string; content?: string };
  return {
    memory_id: detail.mem_id ?? w.request_id,
    request_id: w.request_id,
    summary: detail.content ? truncate(detail.content, 60) : '新结论（自动写入）',
  };
}

/** 真实老化/证据警示：基于注入记忆的 aging_hint / evidence_thin（无则空数组，诚实） */
export function agingWarnsFromMarks(marks: MemoryInjectionMark[]): AgingWarnMark[] {
  return marks
    .filter((m) => m.aging_hint || m.evidence_thin)
    .map((m) => ({
      kind: m.evidence_thin ? 'evidence_thin' as const : 'aging' as const,
      text: m.evidence_thin ? '证据不足：未命中权威来源，建议切事实优先重试（2.4.3）' : m.aging_hint,
      request_id: m.request_id,
    }));
}

/* ---------- 一次性加载（页面所有展示数字的唯一真相源） ---------- */

export interface RealInline {
  available: boolean;
  agents: ConnectedAgent[];
  memCount: number;
  /** 统一账本全部真实记忆（不区分来源 agent；所有已接入 agent 共享） */
  mems: Memory[];
  injections: MemoryInjectionMark[];
  background: BackgroundMark;
  tokenSaving: TokenSaving;
  writeBack: WriteBackMark | null;
  agingWarns: AgingWarnMark[];
}

// 真实账本实算标记（供构建产物核验）
export const INLINE_REAL_DATA_SOURCE = 'real-ledger';

/** 加载统一记忆库（不按 agent 过滤；agentName 参数保留仅用于兼容调用面，召回池始终是全部真实记忆） */
export async function loadRealInline(_agentName?: string | null): Promise<RealInline> {
  const storage = getRealStorage();
  const [allMems, audits] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({}),
  ]);
  // 记忆库统一且不区分来源：共享池 = 全部真实记忆（所有已接入 agent 一视同仁）
  const shared = sharedMemories(allMems);
  const injections = injectionsFromMemories(shared, 3);
  return {
    available: shared.length > 0,
    agents: collectConnectedAgents(allMems),
    memCount: allMems.length,
    mems: shared,
    injections,
    background: backgroundFromMemories(shared),
    tokenSaving: tokenSavingFromMarks(injections, shared),
    writeBack: writeBackFromAudits(audits),
    agingWarns: agingWarnsFromMarks(injections),
  };
}
