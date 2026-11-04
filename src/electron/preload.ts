// Electron preload：contextIsolation 开启下，经 contextBridge 向渲染进程暴露存储桥接面与运行标识。
// channel 字符串一律取自 ipcChannels.ts（与主进程注册同一真源，避免声明了却没注册的死桥）。
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipcChannels.ts';
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
  putMemory: (m: unknown) => ipcRenderer.invoke(IPC.storagePutMemory, m),
  getMemory: (id: string) => ipcRenderer.invoke(IPC.storageGetMemory, id),
  listMemories: (f: unknown) => ipcRenderer.invoke(IPC.storageListMemories, f),
  deleteMemory: (id: string) => ipcRenderer.invoke(IPC.storageDeleteMemory, id, sidArg()),
  appendAudit: (a: unknown) => ipcRenderer.invoke(IPC.storageAppendAudit, a, sidArg()),
  queryAudit: (f: unknown) => ipcRenderer.invoke(IPC.storageQueryAudit, f),
  /** 账本位置：渲染层展示「记忆存储在哪」（真实路径） */
  location: () => ipcRenderer.invoke(IPC.storageLocation) as Promise<{ path: string; source: string }>,
  /** 打开单条记忆文件：导出为 .json 并在默认查看器中打开（真实落盘 userData/memories-export/） */
  openMemoryFile: (memId: string) => ipcRenderer.invoke(IPC.storageOpenMemoryFile, memId) as Promise<{ ok: boolean; path?: string; error?: string }>,
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
    apply?: { written: number; filtered: number; failed: number; ts: number } | null;
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
  writeUnlock: (password: string, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.l0WriteUnlock, password, sessionId),
  writeLock: (sessionId?: string | null) => ipcRenderer.invoke(IPC.l0WriteLock, sessionId),
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

// 批次39：L2–L6 后台补炼队列桥。状态只读需会话；开关/补炼存量/重试失败行仅管理员。
// 队列里的正文一律不出主进程：状态视图只有 mem_id 计数、额度与原因码。
const refineQueue = {
  state: (sessionId?: string | null) => ipcRenderer.invoke(IPC.refineState, sessionId),
  setEnabled: (enabled: boolean, sessionId?: string | null) =>
    ipcRenderer.invoke(IPC.refineSetEnabled, enabled, sessionId),
  backfill: (sessionId?: string | null) => ipcRenderer.invoke(IPC.refineBackfill, sessionId),
  retryFailed: (sessionId?: string | null) => ipcRenderer.invoke(IPC.refineRetryFailed, sessionId),
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
};

// 悬浮覆盖层桥：渲染层调 detectClaude() 拿 Claude 窗口位置，setPosition() 移动悬浮窗
const floatAttribution = {
  detectClaude: () => ipcRenderer.invoke(IPC.floatDetectClaude),
  setPosition: (x: number, y: number) => ipcRenderer.invoke(IPC.floatSetPosition, x, y),
  open: () => ipcRenderer.invoke(IPC.floatOpen) as Promise<{ ok: boolean; error?: string }>,
  close: () => ipcRenderer.invoke(IPC.floatClose) as Promise<{ ok: boolean; error?: string }>,
  /** 渲染层日志回写主进程 float.log（离线排查挂件没出来的原因） */
  log: (msg: string) => void ipcRenderer.send(IPC.floatLog, msg),
};

contextBridge.exposeInMainWorld('__ELECTRON__', true);
contextBridge.exposeInMainWorld('api', { storage, hostScan, hostAgentDetect, tenant, mcpClients, floatAttribution, collector, backup, dataRoot, log, l0, setup, legacy, ledgerReset, rulesRejudge, refineQueue, llm });
