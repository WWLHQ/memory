// memagent-core 契约类型（REQ-007 §1/§2/§3/§5/§6 直译，19.10/19.11）
// 内核 = 唯一事实源；端壳只调用不实现业务（19.11 红线①）。

/** 端形态（19.10 端谱） */
export type Form = 'desktop' | 'web' | 'mobile' | 'mac' | 'linux' | 'cli';

/** 同步身份（18.2-A，全局注入禁手填） */
export interface Account {
  user_id: string;
  team_id: string;
  enterprise_id: string;
}

/** 精炼层（附录 A） */
export type Layer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

/** 衰减分层（17.7） */
export type DecayClass = 'hot' | 'warm' | 'cold' | 'archived' | 'dormant';

/** 记忆六类（17.6） */
export type Category = 'fact' | 'decision' | 'pitfall' | 'insight' | 'preference' | 'context';

/** 召回模式（16.5；null = 自动） */
export type RecallMode = 'top_insight' | 'fact_first' | 'event_replay' | 'pattern_reasoning' | 'minimal' | null;

/** 召回场景 */
export type Scene = 'task_start' | 'critical' | 'default';

/** 错误码（§6，各端统一处理） */
export type ErrorCode =
  | 'E_AUTH_L0'        // L0 未授权/密码错
  | 'E_BUDGET_FUSE'    // 召回预算硬熔断（3000t）
  | 'E_LLM_FALLBACK'   // 反代理超限，已回退本地
  | 'E_SYNC_CONFLICT'  // 版本冲突待裁决
  | 'E_FORM_DISABLED'  // 当前端能力不可用（19.9 R⑥）
  | 'E_QUOTA'          // 免费额度耗尽
  | 'E_VECTOR';        // 向量后端报错

/** ---------- 召回（§2.1 / 2.4） ---------- */
export interface RecallReq {
  query: string;
  top_k?: number;                 // 1–10，默认 5
  project_id: string;             // 必填（19.4 跨 Agent 共享锚）
  user_id?: string;               // 个人偏好才用（19.4 / 9.2）
  scene?: Scene;
  mode?: RecallMode;
}

export interface Hit {
  mem_id: string;
  content: string;                // 该层可读内容
  layer: Layer;
  decay_class: DecayClass;
  pinned: boolean;
  locked: boolean;
  score: number;                  // 相关度 0–1
  evidence_ref: string;           // 证据链接（原始对话引用）
}

export interface Budget {
  soft: 1500; warn: 2000; hard: 3000;
  status: 'ok' | 'warn' | 'fused';
}

export interface RecallResult {
  hits: Hit[];
  payload_tokens: number;         // 返回宿主 Agent 的 token（2.4.1）
  pipeline_llm_tokens: number;    // 召回链路自身 LLM 消耗（2.4.1）
  budget: Budget;
  evidence_thin?: boolean;        // 逃生阀（2.4.3）
  mode: Exclude<RecallMode, null> | 'auto';
  request_id: string;
}

/** ---------- 写入（§2.2 / 2.2 / 6.1） ---------- */
export interface MemReq {
  content: string;
  category: Category;
  project_id: string;
  user_id?: string;
  session_id?: string;
  source_agent?: string;
}

export interface WriteResult {
  mem_id: string;
  dedup: { action: 'new' | 'merged' | 'duplicated'; sim: number };
  audit: AuditRef;
}

/** ---------- 生命周期（9.7 / 6.2） ---------- */
export interface GcReq {
  project_id: string;
  /** 是否执行裁决（冲突 → 三模式） */
  resolve_conflicts?: boolean;
}

export interface GcReport {
  decayed: number;                // hot→warm→cold 推进条数
  merged: number;                 // 短路嫁接合并条数
  conflicts_resolved: number;
  request_id: string;
  audit: AuditRef;
}

/** ---------- 偏好（19.4） ---------- */
export interface Pref {
  user_id: string;
  key: string;
  value: string;
}

/** ---------- 一键接入（19.9） ---------- */
export type DiscoverSignal = 'mcp' | 'proc' | 'hb' | 'manual';

export interface DiscoverReq {
  form: Form;
  signals: DiscoverSignal[];
}

export interface DiscoveredAgent {
  name: string;
  signal: DiscoverSignal;
  bound: boolean;
}

export interface DiscoverResult {
  agents: DiscoveredAgent[];
  skipped: DiscoverSignal[];      // 因 form 能力被剔除的信号（E_FORM_DISABLED）
  audit: AuditRef;
}

/** ---------- 同步（19.11 / 5.1，REQ-008 详细设计） ---------- */
export interface SyncReq {
  direction: 'push' | 'pull';
  project_id: string;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  request_id: string;
  audit: AuditRef;
}

/** ---------- 查阅（§4.1） ---------- */
export interface BrowseReq {
  layer: Layer;
  project_id: string;
  session_id?: string;
  l0_auth?: { password: string };
}

export interface BrowseRow {
  mem_id: string;
  content: string;                // L0 未授权时为遮罩占位
}

export interface BrowseResult {
  rows: BrowseRow[];
  l0_masked: boolean;
  audit: AuditRef;
}

/** ---------- 日志（§4.2，日志页数据源） ---------- */
export interface LogReq {
  level?: 'info' | 'warn' | 'error';
  form?: Form;
  action?: string;
  since?: number;
  limit?: number;
  cursor?: string;
}

export interface LogItem {
  ts: number;
  level: 'info' | 'warn' | 'error';
  form: Form;
  action: string;
  agent?: string;
  request_id: string;
  message: string;
  ref_audit: string;
}

export interface LogPage {
  items: LogItem[];
  next_cursor?: string;
}

/** ---------- 审计（§3.2，全动作可查 4.3/18.2-E） ---------- */
export type AuditAction =
  | 'recall' | 'write' | 'gc' | 'auto_bind' | 'unbound' | 'sync'
  | 'llm_proxy' | 'llm_fallback' | 'log_view' | 'l0_view';

export interface AuditRef {
  request_id: string;
  action: AuditAction;
}

export interface AuditRecord extends AuditRef {
  agent?: string;
  form?: Form;
  project_id?: string;
  user_id?: string;
  ts: number;
  detail: Record<string, unknown>;
}

/** ---------- 记忆主表（§3.1） ---------- */
export interface Memory {
  mem_id: string;                 // ULID 主键
  project_id: string;
  user_id?: string;
  enterprise_id: string;
  team_id: string;
  category: Category;
  layer: Exclude<Layer, 'L0'>;    // 主内容所在精炼层（L0 为原始加密对话）
  content_l0_enc?: string;        // L0 原始加密对话（仅授权可查）
  content: string;                // 该层可读内容
  embedding?: number[];
  decay_class: DecayClass;
  pinned: boolean;
  locked: boolean;
  sim?: number;                   // 查重相似度（6.1）
  conflict_id?: string;           // 冲突（9.7）
  version: number;                // 同步用（REQ-008）
  created_by_agent?: string;
  created_at: number;
}

/** ---------- Provider 注入（§5） ---------- */
export interface ModelInfo {
  model: string;
  tier: 'free' | 'cheap' | 'paid';
  price: number;                  // ¥/千次
  quota: number;                  // 声明日额度
  used: number;
}

export interface LlmResp {
  text: string;
  tokens: number;
}

export interface LlmCallCtx {
  request_id: string;
  usage: string;                  // write/judge/rerank/growth
}

export interface LlmResp {
  text: string;
  tokens: number;
  /** 本次实际走的来源（审计 llm_proxy_source） */
  source: string;
  cost: number;
  fallback: boolean;
}

export interface LlmProvider {
  listModels(): ModelInfo[];
  /** 仅负责"这个 model 怎么调"；反代理路由由内核统一实现（19.8） */
  call(model: string, prompt: string, ctx: LlmCallCtx): Promise<{ text: string; tokens: number }>;
}

export interface Filter {
  project_id?: string;
  layer?: Layer;
  decay_class?: DecayClass;
}

export interface Scored {
  mem_id: string;
  score: number;
}

export interface VectorBackend {
  embed(texts: string[]): Promise<number[][]>;
  search(vec: number[], k: number, filter: Filter): Promise<Scored[]>;
  /** 索引维护（write 后建索引 / 删除时清理） */
  upsert(mem_id: string, text: string, filter: Filter): Promise<void>;
  remove(mem_id: string): Promise<void>;
}

export interface StorageBackend {
  /** 记忆主表 */
  putMemory(m: Memory): Promise<void>;
  getMemory(mem_id: string): Promise<Memory | null>;
  listMemories(filter: Filter): Promise<Memory[]>;
  deleteMemory(mem_id: string): Promise<void>;
  /** 审计（append-only） */
  appendAudit(a: AuditRecord): Promise<void>;
  queryAudit(filter: { request_id?: string; action?: AuditAction; since?: number }): Promise<AuditRecord[]>;
}

/** 内核装配参数（§1 入口） */
export interface MemAgentOptions {
  form: Form;
  account: Account;
  llm: LlmProvider;
  vector: VectorBackend;
  storage: StorageBackend;
}

/** createMemAgent 返回的核心 API 面（§2） */
export interface MemAgent {
  recall(req: RecallReq): Promise<RecallResult>;
  write(req: MemReq): Promise<WriteResult>;
  gc(req: GcReq): Promise<GcReport>;
  getPrefs(user_id: string): Promise<Pref[]>;
  discover(req: DiscoverReq): Promise<DiscoverResult>;
  sync(req: SyncReq): Promise<SyncReport>;
  browse(req: BrowseReq): Promise<BrowseResult>;
  logs(req: LogReq): Promise<LogPage>;
  unbind(agent: string): Promise<void>;
  /** 测试/演示辅助：灌入种子记忆 */
  _seedMemory(m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'>): Promise<Memory>;
}
