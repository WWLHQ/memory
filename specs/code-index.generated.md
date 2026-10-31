# 代码索引（自动生成）

> 由 `npm run code:index` 生成，请勿手改；改代码后重跑即可。
> 用法：先在本表定位文件与导出符号，再只读该文件的局部区间（省 token、少误改）。

共 281 个源码文件。

## e2e

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [e2e/dev-server.ts](e2e/dev-server.ts) | 49 | 人工实页测试用：零依赖静态服务（镜像 e2e/servers.ts，端口 8127） | — |
| [e2e/global-setup.mjs](e2e/global-setup.mjs) | 129 | 启动一个 detached 的 Chromium（headless，开 CDP 端口），供 E2E 用 connectOverCDP 连接。 | — |
| [e2e/global-teardown.mjs](e2e/global-teardown.mjs) | 24 | 关闭 globalSetup 启动的 detached Chromium。taskkill/进程信号被安全策略拦截时静默失败： | — |
| [e2e/harness.ts](e2e/harness.ts) | 86 | E2E 测试基座：覆盖 page fixture，改用「外部已启动的 Chromium（CDP 连接）」。 | disconnectBrowser(fn), collectErrors(fn), test(const) |
| [e2e/run.mjs](e2e/run.mjs) | 26 | E2E 启动器：① 构建被测产物（vite build → dist/）② 以空 NODE_OPTIONS 拉起 Playwright。 | — |
| [e2e/servers.ts](e2e/servers.ts) | 108 | E2E 用：进程内静态文件服务器 + 复用真实后端，避免 Playwright webServer 子进程在 Windows 上卡 teardown。 | startStatic(fn), startHomeBackend(fn), closeServer(fn), stopRunningServer(fn), StaticServer(type) |

## src/agentOnboard

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/agentOnboard/client.ts](src/agentOnboard/client.ts) | 110 | Agent 接入 HTTP 客户端（REQ-003 接真实后端 · T14） | AgentOnboardClient(class) |
| [src/agentOnboard/formMatrix.ts](src/agentOnboard/formMatrix.ts) | 35 | 按端置灰矩阵 (REQ-003 §9 / 19.10 / T10) | signalSourcesForForm(fn), isSourceGrayed(fn), SIGNAL_SOURCES(const), SignalSource(type) |
| [src/agentOnboard/mcpClients.ts](src/agentOnboard/mcpClients.ts) | 393 | MCP 客户端接入配方（批次15）：单一真源。 | specOfMcpClient(fn), buildMcpEntry(fn), renderMcpSnippet(fn), probeJsonConfig(fn), probeTomlConfig(fn), probeClientConfig(fn), mergeMcpJsonConfig(fn), mergeMcpTomlConfig(fn), MCP_ENDPOINT(const), MCP_CLIENT_SPECS(const), McpClientSpec(type), McpConfigProbe(type), McpClientId(type), McpConfigFormat(type), McpEntryStyle(type), McpWireState(type) |
| [src/agentOnboard/probe.ts](src/agentOnboard/probe.ts) | 38 | Agent 接入真实拨测（Phase C2）：以「本机安装痕迹」为唯一真相。 | createHostAgentProbe(fn), HostAgentProbeOptions(type) |
| [src/agentOnboard/server.ts](src/agentOnboard/server.ts) | 288 | Agent 接入真实后端（REQ-003 接真实后端 · T13） | createServer(fn), RunningServer(type) |
| [src/agentOnboard/service.ts](src/agentOnboard/service.ts) | 343 | Agent 接入服务层(REQ-003 T11 集成 / T12 E2E 链路) | AgentOnboardService(class), OnboardBackend(type), ConfigureResult(type), TestResult(type), RotateResult(type), ProbeResult(type), OnboardServiceOptions(type), OneClickResult(type), AuditEntry(type), DiscoverInput(type), AgentProbe(type) |
| [src/agentOnboard/stateMachine.ts](src/agentOnboard/stateMachine.ts) | 66 | Agent 接入卡片状态机 (REQ-003 §0 页面状态 / T2) | transition(fn), TRANSITIONS(const), CardEvent(type) |
| [src/agentOnboard/validators.ts](src/agentOnboard/validators.ts) | 116 | Agent 接入配置校验器 (REQ-003 §6 校验规则 R1-R6 / §7 边界约束 R1-R10 / T9) | checkR1_tenantNotHandFilled(fn), checkR2_projectIdRequired(fn), checkR3_criticalNoMinimal(fn), checkR4_dualChannelAtLeastOne(fn), checkR5_keyNotReflected(fn), checkR6_circuitDegrade(fn), checkR7_requestIdAudit(fn), checkR8_oneClickReadOnly(fn), checkR9_autoBindRevocable(fn), checkR10_discoverLocalOnly(fn), validateOnboard(fn), Violation(type) |

## src/auth

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/auth/hash.ts](src/auth/hash.ts) | 42 | REQ-005 T2：密码哈希与校验（规格 §4.1 安全） | hashPassword(fn), verifyPassword(fn) |
| [src/auth/loginService.ts](src/auth/loginService.ts) | 301 | REQ-005 T3：登录业务逻辑 + 锁定策略（规格 §0.3 / §4.2 / §4.3） | registerAccount(fn), hasAccount(fn), resetAuthStore(fn), exportAccountSnapshot(fn), importAccountSnapshot(fn), listAccounts(fn), adminCount(fn), isDefaultAdminPasswordInUse(fn), seedAdminAccount(fn), changePassword(fn), setAccountRole(fn), assignAccountTeam(fn), lockoutState(fn), exportLockSnapshot(fn), readLockState(fn), writeLockState(fn), clearLockState(fn), importLockSnapshot(fn), login(fn), LOCK_THRESHOLD(const), LOCK_WINDOW_MS(const), ADMIN_ACCOUNT(const), DEFAULT_ADMIN_PASSWORD(const), AccountView(type) |

## src/core

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/core/memagent/agent.ts](src/core/memagent/agent.ts) | 408 | createMemAgent（§1 入口）：内核装配 + 9 核心API + 全动作审计（§3.2） | createMemAgent(fn) |
| [src/core/memagent/crypto.ts](src/core/memagent/crypto.ts) | 330 | L0 加密层（§4.1）：AES-256-GCM + PBKDF2 派生密钥。 | encryptL0(fn), parseL0Envelope(fn), decryptL0(fn), randomBytes(fn), generateDek(fn), newWrapSalt(fn), deriveKek(fn), wrapSecret(fn), unwrapSecret(fn), encryptL0WithKey(fn), parseL0EnvelopeV2(fn), decryptL0WithKey(fn), L0_KEK_ITER(const), L0_DEK_BYTES(const), MASK(const), L0_KEY_BYTES(const), L0Envelope(type), L0EnvelopeV2(type), L0Wrap(type) |
| [src/core/memagent/dedup.ts](src/core/memagent/dedup.ts) | 192 | 五维查重（§6.1）：语义 35% / 关键词 20% / 实体 15% / 结构 10% / LLM 仲裁 20%。 | layerText(fn), keywordSet(fn), entitySet(fn), structuralSimilarity(fn), baseDimensionScores(fn), fourDimScore(fn), fiveDimScore(fn), findDuplicate(fn), JUDGE_TOP_N(const), DimensionScores(type), DedupEvaluation(type), DedupOutcome(type), DedupOptions(type) |
| [src/core/memagent/errors.ts](src/core/memagent/errors.ts) | 15 | memagent-core 错误码（§6，各端统一处理） | MemAgentError(class) |
| [src/core/memagent/fileStorage.ts](src/core/memagent/fileStorage.ts) | 379 | FileStorage（§5.3）：桌面/CLI 本地库 = P0 主源（零依赖，纯文件系统，无 node:sqlite）。 | StorageCorruptError(class), StorageLockedError(class), FileStorage(class), CorruptionNotice(type), FileStorageOptions(type) |
| [src/core/memagent/forgetting.ts](src/core/memagent/forgetting.ts) | 297 | REQ-010 遗忘机制后台任务（17.4–17.11）：新鲜度/打分/层迁移/合并摘要/周期任务 | policyFor(fn), freshnessOf(fn), scoreMemory(fn), hardFilter(fn), classifyLayer(fn), forgetOne(fn), restoreOne(fn), reinforceOne(fn), buildSummary(fn), runForgettingCycle(fn), SCORE_WEIGHTS(const), ForgettingPolicy(type), ForgettingCycleReport(type), ForgettingOptions(type), SummaryBuildResult(type) |
| [src/core/memagent/l0vault.ts](src/core/memagent/l0vault.ts) | 801 | L0Vault（§4.4）：主进程独占的 L0 密钥环 —— DEK 只在内存，密码经 PBKDF2 派生 KEK 包裹 DEK。 | L0_IDLE_TIMEOUT_MS(const), L0_MAX_FAILURES(const), L0_LOCK_MS(const), L0_MIN_SECRET_LEN(const), L0Vault(class), L0GrantRecord(type), L0RequestRecord(type), L0Keyring(type), L0KeyringStore(type), L0LockState(type), L0LockStore(type), L0AuditSink(type), L0VaultOptions(type), L0SessionInfo(type) |
| [src/core/memagent/layerRules.ts](src/core/memagent/layerRules.ts) | 196 | 层级规则单一真源（§2.1/§2.2/§6.1/§6.2/§16.1/§4.4）：每层规格、查重阈值/权重、L0 授权常量、L1 脱敏与规格校验。 | layerSpecOf(fn), meaningfulLength(fn), sanitizeL1(fn), checkLayerSpec(fn), LAYER_ORDER(const), LAYER_SPECS(const), DEDUP_THRESHOLDS(const), DEDUP_WEIGHTS(const), DEDUP_WEIGHTS_NO_LLM(const), L0_POLICY(const), MIN_MEANINGFUL_CHARS(const), LayerSpec(type), RefineLayer(type) |
| [src/core/memagent/legacyLayers.ts](src/core/memagent/legacyLayers.ts) | 164 | 遗留账本清理（批次24）：把「未接真实 LLM 却带 L2–L6」的历史行诚实降级回 L1。 | isStubDeepLayered(fn), isMislabeledLayer(fn), scanStubLayers(fn), demoteStubLayers(fn), LegacyScan(type), LegacyDemoteReport(type), LegacyDemoteCtx(type) |
| [src/core/memagent/llm.ts](src/core/memagent/llm.ts) | 72 | LlmProvider（§5.1）+ 内核统一反代理路由（19.8：先免费 → 后低价 ≤ price_cap → cost_cap → 回退本地） | routeProxy(fn), FakeLlmProvider(class), ProxyPick(type) |
| [src/core/memagent/mcp.ts](src/core/memagent/mcp.ts) | 299 | MCP Server（§19.5）：JSON-RPC 2.0 over TCP，暴露记忆工具，供 Agent 调用记忆助手。 | runMcpServer(fn), McpOptions(type), McpServerHandle(type) |
| [src/core/memagent/mcpAuth.ts](src/core/memagent/mcpAuth.ts) | 56 | MCP 鉴权：MCP 端口只对持有本机令牌的 Agent 开放。 | projectInScope(fn), tokenEquals(fn), tokenFromHeaders(fn), assertMcpToken(fn), MCP_TOKEN_HEADER(const), DEFAULT_MCP_ACCOUNT(const), McpAccount(type) |
| [src/core/memagent/mcpHttp.ts](src/core/memagent/mcpHttp.ts) | 325 | 标准 MCP（Model Context Protocol）streamable-http 服务器 | normalizeClientLabel(fn), clientFromInitialize(fn), clientFromUserAgent(fn), recallEchoNote(fn), runMcpHttpServer(fn), McpHttpOptions(type), McpHttpHandle(type) |
| [src/core/memagent/mcpRecall.ts](src/core/memagent/mcpRecall.ts) | 170 | MCP 召回工具编排（批次11/13）：项目自动定位 / 列表 / 提示行与折叠明细组装。 | clientSupportsHtmlDetails(fn), projectInfosFromMemories(fn), resolveProjectId(fn), runRecallTool(fn), runListProjectsTool(fn), McpToolError(class), ProjectInfo(type), ResolvedProject(type), RecallToolPayload(type), RecallToolOutput(type) |
| [src/core/memagent/mcpSchema.ts](src/core/memagent/mcpSchema.ts) | 66 | MCP 工具清单与初始化指令（批次11/12/13）：HTTP(8204) 与 TCP(8202) 共用同一份 schema/instructions， | MCP_INSTRUCTIONS(const), MCP_TOOLS(const) |
| [src/core/memagent/memories.ts](src/core/memagent/memories.ts) | 615 | 内核记忆业务（§3 schema + 行为红线）：write 逐层生成/查重/分支嫁接 / browse L0 授权 / gc 衰减 / memoryOp 17.3 操作 | coreWrite(fn), coreBrowse(fn), coreGc(fn), coreMemoryOp(fn), coreFeedback(fn), WriteInput(type), WriteCtx(type) |
| [src/core/memagent/paramsSnapshot.ts](src/core/memagent/paramsSnapshot.ts) | 38 | 全局参数快照（params:v1: preference 记忆）的共享读取口。 | parseParamsSnapshot(fn), findParamsSnapshot(fn), autoOrganizeEnabled(fn), PARAMS_PREF_PREFIX(const), ParamsSnapshot(type) |
| [src/core/memagent/pgSyncHub.ts](src/core/memagent/pgSyncHub.ts) | 250 | PgSyncHub（REQ-008 §2 服务端中枢 Postgres 落地）：与内存版 SyncHub 接口同构、语义一致。 | PgSyncHub(class) |
| [src/core/memagent/qualityGate.ts](src/core/memagent/qualityGate.ts) | 328 | L0→L1 质量过滤器（§2.1 清洗红线）：拦截无用/低质信息，禁止其进入 L1 污染记忆库。 | checkL0ToL1Quality(fn), filteredAuditDetail(fn), QualityCheckResult(type) |
| [src/core/memagent/recallInsight.ts](src/core/memagent/recallInsight.ts) | 327 | 召回洞察（批次11/13）：项目背景筛选 / 省量核算 / 聊天窗口提示行与累计金额的唯一纯函数真源。 | selectRecallBackground(fn), corpusTokens(fn), computeRecallSavings(fn), localDayStart(fn), rollupRecalls(fn), formatCny(fn), normalizeUnitPrice(fn), buildRecallHint(fn), buildRecallMarkdown(fn), estTokens(const), BACKGROUND_MAX_ITEMS(const), BACKGROUND_ITEM_CHARS(const), BACKGROUND_MAX_TOKENS(const), RecallRollup(type), RecallMoneyBlock(type), RecallMoney(type), RecallHint(type), RecallMarkdownOpts(type) |
| [src/core/memagent/sessionCollector.ts](src/core/memagent/sessionCollector.ts) | 821 | 自有 Agent 会话自动采集器（§5.1 双链路补偿 · P0 自有形态，可调周期对账，预设 5min） | parseClaudeJsonl(fn), parseWorkbuddyMd(fn), parseDshProjcache(fn), scanSessionLogs(fn), createReconciler(fn), defaultAgentSources(fn), applyScanToStore(fn), ParsedMessage(type), SessionLogSource(type), FileCursor(type), CollectorCursor(type), CollectedItem(type), ScanResult(type), ScanOptions(type), ReconcileOptions(type), Reconciler(type), DefaultSourcesOpts(type), CollectorBridgeOpts(type), ApplyScanResult(type), LineParser(type), BlockParser(type) |
| [src/core/memagent/sqliteStorage.ts](src/core/memagent/sqliteStorage.ts) | 131 | SqliteStorage（§5.3）：桌面/CLI 本地库 = P0 主源（需求规格书 §2 端壳注入、§5.3 存储端点表）。 | SqliteStorage(class) |
| [src/core/memagent/storage.ts](src/core/memagent/storage.ts) | 91 | StorageBackend 接口实现（§5.3）：InMemoryStorage 用于测试/演示； | InMemoryStorage(class) |
| [src/core/memagent/sync.ts](src/core/memagent/sync.ts) | 371 | REQ-008 云同步（同步机制详细设计 §1–§8）：sha256 幂等 + 向量时钟 LWW + SyncHub 中枢 + 三端引擎 | sha256hex(fn), vcCompare(fn), vcTick(fn), stampForSync(fn), syncUp(fn), syncDown(fn), reconcile(fn), filterSyncAudits(fn), SyncHub(class), SyncConflict(type), SyncAudit(type), SyncUpReport(type), VClock(type), PushOutcome(type), AnySyncHub(type) |
| [src/core/memagent/types.ts](src/core/memagent/types.ts) | 689 | memagent-core 契约类型（REQ-007 §1/§2/§3/§5/§6 直译，19.10/19.11） | isCategory(fn), CATEGORIES(const), Account(type), RefinedLayers(type), RecallReq(type), Hit(type), Budget(type), RecallBackgroundItem(type), RecallBackground(type), RecallSavings(type), RecallResult(type), MemReq(type), WriteResult(type), LayerDecision(type), GcReq(type), GcReport(type), Pref(type), DiscoverReq(type), DiscoveredAgent(type), DiscoverResult(type), SyncReq(type), SyncReport(type), BrowseReq(type), BrowseRow(type), BrowseResult(type), L0Port(type), L0AccessRequest(type), L0AccessRequestResult(type), L0GrantReq(type), L0GrantView(type), L0GrantResult(type), L0RequestView(type), L0UnlockReq(type), L0UnlockResult(type), L0HeartbeatResult(type), L0VaultStatus(type), L0MigrationReport(type), L0MigrationResult(type), L0AdminPort(type), LogReq(type), LogItem(type), LogPage(type), AuditRef(type), AuditRecord(type), Memory(type), MemOpPatch(type), MemOpResult(type), FeedbackResult(type), ModelInfo(type), LlmCallCtx(type), LlmResp(type), LlmProvider(type), Filter(type), Scored(type), VectorBackend(type), StorageBackend(type), MemAgentOptions(type), MemAgent(type), MemAgentSeedHooks(type), Form(type), Layer(type), DecayClass(type), Category(type), RecallMode(type), Scene(type), ErrorCode(type), DiscoverSignal(type), L0GrantStatus(type), AuditAction(type), MemOp(type), FeedbackKind(type) |
| [src/core/memagent/ulid.ts](src/core/memagent/ulid.ts) | 47 | 简易 ULID：48bit 时间戳 + 80bit 随机（crypto 级），同毫秒内单调递增（契约 §3.1） | ulid(fn) |
| [src/core/memagent/vector.ts](src/core/memagent/vector.ts) | 89 | VectorBackend（§5.2）：JsVectorBackend 起步实现（hash bag-of-words + cosine）； | tokenize(fn), embedSync(fn), cosine(fn), DEFAULT_VECTOR_DIM(const), JsVectorBackend(class) |
| [src/core/memagent/webhook.ts](src/core/memagent/webhook.ts) | 202 | Webhook 接收端（§19.3 主通道 / §5.4 SHA-256 幂等保真） | createWebhook(fn), HashIndex(class), IngestEvent(type), IngestResult(type), WebhookOptions(type), WebhookServer(type) |

## src/desktop

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/desktop/hostBridge.ts](src/desktop/hostBridge.ts) | 305 | 宿主桥（iframe 场景）：把 preload 能力透传给概览页 iframe 内的子页面。 | hostLog(fn), handleBridgeMessage(fn), isEmbedded(fn), installHostBridge(fn), hostCall(fn), hostCapability(fn), HostLogOptions(type), HostMethod(type) |
| [src/desktop/hostScan.ts](src/desktop/hostScan.ts) | 185 | 宿主真扫（discover 真实化）· 纯类型 + 纯匹配层（零 node 依赖，可安全打进浏览器包）。 | matchAgentsFromProcesses(fn), matchAgentsFromMcp(fn), matchAgentsFromConfigFiles(fn), mergeHostAgents(fn), AGENT_FINGERPRINTS(const), AgentFingerprint(type), HostAgentFound(type), HostScanResult(type), HostScanApi(type) |
| [src/desktop/ipcStorage.ts](src/desktop/ipcStorage.ts) | 93 | 桌面端存储桥接（Electron 渲染进程侧）：把内核 StorageBackend 接口经 preload 暴露的 | IpcStorageBackend(class), StorageIpc(type) |

## src/electron

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/electron/actionLog.ts](src/electron/actionLog.ts) | 188 | 主进程动作日志（批次7）：把 shared/actionLog 的条目追加到 <数据根>/actions.log。 | initActionLog(fn), actionLogPath(fn), actionLog(fn), actionLogError(fn), tailActionLog(fn), resetActionLog(fn), ActionLogInitOptions(type) |
| [src/electron/agentDetect.ts](src/electron/agentDetect.ts) | 322 | 本机 Agent 检测 · 后续扩展（2026-10-24）· 主进程 node 层（仅 Electron 使用） | detectLocalAgents(fn), detectCliAgents(fn), hostAgentConfig(fn), LocalAgentFound(type), AgentConfigSuggestion(type) |
| [src/electron/dataRoot.ts](src/electron/dataRoot.ts) | 318 | 数据根目录（批次6）：记忆库、采集游标、日志、MCP 令牌、备份配置等全部持久数据 | defaultDataRoot(fn), dataRootPointerPath(fn), readDataRootPointer(fn), writeDataRootPointer(fn), clearDataRootMigrateFrom(fn), validateDataRootPath(fn), samePath(fn), ensureDirWritable(fn), hasAnyData(fn), summarizeDataDir(fn), detectDataRoots(fn), migrateDataRoot(fn), DATA_ROOT_DIR_NAME(const), DATA_ROOT_POINTER_NAME(const), DATA_ROOT_POINTER_VERSION(const), DATA_ROOT_MIGRATE_FILES(const), DATA_ROOT_MIGRATE_DIRS(const), DataRootPointer(type), DataRootSummary(type), DataRootMigration(type), DataRootPointerRead(type) |
| [src/electron/hostScan.ts](src/electron/hostScan.ts) | 163 | 宿主真扫 · node IO 层（仅 Electron 主进程使用）： | parseTasklistCsv(fn), parseWmicJson(fn), listProcessNames(fn), detectMcpEntries(fn), detectConfigFiles(fn), scanHost(fn) |
| [src/electron/ipcChannels.ts](src/electron/ipcChannels.ts) | 97 | preload 暴露的 IPC channel 清单（唯一真源）。 | missingChannels(fn), formatBootFailure(fn), handleBootFailure(fn), IPC(const), PRELOAD_CHANNELS(const), BootFailureDeps(type) |
| [src/electron/l0KeyringStore.ts](src/electron/l0KeyringStore.ts) | 72 | L0 密钥环落盘适配（§4.4.8）：l0-keyring.json 原子写（temp → fsync → rename）， | writeFileAtomic(fn), createL0KeyringStore(fn), createHomeLockStore(fn), cleanupTempFiles(fn) |
| [src/electron/main.ts](src/electron/main.ts) | 1915 | Electron 主进程入口： | — |
| [src/electron/mcpClients.ts](src/electron/mcpClients.ts) | 248 | MCP 客户端配置读写 · node 层（批次15，仅 Electron 主进程使用）。 | expandHome(fn), scanMcpClients(fn), snippetForClient(fn), wireMcpClient(fn), McpClientStatus(type), McpClientsScan(type), McpWireResult(type) |
| [src/electron/preload.ts](src/electron/preload.ts) | 150 | Electron preload：contextIsolation 开启下，经 contextBridge 向渲染进程暴露存储桥接面与运行标识。 | — |
| [src/electron/webhookServer.ts](src/electron/webhookServer.ts) | 103 | Webhook HTTP 服务（批次26-A P0-4，从 main.ts 内联处理器抽出以便单测）： | createWebhookHttpServer(fn), WebhookServerOptions(type) |

## src/home

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/home/dashboard.ts](src/home/dashboard.ts) | 58 | REQ-005 T4：首页 Dashboard 数据聚合（纯函数，§0.2） | buildDashboard(fn), RawHomeFeed(type) |
| [src/home/server.ts](src/home/server.ts) | 621 | REQ-005 T10：登录后端 HTTP 服务（零依赖，可选镜像，§4.1/§4.3） | createServer(fn), MirrorAuditEntry(type), ServerOptions(type), HomeServer(type) |

## src/inlineAttribution

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/inlineAttribution/decay.ts](src/inlineAttribution/decay.ts) | 45 | REQ-004 T2 衰减 / 老化 / 证据判定（纯逻辑，零 UI 依赖） | decayClassFromAge(fn), agingHintText(fn), isEvidenceThin(fn), summarizeAttribution(fn) |
| [src/inlineAttribution/feedback.ts](src/inlineAttribution/feedback.ts) | 26 | REQ-004 T7 用户干预反馈闭环（端口式，预留 REQ-007 内核接入） | applyFeedback(fn), LocalMockFeedbackPort(class) |

## src/shared

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/shared/actionLog.ts](src/shared/actionLog.ts) | 131 | 动作日志（批次7）：全链路结构化留痕的统一格式与脱敏。 | sanitizeActionDetail(fn), createActionLogEntry(fn), formatActionLine(fn), ActionLogEntry(type), ActionLogOptions(type), ActionLogTailResult(type), ActionLogLevel(type) |
| [src/shared/auditShape.ts](src/shared/auditShape.ts) | 20 | 审计写形状校验（批次26-B P1-2 建 / 批次28-A 抽共享供 HTTP 数据面复用）： | validateAuditRecord(fn) |
| [src/shared/localOrigin.ts](src/shared/localOrigin.ts) | 93 | 本机 HTTP 服务的跨源闸门：只信任明确放行的页面来源。 | createOriginPolicy(fn), rejectUntrustedOrigin(fn), applyCorsHeaders(fn), rejectUntrustedHost(fn), DEV_ORIGINS(const), OriginPolicy(type), OriginPolicyOptions(type) |
| [src/shared/sessionKey.ts](src/shared/sessionKey.ts) | 6 | — | SESSION_STORAGE_KEY(const) |

## src/types

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/types/agentOnboard.ts](src/types/agentOnboard.ts) | 263 | REQ-003 T1 交付物：Agent 接入页领域类型 / 数据契约（单一事实来源的"类型基线"） | assertShape(fn), AgentStatus(const), PriorityBadge(const), CircuitState(const), AgentCardShape(const), McpToolConfigShape(const), ChannelConfigShape(const), KeyMgmtShape(const), RecallMemoryTool(type), WriteMemoryTool(type), UserPreferencesTool(type), McpTools(type), Channels(type), OneClickFlags(type), DiscoverFlags(type), AgentCard(type), UiRecallTool(type), UiIso(type), UiChan(type), UiKey(type), AgentRealStats(type), UiAgentCard(type), InstalledAgent(type), DiscoveredAgent(type), Gain(type), AgentStatus(type), Priority(type), BadgeClass(type), CircuitState(type), Form(type), DeepPartial(type), AgentCardCandidate(type), AgentCardInput(type), ToolToggle(type), ToolToggleOrFalse(type), UiState(type) |
| [src/types/home.ts](src/types/home.ts) | 110 | REQ-005 首页与登录卡片：全局租户上下文 + 首页领域类型 | isAdminContext(fn), PERSPECTIVES(const), SYNC_ROLES(const), LOGIN_FAIL_REASONS(const), TenantContext(type), SyncState(type), LoginForm(type), LoginAudit(type), AnomalyItem(type), ActiveMemory(type), TodoItem(type), HomeDashboard(type), Perspective(type), AccountRole(type), SyncRole(type), LoginFailReason(type), LoginResult(type) |
| [src/types/inlineAttribution.ts](src/types/inlineAttribution.ts) | 88 | REQ-004 Agent 界面内联记忆标识：领域类型（T1 契约基线） | MemoryInjectionMark(type), TokenSaving(type), BackgroundItem(type), BackgroundMark(type), AgingWarnMark(type), WriteBackMark(type), AttributionConfig(type), TrustDelta(type), FeedbackPort(type), DecayClass(type), AttributionLevel(type), FeedbackAction(type) |

## src/web

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/web/AgentOnboard/AgentCard.tsx](src/web/AgentOnboard/AgentCard.tsx) | 162 | 单家宿主 Agent 接入卡片（规格 T3 / 19.2 · 19.3 · 5.2） | AgentCard(fn), AgentCardProps(type) |
| [src/web/AgentOnboard/AgentOnboardPage.tsx](src/web/AgentOnboard/AgentOnboardPage.tsx) | 572 | Agent 接入配置页容器（REQ-003 接原型） | detectForm(fn), AgentOnboardPage(fn) |
| [src/web/AgentOnboard/ChannelConfig.tsx](src/web/AgentOnboard/ChannelConfig.tsx) | 36 | 采集通道配置行（规格 T6 / 19.3 · R4 双通道至少开一 + SHA-256 幂等不可关） | ChannelConfig(fn) |
| [src/web/AgentOnboard/FormBadge.tsx](src/web/AgentOnboard/FormBadge.tsx) | 46 | 按端置灰徽标（规格 T10 / AC-003.10 / 19.10） | FormBadge(fn), GRAYED_BY_FORM(const) |
| [src/web/AgentOnboard/Gains.tsx](src/web/AgentOnboard/Gains.tsx) | 25 | 效果证据 · 用户可感知的「省」与「快」（19.1 / 9.x / 2.4.x / 19.8 反代理） | Gains(fn) |
| [src/web/AgentOnboard/IsolationConfig.tsx](src/web/AgentOnboard/IsolationConfig.tsx) | 34 | 隔离粒度配置行（规格 19.4 · R1 project_id 共享 / user_id 偏好跨项目） | IsolationConfig(fn) |
| [src/web/AgentOnboard/KeyMgmt.tsx](src/web/AgentOnboard/KeyMgmt.tsx) | 21 | 密钥管理行（规格 T7 / §4 · R5 恒脱敏不回显 / R6 轮换宽限 24h / 超 90 天告警） | KeyMgmt(fn) |
| [src/web/AgentOnboard/McpClientsPanel.tsx](src/web/AgentOnboard/McpClientsPanel.tsx) | 412 | MCP 客户端接入面板（批次15 建 / 批次21 交互收敛 / 批次23 一键适配全部 + 逐客户端接通指引）： | McpClientsPanel(fn) |
| [src/web/AgentOnboard/McpToolConfig.tsx](src/web/AgentOnboard/McpToolConfig.tsx) | 61 | MCP 工具配置行（规格 T5 / 19.5 · 须带 project_id） | toolRef(fn), McpToolConfig(fn) |
| [src/web/AgentOnboard/OneClickOnboard.tsx](src/web/AgentOnboard/OneClickOnboard.tsx) | 248 | 一键接入本机 Agent（规格 T4 / AC-003.4 / 19.9 · 扫→分→绑→验 四段进度 + 自动绑定 + 可撤销） | OneClickOnboard(fn) |
| [src/web/AgentOnboard/TestPanel.tsx](src/web/AgentOnboard/TestPanel.tsx) | 70 | 接入测试面板（规格 T8 / AC-003.8 · R7 必记 request_id · 注入预览） | TestPanel(fn), TestEvidence(type) |
| [src/web/AgentOnboard/agentOnboardEntry.tsx](src/web/AgentOnboard/agentOnboardEntry.tsx) | 31 | REQ-003 接入页入口（原 index.html 默认页，因 REQ-005 首页路由决策迁至独立入口，保留 REQ-003 验证） | — |
| [src/web/AgentOnboard/autoDiscovery.ts](src/web/AgentOnboard/autoDiscovery.ts) | 235 | 登录自动发现链路（批次16）：三路真实信号合并 + 对可写 JSON 客户端自动写入 MCP。 | scanLocalAgents(fn), mcpSpecForAgent(fn), autoWireMcpForAgents(fn), McpClientRow(type), HostInstallScan(type), LocalAgentScan(type) |
| [src/web/AgentOnboard/autoOnboard.ts](src/web/AgentOnboard/autoOnboard.ts) | 216 | 登录/手动自动接入链路（批次16）： | readOnboardFailure(fn), clearOnboardFailure(fn), runAutoOnboard(fn), runAutoOnboardOnLogin(fn), resetAutoOnboardState(fn), ONBOARD_FAILURE_KEY(const), OnboardFailure(type), RunAutoOnboardOptions(type), AutoOnboardOutcome(type) |
| [src/web/AgentOnboard/cards.ts](src/web/AgentOnboard/cards.ts) | 106 | 接入卡片构造与恢复：只由「真实接入过」的 agent 名单生成卡片，无任何演示卡片。 | specOf(fn), makeCard(fn), restoreCards(fn), restoreDiscovered(fn), AGENT_SPECS(const), AgentSpec(type) |
| [src/web/AgentOnboard/coreOnboard.ts](src/web/AgentOnboard/coreOnboard.ts) | 192 | AgentOnboard 接入页接真内核：一键接入第 4 段「测通并写审计」走 ma.discover | coreDiscover(fn), coreHostDiscover(fn), computeOnboardGains(fn), getOnboardGains(fn), emptyOnboardGains(fn), getOnboardInjectPreview(fn), DiscoveredAgentUi(type) |
| [src/web/AgentOnboard/onboardState.ts](src/web/AgentOnboard/onboardState.ts) | 73 | Agent 接入页「已接入」状态持久化（localStorage，跨 iframe 共享、切页/重载保持）。 | readOnboardState(fn), writeOnboardState(fn), clearOnboardState(fn), ONBOARD_STATE_KEY(const), OnboardMcpSummary(type), OnboardState(type) |
| [src/web/AgentOnboard/store.ts](src/web/AgentOnboard/store.ts) | 62 | 接入页本地持久化：用户真实接入过的 agent 名单与卡片配置快照（localStorage，跨 iframe/重载保持）。 | addAgentCard(fn), removeAgentCard(fn), listDetectedAgents(fn), DetectedCardSnapshot(type) |
| [src/web/AgentOnboard/useBackendMirror.ts](src/web/AgentOnboard/useBackendMirror.ts) | 294 | 真实后端镜像（接T13/T14）：把 UI 动作 best-effort 打到后端，并在挂载时 GET /agents 回填、 | resolveBackendUrl(fn), createService(fn), toServiceInput(fn), normalizeAgentKey(fn), statsForAgent(fn), computeAgentStats(fn), useBackendMirror(fn), TestOutcome(type), BackendMirror(type), BackendCardEcho(type) |
| [src/web/Home/Dashboard.tsx](src/web/Home/Dashboard.tsx) | 163 | REQ-005 T7：首页 Dashboard 区块组件（功劳 + 异常 + 活跃 + 待办，§0.2） | Dashboard(fn), DashboardProps(type) |
| [src/web/Home/HomePage.tsx](src/web/Home/HomePage.tsx) | 98 | REQ-005 T9：首页装配容器（HomePage，§0.1/§0.2/§0.3 集成） | HomePage(fn), HomePageProps(type) |
| [src/web/Home/LayerGraphPanel.tsx](src/web/Home/LayerGraphPanel.tsx) | 537 | 首页 L1–L6 关系图谱交互面板（批次8-B）： | LayerGraphPanel(fn), LayerGraphPanelProps(type) |
| [src/web/Home/LoginModal.tsx](src/web/Home/LoginModal.tsx) | 319 | REQ-005 T8：登录卡片组件（§0.3 弹出子视图） | LoginModal(fn), LoginModalProps(type) |
| [src/web/Home/ProgramLogPanel.tsx](src/web/Home/ProgramLogPanel.tsx) | 240 | 程序运行日志窗口（批次17 建，批次19 从首页迁至日志记录页）：真实尾读 <数据根>/actions.log。 | ProgramLogPanel(fn), ProgramLogPanelProps(type) |
| [src/web/Home/TopBar.tsx](src/web/Home/TopBar.tsx) | 84 | REQ-005 T6：首页顶栏组件（登录态自适应，§0.2 顶栏） | TopBar(fn), TopBarProps(type) |
| [src/web/Home/coreHome.ts](src/web/Home/coreHome.ts) | 269 | REQ-005 首页（真实可算）： | coreTraceLookup(fn), emptyGains(fn), getHomeFeed(fn), emptySync(fn), fetchMirrorItems(fn), TraceHit(type), MirrorItem(type), GetHomeFeedOpts(type), HomeFeedResult(type) |
| [src/web/Home/crossTabAuth.ts](src/web/Home/crossTabAuth.ts) | 49 | 跨 iframe 登录态共享（localStorage）—— REQ-005 T11 补充 | getStoredSessionId(fn), storeSessionId(fn), clearStoredSessionId(fn), setTestOverride(fn), hasActiveSession(fn), useCrossTabAuth(fn) |
| [src/web/Home/layerGraph.ts](src/web/Home/layerGraph.ts) | 328 | 首页 L1–L6 关系图谱数据推导（批次8-A，纯函数）： | categoryMeta(fn), memoryLayerText(fn), deriveLayerGraph(fn), emptyLayerGraph(fn), GRAPH_LAYERS(const), GRAPH_CATEGORIES(const), LayerMeta(type), CategoryMeta(type), LayerHubNode(type), MemoryGraphNode(type), LayerGraphEdge(type), LayerGraphStats(type), LayerGraph(type), LayerGraphOptions(type), GraphLayerId(type), GraphCategoryId(type), GraphEdgeKind(type) |
| [src/web/Home/layerGraphLayout.ts](src/web/Home/layerGraphLayout.ts) | 190 | 首页 L1–L6 关系图谱布局（批次8-A，纯函数）： | layoutLayerGraph(fn), LayoutPoint(type), PositionedHub(type), PositionedNode(type), PositionedEdge(type), LayoutSpoke(type), LayerGraphLayout(type), LayerGraphLayoutOptions(type) |
| [src/web/Home/programLog.ts](src/web/Home/programLog.ts) | 113 | 程序运行日志窗口的纯函数（批次17 建，批次19 起由日志记录页使用）：解析 actions.log 行、UTC+08:00 时间展示、诊断文本与剪贴板复制。 | parseProgramLogLine(fn), formatLogClock(fn), formatLogDate(fn), formatLocalDateTime(fn), countErrors(fn), buildDiagnostics(fn), copyText(fn), ProgramLogLine(type) |
| [src/web/Home/programLogLabels.ts](src/web/Home/programLogLabels.ts) | 186 | 程序运行日志「人话」层（批次24）：把 actions.log 的 scope:action + detail 翻成一句中文。 | detailNote(fn), actionTitle(fn), humanizeProgramLog(fn), SCOPE_LABEL(const), LEVEL_LABEL(const), HumanLogLine(type) |
| [src/web/Home/tenantContext.tsx](src/web/Home/tenantContext.tsx) | 134 | REQ-005 T5：全局租户上下文 Provider（React，§0.1 / §0.3） | TenantProvider(fn), useTenant(fn), useLogin(fn), useLogout(fn), TenantProviderProps(type), LoginFn(type), LogoutFn(type) |
| [src/web/Home/useLoginMirror.ts](src/web/Home/useLoginMirror.ts) | 122 | REQ-005 T11：前端登录 API client（镜像，§0.3 / 对齐 REQ-003 useBackendMirror） | useLoginMirror(fn), UseLoginMirrorOptions(type) |
| [src/web/InlineAttribution/AgentConversationDemo.tsx](src/web/InlineAttribution/AgentConversationDemo.tsx) | 313 | REQ-004 T10 宿主集成：Claude Code 风格对话演示页（exercise harness，不绑定业务页） | AgentConversationDemo(fn) |
| [src/web/InlineAttribution/AgingWarnTag.tsx](src/web/InlineAttribution/AgingWarnTag.tsx) | 40 | REQ-004 T6 ④ 老化 / 证据警示（内联 ⚠️ · 恒显示不可关） | AgingWarnTag(fn) |
| [src/web/InlineAttribution/AttributionConfig.tsx](src/web/InlineAttribution/AttributionConfig.tsx) | 59 | REQ-004 T9 配置上下文 + 可开关与降级（诚实约束） | AttributionConfigProvider(fn), useAttributionConfig(fn), AttributionConfigApi(type), MarkKind(type) |
| [src/web/InlineAttribution/AttributionSummary.tsx](src/web/InlineAttribution/AttributionSummary.tsx) | 32 | REQ-004 T8 每回答贡献摘要 + 💾 写入沉淀标记（均展示，实际写入属 REQ-007） | AttributionSummary(fn) |
| [src/web/InlineAttribution/AttributionToggle.tsx](src/web/InlineAttribution/AttributionToggle.tsx) | 35 | REQ-004 T9 开关控件（full / token_only / off），切换经回调通知（toast 由宿主处理） | AttributionToggle(fn) |
| [src/web/InlineAttribution/BackgroundChip.tsx](src/web/InlineAttribution/BackgroundChip.tsx) | 34 | REQ-004 T5 ③ 背景免重复标记（会话头部 📎 N 条 + 展开） | BackgroundChip(fn) |
| [src/web/InlineAttribution/MemoryInjectionTag.tsx](src/web/InlineAttribution/MemoryInjectionTag.tsx) | 51 | REQ-004 T3 ① 记忆注入标记（答案段落内联 🧠 + hover/click 弹层） | MemoryInjectionTag(fn) |
| [src/web/InlineAttribution/TokenSavingBar.tsx](src/web/InlineAttribution/TokenSavingBar.tsx) | 28 | REQ-004 T4 ② Token 节省标记（回答底部 ⚡ 一行 + 分解） | TokenSavingBar(fn) |
| [src/web/InlineAttribution/coreInline.ts](src/web/InlineAttribution/coreInline.ts) | 51 | 内联标识演示页（REQ-004 / T10）接真内核：干预反馈走 ma._feedback（confirm +0.1 / | ledgerHasMemory(fn), coreInlineFeedback(fn), coreInlineAuditCount(fn), coreLedgerMemoryCount(fn) |
| [src/web/InlineAttribution/floatEntry.tsx](src/web/InlineAttribution/floatEntry.tsx) | 100 | 悬浮覆盖层入口（REQ-004 扩展）：无边框透明窗，**贴合到 Claude Desktop 窗口右侧**显示内联记忆标识。 | — |
| [src/web/InlineAttribution/inlineAttributionEntry.tsx](src/web/InlineAttribution/inlineAttributionEntry.tsx) | 15 | REQ-004 宿主演示页入口 | — |
| [src/web/InlineAttribution/useInlineReal.ts](src/web/InlineAttribution/useInlineReal.ts) | 284 | 内联标识演示页（REQ-004 / T10）· 真实数据接真层 | collectConnectedAgents(fn), sharedMemories(fn), injectionsFromMemories(fn), backgroundFromMemories(fn), tokenSavingFromMarks(fn), writeBackFromAudits(fn), agingWarnsFromMarks(fn), loadRealInline(fn), INLINE_REAL_DATA_SOURCE(const), ConnectedAgent(type), RealInline(type), RealStorage(type) |
| [src/web/audit/AuditPage.tsx](src/web/audit/AuditPage.tsx) | 117 | 审计日志页（REQ-006 / P11）· 完整编排（T5） | AuditPage(fn) |
| [src/web/audit/AuditTable.tsx](src/web/audit/AuditTable.tsx) | 92 | 审计日志页（REQ-006 / P11）审计列表（T4） | AuditTable(fn), AuditTableProps(type) |
| [src/web/audit/FilterBar.tsx](src/web/audit/FilterBar.tsx) | 82 | 审计日志页（REQ-006 / P11）过滤栏（T3） | FilterBar(fn) |
| [src/web/audit/auditEntry.tsx](src/web/audit/auditEntry.tsx) | 10 | 审计日志页（REQ-006 / P11）入口：挂载 AuditPage。 | — |
| [src/web/audit/coreAudit.ts](src/web/audit/coreAudit.ts) | 55 | 审计日志页（REQ-006 / P11）接真内核：审计流存内核 InMemoryStorage（append-only）， | coreLoadAudit(fn) |
| [src/web/audit/logic.ts](src/web/audit/logic.ts) | 82 | 审计日志页（REQ-006 / P11）纯逻辑层 | actionLabel(fn), filterEntries(fn), chainByRequest(fn), exportCsv(fn), exportJson(fn), ACTION_LABEL(const) |
| [src/web/audit/types.ts](src/web/audit/types.ts) | 43 | 审计日志页（REQ-006 / P11）数据模型 | AuditEntry(type), AuditFilter(type), AuditAction(type) |
| [src/web/audit/useAuditMirror.ts](src/web/audit/useAuditMirror.ts) | 32 | 审计日志页后端镜像（T5）：沿用 ?backend= 覆盖模式。 | resolveBackendUrl(fn), useAuditMirror(fn), AuditMirror(type) |
| [src/web/audit/useToast.tsx](src/web/audit/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/backend.ts](src/web/backend.ts) | 156 | 本机后端地址单一真源（与 src/electron/main.ts 的 MIRROR_PORT / AGENT_ONBOARD_PORT 对齐）。 | backendParam(fn), agentBackendParam(fn), homeBaseUrl(fn), onboardBaseUrl(fn), rememberHomeBase(fn), discoverTrustedDevBackend(fn), HOME_BASE(const), ONBOARD_BASE(const), DEV_FALLBACK_PORTS(const) |
| [src/web/dispute/DisputePage.tsx](src/web/dispute/DisputePage.tsx) | 150 | 冲突裁决页 T5：完整编排 + mirror · 真实数据接真版 | DisputePage(fn) |
| [src/web/dispute/DisputeQueue.tsx](src/web/dispute/DisputeQueue.tsx) | 55 | P7-T3 冲突裁决队列组件 | DisputeQueue(fn) |
| [src/web/dispute/DisputeVerdict.tsx](src/web/dispute/DisputeVerdict.tsx) | 49 | P7-T4 裁决操作组件 | DisputeVerdict(fn), VERDICTS(const) |
| [src/web/dispute/coreDispute.ts](src/web/dispute/coreDispute.ts) | 156 | 冲突裁决页（REQ-006 / P7）接真内核：队列 = 真实账本冲突（conflict_id 标记 + conflict_resolve 审计）， | coreConflicts(fn), coreVerdict(fn), VerdictOutcome(type) |
| [src/web/dispute/disputeEntry.tsx](src/web/dispute/disputeEntry.tsx) | 10 | 冲突裁决页（REQ-006 / P7）入口：挂载 DisputePage。 | — |
| [src/web/dispute/labels.ts](src/web/dispute/labels.ts) | 10 | 冲突类型 → 中文标签（规格常量）。页面数据真相 = 内核账本，无演示冲突。 | CONFIRM_TYPE_LABEL(const) |
| [src/web/dispute/logic.ts](src/web/dispute/logic.ts) | 71 | 冲突裁决页（REQ-006 / P7）纯逻辑层 | typeLabel(fn), overdueDays(fn), isOverdue(fn), applyVerdict(fn), auditPair(fn), queueSort(fn), VerdictResult(type) |
| [src/web/dispute/types.ts](src/web/dispute/types.ts) | 43 | 冲突裁决页（REQ-006 / P7）数据模型 | ConflictRecord(type), ConflictAudit(type), ConflictType(type), Verdict(type) |
| [src/web/dispute/useDisputeMirror.ts](src/web/dispute/useDisputeMirror.ts) | 34 | 冲突裁决页后端镜像（T5）：沿用 useBackendMirror 的 ?backend= 覆盖模式。 | resolveBackendUrl(fn), useDisputeMirror(fn), DisputeMirror(type) |
| [src/web/dispute/useToast.tsx](src/web/dispute/useToast.tsx) | 22 | 轻量 toast hook（T5）：返回展示节点与 show(msg) | useToast(fn) |
| [src/web/feedback/FeedbackForm.tsx](src/web/feedback/FeedbackForm.tsx) | 102 | P9-T3 反馈表单（13.7） | FeedbackForm(fn) |
| [src/web/feedback/FeedbackPage.tsx](src/web/feedback/FeedbackPage.tsx) | 65 | 用户反馈页（REQ-006 / P9）T4 编排 | FeedbackPage(fn) |
| [src/web/feedback/StatCards.tsx](src/web/feedback/StatCards.tsx) | 36 | P9-T3 统计卡（7.1/7.2） | StatCards(fn) |
| [src/web/feedback/coreFeedback.ts](src/web/feedback/coreFeedback.ts) | 70 | 用户反馈页（REQ-006 / P9）接真内核：提交走 ma._feedback（17.4 trust_delta 内核计算） | coreSubmitFeedback(fn), coreListMemoryOptions(fn), coreLoadFeedbackRecords(fn), FeedbackOutcome(type), MemoryOption(type) |
| [src/web/feedback/feedbackEntry.tsx](src/web/feedback/feedbackEntry.tsx) | 10 | 用户反馈页（REQ-006 / P9）入口（T1 壳） | — |
| [src/web/feedback/logic.ts](src/web/feedback/logic.ts) | 61 | 用户反馈页（REQ-006 / P9）纯逻辑层 | trustDelta(fn), validateDraft(fn), statShare(fn), composeRecord(fn), FeedbackStats(type) |
| [src/web/feedback/types.ts](src/web/feedback/types.ts) | 27 | 用户反馈页（REQ-006 / P9）数据模型 | FeedbackDraft(type), InjectedContext(type), FeedbackRecord(type), FeedbackAction(type) |
| [src/web/feedback/useFeedbackMirror.ts](src/web/feedback/useFeedbackMirror.ts) | 33 | 用户反馈页后端镜像（T4）：safe-noop 模式。 | resolveBackendUrl(fn), useFeedbackMirror(fn), FeedbackMirror(type) |
| [src/web/feedback/useToast.tsx](src/web/feedback/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/growth/DedupCards.tsx](src/web/growth/DedupCards.tsx) | 148 | P14-T3 自净化侧组件：五维评分卡 + 短路嫁接流程 + 24h 统计 + 开发者调参（6.1/6.2，G7） | DedupCard(fn), ShortCircuitFlow(fn), DevTunePanel(fn) |
| [src/web/growth/GrowthPage.tsx](src/web/growth/GrowthPage.tsx) | 199 | 自我净化与生长页（REQ-009 / P14）· 真实数据接真版 | GrowthPage(fn) |
| [src/web/growth/GrowthPanels.tsx](src/web/growth/GrowthPanels.tsx) | 162 | P14-T3 自生长侧组件：指标卡 + 五项优化 + Δ 收益曲线 + 调度时间轴（7.1/7.2/13.3） | GrowthCards(fn), OptimizationList(fn), DeltaPanel(fn), ScheduleTimeline(fn) |
| [src/web/growth/coreGrowth.ts](src/web/growth/coreGrowth.ts) | 40 | 自我净化与生长页（REQ-009 / P14）接真内核：优化/调度动作审计真写 storage 账本 | coreGrowthAudit(fn), coreLoadGrowthAudit(fn) |
| [src/web/growth/growthEntry.tsx](src/web/growth/growthEntry.tsx) | 10 | 自我净化与生长页（REQ-009 / P14）入口 | — |
| [src/web/growth/logic.ts](src/web/growth/logic.ts) | 127 | P14 纯逻辑（T2）：五维加权 / 逐层阈值 / 短路嫁接 / 优化评估 / Δ 收益 / 调度校验 / 审计 | weightedScore(fn), layerThresholdOf(fn), isDuplicate(fn), validateWeights(fn), validateThresholds(fn), shortCircuitPath(fn), evaluateOptimizations(fn), growthDelta(fn), appendTunedPoint(fn), validateSchedule(fn), auditOptimization(fn) |
| [src/web/growth/spec.ts](src/web/growth/spec.ts) | 39 | 自我净化与生长页规格常量（非演示数据）：五维默认权重 / 逐层阈值 / 标签 / 调度。 | DEFAULT_WEIGHTS(const), DEFAULT_THRESHOLDS(const), DIM_LABELS(const), LAYERS(const), OPT_CONDITIONS(const), DEFAULT_SCHEDULE(const) |
| [src/web/growth/types.ts](src/web/growth/types.ts) | 77 | P14 自我净化与生长页（REQ-009 6.1/6.2/7.1/7.2/13.3）数据模型 | DedupSample(type), ShortCircuitStep(type), GrowthMetrics(type), OptimizationItem(type), ScheduleItem(type), DeltaPoint(type), GrowthAuditEntry(type), DimKey(type), DimWeights(type), Layer(type), LayerThresholds(type), OptState(type) |
| [src/web/growth/useGrowthMirror.ts](src/web/growth/useGrowthMirror.ts) | 11 | 自我净化与生长页后端镜像：growth_op 动作审计上抛（G6 fire-and-forget）。 | useGrowthMirror(fn) |
| [src/web/growth/useGrowthReal.ts](src/web/growth/useGrowthReal.ts) | 182 | 自我净化与生长页（REQ-009 / P14）· 真实数据接真层 | samplesFromMemories(fn), metricsFromLedger(fn), dedupStatsFromLedger(fn), deltaSeriesFromLedger(fn), scheduleReal(fn), loadRealGrowthData(fn), GROWTH_REAL_DATA_SOURCE(const), RealGrowth(type), RealStorage(type) |
| [src/web/growth/useToast.tsx](src/web/growth/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/httpStorage.ts](src/web/httpStorage.ts) | 102 | 批次28-A：浏览器内核数据面 —— StorageBackend 的 HTTP 透传实现。 | fetchKernelInfo(fn), KernelUnavailableError(class), HttpStorageBackend(class), HttpStorageOptions(type), KernelInfo(type) |
| [src/web/kernel.ts](src/web/kernel.ts) | 219 | 统一内核接入口：全部页面共用同一份账本（唯一真相源）。 | getTenant(fn), bindTenant(fn), syncTenantFromHost(fn), kernelAccount(fn), setKernelStorageForTests(fn), getKernelStorage(fn), rebuildKernelForDataPlane(fn), setKernelL0ForTests(fn), getKernelWithSeed(fn), getKernel(fn), createKernelOnSameStorage(fn), rebuildKernelFromModelConfig(fn), resetKernelForTests(fn), newRequestId(fn), KERNEL_FORM(const), KernelTenant(type), KernelOverrides(type) |
| [src/web/lifecycle/LifecycleCard.tsx](src/web/lifecycle/LifecycleCard.tsx) | 51 | 生命周期页（REQ-006 / P4）状态查看器（T3） | LifecycleCard(fn) |
| [src/web/lifecycle/LifecyclePage.tsx](src/web/lifecycle/LifecyclePage.tsx) | 293 | 生命周期页（REQ-006 / P4）· 完整编排（T5）· 真实数据接真版 | LifecyclePage(fn) |
| [src/web/lifecycle/ParamPanel.tsx](src/web/lifecycle/ParamPanel.tsx) | 75 | 生命周期页（REQ-006 / P4）调参面板（T4） | ParamPanel(fn) |
| [src/web/lifecycle/constants.ts](src/web/lifecycle/constants.ts) | 4 | 生命周期阈值常量（9.10.1）。列表数据真相 = 内核账本，无演示记忆。 | N_DAYS(const), M_DAYS(const) |
| [src/web/lifecycle/coreLifecycle.ts](src/web/lifecycle/coreLifecycle.ts) | 141 | 生命周期页（REQ-006 / P4）接真内核：迁移/调参/批量统一走 ma._memoryOp | toLifecycleRecord(fn), coreListLifecycle(fn), coreLifeOp(fn), DECAY_TO_STATUS(const), STATUS_TO_DECAY(const) |
| [src/web/lifecycle/lifecycleEntry.tsx](src/web/lifecycle/lifecycleEntry.tsx) | 10 | 生命周期页（REQ-006 / P4）入口：挂载 LifecyclePage。 | — |
| [src/web/lifecycle/lifecycleFilter.ts](src/web/lifecycle/lifecycleFilter.ts) | 19 | 生命周期页（REQ-006 / P4）· 分页纯逻辑 | pagedList(fn), LIFECYCLE_DEFAULT_PAGE_SIZE(const), LIFECYCLE_PAGE_SIZES(const), LifecyclePageSize(type) |
| [src/web/lifecycle/logic.ts](src/web/lifecycle/logic.ts) | 92 | 生命周期页（REQ-006 / P4）纯逻辑层 | freshnessPreview(fn), canMigrate(fn), importanceLevel(fn), staleCheck(fn), applyLifecycle(fn), STATUS_FLOW(const) |
| [src/web/lifecycle/types.ts](src/web/lifecycle/types.ts) | 48 | 生命周期页（REQ-006 / P4）数据模型 | LifecycleRecord(type), OpResult(type), MemoryStatus(type), DecayClass(type), LifeOp(type) |
| [src/web/lifecycle/useLifecycleMirror.ts](src/web/lifecycle/useLifecycleMirror.ts) | 24 | 生命周期页后端镜像（T5）：沿用 ?backend= 覆盖模式。 | resolveBackendUrl(fn), useLifecycleMirror(fn), LifecycleMirror(type) |
| [src/web/lifecycle/useToast.tsx](src/web/lifecycle/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/logs/LogCards.tsx](src/web/logs/LogCards.tsx) | 288 | REQ-011 T3 日志列表（§2.2）+ 异常聚合卡（§2.3）+ 审计 modal（R-LOG6，按 request_id 真查内核账本）+ L0 授权卡（§2.4） | LogTable(fn), ErrorAggr(fn), AuditModal(fn), L0AuthCard(fn), LogTableProps(type), L0AuthCardProps(type) |
| [src/web/logs/LogFilterBar.tsx](src/web/logs/LogFilterBar.tsx) | 66 | REQ-011 T3 过滤区（§2.1 六维） | LogFilterBar(fn) |
| [src/web/logs/LogsPage.tsx](src/web/logs/LogsPage.tsx) | 173 | 日志记录页（REQ-011 / P15）T4 编排 | LogsPage(fn) |
| [src/web/logs/coreLogs.ts](src/web/logs/coreLogs.ts) | 66 | 日志记录页（REQ-011 / P15）接真内核：审计流存内核 InMemoryStorage（append-only）， | coreLoadLogs(fn), coreAuditChain(fn), coreL0Browse(fn) |
| [src/web/logs/labels.ts](src/web/logs/labels.ts) | 16 | 日志页展示标签（规格常量）。日志数据真相 = 内核审计账本，无演示日志。 | ACTION_LABEL(const), FORM_LABEL(const) |
| [src/web/logs/logic.ts](src/web/logs/logic.ts) | 126 | 日志记录页（REQ-011 / P15）纯逻辑层 | ensureRequestId(fn), classifyError(fn), aggrErrors(fn), filterLogs(fn), l0Precheck(fn), l0Record(fn), canDeleteAudit(fn), ERROR_TARGET(const), L0_MAX_FAIL(const), L0_LOCK_MS(const), L0_MIN_LEN(const) |
| [src/web/logs/logsEntry.tsx](src/web/logs/logsEntry.tsx) | 10 | 日志记录页（REQ-011 / P15）入口 | — |
| [src/web/logs/types.ts](src/web/logs/types.ts) | 52 | 日志记录页（REQ-011 / P15）数据模型 | LogEntry(type), LogFilter(type), L0State(type), LogLevel(type), LogForm(type), LogAction(type), ErrorKind(type) |
| [src/web/logs/useToast.tsx](src/web/logs/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/main.tsx](src/web/main.tsx) | 151 | 应用入口（REQ-005 首页路由 · T12 路由决策：首页 = HomePage，覆盖 REQ-003 默认页） | — |
| [src/web/memory/LayerFilterBar.tsx](src/web/memory/LayerFilterBar.tsx) | 189 | 记忆层级管理页（19.11）· 每层 L0-L6 过滤栏 + 分页控件 | LayerFilterBar(fn), LayerPager(fn) |
| [src/web/memory/LayerMemoryTable.tsx](src/web/memory/LayerMemoryTable.tsx) | 174 | 层级管理页每层内的记忆表格（带可拖拽表头列宽） | LayerMemoryTable(fn) |
| [src/web/memory/MemoryActions.tsx](src/web/memory/MemoryActions.tsx) | 80 | 记忆管理页（REQ-006 / P8）操作区（T4） | MemoryActions(fn) |
| [src/web/memory/MemoryDrawer.tsx](src/web/memory/MemoryDrawer.tsx) | 160 | 记忆管理页详情/编辑抽屉（T5） | MemoryDrawer(fn) |
| [src/web/memory/MemoryLayeredPage.tsx](src/web/memory/MemoryLayeredPage.tsx) | 641 | 记忆层级管理页（REQ-006 / P8 · 19.11） | MemoryLayeredPage(fn), LayerId(type) |
| [src/web/memory/MemoryPage.tsx](src/web/memory/MemoryPage.tsx) | 143 | 记忆库管理页（REQ-006 / P8）· 完整编排（T5） | MemoryPage(fn) |
| [src/web/memory/MemoryRow.tsx](src/web/memory/MemoryRow.tsx) | 80 | 记忆管理页（REQ-006 / P8）单行（T3） | MemoryRow(fn) |
| [src/web/memory/MemoryTable.tsx](src/web/memory/MemoryTable.tsx) | 255 | 记忆管理页（REQ-006 / P8）列表（T3）+ 过滤 + 分页 + 可拖拽列宽 | MemoryTable(fn), TYPE_OPTIONS(const), STATUS_OPTIONS(const), SOURCE_OPTIONS(const), MemoryTableFilterState(type), PageSize(type) |
| [src/web/memory/backup.ts](src/web/memory/backup.ts) | 87 | 记忆库管理页 · 自动备份（P8 扩展）：渲染层经 hostCall 走 preload IPC 调主进程备份能力。 | backupAvailable(fn), backupGetConfig(fn), backupSaveConfig(fn), backupChooseDir(fn), backupRunNow(fn), backupList(fn), BackupConfigView(type), BackupItem(type), BackupOpResult(type) |
| [src/web/memory/coreMemoryOps.ts](src/web/memory/coreMemoryOps.ts) | 279 | 记忆管理页（REQ-006 / P8）接真内核：17.3 九操作统一走 ma._memoryOp。 | getStorage(fn), toRecord(fn), coreApplyOp(fn), storageLocation(fn), openMemoryFile(fn), coreListMemories(fn), coreUpdateContent(fn), coreBrowse(fn) |
| [src/web/memory/dataRoot.ts](src/web/memory/dataRoot.ts) | 63 | 数据存放位置（批次6）：记忆库/采集游标/日志/MCP 令牌/备份配置等全部数据挂在用户选定目录。 | dataRootAvailable(fn), getDataRoot(fn), openDataRoot(fn), changeDataRoot(fn), restoreDefaultDataRoot(fn), DataRootInfo(type), DataRootChangeResult(type) |
| [src/web/memory/layerFilter.ts](src/web/memory/layerFilter.ts) | 51 | 记忆层级管理页（19.11）· 每层 L0-L6 的过滤 + 分页纯逻辑 | filterLayerPaged(fn), LAYER_DEFAULT_PAGE_SIZE(const), LAYER_PAGE_SIZES(const), LAYER_DEFAULT_FILTER(const), LayerFilterState(type) |
| [src/web/memory/logic.ts](src/web/memory/logic.ts) | 107 | 记忆管理页（REQ-006 / P8）纯逻辑层 | decayClass(fn), sortMemories(fn), summarizeContent(fn), applyOp(fn), OP_TOAST(const) |
| [src/web/memory/memoryEntry.tsx](src/web/memory/memoryEntry.tsx) | 10 | 记忆管理页（REQ-006 / P8）入口：挂载 MemoryPage。 | — |
| [src/web/memory/memoryFilter.ts](src/web/memory/memoryFilter.ts) | 89 | 记忆管理页（REQ-006 / P8）· 过滤 + 分页纯逻辑 | isCollected(fn), filterMemories(fn), filterAndPaged(fn), MemoryFilter(type) |
| [src/web/memory/memoryLayeredEntry.tsx](src/web/memory/memoryLayeredEntry.tsx) | 10 | 记忆层级管理页入口（REQ-006 / P8 · 19.11） | — |
| [src/web/memory/types.ts](src/web/memory/types.ts) | 90 | 记忆管理页（REQ-006 / P8）数据模型 | MemoryRecord(type), OpResult(type), MemoryStoreLocation(type), MemoryStatus(type), DecayClass(type), MemoryType(type), MemoryOp(type) |
| [src/web/memory/useMemoryMirror.ts](src/web/memory/useMemoryMirror.ts) | 34 | 记忆管理页后端镜像（T5）：沿用 useBackendMirror 的 ?backend= 覆盖模式。 | resolveBackendUrl(fn), useMemoryMirror(fn), MemoryMirror(type) |
| [src/web/memory/useToast.tsx](src/web/memory/useToast.tsx) | 22 | 轻量 toast hook（T5）：返回展示节点与 show(msg) | useToast(fn) |
| [src/web/mirrorClient.ts](src/web/mirrorClient.ts) | 42 | REQ-006 端壳 mirror 客户端（G6 审计上抛）：fire-and-forget，失败静默（safe-noop 语义保留）。 | mirrorBackendUrl(fn), mirrorReport(fn), mirrorFetch(fn) |
| [src/web/models/LlmUsageTable.tsx](src/web/models/LlmUsageTable.tsx) | 113 | P13-T3 LLM 四用途表：本地/网络复选 + 端点/Key 脱敏槽 + 温度 + 超时 + fallback 恒开（R1/R2/R3/R4） | LlmUsageTable(fn) |
| [src/web/models/ModelsPage.tsx](src/web/models/ModelsPage.tsx) | 161 | 大模型配置页（REQ-009 / P13）T4 编排 | ModelsPage(fn) |
| [src/web/models/ProxyPanel.tsx](src/web/models/ProxyPanel.tsx) | 126 | P13-T3 反代理面板：全量映射表 + 来源单选 + auto/manual 模式 + price_cap/cost_cap/预算条（19.8 / R7–R12） | ProxyPanel(fn) |
| [src/web/models/VectorCard.tsx](src/web/models/VectorCard.tsx) | 100 | P13-T3 向量模型卡：切换联动 dims/deploy；换维度需保存后按新维度重建（R5）；连通测试（Phase C3 如实探测） | VectorCard(fn) |
| [src/web/models/catalog.ts](src/web/models/catalog.ts) | 55 | P13 大模型配置页：规格常量 + 反代理源目录（19.8）。 | defaultUsage(fn), VECTOR_MODELS(const), DEFAULT_VECTOR_KEY(const), USAGE_KEYS(const), USAGE_LABELS(const), DEFAULT_USAGES(const), PROXY_CATALOG(const), ProxyCatalogEntry(type) |
| [src/web/models/coreModels.ts](src/web/models/coreModels.ts) | 229 | 大模型配置页（REQ-009 / P13）接真内核： | coreLoadSources(fn), coreVectorCount(fn), coreSimulateAuto(fn), coreSaveConfig(fn), coreVectorProbe(fn), coreAuditTail(fn), SimulateOutcome(type), SaveConfigOutcome(type), VectorProbeResult(type) |
| [src/web/models/logic.ts](src/web/models/logic.ts) | 103 | P13 纯逻辑（T2）：向量模型信息 / Key 脱敏 / 用途校验 / 反代理择优与审计 | vectorInfo(fn), maskKey(fn), rebuildEta(fn), validateUsage(fn), proxyBudgetOf(fn), remainingOf(fn), proxyEligible(fn), validatePriceCap(fn), autoPick(fn), manualPick(fn), auditProxy(fn), FALLBACK_ALWAYS_ON(const), ProxyPick(type) |
| [src/web/models/modelConfig.ts](src/web/models/modelConfig.ts) | 81 | 模型配置真落盘（Phase C3）：向量模型/维度是内核构造参数，保存后必须参与 getKernel 装配。 | readModelConfig(fn), writeModelConfig(fn), configuredVectorDim(fn), sanitizeUsages(fn), hydrateUsages(fn), clearModelConfig(fn), ModelConfig(type), PersistedUsage(type) |
| [src/web/models/modelsEntry.tsx](src/web/models/modelsEntry.tsx) | 10 | 大模型配置页（REQ-009 / P13）入口 | — |
| [src/web/models/types.ts](src/web/models/types.ts) | 54 | P13 大模型配置页（REQ-009 13.2 / 19.8）数据模型 | VectorModelInfo(type), UsageConfig(type), ProxySource(type), ProxyAuditEntry(type), VectorModelKey(type), LlmUsage(type), ProxyTier(type), ProxySelectMode(type) |
| [src/web/models/useToast.tsx](src/web/models/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/monitor/AlertTimeline.tsx](src/web/monitor/AlertTimeline.tsx) | 48 | P6-T3 告警时间线（12.2：request_id/memory_id 可点跳审计） | AlertTimeline(fn) |
| [src/web/monitor/MetricGrid.tsx](src/web/monitor/MetricGrid.tsx) | 31 | P6-T3 指标卡网格（12.1：6 组 14 卡，级别徽标 + 跳转） | MetricGrid(fn) |
| [src/web/monitor/MonitorPage.tsx](src/web/monitor/MonitorPage.tsx) | 109 | 监控仪表盘（REQ-006 / P6）· 完整编排（T5）· 真实数据接真版 | MonitorPage(fn) |
| [src/web/monitor/coreMonitor.ts](src/web/monitor/coreMonitor.ts) | 39 | 监控仪表盘（REQ-006 / P6）接真内核：告警时间线读真实账本（action='monitor_alert'，只读回放，不再灌种子）。 | coreLoadAlerts(fn), coreRaiseAlert(fn) |
| [src/web/monitor/logic.ts](src/web/monitor/logic.ts) | 47 | 监控仪表盘（REQ-006 / P6）纯逻辑层 | evalLevel(fn), inWindow(fn), filterAlerts(fn), groupMetrics(fn), percentile(fn), levelBadge(fn) |
| [src/web/monitor/monitorEntry.tsx](src/web/monitor/monitorEntry.tsx) | 10 | 监控仪表盘（REQ-006 / P6）入口（T1 壳） | — |
| [src/web/monitor/options.ts](src/web/monitor/options.ts) | 3 | 监控页宿主 Agent 筛选选项（真实可选值；指标/告警数据真相 = 内核账本）。 | AGENT_OPTIONS(const) |
| [src/web/monitor/types.ts](src/web/monitor/types.ts) | 36 | 监控仪表盘（REQ-006 / P6）数据模型 | MetricCard(type), AlertItem(type), MonitorFilter(type), AlertLevel(type) |
| [src/web/monitor/useMonitorMirror.ts](src/web/monitor/useMonitorMirror.ts) | 13 | 监控仪表盘后端镜像：挂载视图上抛（G6 fire-and-forget，monitor_view）。 | useMonitorMirror(fn) |
| [src/web/monitor/useMonitorReal.ts](src/web/monitor/useMonitorReal.ts) | 127 | 监控仪表盘（REQ-006 / P6）· 真实数据接真层 | metricsFromLedger(fn), realLoadAlerts(fn), loadRealMonitorData(fn), MONITOR_REAL_DATA_SOURCE(const), RealMonitor(type), RealStorage(type) |
| [src/web/monitor/useToast.tsx](src/web/monitor/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/overview/Overview.tsx](src/web/overview/Overview.tsx) | 159 | REQ-003 + REQ-005 配合展示（通览演示页） | Overview(fn) |
| [src/web/overview/overviewEntry.tsx](src/web/overview/overviewEntry.tsx) | 20 | REQ-003 + REQ-005 通览演示页入口 | — |
| [src/web/params/DevPanel.tsx](src/web/params/DevPanel.tsx) | 87 | P5-T3 开发者模式（折叠面板，暴露底层参数；2.4.3 / 2.4.1 / 15.3 / 9.10 / 15.1） | DevPanel(fn) |
| [src/web/params/KbManagementCard.tsx](src/web/params/KbManagementCard.tsx) | 267 | 全局参数页（REQ-006 / P5）· 记忆库管理卡片 | KbManagementCard(fn) |
| [src/web/params/KbPolicyTable.tsx](src/web/params/KbPolicyTable.tsx) | 61 | P5-T3 知识库策略表（17.6 六类，逐行可编辑，保存前校验数值区间） | KbPolicyTable(fn) |
| [src/web/params/NormalConfigCard.tsx](src/web/params/NormalConfigCard.tsx) | 84 | P5-T3 普通配置卡（17.6 文案化，G7 不暴露参数名） | NormalConfigCard(fn) |
| [src/web/params/ParamsPage.tsx](src/web/params/ParamsPage.tsx) | 106 | 全局参数页（REQ-006 / P5）T4 编排 | ParamsPage(fn) |
| [src/web/params/coreParams.ts](src/web/params/coreParams.ts) | 65 | 全局参数页（REQ-006 / P5）接真内核：参数快照存内核 preference 记忆（params:v1: JSON， | coreLoadParams(fn), coreSaveParams(fn) |
| [src/web/params/defaults.ts](src/web/params/defaults.ts) | 50 | 全局参数页默认值与展示标签（规格常量；用户保存后以内核 preference 快照为真相）。 | DEFAULT_CONFIG(const), SPEED_LABEL(const), RETENTION_LABEL(const), IMPORTANCE_LABEL(const), DEFAULT_KB_POLICIES(const), DEFAULT_DEV(const), LEVEL_MAPPING(const) |
| [src/web/params/logic.ts](src/web/params/logic.ts) | 75 | 全局参数页（REQ-006 / P5）纯逻辑层 | speedToHalfLife(fn), retentionToArchive(fn), validateWeights(fn), payloadOrdered(fn), validateKbRow(fn), validateNM(fn), validateUnitPrice(fn), validateAll(fn), auditParams(fn) |
| [src/web/params/paramsEntry.tsx](src/web/params/paramsEntry.tsx) | 10 | 全局参数页（REQ-006 / P5）入口 | — |
| [src/web/params/types.ts](src/web/params/types.ts) | 41 | 全局参数页（REQ-006 / P5）数据模型 | NormalConfig(type), KbPolicyRow(type), DevParams(type), ForgetSpeed(type), Retention(type), ImportanceLevel(type) |
| [src/web/params/useParamsMirror.ts](src/web/params/useParamsMirror.ts) | 31 | 全局参数页后端镜像（T4）：沿用 ?backend= 覆盖 + safe-noop 模式。 | resolveBackendUrl(fn), useParamsMirror(fn), ParamsMirror(type) |
| [src/web/params/useToast.tsx](src/web/params/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/retrieval/BudgetPanel.tsx](src/web/retrieval/BudgetPanel.tsx) | 40 | REQ-012 T5 预算面板（§5/R9）：三档变色 + 漏斗 + 重排闸门 + 裁剪明细 | BudgetPanel(fn) |
| [src/web/retrieval/ContextPanel.tsx](src/web/retrieval/ContextPanel.tsx) | 42 | REQ-012 T5 上下文面板（§4）：全文（cold 仅 L2 + 审计展开）/ 关联 / 参数只读 / 跳转 | ContextPanel(fn) |
| [src/web/retrieval/ModeBanner.tsx](src/web/retrieval/ModeBanner.tsx) | 47 | REQ-012 T5 生效模式横幅（§2） | ModeBanner(fn) |
| [src/web/retrieval/QueryBar.tsx](src/web/retrieval/QueryBar.tsx) | 86 | REQ-012 T3 查询栏（§1）：query/scene/mode + 校验 + 联动 | QueryBar(fn), QueryBarValue(type) |
| [src/web/retrieval/ResultList.tsx](src/web/retrieval/ResultList.tsx) | 50 | REQ-012 T4 结果列表（§3：Top K 默认 3-5，加载更多至 10） | ResultList(fn) |
| [src/web/retrieval/ResultRow.tsx](src/web/retrieval/ResultRow.tsx) | 52 | REQ-012 T4 结果行（§3.1 字段 + §3.2 操作） | ResultRow(fn) |
| [src/web/retrieval/RetrievalPage.tsx](src/web/retrieval/RetrievalPage.tsx) | 132 | 检索页（REQ-012）T6 编排：查询栏 + 横幅 + 结果 + 预算 + 上下文 + 异常态 | RetrievalPage(fn) |
| [src/web/retrieval/coreEngine.ts](src/web/retrieval/coreEngine.ts) | 128 | REQ-012 接真内核引擎（T7）：与 fakeEngine 同签名（async），内部走 memagent-core ma.recall | coreReorderMemory(fn), coreEngine(fn), EngineResult(type) |
| [src/web/retrieval/logic.ts](src/web/retrieval/logic.ts) | 134 | 检索页（REQ-012）纯逻辑层 | modeName(fn), sceneName(fn), normalizeScene(fn), normalizeMode(fn), resolveSceneBudget(fn), resolveModeLinkage(fn), isMinimalCandidate(fn), autoDispatch(fn), sortHits(fn), freshness(fn), decayClass(fn), budgetLevel(fn), validateQuery(fn) |
| [src/web/retrieval/retrievalEntry.tsx](src/web/retrieval/retrievalEntry.tsx) | 10 | 检索页（REQ-012）入口 | — |
| [src/web/retrieval/types.ts](src/web/retrieval/types.ts) | 68 | 检索页（REQ-012）数据模型 | RetrievalHit(type), SceneBudget(type), ModeBannerData(type), BudgetData(type), Scene(type), Mode(type), ModeSel(type), PageState(type), DecayClass(type), BudgetLevel(type) |
| [src/web/retrieval/useRetrieval.ts](src/web/retrieval/useRetrieval.ts) | 61 | REQ-012 T6 状态机 hook（§0/§6）：IDLE→LOADING→RESULT/EMPTY/ERROR；二次查询保留 session，request_id 每次新生成（R7/§7.6）。 | useRetrieval(fn), RetrievalState(type), Phase(type) |
| [src/web/retrieval/useToast.tsx](src/web/retrieval/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/security/AccountAdminCard.tsx](src/web/security/AccountAdminCard.tsx) | 164 | 管理员账号卡片（批次7）：账号列表 / 角色切换 / 团队分配 / 修改我的密码。 | AdminAccountCard(fn) |
| [src/web/security/L0AdminCard.tsx](src/web/security/L0AdminCard.tsx) | 345 | 账号与安全页 · L0 密钥环管理卡（§4.4） | L0AdminCard(fn) |
| [src/web/security/LegacyLedgerCard.tsx](src/web/security/LegacyLedgerCard.tsx) | 138 | 安全页 · 遗留账本清理卡（批次24） | LegacyLedgerCard(fn) |
| [src/web/security/PwdPolicyCard.tsx](src/web/security/PwdPolicyCard.tsx) | 62 | P12-T3 密码策略 + 实时校验（4.2） | PwdPolicyCard(fn) |
| [src/web/security/SecurityCards.tsx](src/web/security/SecurityCards.tsx) | 97 | P12-T3 角色矩阵（只读）+ 成员表（增删改/共享标记）+ 密钥表（轮换/吊销） | RoleMatrixCard(fn), MemberTable(fn), KeyTable(fn) |
| [src/web/security/SecurityPage.tsx](src/web/security/SecurityPage.tsx) | 92 | 账号与安全页（REQ-006 / P12）T4 编排 | SecurityPage(fn) |
| [src/web/security/accountsClient.ts](src/web/security/accountsClient.ts) | 102 | 账号管理 API client（批次7）：走 home server 的管理员接口，权限由后端强制。 | fetchMyContext(fn), fetchAccounts(fn), updateAccount(fn), changeOwnPassword(fn), AccountView(type), ApiResult(type) |
| [src/web/security/coreSecurity.ts](src/web/security/coreSecurity.ts) | 85 | 账号与安全页（REQ-006 / P12）接真内核：安全操作真写 storage 审计账本 | coreSecurityAudit(fn), coreLoadSecurityAudit(fn), coreL0Status(fn), coreL0SetupAdminPassword(fn), coreL0ChangeAdminPassword(fn), coreL0ListRequests(fn), coreL0ListGrants(fn), coreL0Grant(fn), coreL0Deny(fn), coreL0Revoke(fn), coreL0UnlockWrite(fn), coreL0LockWrite(fn), coreL0Migrate(fn) |
| [src/web/security/defaults.ts](src/web/security/defaults.ts) | 24 | 账号与安全页规格常量（密码策略 / 禁用词 / 角色矩阵）。 | DEFAULT_POLICY(const), FORBIDDEN_PATTERNS(const), ROLE_MATRIX(const) |
| [src/web/security/logic.ts](src/web/security/logic.ts) | 44 | 账号与安全页（REQ-006 / P12）纯逻辑层 | validatePwd(fn), canCrossTeam(fn), rotateWarn(fn), inGrace(fn), maskKey(fn), ROTATE_GRACE_HOURS(const), ROTATE_WARN_DAYS(const) |
| [src/web/security/securityEntry.tsx](src/web/security/securityEntry.tsx) | 10 | 账号与安全页（REQ-006 / P12）入口（T1 壳） | — |
| [src/web/security/types.ts](src/web/security/types.ts) | 32 | 账号与安全页（REQ-006 / P12）数据模型 | PwdPolicy(type), TeamMember(type), ApiKey(type), Scope(type) |
| [src/web/security/useSecurityMirror.ts](src/web/security/useSecurityMirror.ts) | 30 | 账号与安全页后端镜像（T4）：safe-noop 模式。 | resolveBackendUrl(fn), useSecurityMirror(fn), SecurityMirror(type) |
| [src/web/security/useToast.tsx](src/web/security/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/shared/PageNav.tsx](src/web/shared/PageNav.tsx) | 102 | 分页导航条（批次24）：首页/上一页/跳页输入/下一页/尾页 + 每页条数（默认 10）。 | PageNav(fn), PageNavProps(type) |
| [src/web/shared/actionLog.ts](src/web/shared/actionLog.ts) | 103 | 渲染层动作日志（批次7）：任何页面 import 本模块即自动安装全局捕获。 | uiLog(fn), installUiActionLog(fn) |
| [src/web/shared/kernelLoad.tsx](src/web/shared/kernelLoad.tsx) | 95 | 内核数据加载三态（批次25 P0-7）：loading / ok / error —— 「读不到」绝不渲染成「账本为空」。 | kernelErrorText(fn), useKernelLoad(fn), KernelLoadError(fn), KernelLoadResult(type), KernelLoadPhase(type) |
| [src/web/shared/kernelProjects.ts](src/web/shared/kernelProjects.ts) | 15 | 项目 ID 真源（批次27 P2-7）：真实项目从内核账本派生（与 MCP list_projects 同口径）， | listProjectIds(fn), DEFAULT_PROJECT_ID(const) |
| [src/web/shared/l0Port.ts](src/web/shared/l0Port.ts) | 178 | 渲染层 L0 端口（§4.4）：把内核 L0Port / L0AdminPort 调用转发到主进程 L0Vault。 | l0HostAvailable(fn), HostL0Port(class), HostL0Admin(class) |
| [src/web/shared/layerTime.ts](src/web/shared/layerTime.ts) | 12 | 层级生成时间口径（批次24 拍板：一条记忆只记一个「本组层内容生成时间」，不逐层记）。 | fmtLayerGen(fn), LAYER_GEN_UNRECORDED(const) |
| [src/web/shared/paginate.ts](src/web/shared/paginate.ts) | 31 | 列表分页纯函数（批次24）：记忆库 / 日志记录 / 审计日志共用同一口径。 | paginate(fn), PAGE_SIZES(const), DEFAULT_PAGE_SIZE(const), PageParams(type), Paged(type) |
| [src/web/shared/session.ts](src/web/shared/session.ts) | 57 | 当前会话（批次7）：跨 iframe 共享的 sessionId + home server /api/me 的真实上下文。 | currentSessionId(fn), fetchSessionContext(fn), useSessionContext(fn), SessionState(type), SessionRole(type) |
| [src/web/shared/useColWidths.tsx](src/web/shared/useColWidths.tsx) | 97 | 表头列宽拖拽与固化（批次24）：记忆库 / 日志记录 / 审计日志三张表共用同一实现。 | loadColWidths(fn), saveColWidths(fn), useColWidths(fn), ColResizeHandle(fn), MIN_COL_WIDTH(const), ColWidths(type) |
| [src/web/shared/useL0Session.ts](src/web/shared/useL0Session.ts) | 155 | 渲染层 L0 连续查阅会话（§4.4.3，日志页 / 记忆层级页共用）： | useL0Session(fn), formatRemaining(fn), L0_HEARTBEAT_MS(const), L0SessionView(type), L0SessionApi(type), L0UnlockOutcome(type), L0RequestOutcome(type) |
| [src/web/test-setup.ts](src/web/test-setup.ts) | 1 | — | — |
| [src/web/vite-env.d.ts](src/web/vite-env.d.ts) | 2 | Vite 侧效应导入（CSS）的类型声明 | — |
| [src/web/write/DedupCard.tsx](src/web/write/DedupCard.tsx) | 37 | 写入页（REQ-006 / P2）查重预览卡（T4） | DedupCard(fn) |
| [src/web/write/WriteForm.tsx](src/web/write/WriteForm.tsx) | 124 | 写入页（REQ-006 / P2）表单（T3） | WriteForm(fn) |
| [src/web/write/WritePage.tsx](src/web/write/WritePage.tsx) | 131 | 写入页（REQ-006 / P2）· 完整编排（T5） | WritePage(fn) |
| [src/web/write/coreWrite.ts](src/web/write/coreWrite.ts) | 74 | 写入页（REQ-006 / P2）接真内核：ma.write（六类 + 查重短路嫁接 + 审计） | coreWrite(fn), coreListExisting(fn), CoreWriteOutcome(type) |
| [src/web/write/logic.ts](src/web/write/logic.ts) | 140 | 写入页（REQ-006 / P2）纯逻辑层 | estimateTokens(fn), needsRefine(fn), validateDraft(fn), jaccard(fn), scoreDedup(fn), thresholdForLayer(fn), composeReceipt(fn), ReceiptOptions(type) |
| [src/web/write/spec.ts](src/web/write/spec.ts) | 25 | 写入页（REQ-006 / P2）规格常量（非演示数据） | TAG_SUGGESTIONS(const), CATEGORY_PREVIEW(const), LAYER_THRESHOLDS(const) |
| [src/web/write/types.ts](src/web/write/types.ts) | 71 | 写入页（REQ-006 / P2）数据模型 | MemoryDraft(type), ExistingMemory(type), DedupResult(type), ReceiptLayer(type), WriteReceipt(type), ValidationResult(type), MemoryCategory(type), SourceKind(type), LayerName(type) |
| [src/web/write/useToast.tsx](src/web/write/useToast.tsx) | 22 | 轻量 toast hook（T5）：返回展示节点与 show(msg) | useToast(fn) |
| [src/web/write/useWriteMirror.ts](src/web/write/useWriteMirror.ts) | 32 | 写入页后端镜像（T5）：沿用 ?backend= 覆盖模式。 | resolveBackendUrl(fn), useWriteMirror(fn), WriteMirror(type) |
| [src/web/write/writeEntry.tsx](src/web/write/writeEntry.tsx) | 10 | 写入页（REQ-006 / P2）入口：挂载 WritePage。 | — |

## 指纹（P2-18）

任一源码文件内容变化都会让 --check 失败（单行改动也不例外）。

e2e/dev-server.ts 30c7769e5e02
e2e/global-setup.mjs 057eba39425b
e2e/global-teardown.mjs 517d14f4d985
e2e/harness.ts 89419d99cd6f
e2e/run.mjs 3a472110f3e2
e2e/servers.ts 1b241a102adf
src/agentOnboard/client.ts 165163775053
src/agentOnboard/formMatrix.ts e7dd02db5873
src/agentOnboard/mcpClients.ts acc369f570e5
src/agentOnboard/probe.ts b1d3392a8393
src/agentOnboard/server.ts 8d5defd4c8c1
src/agentOnboard/service.ts 298c23facc74
src/agentOnboard/stateMachine.ts 8959634e14b2
src/agentOnboard/validators.ts a7372fc705a7
src/auth/hash.ts 3919b27befef
src/auth/loginService.ts 763258e6a477
src/core/memagent/agent.ts c58bd8bf052c
src/core/memagent/crypto.ts 6e5f2f4845bb
src/core/memagent/dedup.ts 7035020d489f
src/core/memagent/errors.ts 2d1d3445d74b
src/core/memagent/fileStorage.ts 52105fa7665f
src/core/memagent/forgetting.ts d3510059827c
src/core/memagent/l0vault.ts c406d073f3ce
src/core/memagent/layerRules.ts d070464f49cb
src/core/memagent/legacyLayers.ts 8f912218cef5
src/core/memagent/llm.ts b0d63a5e5bd4
src/core/memagent/mcp.ts 63e4f1f9a102
src/core/memagent/mcpAuth.ts 973d6419b4b8
src/core/memagent/mcpHttp.ts 99942b8c90e9
src/core/memagent/mcpRecall.ts c80dfe3be4a8
src/core/memagent/mcpSchema.ts 1599894b788c
src/core/memagent/memories.ts 717f2fcb6c91
src/core/memagent/paramsSnapshot.ts 0089f839839e
src/core/memagent/pgSyncHub.ts dcf899e8acd4
src/core/memagent/qualityGate.ts 973cc33b769b
src/core/memagent/recallInsight.ts 1fb97f46d298
src/core/memagent/sessionCollector.ts 83462ddfa60d
src/core/memagent/sqliteStorage.ts 0c0c891d84cc
src/core/memagent/storage.ts 88cdd05e7b35
src/core/memagent/sync.ts ffdeb7ae3aea
src/core/memagent/types.ts e46c7acf36d2
src/core/memagent/ulid.ts 634c99f1962a
src/core/memagent/vector.ts c51101cb38c0
src/core/memagent/webhook.ts deae36bbc0ca
src/desktop/hostBridge.ts 7d2d139733a1
src/desktop/hostScan.ts 0559ae3ef556
src/desktop/ipcStorage.ts f2b062a694a3
src/electron/actionLog.ts 209f1eaec0b3
src/electron/agentDetect.ts 3c31af9a1ae7
src/electron/dataRoot.ts 03964b375042
src/electron/hostScan.ts 694d58d7048c
src/electron/ipcChannels.ts 4a2d2dc7703f
src/electron/l0KeyringStore.ts b900f5d523d5
src/electron/main.ts edf50b529086
src/electron/mcpClients.ts b4354a0164c4
src/electron/preload.ts 34714a36e3d0
src/electron/webhookServer.ts 62157c0b1e21
src/home/dashboard.ts a23bc82dbf9d
src/home/server.ts b1aa1b8777d6
src/inlineAttribution/decay.ts c5e1d8e82628
src/inlineAttribution/feedback.ts b40da561e8c4
src/shared/actionLog.ts 1b24456244f2
src/shared/auditShape.ts 5d37cae8c5f0
src/shared/localOrigin.ts 26f99e4f1928
src/shared/sessionKey.ts ab2fa7617802
src/types/agentOnboard.ts 488a56d3e926
src/types/home.ts bedfcc8518ec
src/types/inlineAttribution.ts f4e6759adb6d
src/web/AgentOnboard/AgentCard.tsx 2f157b7bf6d9
src/web/AgentOnboard/AgentOnboardPage.tsx 12ca5014f257
src/web/AgentOnboard/ChannelConfig.tsx b32e6a426470
src/web/AgentOnboard/FormBadge.tsx b2425eba179f
src/web/AgentOnboard/Gains.tsx 5dd221d1770f
src/web/AgentOnboard/IsolationConfig.tsx ae7060ad6cce
src/web/AgentOnboard/KeyMgmt.tsx 1f40e96ae2f1
src/web/AgentOnboard/McpClientsPanel.tsx 8772707577d7
src/web/AgentOnboard/McpToolConfig.tsx 0450306a0a33
src/web/AgentOnboard/OneClickOnboard.tsx 6d27b6fefff5
src/web/AgentOnboard/TestPanel.tsx 616d8c8aaa4f
src/web/AgentOnboard/agentOnboardEntry.tsx fb35983bae60
src/web/AgentOnboard/autoDiscovery.ts c2fd3f26363d
src/web/AgentOnboard/autoOnboard.ts ae8b38ca7c48
src/web/AgentOnboard/cards.ts 3dc5d5885b15
src/web/AgentOnboard/coreOnboard.ts e107daf27b9a
src/web/AgentOnboard/onboardState.ts 3b1368aac6d8
src/web/AgentOnboard/store.ts 0e28d5609de5
src/web/AgentOnboard/useBackendMirror.ts 0cbebeea7d03
src/web/Home/Dashboard.tsx d0a5545068e5
src/web/Home/HomePage.tsx 1ce5014e6328
src/web/Home/LayerGraphPanel.tsx 7c94457e288e
src/web/Home/LoginModal.tsx 6cdb06c0c55d
src/web/Home/ProgramLogPanel.tsx 7951f28c2a5d
src/web/Home/TopBar.tsx e76cf5709f0a
src/web/Home/coreHome.ts da9bc9d374b6
src/web/Home/crossTabAuth.ts d85780df575e
src/web/Home/layerGraph.ts 9a728a7ec61e
src/web/Home/layerGraphLayout.ts 8215d57492af
src/web/Home/programLog.ts 4dd7748fe50e
src/web/Home/programLogLabels.ts 4a100b85f150
src/web/Home/tenantContext.tsx f9769d7590c9
src/web/Home/useLoginMirror.ts 853b3dc8f825
src/web/InlineAttribution/AgentConversationDemo.tsx bfc1ae30298f
src/web/InlineAttribution/AgingWarnTag.tsx 4ccd1ca5a7bb
src/web/InlineAttribution/AttributionConfig.tsx 3c9a93f13348
src/web/InlineAttribution/AttributionSummary.tsx 488f8b567036
src/web/InlineAttribution/AttributionToggle.tsx a8bb3f1fe3a3
src/web/InlineAttribution/BackgroundChip.tsx 0ee6a31b5bc2
src/web/InlineAttribution/MemoryInjectionTag.tsx 835851d4fc90
src/web/InlineAttribution/TokenSavingBar.tsx 40dbf2ece0f2
src/web/InlineAttribution/coreInline.ts f8d0b7c28727
src/web/InlineAttribution/floatEntry.tsx 9ef26ad231da
src/web/InlineAttribution/inlineAttributionEntry.tsx 8947281e61dd
src/web/InlineAttribution/useInlineReal.ts 2a40711c4529
src/web/audit/AuditPage.tsx ea2eb23dfc05
src/web/audit/AuditTable.tsx 9961842a0157
src/web/audit/FilterBar.tsx e3841ffb3c54
src/web/audit/auditEntry.tsx 2ee6f92922ca
src/web/audit/coreAudit.ts 2844b7df889b
src/web/audit/logic.ts 026d577ecde4
src/web/audit/types.ts f66de14cbbf4
src/web/audit/useAuditMirror.ts 73c3d558a283
src/web/audit/useToast.tsx 85cd09d2e1f5
src/web/backend.ts 8fdc10aa241d
src/web/dispute/DisputePage.tsx a6a40a8ff92f
src/web/dispute/DisputeQueue.tsx 1d5b9886592b
src/web/dispute/DisputeVerdict.tsx c16bc4aaec10
src/web/dispute/coreDispute.ts 3e4a928a4dd9
src/web/dispute/disputeEntry.tsx dbd10a2b2949
src/web/dispute/labels.ts 0a7c4f40dbb4
src/web/dispute/logic.ts 48f85246dcd6
src/web/dispute/types.ts 17c00b4be676
src/web/dispute/useDisputeMirror.ts a36c4465002d
src/web/dispute/useToast.tsx c650d8662672
src/web/feedback/FeedbackForm.tsx d2f31ef7ef80
src/web/feedback/FeedbackPage.tsx f6238115c9cb
src/web/feedback/StatCards.tsx d0be83e172de
src/web/feedback/coreFeedback.ts 53aef1039a1f
src/web/feedback/feedbackEntry.tsx b9aad0d398bf
src/web/feedback/logic.ts 77d8860bb501
src/web/feedback/types.ts 4eda7b1ec5aa
src/web/feedback/useFeedbackMirror.ts bed978a94244
src/web/feedback/useToast.tsx 85cd09d2e1f5
src/web/growth/DedupCards.tsx 8a8b1d91f676
src/web/growth/GrowthPage.tsx 54fd652e6332
src/web/growth/GrowthPanels.tsx 373a97bd7370
src/web/growth/coreGrowth.ts a68655828429
src/web/growth/growthEntry.tsx af1f1a1c4b42
src/web/growth/logic.ts 8ec866561d2f
src/web/growth/spec.ts 4ee744046e00
src/web/growth/types.ts b0a835f61188
src/web/growth/useGrowthMirror.ts f485e5b5dae2
src/web/growth/useGrowthReal.ts a1834cc7986e
src/web/growth/useToast.tsx 85cd09d2e1f5
src/web/httpStorage.ts 0a276a4ccb4a
src/web/kernel.ts d2a9e4940452
src/web/lifecycle/LifecycleCard.tsx c115dc841539
src/web/lifecycle/LifecyclePage.tsx 311822ea441f
src/web/lifecycle/ParamPanel.tsx 5858a0c4c600
src/web/lifecycle/constants.ts 4bbab102ec8b
src/web/lifecycle/coreLifecycle.ts af3caad421f9
src/web/lifecycle/lifecycleEntry.tsx 4179fa9bc287
src/web/lifecycle/lifecycleFilter.ts 1f8538e5fdb8
src/web/lifecycle/logic.ts 7574f2b0fe12
src/web/lifecycle/types.ts b96b0c4d96c0
src/web/lifecycle/useLifecycleMirror.ts 721f7109ba66
src/web/lifecycle/useToast.tsx 85cd09d2e1f5
src/web/logs/LogCards.tsx 9238e0c02566
src/web/logs/LogFilterBar.tsx 70ba5e38635e
src/web/logs/LogsPage.tsx 09d7c1da6505
src/web/logs/coreLogs.ts 84d97af9ba74
src/web/logs/labels.ts ff2e35c2a949
src/web/logs/logic.ts e3880c7193ac
src/web/logs/logsEntry.tsx c4bc7bde74d8
src/web/logs/types.ts c57557c7576e
src/web/logs/useToast.tsx 85cd09d2e1f5
src/web/main.tsx 9173d0a9af75
src/web/memory/LayerFilterBar.tsx 5f8c2bea1169
src/web/memory/LayerMemoryTable.tsx 6fd085b03ff4
src/web/memory/MemoryActions.tsx 9983e64102b0
src/web/memory/MemoryDrawer.tsx 9f6b29b0d433
src/web/memory/MemoryLayeredPage.tsx 0c25ca0c921f
src/web/memory/MemoryPage.tsx 2e3d00b005c4
src/web/memory/MemoryRow.tsx 0be7881628bf
src/web/memory/MemoryTable.tsx d0e26f9d929e
src/web/memory/backup.ts 3fa654787bea
src/web/memory/coreMemoryOps.ts b49a2b3bc5ec
src/web/memory/dataRoot.ts 285a5967d1d9
src/web/memory/layerFilter.ts d9c4a1bec5e9
src/web/memory/logic.ts da69f12783ea
src/web/memory/memoryEntry.tsx a6349c82f715
src/web/memory/memoryFilter.ts db9d5974cc27
src/web/memory/memoryLayeredEntry.tsx 329f002ac527
src/web/memory/types.ts cdd9cf789484
src/web/memory/useMemoryMirror.ts a94281e49b72
src/web/memory/useToast.tsx c650d8662672
src/web/mirrorClient.ts 8e52426471c9
src/web/models/LlmUsageTable.tsx 074fe4014d88
src/web/models/ModelsPage.tsx 9cba395fd7e8
src/web/models/ProxyPanel.tsx 6b74e6346646
src/web/models/VectorCard.tsx a8d650dc7455
src/web/models/catalog.ts ba00b405b04b
src/web/models/coreModels.ts 531c4edcf402
src/web/models/logic.ts 7005d1d1dc20
src/web/models/modelConfig.ts 6ce0b9cbca4b
src/web/models/modelsEntry.tsx de9c4158e6c0
src/web/models/types.ts 5a80db76a3fe
src/web/models/useToast.tsx 85cd09d2e1f5
src/web/monitor/AlertTimeline.tsx 24c506f1e565
src/web/monitor/MetricGrid.tsx 7697c8863120
src/web/monitor/MonitorPage.tsx d439da9419c8
src/web/monitor/coreMonitor.ts 6b0c29922b63
src/web/monitor/logic.ts 047ec4b39ad1
src/web/monitor/monitorEntry.tsx 9a24cb52cf96
src/web/monitor/options.ts 6c9a71c785f2
src/web/monitor/types.ts 31210fc87ca9
src/web/monitor/useMonitorMirror.ts 9e87dd8cc071
src/web/monitor/useMonitorReal.ts df68f6ea4826
src/web/monitor/useToast.tsx 85cd09d2e1f5
src/web/overview/Overview.tsx 4a9f4690fb75
src/web/overview/overviewEntry.tsx 5f4488678cc7
src/web/params/DevPanel.tsx 4d2f45da1bcd
src/web/params/KbManagementCard.tsx ae71b9713586
src/web/params/KbPolicyTable.tsx b50f471cc589
src/web/params/NormalConfigCard.tsx f6da14e007e0
src/web/params/ParamsPage.tsx 903098f3dcc7
src/web/params/coreParams.ts ddf4cbba772c
src/web/params/defaults.ts aae990e826ed
src/web/params/logic.ts 72f8c9893dc5
src/web/params/paramsEntry.tsx 47657233be13
src/web/params/types.ts 58c344267f04
src/web/params/useParamsMirror.ts 7d74f4d5e8c4
src/web/params/useToast.tsx 85cd09d2e1f5
src/web/retrieval/BudgetPanel.tsx 37d9e0b3efe7
src/web/retrieval/ContextPanel.tsx ced78de9c9db
src/web/retrieval/ModeBanner.tsx 6fe6fc992fae
src/web/retrieval/QueryBar.tsx d397ce2b3f0a
src/web/retrieval/ResultList.tsx 12804bf53d10
src/web/retrieval/ResultRow.tsx 37402263bf53
src/web/retrieval/RetrievalPage.tsx d698ebee76ff
src/web/retrieval/coreEngine.ts 9a1102dba94b
src/web/retrieval/logic.ts a39b8afe5920
src/web/retrieval/retrievalEntry.tsx 48813d404181
src/web/retrieval/types.ts 02c4f1b8beba
src/web/retrieval/useRetrieval.ts eccac7ca812e
src/web/retrieval/useToast.tsx 85cd09d2e1f5
src/web/security/AccountAdminCard.tsx 23692c9117df
src/web/security/L0AdminCard.tsx 94fa75de78b8
src/web/security/LegacyLedgerCard.tsx 728888b09019
src/web/security/PwdPolicyCard.tsx ad12fb5ffafb
src/web/security/SecurityCards.tsx 48b2ad93f0df
src/web/security/SecurityPage.tsx 787d5b5b9707
src/web/security/accountsClient.ts 4574e6fb4020
src/web/security/coreSecurity.ts a36eae36b809
src/web/security/defaults.ts d93ad609b42a
src/web/security/logic.ts 8b9c8e8ce379
src/web/security/securityEntry.tsx be7c167961b2
src/web/security/types.ts 04d0b5035451
src/web/security/useSecurityMirror.ts 6279bcbf5408
src/web/security/useToast.tsx 85cd09d2e1f5
src/web/shared/PageNav.tsx fed5dc790db7
src/web/shared/actionLog.ts 526428054e7d
src/web/shared/kernelLoad.tsx 210a4fbe17f4
src/web/shared/kernelProjects.ts a3b48cd2181f
src/web/shared/l0Port.ts eca5be9d579c
src/web/shared/layerTime.ts 6c21b4d94211
src/web/shared/paginate.ts d79b09857836
src/web/shared/session.ts 2bc9578bb923
src/web/shared/useColWidths.tsx a6e14931a82b
src/web/shared/useL0Session.ts c917a61c99d9
src/web/test-setup.ts 3a2ad06d2218
src/web/vite-env.d.ts 191b7a12f3de
src/web/write/DedupCard.tsx 5724033c1ece
src/web/write/WriteForm.tsx ae3bb29058ff
src/web/write/WritePage.tsx bd1d741ac1de
src/web/write/coreWrite.ts 3a138975d7c5
src/web/write/logic.ts 3f4aebf1eae6
src/web/write/spec.ts 27df79f585c2
src/web/write/types.ts c4cca32917e1
src/web/write/useToast.tsx c650d8662672
src/web/write/useWriteMirror.ts cdce3bf5d68d
src/web/write/writeEntry.tsx b4a67bb13466
