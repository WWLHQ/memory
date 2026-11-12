// Electron preload：contextIsolation 开启下，经 contextBridge 向渲染进程暴露存储桥接面与运行标识。
// channel 字符串一律取自 ipcChannels.ts（与主进程注册同一真源，避免声明了却没注册的死桥）。
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, SHELL_SHORTCUT_CHANNEL, type ShellShortcut } from './ipcChannels.ts';
import { SESSION_STORAGE_KEY } from '../shared/sessionKey.ts';
import type { ActionLogTailResult } from '../shared/actionLog.ts';

/**
 * 批次26-B P1-2：数据面 IPC 的会话自动附带。
 * 删除/审计写/宿主真扫由内核（core/memagent）发起，调用链上没有 sessionId 可显式传递，
 * 因此在 preload 这个受信边界统一读取登录态（与 web 页面共享同一 localStorage 键真源），
 * 主进程对这四条通道 requireSession 兜底校验；未登录时操作被拒绝（未登录只读原则）。
 */
const sidArg = (): string | null => {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};

const storage = {
  putMemory: (m: unknown) => ipcRenderer.invoke(IPC.storagePutMemory, m, sidArg()),
  getMemory: (id: string) => ipcRenderer.invoke(IPC.storageGetMemory, id, sidArg()),
  listMemories: (f: unknown) => ipcRenderer.invoke(IPC.storageListMemories, f, sidArg()),
  deleteMemory: (id: string) => ipcRenderer.invoke(IPC.storageDeleteMemory, id, sidArg()),
  appendAudit: (a: unknown) => ipcRenderer.invoke(IPC.storageAppendAudit, a, sidArg()),
  queryAudit: (f: unknown) => ipcRenderer.invoke(IPC.storageQueryAudit, f, sidArg()),
  // ── 批次46-D6：项目注册表（多用户三池基础）──
  createProject: (input: unknown) => ipcRenderer.invoke(IPC.storageCreateProject, input),
  getProject: (id: string) => ipcRenderer.invoke(IPC.storageGetProject, id),
  listProjects: (f: unknown) => ipcRenderer.invoke(IPC.storageListProjects, f),
  /** 账本位置：渲染层展示「记忆存储在哪」（真实路径） */
  location: () => ipcRenderer.invoke(IPC.storageLocation) as Promise<{ path: string; source: string }>,
  /** 打开单条记忆文件：导出为 .json 并在默认查看器中打开（真实落盘 userData/memories-export/） */
  openMemoryFile: (memId: string) => ipcRenderer.invoke(IPC.storageOpenMemoryFile, memId) as Promise<{ ok: boolean; path?: string; error?: string }>,
};

// 个人记忆独立存储桥（第一轮本机闭环）：owner 由主进程按会话解析，渲染层只传动作与参数
const personal = {
  invoke: (op: string, payload?: unknown, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.personalInvoke, op, payload, sessionId ?? sidArg()) as Promise<{
      ok: boolean; data?: unknown; error?: string; code?: string;
    }>,
};

// 宿主真扫桥（discover 真实化）：渲染层调 hostScan.run() 拿主进程真实扫描结果（P1-2：需登录会话）
const hostScan = {
  run: () => ipcRenderer.invoke(IPC.hostScanRun, sidArg()),
};

// 本机 Agent 检测桥（后续扩展）：CLI 安装探测 + 接入配置建议（P1-2：需登录会话）
const hostAgentDetect = {
  run: () => ipcRenderer.invoke(IPC.hostAgentDetectRun, sidArg()),
  config: (agentName: string) => ipcRenderer.invoke(IPC.hostAgentDetectConfig, agentName),
};

// 租户身份桥（批次26-B P1-3）：主进程按会话下发三元组，渲染层不得自报
const tenant = {
  get: (sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.tenantGet, sessionId) as Promise<{ ok: boolean; tenant?: { user_id: string; team_id: string; enterprise_id: string }; error?: string }>,
};

// MCP 客户端接入桥（批次15）：状态扫描需登录会话（批次27 P3-4）；含令牌片段/一键写入需管理员（主进程按 sessionId 校验）
const mcpClients = {
  list: (sessionId?: string | null) => ipcRenderer.invoke(IPC.mcpClients, sessionId),
  snippet: (id: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.mcpClientSnippet, id, sessionId) as Promise<{ ok: boolean; snippet?: string; error?: string }>,
  wire: (id: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.mcpClientWire, id, sessionId) as Promise<{ ok: boolean; changed?: boolean; path?: string; backupPath?: string; error?: string }>,
};

// 会话采集器桥（19.9 接入成功立即读各 agent 会话/记忆）：宿主真扫命中后立刻触发一次对账
// triggerNow(agentNames?)：传入已检测到的已安装 agent 名 → 扩展采集源白名单，立即读 L0
const collector = {
  triggerNow: (agentNames?: string[]) => ipcRenderer.invoke(IPC.collectorTriggerNow, agentNames) as Promise<{ ok: boolean; collected: number; deduped: number; roleSkipped: number; skipped: string[]; ts: number }>,
  status: () => ipcRenderer.invoke(IPC.collectorStatus) as Promise<{
    ok: boolean; running: boolean; intervalMs: number;
    last?: { collected: number; deduped: number; roleSkipped: number; skipped: string[]; ts: number } | null;
    apply?: { written: number; filtered: number; failed: number; failed_l0_locked: number; ts: number } | null;
    /** 批次41-W：最近一轮有写入失败是「L0 写密钥未解锁」（页面据此给解锁入口，不再只报 failed=N） */
    l0_locked_writes?: boolean;
    recollecting?: boolean;
  }>,
};

// 记忆库自动备份桥（记忆库管理页 P8 扩展）：备份位置/时间用户可设置，主进程调度器到点自动备份
// 批次7：写配置/选目录/立即备份属敏感操作 → 主进程按 sessionId 校验管理员；读操作保持可用。
const backup = {
  getConfig: () => ipcRenderer.invoke(IPC.backupGetConfig) as Promise<{ enabled: boolean; dir: string; hour: number; minute: number; keepCount: number; lastRun?: string; lastOk?: boolean }>,
  saveConfig: (patch: { enabled?: boolean; dir?: string; hour?: number; minute?: number; keepCount?: number }, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.backupSaveConfig, patch, sessionId) as Promise<{ ok: true; cfg?: unknown } | { ok: false; error: string }>,
  chooseDir: (sessionId?: string | null) => ipcRenderer.invoke(IPC.backupChooseDir, sessionId) as Promise<{ ok: boolean; dir: string; error?: string }>,
  runNow: (sessionId?: string | null) => ipcRenderer.invoke(IPC.backupRunNow, sessionId) as Promise<{
    ok: boolean; file?: string; error?: string;
    files?: { kind: 'ledger' | 'l0' | 'keyring'; name: string; size: number }[];
    missing?: ('ledger' | 'l0' | 'keyring')[];
  }>,
  list: () => ipcRenderer.invoke(IPC.backupList) as Promise<{
    dir: string; items: { name: string; time: string; size: number; kind: 'ledger' | 'l0' | 'keyring' }[];
  }>,
};

// 数据存放位置（批次6）：记忆库/游标/日志/MCP 令牌/备份配置等全部数据挂在用户选定目录
// 批次7：更改/恢复默认属敏感操作 → 主进程按 sessionId 校验管理员；查询/打开目录保持可用。
const dataRoot = {
  get: () => ipcRenderer.invoke(IPC.dataRootGet) as Promise<{ root: string; defaultRoot: string; isDefault: boolean; pointer: string; activeDbPath: string; activeL0Path?: string; l0ReadOnly?: boolean }>,
  open: () => ipcRenderer.invoke(IPC.dataRootOpen) as Promise<{ ok: boolean; path?: string; error?: string }>,
  change: (sessionId?: string | null) => ipcRenderer.invoke(IPC.dataRootChange, sessionId) as Promise<{ ok: boolean; root?: string; restartRequired?: boolean; canceled?: boolean; error?: string }>,
  restoreDefault: (sessionId?: string | null) => ipcRenderer.invoke(IPC.dataRootRestoreDefault, sessionId) as Promise<{ ok: boolean; root?: string; restartRequired?: boolean; canceled?: boolean; error?: string }>,
};

// 动作日志桥（批次7）：渲染层任何动作一行日志，主进程追加到 <数据根>/actions.log（无需等待返回）
const log = {
  write: (
    scope: string,
    action: string,
    detail?: unknown,
    opts?: { level?: 'info' | 'warn' | 'error'; requestId?: string },
  ) => ipcRenderer.send(IPC.logWrite, { scope, action, detail, level: opts?.level, requestId: opts?.requestId }),
  /** 批次17：尾读 <数据根>/actions.log 最近 N 行（程序运行日志窗口，批次19 起由日志记录页使用） */
  tail: (limit?: number) => ipcRenderer.invoke(IPC.logTail, limit) as Promise<ActionLogTailResult>,
};

// L0 密钥环桥（§4.4）：DEK 只在主进程；渲染层只能经此请求加密/解密/授权。
// 密码只作为参数一次性传递，主进程绝不回显/落盘；管理类操作由主进程按 sessionId 校验管理员。
const l0 = {
  status: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0Status, sessionId),
  setup: (password: string, sessionId?: string | null) => ipcRenderer.invoke(IPC.l0Setup, password, sessionId),
  changePassword: (oldPassword: string, newPassword: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0ChangePassword, oldPassword, newPassword, sessionId),
  requestAccess: (projectIds: string[], reason: string | undefined, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Request, projectIds, reason, sessionId),
  listRequests: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0ListRequests, sessionId),
  listGrants: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0ListGrants, sessionId),
  grant: (req: unknown, sessionId?: string | null) => ipcRenderer.invoke(IPC.l0Grant, req, sessionId),
  deny: (requestId: string, reason: string | undefined, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Deny, requestId, reason, sessionId),
  revoke: (grantId: string, reason: string | undefined, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Revoke, grantId, reason, sessionId),
  unlock: (req: unknown, sessionId?: string | null) => ipcRenderer.invoke(IPC.l0Unlock, req, sessionId),
  heartbeat: (l0SessionId: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Heartbeat, l0SessionId, sessionId),
  lock: (l0SessionId: string, sessionId?: string | null) => ipcRenderer.invoke(IPC.l0Lock, l0SessionId, sessionId),
  writeUnlock: (password: string, memberId?: string | null, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0WriteUnlock, password, memberId, sessionId),
  writeLock: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0WriteLock, sessionId),
  /** §4.4.4-B：管理员为成员发放写解锁口令 */
  addMemberWriteWrap: (memberId: string, passphrase: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0AddMemberWriteWrap, memberId, passphrase, sessionId),
  /** §4.4.4-B：撤销某成员的写解锁口令 */
  removeMemberWriteWrap: (memberId: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0RemoveMemberWriteWrap, memberId, sessionId),
  /** §4.4.4-B：查「本账号」有没有写解锁口令（需登录；只回布尔） */
  myWriteWrap: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0MyWriteWrap, sessionId),
  seal: (plain: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Seal, plain, sessionId) as Promise<{ ok: boolean; sealed?: string; code?: string; error?: string }>,
  decrypt: (req: unknown, sessionId?: string | null) => ipcRenderer.invoke(IPC.l0Decrypt, req, sessionId),
  sessionInfo: (l0SessionId: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0SessionInfo, l0SessionId, sessionId),
  migrate: (opts: { oldPassword?: string } | undefined, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Migrate, opts, sessionId),
  /** 批次37-A：拆库后批量回读 L0 信封（只回密文；需登录会话，主进程校验） */
  blobs: (memIds: string[], sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Blobs, memIds, sessionId) as Promise<
      { ok: true; envelopes: Record<string, string> } | { ok: false; error: string }
    >,
  /** S5 / D6：MCP 写入兜底队列只读摘要（仅计数与摘要，不含正文与密钥材料；需登录会话） */
  pendingWrites: (sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0PendingWrites, sessionId),
  /** 批次37-C：存量拆分迁移（历史行的明文/遗留信封搬进 L0 原数据库）——预览只读、执行需管理员 + 逐字口令 */
  splitPreview: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0SplitPreview, sessionId),
  splitRun: (confirmText?: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0SplitRun, confirmText, sessionId),
  /** 批次37-E：按 L0 原文重建 L1–L6（预览需会话；执行需管理员 + 逐字 REBUILD + 强制双库备份） */
  rebuildPreview: (req?: { l0_session_id?: string; use_llm?: boolean }, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0RebuildPreview, req ?? {}, sessionId),
  rebuildRun: (req?: { confirm_text?: string; l0_session_id?: string; use_llm?: boolean }, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0RebuildRun, req ?? {}, sessionId),
  /**
   * 批次37-G：L0 恢复码（忘记管理密码的唯一找回通道，一次性）。
   * recovery_code 只在 issue/recover/init 那一次的返回值里出现；状态接口永不回显。
   */
  recoveryStatus: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0RecoveryStatus, sessionId),
  recoveryInit: (password: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0RecoveryInit, password, sessionId),
  recoveryIssue: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0RecoveryIssue, sessionId),
  recover: (req: { code: string; newPassword: string }, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0Recover, req, sessionId),
  recoveryExport: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0RecoveryExport, sessionId),
};

// 首启向导桥（批次37-B）：登录之前用，所以这些方法不带会话参数。
// 恢复码只在发那一次的返回值里出现，向导不缓存、不回显。
const setup = {
  state: () => ipcRenderer.invoke(IPC.setupState),
  reselectDirs: () => ipcRenderer.invoke(IPC.setupReselectDirs),
  setL0Password: (password: string) => ipcRenderer.invoke(IPC.setupSetL0Password, password),
  regenCode: (password: string) => ipcRenderer.invoke(IPC.setupRegenCode, password),
  exportCard: () => ipcRenderer.invoke(IPC.setupExportCard),
  finish: () => ipcRenderer.invoke(IPC.setupFinish),
  // 批次58：向导的两个可选步骤（备份路径 / 精炼大模型）——同样不带会话，门禁是「向导还没走完」
  chooseBackupDir: (group: 'ledger' | 'l0') => ipcRenderer.invoke(IPC.setupChooseBackupDir, group),
  setBackup: (patch: { ledgerDir?: string; l0Dir?: string; enabled?: boolean }) =>
    ipcRenderer.invoke(IPC.setupSetBackup, patch),
  llmTest: (draft: Record<string, unknown>) => ipcRenderer.invoke(IPC.setupLlmTest, draft),
  llmSave: (draft: Record<string, unknown>) => ipcRenderer.invoke(IPC.setupLlmSave, draft),
  skipLlm: () => ipcRenderer.invoke(IPC.setupSkipLlm),
};

// 遗留账本清理桥（批次24）：预览只读、执行需管理员；主进程执行前自动备份数据根。
const legacy = {
  scan: (sessionId?: string | null) => ipcRenderer.invoke(IPC.legacyScan, sessionId),
  demote: (sessionId?: string | null) => ipcRenderer.invoke(IPC.legacyDemote, sessionId),
};

// 记忆库清空重采桥（批次35）：预览需会话、执行仅管理员，且必须逐字带确认口令。
// 主进程按「备份 → 清空 → 清游标 → 后台追采」顺序做，回执里的 backup_dir 是唯一退路。
const ledgerReset = {
  preview: (sessionId?: string | null) => ipcRenderer.invoke(IPC.ledgerResetPreview, sessionId),
  run: (confirmText: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.ledgerResetRecollect, confirmText, sessionId),
};

// 存量规则重判桥（批次36-C）：预览需会话、执行仅管理员 + 逐字口令 REJUDGE。
// 与 ledgerReset 的分工：本桥只删「按当前质量门本不该入库」的行，保留行不清空、游标不动、无需 L0 写密钥。
const rulesRejudge = {
  preview: (sessionId?: string | null) => ipcRenderer.invoke(IPC.rulesRejudgePreview, sessionId),
  run: (confirmText: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.rulesRejudgeRun, confirmText, sessionId),
};

// 存量字段回填桥（批次41-T）：预览需会话、执行仅管理员，**没有逐字口令**——
// 本桥不删行、不改正文、不动层级/version，只把历史行缺失的 sha256 / 向量补上（执行前仍强制备份）。
const ledgerFields = {
  preview: (sessionId?: string | null) => ipcRenderer.invoke(IPC.ledgerFieldsPreview, sessionId),
  run: (sessionId?: string | null) => ipcRenderer.invoke(IPC.ledgerFieldsBackfill, sessionId),
};

// 批次39：L2–L6 后台补炼队列桥。状态只读需会话；开关/补炼存量/重试失败行仅管理员。
// 队列里的正文一律不出主进程：状态视图只有 mem_id 计数、额度与原因码。
const refineQueue = {
  state: (sessionId?: string | null) => ipcRenderer.invoke(IPC.refineState, sessionId),
  setEnabled: (enabled: boolean, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.refineSetEnabled, enabled, sessionId),
  backfill: (sessionId?: string | null) => ipcRenderer.invoke(IPC.refineBackfill, sessionId),
  retryFailed: (sessionId?: string | null) => ipcRenderer.invoke(IPC.refineRetryFailed, sessionId),
  // 批次41-I 后续：设置每日额度（限额/不限额 + 行数），仅管理员；payload = {enabled, rows?}
  setCap: (payload: unknown, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.refineSetCap, payload, sessionId),
};

// LLM 精炼网关桥（批次31 建，批次32 多引擎化）：读配置需登录会话；写配置/真拨测仅管理员；refine 是内核写路径的逐层代理。
// 密钥只在 setConfig 的 patch.key 参数中出现一次，主进程写 0600 文件（llm-keys.json），任何返回值都不含密钥本体（只有 keySet）。
type LlmViewResult = {
  ok: boolean;
  usable?: boolean;
  engines?: unknown[];
  presets?: unknown[];
  error?: string;
};
const llm = {
  config: (sessionId?: string | null) => ipcRenderer.invoke(IPC.llmConfigGet, sessionId) as Promise<LlmViewResult>,
  setConfig: (patch: unknown, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.llmConfigSet, patch, sessionId) as Promise<LlmViewResult>,
  test: (engineId: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.llmTest, engineId, sessionId) as Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string; enabled?: boolean }>,
  refine: (payload: unknown, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.llmRefine, payload, sessionId) as Promise<{ ok: boolean; text?: string; tokens?: number; error?: string }>,
  /** 批次48 A31：各引擎余额视图（逐字段 provenance；force=true 绕过 10 分钟 TTL 手动刷新） */
  billing: (req?: { force?: boolean }, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.llmBilling, req ?? {}, sessionId) as Promise<{
      ok: boolean; ttlMs?: number; asOf?: number; engines?: unknown[]; error?: string;
    }>,
  /** 批次48 A31：独立 billing 凭据（仅管理员；value 为空串 = 清除；返回只含 keySet 布尔） */
  setBillingKey: (id: string, value: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.llmBillingKey, { id, value }, sessionId) as Promise<{
      ok: boolean; ttlMs?: number; asOf?: number; engines?: unknown[]; error?: string;
    }>,
};

// 云端同步中枢（批次42-B）：渲染层代理主进程 PgSyncHub。上行/下行/对账需会话（sessionId 末参），
// 人工裁决 resolve 需管理员（主进程 requireAdmin 二次校验，角色不由渲染层自报）。
const sync = {
  push: (mem: unknown, form: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncPush, mem, form, sessionId) as Promise<{ ok: boolean; result?: string; error?: string }>,
  pull: (scope: unknown, since: number, form: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncPull, scope, since, form, sessionId) as Promise<{ ok: boolean; items?: unknown[]; cursor?: number; error?: string }>,
  reconcile: (scope: unknown, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncReconcile, scope, sessionId) as Promise<{ ok: boolean; items?: unknown[]; losers?: unknown[]; missing_local?: string[]; error?: string }>,
  conflicts: (teamId?: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncConflicts, teamId, sessionId) as Promise<{ ok: boolean; conflicts?: unknown[]; error?: string }>,
  resolve: (conflictId: string, winner: 'local' | 'remote', sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncResolve, conflictId, winner, sessionId) as Promise<{ ok: boolean; error?: string }>,
  cursor: (sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncCursor, sessionId) as Promise<{ ok: boolean; cursor?: number; error?: string }>,
  auditCount: (sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncAuditCount, sessionId) as Promise<{ ok: boolean; count?: number; error?: string }>,
  auditsFrom: (start: number, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.syncAuditsFrom, start, sessionId) as Promise<{ ok: boolean; audits?: unknown[]; error?: string }>,
};

/**
 * 顶部自绘标题栏（批次48 S10）：把壳层当前主题同步给主进程的窗口按钮覆盖层。
 * 只改系统绘制的三个按钮的底色/符号色；按钮行为（最小化/最大化/关闭）仍归系统。
 */
const shell = {
  setTitleBarTheme: (theme: 'light' | 'dark') =>
    ipcRenderer.invoke(IPC.shellTitleBarTheme, theme) as Promise<{ ok: boolean; error?: string }>,
  /**
   * 快捷键事件订阅（主进程 before-input-event 捕获后转发）。
   * 返回取消订阅函数；壳层卸载时调用，避免重复注册。
   */
  onShortcut: (cb: (action: ShellShortcut) => void) => {
    const listener = (_event: unknown, action: ShellShortcut) => cb(action);
    ipcRenderer.on(SHELL_SHORTCUT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SHELL_SHORTCUT_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld('__ELECTRON__', true);
contextBridge.exposeInMainWorld('api', { storage, personal, hostScan, hostAgentDetect, tenant, mcpClients, collector, backup, dataRoot, log, l0, setup, legacy, ledgerReset, rulesRejudge, ledgerFields, refineQueue, sync, llm, shell });
