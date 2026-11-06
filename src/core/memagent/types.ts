// memagent-core 契约类型（REQ-007 §1/§2/§3/§5/§6 直译，19.10/19.11）
// 内核 = 唯一事实源；端壳只调用不实现业务（19.11 红线①）。
import type { L0BlobStore } from './l0Store.ts';
import type { PendingStore, WriteKnobs } from './pendingWrites.ts';
import type { LayerViolationCode } from './layerRules.ts';

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

/**
 * 召回模式（16.5）。
 *   - null / 'auto' = 自动（Agent 按 scene×关键词 自动分配具体模式，见 recallModes.ts §2.4.4）；
 *   - 其余 5 个为「手动」具体模式（用户/宿主显式指定，强制采用）。
 * 顶层开关即「自动 / 手动」：手动必须给出下面 5 个之一，否则边界校验报错。
 */
export type RecallMode = 'top_insight' | 'fact_first' | 'event_replay' | 'pattern_reasoning' | 'minimal' | 'auto' | null;

/** 召回场景（19.4 / 2.4.4） */
export type Scene = 'task_start' | 'critical' | 'default' | 'history_query';

/** 错误码（§6，各端统一处理） */
export type ErrorCode =
  | 'E_AUTH_L0'        // L0 未授权/密码错/换账号/解密失败
  | 'E_L0_LOCKED'      // L0 写密钥未解锁（§4.4.4）
  | 'E_L0_NO_GRANT'    // 非管理员未申请/未获授权（§4.4）
  | 'E_L0_EXPIRED'     // 授权/连续会话已过期（5min 无操作、重启、锁屏、撤销）
  | 'E_L0_MISSING_BLOB'// 批次37：行说有自己的 L0（has_l0），L0 原数据库里却取不到信封（断链，绝不当空正文）
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
  top_k?: number;                 // 1–10，默认 5；scope='session' 时即「最近 N 条」上限
  project_id: string;             // 必填（19.4 跨 Agent 共享锚）
  user_id?: string;               // 个人偏好才用（19.4 / 9.2）
  scene?: Scene;
  mode?: RecallMode;
  /** 调用方标识（批次15）：MCP initialize.clientInfo 或 User-Agent 识别，落 recall 审计用于按 Agent 核验 */
  client?: string;
  /** 批次44-D5-4：'project'（缺省）= 项目内语义检索；'session' = 本会话工作记忆，不走向量 */
  scope?: 'project' | 'session';
  /** scope='session' 时必填：写入时用的同一个 session_id；历史行无该字段不进会话视图 */
  session_id?: string;
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
  /** 批次40-C：判废时的稳定原因码（中文 reason 可改，码不换） */
  code?: LayerViolationCode;
  score?: number;
  threshold?: number;
  candidates?: number;
  reason?: string;
}

/** ---------- 生命周期（9.7 / 6.2） ---------- */
export interface GcReq {
  project_id: string;
  /**
   * 批次46-3：是否同时处理已排队的显式冲突裁决。
   * `coreGc` **不读**（D2 一行未改，恒回 conflicts_resolved=0）；
   * 真实接线在 `coreGcFull()`：必须与 `verdict` 同时给才落定，未给 verdict 明确拒绝。
   */
  resolve_conflicts?: boolean;
  /**
   * 批次44-D5-3：true = 只演算不落库（不改记忆、不写审计），用于 gc_report 的默认只读报告。
   * 未传 / false = 原有行为（真实衰减并落审计）——内核 API ma.gc() 默认行为不变。
   * MCP 入口由工具层默认置 true，见 mcpGcTools.ts。
   */
  dry_run?: boolean;
}

export interface GcReport {
  decayed: number;                // hot→warm→cold 推进条数
  merged: number;                 // 短路嫁接合并条数
  conflicts_resolved: number;
  request_id: string;
  /**
   * 批次44-D5-3：dry_run=true 时为 null——演算没有落审计，不伪造审计回执；
   * 非 dry_run 仍返回原有 AuditRef。
   */
  audit: AuditRef | null;
}

/**
 * 批次46-2（方案 C 薄编排）：完整遗忘周期编排 `coreGcFull()` 的输入。
 * `coreGc` / `ma.gc()` 一行未改；这是与它们并列的另一条入口，勿在同一次执行里同时调用。
 */
export interface GcFullReq extends GcReq {
  /** 是否执行冷压缩（17.10 每周）；缺省 false = 不动向量索引 */
  weeklyCompress?: boolean;
  /** 向量后端：给了才有可压缩对象 / 摘要索引；缺省 = 诚实不压缩 */
  vector?: VectorBackend;
  /** 自动策略开关（AC-14），透传 runForgettingCycle；缺省 = 启用 */
  enabled?: boolean;
  /**
   * 批次46-3：本周期对已排队冲突对该用的**显式** verdict。
   * 必须与 `resolve_conflicts=true` 同时给才落定；只给其一不落定或明确拒绝（D3/D8）。
   */
  verdict?: ConflictVerdict;
}

/**
 * 批次46-2：分层报告。三段数字来自同一次 runForgettingCycle 调用，禁止双计。
 * D6：保留 GcReport 既有三项 + 新增六项真实字段，不删字段、不重命名既有字段。
 */
export interface GcFullReport {
  project_id: string;
  dry_run: boolean;
  request_id: string;
  // ── 衰减段（兼容 GcReport 既有三项，不删、不改名）──
  /** = migrated 的兼容别名（D5：同一事件只出一个数，严禁双计） */
  decayed: number;
  /** 历史占位恒 0；由 summaries_created 取代，deprecated，不冒充统计 */
  merged: number;
  /** 批次46-3：只数本周期经 coreResolveConflict() **真实落定**的冲突对；未落定 / dry_run 诚实 0 */
  conflicts_resolved: number;
  // ── 摘要合并段（契约 §7 六字段，均有真实事件源）──
  /** 诚实语义 = 本轮扫描条数，**不是**「新鲜度更新条数」（D4）；另见 scanned */
  freshness_updated: number;
  /** 如实命名，恒等于 freshness_updated（D4） */
  scanned: number;
  migrated: number;
  summaries_created: number;
  summaries_filtered: number;
  merged_originals: number;
  /** 真清掉向量索引副本并写回的冷层行数（无 vector 后端诚实 0） */
  compressed: number;
  /** dry_run=true 恒 null：演算未落审计，不伪造回执（沿用 D5-3 口径） */
  audit: AuditRef | null;
  /** 分层口径说明（D6），不是统计量 */
  note: string;
}

// ─── 批次46-3：冲突裁决（§9.7 三模式 + P7 hold） ──────────────────────────────

/** 四值语义：用户显式选定才落定；禁止自动 auto_override */
export type ConflictVerdict = 'auto_override' | 'user_confirm' | 'merge' | 'hold';

/**
 * 真实冲突配对。内核**没有** `detect_conflicts` 检测引擎（§9.7 是设计伪码），
 * 因此 `conflict_score` / `conflict_type` 如实为 `null`，不硬编码 0.8、不按正文猜类型。
 */
export interface ConflictPair {
  conflict_id: string;
  old_id: string;
  new_id: string;
  /** 两条必须同项目，且落在调用方作用域内 */
  project_id: string;
  conflict_score: null;
  conflict_type: null;
  /** 口径说明（不伪造分数/类型） */
  note: string;
}

export interface ConflictResolveReq {
  old_id: string;
  new_id: string;
  conflict_id: string;
  /** 调用方作用域内的项目；与两条记忆的真实归属必须一致 */
  project_id: string;
  verdict: ConflictVerdict;
  /** true = 只演算：零写入、audit=null、conflicts_resolved=0 */
  dry_run?: boolean;
}

export interface ConflictResolveResult {
  ok: boolean;
  /** 是否真实落定（dry_run / pending / 拒绝 一律 false） */
  resolved: boolean;
  /** 本周期内真实落定的冲突对数：1 或 0，历史审计不回放计数 */
  conflicts_resolved: number;
  verdict: ConflictVerdict;
  conflict_id: string;
  old_id: string;
  new_id: string;
  project_id: string;
  dry_run: boolean;
  request_id: string;
  audit: AuditRef | null;
  merged_mem_id?: string;
  /** G4：locked 行仅 unlock 放行 */
  blocked_locked?: boolean;
  /** merge 聚合内容未过 L0→L1 质量门 → 整组回滚、保持 pending */
  quality_gate_blocked?: boolean;
  reason?: string;
  note: string;
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
  /** 42-A：下行游标（上次 syncDown 返回的 cursor）。缺省 0 = 全量下行，靠版本比对去重，游标优化属端壳职责 */
  since?: number;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  request_id: string;
  audit: AuditRef;
  /** 42-A：上行细分 —— 幂等跳过 / 中枢更新本端落后 / LWW 本端胜（push 时回传，如实不冒充） */
  dedup?: number;
  behind?: number;
  lww?: number;
  /** 42-A 红线：L0 密文行被引擎跳过未上行的条数（如实回报，不静默） */
  l0_skipped?: number;
  /** 42-A：下行新游标（pull 时回传，端壳可保存作下次 since） */
  cursor?: number;
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
  /**
   * 批次44-D4：写密钥当前是否在内存（用于 get_write_status 探锁）。
   * 可选——未实现的桥接端（如 HostL0Port）缺省按 false 处理（best-effort，不影响 pending 重放逻辑）。
   */
  isWriteUnlocked?(): boolean;
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
  // 批次48 A23.2：cron 周期任务的真实执行记录（task / next_due_at / duration_ms / status）
  | 'schedule_run'
  // 批次48 A23.3：判重权重回归的三种结果（样本不足 / 已评估未采纳 / 已采纳记 weight_tuned）
  | 'insufficient_samples'
  | 'weight_regression'
  | 'weight_tuned'
  // 批次49 A29：Agent 接入状态统一写内核审计（撤销沿用 unbound，一键接入沿用 auto_bind）
  | 'agent_onboard'
  | 'agent_test'
  | 'agent_rotate'
  | 'agent_revoke'
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
  /**
   * 批次37：本条的 L0 密文已搬进**独立的 L0 原数据库文件**（memories.l0.json），
   * 记忆库这一侧只留这个标记。为 true 时 `content_l0_enc` 必然为空——查阅/重建要经 L0BlobStore 取信封。
   */
  has_l0?: boolean;
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
  /**
   * 通过 L0→L1 质量门时的规则版本（批次36-A，`QUALITY_GATE_VERSION`）。
   * 历史行缺失 → 按 v1（批次35 以前的口径），绝不猜它是最新版；
   * 「存量重判」（rejudge）据此回答「这行是被哪一版规则放进来的」。
   */
  quality_gate_v?: number;
  embedding?: number[];
  decay_class: DecayClass;
  pinned: boolean;
  locked: boolean;
  sim?: number;                   // 查重相似度（6.1）
  conflict_id?: string;           // 冲突（9.7）
  version: number;                // 同步用（REQ-008）
  created_by_agent?: string;
  /**
   * 批次44-D5-4：写入时的会话归属（scope='session' 工作记忆视图用）。
   * 可选向后兼容：历史行无该字段 = 不进任何会话视图，绝不拿 created_at / project_id 冒充。
   */
  session_id?: string;
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
  /** 17.10 冷压缩：本行在向量索引中的副本被清除的时间（每周幂等；行上 embedding 始终保留） */
  compressed_at?: number;
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
  /**
   * 批次48 A24：取用宿主网关自上次取用以来**精炼调用**的真实 usage。
   * 返回 `{ tokens: null }` = 上游未返回 usage（如实未知，绝不按文本长度估算）；
   * 返回 null = 本次没有精炼调用。未实现该方法的 Provider 一律按「无真实 usage」处理。
   */
  takeUsage?(): { tokens: number | null } | null;
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

// ── 批次46-D6：项目注册表（多用户三池 / create_project 基础）──
/** 项目池类型：shared=全员可见 / user=每用户私有（owner_user_id 必填）/ archive=归档隐藏池 / general=普通受管项目 */
export type ProjectKind = 'shared' | 'user' | 'archive' | 'general';

export interface ProjectRecord {
  project_id: string;
  kind: ProjectKind;
  /** kind='user' 时必有：该池归属的用户 ID；shared/archive 可为空 */
  owner_user_id?: string;
  display_name?: string;
  created_at: number;
  /** 创建者标识（admin 令牌 label / user_id / 'system'） */
  created_by: string;
}

export interface CreateProjectInput {
  project_id: string;
  kind?: ProjectKind;
  owner_user_id?: string;
  display_name?: string;
  created_by: string;
}

export interface ListProjectsFilter {
  kind?: ProjectKind;
  owner_user_id?: string;
}

export interface StorageBackend {
  /** 记忆主表 */
  putMemory(m: Memory): Promise<void>;
  getMemory(mem_id: string): Promise<Memory | null>;
  listMemories(filter: Filter): Promise<Memory[]>;
  deleteMemory(mem_id: string): Promise<void>;
  // ── 批次46-D6：项目注册表（多用户三池基础）──
  /** 创建/登记一个受管项目（幂等：已存在同名 project_id 显式拒绝）；命名规则由上层（create_project 工具）约束，本层只做存在性校验 */
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  /** 取单个项目注册记录；未登记返回 null（隐式项目由上层按需兜底） */
  getProject(project_id: string): Promise<ProjectRecord | null>;
  /** 列出受管项目（可按 kind / owner_user_id 过滤）；不含隐式项目（由上层 list_projects 工具合并） */
  listProjects(filter?: ListProjectsFilter): Promise<ProjectRecord[]>;
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
  /**
   * 批次37：L0 原数据库（独立文件）。缺省 = L0 密文仍留在记忆库行上（旧口径）。
   * 传入时 FileStorage 会把写入行的信封搬进此库、行只留 `has_l0`，browse 也从这里回读信封。
   */
  l0Blobs?: L0BlobStore;
  /**
   * 批次44-D4：写入落盘兜底队列存储端口。L0 锁定时 write_memory 暂存于此，解锁后重放。
   * 缺省 = 内存实现（进程内不丢，重启清空）；桌面应传入 FilePendingStore 以持久化。
   */
  pending?: PendingStore;
  /**
   * 42-A：同步中枢注入口（内存 SyncHub 或进程内 pglite PgSyncHub）。
   * 缺省 = sync() 如实报 E_NOT_IMPLEMENTED（引擎已实现，缺中枢装配属诚实降级，不是功能缺失）；
   * 注入后 sync() 真调 syncUp/syncDown 引擎（sha256 幂等 + 自动 LWW + since 增量）。
   */
  hub?: import('./sync.ts').AnySyncHub;
}

/** createMemAgent 返回的核心 API 面（§2） */
export interface MemAgent {
  recall(req: RecallReq): Promise<RecallResult>;
  write(req: MemReq): Promise<WriteResult>;
  gc(req: GcReq): Promise<GcReport>;
  /**
   * 批次46-2：完整遗忘周期（项目隔离 / dry_run / 六字段真值）。
   * 与 gc() 是两条独立入口，**勿在同一次执行里同时调用**（两者都会做层迁移，会双计）。
   */
  gcFull(req: GcFullReq): Promise<GcFullReport>;
  getPrefs(user_id: string): Promise<Pref[]>;
  discover(req: DiscoverReq): Promise<DiscoverResult>;
  sync(req: SyncReq): Promise<SyncReport>;
  browse(req: BrowseReq): Promise<BrowseResult>;
  logs(req: LogReq): Promise<LogPage>;
  unbind(agent: string): Promise<void>;
  // ---- L0 授权与会话（§4.4；桌面壳注入 L0AdminPort，未提供端口时显式 E_NOT_IMPLEMENTED） ----
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
  // ---- 批次44-D4：写入落盘兜底（L0 锁定期间不丢，解锁后自动重放） ----
  /** 锁定时暂存一条写入，返回 pending_id */
  enqueuePending(req: MemReq & WriteKnobs): Promise<string>;
  /** 解锁后重放所有 pending（writeFn = 内核 write）；返回已重放 / 失败条数 */
  flushPending(): Promise<{ flushed: number; failed: number }>;
  /** 当前 pending 条数 */
  countPending(): Promise<number>;
  /**
   * 探锁 + 队列状态（批次44-D4 三字段口径）：
   * l0_unlocked / writeDek_present（写密钥是否在内存，同一判据双命名）/ pending_count（解锁时顺带重放）
   */
  getWriteStatus(): Promise<{ l0_unlocked: boolean; writeDek_present: boolean; pending_count: number }>;
  // ---- 批次44-D5-2：MCP 治理工具正式入口（与下方测试钩子同源，均转发 coreMemoryOp / coreFeedback） ----
  /** 单记忆操作（17.3/P4）：端壳状态变更统一走内核（G4 约束 + 钳制 + 版本 + 审计） */
  memoryOp(mem_id: string, op: MemOp, patch?: MemOpPatch): Promise<MemOpResult>;
  /** 用户反馈（17.4）：confirm +0.1 / reject −0.05 / disputed 挂 9.7 裁决 */
  feedback(mem_id: string, kind: FeedbackKind, meta?: { rating?: number; comment?: string }): Promise<FeedbackResult>;
  /** 兼容别名：端壳历史代码与测试灌数仍走下划线钩子，不删不改行为 */
  _memoryOp(mem_id: string, op: MemOp, patch?: MemOpPatch): Promise<MemOpResult>;
  /** 批次48 A13：meta.rating（1–5）与 comment 随反馈审计落账本（缺省则记为未评分） */
  _feedback(mem_id: string, kind: FeedbackKind, meta?: { rating?: number; comment?: string }): Promise<FeedbackResult>;
}

/**
 * 批次27 P3-1：种子记忆钩子——不属于公开 MemAgent 接口（绕过质量门与查重，仅限测试灌数）。
 * 渲染层经 src/web/kernel.ts 拿到的是 MemAgent 类型，无法触达；测试直接用 createMemAgent 返回值。
 */
export interface MemAgentSeedHooks {
  _seedMemory(m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'> & { l0?: boolean }): Promise<Memory>;
}
