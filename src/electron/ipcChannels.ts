// preload 暴露的 IPC channel 清单（唯一真源）。
// main 启动完成后据此自检：preload 声明了但主进程未注册的 channel 必须让启动失败，
// 否则渲染层拿到的是「永远 reject 的桥」（历史上的 floatAttribution:open / hostScan:run 即如此）。

export const IPC = {
  storagePutMemory: 'storage:putMemory',
  storageGetMemory: 'storage:getMemory',
  storageListMemories: 'storage:listMemories',
  storageDeleteMemory: 'storage:deleteMemory',
  storageAppendAudit: 'storage:appendAudit',
  storageQueryAudit: 'storage:queryAudit',
  storageLocation: 'storage:location',
  storageOpenMemoryFile: 'storage:openMemoryFile',
  hostScanRun: 'hostScan:run',
  hostAgentDetectRun: 'hostAgentDetect:run',
  hostAgentDetectConfig: 'hostAgentDetect:config',
  /** 批次15：MCP 客户端接入状态 / 片段 / 一键写入 */
  mcpClients: 'mcp:clients',
  mcpClientSnippet: 'mcp:clientSnippet',
  mcpClientWire: 'mcp:clientWire',
  collectorTriggerNow: 'collector:triggerNow',
  collectorStatus: 'collector:status',
  backupGetConfig: 'backup:getConfig',
  backupSaveConfig: 'backup:saveConfig',
  backupChooseDir: 'backup:chooseDir',
  backupRunNow: 'backup:runNow',
  backupList: 'backup:list',
  dataRootGet: 'dataRoot:get',
  dataRootOpen: 'dataRoot:open',
  dataRootChange: 'dataRoot:change',
  dataRootRestoreDefault: 'dataRoot:restoreDefault',
  floatDetectClaude: 'floatAttribution:detectClaude',
  floatSetPosition: 'floatAttribution:setPosition',
  floatOpen: 'floatAttribution:open',
  floatClose: 'floatAttribution:close',
  floatLog: 'floatAttribution:log',
  /** 批次7：渲染层任何动作的统一留痕通道（单向，fire-and-forget） */
  logWrite: 'log:write',
  /** 批次17：程序运行日志窗口尾读 actions.log（只读，轮询不写日志；批次19 起由日志记录页使用） */
  logTail: 'log:tail',
  // ── L0 密钥环（§4.4）：DEK 只在主进程；渲染层只能经这些通道请求加密/解密/授权 ──
  l0Status: 'l0:status',
  l0Setup: 'l0:setup',
  l0ChangePassword: 'l0:changePassword',
  l0Request: 'l0:requestAccess',
  l0ListRequests: 'l0:listRequests',
  l0ListGrants: 'l0:listGrants',
  l0Grant: 'l0:grant',
  l0Deny: 'l0:deny',
  l0Revoke: 'l0:revoke',
  l0Unlock: 'l0:unlock',
  l0Heartbeat: 'l0:heartbeat',
  l0Lock: 'l0:lock',
  l0WriteUnlock: 'l0:writeUnlock',
  l0WriteLock: 'l0:writeLock',
  l0Seal: 'l0:seal',
  l0Decrypt: 'l0:decrypt',
  l0SessionInfo: 'l0:sessionInfo',
  l0Migrate: 'l0:migrate',
  /** 批次24：遗留账本清理（未接 LLM 却带 L2–L6 的历史行降级回 L1）——只读预览 / 管理员执行 */
  legacyScan: 'legacy:scan',
  legacyDemote: 'legacy:demote',
  /** 批次26-B P1-3：租户三元组由主进程按会话下发（渲染层不再自报 mam.tenant.v1） */
  tenantGet: 'tenant:get',
} as const;

/** preload 实际暴露的全部 channel（自检基线） */
export const PRELOAD_CHANNELS: readonly string[] = Object.values(IPC);

/** 返回 preload 声明了但主进程未注册的 channel（空数组 = 覆盖完整） */
export function missingChannels(registered: Iterable<string>): string[] {
  const have = new Set(registered);
  return PRELOAD_CHANNELS.filter((c) => !have.has(c));
}

export interface BootFailureDeps {
  log: (err: unknown) => void;
  showError: (title: string, message: string) => void;
  exit: (code: number) => void;
}

export function formatBootFailure(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message;
  return String(err);
}

/** 启动失败唯一出口：日志 + 弹窗 + 退出；绝不让进程变成无窗口僵尸 */
export function handleBootFailure(err: unknown, deps: BootFailureDeps): void {
  deps.log(err);
  try {
    deps.showError('MultiAgent Memory 启动失败', `应用启动失败：${formatBootFailure(err)}`);
  } catch {
    /* 弹窗不可用（无 GUI/初始化失败）时仍必须退出 */
  }
  deps.exit(1);
}
