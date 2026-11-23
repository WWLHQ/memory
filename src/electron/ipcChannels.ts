// preload 暴露的 IPC channel 清单（唯一真源）。
// main 启动完成后据此自检：preload 声明了但主进程未注册的 channel 必须让启动失败，
// 否则渲染层拿到的是「永远 reject 的桥」（历史上 hostScan:run 就踩过这个坑）。

export const IPC = {
  storagePutMemory: 'storage:putMemory',
  storageGetMemory: 'storage:getMemory',
  storageListMemories: 'storage:listMemories',
  storageDeleteMemory: 'storage:deleteMemory',
  storageAppendAudit: 'storage:appendAudit',
  storageQueryAudit: 'storage:queryAudit',
  storageCreateProject: 'storage:createProject',
  storageGetProject: 'storage:getProject',
  storageListProjects: 'storage:listProjects',
  storageLocation: 'storage:location',
  storageOpenMemoryFile: 'storage:openMemoryFile',
  hostScanRun: 'hostScan:run',
  hostAgentDetectRun: 'hostAgentDetect:run',
  hostAgentDetectConfig: 'hostAgentDetect:config',
  /** 批次15：MCP 客户端接入状态 / 片段 / 一键写入 / 一键打开客户端开关 */
  mcpClients: 'mcp:clients',
  mcpClientSnippet: 'mcp:clientSnippet',
  mcpClientWire: 'mcp:clientWire',
  mcpClientEnable: 'mcp:clientEnable',
  collectorTriggerNow: 'collector:triggerNow',
  collectorStatus: 'collector:status',
  /** 网页版对话导出目录（chat-exports）：渲染层读真实路径 / 打开目录（引导插件设置用） */
  chatExportsGet: 'chatExports:get',
  chatExportsOpen: 'chatExports:open',
  /** 更改导出目录：弹系统目录选择框，持久化到 userData/chat-exports.json，采集源即时生效 */
  chatExportsSet: 'chatExports:set',
  /** 跟随插件落点：把采集目录改成探测到的「插件真实写入位置」（浏览器下载目录/chat-exports） */
  chatExportsFollow: 'chatExports:follow',
  chatExportsSites: 'chatExports:sites',
  webchatExportStatus: 'webchatExport:status',
  /** 网页对话导出完整性审计：跑一次「导出文档 vs 原对话」逐条比对，出人话报告 */
  webchatAuditRun: 'webchatAudit:run',
  /** 按来源清理「旧格式网页导出条目」（重导前/后的噪声清理）：预览只读、执行前强制备份 */
  webchatPurgePreview: 'webchatPurge:preview',
  webchatPurgeRun: 'webchatPurge:run',
  /** 自研网页对话导出插件：读随包分发的插件目录 / 打开目录 / 打开浏览器扩展管理页（一键增加插件） */
  webchatExtGet: 'webchatExt:get',
  webchatExtOpenFolder: 'webchatExt:openFolder',
  webchatExtOpenBrowser: 'webchatExt:openBrowser',
  backupGetConfig: 'backup:getConfig',
  backupSaveConfig: 'backup:saveConfig',
  backupChooseDir: 'backup:chooseDir',
  backupRunNow: 'backup:runNow',
  backupList: 'backup:list',
  dataRootGet: 'dataRoot:get',
  dataRootOpen: 'dataRoot:open',
  dataRootChange: 'dataRoot:change',
  dataRootRestoreDefault: 'dataRoot:restoreDefault',
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
  /** §4.4.4-B：管理员为成员发放 / 撤销写解锁口令（需管理员 + 先解锁写密钥） */
  l0AddMemberWriteWrap: 'l0:addMemberWriteWrap',
  l0RemoveMemberWriteWrap: 'l0:removeMemberWriteWrap',
  /** §4.4.4-B：查「本账号」是否已有写解锁口令（需登录；只回布尔，member_id 取会话账号，不由页面自报） */
  l0MyWriteWrap: 'l0:myWriteWrap',
  /** 写密钥是否在内存（**只回一个布尔、不需要登录**）：写锁是进程级全局事实，
   *  任何页面（含未登录的首页文档）都该读到真值，不能因为没会话就判「未解锁」 */
  l0WriteUnlocked: 'l0:writeUnlocked',
  l0Seal: 'l0:seal',
  l0Decrypt: 'l0:decrypt',
  l0SessionInfo: 'l0:sessionInfo',
  l0Migrate: 'l0:migrate',
  /** 批次37-A：L0 原数据库批量回读（拆库后行上只有 has_l0，查阅要在主进程取密文）——需登录会话 */
  l0Blobs: 'l0:blobs',
  /**
   * S5 / D6：MCP 写入兜底队列（L0 写密钥锁定期间暂存的 write_memory）只读摘要。
   * 只回计数与可排查字段（id/时间/项目/来源/字数/评分），绝不含正文、密钥材料或整条请求；需登录会话。
   */
  l0PendingWrites: 'l0:pendingWrites',
  /** 批次37-C：存量拆分迁移（历史行的明文 content_orig / 遗留信封搬进 L0 原数据库）——只读预览 / 管理员执行（强制先双库备份 + 逐字口令 + 需 L0 写密钥） */
  l0SplitPreview: 'l0:splitPreview',
  l0SplitRun: 'l0:splitRun',
  /**
   * 批次37-E：按 L0 原文重建 L1–L6（不重新采集，用库里已有的 L0 重炼可检索层）。
   * 预览需登录会话（会真读原文，但不写盘）；执行需管理员 + 逐字口令 REBUILD + 强制先双库备份。
   * 原文是密文时必须带管理员的 l0_session_id（§4.4.2 归属校验），否则那些行判 view_locked、如实不碰。
   */
  l0RebuildPreview: 'l0:rebuildPreview',
  l0RebuildRun: 'l0:rebuildRun',
  /**
   * L0-first 拦截标记（2026-11-17 用户拍板）：质量门拦截条目在主 L0 库以 bak_* 键留标记。
   * 列表/统计需登录会话（本人看自己的，管理员看全部）；查阅需本人或管理员且 L0 密钥已解锁；
   * 人工重判：解密 → 重跑质量门 → 通过即正常入库并收掉标记条目。
   */
  l0FilteredList: 'l0:filteredList',
  l0FilteredView: 'l0:filteredView',
  l0FilteredRejudge: 'l0:filteredRejudge',
  /**
   * 口径一本人直读（2026-11-17 用户拍板）：解锁写密钥后免审批、免 grant、免查阅会话直读本人 L0 原文。
   * 归属校验在主进程（blob.owner_user_id === 当前登录账号）；旧数据无归属 → 明确拒绝不猜；
   * 查阅他人一律拒（须申请授权 §4.4.2）。
   */
  l0SelfView: 'l0:selfView',
  l0SelfBrowse: 'l0:selfBrowse',
  /**
   * 存量 L0 归属回填（2026-11-17 用户拍板）：归属元数据上线前落的存量 blob 全部无 owner（实测 3852 条），
   * 本人直读对无归属条目 fail-closed 跳过 → 旧数据永远读不出。回填 = 把无归属条目归属到
   * 当前执行操作的管理员账号（单成员库事实成立）；预览仅登录可见（只回数字统计），
   * 执行需管理员 + 写密钥已解锁 + 先给 L0 库文件做 .bak 备份。
   */
  l0OwnerBackfillPreview: 'l0:ownerBackfillPreview',
  l0OwnerBackfillRun: 'l0:ownerBackfillRun',
  /**
   * 批次37-G：L0 恢复码（忘记管理密码时唯一的找回通道，一次性）。
   * 状态只回「有没有/指纹/时间」；发码/找回/换发都只在返回值里出现码明文一次；
   * 导出走主进程原生「另存为」，卡面不落数据根。全部仅管理员。
   */
  l0RecoveryStatus: 'l0:recoveryStatus',
  l0RecoveryInit: 'l0:recoveryInit',
  l0RecoveryIssue: 'l0:recoveryIssue',
  l0Recover: 'l0:recover',
  l0RecoveryExport: 'l0:recoveryExport',
  /**
   * 批次37-B：首启强制向导（setup.html，登录之前）。
   * 不要求会话，但门禁换成「本机此刻还没有需要保护的东西」：
   * 设 L0 管理密码只在密钥环尚无 admin_wrap 时放行（那时库里没有任何密文，设密码不构成越权）；
   * 一旦 admin_wrap 存在，改密码/发码一律回到 l0:recovery* 的管理员口径。
   */
  setupState: 'setup:state',
  /** 向导内改选两库位置（重选后要重启才生效：路径在 app ready 前解析） */
  setupReselectDirs: 'setup:reselectDirs',
  setupSetL0Password: 'setup:setL0Password',
  /** 密码已设但恢复卡没导出就重启了：用管理密码当场解锁换发一张新码（向导内的唯一出路） */
  setupRegenCode: 'setup:regenCode',
  setupExportCard: 'setup:exportCard',
  setupFinish: 'setup:finish',
  /**
   * 批次58：向导新增两个**可选**步骤，共用同一条「向导还没走完」的本机判据（指针 setupDone !== true）。
   * 走完之后这些通道一律拒绝——备份与模型的正规入口回到备份卡（`backup:*` 需管理员）与参数页（`llm:*` 需管理员）。
   */
  setupChooseBackupDir: 'setup:chooseBackupDir',
  setupSetBackup: 'setup:setBackup',
  setupLlmTest: 'setup:llmTest',
  setupLlmSave: 'setup:llmSave',
  /** 明确「不加精炼模型」——落指针 llmSkipped，进度卡显示「已跳过」而不是「待完成」 */
  setupSkipLlm: 'setup:skipLlm',
  /** 批次24：遗留账本清理（未接 LLM 却带 L2–L6 的历史行降级回 L1）——只读预览 / 管理员执行 */
  legacyScan: 'legacy:scan',
  legacyDemote: 'legacy:demote',
  /** 批次35：记忆库清空重采（无意义噪声已入库的行只能整库重来）——只读预览 / 管理员执行（强制先备份 + 清游标 + 追采） */
  ledgerResetPreview: 'ledger:resetPreview',
  ledgerResetRecollect: 'ledger:resetRecollect',
  /** 批次36-C：存量按当前质量门重判（规则收紧后已落库的噪声行不会自己变干净）——只读预览 / 管理员执行（强制先备份 + 逐字口令） */
  rulesRejudgePreview: 'rules:rejudgePreview',
  rulesRejudgeRun: 'rules:rejudgeRun',
  /** 批次41-T：存量补齐缺失的 sha256 / 向量（`sha256` 随提交 `843282c` 才引入，之前的历史行行上是空的）——只读预览 / 管理员执行（强制先备份）。**无逐字口令**：不删行、不改正文、不动层级与 version，与 REJUDGE/RESET/REBUILD 不同类。 */
  ledgerFieldsPreview: 'ledger:fieldsPreview',
  ledgerFieldsBackfill: 'ledger:fieldsBackfill',
  /** 批次26-B P1-3：租户三元组由主进程按会话下发（渲染层不再自报 mam.tenant.v1） */
  tenantGet: 'tenant:get',
  /** OB（个人记忆账号绑定 UI 化）：read 登录可读；set 仅管理员（逐字口令 BIND + 备份 + 审计，重启生效） */
  ownerBindingsRead: 'owner-bindings:read',
  ownerBindingsSet: 'owner-bindings:set',
  /**
   * T2（管理员与成员权限设计 §6.1）：机器级 tenant.json 三读一写。
   * tenant:read（需登录）读的是机器级真源文件，**不得用 tenant:get 代替**——后者返回登录会话三元组，
   * 两套值（本机：会话侧 local/admin-team vs 内核侧 u1/t1/e1），混用会让管理员看到的和编辑的不是同一份。
   * tenant:set（仅管理员 + 逐字口令 TENANT + 写前备份 + 审计）改 tenant.json，重启后生效；
   * tenant:normalize（仅管理员 + 强制备份）按 45-A2 口径把存量账本行归一到 tenant.json 规范值。
   */
  tenantRead: 'tenant:read',
  tenantSet: 'tenant:set',
  tenantNormalize: 'tenant:normalize',
  /** 批次31：LLM 精炼网关 —— 配置读/写（写需管理员）、连通真拨测（管理员）、逐层精炼代理（内核写路径经此走主进程 HTTP） */
  llmConfigGet: 'llm:config',
  llmConfigSet: 'llm:configSet',
  llmTest: 'llm:test',
  llmRefine: 'llm:refine',
  /** 批次48 A31：厂商余额查询（需会话；force=true 为页面手动刷新，绕过 10 分钟 TTL；余额查询不写 llm_proxy 审计） */
  llmBilling: 'llm:billing',
  /** 批次48 A31：独立 billing 凭据写入/清除（仅管理员；返回值只含 keySet 布尔，绝不含凭据明文） */
  llmBillingKey: 'llm:billingKey',
  /** 批次62：硬前置召回 A/B/C 三层开关 —— 状态需会话（读真值）；保存仅管理员（会改宿主配置 / 起停网关 / 切门禁） */
  recallHardState: 'recallHard:state',
  recallHardSet: 'recallHard:set',
  /** 阶段 A：托盘常驻 / 开机自启 —— 状态读真值（含系统是否真写入登录项），保存改本机壳层行为 */
  appShellState: 'appShell:state',
  appShellSet: 'appShell:set',
  /** 阶段 B：网页会话无头自动采集 —— 状态 / 开关与周期 / 立即采一轮 / 打开登录窗口（均需会话） */
  webchatAutoState: 'webchatAuto:state',
  webchatAutoSet: 'webchatAuto:set',
  webchatAutoRun: 'webchatAuto:run',
  /** 补齐历史：按游标把侧栏剩下的会话分批采完（一次性补历史，之后回增量） */
  webchatAutoSweep: 'webchatAuto:sweep',
  webchatAutoLogin: 'webchatAuto:login',
  /** 原子任务 B：监控仪表盘只读聚合（Agent 健康 + 写入率 + 校验异常）；公开观测，不需会话 */
  monitorStats: 'monitor:stats',
  /** 批次39：L2–L6 后台补炼队列 —— 状态（需会话）/ 开关与补炼与重试失败行（仅管理员） */
  refineState: 'refine:state',
  refineSetEnabled: 'refine:setEnabled',
  refineBackfill: 'refine:backfill',
  refineRetryFailed: 'refine:retryFailed',
  /** 批次41-I 后续：设置补炼每日额度（限额/不限额 + 行数），仅管理员 */
  refineSetCap: 'refine:setCap',
  /** 批次42-B：云端同步中枢（主进程 PgSyncHub，dataDir=sync-hub/）——上行/下行/对账/冲突列表/审计游标需会话；人工裁决（resolve）需管理员 */
  syncPush: 'sync:push',
  syncPull: 'sync:pull',
  syncReconcile: 'sync:reconcile',
  syncConflicts: 'sync:conflicts',
  syncResolve: 'sync:resolve',
  syncCursor: 'sync:cursor',
  syncAuditCount: 'sync:auditCount',
  syncAuditsFrom: 'sync:auditsFrom',
  /**
   * 第一轮个人记忆本机闭环：独立存储（personal-memory.db.json）的单一数据面。
   * 参数 (op, payload, sessionId)；owner 由主进程按会话解析，渲染层不得自报。
   */
  personalInvoke: 'personal:invoke',
  /**
   * 顶部自绘标题栏（批次48 S10）：把壳层当前主题同步给主进程的窗口按钮覆盖层。
   * 只改系统绘制的三个窗口按钮的底色/符号色，不接管按钮行为（最小化/最大化/关闭仍由系统完成）。
   */
  shellTitleBarTheme: 'shell:titleBarTheme',
} as const;

/**
 * 主进程 → 壳层的快捷键事件通道（批次48 S10 建；v5 重设计扩展）。
 * 默认应用菜单删除后，快捷键可能在焦点位于 iframe 页面时按下，壳层 window 收不到 keydown；
 * 因此由主进程 before-input-event 统一捕获，再交给壳层渲染层执行动作。
 * v5 新增：dock（Ctrl+`）/ nav（Ctrl+B）/ quick1..quick8（Ctrl+1..8 切换前 8 个视图）。
 * v5-BC 新增：inspector（Ctrl+Shift+I 折叠/展开右侧属性检查器）。
 */
export const SHELL_SHORTCUT_CHANNEL = 'shell:shortcut';
export type ShellShortcut =
  | 'refresh' | 'search' | 'help' | 'security'
  | 'dock' | 'nav' | 'inspector' | 'quick1' | 'quick2' | 'quick3' | 'quick4'
  | 'quick5' | 'quick6' | 'quick7' | 'quick8';

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
