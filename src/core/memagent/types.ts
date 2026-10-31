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

/** 记忆六类（17.6）—— 运行时校验唯一真源 */
export const CATEGORIES = ['fact', 'decision', 'pitfall', 'insight', 'preference', 'context'] as const;
export type Category = (typeof CATEGORIES)[number];
export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/** 真实 LLM 精炼产物（§2.2）：L1 必有，L2–L6 可选；由 Provider 的结构化 refine 返回 */
export interface RefinedLayers {
  content_l1: string;
  content_l2?: string;
  content_l3?: string;
  content_l4?: string;
  content_l5?: string;
  content_l6?: string;
}

/** 召回模式（16.5；null = 自动） */
export type RecallMode = 'top_insight' | 'fact_first' | 'event_replay' | 'pattern_reasoning' | 'minimal' | null;

/** 召回场景 */
export type Scene = 'task_start' | 'critical' | 'default';

/** 错误码（§6，各端统一处理） */
export type ErrorCode =
  | 'E_AUTH_L0'        // L0 未授权/密码错/换账号/解密失败
  | 'E_L0_LOCKED'      // L0 写密钥未解锁（§4.4.4）
  | 'E_L0_NO_GRANT'    // 非管理员未申请/未获授权（§4.4）
  | 'E_L0_EXPIRED'     // 授权/连续会话已过期（5min 无操作、重启、锁屏、撤销）
  | 'E_CRYPTO'         // L0 加解密失败（环境缺 WebCrypto / 密文非法）
  | 'E_BUDGET_FUSE'    // 召回预算硬熔断（3000t）
  | 'E_LLM_FALLBACK'   // 反代理超限，已回退本地
  | 'E_SYNC_CONFLICT'  // 版本冲突待裁决
  | 'E_NOT_IMPLEMENTED'// 能力尚未接线（诚实报错，禁止伪造成功）
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
  /** 调用方标识（批次15）：MCP initialize.clientInfo 或 User-Agent 识别，落 recall 审计用于按 Agent 核验 */
  client?: string;
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

/** 召回携带的项目背景条目（批次11）：与命中去重，供聊天窗口展示项目上下文 */
export interface RecallBackgroundItem {
  mem_id: string;
  category: Category;
  content: string;
  tokens: number;
  pinned: boolean;
  created_at: number;
  truncated: boolean;
}

export interface RecallBackground {
  items: RecallBackgroundItem[];
  tokens: number;
  /** 参与背景筛选的记忆条数（已排除命中项与合并影子） */
  candidates: number;
}

/** 省量核算（批次11）：与「全量注入」基线对比，数字全部由真实账本算出 */
export interface RecallSavings {
  /** 项目全部可读记忆直接注入的 token 估算（基线） */
  corpus_tokens: number;
  /** 本次命中注入（= RecallResult.payload_tokens） */
  payload_tokens: number;
  /** 项目背景注入 */
  background_tokens: number;
  /** payload_tokens + background_tokens（永不超过硬熔断 3000t） */
  injected_tokens: number;
  /** 硬熔断（3000t）裁掉的 token */
  budget_trimmed_tokens: number;
  /** corpus_tokens − injected_tokens（≥0） */
  saved_tokens: number;
}

export interface RecallResult {
  hits: Hit[];
  payload_tokens: number;         // 返回宿主 Agent 的 token（2.4.1）
  pipeline_llm_tokens: number;    // 召回链路自身 LLM 消耗（2.4.1）
  budget: Budget;
  evidence_thin?: boolean;        // 逃生阀（2.4.3）
  mode: Exclude<RecallMode, null> | 'auto';
  request_id: string;
  /** 本次扫描的项目记忆总数（审计/提示口径） */
  scanned_memories: number;
  /** 与命中去重的项目背景（minimal 模式为空） */
  background: RecallBackground;
  /** 省量核算（真实账本口径） */
  savings: RecallSavings;
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
  dedup: {
    action: 'new' | 'grafted' | 'duplicated' | 'filtered';
    sim: number;
    /** 分支嫁接目标（action='grafted' 时必填） */
    graft_to?: string;
    /** 分支嫁接命中层（action='grafted' 时必填） */
    graft_layer?: Exclude<Layer, 'L0'>;
  };
  /** 实际生成的精炼层（§2.2）；未接入 LLM 时仅 content_l1 */
  layers?: Record<string, string>;
  /** 精炼来源（stub = 未接入 LLM，仅 L1） */
  refined_by?: 'stub' | 'llm' | 'llm_partial';
  /** 各层规格自检违规项（§16.1；空数组 = 全部合规） */
  spec_violations?: string[];
  /** LLM 精炼调用失败原因（已回退到已生成层；未失败则缺省） */
  refine_error?: string;
  /** 逐层决策（生成/校验/查重/嫁接），供审计与排查 */
  layer_decisions?: LayerDecision[];
  audit: AuditRef;
}

/** 逐层决策（§2.2 不变量 8） */
export interface LayerDecision {
  layer: Exclude<Layer, 'L0'>;
  action: 'generated' | 'duplicate' | 'invalid' | 'skipped' | 'stopped';
  by: 'local' | 'llm' | 'none';
  score?: number;
  threshold?: number;
  candidates?: number;
  reason?: string;
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
  /**
   * 真实扫描到的候选 Agent（宿主进程表 / MCP 注册表 / 心跳）。
   * 缺省 = 无真实候选：内核不做任何虚构绑定。
   */
  found?: { name: string; signal: DiscoverSignal }[];
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

/** ---------- 查阅（§4.1 / §4.4） ---------- */
export interface BrowseReq {
  layer: Layer;
  project_id: string;
  session_id?: string;
  /** L0 查阅必须带连续会话；首次解锁走 l0Unlock（端壳主进程持有 DEK） */
  l0_auth?: { l0_session_id: string };
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

/** ---------- L0 端口与授权（§4.4；DEK 只在主进程，内核只经端口加密/解密） ---------- */
/** 内核 L0 端口：seal 供写入加密 L0；decrypt 供连续会话查阅 */
export interface L0Port {
  /** 返回 v2 信封；写密钥未解锁抛 E_L0_LOCKED（绝不落明文/不伪造加密标记） */
  seal(plain: string): Promise<string>;
  /** 按连续会话解密；会话无效/过期抛 E_L0_EXPIRED，密钥不匹配抛 E_AUTH_L0 */
  decrypt(req: { l0_session_id: string; project_id: string; mem_id: string; envelope: string }): Promise<string>;
  /** 会话归属（审计 l0_view 用 grant_id/user_id/scope；端壳实现） */
  sessionInfo?(l0_session_id: string): Promise<{
    grant_id?: string;
    user_id: string;
    scope_project_ids: string[];
    expires_at: number;
  }>;
}

export interface L0AccessRequest {
  project_ids: string[];
  reason?: string;
}

export interface L0AccessRequestResult {
  request_id: string;
  status: 'pending';
}

export interface L0GrantReq {
  request_id?: string;
  grantee_user_id: string;
  scope_project_ids: string[];
  /** 缺省 = 系统随机生成，仅在发放结果中一次性返回 */
  password?: string;
}

export type L0GrantStatus = 'active' | 'expired' | 'revoked' | 'consumed';

export interface L0GrantView {
  grant_id: string;
  grantee_user_id: string;
  scope_project_ids: string[];
  status: L0GrantStatus;
  created_at: number;
  last_view_at?: number;
  expires_at?: number;
  request_id?: string;
}

/** 发放结果：password 仅一次性返回，绝不落盘/进日志 */
export interface L0GrantResult extends L0GrantView {
  password?: string;
}

export interface L0RequestView {
  request_id: string;
  user_id: string;
  project_ids: string[];
  reason?: string;
  status: 'pending' | 'granted' | 'denied';
  created_at: number;
  decided_by?: string;
  decided_at?: number;
  grant_id?: string;
}

export interface L0UnlockReq {
  /** 缺省 = 管理员用管理密码直接查阅 */
  grant_id?: string;
  password: string;
}

export interface L0UnlockResult {
  l0_session_id: string;
  grant_id?: string;
  expires_at: number;
  idle_timeout_ms: number;
}

export interface L0HeartbeatResult {
  expires_at: number;
  idle_timeout_ms: number;
}

export interface L0VaultStatus {
  has_admin_wrap: boolean;
  write_unlocked: boolean;
  active_sessions: number;
  active_grants: number;
}

/** 旧数据迁移报告（§4.4.6；内容为计数，绝不携带任何明文） */
export interface L0MigrationReport {
  scanned: number;
  /** content_orig 明文 → v2 */
  migrated_orig: number;
  /** v1 信封 → v2（需旧密码） */
  migrated_v1: number;
  /** 无法迁移，保留并标记 l0_migration_pending */
  pending: number;
  /** 已是 v2 / 无 L0 */
  skipped: number;
}

/** 迁移结果：report 为计数；backup_dir 仅桌面端（迁移前自动备份，§4.4.6） */
export interface L0MigrationResult {
  report: L0MigrationReport;
  backup_dir?: string;
}

/** 端壳主进程注入的 L0 管理端（申请/发放/解锁/锁定/写密钥/迁移） */
export interface L0AdminPort {
  requestAccess(req: L0AccessRequest & { user_id: string }): Promise<L0AccessRequestResult>;
  listRequests(): Promise<L0RequestView[]>;
  listGrants(): Promise<L0GrantView[]>;
  grantAccess(req: L0GrantReq & { admin_user_id: string }): Promise<L0GrantResult>;
  denyRequest(req: { request_id: string; admin_user_id: string; reason?: string }): Promise<void>;
  revokeGrant(req: { grant_id: string; admin_user_id: string; reason?: string }): Promise<void>;
  unlock(req: L0UnlockReq & { user_id: string }): Promise<L0UnlockResult>;
  heartbeat(l0_session_id: string): Promise<L0HeartbeatResult>;
  lock(l0_session_id: string): Promise<void>;
  unlockWrite(req: { password: string; admin_user_id: string }): Promise<void>;
  lockWrite(req: { admin_user_id: string }): Promise<void>;
  status(): Promise<L0VaultStatus>;
  /** 首次设置 / 轮换管理密码（§4.4.1；主进程再校验管理员） */
  setupAdminPassword(password: string, admin_user_id: string): Promise<void>;
  changeAdminPassword(oldPassword: string, newPassword: string, admin_user_id: string): Promise<void>;
  /** 旧数据迁移（§4.4.6；桌面端迁移前自动备份） */
  migrate(req: { admin_user_id: string; oldPassword?: string }): Promise<L0MigrationResult>;
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
  | 'recall' | 'write' | 'graft' | 'gc' | 'auto_bind' | 'unbound' | 'sync'
  | 'llm_proxy' | 'llm_fallback' | 'log_view' | 'l0_view'
  | 'l0_auth_request' | 'l0_auth_grant' | 'l0_auth_deny' | 'l0_auth_revoke' | 'l0_auth_expire'
  | 'memory_op'
  | 'param_save'
  | 'growth_op'
  | 'monitor_alert'
  | 'security_change'
  // 真实质量/可靠性事件（监控仪表盘与冲突队列的真实口径来源）
  | 'recall_breach' | 'cold_recall' | 'evidence_thin' | 'sync_fail' | 'conflict_resolve' | 'merge'
  // 会话生命周期
  | 'login' | 'login_fail' | 'logout'
  // 页面真实动作（4.3 全动作可查：日志页/审计页按动作回放，不允许账本里出现未知动作）
  | 'mode_dispatch' | 'sync_up' | 'sync_down' | 'sync_reconcile' | 'rerank_fallback'
  | 'team_assign' | 'audit_delete' | 'archive' | 'l0_auth_fail';

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
  content_l0_enc?: string;        // L0 原始加密对话（v2 信封 JSON，仅授权连续会话可解）
  /** 旧 v1 信封无法迁移（缺旧密码）→ 保留并显式告警，不静默伪造成功 */
  l0_migration_pending?: boolean;
  content: string;                // 该层可读内容
  content_orig?: string;          // 写入时原始输入（供查重/溯源，不展示）
  /** 各层生成规格版本（§2.1/§16.1，便于回溯"这条是按哪版 spec 炼的"） */
  layer_specs?: Record<string, string>;
  // ---- L1–L6 精炼产物（§2.2 一次性精炼，写入时由 LLM 生成，可选向后兼容） ----
  content_l1?: string;            // L1 清洗脱敏（脱敏后的原文）
  content_l2?: string;            // L2 会话摘要（≤300 字）
  content_l3?: string;            // L3 得失分析（≤200 字：成功点/失败点/经验教训）
  content_l4?: string;            // L4 模式归纳（≤120 字：跨事件重复规律）
  content_l5?: string;            // L5 洞察提炼（≤60 字：本质理解）
  content_l6?: string;            // L6 关键字投影（{"keywords":[...],"projections":[...]}）
  /** 精炼来源：stub = 未接入 LLM（只落 L1，L2–L6 不生成）；llm = 真实 LLM 产出 */
  refined_by?: 'stub' | 'llm' | 'llm_partial';
  /**
   * 本组层内容（L1–L6）的生成时间（批次24 口径 2：一条记忆只记一个层级生成时间，不逐层记）。
   * 批次24 之前的历史行没有这个字段 → 页面显示「未记录」，绝不拿 created_at 冒充。
   */
  layers_generated_at?: number;
  embedding?: number[];
  decay_class: DecayClass;
  pinned: boolean;
  locked: boolean;
  sim?: number;                   // 查重相似度（6.1）
  conflict_id?: string;           // 冲突（9.7）
  version: number;                // 同步用（REQ-008）
  created_by_agent?: string;
  created_at: number;
  // ---- REQ-010 遗忘机制扩展（17.4，全部可选向后兼容） ----
  importance?: number;            // 知识重要程度 0–1
  confidence?: number;            // 可信度 0–1（confirm +0.1 / reject −0.05）
  access_count?: number;          // 召回命中次数（不含 confirm/reinforce）
  reinforce_count?: number;       // 用户确认/强化次数
  half_life_days?: number;        // 半衰期（17.6 按类别默认策略）
  last_access_time?: number;      // 最近访问
  tags?: string[];                // 标签集合
  merged_from?: string[];         // 被哪些原始记忆合并（17.9）
  merged_into?: string;           // 是否被合并到某条摘要
  // ---- 分支嫁接（§6.2，2026-10-30） ----
  graft_to?: string;              // 本条新记忆嫁接到的目标记忆 ID
  graft_layer?: Exclude<Layer, 'L0'>; // 命中层（生成到该层即停止）
  grafted_from?: string[];        // 目标记忆记录：有哪些新记忆嫁接到我
  // ---- REQ-008 同步扩展（§3.1，全部可选向后兼容） ----
  pending_sync?: boolean;         // 离线先写待回传（移动端 §5）
  sha256?: string;                // 内容指纹（5.4 幂等）
  vclock?: Record<string, number>;// 向量时钟 {端: 版本}（§3.1）
  updated_at?: number;            // 最近修改（LWW 判序用，§4）
  /** 删除墓碑（D2）：删除不物理消失，置 deleted 并保留版本/时钟供同步传播；默认列表/读取不可见 */
  deleted?: boolean;
  deleted_at?: number;
}

/** ---------- 记忆操作（17.3，P8 三操作/P4 调参共用一条内核通道） ---------- */
export type MemOp =
  | 'remember' | 'forget' | 'pin' | 'unpin' | 'lock' | 'unlock'
  | 'archive' | 'restore' | 'delete'
  | 'param'      // 调参（P4 面板）：patch 部分字段
  | 'migrate';   // 层迁移（P4）：patch.decay_class 目标温度

export interface MemOpPatch {
  importance?: number;
  confidence?: number;
  half_life_days?: number;
  pinned?: boolean;
  locked?: boolean;
  decay_class?: DecayClass;
}

export interface MemOpResult {
  ok: boolean;
  /** G4：locked 拒绝（仅 unlock 放行） */
  blocked_locked?: boolean;
  /** 操作后记录；delete 后为 null */
  mem: Memory | null;
  request_id: string;
}

/** ---------- 用户反馈（17.4 trust_delta，P9 端壳提交） ---------- */
export type FeedbackKind = 'confirm' | 'reject' | 'disputed';

export interface FeedbackResult {
  ok: boolean;
  mem: Memory | null;
  /** confirm +0.1 / reject −0.05 / disputed 0（内核计算，端壳不自行判定） */
  trust_delta: number;
  request_id: string;
}

/** ---------- Provider 注入（§5） ---------- */
export interface ModelInfo {
  model: string;
  tier: 'free' | 'cheap' | 'paid';
  price: number;                  // ¥/千次
  quota: number;                  // 声明日额度
  used: number;
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
  /**
   * 逐层精炼（首选，§2.2）：每层一次调用，input 只能是上一层（L6 为 L1–L5 + relevance）。
   * 返回该层文本；不合规由内核按 layerRules.checkLayerSpec 判定。
   */
  refineLayer?(
    model: string,
    layer: Exclude<Layer, 'L0'>,
    input: string,
    category: Category,
    ctx: LlmCallCtx,
  ): Promise<string>;
  /**
   * 结构化精炼（兼容旧 Provider）：返回多层产物；内核按层拆分，
   * 但每层调用仍只传上一层输入（逐层最多 5 次），不会一次性生成全部层。
   */
  refine?(model: string, raw: string, category: Category, ctx: LlmCallCtx): Promise<RefinedLayers>;
  /** 五维查重的 LLM 仲裁（§6.1，权重 20%）；缺省 = 四维归一化 */
  judgeDuplicate?(model: string, a: string, b: string, ctx: LlmCallCtx): Promise<number>;
  /** true = 显式本地 stub（不产生真实精炼产物；写入只落 L1） */
  readonly isStub?: boolean;
}

export interface Filter {
  project_id?: string;
  layer?: Layer;
  decay_class?: DecayClass;
  /** 仅同步引擎使用：把删除墓碑也列出来以传播删除；UI/常规读取默认排除 */
  include_deleted?: boolean;
}

export interface Scored {
  mem_id: string;
  score: number;
}

export interface VectorBackend {
  /** 嵌入维度（模型配置页保存的 dims 注入这里；缺省 = 实现默认维度） */
  readonly dim?: number;
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
  /** 批量写入模式（会话采集等大批量入库）：begin 后写操作延迟落盘，commit 一次性持久化。
   *  无批量需求的后端可空实现（InMemory 直接 no-op，FileStorage 延迟同步写盘）。 */
  beginBatch?(): void;
  commitBatch?(): void;
}

/** 内核装配参数（§1 入口） */
export interface MemAgentOptions {
  form: Form;
  account: Account;
  llm: LlmProvider;
  vector: VectorBackend;
  storage: StorageBackend;
  /** L0 加密/解密端口（桌面端由主进程 L0Vault 实现；缺省 = 写入返回 E_L0_LOCKED） */
  l0?: L0Port;
  /** L0 授权管理端（桌面端由主进程 L0Vault 实现） */
  l0Admin?: L0AdminPort;
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
  // ---- L0 授权与会话（§4.4；端壳注入 L0AdminPort，缺省显式 E_NOT_IMPLEMENTED） ----
  l0RequestAccess(req: L0AccessRequest): Promise<L0AccessRequestResult>;
  l0ListRequests(): Promise<L0RequestView[]>;
  l0ListGrants(): Promise<L0GrantView[]>;
  l0GrantAccess(req: L0GrantReq): Promise<L0GrantResult>;
  l0DenyRequest(request_id: string, reason?: string): Promise<void>;
  l0RevokeGrant(grant_id: string, reason?: string): Promise<void>;
  l0Unlock(req: L0UnlockReq): Promise<L0UnlockResult>;
  l0Heartbeat(l0_session_id: string): Promise<L0HeartbeatResult>;
  l0Lock(l0_session_id: string): Promise<void>;
  l0UnlockWrite(password: string): Promise<void>;
  l0LockWrite(): Promise<void>;
  l0Status(): Promise<L0VaultStatus>;
  /** 首次设置管理密码（§4.4.1；已存在则拒绝，轮换走 l0ChangeAdminPassword） */
  l0SetupAdminPassword(password: string): Promise<void>;
  l0ChangeAdminPassword(oldPassword: string, newPassword: string): Promise<void>;
  /** 旧数据迁移（§4.4.6；桌面端迁移前自动备份） */
  l0Migrate(oldPassword?: string): Promise<L0MigrationResult>;
  /** 测试辅助：灌入种子记忆（L0 仅在注入 L0Port 且显式 l0=true 时加密；绝不使用明文密码） */
  _seedMemory(m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'> & { l0?: boolean }): Promise<Memory>;
  /** 单记忆操作（17.3/P4）：端壳状态变更统一走内核（G4 约束 + 钳制 + 版本 + 审计） */
  _memoryOp(mem_id: string, op: MemOp, patch?: MemOpPatch): Promise<MemOpResult>;
  /** 用户反馈（17.4）：confirm +0.1 / reject −0.05 / disputed 挂 9.7 裁决 */
  _feedback(mem_id: string, kind: FeedbackKind): Promise<FeedbackResult>;
}
