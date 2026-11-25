# 代码索引（自动生成）

> 由 `npm run code:index` 生成，请勿手改；改代码/文档后重跑即可。
> 用法：先在本表定位文件与导出符号，再只读该文件的局部区间（省 token、少误改）。

共 455 个源码文件、175 个文档。

## e2e

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [e2e/dev-server.ts](e2e/dev-server.ts) | 48 | 人工实页测试用：零依赖静态服务（镜像 e2e/servers.ts，端口 8127） | — |
| [e2e/global-setup.mjs](e2e/global-setup.mjs) | 175 | 启动一个 detached 的 Chromium（headless，开 CDP 端口），供 E2E 用 connectOverCDP 连接。 | — |
| [e2e/global-teardown.mjs](e2e/global-teardown.mjs) | 24 | 关闭 globalSetup 启动的 detached Chromium。taskkill/进程信号被安全策略拦截时静默失败： | — |
| [e2e/harness.ts](e2e/harness.ts) | 86 | E2E 测试基座：覆盖 page fixture，改用「外部已启动的 Chromium（CDP 连接）」。 | disconnectBrowser(fn), collectErrors(fn), test(const) |
| [e2e/run.mjs](e2e/run.mjs) | 26 | E2E 启动器：① 构建被测产物（vite build → dist/）② 以空 NODE_OPTIONS 拉起 Playwright。 | — |
| [e2e/servers.ts](e2e/servers.ts) | 138 | E2E 用：进程内静态文件服务器 + 复用真实后端，避免 Playwright webServer 子进程在 Windows 上卡 teardown。 | startStatic(fn), startHomeBackend(fn), closeServer(fn), stopRunningServer(fn), StaticServer(type) |

## src/agentOnboard

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/agentOnboard/client.ts](src/agentOnboard/client.ts) | 134 | Agent 接入 HTTP 客户端（REQ-003 接真实后端 · T14） | AgentOnboardClient(class) |
| [src/agentOnboard/formMatrix.ts](src/agentOnboard/formMatrix.ts) | 35 | 按端置灰矩阵 (REQ-003 §9 / 19.10 / T10) | signalSourcesForForm(fn), isSourceGrayed(fn), SIGNAL_SOURCES(const), SignalSource(type) |
| [src/agentOnboard/mcpClients.ts](src/agentOnboard/mcpClients.ts) | 597 | MCP 客户端接入配方（批次15）：单一真源。 | specOfMcpClient(fn), mcpHeaderPairs(fn), buildMcpEntry(fn), buildStdioMcpEntry(fn), isStdioEntry(fn), renderMcpSnippet(fn), probeJsonConfig(fn), probeTomlConfig(fn), probeClientConfig(fn), mergeMcpJsonConfig(fn), mergeMcpTomlConfig(fn), MCP_ENDPOINT(const), MCP_BRIDGE_FILE_NAME(const), MCP_STDIO_COMMAND(const), MCP_CLIENT_SPECS(const), MCP_CLIENT_HEADER_NAME(const), McpStdioTarget(type), McpClientSpec(type), McpConfigProbe(type), McpTransport(type), McpClientId(type), McpConfigFormat(type), McpEntryStyle(type), McpWireState(type) |
| [src/agentOnboard/probe.ts](src/agentOnboard/probe.ts) | 38 | Agent 接入真实拨测（Phase C2）：以「本机安装痕迹」为唯一真相。 | createHostAgentProbe(fn), HostAgentProbeOptions(type) |
| [src/agentOnboard/server.ts](src/agentOnboard/server.ts) | 303 | Agent 接入真实后端（REQ-003 接真实后端 · T13） | createServer(fn), RunningServer(type) |
| [src/agentOnboard/service.ts](src/agentOnboard/service.ts) | 514 | Agent 接入服务层(REQ-003 T11 集成 / T12 E2E 链路) | ONBOARD_SYNC_SCOPE(const), ONBOARD_DECAY_EXEMPT(const), AgentOnboardService(class), OnboardBackend(type), ConfigureResult(type), TestResult(type), RotateResult(type), RevokeKeyResult(type), RevokeBindResult(type), ProbeResult(type), TenantStamp(type), AuditStore(type), OnboardServiceOptions(type), OneClickResult(type), AuditEntry(type), DiscoverInput(type), AgentProbe(type) |
| [src/agentOnboard/stateMachine.ts](src/agentOnboard/stateMachine.ts) | 66 | Agent 接入卡片状态机 (REQ-003 §0 页面状态 / T2) | transition(fn), TRANSITIONS(const), CardEvent(type) |
| [src/agentOnboard/validators.ts](src/agentOnboard/validators.ts) | 116 | Agent 接入配置校验器 (REQ-003 §6 校验规则 R1-R6 / §7 边界约束 R1-R10 / T9) | checkR1_tenantNotHandFilled(fn), checkR2_projectIdRequired(fn), checkR3_criticalNoMinimal(fn), checkR4_dualChannelAtLeastOne(fn), checkR5_keyNotReflected(fn), checkR6_circuitDegrade(fn), checkR7_requestIdAudit(fn), checkR8_oneClickReadOnly(fn), checkR9_autoBindRevocable(fn), checkR10_discoverLocalOnly(fn), validateOnboard(fn), Violation(type) |

## src/auth

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/auth/hash.ts](src/auth/hash.ts) | 42 | REQ-005 T2：密码哈希与校验（规格 §4.1 安全） | hashPassword(fn), verifyPassword(fn) |
| [src/auth/loginService.ts](src/auth/loginService.ts) | 304 | REQ-005 T3：登录业务逻辑 + 锁定策略（规格 §0.3 / §4.2 / §4.3） | registerAccount(fn), hasAccount(fn), resetAuthStore(fn), exportAccountSnapshot(fn), importAccountSnapshot(fn), listAccounts(fn), adminCount(fn), isDefaultAdminPasswordInUse(fn), seedAdminAccount(fn), changePassword(fn), setAccountRole(fn), assignAccountTeam(fn), lockoutState(fn), exportLockSnapshot(fn), readLockState(fn), writeLockState(fn), clearLockState(fn), importLockSnapshot(fn), login(fn), LOCK_THRESHOLD(const), LOCK_WINDOW_MS(const), ADMIN_ACCOUNT(const), DEFAULT_ADMIN_PASSWORD(const), AccountView(type) |
| [src/auth/memberSync.ts](src/auth/memberSync.ts) | 67 | 批次45-B2：home 账号 ↔ 内核 Member 打通。 | syncMembersFromHome(fn), syncMembersFromHomeNow(fn), MemberSyncReport(type) |

## src/core

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/core/memagent/agent.ts](src/core/memagent/agent.ts) | 962 | createMemAgent（§1 入口）：内核装配 + 9 核心API + 全动作审计（§3.2） | isEvidenceThin(fn), createMemAgent(fn), EVIDENCE_THIN_RELEVANCE(const) |
| [src/core/memagent/agentUsage.ts](src/core/memagent/agentUsage.ts) | 171 | 批次61 GAP-3：Agent 侧 × 桌面侧双向可观测。 | summarizeAgentUsage(fn), readAgentUsage(fn), CLIENT_UNKNOWN(const), AGENT_USAGE_NOTE(const), GC_CONCURRENCY_NOTE(const), AgentUsageRow(type), AgentUsageSummary(type), AgentUsageRead(type) |
| [src/core/memagent/auditLog.ts](src/core/memagent/auditLog.ts) | 398 | 内核审计账本（批次41-A）：从 memories.db.json 里搬出来，独立成追加式 JSONL。 | AUDIT_FILE_NAME(const), AUDIT_ACTIVE_MAX_BYTES(const), AuditLogCorruptError(class), AuditLogLockedError(class), FileAuditLog(class), AuditFilter(type), AuditLogStats(type), FileAuditLogOptions(type) |
| [src/core/memagent/collectDaemon.ts](src/core/memagent/collectDaemon.ts) | 161 | 批次44-A：独立采集守护（headless）——daemon 只做「扫描 + 指纹去重 + 暂存分片」，**永不碰账本**。 | runDaemonRound(fn), drainCollectPending(fn), DAEMON_DIR_NAME(const), PENDING_DIR_NAME(const), DaemonState(type), DaemonRoundReport(type), DrainReport(type) |
| [src/core/memagent/conflict.ts](src/core/memagent/conflict.ts) | 256 | 批次46-3：内核冲突裁决原子 API（方案 §3 / §9.7 + P7 hold） | coreListConflicts(fn), coreResolveConflict(fn), CONFLICT_NOTE(const), CONFLICT_VERDICTS(const) |
| [src/core/memagent/crypto.ts](src/core/memagent/crypto.ts) | 330 | L0 加密层（§4.1）：AES-256-GCM + PBKDF2 派生密钥。 | encryptL0(fn), parseL0Envelope(fn), decryptL0(fn), randomBytes(fn), generateDek(fn), newWrapSalt(fn), deriveKek(fn), wrapSecret(fn), unwrapSecret(fn), encryptL0WithKey(fn), parseL0EnvelopeV2(fn), decryptL0WithKey(fn), L0_KEK_ITER(const), L0_DEK_BYTES(const), MASK(const), L0_KEY_BYTES(const), L0Envelope(type), L0EnvelopeV2(type), L0Wrap(type) |
| [src/core/memagent/dedup.ts](src/core/memagent/dedup.ts) | 236 | 五维查重（§6.1）：语义 35% / 关键词 20% / 实体 15% / 结构 10% / LLM 仲裁 20%。 | layerText(fn), keywordSet(fn), entitySet(fn), structuralSimilarity(fn), baseDimensionScores(fn), weightedDedupScore(fn), fourDimScore(fn), fiveDimScore(fn), findDuplicate(fn), DEDUP_EVAL_SCHEMA_V(const), DEFAULT_DEDUP_POLICY(const), JUDGE_TOP_N(const), DimensionScores(type), DedupEvaluation(type), DedupOutcome(type), DedupPolicy(type), DedupOptions(type) |
| [src/core/memagent/docTokenSet.ts](src/core/memagent/docTokenSet.ts) | 52 | P1-8′（2026-11-23）：召回热路径的正文 tokenSet 进程内缓存。 | docTokenSet(fn), clearDocTokenCache(fn), docTokenCacheSize(fn) |
| [src/core/memagent/errors.ts](src/core/memagent/errors.ts) | 32 | memagent-core 错误码（§6，各端统一处理） | isL0LockedError(fn), isL0LockedText(fn), MemAgentError(class) |
| [src/core/memagent/evolution/loop.ts](src/core/memagent/evolution/loop.ts) | 454 | M3：统一进化轮 + 回诊回滚。 | runEvolutionRound(fn), adoptSuggestedRecallWeights(fn), runDedupRollbackCheck(fn), runRollbackCheck(fn), LoopOptions(type), FamilyDecision(type), LoopResult(type), RollbackCheckOptions(type), AdoptResult(type), RollbackCheckResult(type), DedupRollbackResult(type), LoopStatus(type), RollbackStatus(type) |
| [src/core/memagent/evolution/recallEval.ts](src/core/memagent/evolution/recallEval.ts) | 275 | M2（可验证的自动进化）· 召回权重离线评估引擎。 | rescoreRow(fn), rankIds(fn), ndcgAtK(fn), signTestP(fn), guardCheck(fn), decideOutcome(fn), evaluateRecallWeights(fn), isMemDetailRow(fn), samplesFromAudits(fn), MIN_NDCG_GAIN(const), MAX_GUARD_RISE(const), SIGN_TEST_P(const), DEFAULT_EVAL_K(const), EvalDecision(type), EvalSample(type), EvalInput(type), RecallEvalResult(type), EvalStatus(type) |
| [src/core/memagent/evolution/registry.ts](src/core/memagent/evolution/registry.ts) | 121 | M3：参数族注册。每族提供「提议（propose）/ 护栏（guard）/ 应用（apply 由 loop 执行）」。 | proposeRecallWeights(fn), guardRecallWeights(fn), computeRollbackPlan(fn), isRollbackDue(fn), rollbackDropExceeded(fn), EVOLUTION_FAMILIES(const), Proposal(type), GuardOutcome(type), RollbackPlan(type), Family(type) |
| [src/core/memagent/evolution/sceneProfile.ts](src/core/memagent/evolution/sceneProfile.ts) | 80 | 批次 D：场景画像（只读派生，不落库）。 | buildSceneProfile(fn), SceneProfileRow(type), SceneProfile(type) |
| [src/core/memagent/evolution/versioning.ts](src/core/memagent/evolution/versioning.ts) | 96 | M3：生长配置版本化与回滚。 | saveConfigWithHistory(fn), historyMemories(fn), latestHistory(fn), configFromHistoryMem(fn), rollbackGrowthConfig(fn), HistoryWriteOptions(type), RollbackResult(type) |
| [src/core/memagent/feedbackSignal.ts](src/core/memagent/feedbackSignal.ts) | 203 | 批次61 GAP-2：反馈信号回灌净化因果链。 | isLiveForConflict(fn), downgradeClass(fn), feedbackPolicyFromLedger(fn), countRejects(fn), tallyRejects(fn), findConflictCounterpart(fn), summarizeFeedbackSignals(fn), readFeedbackSignals(fn), CONFLICT_PAIR_MIN_SIM(const), RejectTally(type), ConflictCounterpart(type), ConflictPairing(type), FeedbackSignalSummary(type), FeedbackSignalRead(type) |
| [src/core/memagent/fieldBackfill.ts](src/core/memagent/fieldBackfill.ts) | 299 | 存量「补齐缺失的 sha256 与向量」（批次41-T）：批次41-B 之后新写的每一行都带这两个字段， | parseBackfillFields(fn), scanRowsForBackfill(fn), backfillMissingFields(fn), DEFAULT_BACKFILL_FIELDS(const), BackfillDecision(type), BackfillPreview(type), BackfillReport(type), BackfillCtx(type), BackfillSkipCode(type), BackfillField(type) |
| [src/core/memagent/fileStorage.ts](src/core/memagent/fileStorage.ts) | 578 | FileStorage（§5.3）：桌面/CLI 本地库 = P0 主源（零依赖，纯文件系统，无 node:sqlite）。 | StorageCorruptError(class), StorageLockedError(class), FileStorage(class), CorruptionNotice(type), FileStorageOptions(type) |
| [src/core/memagent/forgetting.ts](src/core/memagent/forgetting.ts) | 599 | REQ-010 遗忘机制后台任务（17.4–17.11）：新鲜度/打分/层迁移/合并摘要/周期任务 | policyFor(fn), freshnessOf(fn), scoreParts(fn), scoreFromParts(fn), scoreMemory(fn), buildMemsDetail(fn), tokenCoverage(fn), tokenCoverageWeighted(fn), fuseRelevance(fn), fusedRelevanceOf(fn), hardFilter(fn), classifyLayer(fn), forgetOne(fn), restoreOne(fn), reinforceOne(fn), buildSummary(fn), clusterSimilar(fn), archiveAgedMemories(fn), runForgettingCycle(fn), SCORE_WEIGHTS(const), RELEVANCE_FUSION_LAMBDA(const), MERGE_SIM_THRESHOLD(const), ForgettingPolicy(type), ScoreParts(type), ForgettingCycleReport(type), ForgettingOptions(type), ArchivePassOptions(type), MemDetailRow(type), SummaryBuildResult(type) |
| [src/core/memagent/hitHighlight.ts](src/core/memagent/hitHighlight.ts) | 127 | 批次59：召回回显的「命中片段」计算（方案 C —— 后端定相关性、渲染层定偏移）。 | matchedTerms(fn), pickHitSpans(fn), displayTerms(fn), HitSpan(type) |
| [src/core/memagent/l0Recovery.ts](src/core/memagent/l0Recovery.ts) | 123 | L0 恢复码（批次37-G）：管理密码忘了还能把 L0 原数据库捞回来的唯一通道。 | generateRecoveryCode(fn), formatRecoveryCode(fn), normalizeRecoveryCode(fn), wrapDekWithRecovery(fn), unwrapDekWithRecovery(fn), createKeyringSecrets(fn), keyringFingerprint(fn), buildRecoveryCard(fn), RECOVERY_CODE_BYTES(const), RECOVERY_BAD_CODE(const), RecoveryCardInput(type) |
| [src/core/memagent/l0Split.ts](src/core/memagent/l0Split.ts) | 263 | 存量拆分迁移（批次37-C）：把「还躺在记忆库行上」的 L0 原文搬进独立的 L0 原数据库。 | scanLedgerForSplit(fn), splitLedger(fn), SplitDecision(type), SplitPreview(type), SplitReport(type), SplitCtx(type) |
| [src/core/memagent/l0Store.ts](src/core/memagent/l0Store.ts) | 421 | L0 原数据库（批次37）：把每条记忆的 L0 密文从「记忆库」里搬出来，单独落一个文件。 | normalizeL0Blob(fn), isSealedL0(fn), L0NotSealedError(class), L0StoreLockedError(class), L0StoreCorruptError(class), FileL0BlobStore(class), InMemoryL0BlobStore(class), L0BlobMeta(type), L0Blob(type), L0BlobStore(type), FileL0BlobStoreOptions(type) |
| [src/core/memagent/l0vault.ts](src/core/memagent/l0vault.ts) | 1045 | L0Vault（§4.4）：主进程独占的 L0 密钥环 —— DEK 只在内存，密码经 PBKDF2 派生 KEK 包裹 DEK。 | L0_IDLE_TIMEOUT_MS(const), L0_MAX_FAILURES(const), L0_LOCK_MS(const), L0_MIN_SECRET_LEN(const), L0Vault(class), L0RecoveryIssue(type), L0GrantRecord(type), L0RecoveryRecord(type), L0RequestRecord(type), L0Keyring(type), L0KeyringStore(type), L0LockState(type), L0LockStore(type), L0AuditSink(type), L0VaultOptions(type), L0SessionInfo(type) |
| [src/core/memagent/layerRules.ts](src/core/memagent/layerRules.ts) | 322 | 层级规则单一真源（§2.1/§2.2/§6.1/§6.2/§16.1/§4.4）：每层规格、查重阈值/权重、L0 授权常量、L1 脱敏与规格校验。 | layerSpecOf(fn), depthCapFor(fn), meaningfulLength(fn), sanitizeL1(fn), layerBand(fn), checkLayerSpecDetailed(fn), checkLayerSpec(fn), targetLayers(fn), isFullyRefined(fn), headlineLayer(fn), LAYER_ORDER(const), LAYER_SPECS(const), DEDUP_THRESHOLDS(const), DEDUP_WEIGHTS(const), DEDUP_WEIGHTS_NO_LLM(const), L0_POLICY(const), MIN_MEANINGFUL_CHARS(const), MIN_MEANINGFUL_WITHOUT_FACTS(const), DEPTH_CAP_BANDS(const), LayerSpec(type), LayerBand(type), LayerViolation(type), RefineLayer(type), LayerViolationCode(type) |
| [src/core/memagent/ledgerReset.ts](src/core/memagent/ledgerReset.ts) | 125 | 记忆库清空重采（批次35）：按新入库口径「彻底重来」的纯函数层。 | scanLedgerForReset(fn), purgeLedger(fn), LedgerResetPreview(type), LedgerPurgeReport(type), LedgerPurgeCtx(type) |
| [src/core/memagent/legacyLayers.ts](src/core/memagent/legacyLayers.ts) | 164 | 遗留账本清理（批次24）：把「未接真实 LLM 却带 L2–L6」的历史行诚实降级回 L1。 | isStubDeepLayered(fn), isMislabeledLayer(fn), scanStubLayers(fn), demoteStubLayers(fn), LegacyScan(type), LegacyDemoteReport(type), LegacyDemoteCtx(type) |
| [src/core/memagent/llm.ts](src/core/memagent/llm.ts) | 84 | LlmProvider（§5.1）+ 内核统一反代理路由（19.8：先免费 → 后低价 ≤ price_cap → cost_cap → 回退本地） | routeProxy(fn), FakeLlmProvider(class), ProxyPick(type) |
| [src/core/memagent/mcp.ts](src/core/memagent/mcp.ts) | 437 | MCP Server（§19.5）：JSON-RPC 2.0 over TCP，暴露记忆工具，供 Agent 调用记忆助手。 | runMcpServer(fn), McpOptions(type), McpServerHandle(type) |
| [src/core/memagent/mcpAuth.ts](src/core/memagent/mcpAuth.ts) | 113 | MCP 鉴权：MCP 端口只对持有本机令牌的 Agent 开放。 | isAdmin(fn), scopeHasWildcard(fn), classifyProject(fn), projectInScope(fn), tokenEquals(fn), tokenFromHeaders(fn), assertMcpToken(fn), MCP_TOKEN_HEADER(const), DEFAULT_MCP_ACCOUNT(const), McpAccount(type), ScopeAccount(type), ProjectPool(type) |
| [src/core/memagent/mcpGcTools.ts](src/core/memagent/mcpGcTools.ts) | 176 | MCP 遗忘引擎报告编排（批次44-D5-3 → 批次46-4）：gc_report。 | runGcReportTool(fn), GC_REPORT_NOTE(const), GcReportToolResult(type), GcReportDeps(type) |
| [src/core/memagent/mcpGrowthTools.ts](src/core/memagent/mcpGrowthTools.ts) | 191 | MCP 自进化工具编排（批次 B/C/D）：growth_evolve = status \| adopt \| profile \| policy。 | countRejectDowngrades(fn), growthCardSummary(fn), runGrowthEvolveTool(fn), GrowthEvolveResult(type) |
| [src/core/memagent/mcpHookTools.ts](src/core/memagent/mcpHookTools.ts) | 179 | MCP 钩子健康度自检（第 13 个工具 `recall_hook_status`）。 | hookReasonZh(fn), runHookStatusTool(fn), HOOK_STATUS_STALE_MS(const), HOOK_STATUS_FILENAME(const), HookStatusReport(type), HookStatusDeps(type), HookVerdict(type) |
| [src/core/memagent/mcpHttp.ts](src/core/memagent/mcpHttp.ts) | 833 | 标准 MCP（Model Context Protocol）streamable-http 服务器 | normalizeClientLabel(fn), clientFromInitialize(fn), clientFromUserAgent(fn), isIdentifiableUserAgent(fn), isTrustedClientSelfName(fn), clientFromExplicitHeader(fn), clientDeclaresFold(fn), clientDeclaresStrictGate(fn), recallEchoNote(fn), runMcpHttpServer(fn), MCP_CLIENT_HEADER(const), MCP_RENDER_HEADER(const), MCP_STRICT_GATE_HEADER(const), McpHttpOptions(type), McpHttpHandle(type) |
| [src/core/memagent/mcpManageTools.ts](src/core/memagent/mcpManageTools.ts) | 324 | MCP 治理工具编排（批次44-D5-2）：feedback / manage_memory。 | deleteAllowed(fn), runFeedbackTool(fn), runManageMemoryTool(fn), ManageToolOpts(type), FeedbackToolResult(type), ManageToolResult(type) |
| [src/core/memagent/mcpProjectTools.ts](src/core/memagent/mcpProjectTools.ts) | 166 | MCP 管理工具编排（D6-5 / 子方案 §3.3）：create_project / mint_token。 | runCreateProjectTool(fn), runMintTokenTool(fn), CreateProjectToolResult(type), MintTokenToolResult(type) |
| [src/core/memagent/mcpReadTools.ts](src/core/memagent/mcpReadTools.ts) | 160 | MCP 读工具编排（批次44-D5-1）：list_memories / get_memory。 | toMemoryView(fn), runListMemoriesTool(fn), runGetMemoryTool(fn), MemoryView(type), ListMemoriesResult(type), GetMemoryResult(type) |
| [src/core/memagent/mcpRecall.ts](src/core/memagent/mcpRecall.ts) | 365 | MCP 召回工具编排（批次11/13/29/32/33）：项目自动定位 / 列表 / 提示行与明细组装 / 按客户端能力选档位。 | clientIsRichCardHost(fn), extraHtmlDetailsClients(fn), clientSupportsHtmlDetails(fn), projectInfosFromMemories(fn), resolveProjectId(fn), runRecallTool(fn), recallDisplayMode(fn), runListProjectsTool(fn), ensureSharedProject(fn), McpToolError(class), ProjectInfo(type), ResolvedProject(type), RecallToolPayload(type), RecallDetailTicketsPort(type), RecallToolDetailOpts(type), RecallToolOutput(type), RecallDisplayMode(type) |
| [src/core/memagent/mcpSchema.ts](src/core/memagent/mcpSchema.ts) | 296 | MCP 工具清单与初始化指令（批次11/12/13）：HTTP(8204) 与 TCP(8202) 共用同一份 schema/instructions， | mcpInstructions(fn), withRecallFirstNotes(fn), RECALL_FIRST_SELF_NOTE(const), RECALL_FIRST_TOOL_NOTE(const), RECALL_FIRST_REMINDER(const), RECALL_FIRST_GATE_MSG(const), RECALL_FIRST_STRICT_GATE_MSG(const), RECALL_ROUND_GATE_MSG(const), RECALL_GATE_STRICT_INSTRUCTIONS(const), RECALL_GATE_STRICT_TOOL_NOTE(const), RECALL_SOURCE_BOUNDARY(const), RECALL_FEEDBACK_FAST_NOTE(const), MCP_INSTRUCTIONS(const), MCP_TOOLS(const) |
| [src/core/memagent/memberStore.ts](src/core/memagent/memberStore.ts) | 370 | 成员 / API 密钥内核域模型（批次45-B1，ROADMAP §二 45-B1）： | resolveApiKeyAccount(fn), InMemoryMemberStore(class), FileMemberStore(class), MemberRecord(type), CreateMemberInput(type), ApiKeyRecord(type), MintApiKeyInput(type), MintedApiKey(type), MemberStorePort(type), MemberRole(type), MemberStatus(type) |
| [src/core/memagent/memories.ts](src/core/memagent/memories.ts) | 1032 | 内核记忆业务（§3 schema + 行为红线）：write 逐层生成/查重/分支嫁接 / browse L0 授权 / gc 衰减 / memoryOp 17.3 操作 | buildSourceExcerpt(fn), layerSpecsFrom(fn), buildL6Input(fn), makeLayerGenerator(fn), parseWriteKnobs(fn), coreWrite(fn), coreBrowse(fn), coreGc(fn), coreGcFull(fn), coreMemoryOp(fn), coreFeedback(fn), SOURCE_EXCERPT_MAX_CHARS(const), GC_FULL_NOTE(const), WriteInput(type), WriteCtx(type) |
| [src/core/memagent/paramsSnapshot.ts](src/core/memagent/paramsSnapshot.ts) | 240 | 全局参数快照（params:v1: preference 记忆）的共享读取口。 | isInternalPrefRow(fn), isInternalPrefContent(fn), parseParamsSnapshot(fn), findParamsSnapshot(fn), autoOrganizeEnabled(fn), forgettingPrefsFromSnapshot(fn), proxyAccountingFromSnapshot(fn), proxyCapsFromSnapshot(fn), saveProxyCapsToLedger(fn), findGrowthMemory(fn), growthConfigFromLedger(fn), saveGrowthConfigToLedger(fn), PARAMS_PREF_PREFIX(const), GROWTH_PREF_PREFIX(const), GROWTH_HISTORY_PREFIX(const), ParamsSnapshot(type), ForgettingPrefs(type), ProxyCapsSaveOptions(type), GrowthConfigSaveOptions(type) |
| [src/core/memagent/pendingStoreFile.ts](src/core/memagent/pendingStoreFile.ts) | 57 | 文件落盘实现（node-only）：pending 队列持久化到 <dir>/pending-<id>.json。 | FilePendingStore(class) |
| [src/core/memagent/pendingWrites.ts](src/core/memagent/pendingWrites.ts) | 112 | 落盘兜底队列（A3 §4.4.4 / 批次44-D4） | MemoryPendingStore(class), PendingWrites(class), PendingWrite(type), PendingStore(type), WriteKnobs(type) |
| [src/core/memagent/personal.ts](src/core/memagent/personal.ts) | 746 | 个人记忆内核 API（第一轮本机闭环 + 第二轮跨端同步）：quick_add / confirm / reject / revoke / delete | personalList(fn), personalQuickAdd(fn), personalImportFromAgent(fn), personalRejectFromAgent(fn), personalConfirm(fn), personalReject(fn), personalRevoke(fn), personalDelete(fn), personalEdit(fn), personalPushToTeam(fn), personalRetrySync(fn), createPersonalApi(fn), personalRecallScore(fn), selectPersonalRecall(fn), PERSONAL_MAX_CHARS(const), PERSONAL_CONFIDENCE_DELTA(const), PersonalImportInput(type), PersonalSyncPort(type), PersonalReceipt(type), PersonalSyncOutcome(type), PersonalSyncReceipt(type), PersonalSnapshot(type), PersonalApi(type), PersonalApiContext(type), PersonalOp(type), PersonalSyncOp(type) |
| [src/core/memagent/personalStore.ts](src/core/memagent/personalStore.ts) | 209 | 个人记忆独立存储（第一轮本机闭环 + 第二轮跨端同步）。 | personalContentHash(fn), normalizePersonalEntry(fn), resolvePersonalOwner(fn), parsePersonalOwnerBindings(fn), InMemoryPersonalStore(class), PersonalSyncError(type), PersonalEntry(type), PersonalMemoryStore(type), PersonalOwnerBinding(type), PersonalOwnerResolution(type), PersonalState(type), PersonalSource(type), PersonalSyncState(type), PersonalSyncStage(type) |
| [src/core/memagent/personalStoreFile.ts](src/core/memagent/personalStoreFile.ts) | 90 | 个人记忆独立文件存储（桌面主进程）：<dataRoot>/personal-memory.db.json。 | FilePersonalStore(class) |
| [src/core/memagent/pgSyncHub.ts](src/core/memagent/pgSyncHub.ts) | 363 | PgSyncHub（REQ-008 §2 服务端中枢 Postgres 落地）：与内存版 SyncHub 接口同构、语义一致。 | PgSyncHub(class), HubDb(type), CanonicalTenant(type), PgSyncHubOptions(type) |
| [src/core/memagent/pointerRoot.ts](src/core/memagent/pointerRoot.ts) | 56 | 引导指针 → 真实数据根（召回链共享纯模块，不依赖 electron）。 | pointerFilePath(fn), legacyDataRoot(fn), readPointerRoot(fn), resolveRecallDataRoot(fn), POINTER_DIR_NAME(const), POINTER_FILE_NAME(const) |
| [src/core/memagent/qualityGate.ts](src/core/memagent/qualityGate.ts) | 740 | L0→L1 质量过滤器（§2.1 清洗红线）：拦截无用/低质信息，禁止其进入 L1 污染记忆库。 | checkL0ToL1Quality(fn), filteredAuditDetail(fn), QUALITY_GATE_VERSION(const), QualityCheckResult(type), QualityBlockCode(type) |
| [src/core/memagent/rebuild.ts](src/core/memagent/rebuild.ts) | 423 | 按 L0 重建 L1–L6（批次37-E）：用户口径「删的只是 L1–L6 那一份库，不用重新采集，直接从 L0 重新生成」。 | makeL0Reader(fn), scanRowsForRebuild(fn), rebuildLayersFromL0(fn), L0ReaderOptions(type), RebuildDecision(type), RebuildPreview(type), RebuildScanOptions(type), RebuildReport(type), RebuildCtx(type), RebuildUnavailableCode(type), RebuildSource(type), L0Reader(type) |
| [src/core/memagent/recallDetailTickets.ts](src/core/memagent/recallDetailTickets.ts) | 65 | 批次33-C：召回明细页的一次性访问票据（id → 已渲染的明细 HTML）。 | RECALL_DETAIL_TTL_MS(const), RECALL_DETAIL_MAX_TICKETS(const), RecallDetailTickets(class), RecallDetailTicket(type) |
| [src/core/memagent/recallHook.ts](src/core/memagent/recallHook.ts) | 319 | 硬前置召回 A 方案 · 钩子主体逻辑（单一真源）。 | hookStatusFilePath(fn), hookLogFilePath(fn), readLatestHookRoundAt(fn), readHookRunLog(fn), hookIsLoopback(fn), runHook(fn), hookSelfTest(fn), DEFAULT_MCP_URL(const), HOOK_TIMEOUT_MS(const), HOOK_SELFTEST_PREFIX(const), HOOK_STATUS_FILE(const), HOOK_LOG_FILE(const), HOOK_LOG_MAX_BYTES(const), HOOK_LOG_KEEP_LINES(const) |
| [src/core/memagent/recallHookCli.ts](src/core/memagent/recallHookCli.ts) | 21 | 硬前置召回 A 方案 · CLI 壳（打包态入口）。 | — |
| [src/core/memagent/recallInsight.ts](src/core/memagent/recallInsight.ts) | 1068 | 召回洞察（批次11/13）：项目背景筛选 / 省量核算 / 聊天窗口提示行与累计金额的唯一纯函数真源。 | selectRecallBackground(fn), corpusTokens(fn), computeRecallSavings(fn), localDayStart(fn), rollupRecalls(fn), formatCny(fn), normalizeUnitPrice(fn), buildRecallHint(fn), recallSavingRatio(fn), recallHitTerms(fn), recallWarnings(fn), buildRecallModeLine(fn), buildRecallEchoSummary(fn), buildRecallStatLines(fn), buildRecallCitationLines(fn), markHitFragments(fn), buildRecallSections(fn), buildRecallMarkdown(fn), buildRecallCompactMarkdown(fn), secondaryDisplayLine(fn), buildRecallCardData(fn), htmlEscape(fn), buildRecallDetailPage(fn), buildRecallDetailExpiredPage(fn), CHARS_PER_BUDGET_UNIT(const), estTokens(const), BACKGROUND_MAX_ITEMS(const), BACKGROUND_ITEM_CHARS(const), BACKGROUND_MAX_TOKENS(const), RECALL_CARD_HINT(const), RECALL_FEEDBACK_HINT(const), RecallRollup(type), RecallMoneyBlock(type), RecallMoney(type), RecallEchoSummary(type), RecallHint(type), RecallMarkdownOpts(type), RecallHitStyle(type), RecallSection(type), RecallCardHit(type), RecallCardData(type), RecallDetailPageMeta(type), HitMarkup(type) |
| [src/core/memagent/recallModes.ts](src/core/memagent/recallModes.ts) | 318 | recallModes.ts — 召回模式调度层（§2.4.3 模式定义 + §2.4.4 自动分流，直译单一真源） | normalizeScene(fn), isManualMode(fn), isConcreteMode(fn), resolveMode(fn), modeWeights(fn), modeSpec(fn), RECALL_MODE_SPECS(const), COMMON_INVARIANTS(const), DEFAULT_DISPATCH_CONFIG(const), MODE_FEATURE_WORDS(const), ModeWeights(type), RecallModeSpec(type), ModeDispatchConfig(type), ResolveModeInput(type), ResolvedMode(type), LayerKey(type), ConcreteMode(type) |
| [src/core/memagent/recallPrelude.ts](src/core/memagent/recallPrelude.ts) | 266 | 硬前置召回的「拼装规则」单一真源（A 宿主钩子 / B LLM Gateway / C 内核门禁 共用）。 | parseMcpRpcBody(fn), extractRecallHits(fn), buildRecallPrelude(fn), lastUserQuery(fn), stripRecallPrelude(fn), injectSystemPrelude(fn), buildHookOutput(fn), buildHookRunState(fn), parseHookRunState(fn), serializeHookRunState(fn), RECALL_PRELUDE_MARKER(const), RECALL_PRELUDE_OPEN(const), RECALL_PRELUDE_CLOSE(const), PLUGIN_INJECTION_MARKER(const), MAX_HIT_CHARS(const), MAX_PRELUDE_CHARS(const), MAX_EXCERPT_CHARS(const), MAX_QUERY_CHARS(const), RECALL_EMPTY_HINT(const), RecallHit(type), ChatMessage(type), HookRunState(type), HookRunStatus(type), HookFailReason(type) |
| [src/core/memagent/recallSupersede.ts](src/core/memagent/recallSupersede.ts) | 174 | REQ-014 / T1（C6-A）：合并影子的「以最新为准」补带。 | probeSupersededTargets(fn), buildSupersedeHit(fn), mergeSupersededHits(fn), supersedeNote(fn), SUPERSEDE_PROBE_MIN_SIM(const), SUPERSEDE_MAX_EXTRA_HITS(const), SupersedeProbe(type), SupersedeProbeArgs(type), SupersedeHitArgs(type) |
| [src/core/memagent/refineQueue.ts](src/core/memagent/refineQueue.ts) | 563 | 批次39：L2–L6 后台补炼队列（纯函数 + 落盘状态 + 单行补炼）。 | dayKey(fn), emptyRefineQueue(fn), clampRefineQueue(fn), loadRefineQueue(fn), saveRefineQueue(fn), hasAnyDeepLayer(fn), isRefinable(fn), enqueueRows(fn), effectiveCap(fn), dailyBudgetLeft(fn), setRefineCap(fn), nextPending(fn), retryFailed(fn), removeRefineRows(fn), reconcileRefineQueue(fn), reconcileAndPersistRefineQueue(fn), removeRefineQueueRowAndPersist(fn), summarizeRefineQueue(fn), settleRowOutcome(fn), refineRowLayers(fn), REFINE_QUEUE_FILE(const), REFINE_MAX_ENGINES_PER_CALL(const), REFINE_MAX_ROWS_PER_DAY(const), LAYER_STOP_CODES(const), markRefined(const), markRefineFailed(const), markRefineSkipped(const), RefineQueueItem(type), RefineQueueState(type), EnqueueReport(type), RefineQueueSummary(type), RefineRowCtx(type), RefineRowResult(type), RefineItemState(type), RefineStopCode(type) |
| [src/core/memagent/regression.ts](src/core/memagent/regression.ts) | 554 | 批次48 A23.3：写入期判重决策的离线回归（用户已定 6 条定义，原方案落地）。 | suggestRecallWeights(fn), collectDedupSamples(fn), countSamples(fn), classify(fn), splitSamples(fn), evaluateRegression(fn), runGrowthRegression(fn), regressionRequestId(fn), computeDedupRollbackPlan(fn), dedupDropExceeded(fn), REGRESSION_WINDOW_DAYS(const), MIN_SAMPLES(const), MIN_NEGATIVES(const), MIN_F1_GAIN(const), MAX_PRECISION_DROP(const), THRESHOLD_MIN(const), THRESHOLD_MAX(const), RECALL_SUGGEST_WINDOW_DAYS(const), RECALL_SUGGEST_MIN_RECALLS(const), RecallSuggestionMetrics(type), RecallSuggestion(type), DedupSample(type), SampleCounts(type), ClassificationMetrics(type), MetricsBundle(type), RegressionOptions(type), RegressionRunOptions(type), DedupRollbackPlan(type), RegressionRunResult(type) |
| [src/core/memagent/rejudge.ts](src/core/memagent/rejudge.ts) | 222 | 存量「按当前规则重判」（批次36-C）：规则收紧后，已落库的行不会自己变干净——本模块把 | scanRowsForRejudge(fn), rejudgeRows(fn), RejudgeDecision(type), RejudgePreview(type), RejudgeReport(type), RejudgeCtx(type) |
| [src/core/memagent/sessionCollector.ts](src/core/memagent/sessionCollector.ts) | 1228 | 自有 Agent 会话自动采集器（§5.1 双链路补偿 · P0 自有形态，可调周期对账，预设 5min） | stripPluginInjection(fn), isPluginInjected(fn), parseClaudeJsonl(fn), parseWorkbuddyMd(fn), parseWorkbuddyJsonl(fn), parseDshProjcache(fn), parseWebchatMd(fn), scanSessionLogs(fn), createReconciler(fn), defaultAgentSources(fn), webchatSiteOf(fn), agentFor(fn), webchatExportSource(fn), applyScanToStore(fn), ParsedMessage(type), SessionLogSource(type), FileCursor(type), CollectorCursor(type), CollectedItem(type), ScanResult(type), ScanOptions(type), ReconcileOptions(type), Reconciler(type), DefaultSourcesOpts(type), CollectorBridgeOpts(type), ApplyScanResult(type), LineParser(type), BlockParser(type) |
| [src/core/memagent/sqliteStorage.ts](src/core/memagent/sqliteStorage.ts) | 192 | SqliteStorage（§5.3）：桌面/CLI 本地库 = P0 主源（需求规格书 §2 端壳注入、§5.3 存储端点表）。 | SqliteStorage(class) |
| [src/core/memagent/storage.ts](src/core/memagent/storage.ts) | 126 | StorageBackend 接口实现（§5.3）：InMemoryStorage 用于测试/演示； | InMemoryStorage(class) |
| [src/core/memagent/sync.ts](src/core/memagent/sync.ts) | 389 | REQ-008 云同步（同步机制详细设计 §1–§8）：sha256 幂等 + 向量时钟 LWW + SyncHub 中枢 + 三端引擎 | sha256hex(fn), vcCompare(fn), vcTick(fn), stampForSync(fn), syncUp(fn), syncDown(fn), reconcile(fn), filterSyncAudits(fn), SyncHub(class), SyncConflict(type), SyncAudit(type), SyncUpReport(type), SyncHubLike(type), VClock(type), PushOutcome(type), AnySyncHub(type) |
| [src/core/memagent/tenantNormalize.ts](src/core/memagent/tenantNormalize.ts) | 182 | 批次45-A2 存量账本租户归一：把历史行的 team_id/enterprise_id 重盖成 tenant.json 规范值（user_id 保留原值）。 | scanRowsForTenantNormalize(fn), normalizeTenantFields(fn), TenantNormalizeTarget(type), TenantNormalizeDecision(type), TenantNormalizePreview(type), TenantNormalizeReport(type), TenantNormalizeCtx(type) |
| [src/core/memagent/tokenStore.ts](src/core/memagent/tokenStore.ts) | 230 | 令牌代理（D6-4，方案 A1 / 子方案 §3.2）：文件化令牌库 mcp-tokens.json（0600） | resolveAccountFor(fn), InMemoryTokenStore(class), FileTokenStore(class), TokenRecord(type), MintTokenInput(type), MintedToken(type), TokenStorePort(type) |
| [src/core/memagent/types.ts](src/core/memagent/types.ts) | 1076 | memagent-core 契约类型（REQ-007 §1/§2/§3/§5/§6 直译，19.10/19.11） | isCategory(fn), CATEGORIES(const), Account(type), RefinedLayers(type), RecallReq(type), Hit(type), Budget(type), RecallBackgroundItem(type), RecallBackground(type), RecallSavings(type), RecallSecondaryHint(type), RecallDispatchInfo(type), RecallResult(type), MemReq(type), WriteResult(type), LayerDecision(type), GcReq(type), GcReport(type), GcFullReq(type), GcFullReport(type), ConflictPair(type), ConflictResolveReq(type), ConflictResolveResult(type), Pref(type), DiscoverReq(type), DiscoveredAgent(type), DiscoverResult(type), SyncReq(type), SyncReport(type), BrowseReq(type), BrowseRow(type), BrowseResult(type), L0Port(type), L0AccessRequest(type), L0AccessRequestResult(type), L0GrantReq(type), L0GrantView(type), L0GrantResult(type), L0RequestView(type), L0UnlockReq(type), L0UnlockResult(type), L0HeartbeatResult(type), L0VaultStatus(type), L0MigrationReport(type), L0MigrationResult(type), L0AdminPort(type), LogReq(type), LogItem(type), LogPage(type), AuditRef(type), AuditRecord(type), Memory(type), MemOpPatch(type), MemOpResult(type), FeedbackResult(type), ModelInfo(type), LlmCallCtx(type), LlmResp(type), LlmProvider(type), Filter(type), Scored(type), VectorBackend(type), ProjectRecord(type), CreateProjectInput(type), ListProjectsFilter(type), StorageBackend(type), MemAgentOptions(type), MemAgent(type), MemAgentSeedHooks(type), Form(type), Layer(type), DecayClass(type), Category(type), RecallMode(type), Scene(type), ErrorCode(type), ConflictVerdict(type), DiscoverSignal(type), L0GrantStatus(type), AuditAction(type), MemOp(type), FeedbackKind(type), ProjectKind(type) |
| [src/core/memagent/ulid.ts](src/core/memagent/ulid.ts) | 47 | 简易 ULID：48bit 时间戳 + 80bit 随机（crypto 级），同毫秒内单调递增（契约 §3.1） | ulid(fn) |
| [src/core/memagent/vector.ts](src/core/memagent/vector.ts) | 108 | VectorBackend（§5.2）当前唯一生产实现：JsVectorBackend（hash bag-of-words + cosine）。 | tokenize(fn), isIdentifierToken(fn), embedSync(fn), cosine(fn), DEFAULT_VECTOR_DIM(const), JsVectorBackend(class) |
| [src/core/memagent/webchatAudit.ts](src/core/memagent/webchatAudit.ts) | 320 | — | normalizeText(fn), parseExportMarkdown(fn), auditExport(fn), summarizeAudit(fn), auditCoverage(fn), AuditMessage(type), AuditOneResult(type), AuditSummary(type), CoverageAudit(type), ExportedSession(type) |
| [src/core/memagent/webchatAuditStore.ts](src/core/memagent/webchatAuditStore.ts) | 163 | 网页对话导出的完整性审计：把「原对话」与「导出文档」放在一起比，回答 | resolveAuditDir(fn), writeAuditSnapshot(fn), readAuditSnapshots(fn), runAudit(fn), formatAuditReport(fn), WebchatAuditSnapshot(type), WebchatAuditFile(type) |
| [src/core/memagent/webchatPurge.ts](src/core/memagent/webchatPurge.ts) | 170 | 按来源清理「网页导出的旧条目」（2026-11-17 用户明确）。 | isWebchatExportAgent(fn), webchatSiteFromAgent(fn), selectWebchatExportMemories(fn), purgeWebchatExports(fn), WEBCHAT_AGENT_PREFIX(const), WebchatPurgePreview(type), WebchatPurgeReport(type), WebchatPurgeCtx(type) |
| [src/core/memagent/webhook.ts](src/core/memagent/webhook.ts) | 202 | Webhook 接收端（§19.3 主通道 / §5.4 SHA-256 幂等保真） | createWebhook(fn), HashIndex(class), IngestEvent(type), IngestResult(type), WebhookOptions(type), WebhookServer(type) |

## src/desktop

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/desktop/hostBridge.ts](src/desktop/hostBridge.ts) | 493 | 宿主桥（iframe 场景）：把 preload 能力透传给概览页 iframe 内的子页面。 | hostLog(fn), handleBridgeMessage(fn), isEmbedded(fn), installHostBridge(fn), hostCall(fn), hostCapability(fn), HOST_ACCEPTED_ERROR_PREFIX(const), HostLogOptions(type), HostMethod(type) |
| [src/desktop/hostScan.ts](src/desktop/hostScan.ts) | 185 | 宿主真扫（discover 真实化）· 纯类型 + 纯匹配层（零 node 依赖，可安全打进浏览器包）。 | matchAgentsFromProcesses(fn), matchAgentsFromMcp(fn), matchAgentsFromConfigFiles(fn), mergeHostAgents(fn), AGENT_FINGERPRINTS(const), AgentFingerprint(type), HostAgentFound(type), HostScanResult(type), HostScanApi(type) |
| [src/desktop/ipcStorage.ts](src/desktop/ipcStorage.ts) | 104 | 桌面端存储桥接（Electron 渲染进程侧）：把内核 StorageBackend 接口经 preload 暴露的 | IpcStorageBackend(class), StorageIpc(type) |

## src/electron

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/electron/actionLog.ts](src/electron/actionLog.ts) | 190 | 主进程动作日志（批次7）：把 shared/actionLog 的条目追加到 <数据根>/actions.log。 | initActionLog(fn), actionLogPath(fn), actionLog(fn), actionLogError(fn), tailActionLog(fn), resetActionLog(fn), ActionLogInitOptions(type) |
| [src/electron/agentDetect.ts](src/electron/agentDetect.ts) | 322 | 本机 Agent 检测 · 后续扩展（2026-10-24）· 主进程 node 层（仅 Electron 使用） | detectLocalAgents(fn), detectCliAgents(fn), hostAgentConfig(fn), LocalAgentFound(type), AgentConfigSuggestion(type) |
| [src/electron/agentProbe.ts](src/electron/agentProbe.ts) | 226 | 主进程 Agent 健康定时拨测 + 真实熔断状态机 + 慢计算缓存（原子任务 B）。 | nextCircuitState(fn), classifyWriteRows(fn), getMonitorStats(fn), initAgentProbe(fn), MonitorStats(type), CircuitState(type) |
| [src/electron/appShell.ts](src/electron/appShell.ts) | 133 | 壳层常驻设置（阶段 A）：托盘常驻 + 开机自启的**纯逻辑**与持久化。 | appShellPath(fn), normalizeShellSettings(fn), readShellSettings(fn), writeShellSettings(fn), resolveCloseAction(fn), isHiddenLaunch(fn), loginItemArgs(fn), parseShellPatch(fn), applyShellConstraints(fn), APP_SHELL_FILE(const), HIDDEN_LAUNCH_ARG(const), DEFAULT_SHELL_SETTINGS(const), ShellSettings(type), CloseAction(type), ShellPatch(type) |
| [src/electron/backupFiles.ts](src/electron/backupFiles.ts) | 153 | 批次37-D：双库备份的文件配方（纯函数，主进程与单测共用同一真源）。 | groupOfKind(fn), backupTargetDir(fn), backupTargetDirs(fn), planBackupFiles(fn), kindOfBackupName(fn), tsOfBackupName(fn), isRecipeBackupName(fn), selectBackupsToDelete(fn), sortBackupsNewestFirst(fn), BACKUP_PREFIX(const), BACKUP_EXT(const), BACKUP_KINDS(const), BACKUP_GROUP(const), BackupSourceFile(type), BackupDirConfig(type), BackupKind(type), BackupGroup(type) |
| [src/electron/browserLaunch.ts](src/electron/browserLaunch.ts) | 193 | 浏览器扩展页启动解析（纯函数，便于单测）。 | browserInternalUrl(fn), extensionPageActivation(fn), buildExtensionPageActivationScript(fn), browserExecutableCandidates(fn), resolveBrowserExecutable(fn), BrowserLaunchOptions(type), ExtensionPageActivation(type), ActivationScriptOptions(type), SupportedBrowser(type) |
| [src/electron/chatExportsLocations.ts](src/electron/chatExportsLocations.ts) | 145 | 网页对话导出目录的「探测」：算出浏览器插件**实际会写到哪里**（纯函数，便于单测）。 | browserUserDataDirs(fn), browserPreferenceFiles(fn), downloadDirFromPreferences(fn), samePath(fn), detectDownloadDirs(fn), detectChatExportsDirs(fn), siteExportStats(fn), ChatExportsLocationOptions(type), SiteExportStat(type), SiteExportStatsOptions(type) |
| [src/electron/clientProcess.ts](src/electron/clientProcess.ts) | 75 | 客户端软件运行态探测（T6）：按真实进程可执行文件名判断客户端是否在运行。 | matchRunningClients(fn), listProcessNames(fn), probeRunningClients(fn), resetProcessCache(fn), CLIENT_PROCESS_NAMES(const) |
| [src/electron/dataRoot.ts](src/electron/dataRoot.ts) | 564 | 数据根目录（批次6）：记忆库、采集游标、日志、MCP 令牌、备份配置等全部持久数据 | defaultDataRoot(fn), dataRootPointerPath(fn), readDataRootPointer(fn), writeDataRootPointer(fn), clearDataRootMigrateFrom(fn), isLegacyLibraryDir(fn), migrateLegacyLibraryDir(fn), resolveLibraryPaths(fn), isSetupComplete(fn), wizardRequired(fn), hasLibraryDirs(fn), libraryFileState(fn), validateDataRootPath(fn), samePath(fn), ensureDirWritable(fn), hasAnyData(fn), summarizeDataDir(fn), detectDataRoots(fn), migrateDataRoot(fn), adoptLibraryDirIntoPlace(fn), DATA_ROOT_DIR_NAME(const), DATA_ROOT_POINTER_NAME(const), DATA_ROOT_POINTER_VERSION(const), DEFAULT_DATA_ROOT_DRIVE(const), DATA_ROOT_MIGRATE_FILES(const), DATA_ROOT_MIGRATE_DIRS(const), LEDGER_FILE_NAME(const), L0_FILE_NAME(const), L0_KEYRING_FILE_NAME(const), DataRootPointer(type), DataRootSummary(type), DataRootMigration(type), LibraryPaths(type), LegacyLibraryMigrateReport(type), DataRootPointerRead(type) |
| [src/electron/dataUseGate.ts](src/electron/dataUseGate.ts) | 39 | T1 数据使用门禁（管理员与成员权限设计 §2）：会话有效即放行，管理员额外打审计标。 | checkDataUse(fn), DataUseGateDeps(type), DataUseGateResult(type) |
| [src/electron/host-hooks/auto_feedback.mjs](src/electron/host-hooks/auto_feedback.mjs) | 353 | Stop 钩子：自动反馈采集——每轮回答结束后，检测正文 [n] 引用，提交 implicit=true 正向弱信号。 | — |
| [src/electron/host-hooks/fold_card_check.mjs](src/electron/host-hooks/fold_card_check.mjs) | 328 | Stop 钩子：召回回显合规性检查（2026-11-23 重写 P0） | pickBlockingIssues(fn), sliceCurrentTurn(fn), isFeedbackTurn(fn), findTextAfterCard(fn), validateEcho(fn) |
| [src/electron/host-hooks/session_review.mjs](src/electron/host-hooks/session_review.mjs) | 211 | Stop 钩子：每轮回答收尾前的「复盘 + 沉淀结论」双闸门。 | — |
| [src/electron/host-hooks/session_review_patch.mjs](src/electron/host-hooks/session_review_patch.mjs) | 175 | UserPromptSubmit 补漏钩子：检查上一条 assistant 回答是否含「复盘 + 沉淀结论」， | — |
| [src/electron/hostHookInject.ts](src/electron/hostHookInject.ts) | 362 | 宿主钩子自动注入框架（2026-11-23 · 原子任务 24a） | probeHookHosts(fn), extractTagPath(fn), mergeAllHostHooks(fn), installedHookTags(fn), stageAllHookScripts(fn), injectHooksIntoHost(fn), HOST_HOOK_REGISTRY(const), HostHookSpec(type), HookCapableHost(type), HostProbeDeps(type), MergeResult(type), StageResult(type), InjectResult(type), HookEvent(type) |
| [src/electron/hostScan.ts](src/electron/hostScan.ts) | 163 | 宿主真扫 · node IO 层（仅 Electron 主进程使用）： | parseTasklistCsv(fn), parseWmicJson(fn), listProcessNames(fn), detectMcpEntries(fn), detectConfigFiles(fn), scanHost(fn) |
| [src/electron/ipcChannels.ts](src/electron/ipcChannels.ts) | 281 | preload 暴露的 IPC channel 清单（唯一真源）。 | missingChannels(fn), formatBootFailure(fn), handleBootFailure(fn), IPC(const), SHELL_SHORTCUT_CHANNEL(const), PRELOAD_CHANNELS(const), BootFailureDeps(type), ShellShortcut(type) |
| [src/electron/l0KeyringStore.ts](src/electron/l0KeyringStore.ts) | 72 | L0 密钥环落盘适配（§4.4.8）：l0-keyring.json 原子写（temp → fsync → rename）， | writeFileAtomic(fn), createL0KeyringStore(fn), createHomeLockStore(fn), cleanupTempFiles(fn) |
| [src/electron/llmBilling.ts](src/electron/llmBilling.ts) | 407 | 批次48 A31-b：厂商余额查询适配器（主进程唯一真源）。 | billingGetJson(fn), loadBillingCredentials(fn), saveBillingCredential(fn), BILLING_CREDS_FILE(const), BILLING_TTL_MS(const), NO_ENDPOINT_VENDORS(const), LOCAL_BILLING_VENDORS(const), deepseekBilling(const), kimiBilling(const), siliconflowBilling(const), openrouterBilling(const), BILLING_ADAPTERS(const), LlmBillingService(class), BillingBalance(type), BillingFetchOutcome(type), BillingAdapter(type), BillingServiceDeps(type), EngineBillingView(type) |
| [src/electron/llmGateway.ts](src/electron/llmGateway.ts) | 577 | 批次32：LLM 精炼网关（主进程唯一真源）——通用 OpenAI 兼容**多引擎**，路由口径「哪个能用、哪个快用哪个」。 | defaultLlmConfig(fn), loadLlmConfig(fn), saveLlmConfig(fn), loadLlmKeys(fn), saveLlmKey(fn), keyExists(fn), buildLayerPrompt(fn), chatEndpoint(fn), applyProxyAccounting(fn), testEngine(fn), applyProbeResult(fn), loadLlmGateway(fn), llmEngineViews(fn), mergeLlmConfig(fn), LLM_CONFIG_FILE(const), LLM_KEYS_FILE(const), LEGACY_DEEPSEEK_KEY_FILE(const), LLM_PRESETS(const), LlmGatewayProvider(class), LlmEngineConfig(type), LlmGatewayConfig(type), LlmPreset(type), EngineTestResult(type), LlmGatewayView(type), LlmEnginePatch(type), LlmAddEngine(type), LlmConfigPatch(type), LlmEngineView(type) |
| [src/electron/main.ts](src/electron/main.ts) | 5595 | Electron 主进程入口： | — |
| [src/electron/mcpBridgeScript.ts](src/electron/mcpBridgeScript.ts) | 139 | stdio 桥接脚本（2026-11-18，用户要求「客户端配置改成 stdio launcher 现读令牌，轮换零维护」）。 | ensureMcpBridgeScript(fn), MCP_BRIDGE_SCRIPT(const) |
| [src/electron/mcpClients.ts](src/electron/mcpClients.ts) | 474 | MCP 客户端配置读写 · node 层（批次15，仅 Electron 主进程使用）。 | expandHome(fn), applyRecallEvidence(fn), scanMcpClients(fn), snippetForClient(fn), readStoredToken(fn), wireMcpClient(fn), enableMcpClient(fn), McpClientStatus(type), McpClientsScan(type), McpWireResult(type), McpRecallEvidence(type) |
| [src/electron/mcpProbe.ts](src/electron/mcpProbe.ts) | 174 | MCP 端点实测探活（2026-11-18，用户要求「实测连通」列 + 循环检测）。 | parseToolsCount(fn), probeMcpEndpoint(fn), attachLiveProbe(fn), McpLiveProbe(type), ProbeOptions(type), LiveProbeFields(type), LiveProbeTarget(type) |
| [src/electron/ownerBindings.ts](src/electron/ownerBindings.ts) | 104 | 个人记忆账号绑定真源（OB-1）：数据根级 personal-owner-bindings.json（0600），与 tenant.json 同级同规格。 | loadOwnerBindings(fn), normalizeOwnerBindingsInput(fn), writeOwnerBindings(fn), OWNER_BINDINGS_FILE_NAME(const), OWNER_BINDINGS_SCHEMA(const), WriteOwnerBindingsResult(type) |
| [src/electron/preload.ts](src/electron/preload.ts) | 499 | Electron preload：contextIsolation 开启下，经 contextBridge 向渲染进程暴露存储桥接面与运行标识。 | — |
| [src/electron/recallGateway.ts](src/electron/recallGateway.ts) | 187 | 批次62 UI 开关 · B：应用内置 LLM 网关（OpenAI-compatible 反向代理）。 | isLoopback(fn), rewriteRequest(fn), fetchPrelude(fn), startRecallGateway(fn), RecallGatewayOptions(type), RecallGatewayHandle(type) |
| [src/electron/recallHard.ts](src/electron/recallHard.ts) | 384 | 批次62 UI 开关 · 主进程控制器：A 宿主钩子 / B 内置网关 / C 严格门禁 三层统一编排。 | readHookRunState(fn), mergeHostHooks(fn), hostHookInstalled(fn), extractHookPathFromCommand(fn), findInstalledHookPath(fn), RECALL_HARD_HOOK_TAG(const), HOOK_STATUS_FILE(const), RecallHardController(class), RecallHardControllerOptions(type), RecallHardState(type) |
| [src/electron/recallHookScript.ts](src/electron/recallHookScript.ts) | 92 | 批次62 · A 层钩子脚本「稳定化」：把 force_recall.mjs 复制到数据根固定位置，宿主配置只指向这一份。 | stableHookScriptPath(fn), ensureStableHookScript(fn), STABLE_HOOK_REL(const), StableHookScriptResult(type), StableHookScriptDeps(type) |
| [src/electron/runHostHookAutoInject.ts](src/electron/runHostHookAutoInject.ts) | 85 | 原子任务24B · 启动时宿主钩子自动注入的编排层（main.ts bootstrap 调用）。 | resolveHostHookSourceDir(fn), runHostHookAutoInject(fn), AutoInjectDeps(type), AutoInjectSummary(type) |
| [src/electron/storageIpc.ts](src/electron/storageIpc.ts) | 62 | 批次47 P0-3：存储数据面四条「读写/审计」通道统一走登录会话闸门。 | createStorageReadWriteHandlers(fn), StorageIpcDeps(type), StorageReadWriteHandlers(type) |
| [src/electron/tenantSource.ts](src/electron/tenantSource.ts) | 94 | 批次45-A1 单一租户真源：数据根级 tenant.json（0600），类比 dataRoot 指针 / mcp-token.txt 的启动期指针文件。 | loadOrCreateTenant(fn), readTenantFile(fn), writeTenant(fn), TENANT_FILE_NAME(const), TENANT_SCHEMA(const), WriteTenantResult(type) |
| [src/electron/webchatAutoCollect.ts](src/electron/webchatAutoCollect.ts) | 407 | 阶段 B：网页会话无头自动采集器（Electron 侧接线）。 | createWebchatAutoCollector(fn), AUTO_FALLBACK_CONFIG(const), AutoCollectorDeps(type), AutoStateView(type), WebchatAutoCollector(type) |
| [src/electron/webchatAutoConfig.ts](src/electron/webchatAutoConfig.ts) | 953 | 阶段 B（无头自动采集）的纯逻辑层：配置、采集账、去重判据、页内驱动脚本。 | normalizeAutoConfig(fn), parseAutoPatch(fn), autoDir(fn), autoConfigPath(fn), autoStatePath(fn), autoLedgerPath(fn), readAutoConfig(fn), writeAutoConfig(fn), normalizeAutoState(fn), readAutoState(fn), writeAutoState(fn), appendLedger(fn), buildDriverScript(fn), parseDriverResult(fn), formatDiag(fn), summarizeSteps(fn), pickNewChats(fn), judgeSite(fn), AUTO_DIR_NAME(const), AUTO_CONFIG_FILE(const), AUTO_STATE_FILE(const), AUTO_LEDGER_FILE(const), AUTO_MIN_INTERVAL(const), AUTO_MAX_INTERVAL(const), AUTO_DEFAULT_INTERVAL(const), AUTO_MAX_CHATS_PER_ROUND(const), AUTO_MAX_CHATS_MANUAL(const), AUTO_MAX_ATTEMPTS_ROUND(const), AUTO_MAX_ATTEMPTS_MANUAL(const), AUTO_MAX_CHATS_SWEEP(const), AUTO_MAX_ATTEMPTS_SWEEP(const), AUTO_SWEEP_MAX_BATCHES(const), AUTO_MIN_PER_ROUND(const), AUTO_MAX_PER_ROUND(const), DEFAULT_AUTO_CONFIG(const), SITE_ENTRY_URL(const), DEFAULT_AUTO_STATE(const), WebchatAutoConfig(type), SiteRoundResult(type), RoundSummary(type), AutoState(type), DriverChat(type), SidebarDiag(type), DriverStep(type), DriverResult(type), PageSnapshot(type), AutoPatch(type), SiteStatus(type) |
| [src/electron/webchatAutoUa.ts](src/electron/webchatAutoUa.ts) | 24 | 内嵌浏览器 UA 的最小去标记处理（2026-11-19）。 | stripElectronUa(fn), applyCleanUserAgent(fn), UaWebContents(type) |
| [src/electron/webchatExtensionCopy.ts](src/electron/webchatExtensionCopy.ts) | 111 | 把随包下发的插件复制到数据根下的**稳定目录**，再让用户到浏览器里「加载已解压的扩展程序」指向它。 | ensureStableExtensionDir(fn), WEBCHAT_EXTENSION_FILES(const), EnsureStableExtensionOptions(type), EnsureStableExtensionResult(type) |
| [src/electron/webchatExtensionPath.ts](src/electron/webchatExtensionPath.ts) | 21 | 自研网页对话导出插件的目录解析（纯函数，便于单测）。 | resolveWebchatExtensionDir(fn), WebchatExtensionPathOptions(type) |
| [src/electron/webchatIdReconcile.ts](src/electron/webchatIdReconcile.ts) | 116 | 无状态 ID 对账：会话 ID 是唯一主键，文件名即 ID，文件系统即账本。 | conversationIdFromUrl(fn), sanitizeConversationId(fn), webchatExportFileName(fn), chatCollectedKey(fn), pickNewChatsById(fn), listCollectedIds(fn), DriverChat(type) |
| [src/electron/webchatIngest.ts](src/electron/webchatIngest.ts) | 550 | 插件导出的本机接收端：让浏览器插件不再依赖「浏览器下载目录」。 | webchatExportFileName(fn), handleExportRequest(fn), handleClearRequest(fn), createWebchatIngestServer(fn), writeWebchatRuntime(fn), newWebchatIngestToken(fn), WEBCHAT_SITE_RE(const), WebchatIngestPayload(type), WebchatIngestOptions(type), WebchatIngestResult(type), WebchatClearOptions(type), WebchatClearResult(type) |
| [src/electron/webchatWindow.ts](src/electron/webchatWindow.ts) | 14 | 网页采集窗口的识别判据（2026-11-19 根因修复）。 | isWebchatStoragePath(fn) |
| [src/electron/webhookServer.ts](src/electron/webhookServer.ts) | 103 | Webhook HTTP 服务（批次26-A P0-4，从 main.ts 内联处理器抽出以便单测）： | createWebhookHttpServer(fn), WebhookServerOptions(type) |

## src/home

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/home/dashboard.ts](src/home/dashboard.ts) | 59 | REQ-005 T4：首页 Dashboard 数据聚合（纯函数，§0.2） | buildDashboard(fn), RawHomeFeed(type) |
| [src/home/mirrorLedger.ts](src/home/mirrorLedger.ts) | 175 | 批次48 A8：mirror 审计账本的链式签名（G6 证据账本，防静默改写）。 | canonicalJson(fn), loadOrCreateMirrorKey(fn), sealMirrorEntry(fn), verifyMirrorChain(fn), resealLegacyEntries(fn), GENESIS_HASH(const), MIRROR_KEY_FILE(const), MIRROR_INTEGRITY_NOTE(const), MirrorAuditEntry(type), MirrorIntegrity(type) |
| [src/home/server.ts](src/home/server.ts) | 1039 | REQ-005 T10：登录后端 HTTP 服务（零依赖，可选镜像，§4.1/§4.3） | createServer(fn), ServerOptions(type), HomeServer(type) |

## src/shared

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/shared/actionLog.ts](src/shared/actionLog.ts) | 131 | 动作日志（批次7）：全链路结构化留痕的统一格式与脱敏。 | sanitizeActionDetail(fn), createActionLogEntry(fn), formatActionLine(fn), ActionLogEntry(type), ActionLogOptions(type), ActionLogTailResult(type), ActionLogLevel(type) |
| [src/shared/auditShape.ts](src/shared/auditShape.ts) | 20 | 审计写形状校验（批次26-B P1-2 建 / 批次28-A 抽共享供 HTTP 数据面复用）： | validateAuditRecord(fn) |
| [src/shared/billing.ts](src/shared/billing.ts) | 147 | 批次48 A31：余额/配额/单价的公共口径（electron 主进程与 web 模型页共用，纯函数、无 IO）。 | normalizeManualBilling(fn), manualBillingSet(fn), billingHHmm(fn), billingMinutesAgo(fn), billingProvenanceText(fn), billingAmountText(fn), estimateCallCostCny(fn), UNSET_MANUAL_BILLING(const), BillingEngineView(type), ManualBilling(type), ProvenanceInput(type), BillingProvenance(type), BillingFetchStatus(type) |
| [src/shared/cron.ts](src/shared/cron.ts) | 148 | 确定性 cron 计算（批次48 A23.2）：5 段表达式 + **固定时区偏移**，纯函数、无 I/O。 | parseCron(fn), nextDue(fn), CronSpec(type) |
| [src/shared/dataLayout.ts](src/shared/dataLayout.ts) | 123 | 数据根内的子目录归类布局（2026-11-18 用户约定「每个数据及配置按实际情况分文件夹归类」）。 | isChromiumReservedSubdir(fn), subdirForFile(fn), subdirForDir(fn), classifiedPath(fn), classifiedDir(fn), libraryDir(fn), DATA_SUBDIRS(const), LEGACY_LIBRARY_SUBDIR(const), DataSubdir(type) |
| [src/shared/growthConfig.ts](src/shared/growthConfig.ts) | 434 | 生长配置单一真源（批次48 A23）：五维查重权重 / 逐层阈值 / 调度开关。 | validFeedbackPolicy(fn), validEvolutionConfig(fn), cloneDefaultEvolution(fn), normalizeEvolutionConfig(fn), minIntervalMinutes(fn), validateScheduleExpr(fn), normalizeScheduleExprs(fn), resolveScheduleExpr(fn), validWeights(fn), validRecallWeights(fn), validThresholds(fn), normalizeScheduleFlags(fn), normalizeGrowthConfig(fn), DIM_KEYS(const), RECALL_KEYS(const), LAYERS(const), SCHEDULE_KEYS(const), DEFAULT_WEIGHTS(const), DEFAULT_FEEDBACK_POLICY(const), DEFAULT_RECALL_WEIGHTS(const), DEFAULT_THRESHOLDS(const), DEFAULT_SCHEDULE_FLAGS(const), SCHEDULE_TASKS(const), EVOLUTION_MODES(const), DEFAULT_EVOLUTION(const), DEFAULT_SCHEDULE_EXPRS(const), SCHEDULE_MIN_INTERVAL_MIN(const), FeedbackPolicy(type), ScheduleTaskSpec(type), EvolutionWindow(type), EvolutionMinSamples(type), EvolutionRollback(type), EvolutionGuard(type), EvolutionConfig(type), ScheduleExprCheck(type), GrowthConfig(type), DimKey(type), DimWeights(type), RecallKey(type), RecallWeights(type), Layer(type), LayerThresholds(type), ScheduleKey(type), ScheduleFlags(type), EvolutionMode(type), ScheduleExprs(type) |
| [src/shared/growthSchedule.ts](src/shared/growthSchedule.ts) | 58 | 调度计划纯函数（M0）：把「当前配置的表达式」与「历史 schedule_run 审计」合并成确定的下次到期。 | isAuditPlanStale(fn), planNextDue(fn), advanceNextDue(fn), SCHEDULE_FALLBACK_MS(const), SchedulePlanInput(type) |
| [src/shared/localOrigin.ts](src/shared/localOrigin.ts) | 93 | 本机 HTTP 服务的跨源闸门：只信任明确放行的页面来源。 | createOriginPolicy(fn), rejectUntrustedOrigin(fn), applyCorsHeaders(fn), rejectUntrustedHost(fn), DEV_ORIGINS(const), OriginPolicy(type), OriginPolicyOptions(type) |
| [src/shared/memoryOwnership.ts](src/shared/memoryOwnership.ts) | 90 | 批次48 A7：putMemory 归属校验（浏览器 HTTP 数据面 + Electron IPC 数据面共用同一判据）。 | checkMemoryWriteOwnership(fn), findExistingMemoryRow(fn), SessionTenant(type), OwnershipVerdict(type) |
| [src/shared/normalParams.ts](src/shared/normalParams.ts) | 27 | 批次48 A17：参数页「普通配置」折算表 —— Web 展示与内核遗忘调度共用这一份真源。 | halfLifeDaysOf(fn), autoArchiveDaysOf(fn), FORGET_SPEED_HALF_LIFE_DAYS(const), RETENTION_ARCHIVE_DAYS(const), ForgetSpeed(type), Retention(type) |
| [src/shared/passwordPolicy.ts](src/shared/passwordPolicy.ts) | 57 | 批次48 A10：密码策略（4.2）的共享真源 —— 首页后端持久化 + 注册/改密校验 + 安全页展示同一份定义。 | normalizePwdPolicy(fn), validatePasswordAgainstPolicy(fn), DEFAULT_PWD_POLICY(const), PwdPolicy(type) |
| [src/shared/pendingWritesView.ts](src/shared/pendingWritesView.ts) | 64 | 待重放写入队列的「只读摘要」口径（D6 / S5） | summarizePendingWrites(fn), PENDING_SUMMARY_LIMIT(const), PendingWriteSummary(type), PendingWritesView(type) |
| [src/shared/proxyAccounting.ts](src/shared/proxyAccounting.ts) | 90 | 批次48 A16：反代理记账单价 / 日配额。 | normalizeAccountingPrice(fn), normalizeAccountingQuota(fn), proxyModelMeta(fn), remainingText(fn), normalizeProxyCap(fn), proxyCapsFromCfg(fn), proxyCostToday(fn), UNSET_PROXY_ACCOUNTING(const), UNSET_PROXY_CAPS(const), PROXY_COST_WINDOW_MS(const), ProxyAccounting(type), ProxyCaps(type) |
| [src/shared/recallHardConfig.ts](src/shared/recallHardConfig.ts) | 114 | 硬前置召回 A/B/C 三层开关的**配置单一真源**（批次62 UI 开关）。 | validRecallHardPort(fn), validRecallUpstream(fn), recallHardBaseUrl(fn), normalizeRecallHardConfig(fn), memberForbiddenFields(fn), parseRecallHardPatch(fn), RECALL_HARD_CONFIG_FILE(const), DEFAULT_RECALL_HARD_CONFIG(const), RECALL_HARD_DEFAULT_PORT(const), RECALL_HARD_MIN_PORT(const), RECALL_HARD_MAX_PORT(const), MEMBER_EDITABLE_KEYS(const), RecallHardConfig(type) |
| [src/shared/sessionKey.ts](src/shared/sessionKey.ts) | 6 | — | SESSION_STORAGE_KEY(const) |
| [src/shared/tenantDefaults.ts](src/shared/tenantDefaults.ts) | 24 | 批次45-A1 单一租户真源：本机规范租户三元组的**缺省值**与**校验**。 | normalizeTenantTriple(fn), DEFAULT_TENANT(const), TenantTriple(type) |
| [src/shared/timeWindow.ts](src/shared/timeWindow.ts) | 143 | REQ-013 / C1：本地时区相对时间解析与「时间窗命中」判定（纯函数，零依赖）。 | parseRelativeTime(fn), extractQueryTimestamp(fn), hitTimeWindow(fn), DAY_MS(const), TIME_WINDOW_MARGIN_MS(const), TIME_WINDOW_BONUS(const), TimeIntent(type) |
| [src/shared/webchatSites.ts](src/shared/webchatSites.ts) | 30 | 网页对话导出支持的站点（应用侧唯一词表）。 | webchatSiteLabel(fn), WEBCHAT_SITES(const), WebchatSite(type) |

## src/types

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/types/agentOnboard.ts](src/types/agentOnboard.ts) | 271 | REQ-003 T1 交付物：Agent 接入页领域类型 / 数据契约（单一事实来源的"类型基线"） | assertShape(fn), AgentStatus(const), PriorityBadge(const), CircuitState(const), AgentCardShape(const), McpToolConfigShape(const), ChannelConfigShape(const), KeyMgmtShape(const), RecallMemoryTool(type), WriteMemoryTool(type), UserPreferencesTool(type), McpTools(type), Channels(type), OneClickFlags(type), DiscoverFlags(type), AgentCard(type), UiRecallTool(type), UiIso(type), UiChan(type), UiKey(type), AgentRealStats(type), UiAgentCard(type), InstalledAgent(type), DiscoveredAgent(type), Gain(type), AgentStatus(type), Priority(type), BadgeClass(type), CircuitState(type), Form(type), DeepPartial(type), AgentCardCandidate(type), AgentCardInput(type), ToolToggle(type), ToolToggleOrFalse(type), UiState(type) |
| [src/types/home.ts](src/types/home.ts) | 115 | REQ-005 首页与登录卡片：全局租户上下文 + 首页领域类型 | isAdminContext(fn), PERSPECTIVES(const), SYNC_ROLES(const), LOGIN_FAIL_REASONS(const), TenantContext(type), SyncState(type), LoginForm(type), LoginAudit(type), AnomalyItem(type), ActiveMemory(type), TodoItem(type), HomeDashboard(type), Perspective(type), AccountRole(type), SyncRole(type), LoginFailReason(type), LoginResult(type) |

## src/web

| 文件 | 行数 | 摘要 | 导出 |
|---|---|---|---|
| [src/web/AgentOnboard/AgentCard.tsx](src/web/AgentOnboard/AgentCard.tsx) | 186 | 单家宿主 Agent 接入卡片（批次48 起 1:1 对齐设计真源 stratum-a-full.html pg-agent 的 af-panel 卡）： | AgentCard(fn), AgentCardProps(type) |
| [src/web/AgentOnboard/AgentOnboardPage.tsx](src/web/AgentOnboard/AgentOnboardPage.tsx) | 734 | Agent 接入页容器（REQ-003 · 批次48 起 1:1 对齐设计真源 stratum-a-full.html pg-agent 段）： | AgentOnboardPage(fn) |
| [src/web/AgentOnboard/ChannelConfig.tsx](src/web/AgentOnboard/ChannelConfig.tsx) | 38 | 采集通道配置行（规格 T6 / 19.3 · R4 双通道至少开一 + SHA-256 幂等不可关） | ChannelConfig(fn) |
| [src/web/AgentOnboard/FormBadge.tsx](src/web/AgentOnboard/FormBadge.tsx) | 42 | 按端置灰徽标（规格 T10 / AC-003.10 / 19.10） | FormBadge(fn), GRAYED_BY_FORM(const) |
| [src/web/AgentOnboard/Gains.tsx](src/web/AgentOnboard/Gains.tsx) | 25 | 效果证据 · 用户可感知的「省」与「快」（19.1 / 9.x / 2.4.x / 19.8 反代理） | Gains(fn) |
| [src/web/AgentOnboard/IsolationConfig.tsx](src/web/AgentOnboard/IsolationConfig.tsx) | 36 | 隔离粒度配置行（规格 19.4 · R1 project_id 共享 / user_id 偏好跨项目） | IsolationConfig(fn) |
| [src/web/AgentOnboard/KeyMgmt.tsx](src/web/AgentOnboard/KeyMgmt.tsx) | 21 | 密钥管理行（规格 T7 / §4 · R5 恒脱敏不回显 / R6 轮换宽限 24h / 超 90 天告警） | KeyMgmt(fn) |
| [src/web/AgentOnboard/McpClientsPanel.tsx](src/web/AgentOnboard/McpClientsPanel.tsx) | 868 | MCP 客户端接入面板（批次15 建 / 批次21 交互收敛 / 批次23 一键适配全部 + 逐客户端接通指引； | McpClientsPanel(fn), McpSummary(type) |
| [src/web/AgentOnboard/McpToolConfig.tsx](src/web/AgentOnboard/McpToolConfig.tsx) | 64 | MCP 工具配置行（规格 T5 / 19.5 · 须带 project_id） | toolRef(fn), McpToolConfig(fn) |
| [src/web/AgentOnboard/OneClickOnboard.tsx](src/web/AgentOnboard/OneClickOnboard.tsx) | 235 | 扫描明细卡（规格 T4 / AC-003.4 / 19.9 · 批次48 起 1:1 对齐设计真源 stratum-a-full.html 的 af-panel/af-det 版式） | OneClickOnboard(fn) |
| [src/web/AgentOnboard/TestPanel.tsx](src/web/AgentOnboard/TestPanel.tsx) | 70 | 接入测试面板（规格 T8 / AC-003.8 · R7 必记 request_id · 注入预览） | TestPanel(fn), TestEvidence(type) |
| [src/web/AgentOnboard/WebChatExportCard.tsx](src/web/AgentOnboard/WebChatExportCard.tsx) | 743 | 网页版对话接入引导卡（chat-exports）： | WebChatExportCard(fn) |
| [src/web/AgentOnboard/agentOnboardEntry.tsx](src/web/AgentOnboard/agentOnboardEntry.tsx) | 33 | REQ-003 接入页入口（原 index.html 默认页，因 REQ-005 首页路由决策迁至独立入口，保留 REQ-003 验证） | — |
| [src/web/AgentOnboard/autoDiscovery.ts](src/web/AgentOnboard/autoDiscovery.ts) | 237 | 登录自动发现链路（批次16）：三路真实信号合并 + 对可写 JSON 客户端自动写入 MCP。 | scanLocalAgents(fn), mcpSpecForAgent(fn), autoWireMcpForAgents(fn), McpClientRow(type), HostInstallScan(type), LocalAgentScan(type) |
| [src/web/AgentOnboard/autoOnboard.ts](src/web/AgentOnboard/autoOnboard.ts) | 268 | 登录/手动自动接入链路（批次16）： | readOnboardFailure(fn), clearOnboardFailure(fn), hasAutoScannedSession(fn), markAutoScannedSession(fn), clearAutoScannedSession(fn), runAutoOnboard(fn), runAutoOnboardOnLogin(fn), resetAutoOnboardState(fn), ONBOARD_FAILURE_KEY(const), ONBOARD_AUTOSCAN_KEY(const), OnboardFailure(type), RunAutoOnboardOptions(type), AutoOnboardOutcome(type) |
| [src/web/AgentOnboard/cards.ts](src/web/AgentOnboard/cards.ts) | 106 | 接入卡片构造与恢复：只由「真实接入过」的 agent 名单生成卡片，无任何演示卡片。 | specOf(fn), makeCard(fn), restoreCards(fn), restoreDiscovered(fn), AGENT_SPECS(const), AgentSpec(type) |
| [src/web/AgentOnboard/coreOnboard.ts](src/web/AgentOnboard/coreOnboard.ts) | 233 | AgentOnboard 接入页接真内核：一键接入第 4 段「测通并写审计」走 ma.discover | coreDiscover(fn), coreHostDiscover(fn), computeOnboardGains(fn), getOnboardGains(fn), emptyOnboardGains(fn), getOnboardInjectPreview(fn), DiscoveredAgentUi(type) |
| [src/web/AgentOnboard/ledger.ts](src/web/AgentOnboard/ledger.ts) | 249 | A29：Agent 接入状态写内核账本 + 页面状态从账本重建。 | recordAgentAction(fn), rebuildAgentLedger(fn), loadAgentLedger(fn), mergeLedgerIntoCards(fn), AGENT_LEDGER_ACTIONS(const), OnboardTenant(type), AgentLedgerAgent(type), AgentLedger(type), AgentActionInput(type) |
| [src/web/AgentOnboard/onboardState.ts](src/web/AgentOnboard/onboardState.ts) | 73 | Agent 接入页「已接入」状态持久化（localStorage，跨 iframe 共享、切页/重载保持）。 | readOnboardState(fn), writeOnboardState(fn), clearOnboardState(fn), ONBOARD_STATE_KEY(const), OnboardMcpSummary(type), OnboardState(type) |
| [src/web/AgentOnboard/startupAutoOnboard.ts](src/web/AgentOnboard/startupAutoOnboard.ts) | 100 | 应用启动即自动发现并接入本机 Agent（2026-11-16 用户要求）。 | resetStartupAutoOnboardForTest(fn), runStartupAutoOnboard(fn), StartupAutoOnboardOptions(type) |
| [src/web/AgentOnboard/store.ts](src/web/AgentOnboard/store.ts) | 62 | 接入页本地持久化：用户真实接入过的 agent 名单与卡片配置快照（localStorage，跨 iframe/重载保持）。 | addAgentCard(fn), removeAgentCard(fn), listDetectedAgents(fn), DetectedCardSnapshot(type) |
| [src/web/AgentOnboard/useBackendMirror.ts](src/web/AgentOnboard/useBackendMirror.ts) | 321 | 真实后端镜像（接T13/T14）：把 UI 动作 best-effort 打到后端，并在挂载时 GET /agents 回填、 | resolveBackendUrl(fn), createService(fn), toServiceInput(fn), normalizeAgentKey(fn), statsForAgent(fn), computeAgentStats(fn), useBackendMirror(fn), TestOutcome(type), BackendMirror(type), BackendCardEcho(type) |
| [src/web/Home/Dashboard.tsx](src/web/Home/Dashboard.tsx) | 153 | REQ-005 T7：首页 Dashboard 区块组件（功劳 + 异常 + 活跃 + 待办，§0.2） | Dashboard(fn), DashboardProps(type) |
| [src/web/Home/HomePage.tsx](src/web/Home/HomePage.tsx) | 99 | REQ-005 T9：首页装配容器（HomePage，§0.1/§0.2/§0.3 集成） | HomePage(fn), HomePageProps(type) |
| [src/web/Home/LayerGraphPanel.tsx](src/web/Home/LayerGraphPanel.tsx) | 538 | 首页 L1–L6 关系图谱交互面板（批次8-B）： | LayerGraphPanel(fn), LayerGraphPanelProps(type) |
| [src/web/Home/LoginModal.tsx](src/web/Home/LoginModal.tsx) | 412 | REQ-005 T8：登录卡片组件（§0.3 弹出子视图） | LoginModal(fn), LoginModalProps(type) |
| [src/web/Home/ProgramLogPanel.tsx](src/web/Home/ProgramLogPanel.tsx) | 241 | 程序运行日志窗口（批次17 建，批次19 从首页迁至日志记录页）：真实尾读 <数据根>/actions.log。 | ProgramLogPanel(fn), ProgramLogPanelProps(type) |
| [src/web/Home/TopBar.tsx](src/web/Home/TopBar.tsx) | 88 | REQ-005 T6：首页顶栏组件（登录态自适应，§0.2 顶栏） | TopBar(fn), TopBarProps(type) |
| [src/web/Home/coreHome.ts](src/web/Home/coreHome.ts) | 422 | REQ-005 首页（真实可算）： | coreTraceLookup(fn), emptyGains(fn), getHomeFeed(fn), emptySync(fn), fetchMirrorItems(fn), L0_LOCK_ANOMALY_WINDOW_MS(const), TraceHit(type), MirrorItem(type), GetHomeFeedOpts(type), HomeStrataCount(type), HomeFacts(type), HomeFeedResult(type), HomeStrataLayer(type) |
| [src/web/Home/crossTabAuth.ts](src/web/Home/crossTabAuth.ts) | 49 | 跨 iframe 登录态共享（localStorage）—— REQ-005 T11 补充 | getStoredSessionId(fn), storeSessionId(fn), clearStoredSessionId(fn), setTestOverride(fn), hasActiveSession(fn), useCrossTabAuth(fn) |
| [src/web/Home/layerGraph.ts](src/web/Home/layerGraph.ts) | 328 | 首页 L1–L6 关系图谱数据推导（批次8-A，纯函数）： | categoryMeta(fn), memoryLayerText(fn), deriveLayerGraph(fn), emptyLayerGraph(fn), GRAPH_LAYERS(const), GRAPH_CATEGORIES(const), LayerMeta(type), CategoryMeta(type), LayerHubNode(type), MemoryGraphNode(type), LayerGraphEdge(type), LayerGraphStats(type), LayerGraph(type), LayerGraphOptions(type), GraphLayerId(type), GraphCategoryId(type), GraphEdgeKind(type) |
| [src/web/Home/layerGraphLayout.ts](src/web/Home/layerGraphLayout.ts) | 190 | 首页 L1–L6 关系图谱布局（批次8-A，纯函数）： | layoutLayerGraph(fn), LayoutPoint(type), PositionedHub(type), PositionedNode(type), PositionedEdge(type), LayoutSpoke(type), LayerGraphLayout(type), LayerGraphLayoutOptions(type) |
| [src/web/Home/programLog.ts](src/web/Home/programLog.ts) | 113 | 程序运行日志窗口的纯函数（批次17 建，批次19 起由日志记录页使用）：解析 actions.log 行、UTC+08:00 时间展示、诊断文本与剪贴板复制。 | parseProgramLogLine(fn), formatLogClock(fn), formatLogDate(fn), formatLocalDateTime(fn), countErrors(fn), buildDiagnostics(fn), copyText(fn), ProgramLogLine(type) |
| [src/web/Home/programLogLabels.ts](src/web/Home/programLogLabels.ts) | 296 | 程序运行日志「人话」层（批次24）：把 actions.log 的 scope:action + detail 翻成一句中文。 | detailNote(fn), actionTitle(fn), humanizeProgramLog(fn), SCOPE_LABEL(const), LEVEL_LABEL(const), HumanLogLine(type) |
| [src/web/Home/tenantContext.tsx](src/web/Home/tenantContext.tsx) | 149 | REQ-005 T5：全局租户上下文 Provider（React，§0.1 / §0.3） | TenantProvider(fn), useTenant(fn), useTenantRestoring(fn), useLogin(fn), useLogout(fn), TenantProviderProps(type), LoginFn(type), LogoutFn(type) |
| [src/web/Home/useLoginMirror.ts](src/web/Home/useLoginMirror.ts) | 130 | REQ-005 T11：前端登录 API client（镜像，§0.3 / 对齐 REQ-003 useBackendMirror） | useLoginMirror(fn), UseLoginMirrorOptions(type) |
| [src/web/assistant/AssistantPage.tsx](src/web/assistant/AssistantPage.tsx) | 122 | 记忆助手 · 整页（2026-11-10 用户要求：原悬浮窗改为整页页面）。 | AssistantPage(fn) |
| [src/web/assistant/assistantEntry.tsx](src/web/assistant/assistantEntry.tsx) | 13 | 记忆助手整页入口（2026-11-10：由壳层悬浮窗改为独立中心页） | — |
| [src/web/audit/AuditPage.tsx](src/web/audit/AuditPage.tsx) | 206 | 审计日志页（REQ-006 / P11）· 定稿 9 列 / 链路视图 / 双导出 | AuditPage(fn) |
| [src/web/audit/AuditTable.tsx](src/web/audit/AuditTable.tsx) | 121 | 审计日志页（REQ-006 / P11）审计列表（T4）· 定稿 9 列 | AuditTable(fn), AuditTableProps(type) |
| [src/web/audit/ChainView.tsx](src/web/audit/ChainView.tsx) | 28 | 链路视图（18.2-E）· 定稿 5 段：只连真实存在的事件，缺失段显示「—」，不补造节点。 | ChainView(fn) |
| [src/web/audit/FilterBar.tsx](src/web/audit/FilterBar.tsx) | 61 | 审计过滤栏（T3）· 定稿 5 维：动作 / 起止时间 / request_id / Agent | FilterBar(fn) |
| [src/web/audit/auditEntry.tsx](src/web/audit/auditEntry.tsx) | 11 | 审计日志页（REQ-011 / P11）入口：挂载 AuditPage。 | — |
| [src/web/audit/auditLink.ts](src/web/audit/auditLink.ts) | 26 | 审计行 → 检索页「链路上下文」的真实跳转契约（阶段5-A / A15）。 | retrievalContextHref(fn), readTrailRequestId(fn), trailEntries(fn), RETRIEVAL_CONTEXT_PAGE(const), RETRIEVAL_CONTEXT_PARAM(const) |
| [src/web/audit/coreAudit.ts](src/web/audit/coreAudit.ts) | 81 | 审计日志页（REQ-006 / P11）接真内核：审计流存内核 InMemoryStorage（append-only）， | coreLoadAudit(fn) |
| [src/web/audit/logic.ts](src/web/audit/logic.ts) | 162 | 审计日志页（REQ-006 / P11）纯逻辑层 | actionLabel(fn), initialAuditFilter(fn), initialAuditChain(fn), filterEntries(fn), localInputToIso(fn), chainByRequest(fn), exportCsv(fn), exportJson(fn), chainStages(fn), ACTION_LABEL(const), ChainStage(type) |
| [src/web/audit/types.ts](src/web/audit/types.ts) | 57 | 审计日志页（REQ-006 / P11）数据模型 | AuditEntry(type), AuditFilter(type), AuditAction(type) |
| [src/web/audit/useAuditMirror.ts](src/web/audit/useAuditMirror.ts) | 20 | 审计日志页后端镜像（T5）：沿用 ?backend= 覆盖模式。 | useAuditMirror(fn), AuditMirror(type) |
| [src/web/audit/useToast.tsx](src/web/audit/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/backend.ts](src/web/backend.ts) | 156 | 本机后端地址单一真源（与 src/electron/main.ts 的 MIRROR_PORT / AGENT_ONBOARD_PORT 对齐）。 | backendParam(fn), agentBackendParam(fn), homeBaseUrl(fn), onboardBaseUrl(fn), rememberHomeBase(fn), discoverTrustedDevBackend(fn), HOME_BASE(const), ONBOARD_BASE(const), DEV_FALLBACK_PORTS(const) |
| [src/web/dispute/DisputePage.tsx](src/web/dispute/DisputePage.tsx) | 341 | 冲突裁决页 T5：完整编排 + mirror · 真实数据接真版 | DisputePage(fn) |
| [src/web/dispute/DisputeQueue.tsx](src/web/dispute/DisputeQueue.tsx) | 79 | P7-T3 冲突裁决队列组件（批次53-R 重做：截图目标版式 = 密集表格，非卡片堆） | DisputeQueue(fn) |
| [src/web/dispute/DisputeVerdict.tsx](src/web/dispute/DisputeVerdict.tsx) | 47 | P7-T4 裁决操作组件（批次53-R 重做：截图目标版式 = 四等宽按钮 + 按钮下各一行灰注释） | DisputeVerdict(fn), VERDICTS(const) |
| [src/web/dispute/coreDispute.ts](src/web/dispute/coreDispute.ts) | 145 | 冲突裁决页（REQ-006 / P7）接真内核：队列与裁决**全部下沉到内核原子 API**（批次46-3）。 | coreConflicts(fn), coreConflictHistory(fn), coreVerdict(fn), DisputeCtx(type), ConflictHistoryRow(type), VerdictOutcome(type) |
| [src/web/dispute/disputeEntry.tsx](src/web/dispute/disputeEntry.tsx) | 12 | 冲突裁决页（REQ-006 / P7）入口：挂载 DisputePage（批次53 起 af 化版式，p0-pagehead 旧版式类清零）。 | — |
| [src/web/dispute/labels.ts](src/web/dispute/labels.ts) | 11 | 冲突类型 → 中文标签（规格常量）。页面数据真相 = 内核账本，无演示冲突。 | CONFIRM_TYPE_LABEL(const) |
| [src/web/dispute/logic.ts](src/web/dispute/logic.ts) | 82 | 冲突裁决页（REQ-006 / P7）纯逻辑层 | initialConflictId(fn), typeLabel(fn), overdueDays(fn), isOverdue(fn), applyVerdict(fn), auditPair(fn), queueSort(fn), VerdictResult(type) |
| [src/web/dispute/types.ts](src/web/dispute/types.ts) | 44 | 冲突裁决页（REQ-006 / P7）数据模型 | ConflictRecord(type), ConflictAudit(type), ConflictType(type), Verdict(type) |
| [src/web/dispute/useDisputeMirror.ts](src/web/dispute/useDisputeMirror.ts) | 24 | 冲突裁决页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useDisputeMirror(fn), DisputeMirror(type) |
| [src/web/dispute/useToast.tsx](src/web/dispute/useToast.tsx) | 22 | 轻量 toast hook（T5）：返回展示节点与 show(msg) | useToast(fn) |
| [src/web/feedback/FeedbackForm.tsx](src/web/feedback/FeedbackForm.tsx) | 102 | P9-T3 反馈表单（13.7） | FeedbackForm(fn) |
| [src/web/feedback/FeedbackPage.tsx](src/web/feedback/FeedbackPage.tsx) | 155 | 用户反馈页（REQ-006 / P9）T4 编排 | FeedbackPage(fn) |
| [src/web/feedback/StatCards.tsx](src/web/feedback/StatCards.tsx) | 36 | P9-T3 统计卡（7.1/7.2） | StatCards(fn) |
| [src/web/feedback/coreFeedback.ts](src/web/feedback/coreFeedback.ts) | 114 | 用户反馈页（REQ-006 / P9）接真内核：提交走 ma._feedback（17.4 trust_delta 内核计算） | coreSubmitFeedback(fn), coreListMemoryOptions(fn), coreLoadFeedbackRecords(fn), coreLoadRecallEchoes(fn), FeedbackOutcome(type), MemoryOption(type), RecallEchoRow(type) |
| [src/web/feedback/feedbackEntry.tsx](src/web/feedback/feedbackEntry.tsx) | 12 | 用户反馈页（REQ-006 / P9）入口（T1 壳） | — |
| [src/web/feedback/logic.ts](src/web/feedback/logic.ts) | 72 | 用户反馈页（REQ-006 / P9）纯逻辑层 | trustDelta(fn), validateDraft(fn), statShare(fn), composeRecord(fn), FeedbackStats(type) |
| [src/web/feedback/types.ts](src/web/feedback/types.ts) | 28 | 用户反馈页（REQ-006 / P9）数据模型 | FeedbackDraft(type), InjectedContext(type), FeedbackRecord(type), FeedbackAction(type) |
| [src/web/feedback/useFeedbackMirror.ts](src/web/feedback/useFeedbackMirror.ts) | 21 | 用户反馈页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useFeedbackMirror(fn), FeedbackMirror(type) |
| [src/web/feedback/useToast.tsx](src/web/feedback/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/growth/DedupCards.tsx](src/web/growth/DedupCards.tsx) | 160 | P14-T3 自净化侧组件：五维评分卡 + 短路嫁接流程 + 24h 统计 + 开发者调参（6.1/6.2，G7） | DedupCard(fn), ShortCircuitFlow(fn), DevTunePanel(fn) |
| [src/web/growth/EvolutionSettingsCard.tsx](src/web/growth/EvolutionSettingsCard.tsx) | 197 | M0-5：自生长进化设置卡 —— 频率可改（周期/时间）+ 参数可配 + 可行性预测。 | EvolutionSettingsCard(fn) |
| [src/web/growth/EvolutionTimelineCard.tsx](src/web/growth/EvolutionTimelineCard.tsx) | 213 | M4：进化时间线 + 参数漂移仪表（展示层，只渲染真实审计投影）。 | EvolutionTimelineCard(fn) |
| [src/web/growth/GrowthPage.tsx](src/web/growth/GrowthPage.tsx) | 666 | 自我净化与生长页（REQ-009 / P14）· 真实数据接真版 | GrowthPage(fn) |
| [src/web/growth/GrowthPanels.tsx](src/web/growth/GrowthPanels.tsx) | 856 | P14-T3 自生长侧组件：指标卡 + 五项优化 + Δ 收益曲线 + 调度时间轴（7.1/7.2/13.3） | GrowthCards(fn), OptimizationList(fn), regressionStatusText(fn), RegressionTable(fn), DeltaPanel(fn), EvolutionEffectCard(fn), ScheduleTimeline(fn), AgentUsageCard(fn), RecallWeightCard(fn), FeedbackLoopCard(fn) |
| [src/web/growth/coreGrowth.ts](src/web/growth/coreGrowth.ts) | 145 | 自我净化与生长页（REQ-009 / P14）接真内核：优化/调度动作审计真写 storage 账本 | coreGrowthAudit(fn), coreLoadGrowthAudit(fn), coreLoadGrowthConfig(fn), coreSaveGrowthConfig(fn), coreRunGrowthRegression(fn), coreRunEvolution(fn), RegressionReceipt(type), EvolutionRunReceipt(type) |
| [src/web/growth/evolutionTimeline.ts](src/web/growth/evolutionTimeline.ts) | 243 | M4（收尾）：进化时间线 + 参数漂移仪表 的纯数据层。 | evolutionTimelineFromLedger(fn), rollbackStateOf(fn), driftRows(fn), recallDrift(fn), dedupDrift(fn), thresholdDrift(fn), RECALL_LABELS(const), DEDUP_LABELS(const), THRESHOLD_LABELS(const), EvolutionTimelineEntry(type), RollbackStateView(type), DriftRow(type), TimelineDecision(type), RollbackState(type) |
| [src/web/growth/growthEntry.tsx](src/web/growth/growthEntry.tsx) | 11 | 自我净化与生长页（REQ-009 / P14）入口 | — |
| [src/web/growth/logic.ts](src/web/growth/logic.ts) | 139 | P14 纯逻辑（T2）：五维加权 / 逐层阈值 / 短路嫁接 / 优化评估 / Δ 收益 / 调度校验 / 审计 | weightedScore(fn), layerThresholdOf(fn), isDuplicate(fn), validateWeights(fn), validateThresholds(fn), shortCircuitPath(fn), evaluateOptimizations(fn), growthDelta(fn), appendTunedPoint(fn), validateSchedule(fn), auditOptimization(fn) |
| [src/web/growth/recallLabels.ts](src/web/growth/recallLabels.ts) | 253 | 全站 UI「人话名」唯一真源（2026-11-14 用户硬性要求：UI 不出原始字段名 / JSON / 英文枚举）。 | fmtRecallWeights(fn), monitorText(fn), monitorGroupText(fn), monitorValueText(fn), monitorMetricKeys(fn), RECALL_KEY_LABEL(const), MONITOR_METRIC_TEXT(const), MONITOR_GROUP_TEXT(const), MonitorText(type) |
| [src/web/growth/spec.ts](src/web/growth/spec.ts) | 41 | 自我净化与生长页规格常量（非演示数据）：五维默认权重 / 逐层阈值 / 标签 / 调度。 | DEFAULT_WEIGHTS(const), DEFAULT_THRESHOLDS(const), DIM_LABELS(const), LAYERS(const), OPT_CONDITIONS(const), DEFAULT_SCHEDULE(const) |
| [src/web/growth/types.ts](src/web/growth/types.ts) | 187 | P14 自我净化与生长页（REQ-009 6.1/6.2/7.1/7.2/13.3）数据模型 | DedupSample(type), ShortCircuitStep(type), GrowthMetrics(type), OptimizationItem(type), ScheduleItem(type), ScheduleRunInfo(type), RegressionOutcome(type), RegressionRecord(type), GrowthReceipt(type), DeltaPoint(type), RecallSuggestionView(type), FeedbackSignalView(type), GrowthAuditEntry(type), OptState(type), DeltaMetric(type) |
| [src/web/growth/useGrowthMirror.ts](src/web/growth/useGrowthMirror.ts) | 11 | 自我净化与生长页后端镜像：growth_op 动作审计上抛（G6 fire-and-forget）。 | useGrowthMirror(fn) |
| [src/web/growth/useGrowthReal.ts](src/web/growth/useGrowthReal.ts) | 506 | 自我净化与生长页（REQ-009 / P14）· 真实数据接真层 | samplesFromMemories(fn), metricsFromLedger(fn), dedupStatsFromLedger(fn), deltaSeriesFromLedger(fn), scheduleReal(fn), regressionOutcomeFromLedger(fn), regressionRecordsFromLedger(fn), recallSuggestionFromLedger(fn), feedbackSignalFromLedger(fn), scheduleRunsFromLedger(fn), loadRealGrowthData(fn), GROWTH_REAL_DATA_SOURCE(const), RealGrowth(type), RealStorage(type) |
| [src/web/growth/useToast.tsx](src/web/growth/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/hostLlm.ts](src/web/hostLlm.ts) | 162 | 批次31 建 / 批次32 多引擎化：渲染层 LLM Provider —— 内核写路径的逐层精炼经 llm:refine IPC 代理主进程网关。 | engineBillingOf(fn), hostLlmAvailable(fn), refreshHostLlmSnapshot(fn), refreshHostLlmSnapshotOnce(fn), applyHostLlmSnapshot(fn), getHostLlmSnapshot(fn), setHostProxyAccounting(fn), getHostProxyAccounting(fn), isLocalBase(fn), createHostLlm(fn), LlmEngineView(type), LlmPresetView(type), LlmGatewaySnapshot(type) |
| [src/web/httpStorage.ts](src/web/httpStorage.ts) | 116 | 批次28-A：浏览器内核数据面 —— StorageBackend 的 HTTP 透传实现。 | fetchKernelInfo(fn), KernelUnavailableError(class), HttpStorageBackend(class), HttpStorageOptions(type), KernelInfo(type) |
| [src/web/kernel.ts](src/web/kernel.ts) | 250 | 统一内核接入口：全部页面共用同一份账本（唯一真相源）。 | getTenant(fn), bindTenant(fn), syncTenantFromHost(fn), kernelAccount(fn), setKernelStorageForTests(fn), getKernelStorage(fn), rebuildKernelForDataPlane(fn), setKernelL0ForTests(fn), getKernelWithSeed(fn), getKernel(fn), createKernelOnSameStorage(fn), rebuildKernelFromModelConfig(fn), resetKernelForTests(fn), newRequestId(fn), KERNEL_FORM(const), KernelTenant(type), KernelOverrides(type) |
| [src/web/lifecycle/LifecycleCard.tsx](src/web/lifecycle/LifecycleCard.tsx) | 51 | 生命周期页（REQ-006 / P4）状态查看器（T3） | LifecycleCard(fn) |
| [src/web/lifecycle/LifecyclePage.tsx](src/web/lifecycle/LifecyclePage.tsx) | 491 | 生命周期页（REQ-006 / P4）· 2026-11-22 按真实使用场景重排 | LifecyclePage(fn) |
| [src/web/lifecycle/ParamPanel.tsx](src/web/lifecycle/ParamPanel.tsx) | 75 | 生命周期页（REQ-006 / P4）调参面板（T4） | ParamPanel(fn) |
| [src/web/lifecycle/constants.ts](src/web/lifecycle/constants.ts) | 4 | 生命周期阈值常量（9.10.1）。列表数据真相 = 内核账本，无演示记忆。 | N_DAYS(const), M_DAYS(const) |
| [src/web/lifecycle/coreLifecycle.ts](src/web/lifecycle/coreLifecycle.ts) | 143 | 生命周期页（REQ-006 / P4）接真内核：迁移/调参/批量统一走 ma._memoryOp | toLifecycleRecord(fn), coreListLifecycle(fn), coreLifeOp(fn), DECAY_TO_STATUS(const), STATUS_TO_DECAY(const) |
| [src/web/lifecycle/lifecycleEntry.tsx](src/web/lifecycle/lifecycleEntry.tsx) | 12 | 生命周期页（REQ-010 / P4）入口：挂载 LifecyclePage。 | — |
| [src/web/lifecycle/lifecycleFilter.ts](src/web/lifecycle/lifecycleFilter.ts) | 19 | 生命周期页（REQ-006 / P4）· 分页纯逻辑 | pagedList(fn), LIFECYCLE_DEFAULT_PAGE_SIZE(const), LIFECYCLE_PAGE_SIZES(const), LifecyclePageSize(type) |
| [src/web/lifecycle/logic.ts](src/web/lifecycle/logic.ts) | 92 | 生命周期页（REQ-006 / P4）纯逻辑层 | freshnessPreview(fn), canMigrate(fn), importanceLevel(fn), staleCheck(fn), applyLifecycle(fn), STATUS_FLOW(const) |
| [src/web/lifecycle/types.ts](src/web/lifecycle/types.ts) | 48 | 生命周期页（REQ-006 / P4）数据模型 | LifecycleRecord(type), OpResult(type), MemoryStatus(type), DecayClass(type), LifeOp(type) |
| [src/web/lifecycle/useLifecycleMirror.ts](src/web/lifecycle/useLifecycleMirror.ts) | 14 | 生命周期页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useLifecycleMirror(fn), LifecycleMirror(type) |
| [src/web/lifecycle/useToast.tsx](src/web/lifecycle/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/login/LoginPage.tsx](src/web/login/LoginPage.tsx) | 275 | 登录页（D7）：常规桌面登录形态（应用标识 + 账号 + 密码 + 登录按钮），走真实 POST /api/login。 | LoginPage(fn) |
| [src/web/login/loginEntry.tsx](src/web/login/loginEntry.tsx) | 18 | 登录页入口（login.html）：真实 /api/login，会话写入 localStorage（session:realpage）。 | — |
| [src/web/logs/LogCards.tsx](src/web/logs/LogCards.tsx) | 327 | REQ-011 T3 日志列表（§2.2）+ 异常聚合卡（§2.3）+ 审计 modal（R-LOG6，按 request_id 真查内核账本）+ L0 授权卡（§2.4） | LogTable(fn), ErrorAggr(fn), AuditModal(fn), L0AuthCard(fn), LogTableProps(type), L0AuthCardProps(type) |
| [src/web/logs/LogFilterBar.tsx](src/web/logs/LogFilterBar.tsx) | 74 | REQ-011 T3 过滤区（§2.1 六维）· p0 版式 | LogFilterBar(fn) |
| [src/web/logs/LogsPage.tsx](src/web/logs/LogsPage.tsx) | 212 | 日志记录页（REQ-011 / P15）· 定稿版式：级别过滤 + 异常聚合 6 类 + L0 授权跳转 + 行内详情 | LogsPage(fn) |
| [src/web/logs/coreLogs.ts](src/web/logs/coreLogs.ts) | 66 | 日志记录页（REQ-011 / P15）接真内核：审计流存内核 InMemoryStorage（append-only）， | coreLoadLogs(fn), coreAuditChain(fn), coreL0Browse(fn) |
| [src/web/logs/labels.ts](src/web/logs/labels.ts) | 18 | 日志页展示标签（规格常量）。日志数据真相 = 内核审计账本，无演示日志。 | ACTION_LABEL(const), FORM_LABEL(const) |
| [src/web/logs/logic.ts](src/web/logs/logic.ts) | 182 | 日志记录页（REQ-011 / P15）纯逻辑层 | ensureRequestId(fn), classifyError(fn), aggrErrors(fn), aggrErrorsAll(fn), unclassifiedErrors(fn), filterLogs(fn), l0Precheck(fn), l0Record(fn), canDeleteAudit(fn), ERROR_TARGET(const), ERROR_TARGET_ROUTE(const), L0_MAX_FAIL(const), L0_LOCK_MS(const), L0_MIN_LEN(const), ErrorTargetRoute(type), ErrorAggrItem(type) |
| [src/web/logs/logsEntry.tsx](src/web/logs/logsEntry.tsx) | 11 | 日志记录页（REQ-011 / P15）入口 | — |
| [src/web/logs/types.ts](src/web/logs/types.ts) | 52 | 日志记录页（REQ-011 / P15）数据模型 | LogEntry(type), LogFilter(type), L0State(type), LogLevel(type), LogForm(type), LogAction(type), ErrorKind(type) |
| [src/web/logs/useToast.tsx](src/web/logs/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/main.tsx](src/web/main.tsx) | 19 | 概览页入口（index.html）：批次57-B 按 Stratum A 版式整页重做（总览工作台），替换旧 .ovx 首页。 | — |
| [src/web/mcp/McpPage.tsx](src/web/mcp/McpPage.tsx) | 178 | MCP 接入页（2026-11-21 新增；2026-11-22 按真实使用场景重排） | McpPage(fn) |
| [src/web/mcp/mcpEntry.tsx](src/web/mcp/mcpEntry.tsx) | 11 | MCP 接入页入口（2026-11-21）：独立页面挂载点。 | — |
| [src/web/memory/LayerFilterBar.tsx](src/web/memory/LayerFilterBar.tsx) | 130 | 记忆层级管理页（19.11）· 每层 L0-L6 过滤栏 + 分页控件 | LayerFilterBar(fn), LayerPager(fn) |
| [src/web/memory/LayerMemoryTable.tsx](src/web/memory/LayerMemoryTable.tsx) | 179 | 层级管理页每层内的记忆表格（带可拖拽表头列宽） | LayerMemoryTable(fn) |
| [src/web/memory/MemoryActions.tsx](src/web/memory/MemoryActions.tsx) | 80 | 记忆管理页（REQ-006 / P8）操作区（T4） | MemoryActions(fn) |
| [src/web/memory/MemoryDrawer.tsx](src/web/memory/MemoryDrawer.tsx) | 160 | 记忆管理页详情/编辑抽屉（T5） | MemoryDrawer(fn) |
| [src/web/memory/MemoryLayeredPage.tsx](src/web/memory/MemoryLayeredPage.tsx) | 904 | 记忆层级管理页（REQ-006 / P8 · 19.11） | MemoryLayeredPage(fn), LayerId(type) |
| [src/web/memory/MemoryManagementPage.tsx](src/web/memory/MemoryManagementPage.tsx) | 1089 | 记忆管理统一视图（批次57 精简六页签）：全部记忆 / 活跃 / 休眠 / 归档 / 弃用 / 分层 L1–L6 + 9 列账本 + 分层策略。 | MemoryGrid(fn), MemoryManagementPage(fn), COL_WIDTHS_DEFAULT(const), COL_WIDTHS_KEY(const) |
| [src/web/memory/MemoryPage.tsx](src/web/memory/MemoryPage.tsx) | 177 | 记忆库管理页（REQ-006 / P8）· 完整编排（T5） | MemoryPage(fn) |
| [src/web/memory/MemoryRow.tsx](src/web/memory/MemoryRow.tsx) | 80 | 记忆管理页（REQ-006 / P8）单行（T3） | MemoryRow(fn) |
| [src/web/memory/MemoryTable.tsx](src/web/memory/MemoryTable.tsx) | 255 | 记忆管理页（REQ-006 / P8）列表（T3）+ 过滤 + 分页 + 可拖拽列宽 | MemoryTable(fn), TYPE_OPTIONS(const), STATUS_OPTIONS(const), SOURCE_OPTIONS(const), MemoryTableFilterState(type), PageSize(type) |
| [src/web/memory/PersonalMemoryPane.tsx](src/web/memory/PersonalMemoryPane.tsx) | 369 | 个人记忆双窗（第一轮本机闭环 + 第二轮跨端同步）：左「已确认」/ 右「收件箱」。 | PersonalMemoryPane(fn), PersonalPaneProps(type) |
| [src/web/memory/backup.ts](src/web/memory/backup.ts) | 114 | 记忆库管理页 · 自动备份（P8 扩展）：渲染层经 hostCall 走 preload IPC 调主进程备份能力。 | backupAvailable(fn), backupGetConfig(fn), backupSaveConfig(fn), backupChooseDir(fn), backupRunNow(fn), backupList(fn), BACKUP_KIND_LABEL(const), BackupConfigView(type), BackupItem(type), BackupRunReceipt(type), BackupKind(type), BackupOpResult(type) |
| [src/web/memory/coreMemoryOps.ts](src/web/memory/coreMemoryOps.ts) | 416 | 记忆管理页（REQ-006 / P8）接真内核：17.3 九操作统一走 ma._memoryOp。 | getStorage(fn), deriveMemoryStatus(fn), toRecord(fn), coreApplyOp(fn), storageLocation(fn), openMemoryFile(fn), coreListMemories(fn), loadAgentMemoryCandidates(fn), splitAgentIngest(fn), coreLayerPolicy(fn), coreUpdateContent(fn), coreBrowse(fn), AgentMemoryCandidate(type), AgentIngestSplit(type), LayerPolicySnapshot(type), DerivedMemoryStatus(type) |
| [src/web/memory/dataRoot.ts](src/web/memory/dataRoot.ts) | 89 | 数据存放位置（批次6）：记忆库/采集游标/日志/MCP 令牌/备份配置等全部数据挂在用户选定目录。 | dataRootAvailable(fn), getDataRoot(fn), openDataRoot(fn), changeDataRoot(fn), restoreDefaultDataRoot(fn), AuditLogInfo(type), DataRootInfo(type), DataRootChangeResult(type) |
| [src/web/memory/layerFilter.ts](src/web/memory/layerFilter.ts) | 60 | 记忆层级管理页（19.11）· 每层 L0-L6 的过滤 + 分页纯逻辑 | initialLayerSource(fn), filterLayerPaged(fn), LAYER_DEFAULT_PAGE_SIZE(const), LAYER_PAGE_SIZES(const), LAYER_DEFAULT_FILTER(const), LayerFilterState(type) |
| [src/web/memory/logic.ts](src/web/memory/logic.ts) | 107 | 记忆管理页（REQ-006 / P8）纯逻辑层 | decayClass(fn), sortMemories(fn), summarizeContent(fn), applyOp(fn), OP_TOAST(const) |
| [src/web/memory/memoryEntry.tsx](src/web/memory/memoryEntry.tsx) | 11 | 记忆管理页入口：六标签统一视图（全部 / 个人 / 分层 / 冲突 / 待重放 / L0）。 | — |
| [src/web/memory/memoryFilter.ts](src/web/memory/memoryFilter.ts) | 123 | 记忆管理页（REQ-006 / P8）· 过滤 + 分页纯逻辑 | parseStatusParam(fn), initialMemoryFilter(fn), isCollected(fn), filterMemories(fn), filterAndPaged(fn), MEMORY_STATUS_VALUES(const), MemoryFilter(type) |
| [src/web/memory/memoryLayeredEntry.tsx](src/web/memory/memoryLayeredEntry.tsx) | 11 | 记忆层级管理页入口（REQ-006 / P8 · 19.11） | — |
| [src/web/memory/personalEntry.tsx](src/web/memory/personalEntry.tsx) | 40 | 个人记忆独立页入口（批次57）：记忆库页签精简后 PersonalMemoryPane 的新宿主。 | PersonalMemoryStandalonePage(fn) |
| [src/web/memory/types.ts](src/web/memory/types.ts) | 98 | 记忆管理页（REQ-006 / P8）数据模型 | MemoryRecord(type), OpResult(type), MemoryStoreLocation(type), MemoryStatus(type), DecayClass(type), MemoryType(type), MemoryOp(type) |
| [src/web/memory/useMemoryMirror.ts](src/web/memory/useMemoryMirror.ts) | 19 | 记忆管理页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useMemoryMirror(fn), MemoryMirror(type) |
| [src/web/memory/useToast.tsx](src/web/memory/useToast.tsx) | 22 | 轻量 toast hook（T5）：返回展示节点与 show(msg) | useToast(fn) |
| [src/web/mirrorClient.ts](src/web/mirrorClient.ts) | 101 | REQ-006 端壳 mirror 客户端（G6 审计上抛）：fire-and-forget，失败可观测。 | mirrorBackendUrl(fn), getLastMirrorFailure(fn), resetMirrorFailures(fn), subscribeMirrorFailure(fn), mirrorReport(fn), mirrorFetch(fn) |
| [src/web/models/BillingPanel.tsx](src/web/models/BillingPanel.tsx) | 211 | 批次48 A31-c/A31-d：模型页「厂商余额与手工兜底」面板。 | BillingPanel(fn), ManualPatch(type) |
| [src/web/models/LlmUsageTable.tsx](src/web/models/LlmUsageTable.tsx) | 113 | P13-T3 LLM 四用途表：本地/网络复选 + 端点/Key 脱敏槽 + 温度 + 超时 + fallback 恒开（R1/R2/R3/R4） | LlmUsageTable(fn) |
| [src/web/models/ModelsPage.tsx](src/web/models/ModelsPage.tsx) | 506 | 大模型配置页（REQ-009 / P13）T4 编排 | ModelsPage(fn) |
| [src/web/models/ProxyPanel.tsx](src/web/models/ProxyPanel.tsx) | 180 | P13-T3 反代理面板：来源映射表 + 来源单选 + auto/manual 模式 + price_cap/cost_cap/预算条（19.8 / R7–R12） | ProxyPanel(fn), ProxyState(type) |
| [src/web/models/VectorCard.tsx](src/web/models/VectorCard.tsx) | 104 | P13-T3 向量模型卡：切换联动 dims/deploy；换维度需保存后按新维度重建（R5）。 | VectorCard(fn) |
| [src/web/models/catalog.ts](src/web/models/catalog.ts) | 34 | P13 大模型配置页：规格常量（向量模型 + 四用途默认参数）。 | defaultUsage(fn), VECTOR_MODELS(const), DEFAULT_VECTOR_KEY(const), USAGE_KEYS(const), USAGE_LABELS(const), DEFAULT_USAGES(const) |
| [src/web/models/coreModels.ts](src/web/models/coreModels.ts) | 285 | 大模型配置页（REQ-009 / P13）接真内核： | coreLoadSources(fn), coreVectorCount(fn), coreSimulateAuto(fn), coreLoadProxyCaps(fn), coreSaveProxyCaps(fn), coreSaveConfig(fn), coreVectorProbe(fn), coreAuditTail(fn), SimulateOutcome(type), SaveConfigOutcome(type), VectorProbeResult(type) |
| [src/web/models/logic.ts](src/web/models/logic.ts) | 126 | P13 纯逻辑（T2）：向量模型信息 / Key 脱敏 / 用途校验 / 反代理择优与审计 | vectorInfo(fn), maskKey(fn), rebuildEta(fn), validateUsage(fn), proxyBudgetOf(fn), remainingOf(fn), proxyEligible(fn), validatePriceCap(fn), autoPick(fn), manualPick(fn), auditProxy(fn), FALLBACK_ALWAYS_ON(const), ProxyPick(type) |
| [src/web/models/modelConfig.ts](src/web/models/modelConfig.ts) | 145 | 模型配置真落盘（Phase C3）：向量模型/维度是内核构造参数，保存后必须参与 getKernel 装配。 | tenantStorageKey(fn), readModelConfig(fn), writeModelConfig(fn), configuredVectorDim(fn), sanitizeUsages(fn), hydrateUsages(fn), clearModelConfig(fn), ModelConfig(type), PersistedUsage(type) |
| [src/web/models/modelsEntry.tsx](src/web/models/modelsEntry.tsx) | 11 | 大模型配置页（REQ-009 / P13）入口 | — |
| [src/web/models/types.ts](src/web/models/types.ts) | 71 | P13 大模型配置页（REQ-009 13.2 / 19.8）数据模型 | VectorModelInfo(type), UsageConfig(type), ProxySource(type), ProxyCallAuditEntry(type), ModelConfigAuditEntry(type), VectorModelKey(type), LlmUsage(type), ProxyTier(type), ProxySelectMode(type), ProxyAuditEntry(type) |
| [src/web/models/useToast.tsx](src/web/models/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/monitor/AlertTimeline.tsx](src/web/monitor/AlertTimeline.tsx) | 65 | P6-T3 告警时间线（12.2 · 批次49 起 af-tl 版式：tm 时间 + b 标题 + af-note af-mono 元信息行） | AlertTimeline(fn) |
| [src/web/monitor/MetricGrid.tsx](src/web/monitor/MetricGrid.tsx) | 58 | P6-T3 指标卡网格（12.1：8 组 20 卡 · 批次49 起 af-panel 版式，收进页面「全部指标」折叠） | MetricGrid(fn) |
| [src/web/monitor/MonitorPage.tsx](src/web/monitor/MonitorPage.tsx) | 183 | 监控告警页（REQ-006 / P6 · 批次49 起 1:1 对齐设计真源 stratum-a-full.html pg-monitor 段）： | MonitorPage(fn) |
| [src/web/monitor/coreMonitor.ts](src/web/monitor/coreMonitor.ts) | 39 | 监控仪表盘（REQ-006 / P6）接真内核：告警时间线读真实账本（action='monitor_alert'，只读回放，不再灌种子）。 | coreLoadAlerts(fn), coreRaiseAlert(fn) |
| [src/web/monitor/logic.ts](src/web/monitor/logic.ts) | 47 | 监控仪表盘（REQ-006 / P6）纯逻辑层 | evalLevel(fn), inWindow(fn), filterAlerts(fn), groupMetrics(fn), percentile(fn), levelBadge(fn) |
| [src/web/monitor/monitorEntry.tsx](src/web/monitor/monitorEntry.tsx) | 12 | 监控仪表盘（REQ-006 / P6）入口（T1 壳） | — |
| [src/web/monitor/operationState.ts](src/web/monitor/operationState.ts) | 171 | REQ-013 / C5：异步操作真实状态机（借鉴 dsh-hindsight 的 operation 状态语义）。 | classifyOperationOutcome(fn), isTerminal(fn), shouldKeepPolling(fn), nextPollDelay(fn), operationLabel(fn), summarizeOperations(fn), operationEntriesFromAudits(fn), operationStatusFromAudits(fn), pollOperationUntilTerminal(fn), OPERATION_ACTION_SPECS(const), OperationEntry(type), OperationStatus(type) |
| [src/web/monitor/options.ts](src/web/monitor/options.ts) | 28 | 监控页宿主 Agent 筛选选项（批次48 A25：只由真实账本派生，不内置占位 agent 名）。 | agentOptionsFromLedger(fn), ALL_AGENTS_OPTION(const) |
| [src/web/monitor/types.ts](src/web/monitor/types.ts) | 38 | 监控仪表盘（REQ-006 / P6）数据模型 | MetricCard(type), AlertItem(type), MonitorFilter(type), AlertLevel(type) |
| [src/web/monitor/useMonitorMirror.ts](src/web/monitor/useMonitorMirror.ts) | 13 | 监控仪表盘后端镜像：挂载视图上抛（G6 fire-and-forget，monitor_view）。 | useMonitorMirror(fn) |
| [src/web/monitor/useMonitorReal.ts](src/web/monitor/useMonitorReal.ts) | 482 | 监控仪表盘（REQ-006 / P6）· 真实数据接真层 | percentile(fn), applyMonitorStats(fn), applyMonitorOps(fn), metricsFromLedger(fn), summaryFromLedger(fn), realLoadAlerts(fn), loadRealMonitorData(fn), MONITOR_REAL_DATA_SOURCE(const), MonitorStats(type), MonitorOps(type), SummaryStat(type), RealMonitor(type), RealStorage(type) |
| [src/web/monitor/useToast.tsx](src/web/monitor/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/overview/McpSwitchAlert.tsx](src/web/overview/McpSwitchAlert.tsx) | 65 | 首页「客户端 MCP 开关」提示条（T3 展示层 · 落点①）。 | McpSwitchAlert(fn), McpSwitchAlertProps(type) |
| [src/web/overview/Overview.tsx](src/web/overview/Overview.tsx) | 136 | REQ-003 + REQ-005 配合展示（通览演示页） | Overview(fn) |
| [src/web/overview/OverviewPage.tsx](src/web/overview/OverviewPage.tsx) | 844 | 首页总览工作台（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-home）： | deriveHomeView(fn), OverviewPage(fn), HomeDerived(type) |
| [src/web/overview/overviewEntry.tsx](src/web/overview/overviewEntry.tsx) | 20 | REQ-003 + REQ-005 通览演示页入口 | — |
| [src/web/overview/overviewPageData.ts](src/web/overview/overviewPageData.ts) | 148 | 问账本（壳层「记忆助手」复用）：只转述真实账本快照能证实的内容，不编造模型回答。 | answerOverviewQuestion(fn), OVERVIEW_SUGGESTIONS(const), OverviewAnswer(type) |
| [src/web/params/AppShellCard.tsx](src/web/params/AppShellCard.tsx) | 170 | 阶段 A · 参数页「后台常驻」卡片：托盘常驻 + 开机自启两个二选一开关。 | AppShellCard(fn) |
| [src/web/params/DevPanel.tsx](src/web/params/DevPanel.tsx) | 94 | P5-T3 开发者模式（折叠面板，暴露底层参数；2.4.3 / 2.4.1 / 15.3 / 9.10 / 15.1） | DevPanel(fn) |
| [src/web/params/KbManagementCard.tsx](src/web/params/KbManagementCard.tsx) | 307 | 全局参数页（REQ-006 / P5）· 记忆库管理卡片 | KbManagementCard(fn) |
| [src/web/params/KbPolicyTable.tsx](src/web/params/KbPolicyTable.tsx) | 40 | P5-T3 知识库策略表（17.6 六类）—— 阶段5-E / B9：内核 policyFor() 的只读镜像。 | KbPolicyTable(fn) |
| [src/web/params/LlmEngineCard.tsx](src/web/params/LlmEngineCard.tsx) | 312 | 全局参数页 · LLM 精炼引擎卡片（批次31 建 / 批次32 多引擎化）：任意多家 OpenAI 兼容引擎（预设快选或自定义）， | LlmEngineCard(fn) |
| [src/web/params/NormalConfigCard.tsx](src/web/params/NormalConfigCard.tsx) | 141 | P5-T3 普通配置卡（17.6 文案化，G7 不暴露参数名） | NormalConfigCard(fn) |
| [src/web/params/ParamsPage.tsx](src/web/params/ParamsPage.tsx) | 348 | 全局参数页（REQ-006 / P5）T4 编排 | ParamsPage(fn) |
| [src/web/params/RecallHardCard.tsx](src/web/params/RecallHardCard.tsx) | 371 | 批次62 · 参数页「硬前置召回」卡片：A 宿主钩子 / B 内置 LLM 网关 / C MCP 内核门禁。 | RecallHardCard(fn) |
| [src/web/params/RefineQueueCard.tsx](src/web/params/RefineQueueCard.tsx) | 230 | 参数页 · L2–L6 后台补炼队列卡（批次39）。 | RefineQueueCard(fn) |
| [src/web/params/SyncTeamCard.tsx](src/web/params/SyncTeamCard.tsx) | 49 | 参数页「同步与团队」只读卡（批次63）。 | SyncTeamCard(fn) |
| [src/web/params/appShell.ts](src/web/params/appShell.ts) | 64 | 阶段 A · 参数页两个开关（托盘常驻 / 开机自启）的渲染层桥。 | appShellAvailable(fn), appShellState(const), appShellSet(const), AppShellStateView(type), AppShellPatch(type), AppShellResult(type) |
| [src/web/params/coreParams.ts](src/web/params/coreParams.ts) | 104 | 全局参数页（REQ-006 / P5）接真内核：参数快照存内核 preference 记忆（params:v1: JSON， | coreLoadParams(fn), coreSaveParams(fn) |
| [src/web/params/defaults.ts](src/web/params/defaults.ts) | 77 | 全局参数页默认值与展示标签（规格常量；用户保存后以内核 preference 快照为真相）。 | kernelKbPolicies(fn), DEFAULT_CONFIG(const), SPEED_LABEL(const), RETENTION_LABEL(const), IMPORTANCE_LABEL(const), CATEGORY_LABEL(const), DEFAULT_KB_POLICIES(const), DEFAULT_DEV(const), LEVEL_MAPPING(const) |
| [src/web/params/llmEngine.ts](src/web/params/llmEngine.ts) | 83 | 全局参数页 · LLM 精炼引擎桥（批次31 建 / 批次32 多引擎化）：渲染层经宿主桥走 llm:* IPC 调主进程网关。 | llmEngineAvailable(fn), llmGetConfig(fn), llmSaveConfig(fn), llmTestEngine(fn), LlmEnginePatch(type), LlmConfigPatch(type), LlmTestResult(type) |
| [src/web/params/logic.ts](src/web/params/logic.ts) | 89 | 全局参数页（REQ-006 / P5）纯逻辑层 | speedToHalfLife(fn), retentionToArchive(fn), validateWeights(fn), payloadOrdered(fn), validateKbRow(fn), validateNM(fn), validateUnitPrice(fn), validateProxyQuota(fn), validateAll(fn), auditParams(fn) |
| [src/web/params/paramsEntry.tsx](src/web/params/paramsEntry.tsx) | 11 | 全局参数页（REQ-006 / P5）入口 | — |
| [src/web/params/recallHard.ts](src/web/params/recallHard.ts) | 82 | 批次62 · 硬前置召回 A/B/C 三层开关的渲染层桥。 | recallHardAvailable(fn), recallHardState(const), recallHardSet(const), RecallHardStateView(type), RecallHardResult(type) |
| [src/web/params/refineQueue.ts](src/web/params/refineQueue.ts) | 147 | 批次39 · L2–L6 后台补炼队列的渲染层桥：状态读（需会话）/ 开关与补炼与重试失败行（仅管理员）。 | refineStopRows(fn), refineQueueAvailable(fn), REFINE_STOP_LABELS(const), refineStopLabel(const), refineQueueState(const), refineQueueSetEnabled(const), refineQueueBackfill(const), refineQueueRetryFailed(const), refineQueueSetCap(const), RefineQueueSummary(type), RefineQueueView(type), RefineEnqueueReport(type), RefineResult(type) |
| [src/web/params/types.ts](src/web/params/types.ts) | 45 | 全局参数页（REQ-006 / P5）数据模型 | NormalConfig(type), KbPolicyRow(type), DevParams(type), ForgetSpeed(type), Retention(type), ImportanceLevel(type) |
| [src/web/params/useParamsMirror.ts](src/web/params/useParamsMirror.ts) | 19 | 全局参数页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useParamsMirror(fn), ParamsMirror(type) |
| [src/web/params/useToast.tsx](src/web/params/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/retrieval/AuditTrailCard.tsx](src/web/retrieval/AuditTrailCard.tsx) | 56 | 检索页「审计链路上下文」卡（阶段5-A / A15 接线）。 | AuditTrailCard(fn) |
| [src/web/retrieval/BudgetPanel.tsx](src/web/retrieval/BudgetPanel.tsx) | 153 | REQ-012 T5 右侧栏三块：Token 预算（R9 三档 + 分段量表）· 召回漏斗 · 裁剪明细。 | TokenBudgetCard(fn), FunnelCard(fn), TrimCard(fn), BudgetPanel(fn) |
| [src/web/retrieval/ContextPanel.tsx](src/web/retrieval/ContextPanel.tsx) | 61 | REQ-012 T5 命中上下文（§4）：片段 → 关联记忆 → 参数（只读）→ 跳转。 | ContextPanel(fn) |
| [src/web/retrieval/ModeBanner.tsx](src/web/retrieval/ModeBanner.tsx) | 76 | REQ-012 T5 生效横幅（§2）：一条蓝色场景带 —— 场景徽标 + 该场景的硬口径（重排/预算/纪律）， | ModeBanner(fn) |
| [src/web/retrieval/QueryBar.tsx](src/web/retrieval/QueryBar.tsx) | 160 | REQ-012 T3 查询条（定稿）：查询行「输入 + 场景 + 项目 + 检索」+ 模式行（胶囊）+ 预算/深度紧凑项。 | QueryBar(fn), DEPTH_OPTIONS(const), QueryBarValue(type) |
| [src/web/retrieval/RecentRecallsCard.tsx](src/web/retrieval/RecentRecallsCard.tsx) | 77 | 检索页右侧栏「最近召回」：直接读账本 recall 审计行（时间 / query 摘要 / 命中 / 注入 t）， | fmtClock(fn), RecentRecallsCard(fn), RecentPhase(type) |
| [src/web/retrieval/ResultList.tsx](src/web/retrieval/ResultList.tsx) | 61 | REQ-012 T4 结果列表（定稿结果行）：分数 + 正文/元信息 + 行内操作；Top 5 默认，加载更多至 10。 | ResultList(fn) |
| [src/web/retrieval/ResultRow.tsx](src/web/retrieval/ResultRow.tsx) | 77 | REQ-012 T4 结果行（定稿·紧凑版）：分数徽标 + 命中正文（默认一行）+ 元信息（id · 温度 · 新鲜/重要/置信） | ResultRow(fn) |
| [src/web/retrieval/RetrievalPage.tsx](src/web/retrieval/RetrievalPage.tsx) | 492 | 检索页（REQ-012）· 定稿三标签：检索工作台 / 历史查询 / 规则 | RetrievalPage(fn) |
| [src/web/retrieval/coreEngine.ts](src/web/retrieval/coreEngine.ts) | 338 | REQ-012 接真内核引擎（T7）：与 fakeEngine 同签名（async），内部走 memagent-core ma.recall | coreReorderMemory(fn), coreEngine(fn), coreLastRecall(fn), coreRecentRecalls(fn), beijingDayStart(fn), coreRecallHistory(fn), ALL_PROJECTS_SCOPE(const), EngineResult(type), EngineOptions(type), LastRecallSnapshot(type) |
| [src/web/retrieval/logic.ts](src/web/retrieval/logic.ts) | 142 | 检索页（REQ-012）纯逻辑层 | modeName(fn), sceneName(fn), sceneLabel(fn), modeLabel(fn), normalizeScene(fn), normalizeMode(fn), resolveSceneBudget(fn), resolveModeLinkage(fn), isMinimalCandidate(fn), sortHits(fn), freshness(fn), decayClass(fn), budgetLevel(fn), approxTokens(fn), validateQuery(fn) |
| [src/web/retrieval/retrievalEntry.tsx](src/web/retrieval/retrievalEntry.tsx) | 12 | 检索页（REQ-012）入口 | — |
| [src/web/retrieval/types.ts](src/web/retrieval/types.ts) | 120 | 检索页（REQ-012）数据模型 | RetrievalHit(type), SceneBudget(type), ModeBannerData(type), BudgetData(type), RecallHistoryRow(type), RecentRecallRow(type), Scene(type), Mode(type), ModeSel(type), PageState(type), DecayClass(type), BudgetLevel(type) |
| [src/web/retrieval/useRetrieval.ts](src/web/retrieval/useRetrieval.ts) | 64 | REQ-012 T6 状态机 hook（§0/§6）：IDLE→LOADING→RESULT/EMPTY/ERROR；二次查询保留 session，request_id 每次新生成（R7/§7.6）。 | useRetrieval(fn), RetrievalState(type), Phase(type) |
| [src/web/retrieval/useToast.tsx](src/web/retrieval/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/security/AccountAdminCard.tsx](src/web/security/AccountAdminCard.tsx) | 164 | 管理员账号卡片（批次7）：账号列表 / 角色切换 / 团队分配 / 修改我的密码。 | AdminAccountCard(fn) |
| [src/web/security/FieldBackfillCard.tsx](src/web/security/FieldBackfillCard.tsx) | 210 | 安全页 · 存量字段回填卡（批次41-T） | FieldBackfillCard(fn) |
| [src/web/security/L0AdminCard.tsx](src/web/security/L0AdminCard.tsx) | 386 | 账号与安全页 · L0 密钥环管理卡（§4.4） | L0AdminCard(fn) |
| [src/web/security/L0FilteredCard.tsx](src/web/security/L0FilteredCard.tsx) | 194 | 安全页 · L0 拦截记录卡（L0-first，2026-11-17 用户拍板） | L0FilteredCard(fn), FilteredItem(type) |
| [src/web/security/L0MigrateCard.tsx](src/web/security/L0MigrateCard.tsx) | 127 | 安全页 · L0 旧数据迁移卡（§4.4.6；从 L0AdminCard 里拆出来单独成卡） | L0MigrateCard(fn) |
| [src/web/security/L0OwnerBackfillCard.tsx](src/web/security/L0OwnerBackfillCard.tsx) | 178 | 存量 L0 归属回填卡（2026-11-17 用户拍板）：归属元数据上线前落的存量密文全部无 owner | L0OwnerBackfillCard(fn) |
| [src/web/security/L0RecoveryCard.tsx](src/web/security/L0RecoveryCard.tsx) | 222 | 安全页 · L0 恢复卡（批次37-G） | L0RecoveryCard(fn) |
| [src/web/security/L0SplitCard.tsx](src/web/security/L0SplitCard.tsx) | 186 | 安全页 · L0 存量拆分迁移卡（批次37-C） | L0SplitCard(fn) |
| [src/web/security/LedgerResetCard.tsx](src/web/security/LedgerResetCard.tsx) | 312 | 安全页 · 记忆库清空重采卡（批次35） | LedgerResetCard(fn) |
| [src/web/security/LegacyLedgerCard.tsx](src/web/security/LegacyLedgerCard.tsx) | 138 | 安全页 · 遗留账本清理卡（批次24） | LegacyLedgerCard(fn) |
| [src/web/security/MyWriteWrapCard.tsx](src/web/security/MyWriteWrapCard.tsx) | 145 | 成员端「本账号写密钥」卡（§4.4.4-B） | MyWriteWrapCard(fn) |
| [src/web/security/OwnerBindingsCard.tsx](src/web/security/OwnerBindingsCard.tsx) | 230 | 安全页 · 「个人记忆账号绑定」卡（OB-3）。 | OwnerBindingsCard(fn) |
| [src/web/security/PwdPolicyCard.tsx](src/web/security/PwdPolicyCard.tsx) | 62 | P12-T3 密码策略 + 实时校验（4.2） | PwdPolicyCard(fn) |
| [src/web/security/RebuildFromL0Card.tsx](src/web/security/RebuildFromL0Card.tsx) | 271 | 安全页 · 按 L0 原文重建 L1–L6 卡（批次37-E） | RebuildFromL0Card(fn) |
| [src/web/security/RulesRejudgeCard.tsx](src/web/security/RulesRejudgeCard.tsx) | 189 | 安全页 · 规则重判存量卡（批次36-C） | RulesRejudgeCard(fn) |
| [src/web/security/SecurityCards.tsx](src/web/security/SecurityCards.tsx) | 121 | P12-T3 角色矩阵（只读）+ 成员表（真实账号，只读）+ 密钥表（真实 /api/keys：轮换/吊销） | RoleMatrixCard(fn), MemberTable(fn), KeyTable(fn) |
| [src/web/security/SecurityPage.tsx](src/web/security/SecurityPage.tsx) | 826 | 账号与安全页（REQ-006 / P12）T4 编排 | SecurityPage(fn) |
| [src/web/security/TenantIdentityCard.tsx](src/web/security/TenantIdentityCard.tsx) | 197 | 安全页 · 「本机租户身份」卡（管理员与成员权限设计 §14.2，2026-11-15 用户确认新增； | TenantIdentityCard(fn) |
| [src/web/security/accountsClient.ts](src/web/security/accountsClient.ts) | 308 | 账号管理 API client（批次7）：走 home server 的管理员接口，权限由后端强制。 | fetchMyContext(fn), fetchAccounts(fn), updateAccount(fn), fetchApiKeys(fn), mintApiKey(fn), revokeApiKey(fn), fetchMirrorIntegrity(fn), resealMirrorAudit(fn), fetchPwdPolicy(fn), savePwdPolicy(fn), changeOwnPassword(fn), AccountView(type), ApiKeyRecord(type), MirrorIntegrityView(type), ResealOutcome(type), ApiResult(type) |
| [src/web/security/coreSecurity.ts](src/web/security/coreSecurity.ts) | 130 | 账号与安全页（REQ-006 / P12）接真内核：安全操作真写 storage 审计账本 | coreSecurityAudit(fn), coreLoadSecurityAudit(fn), coreLoadL0Audit(fn), coreL0Status(fn), coreL0SetupAdminPassword(fn), coreL0ChangeAdminPassword(fn), coreL0ListRequests(fn), coreL0ListGrants(fn), coreL0Grant(fn), coreL0Deny(fn), coreL0Revoke(fn), coreL0UnlockWrite(fn), coreL0UnlockWriteForMember(fn), coreL0AddMemberWriteWrap(fn), coreL0RemoveMemberWriteWrap(fn), coreL0MyWriteWrap(fn), coreL0LockWrite(fn), coreL0Migrate(fn), L0AuditRow(type) |
| [src/web/security/defaults.ts](src/web/security/defaults.ts) | 17 | 账号与安全页规格常量（密码策略 / 禁用词 / 角色矩阵）。 | DEFAULT_POLICY(const), FORBIDDEN_PATTERNS(const), ROLE_MATRIX(const) |
| [src/web/security/logic.ts](src/web/security/logic.ts) | 44 | 账号与安全页（REQ-006 / P12）纯逻辑层 | validatePwd(fn), canCrossTeam(fn), rotateWarn(fn), inGrace(fn), maskKey(fn), ROTATE_GRACE_HOURS(const), ROTATE_WARN_DAYS(const) |
| [src/web/security/ownerBindingLabels.ts](src/web/security/ownerBindingLabels.ts) | 21 | 「个人记忆账号绑定」卡中文名唯一来源（OB-3）。 | BINDING_FIELD_LABELS(const), BINDING_FIELD_KEYS(const), BINDING_CONFIRM_WORD(const), BINDING_SOURCE_LABELS(const), BindingFieldKey(type) |
| [src/web/security/securityEntry.tsx](src/web/security/securityEntry.tsx) | 11 | 账号与安全页（REQ-006 / P12）入口（T1 壳） | — |
| [src/web/security/tenantLabels.ts](src/web/security/tenantLabels.ts) | 16 | 「本机租户身份」卡中文名唯一来源（管理员与成员权限设计 §14.2 / AC-11）。 | TENANT_FIELD_LABELS(const), TENANT_FIELD_KEYS(const), TENANT_CONFIRM_WORD(const), TenantFieldKey(type) |
| [src/web/security/types.ts](src/web/security/types.ts) | 24 | 账号与安全页（REQ-006 / P12）数据模型 | TeamMember(type), ApiKey(type), Scope(type) |
| [src/web/security/useSecurityMirror.ts](src/web/security/useSecurityMirror.ts) | 16 | 账号与安全页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useSecurityMirror(fn), SecurityMirror(type) |
| [src/web/security/useToast.tsx](src/web/security/useToast.tsx) | 13 | — | useToast(fn) |
| [src/web/setup/SetupPage.tsx](src/web/setup/SetupPage.tsx) | 596 | 首启向导（批次37-B 建；批次58 按定稿图逐字重做版式）。 | SetupPage(fn) |
| [src/web/setup/setupEntry.tsx](src/web/setup/setupEntry.tsx) | 12 | 首启向导入口（批次37-B） | — |
| [src/web/shared/DemoBadge.tsx](src/web/shared/DemoBadge.tsx) | 51 | 批次48 A30：演示页强制标识。inline 演示页（inlineattribution.html）与悬浮覆盖层（floatattribution.html） | DemoBadge(fn), DemoBadgeProps(type) |
| [src/web/shared/L0WriteUnlock.tsx](src/web/shared/L0WriteUnlock.tsx) | 162 | 批次41-W：L0 写密钥未解锁 → 就地提示 + 就地解锁入口。 | L0WriteUnlock(fn), L0WriteUnlockProps(type) |
| [src/web/shared/PageNav.tsx](src/web/shared/PageNav.tsx) | 73 | 分页导航条（批次24 建，批次 E 起 v5 统一形态）：紧凑数字窗口（‹ 1 … 4 5 6 … 257 ›）+「第 x / y 页」。 | PageNav(fn), PageNavProps(type) |
| [src/web/shared/actionLog.ts](src/web/shared/actionLog.ts) | 106 | 渲染层动作日志（批次7）：任何页面 import 本模块即自动安装全局捕获。 | uiLog(fn), installUiActionLog(fn) |
| [src/web/shared/detectForm.ts](src/web/shared/detectForm.ts) | 16 | 端形态识别（19.10）：真实端壳注入，这里用 UA 粗判。 | detectForm(fn) |
| [src/web/shared/hostTheme.ts](src/web/shared/hostTheme.ts) | 42 | 中心区 iframe 跟随壳层主题（浅/深）。 | useHostTheme(fn), SHELL_THEME_KEY(const) |
| [src/web/shared/kernelLoad.tsx](src/web/shared/kernelLoad.tsx) | 156 | 内核数据加载三态（批次25 P0-7）：loading / ok / error —— 「读不到」绝不渲染成「账本为空」。 | kernelErrorRaw(fn), humanErrorText(fn), kernelErrorText(fn), useKernelLoad(fn), useRefreshAll(fn), KernelLoadError(fn), KernelLoadResult(type), KernelLoadPhase(type) |
| [src/web/shared/kernelProjects.ts](src/web/shared/kernelProjects.ts) | 18 | 项目 ID 真源（批次27 P2-7）：真实项目从内核账本派生（与 MCP list_projects 同口径）， | listProjectIds(fn), DEFAULT_PROJECT_ID(const) |
| [src/web/shared/l0BlobStore.ts](src/web/shared/l0BlobStore.ts) | 53 | 渲染层 L0 原数据库只读端口（批次37-A）：拆库后 L1–L6 行只带 has_l0，密文信封在**主进程**的 memories.l0.json。 | HostL0BlobStore(class) |
| [src/web/shared/l0Port.ts](src/web/shared/l0Port.ts) | 222 | 渲染层 L0 端口（§4.4）：把内核 L0Port / L0AdminPort 调用转发到主进程 L0Vault。 | l0HostAvailable(fn), HostL0Port(class), HostL0Admin(class) |
| [src/web/shared/l0WriteLockSignal.ts](src/web/shared/l0WriteLockSignal.ts) | 35 | L0 写锁状态信号（§4.4.4）：解锁/锁定写密钥后，让首页与壳层状态栏能立刻重读真实锁状态。 | signalL0WriteLockChanged(fn), onL0WriteLockChanged(fn), L0_WRITE_LOCK_SIGNAL_KEY(const) |
| [src/web/shared/l0WriteState.ts](src/web/shared/l0WriteState.ts) | 53 | L0 写密钥状态的**唯一读取口**（§4.4.4 写锁）。 | readL0WriteState(fn), L0WriteState(type) |
| [src/web/shared/layerTime.ts](src/web/shared/layerTime.ts) | 12 | 层级生成时间口径（批次24 拍板：一条记忆只记一个「本组层内容生成时间」，不逐层记）。 | fmtLayerGen(fn), LAYER_GEN_UNRECORDED(const) |
| [src/web/shared/mcpPending.ts](src/web/shared/mcpPending.ts) | 80 | ① 三处落点共享「一键后待生效」信号（首页 / 接入页 / 壳层同源）。 | markMcpPending(fn), clearMcpPending(fn), listMcpPending(fn), subscribeMcpPending(fn), MCP_PENDING_KEY(const), MCP_PENDING_EVENT(const), MCP_PENDING_TTL_MS(const) |
| [src/web/shared/mcpSwitch.ts](src/web/shared/mcpSwitch.ts) | 125 | 客户端 MCP 开关状态 · 三处 UI 的单一真源（T3 展示层）。 | deriveMcpSwitch(fn), requestEnableMcpSwitch(fn), MCP_SWITCH_POLL_MS(const), MCP_SWITCH_LABEL(const), MCP_MANUAL_HINT(const), MCP_LAUNCH_HINT(const), McpSwitchInput(type), McpSwitchState(type), McpSwitchView(type) |
| [src/web/shared/mirrorFailureEvent.ts](src/web/shared/mirrorFailureEvent.ts) | 10 | 阶段5-C：mirror 上抛失败事件与载荷（零依赖共享，避免 mirrorClient ↔ actionLog 循环 import）。 | MIRROR_FAILURE_EVENT(const), MirrorFailure(type) |
| [src/web/shared/mirrorFailureNotice.ts](src/web/shared/mirrorFailureNotice.ts) | 81 | 阶段5-C：镜像上抛失败的全局可见提示。 | installMirrorFailureNotice(fn), resetMirrorFailureNoticeForTests(fn) |
| [src/web/shared/navCountChannel.ts](src/web/shared/navCountChannel.ts) | 34 | 导航计数回传通道（第一轮个人记忆）：中心区页面把「真实待确认数」回传给壳层左侧导航。 | parseNavCount(fn), publishNavCount(fn), NAV_COUNT_MSG(const), NavCountPayload(type) |
| [src/web/shared/navStatusChannel.ts](src/web/shared/navStatusChannel.ts) | 178 | REQ-014 / T6（C8）：侧栏真实状态回传通道。 | parseNavStatus(fn), publishNavStatus(fn), buildNavStatus(fn), NAV_STATUS_MSG(const), NavStatusItem(type), NavStatusPayload(type), NavStatusWindowLike(type), NavStatusSource(type), NavStatusTone(type) |
| [src/web/shared/pagerWindow.ts](src/web/shared/pagerWindow.ts) | 23 | v5 pager 数字窗口（批次 B）：把「当前页 / 总页数」折叠成 ‹ 1 … 4 5 6 … 257 › 的按钮序列。 | pagerWindow(fn), PagerCell(type) |
| [src/web/shared/paginate.ts](src/web/shared/paginate.ts) | 49 | 列表分页纯函数（批次24）：记忆库 / 日志记录 / 审计日志共用同一口径。 | autoPageSize(fn), paginate(fn), PAGE_SIZES(const), DEFAULT_PAGE_SIZE(const), MIN_AUTO_PAGE_SIZE(const), PageParams(type), Paged(type) |
| [src/web/shared/personalPort.ts](src/web/shared/personalPort.ts) | 152 | 个人记忆数据面端口（第一轮本机闭环）：桌面壳 → 主进程 IPC；纯浏览器 → 登录后端 HTTP。 | createHostPersonalPort(fn), createHttpPersonalPort(fn), getPersonalPort(fn), loadPersonalSnapshot(fn), quickAddPersonal(fn), confirmPersonal(fn), rejectPersonal(fn), revokePersonal(fn), removePersonal(fn), importPersonalFromAgent(fn), rejectPersonalFromAgent(fn), pushPersonalToTeam(fn), retryPersonalSync(fn), PersonalPort(type), PersonalOpName(type) |
| [src/web/shared/selectionChannel.ts](src/web/shared/selectionChannel.ts) | 71 | 选中项回传通道（S4）：中心区真实页面把「用户当前选中的一条真实记录」回传给壳层属性检查器。 | parseSelection(fn), publishSelection(fn), SELECTION_MSG(const), SelectionField(type), SelectionPayload(type) |
| [src/web/shared/session.ts](src/web/shared/session.ts) | 69 | 当前会话（批次7）：跨 iframe 共享的 sessionId + home server /api/me 的真实上下文。 | currentSessionId(fn), fetchSessionContext(fn), useSessionContext(fn), SessionState(type), SessionRole(type) |
| [src/web/shared/shellNavigate.ts](src/web/shared/shellNavigate.ts) | 12 | 中心区 iframe → 壳层导航（概览页快捷胶囊 / 洞察跳转用）。 | requestShellView(fn), SHELL_GOTO_MSG(const) |
| [src/web/shared/syncHub.ts](src/web/shared/syncHub.ts) | 77 | 渲染层同步中枢代理（批次42-B）：把内核 AnySyncHub 接口转发到主进程 PgSyncHub。 | HostSyncHub(class) |
| [src/web/shared/useColWidths.tsx](src/web/shared/useColWidths.tsx) | 97 | 表头列宽拖拽与固化（批次24）：记忆库 / 日志记录 / 审计日志三张表共用同一实现。 | loadColWidths(fn), saveColWidths(fn), useColWidths(fn), ColResizeHandle(fn), MIN_COL_WIDTH(const), ColWidths(type) |
| [src/web/shared/useL0Session.ts](src/web/shared/useL0Session.ts) | 155 | 渲染层 L0 连续查阅会话（§4.4.3，日志页 / 记忆层级页共用）： | useL0Session(fn), formatRemaining(fn), L0_HEARTBEAT_MS(const), L0SessionView(type), L0SessionApi(type), L0UnlockOutcome(type), L0RequestOutcome(type) |
| [src/web/shell/CommandPalette.tsx](src/web/shell/CommandPalette.tsx) | 138 | 命令面板（v5 重设计）：Ctrl+K 打开，是原菜单栏 + Ribbon 全量命令的唯一常驻入口。 | CommandPalette(fn) |
| [src/web/shell/ContextMenu.tsx](src/web/shell/ContextMenu.tsx) | 117 | 壳层右键菜单（批次49）：表格行 / 导航树 / 标签条 / 检查器共用同一个渲染器。 | ContextMenu(fn), ContextMenuItem(type), ContextMenuState(type) |
| [src/web/shell/Icons.tsx](src/web/shell/Icons.tsx) | 76 | 壳层图标：定稿里的线性图标集，按需内联渲染（不引入外部图标库、不依赖网络）。 | Icon(fn) |
| [src/web/shell/PersonalMemoryPanel.tsx](src/web/shell/PersonalMemoryPanel.tsx) | 268 | 个人记忆壳层常驻面板（N8）：点击状态栏快捷按钮展开，全局常驻， | PersonalMemoryPanel(fn), PersonalMemoryPanelProps(type) |
| [src/web/shell/ShellLoginDialog.tsx](src/web/shell/ShellLoginDialog.tsx) | 289 | 壳层登录弹窗（批次49）：菜单栏 / 快速访问工具条 / 登录状态处三处入口共用同一个实例。 | logoutCurrentSession(fn), ShellLoginDialog(fn), ShellLoginDialogProps(type) |
| [src/web/shell/ShellStatusCard.tsx](src/web/shell/ShellStatusCard.tsx) | 154 | REQ-014 / T7（C8）：系统状态条（批次58 起常驻命令条右端，原侧栏卡位已移除）。 | ShellStatusCard(fn), EndpointBrief(type) |
| [src/web/shell/StrataScale.tsx](src/web/shell/StrataScale.tsx) | 52 | 功能导航栏底部的「层级刻度」（批次53）：L0–L6 七档真实计数。 | StrataScale(fn) |
| [src/web/shell/Workspace.tsx](src/web/shell/Workspace.tsx) | 1953 | 工作台壳层（批次48 S1 建；v5 重设计改造）：36px 标题栏 + 44px 上下文命令条 + 导航树 + 标签条 | Workspace(fn), ShellShortcutAction(type) |
| [src/web/shell/dock.ts](src/web/shell/dock.ts) | 177 | 底部面板真实数据源（S6）：输出=程序动作日志尾读；问题=该日志派生的错误/警告； | loadOutputLog(fn), problemsFromLog(fn), countActionableProblems(fn), loadScheduleRuns(fn), auditMentions(fn), loadAuditForMemory(fn), OutputLogView(type), ProblemRow(type), ScheduleRun(type), AuditRow(type), DockResult(type) |
| [src/web/shell/humanLog.ts](src/web/shell/humanLog.ts) | 164 | 底部「输出 / 问题」面板的人话翻译层（2026-11-22）： | humanActionLabel(fn), humanizeLogLine(fn), problemsIntro(fn), HumanLogLine(type), HumanSeverity(type) |
| [src/web/shell/layers.ts](src/web/shell/layers.ts) | 79 | L1–L6 / L0 面板真实数据（S7）：只在中心页为「分层 L1–L6」或「L0 密文」时显示的壳层条。 | loadLayerPanel(fn), PANEL_LAYERS(const), LayerCount(type), LayerPanelView(type), PanelLayer(type) |
| [src/web/shell/navCounts.ts](src/web/shell/navCounts.ts) | 45 | 批次54：功能导航角标的真实数据加载器。 | loadNavCounts(fn), NavCountId(type), NavCounts(type) |
| [src/web/shell/overview.ts](src/web/shell/overview.ts) | 530 | 壳层「概览」数据条（批次48 S2）：只从真实链路取值，逐项标明来源与失败原因。 | loadMcpPanel(fn), loadOverview(fn), OverviewHealth(type), OverviewBilling(type), OverviewAuditRow(type), OverviewRecentAudits(type), OverviewTodayPanel(type), OverviewTokenPanel(type), OverviewRefinePanel(type), OverviewMcpRow(type), OverviewMcpPanel(type), OverviewEngineRow(type), OverviewEnginePanel(type), OverviewDataRoot(type), OverviewL0Write(type), OverviewSnapshot(type) |
| [src/web/shell/shellStatus.ts](src/web/shell/shellStatus.ts) | 198 | REQ-014 / T7（C8）：侧栏状态卡的真实数据加载器。 | loadPendingCount(fn), loadRefineBrief(fn), loadMcpSwitchBrief(fn), loadWebIssueBrief(fn), loadShellStatus(fn), toNavStatusSource(fn), SHELL_STATUS_POLL_MS(const), RefineBrief(type), McpSwitchBrief(type), WebIssueBrief(type), ShellStatusSnapshot(type) |
| [src/web/shell/statusbar.ts](src/web/shell/statusbar.ts) | 137 | 状态栏真实数据（S7）：账本位置 / L0 保险库状态 / 采集器后台状态。 | loadL0Write(fn), loadL0Status(fn), loadCollectorStatus(fn), loadStatusbar(fn), shortLocation(fn), StoragePlaceView(type), CollectorView(type), StatusSnapshot(type), L0WriteView(type), StatusbarPart(type) |
| [src/web/shell/strataScale.ts](src/web/shell/strataScale.ts) | 92 | 功能导航栏底部的「层级刻度」（批次53 定义 / 批次55 改数据源）：L0–L6 七档的真实计数。 | strataViewFromOverview(fn), STRATA_LAYERS(const), StrataLayerSpec(type), StrataRowView(type), StrataScaleView(type), StrataSnapshotLike(type), StrataLayerId(type) |
| [src/web/shell/taskpane.ts](src/web/shell/taskpane.ts) | 41 | 任务窗「待重放写入」只读视图（S5 / D6）：经 hostBridge 读 l0:pendingWrites。 | loadPendingWrites(fn), PendingWritesResult(type) |
| [src/web/shell/views.ts](src/web/shell/views.ts) | 246 | 工作台壳层的视图映射（批次48 S1）。 | flattenNav(fn), findNav(fn), navPages(fn), PAGES(const), NAV(const), CMDS(const), QUICK_VIEWS(const), PALETTE_GROUPS(const), BOTTOM_TABS(const), NavGroup(type), NavItem(type), CmdItem(type), PaletteItem(type), BottomTab(type), PageKey(type), NavEntry(type), IconName(type), ShellAction(type), BottomTabId(type) |
| [src/web/shell/workspaceEntry.tsx](src/web/shell/workspaceEntry.tsx) | 20 | 工作台壳层入口（批次48 S1）：Electron 主窗口加载 workspace.html。 | — |
| [src/web/sync/SyncPage.tsx](src/web/sync/SyncPage.tsx) | 358 | 同步与裁决页（批次42-C）：「立即同步」（真实 push/pull 报告）+ 中枢对账 + §9.7 人工裁决队列 | SyncPage(fn) |
| [src/web/sync/coreSyncPage.ts](src/web/sync/coreSyncPage.ts) | 216 | 同步与裁决页（批次42-C）数据逻辑：内核 agent.sync 真跑 + §9.7 裁决队列经 HostSyncHub 代理。 | runSync(fn), listSyncConflicts(fn), resolveConflict(fn), hubOverview(fn), syncChannels(fn), SyncPageHub(type), SyncPageCtx(type), SyncRunView(type), HubOverviewView(type), SyncChannelRow(type), SyncChannelsView(type) |
| [src/web/sync/syncEntry.tsx](src/web/sync/syncEntry.tsx) | 12 | 同步与裁决页（批次42-C）入口：挂载 SyncPage。 | — |
| [src/web/test-setup.ts](src/web/test-setup.ts) | 1 | — | — |
| [src/web/vite-env.d.ts](src/web/vite-env.d.ts) | 2 | Vite 侧效应导入（CSS）的类型声明 | — |
| [src/web/webonboard/WebOnboardPage.tsx](src/web/webonboard/WebOnboardPage.tsx) | 175 | 网页端接入页（2026-11-19 新增；2026-11-22 按真实使用场景重排） | WebOnboardPage(fn) |
| [src/web/webonboard/WebchatAutoCard.tsx](src/web/webonboard/WebchatAutoCard.tsx) | 412 | 网页端接入页 ·「网页会话自动采集」卡（2026-11-19 自参数页迁入）。 | pendingRelogin(fn), WebchatAutoCard(fn), WebchatAutoSummary(type) |
| [src/web/webonboard/webOnboardEntry.tsx](src/web/webonboard/webOnboardEntry.tsx) | 13 | 网页端接入页入口（2026-11-19 新增） | — |
| [src/web/webonboard/webchatAuto.ts](src/web/webonboard/webchatAuto.ts) | 161 | 网页端接入页 ·「网页会话自动采集」卡的渲染层桥（2026-11-19 自参数页迁入）。 | webchatAutoAvailable(fn), webchatAutoLogin(fn), webchatExportDir(fn), webchatExportOpen(fn), webchatExportSet(fn), AUTO_STATUS_LABEL(const), webchatAutoState(const), webchatAutoSet(const), webchatAutoRun(const), webchatAutoSweep(const), AutoConfigView(type), AutoSiteResult(type), AutoRoundView(type), AutoStateView(type), AutoResult(type), AutoPatch(type), ExportDirView(type), AutoSiteStatus(type) |
| [src/web/write/DedupCard.tsx](src/web/write/DedupCard.tsx) | 59 | 写入页右栏「查重预览」面板（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write 右栏）： | DedupCard(fn) |
| [src/web/write/WriteForm.tsx](src/web/write/WriteForm.tsx) | 149 | 写入页表单（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write 写入表单面板）： | WriteForm(fn) |
| [src/web/write/WriteL0UnlockCard.tsx](src/web/write/WriteL0UnlockCard.tsx) | 160 | 写入页「就地解锁 L0 写密钥」面板（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write）： | WriteL0UnlockCard(fn), L0UnlockStatus(type) |
| [src/web/write/WritePage.tsx](src/web/write/WritePage.tsx) | 267 | 写入页（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write，批次47 重建）： | WritePage(fn) |
| [src/web/write/WriteReceiptCard.tsx](src/web/write/WriteReceiptCard.tsx) | 168 | 写入页回执与最近写入（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write）： | fmtClock(fn), fmtHMS(fn), WriteReceiptCard(fn), WriteRefusalCard(fn), WriteRecentWritesCard(fn) |
| [src/web/write/coreWrite.ts](src/web/write/coreWrite.ts) | 140 | 写入页（REQ-006 / P2）接真内核：ma.write（六类 + 查重短路嫁接 + 审计） | coreWrite(fn), coreListExisting(fn), coreWriteStatus(fn), requestIdOfError(fn), coreWriteReceipts(fn), CoreWriteOutcome(type) |
| [src/web/write/logic.ts](src/web/write/logic.ts) | 178 | 写入页（REQ-006 / P2）纯逻辑层 | estimateTokens(fn), needsRefine(fn), validateDraft(fn), suggestTagsFromContent(fn), jaccard(fn), scoreDedup(fn), thresholdForLayer(fn), composeReceipt(fn), L1_CHAR_LIMIT(const), ReceiptOptions(type) |
| [src/web/write/spec.ts](src/web/write/spec.ts) | 42 | 写入页（REQ-006 / P2）规格常量（非演示数据） | KERNEL_CATEGORY(const), CATEGORY_PREVIEW(const), LAYER_THRESHOLDS(const) |
| [src/web/write/types.ts](src/web/write/types.ts) | 101 | 写入页（REQ-006 / P2）数据模型 | MemoryDraft(type), ExistingMemory(type), DedupResult(type), ReceiptLayer(type), WriteReceipt(type), WriteRefusal(type), WriteReceiptHistoryRow(type), ValidationResult(type), MemoryCategory(type), SourceKind(type), LayerName(type) |
| [src/web/write/useToast.tsx](src/web/write/useToast.tsx) | 22 | 轻量 toast hook（T5）：返回展示节点与 show(msg) | useToast(fn) |
| [src/web/write/useWriteMirror.ts](src/web/write/useWriteMirror.ts) | 16 | 写入页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。 | useWriteMirror(fn), WriteMirror(type) |
| [src/web/write/writeEntry.tsx](src/web/write/writeEntry.tsx) | 11 | 写入页（REQ-006 / P2）入口：挂载 WritePage。 | — |

## 文档

| 文件 | 行数 | 摘要 |
|---|---|---|
| [README.md](README.md) | 188 | 本项目怎么用（使用入口） |
| [specs/A31-BILLING-MATRIX.md](specs/A31-BILLING-MATRIX.md) | 63 | A31 厂商余额接口矩阵（spike 实测，2026-11-07） |
| [specs/AUDIT-FULL-REVIEW-2026-10-31.md](specs/AUDIT-FULL-REVIEW-2026-10-31.md) | 213 | status: active |
| [specs/DECISION-2026-11-12-方案对比与融合自发现架构.md](specs/DECISION-2026-11-12-方案对比与融合自发现架构.md) | 258 | title: 方案对比与融合决策：分层收敛，而非互斥取舍 |
| [specs/MANUAL-TEST-BATCH-57B.md](specs/MANUAL-TEST-BATCH-57B.md) | 66 | status: pending-manual-acceptance |
| [specs/MANUAL-TEST-BATCH-57C.md](specs/MANUAL-TEST-BATCH-57C.md) | 67 | status: pending-manual-acceptance |
| [specs/MANUAL-TEST-BATCH-57D.md](specs/MANUAL-TEST-BATCH-57D.md) | 67 | status: accepted-manual |
| [specs/MANUAL-TEST-BATCH-58.md](specs/MANUAL-TEST-BATCH-58.md) | 205 | status: pending |
| [specs/MANUAL-TEST-BATCH.md](specs/MANUAL-TEST-BATCH.md) | 328 | status: archived |
| [specs/MANUAL-TEST-FIX-BATCH-1.md](specs/MANUAL-TEST-FIX-BATCH-1.md) | 97 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-10.md](specs/MANUAL-TEST-FIX-BATCH-10.md) | 160 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-11.md](specs/MANUAL-TEST-FIX-BATCH-11.md) | 151 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-12.md](specs/MANUAL-TEST-FIX-BATCH-12.md) | 122 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-13.md](specs/MANUAL-TEST-FIX-BATCH-13.md) | 151 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-14.md](specs/MANUAL-TEST-FIX-BATCH-14.md) | 123 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-15.md](specs/MANUAL-TEST-FIX-BATCH-15.md) | 169 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-16.md](specs/MANUAL-TEST-FIX-BATCH-16.md) | 218 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-17.md](specs/MANUAL-TEST-FIX-BATCH-17.md) | 325 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-18.md](specs/MANUAL-TEST-FIX-BATCH-18.md) | 247 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-19.md](specs/MANUAL-TEST-FIX-BATCH-19.md) | 281 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-2.md](specs/MANUAL-TEST-FIX-BATCH-2.md) | 167 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-20.md](specs/MANUAL-TEST-FIX-BATCH-20.md) | 169 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-21.md](specs/MANUAL-TEST-FIX-BATCH-21.md) | 214 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-22.md](specs/MANUAL-TEST-FIX-BATCH-22.md) | 256 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-23.md](specs/MANUAL-TEST-FIX-BATCH-23.md) | 283 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-24.md](specs/MANUAL-TEST-FIX-BATCH-24.md) | 224 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-25.md](specs/MANUAL-TEST-FIX-BATCH-25.md) | 198 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-26A.md](specs/MANUAL-TEST-FIX-BATCH-26A.md) | 93 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-26B.md](specs/MANUAL-TEST-FIX-BATCH-26B.md) | 129 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-27.md](specs/MANUAL-TEST-FIX-BATCH-27.md) | 101 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-28.md](specs/MANUAL-TEST-FIX-BATCH-28.md) | 115 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-29.md](specs/MANUAL-TEST-FIX-BATCH-29.md) | 72 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-3.md](specs/MANUAL-TEST-FIX-BATCH-3.md) | 130 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-30.md](specs/MANUAL-TEST-FIX-BATCH-30.md) | 62 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-31.md](specs/MANUAL-TEST-FIX-BATCH-31.md) | 72 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-32.md](specs/MANUAL-TEST-FIX-BATCH-32.md) | 104 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-33.md](specs/MANUAL-TEST-FIX-BATCH-33.md) | 111 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-34.md](specs/MANUAL-TEST-FIX-BATCH-34.md) | 95 | 批次34 手动测试报告 · 「测试连通」不再要求先勾选「启用」（拨测与启用解耦） |
| [specs/MANUAL-TEST-FIX-BATCH-35.md](specs/MANUAL-TEST-FIX-BATCH-35.md) | 91 | 批次35 手动测试报告 · 无意义会话禁止入库（质量门收紧 + 采集器只采用户 + 记忆库清空重采） |
| [specs/MANUAL-TEST-FIX-BATCH-36.md](specs/MANUAL-TEST-FIX-BATCH-36.md) | 116 | 批次36 手动测试报告 · 入库规则更新后的存量处置（规则版本戳 + 只读回放 + 存量重判） |
| [specs/MANUAL-TEST-FIX-BATCH-37.md](specs/MANUAL-TEST-FIX-BATCH-37.md) | 195 | 批次37 手动测试报告 · L0 与 L1–L6 拆成两个库文件（强制首启选位 + L0 管理密码 + 双库备份 + 恢复码找回 + 按 L0 重建） |
| [specs/MANUAL-TEST-FIX-BATCH-38.md](specs/MANUAL-TEST-FIX-BATCH-38.md) | 118 | 批次38 手动测试报告 · §4.4.6 旧数据迁移拆成独立卡片（+ 批次35/36/37 实机执行台账校正） |
| [specs/MANUAL-TEST-FIX-BATCH-39.md](specs/MANUAL-TEST-FIX-BATCH-39.md) | 138 | 批次39 手动测试报告 · 重新设计精炼器：L2–L6 由后台补炼队列真生成 |
| [specs/MANUAL-TEST-FIX-BATCH-4.md](specs/MANUAL-TEST-FIX-BATCH-4.md) | 105 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-40.md](specs/MANUAL-TEST-FIX-BATCH-40.md) | 175 | 批次40 手动测试报告 · 短料在 L0→L1 就拦下 + L2–L6 精炼逻辑重新梳理 |
| [specs/MANUAL-TEST-FIX-BATCH-41.md](specs/MANUAL-TEST-FIX-BATCH-41.md) | 421 | 批次41 手动测试报告 · 审计搬出记忆库 + 队列卫生 + 退避/退出/备份校验 + 删除如实告知（收口与首次真机执行） |
| [specs/MANUAL-TEST-FIX-BATCH-42.md](specs/MANUAL-TEST-FIX-BATCH-42.md) | 663 | 批次42 阶段2 手测报告 · 删演示注入（2026-11-04） |
| [specs/MANUAL-TEST-FIX-BATCH-43.md](specs/MANUAL-TEST-FIX-BATCH-43.md) | 114 | title: 批次43 P0 止血：WorkBuddy 新版会话日志采集恢复 |
| [specs/MANUAL-TEST-FIX-BATCH-44.md](specs/MANUAL-TEST-FIX-BATCH-44.md) | 100 | status: awaiting-manual-test |
| [specs/MANUAL-TEST-FIX-BATCH-45.md](specs/MANUAL-TEST-FIX-BATCH-45.md) | 71 | 手动测试报告 · 批次45（界面重设计 v5：批次 A 壳层 + B 页头/表底 + C 检查器快捷键 + D 全量视觉对齐） |
| [specs/MANUAL-TEST-FIX-BATCH-46.md](specs/MANUAL-TEST-FIX-BATCH-46.md) | 55 | 手动测试报告 · 批次 46：首页模板 1:1 复刻 STRATUM pg-home（S1） |
| [specs/MANUAL-TEST-FIX-BATCH-47.md](specs/MANUAL-TEST-FIX-BATCH-47.md) | 58 | 手动测试报告 · 批次 47：写入页模板 1:1 复刻 STRATUM pg-write |
| [specs/MANUAL-TEST-FIX-BATCH-48.md](specs/MANUAL-TEST-FIX-BATCH-48.md) | 59 | 手动测试报告 · 批次 48：Agent 接入页模板 1:1 复刻 STRATUM pg-agent |
| [specs/MANUAL-TEST-FIX-BATCH-49.md](specs/MANUAL-TEST-FIX-BATCH-49.md) | 56 | 手动测试报告 · 批次49-STRATUM（2026-11-21） |
| [specs/MANUAL-TEST-FIX-BATCH-5.md](specs/MANUAL-TEST-FIX-BATCH-5.md) | 98 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-50.md](specs/MANUAL-TEST-FIX-BATCH-50.md) | 50 | 手动测试报告 · 批次50（2026-11-21） |
| [specs/MANUAL-TEST-FIX-BATCH-51.md](specs/MANUAL-TEST-FIX-BATCH-51.md) | 49 | 批次51 手动测试报告：顶栏 QAT 取消 + 范围读数取消 + 首页登出按钮 + 监控卡全面统一 |
| [specs/MANUAL-TEST-FIX-BATCH-52.md](specs/MANUAL-TEST-FIX-BATCH-52.md) | 49 | 批次52 手动测试报告（2026-11-21） |
| [specs/MANUAL-TEST-FIX-BATCH-53.md](specs/MANUAL-TEST-FIX-BATCH-53.md) | 101 | 批次53 手动测试报告（2026-11-21） |
| [specs/MANUAL-TEST-FIX-BATCH-54.md](specs/MANUAL-TEST-FIX-BATCH-54.md) | 45 | 批次54 手动测试报告（2026-11-21 第三轮） |
| [specs/MANUAL-TEST-FIX-BATCH-55.md](specs/MANUAL-TEST-FIX-BATCH-55.md) | 56 | 批次55 手动测试报告（2026-11-21） |
| [specs/MANUAL-TEST-FIX-BATCH-56.md](specs/MANUAL-TEST-FIX-BATCH-56.md) | 44 | 批次56 · 手动测试报告（2026-11-21 第五轮） |
| [specs/MANUAL-TEST-FIX-BATCH-57.md](specs/MANUAL-TEST-FIX-BATCH-57.md) | 68 | 批次57 手动测试报告：记忆库页签精简 + 行右键常驻详情菜单 + 个人记忆独立页 |
| [specs/MANUAL-TEST-FIX-BATCH-6.md](specs/MANUAL-TEST-FIX-BATCH-6.md) | 138 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-7.md](specs/MANUAL-TEST-FIX-BATCH-7.md) | 159 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-8.md](specs/MANUAL-TEST-FIX-BATCH-8.md) | 143 | status: done |
| [specs/MANUAL-TEST-FIX-BATCH-9.md](specs/MANUAL-TEST-FIX-BATCH-9.md) | 211 | status: done |
| [specs/MANUAL-TEST-PHASE-A.md](specs/MANUAL-TEST-PHASE-A.md) | 126 | status: done |
| [specs/MANUAL-TEST-PHASE-B.md](specs/MANUAL-TEST-PHASE-B.md) | 95 | status: done |
| [specs/MANUAL-TEST-PHASE-C.md](specs/MANUAL-TEST-PHASE-C.md) | 108 | status: done |
| [specs/MANUAL-TEST-PHASE-D.md](specs/MANUAL-TEST-PHASE-D.md) | 165 | status: done |
| [specs/MANUAL-TEST-PHASE-E.md](specs/MANUAL-TEST-PHASE-E.md) | 129 | status: done |
| [specs/MANUAL-TEST.md](specs/MANUAL-TEST.md) | 342 | status: done |
| [specs/MCP运维与多Agent写入规范.md](specs/MCP运维与多Agent写入规范.md) | 201 | MCP 运维与多 Agent 写入规范 |
| [specs/POSTMORTEM-2026-11-11-静默失效与双通路自发现方案.md](specs/POSTMORTEM-2026-11-11-静默失效与双通路自发现方案.md) | 366 | title: 静默失效事故复盘与双通路自发现方案 |
| [specs/RECALL-HARD-PREFIX.md](specs/RECALL-HARD-PREFIX.md) | 191 | title: 硬前置召回：A 宿主钩子 / B LLM Gateway / C 内核门禁 |
| [specs/ROADMAP-批次42-未接线三件套-方案.md](specs/ROADMAP-批次42-未接线三件套-方案.md) | 52 | ROADMAP 批次42+ — 未接线三件套（云端同步 / 每日全量补齐 / 独立采集守护进程）立项方案 |
| [specs/ROADMAP-批次45-租户归一与成员密钥域模型-方案.md](specs/ROADMAP-批次45-租户归一与成员密钥域模型-方案.md) | 44 | ROADMAP 批次45+ — 令牌与租户欠账立项（MCP 作用域收紧前置 = 账本租户归一）+ 成员/API 密钥域模型 |
| [specs/ROADMAP-批次B类-远端PG与多机硬过滤-方案.md](specs/ROADMAP-批次B类-远端PG与多机硬过滤-方案.md) | 102 | 批次 B 类 · 远端 PG 中枢（B4）+ 多机硬过滤（B1）+ 真实精炼（B3）方案 |
| [specs/STRATUM-设计系统规格.md](specs/STRATUM-设计系统规格.md) | 100 | STRATUM 设计系统规格（方案A · 层析） |
| [specs/acceptance.md](specs/acceptance.md) | 80 | title: 验收标准 |
| [specs/code-map.md](specs/code-map.md) | 2208 | status: draft |
| [specs/demo-data-baseline.md](specs/demo-data-baseline.md) | 116 | 演示/种子数据基线清单（批次42 · 阶段0 冻结） |
| [specs/memory-loop-enhancement-plan.md](specs/memory-loop-enhancement-plan.md) | 118 | 记忆闭环增强方案（回显 × 进化 × 生命周期 × 画像） |
| [specs/project_id配置化_工程化落地方案.md](specs/project_id配置化_工程化落地方案.md) | 395 | project_id 配置化 · 工程化落地方案 |
| [specs/project_id零配置_详细实施方案.md](specs/project_id零配置_详细实施方案.md) | 289 | project_id 零配置 · 详细实施方案 |
| [specs/recall-echo-contract.md](specs/recall-echo-contract.md) | 385 | title: 回显（recall echo）逻辑与格式统计 |
| [specs/reports/BATCH48-FIX-REPORT.md](specs/reports/BATCH48-FIX-REPORT.md) | 80 | 批次48 审计修复收尾报告 |
| [specs/reports/RECALL-WEEK-PLAN.md](specs/reports/RECALL-WEEK-PLAN.md) | 120 | 召回 A 方案 · 一周真实数据观察计划（2026-11-12 ~ 2026-11-19） |
| [specs/reports/T4-存量明文盘点-2026-11-12.md](specs/reports/T4-存量明文盘点-2026-11-12.md) | 51 | title: T4 存量明文盘点与不变量守卫 |
| [specs/reports/WEBCHAT-ID-RECONCILE-PLAN.md](specs/reports/WEBCHAT-ID-RECONCILE-PLAN.md) | 145 | 网页会话采集：无状态 ID 对账改造 · 详细执行方案 |
| [specs/reports/auto-mode-weights-eval-2026-11-25.md](specs/reports/auto-mode-weights-eval-2026-11-25.md) | 64 | auto 模式专属权重 vs growth:v1 固定权重 —— 离线 A/B 评估（2026-11-25，北京时间） |
| [specs/reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md](specs/reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md) | 115 | dsh-hindsight-local 与 MultiAgent Memory 对比与借鉴建议 |
| [specs/reports/dsh-hindsight-local-调研报告-2026-11-14.md](specs/reports/dsh-hindsight-local-调研报告-2026-11-14.md) | 266 | dsh-hindsight-local 仓库调研报告 |
| [specs/reports/hindsight-comparison-2026-11-24.md](specs/reports/hindsight-comparison-2026-11-24.md) | 131 | MultiAgent Memory vs Hindsight — 重新对比（2026-11-24） |
| [specs/reports/hindsight-comparison-and-roadmap-2026-11-21.md](specs/reports/hindsight-comparison-and-roadmap-2026-11-21.md) | 291 | MultiAgent Memory vs Hindsight 对比分析与追赶方案 |
| [specs/reports/hindsight-追赶实施方案-2026-11-22.md](specs/reports/hindsight-追赶实施方案-2026-11-22.md) | 173 | MultiAgent Memory vs Hindsight — 对比点汇总与追赶实施方案 |
| [specs/reports/p1-5-bm25-feasibility-2026-11-22.md](specs/reports/p1-5-bm25-feasibility-2026-11-22.md) | 74 | P1-5 BM25 长度归一化可行性评估（2026-11-22 北京时间） |
| [specs/reports/p1-6-7-8-reevaluation-2026-11-23.md](specs/reports/p1-6-7-8-reevaluation-2026-11-23.md) | 133 | P1-6 / P1-7 / P1-8 重新评估（摆上台面） |
| [specs/reports/p1-6-offline-eval-2026-11-23.md](specs/reports/p1-6-offline-eval-2026-11-23.md) | 108 | P1-6 离线深度评估：multilingual-e5-small 384 维 vs 现役 64 维 hash bag |
| [specs/reports/recall-quality-progress-2026-11-21.md](specs/reports/recall-quality-progress-2026-11-21.md) | 235 | 召回质量增强任务进度报告 |
| [specs/reports/recall-weights-offline-eval-2026-11-22.md](specs/reports/recall-weights-offline-eval-2026-11-22.md) | 73 | P0-3 召回权重离线评估报告（2026-11-22 北京时间） |
| [specs/reports/召回模式全程序审查报告-2026-11-13.md](specs/reports/召回模式全程序审查报告-2026-11-13.md) | 160 | title: 召回模式全程序审查报告 |
| [specs/reports/审查-Agent侧记忆库与净化生长打通-2026-11-12.md](specs/reports/审查-Agent侧记忆库与净化生长打通-2026-11-12.md) | 111 | title: 审查报告 — Agent 侧记忆库使用与净化生长数据是否打通 |
| [specs/requirements.md](specs/requirements.md) | 75 | title: 需求规格 |
| [specs/tasks/AGENT-ONBOARD.md](specs/tasks/AGENT-ONBOARD.md) | 208 | 原子任务：Agent 接入配置页（REQ-003） |
| [specs/tasks/AUDIT-LOG.md](specs/tasks/AUDIT-LOG.md) | 87 | REQ-006 / P11 审计日志页 — 任务拆分（原子任务 · 供 Agent 执行） |
| [specs/tasks/CONFLICT.md](specs/tasks/CONFLICT.md) | 61 | REQ-006 / P7 冲突裁决页 — 任务拆分（原子任务 · 供 Agent 执行） |
| [specs/tasks/CORE-AGENT.md](specs/tasks/CORE-AGENT.md) | 30 | REQ-007 memagent-core 内核 任务拆分（内核API契约 19.10/19.11） |
| [specs/tasks/FEEDBACK.md](specs/tasks/FEEDBACK.md) | 28 | P9 用户反馈页 任务拆分（REQ-006 / 13.7 / 7.1 / 7.2） |
| [specs/tasks/FORGETTING.md](specs/tasks/FORGETTING.md) | 21 | REQ-010 遗忘机制后台任务 任务拆分（第十七章 17.4–17.11） |
| [specs/tasks/GLOBAL-PARAMS.md](specs/tasks/GLOBAL-PARAMS.md) | 32 | P5 全局参数页 任务拆分（REQ-006 / 17.6 / 2.4.3 / 2.4.4 / 15.1 / 15.3） |
| [specs/tasks/GROWTH-AGENT-EVOLUTION.md](specs/tasks/GROWTH-AGENT-EVOLUTION.md) | 211 | title: 净化生长 × Agent 侧进化 — 三个独立缺口任务 |
| [specs/tasks/GROWTH.md](specs/tasks/GROWTH.md) | 34 | P14 自我净化与生长页 任务拆分（REQ-009 / 6.1 / 6.2 / 7.1 / 7.2 / 13.3） |
| [specs/tasks/HOME-LOGIN.md](specs/tasks/HOME-LOGIN.md) | 244 | 原子任务：首页与登录卡片（REQ-005） |
| [specs/tasks/LIFECYCLE.md](specs/tasks/LIFECYCLE.md) | 64 | REQ-006 / P4 生命周期页 — 任务拆分（原子任务 · 供 Agent 执行） |
| [specs/tasks/LLM-CONFIG.md](specs/tasks/LLM-CONFIG.md) | 29 | P13 大模型配置页 任务拆分（REQ-009 / 13.2 / 19.8） |
| [specs/tasks/LOGS.md](specs/tasks/LOGS.md) | 29 | REQ-011 日志记录页（P15）任务拆分 |
| [specs/tasks/MEMORY-MANAGE.md](specs/tasks/MEMORY-MANAGE.md) | 95 | REQ-006 / P8 记忆管理页 — 任务拆分（原子任务 · 供 Agent 执行） |
| [specs/tasks/MONITOR.md](specs/tasks/MONITOR.md) | 26 | P6 监控仪表盘 任务拆分（REQ-006 / 12.1 / 12.2） |
| [specs/tasks/RECALL-ECHO-RAG.md](specs/tasks/RECALL-ECHO-RAG.md) | 321 | title: 回显重设计 — RAG 引用锚点 + 气泡内折叠统计汇总 |
| [specs/tasks/RECALL-HIGHLIGHT.md](specs/tasks/RECALL-HIGHLIGHT.md) | 115 | REQ-004 → 回显命中片段高亮（方案 C）· AC/TC |
| [specs/tasks/RECALL-SCORE-FIX.md](specs/tasks/RECALL-SCORE-FIX.md) | 141 | 召回打分修复（批次60）：长文本被余弦系统性稀释 |
| [specs/tasks/RECALL-SHAPING-P1.md](specs/tasks/RECALL-SHAPING-P1.md) | 225 | title: P1 客户端整形改造（借鉴 dsh-hindsight 第 6/7/8 项） |
| [specs/tasks/RECALL-SHAPING.md](specs/tasks/RECALL-SHAPING.md) | 141 | title: 召回质量增强（借鉴 Hindsight 客户端整形层） |
| [specs/tasks/RETRIEVAL.md](specs/tasks/RETRIEVAL.md) | 110 | REQ-012 检索页 — 任务拆分（原子任务 · 供 Agent 执行） |
| [specs/tasks/SECURITY.md](specs/tasks/SECURITY.md) | 31 | P12 账号与安全页 任务拆分（REQ-006 / 4.1 / 4.2 / 3.2 / 18.2-A） |
| [specs/tasks/SELF-EVOLUTION.md](specs/tasks/SELF-EVOLUTION.md) | 394 | title: 自我进化 · 可验证的自动生长（M0–M5） |
| [specs/tasks/SETUP.md](specs/tasks/SETUP.md) | 108 | REQ-005 / 首启强制向导（setup.html）— 字段级 AC / TC |
| [specs/tasks/SYNC.md](specs/tasks/SYNC.md) | 28 | REQ-008 云同步 任务拆分（同步机制详细设计 §1–§8） |
| [specs/tasks/USER-REGISTER.md](specs/tasks/USER-REGISTER.md) | 97 | 原子任务示例：用户注册（USER-REGISTER） |
| [specs/tasks/WRITE-PAGE.md](specs/tasks/WRITE-PAGE.md) | 98 | REQ-006 / P2 写入页 — 任务拆分（原子任务 · 供 Agent 执行） |
| [specs/test-plan.md](specs/test-plan.md) | 152 | title: 测试标准 |
| [specs/topbar-consolidation-2026-11-08.md](specs/topbar-consolidation-2026-11-08.md) | 57 | 顶部三层并一条 + 删默认菜单（2026-11-08） |
| [specs/topbar-restore-compare-2026-11-08.md](specs/topbar-restore-compare-2026-11-08.md) | 96 | 顶部区逐元素比对（定稿 vs 当前实现）· 待确认 |
| [specs/working-set/agent-memory-sop.md](specs/working-set/agent-memory-sop.md) | 562 | 多 Agent 记忆读写 SOP（标准作业程序） |
| [specs/working-set/draft-tool-inventory.md](specs/working-set/draft-tool-inventory.md) | 47 | 记忆库工具清单（按 读 / 写 / 管理） |
| [specs/working-set/external-source/multiagent-memory-ops/agent-memory-sop.md](specs/working-set/external-source/multiagent-memory-ops/agent-memory-sop.md) | 562 | 多 Agent 记忆读写 SOP（标准作业程序） |
| [specs/working-set/external-source/multiagent-memory-ops/archive/draft-contract-multiuser.md](specs/working-set/external-source/multiagent-memory-ops/archive/draft-contract-multiuser.md) | 82 | 多用户隔离契约条款（草案 · 拟作为 §14） |
| [specs/working-set/external-source/multiagent-memory-ops/archive/draft-sop-multiuser.md](specs/working-set/external-source/multiagent-memory-ops/archive/draft-sop-multiuser.md) | 109 | 多用户部署设计（SOP 草案 · 拟作为 §16） |
| [specs/working-set/external-source/multiagent-memory-ops/archive/draft-tool-inventory.md](specs/working-set/external-source/multiagent-memory-ops/archive/draft-tool-inventory.md) | 47 | 记忆库工具清单（按 读 / 写 / 管理） |
| [specs/working-set/external-source/multiagent-memory-ops/mcp-extension-contract.md](specs/working-set/external-source/multiagent-memory-ops/mcp-extension-contract.md) | 514 | MultiAgent Memory — MCP 工具扩展接口契约（草案 v1.0） |
| [specs/working-set/external-source/multiagent-memory-ops/multiuser-design-status.md](specs/working-set/external-source/multiagent-memory-ops/multiuser-design-status.md) | 125 | 多用户隔离设计 · 落盘状态总览 |
| [specs/working-set/mcp-extension-contract.md](specs/working-set/mcp-extension-contract.md) | 514 | MultiAgent Memory — MCP 工具扩展接口契约（草案 v1.0） |
| [specs/working-set/multiuser-design-status.md](specs/working-set/multiuser-design-status.md) | 125 | 多用户隔离设计 · 落盘状态总览 |
| [specs/workspace-view-gap-2026-11-08.md](specs/workspace-view-gap-2026-11-08.md) | 55 | 工作台中心区 · 逐页差距清单（第 1 步） |
| [specs/召回模式SystemPrompt模板.md](specs/召回模式SystemPrompt模板.md) | 139 | 召回模式 System Prompt 记忆模板（含冲突约束） |
| [specs/召回模式设计与实现方案.md](specs/召回模式设计与实现方案.md) | 156 | 召回模式设计与实现方案 |
| [specs/多用户三池隔离设计_D1-D25.md](specs/多用户三池隔离设计_D1-D25.md) | 183 | 多用户三池隔离设计（D1–D25） |
| [specs/已知边界台账.md](specs/已知边界台账.md) | 192 | title: 当前已知边界台账（AGENTS §9 迁出） |
| [specs/开发纪律_三道闸门.md](specs/开发纪律_三道闸门.md) | 110 | 开发纪律：每个原子动作收尾必须过 3 道闸门 |
| [specs/批次44-D5工具面落地子方案.md](specs/批次44-D5工具面落地子方案.md) | 163 | 批次44 · D5 工具面落地子方案（A2 补 12 工具 Agent 面） |
| [specs/批次44-吸收项落地设计.md](specs/批次44-吸收项落地设计.md) | 90 | 批次44：吸收项落地设计（A1–A5 / M1 代码实现缺口） |
| [specs/批次46-D6多用户三池与create_project子方案.md](specs/批次46-D6多用户三池与create_project子方案.md) | 108 | 批次46-D6 · 多用户三池 + create_project + 令牌代理受限令牌（需求/方案定稿） |
| [specs/批次46-真正冲突裁决与摘要合并统计_落地方案.md](specs/批次46-真正冲突裁决与摘要合并统计_落地方案.md) | 206 | 批次46 · 真正冲突裁决 + 摘要合并统计 落地方案（需求定稿） |
| [specs/接入Agent行为规范.md](specs/接入Agent行为规范.md) | 194 | 接入 Agent 行为规范 |
| [specs/改哪里-任务到文件速查.md](specs/改哪里-任务到文件速查.md) | 47 | title: 改哪里：任务 → 文件（AGENTS §3 迁出） |
| [specs/文档对齐确认需求稿.md](specs/文档对齐确认需求稿.md) | 124 | 文档对齐确认需求稿（批次43） |
| [specs/记忆库写入分类与溯源规范.md](specs/记忆库写入分类与溯源规范.md) | 98 | 记忆库写入分类与溯源规范（草案） |
| [specs/记忆库工具能力清单.md](specs/记忆库工具能力清单.md) | 126 | 记忆库工具能力清单（读 / 写 / 管理） |
| [specs/需求规格书.md](specs/需求规格书.md) | 4381 | title: 需求规格书 |
| [specs/需求规格书_Agent接入页字段级交互规格.md](specs/需求规格书_Agent接入页字段级交互规格.md) | 188 | title: 需求规格书_Agent接入页字段级交互规格 |
| [specs/需求规格书_Agent界面内联记忆标识.md](specs/需求规格书_Agent界面内联记忆标识.md) | 101 | title: 需求规格书_Agent界面内联记忆标识 |
| [specs/需求规格书_UI页面设计.md](specs/需求规格书_UI页面设计.md) | 742 | title: 需求规格书_UI页面设计 |
| [specs/需求规格书_其余页面字段级交互规格.md](specs/需求规格书_其余页面字段级交互规格.md) | 249 | title: 需求规格书_其余页面字段级交互规格 |
| [specs/需求规格书_内核API契约.md](specs/需求规格书_内核API契约.md) | 351 | title: 需求规格书_内核API契约 |
| [specs/需求规格书_同步机制详细设计.md](specs/需求规格书_同步机制详细设计.md) | 147 | title: 需求规格书_同步机制详细设计 |
| [specs/需求规格书_大模型与净化生长页字段级交互规格.md](specs/需求规格书_大模型与净化生长页字段级交互规格.md) | 170 | title: 需求规格书_大模型与净化生长页字段级交互规格 |
| [specs/需求规格书_审查结果.md](specs/需求规格书_审查结果.md) | 326 | title: 需求规格书_审查结果 |
| [specs/需求规格书_新增章节_十七_遗忘机制与用户体验设计.md](specs/需求规格书_新增章节_十七_遗忘机制与用户体验设计.md) | 289 | title: 需求规格书_新增章节_十七_遗忘机制与用户体验设计 |
| [specs/需求规格书_新增章节_十八_ID字段整理.md](specs/需求规格书_新增章节_十八_ID字段整理.md) | 237 | title: 需求规格书_新增章节_十八_ID字段整理 |
| [specs/需求规格书_无头浏览器自动采集详细设计.md](specs/需求规格书_无头浏览器自动采集详细设计.md) | 562 | title: 需求规格书_无头浏览器自动采集详细设计 |
| [specs/需求规格书_日志记录页字段级交互规格.md](specs/需求规格书_日志记录页字段级交互规格.md) | 108 | title: 需求规格书_日志记录页字段级交互规格 |
| [specs/需求规格书_检索页字段级交互规格.md](specs/需求规格书_检索页字段级交互规格.md) | 188 | title: 需求规格书_检索页字段级交互规格 |
| [specs/需求规格书_管理员与成员权限设计.md](specs/需求规格书_管理员与成员权限设计.md) | 350 | title: 需求规格书_管理员与成员权限设计 |

## 指纹（P2-18）

任一源码/文档文件内容变化都会让 --check 失败（单行改动也不例外）。

e2e/dev-server.ts d44072ee6d80
e2e/global-setup.mjs ac6a4df65136
e2e/global-teardown.mjs 517d14f4d985
e2e/harness.ts 89419d99cd6f
e2e/run.mjs 3a472110f3e2
e2e/servers.ts 0b132b70df16
src/agentOnboard/client.ts 88721ad65301
src/agentOnboard/formMatrix.ts e7dd02db5873
src/agentOnboard/mcpClients.ts 0b6f39f3b712
src/agentOnboard/probe.ts b1d3392a8393
src/agentOnboard/server.ts e810cc4647d3
src/agentOnboard/service.ts f3d8f7217738
src/agentOnboard/stateMachine.ts 8959634e14b2
src/agentOnboard/validators.ts a7372fc705a7
src/auth/hash.ts 3919b27befef
src/auth/loginService.ts a0cc1ede21f9
src/auth/memberSync.ts dd7d2d4ed60e
src/core/memagent/agent.ts 30e67a6c8db7
src/core/memagent/agentUsage.ts 3a88178c29f8
src/core/memagent/auditLog.ts 041c6c71e76e
src/core/memagent/collectDaemon.ts 1c66b6cd74c0
src/core/memagent/conflict.ts e537b2588f67
src/core/memagent/crypto.ts 6e5f2f4845bb
src/core/memagent/dedup.ts ba546f64836b
src/core/memagent/docTokenSet.ts 4d8f2800119f
src/core/memagent/errors.ts 4f68fde40b23
src/core/memagent/evolution/loop.ts 45b1a26f8e12
src/core/memagent/evolution/recallEval.ts f67978352345
src/core/memagent/evolution/registry.ts af061bbd234e
src/core/memagent/evolution/sceneProfile.ts df834140db47
src/core/memagent/evolution/versioning.ts b45a4d885cec
src/core/memagent/feedbackSignal.ts 17a4faceba0a
src/core/memagent/fieldBackfill.ts bf726e2b5d5b
src/core/memagent/fileStorage.ts d2f5862253b1
src/core/memagent/forgetting.ts 3ea475927107
src/core/memagent/hitHighlight.ts cb393dd329f3
src/core/memagent/l0Recovery.ts c76af3edf9b2
src/core/memagent/l0Split.ts 3ebd7be1d93f
src/core/memagent/l0Store.ts b8a003776bbf
src/core/memagent/l0vault.ts a028bd5a53f9
src/core/memagent/layerRules.ts 2bbfbe0c578f
src/core/memagent/ledgerReset.ts 02fddcaebf0b
src/core/memagent/legacyLayers.ts 8f912218cef5
src/core/memagent/llm.ts 89651995229a
src/core/memagent/mcp.ts 254f31d9601c
src/core/memagent/mcpAuth.ts c916f8e72e4a
src/core/memagent/mcpGcTools.ts ee67d3c47c47
src/core/memagent/mcpGrowthTools.ts c8bc63e8593f
src/core/memagent/mcpHookTools.ts e707647b9eca
src/core/memagent/mcpHttp.ts fb7aaf48246f
src/core/memagent/mcpManageTools.ts 937bfab33cc9
src/core/memagent/mcpProjectTools.ts 465a286c11df
src/core/memagent/mcpReadTools.ts 43f033b6dacc
src/core/memagent/mcpRecall.ts f13d8f75d775
src/core/memagent/mcpSchema.ts eca8a144051d
src/core/memagent/memberStore.ts 7e32317d359b
src/core/memagent/memories.ts 2f81cf66c180
src/core/memagent/paramsSnapshot.ts 16d4f4e24ff1
src/core/memagent/pendingStoreFile.ts 67a02b1b7648
src/core/memagent/pendingWrites.ts ac57f2d79ffb
src/core/memagent/personal.ts 931da2fdf1ef
src/core/memagent/personalStore.ts 97caf77bf9a2
src/core/memagent/personalStoreFile.ts 776412fdd9d6
src/core/memagent/pgSyncHub.ts ba4374a89cc1
src/core/memagent/pointerRoot.ts 66750ad31b63
src/core/memagent/qualityGate.ts adc8639ee61c
src/core/memagent/rebuild.ts 0157d9372c16
src/core/memagent/recallDetailTickets.ts d7553f2a2f3a
src/core/memagent/recallHook.ts c8e9f4b2c794
src/core/memagent/recallHookCli.ts b81496ec718c
src/core/memagent/recallInsight.ts 363c1346efcf
src/core/memagent/recallModes.ts 0af8a378f57c
src/core/memagent/recallPrelude.ts 45fe1e162eb1
src/core/memagent/recallSupersede.ts 05474d039dbe
src/core/memagent/refineQueue.ts 8a4b9204d51d
src/core/memagent/regression.ts 99084341cca4
src/core/memagent/rejudge.ts fbbb37ee97b1
src/core/memagent/sessionCollector.ts feb7886539a5
src/core/memagent/sqliteStorage.ts a39293991388
src/core/memagent/storage.ts eec1bee4ec33
src/core/memagent/sync.ts 137bbd6b4a46
src/core/memagent/tenantNormalize.ts 3cbf77699400
src/core/memagent/tokenStore.ts f91acfd671b5
src/core/memagent/types.ts b4b8c24fbaa8
src/core/memagent/ulid.ts 634c99f1962a
src/core/memagent/vector.ts fac22ffc234b
src/core/memagent/webchatAudit.ts d81d76202825
src/core/memagent/webchatAuditStore.ts e3c4a0a6445e
src/core/memagent/webchatPurge.ts c03228de79fa
src/core/memagent/webhook.ts deae36bbc0ca
src/desktop/hostBridge.ts 8a87ce68cf8c
src/desktop/hostScan.ts 0559ae3ef556
src/desktop/ipcStorage.ts 064dc1cf7381
src/electron/actionLog.ts 4f0d6d2ad7da
src/electron/agentDetect.ts 3c31af9a1ae7
src/electron/agentProbe.ts 5e887368b4c3
src/electron/appShell.ts 41ae53dc8011
src/electron/backupFiles.ts edc4d8fb358f
src/electron/browserLaunch.ts de33c2651ca8
src/electron/chatExportsLocations.ts 99f8a335b775
src/electron/clientProcess.ts 783830f8c67f
src/electron/dataRoot.ts dc31dbbe93f3
src/electron/dataUseGate.ts 83c5c74e205a
src/electron/host-hooks/auto_feedback.mjs f53dd7a62625
src/electron/host-hooks/fold_card_check.mjs 530bc2d166b4
src/electron/host-hooks/session_review.mjs c98f24dd4fcc
src/electron/host-hooks/session_review_patch.mjs d46e2774e1bf
src/electron/hostHookInject.ts 62cca5672b79
src/electron/hostScan.ts 694d58d7048c
src/electron/ipcChannels.ts e99817a01a18
src/electron/l0KeyringStore.ts b900f5d523d5
src/electron/llmBilling.ts d595849943b0
src/electron/llmGateway.ts 0dfcbf3c5612
src/electron/main.ts 444ae5b5f9bc
src/electron/mcpBridgeScript.ts 506265c204e7
src/electron/mcpClients.ts 8db9cdc1acf8
src/electron/mcpProbe.ts 5fb06a238c0b
src/electron/ownerBindings.ts eedb9bf6c881
src/electron/preload.ts d693f01dba97
src/electron/recallGateway.ts 73955c936ed4
src/electron/recallHard.ts 1877162a9fff
src/electron/recallHookScript.ts 7e784cefc324
src/electron/runHostHookAutoInject.ts ce3f4305cf54
src/electron/storageIpc.ts 9edb5f55187a
src/electron/tenantSource.ts 87de24ab1084
src/electron/webchatAutoCollect.ts 9dea505d95f9
src/electron/webchatAutoConfig.ts 1fd81c73e287
src/electron/webchatAutoUa.ts ab336c80f96d
src/electron/webchatExtensionCopy.ts 9883df1f4215
src/electron/webchatExtensionPath.ts 71aba5a6fe3a
src/electron/webchatIdReconcile.ts c59dec54d461
src/electron/webchatIngest.ts 7e48aa26ba9c
src/electron/webchatWindow.ts e17a7abfe59b
src/electron/webhookServer.ts 62157c0b1e21
src/home/dashboard.ts f973b667da77
src/home/mirrorLedger.ts 83e75baca8b1
src/home/server.ts 372d3d99a1a5
src/shared/actionLog.ts 4183f74a0f21
src/shared/auditShape.ts 5d37cae8c5f0
src/shared/billing.ts facfb1675b7a
src/shared/cron.ts 8cd43de3e89c
src/shared/dataLayout.ts 1aa79e3a4b99
src/shared/growthConfig.ts fba8bdda6efe
src/shared/growthSchedule.ts 7e5a8f5bc20e
src/shared/localOrigin.ts 26f99e4f1928
src/shared/memoryOwnership.ts b21d67b37ebd
src/shared/normalParams.ts b76252aaf3e9
src/shared/passwordPolicy.ts b1a87dd48d23
src/shared/pendingWritesView.ts ae69b7effb0a
src/shared/proxyAccounting.ts 5af6f44a262f
src/shared/recallHardConfig.ts 5e9e6963bd81
src/shared/sessionKey.ts ab2fa7617802
src/shared/tenantDefaults.ts 881e1ff9c969
src/shared/timeWindow.ts a3da99f12d96
src/shared/webchatSites.ts c3c69f88cd38
src/types/agentOnboard.ts d4d887c55e8a
src/types/home.ts 15302ed61695
src/web/AgentOnboard/AgentCard.tsx df404ea03e97
src/web/AgentOnboard/AgentOnboardPage.tsx 99b823d0782d
src/web/AgentOnboard/ChannelConfig.tsx 9b111c1c1fdf
src/web/AgentOnboard/FormBadge.tsx 644f3afe087e
src/web/AgentOnboard/Gains.tsx 5dd221d1770f
src/web/AgentOnboard/IsolationConfig.tsx 2a3edf27b907
src/web/AgentOnboard/KeyMgmt.tsx c8c13f8fd862
src/web/AgentOnboard/McpClientsPanel.tsx 03a71d81a585
src/web/AgentOnboard/McpToolConfig.tsx cef6b07e12d8
src/web/AgentOnboard/OneClickOnboard.tsx a305419930bd
src/web/AgentOnboard/TestPanel.tsx b1393f12c729
src/web/AgentOnboard/WebChatExportCard.tsx 1f101a4c0682
src/web/AgentOnboard/agentOnboardEntry.tsx 84134b804309
src/web/AgentOnboard/autoDiscovery.ts 6de3dc6af7b7
src/web/AgentOnboard/autoOnboard.ts 2e2bbfc5bec8
src/web/AgentOnboard/cards.ts 3dc5d5885b15
src/web/AgentOnboard/coreOnboard.ts 7da3db6225e5
src/web/AgentOnboard/ledger.ts ea78efccf395
src/web/AgentOnboard/onboardState.ts 3b1368aac6d8
src/web/AgentOnboard/startupAutoOnboard.ts 5c3242001170
src/web/AgentOnboard/store.ts 0e28d5609de5
src/web/AgentOnboard/useBackendMirror.ts 80448ad1330f
src/web/Home/Dashboard.tsx cca3228b5b3b
src/web/Home/HomePage.tsx 4e072431b79a
src/web/Home/LayerGraphPanel.tsx e09decb483a2
src/web/Home/LoginModal.tsx c9224c5e3622
src/web/Home/ProgramLogPanel.tsx 248e99020536
src/web/Home/TopBar.tsx 5a0e8315bc3a
src/web/Home/coreHome.ts 34b44411c9af
src/web/Home/crossTabAuth.ts d85780df575e
src/web/Home/layerGraph.ts febed7958dbd
src/web/Home/layerGraphLayout.ts 8215d57492af
src/web/Home/programLog.ts 4dd7748fe50e
src/web/Home/programLogLabels.ts 18fbabdfd8a3
src/web/Home/tenantContext.tsx b156eb584b46
src/web/Home/useLoginMirror.ts 117ba2379474
src/web/assistant/AssistantPage.tsx bdfdfe108b64
src/web/assistant/assistantEntry.tsx baba7df9f187
src/web/audit/AuditPage.tsx ce1badf638b6
src/web/audit/AuditTable.tsx d48ead17238b
src/web/audit/ChainView.tsx 2e3cf25031ce
src/web/audit/FilterBar.tsx 0d3a04459dec
src/web/audit/auditEntry.tsx c6055389d0fa
src/web/audit/auditLink.ts c202a89c574b
src/web/audit/coreAudit.ts 232bdb8cf17a
src/web/audit/logic.ts 978410b52815
src/web/audit/types.ts 71090ca7cf55
src/web/audit/useAuditMirror.ts 34865de958b6
src/web/audit/useToast.tsx 85cd09d2e1f5
src/web/backend.ts 8fdc10aa241d
src/web/dispute/DisputePage.tsx 92d6b42cc0b6
src/web/dispute/DisputeQueue.tsx caf114a20325
src/web/dispute/DisputeVerdict.tsx ef4c2d7c89dc
src/web/dispute/coreDispute.ts 9c83acf7ad55
src/web/dispute/disputeEntry.tsx 2a5b7885df73
src/web/dispute/labels.ts c6d8f1dcee8f
src/web/dispute/logic.ts 922708539fd5
src/web/dispute/types.ts 34294be31812
src/web/dispute/useDisputeMirror.ts a2f4cf373f8e
src/web/dispute/useToast.tsx c650d8662672
src/web/feedback/FeedbackForm.tsx eb7968b39821
src/web/feedback/FeedbackPage.tsx b7f9394afb5e
src/web/feedback/StatCards.tsx 826d2fdad9f4
src/web/feedback/coreFeedback.ts 560324173433
src/web/feedback/feedbackEntry.tsx 8e909b081887
src/web/feedback/logic.ts 176b33a17311
src/web/feedback/types.ts 938ae560ed3e
src/web/feedback/useFeedbackMirror.ts 6bd1d844d78c
src/web/feedback/useToast.tsx 85cd09d2e1f5
src/web/growth/DedupCards.tsx 0c5a269cd031
src/web/growth/EvolutionSettingsCard.tsx ad64cb528d62
src/web/growth/EvolutionTimelineCard.tsx 088fb106cd4d
src/web/growth/GrowthPage.tsx 5cdcff9a06f0
src/web/growth/GrowthPanels.tsx df58608587b0
src/web/growth/coreGrowth.ts 57c4391b3953
src/web/growth/evolutionTimeline.ts 1b59c5b24459
src/web/growth/growthEntry.tsx 5b43a02238b6
src/web/growth/logic.ts 53b37d83d095
src/web/growth/recallLabels.ts 9f010c2413f0
src/web/growth/spec.ts b0d713d66185
src/web/growth/types.ts cd1bd54d375f
src/web/growth/useGrowthMirror.ts f485e5b5dae2
src/web/growth/useGrowthReal.ts d92ea73cb5f5
src/web/growth/useToast.tsx 85cd09d2e1f5
src/web/hostLlm.ts 6b12c99be4b7
src/web/httpStorage.ts d08876fec3ca
src/web/kernel.ts 41e2a5d2c068
src/web/lifecycle/LifecycleCard.tsx c115dc841539
src/web/lifecycle/LifecyclePage.tsx 4e18d5cdec04
src/web/lifecycle/ParamPanel.tsx 5858a0c4c600
src/web/lifecycle/constants.ts 4bbab102ec8b
src/web/lifecycle/coreLifecycle.ts 7c3cb28673de
src/web/lifecycle/lifecycleEntry.tsx 0ccca9e21d58
src/web/lifecycle/lifecycleFilter.ts 1f8538e5fdb8
src/web/lifecycle/logic.ts 7574f2b0fe12
src/web/lifecycle/types.ts b96b0c4d96c0
src/web/lifecycle/useLifecycleMirror.ts 99f7105a6f07
src/web/lifecycle/useToast.tsx 85cd09d2e1f5
src/web/login/LoginPage.tsx ab7ef832b9a9
src/web/login/loginEntry.tsx 9855ac21b42f
src/web/logs/LogCards.tsx e3dba55283de
src/web/logs/LogFilterBar.tsx b492a3d50ea4
src/web/logs/LogsPage.tsx 4c1da31d25bc
src/web/logs/coreLogs.ts 84d97af9ba74
src/web/logs/labels.ts fc3ba5a3c9fc
src/web/logs/logic.ts 7ca2470ef6ff
src/web/logs/logsEntry.tsx e9e70ec7c1d4
src/web/logs/types.ts c57557c7576e
src/web/logs/useToast.tsx 85cd09d2e1f5
src/web/main.tsx c3a2e36cac32
src/web/mcp/McpPage.tsx c8af6da0982b
src/web/mcp/mcpEntry.tsx 94cd27be0cf2
src/web/memory/LayerFilterBar.tsx 6b31c2ec98dc
src/web/memory/LayerMemoryTable.tsx 351b89d07ecf
src/web/memory/MemoryActions.tsx 9983e64102b0
src/web/memory/MemoryDrawer.tsx 7c124fc0ce30
src/web/memory/MemoryLayeredPage.tsx 44dfb97062d3
src/web/memory/MemoryManagementPage.tsx 7b85d77d6d65
src/web/memory/MemoryPage.tsx f85d97504af7
src/web/memory/MemoryRow.tsx c9e3667cfed7
src/web/memory/MemoryTable.tsx d0e26f9d929e
src/web/memory/PersonalMemoryPane.tsx 3b007c3de088
src/web/memory/backup.ts 30b82c06df00
src/web/memory/coreMemoryOps.ts 103a913bf502
src/web/memory/dataRoot.ts 6a1b94c2d4d7
src/web/memory/layerFilter.ts 1940d5a207df
src/web/memory/logic.ts da69f12783ea
src/web/memory/memoryEntry.tsx 2107074b22d3
src/web/memory/memoryFilter.ts e2b9121687e5
src/web/memory/memoryLayeredEntry.tsx b4051dc9ce5a
src/web/memory/personalEntry.tsx e98f600923fd
src/web/memory/types.ts 51eb8e91195f
src/web/memory/useMemoryMirror.ts 50fcdb730ba3
src/web/memory/useToast.tsx c650d8662672
src/web/mirrorClient.ts f097d285d960
src/web/models/BillingPanel.tsx 0653b59b0646
src/web/models/LlmUsageTable.tsx 9002f88cf3f1
src/web/models/ModelsPage.tsx 334efc29b401
src/web/models/ProxyPanel.tsx 702e3e775f9b
src/web/models/VectorCard.tsx f9951358d9c0
src/web/models/catalog.ts 79a4992557bf
src/web/models/coreModels.ts 7dd6087867a7
src/web/models/logic.ts 873eb0d7c213
src/web/models/modelConfig.ts 929edda56559
src/web/models/modelsEntry.tsx 3ddbadcf3a9e
src/web/models/types.ts 973af42c99c1
src/web/models/useToast.tsx 85cd09d2e1f5
src/web/monitor/AlertTimeline.tsx 80cd26596f27
src/web/monitor/MetricGrid.tsx 6787dcb57a78
src/web/monitor/MonitorPage.tsx dcae6485d7aa
src/web/monitor/coreMonitor.ts 6b0c29922b63
src/web/monitor/logic.ts 047ec4b39ad1
src/web/monitor/monitorEntry.tsx 2638a6e28a30
src/web/monitor/operationState.ts e7185e07928b
src/web/monitor/options.ts 59d853ad7cd4
src/web/monitor/types.ts d685ccc9f522
src/web/monitor/useMonitorMirror.ts 9e87dd8cc071
src/web/monitor/useMonitorReal.ts 410375263793
src/web/monitor/useToast.tsx 85cd09d2e1f5
src/web/overview/McpSwitchAlert.tsx a2936cd108fa
src/web/overview/Overview.tsx 65ea4893c6fb
src/web/overview/OverviewPage.tsx 6aefd60121a1
src/web/overview/overviewEntry.tsx 5f4488678cc7
src/web/overview/overviewPageData.ts c848c75900dc
src/web/params/AppShellCard.tsx e362c323daf5
src/web/params/DevPanel.tsx 58ca53015c5a
src/web/params/KbManagementCard.tsx a8c0b581a8c2
src/web/params/KbPolicyTable.tsx c39b52ed1039
src/web/params/LlmEngineCard.tsx 4c938ef647cb
src/web/params/NormalConfigCard.tsx f74ba365da82
src/web/params/ParamsPage.tsx 6fd082062446
src/web/params/RecallHardCard.tsx b6f0e097dec2
src/web/params/RefineQueueCard.tsx 704d8988fed9
src/web/params/SyncTeamCard.tsx 81dbd4fbda8b
src/web/params/appShell.ts d319152b4c42
src/web/params/coreParams.ts eb68c0358860
src/web/params/defaults.ts 6dd5728ef0ec
src/web/params/llmEngine.ts bd46b6e725ef
src/web/params/logic.ts 1e5af0361e3b
src/web/params/paramsEntry.tsx b515fd3e8d65
src/web/params/recallHard.ts 00698201ab5e
src/web/params/refineQueue.ts 00f06b45c16c
src/web/params/types.ts 9840a32c5e5d
src/web/params/useParamsMirror.ts 5529b48cfccc
src/web/params/useToast.tsx 85cd09d2e1f5
src/web/retrieval/AuditTrailCard.tsx 0b7d40ddc359
src/web/retrieval/BudgetPanel.tsx 903af44940e8
src/web/retrieval/ContextPanel.tsx 61fc5aa1874b
src/web/retrieval/ModeBanner.tsx 98448e08ff36
src/web/retrieval/QueryBar.tsx e71cc4ec5c07
src/web/retrieval/RecentRecallsCard.tsx 1fe75e7b60b5
src/web/retrieval/ResultList.tsx 828b3e116759
src/web/retrieval/ResultRow.tsx abbc0777107d
src/web/retrieval/RetrievalPage.tsx 6f04c48854de
src/web/retrieval/coreEngine.ts e648fecae92d
src/web/retrieval/logic.ts e45203afb2a1
src/web/retrieval/retrievalEntry.tsx a366c3b7e155
src/web/retrieval/types.ts adefaf6846de
src/web/retrieval/useRetrieval.ts 48cee0abfa58
src/web/retrieval/useToast.tsx 85cd09d2e1f5
src/web/security/AccountAdminCard.tsx 23692c9117df
src/web/security/FieldBackfillCard.tsx 69f6eb2d2c4e
src/web/security/L0AdminCard.tsx 953d3c1577a3
src/web/security/L0FilteredCard.tsx e5dc0b626d02
src/web/security/L0MigrateCard.tsx 5697922c5b40
src/web/security/L0OwnerBackfillCard.tsx 2be8af4cc9c7
src/web/security/L0RecoveryCard.tsx a40305a2fe9a
src/web/security/L0SplitCard.tsx f563aab06852
src/web/security/LedgerResetCard.tsx f3ddf342303b
src/web/security/LegacyLedgerCard.tsx c1251636ef98
src/web/security/MyWriteWrapCard.tsx 8c35ae6e9ebd
src/web/security/OwnerBindingsCard.tsx acbdb640afe9
src/web/security/PwdPolicyCard.tsx ad12fb5ffafb
src/web/security/RebuildFromL0Card.tsx d95cb49f94fb
src/web/security/RulesRejudgeCard.tsx 85c96b3a0bb5
src/web/security/SecurityCards.tsx 30ab0c49a8a4
src/web/security/SecurityPage.tsx 877fa5bb81f8
src/web/security/TenantIdentityCard.tsx dd3e743a7c63
src/web/security/accountsClient.ts eb1bb2f85768
src/web/security/coreSecurity.ts 66cce020b7e0
src/web/security/defaults.ts e5b4b56b9629
src/web/security/logic.ts 8b9c8e8ce379
src/web/security/ownerBindingLabels.ts 34b45cbb4187
src/web/security/securityEntry.tsx 2e5268781ae1
src/web/security/tenantLabels.ts fa5d04b2399c
src/web/security/types.ts 7a4d935eaa18
src/web/security/useSecurityMirror.ts 26ac38844bbb
src/web/security/useToast.tsx 85cd09d2e1f5
src/web/setup/SetupPage.tsx 0ac37b3ac4fd
src/web/setup/setupEntry.tsx 4da0cba9fe95
src/web/shared/DemoBadge.tsx 29e08265f189
src/web/shared/L0WriteUnlock.tsx 38d5120b2f19
src/web/shared/PageNav.tsx d5949856df04
src/web/shared/actionLog.ts f21305492f55
src/web/shared/detectForm.ts 9e5c1e8c8423
src/web/shared/hostTheme.ts a9c462fce846
src/web/shared/kernelLoad.tsx 0cdf4dcbbe61
src/web/shared/kernelProjects.ts e204655f0df7
src/web/shared/l0BlobStore.ts a7ae63e8ff9b
src/web/shared/l0Port.ts edca14aaacd2
src/web/shared/l0WriteLockSignal.ts 57f703202bc8
src/web/shared/l0WriteState.ts 5b64d9917e88
src/web/shared/layerTime.ts 6c21b4d94211
src/web/shared/mcpPending.ts 34a40dcaa3b7
src/web/shared/mcpSwitch.ts 480a931c5a0b
src/web/shared/mirrorFailureEvent.ts b3b97ae09cd1
src/web/shared/mirrorFailureNotice.ts 3b984898459c
src/web/shared/navCountChannel.ts 2ff74d708920
src/web/shared/navStatusChannel.ts 50e6cef23752
src/web/shared/pagerWindow.ts 7a7f654d9236
src/web/shared/paginate.ts 2d638d875228
src/web/shared/personalPort.ts 382404bb7f39
src/web/shared/selectionChannel.ts e826341f42e1
src/web/shared/session.ts 2f12ae76e21f
src/web/shared/shellNavigate.ts b8b75188302d
src/web/shared/syncHub.ts 349bcf10add9
src/web/shared/useColWidths.tsx a6e14931a82b
src/web/shared/useL0Session.ts c917a61c99d9
src/web/shell/CommandPalette.tsx 2c96d2eb4d53
src/web/shell/ContextMenu.tsx e2dcb1ea4ce9
src/web/shell/Icons.tsx 5de5760aebcd
src/web/shell/PersonalMemoryPanel.tsx 503039e2151c
src/web/shell/ShellLoginDialog.tsx eab40cd6a2f5
src/web/shell/ShellStatusCard.tsx 7d32fed1101d
src/web/shell/StrataScale.tsx e01e72a67aca
src/web/shell/Workspace.tsx da7d437f4229
src/web/shell/dock.ts ef9dface9fb6
src/web/shell/humanLog.ts 961e90e0e45a
src/web/shell/layers.ts ee5f32438ab6
src/web/shell/navCounts.ts 29d436b7129f
src/web/shell/overview.ts 93cff1c56339
src/web/shell/shellStatus.ts 228e63b93b1b
src/web/shell/statusbar.ts 80aacde4f035
src/web/shell/strataScale.ts 1f27d6bde9d4
src/web/shell/taskpane.ts e1a473006974
src/web/shell/views.ts 89c5b9407dfe
src/web/shell/workspaceEntry.tsx d81475dafbfc
src/web/sync/SyncPage.tsx df8c504e7199
src/web/sync/coreSyncPage.ts 39e067006bd4
src/web/sync/syncEntry.tsx 171d7d65e1ef
src/web/test-setup.ts 3a2ad06d2218
src/web/vite-env.d.ts 191b7a12f3de
src/web/webonboard/WebOnboardPage.tsx e9ce3ef1dc62
src/web/webonboard/WebchatAutoCard.tsx 02aa83ce9b8d
src/web/webonboard/webOnboardEntry.tsx e25174eac855
src/web/webonboard/webchatAuto.ts c970dfeeb985
src/web/write/DedupCard.tsx 8011ea804b0a
src/web/write/WriteForm.tsx 7306202d4d31
src/web/write/WriteL0UnlockCard.tsx d70605533523
src/web/write/WritePage.tsx 71cfa0513c23
src/web/write/WriteReceiptCard.tsx 75ad8c192155
src/web/write/coreWrite.ts 6b8ecfa21216
src/web/write/logic.ts a9e234e05f27
src/web/write/spec.ts 005b81ee6d61
src/web/write/types.ts 0e992abab5f0
src/web/write/useToast.tsx c650d8662672
src/web/write/useWriteMirror.ts 699df53d6c7c
src/web/write/writeEntry.tsx a1f5c6bd7227
README.md aa2f62fda68e
specs/A31-BILLING-MATRIX.md adf99c88971d
specs/AUDIT-FULL-REVIEW-2026-10-31.md 9b268c1a3db7
specs/DECISION-2026-11-12-方案对比与融合自发现架构.md eab4f0c03c80
specs/MANUAL-TEST-BATCH-57B.md 5f53fa04493b
specs/MANUAL-TEST-BATCH-57C.md 6244ef645fb7
specs/MANUAL-TEST-BATCH-57D.md 99d361d7397f
specs/MANUAL-TEST-BATCH-58.md 221b531b7b8b
specs/MANUAL-TEST-BATCH.md c5b9d5e11090
specs/MANUAL-TEST-FIX-BATCH-1.md 3ca0e503a7c8
specs/MANUAL-TEST-FIX-BATCH-10.md 732e0ba3e5ef
specs/MANUAL-TEST-FIX-BATCH-11.md b5b379760c89
specs/MANUAL-TEST-FIX-BATCH-12.md 693eb203323a
specs/MANUAL-TEST-FIX-BATCH-13.md a5b9803ccdb4
specs/MANUAL-TEST-FIX-BATCH-14.md a8997589569e
specs/MANUAL-TEST-FIX-BATCH-15.md ced4f05fd684
specs/MANUAL-TEST-FIX-BATCH-16.md 8aca9af34a09
specs/MANUAL-TEST-FIX-BATCH-17.md 127b9a39b75a
specs/MANUAL-TEST-FIX-BATCH-18.md d6d3ec740f55
specs/MANUAL-TEST-FIX-BATCH-19.md 24b180f5bc30
specs/MANUAL-TEST-FIX-BATCH-2.md f45a00ea96d8
specs/MANUAL-TEST-FIX-BATCH-20.md 9239bf954d03
specs/MANUAL-TEST-FIX-BATCH-21.md 26076c8a9d12
specs/MANUAL-TEST-FIX-BATCH-22.md 50fb0613fe6b
specs/MANUAL-TEST-FIX-BATCH-23.md 767ed17c6c8f
specs/MANUAL-TEST-FIX-BATCH-24.md 1f96cdd40d00
specs/MANUAL-TEST-FIX-BATCH-25.md 8bd6f9ec8f79
specs/MANUAL-TEST-FIX-BATCH-26A.md cb245dc919d5
specs/MANUAL-TEST-FIX-BATCH-26B.md 115044019eb8
specs/MANUAL-TEST-FIX-BATCH-27.md 4efe12417a3e
specs/MANUAL-TEST-FIX-BATCH-28.md e58374122ea6
specs/MANUAL-TEST-FIX-BATCH-29.md 1bcd9a770476
specs/MANUAL-TEST-FIX-BATCH-3.md 573b2a46ac68
specs/MANUAL-TEST-FIX-BATCH-30.md 1a738fe7ff44
specs/MANUAL-TEST-FIX-BATCH-31.md 514c24dde81c
specs/MANUAL-TEST-FIX-BATCH-32.md ab363a88a15f
specs/MANUAL-TEST-FIX-BATCH-33.md 22e822a48607
specs/MANUAL-TEST-FIX-BATCH-34.md 9d39a2dda854
specs/MANUAL-TEST-FIX-BATCH-35.md bc952f6ab346
specs/MANUAL-TEST-FIX-BATCH-36.md 1f94a0619368
specs/MANUAL-TEST-FIX-BATCH-37.md 43e129a6d272
specs/MANUAL-TEST-FIX-BATCH-38.md 0ac0217b0860
specs/MANUAL-TEST-FIX-BATCH-39.md b9c1ca54f67a
specs/MANUAL-TEST-FIX-BATCH-4.md 1faff2c94003
specs/MANUAL-TEST-FIX-BATCH-40.md 1112c8867cc2
specs/MANUAL-TEST-FIX-BATCH-41.md c6f643fb39e4
specs/MANUAL-TEST-FIX-BATCH-42.md a18f57451cf9
specs/MANUAL-TEST-FIX-BATCH-43.md 2dedbd589804
specs/MANUAL-TEST-FIX-BATCH-44.md 0489c4609c36
specs/MANUAL-TEST-FIX-BATCH-45.md 73811ac13df3
specs/MANUAL-TEST-FIX-BATCH-46.md 38b448c7148f
specs/MANUAL-TEST-FIX-BATCH-47.md 48d33e1a2de5
specs/MANUAL-TEST-FIX-BATCH-48.md 01807e7b7faf
specs/MANUAL-TEST-FIX-BATCH-49.md ac995c6fffda
specs/MANUAL-TEST-FIX-BATCH-5.md 7620dff494e4
specs/MANUAL-TEST-FIX-BATCH-50.md 1a50a72bcc39
specs/MANUAL-TEST-FIX-BATCH-51.md 01f3f853d0ff
specs/MANUAL-TEST-FIX-BATCH-52.md ad9982e829ad
specs/MANUAL-TEST-FIX-BATCH-53.md aeb6849babfa
specs/MANUAL-TEST-FIX-BATCH-54.md 4c6f55df0afa
specs/MANUAL-TEST-FIX-BATCH-55.md 4b2bce6a3069
specs/MANUAL-TEST-FIX-BATCH-56.md d8d8e5827554
specs/MANUAL-TEST-FIX-BATCH-57.md 0b5ef1fa5210
specs/MANUAL-TEST-FIX-BATCH-6.md c54de515c35c
specs/MANUAL-TEST-FIX-BATCH-7.md ae151c45c321
specs/MANUAL-TEST-FIX-BATCH-8.md 486d92ec3ba0
specs/MANUAL-TEST-FIX-BATCH-9.md 447ad4b41a67
specs/MANUAL-TEST-PHASE-A.md 0bf20313dd75
specs/MANUAL-TEST-PHASE-B.md 9134fcd5168d
specs/MANUAL-TEST-PHASE-C.md 9de54526de41
specs/MANUAL-TEST-PHASE-D.md 0393a1f055b1
specs/MANUAL-TEST-PHASE-E.md b4da1f2f1a2e
specs/MANUAL-TEST.md 4d755324cafe
specs/MCP运维与多Agent写入规范.md 752368c085eb
specs/POSTMORTEM-2026-11-11-静默失效与双通路自发现方案.md 4578ad1a2c7a
specs/RECALL-HARD-PREFIX.md 893d59265843
specs/ROADMAP-批次42-未接线三件套-方案.md df1a6f9d6ed5
specs/ROADMAP-批次45-租户归一与成员密钥域模型-方案.md 633abaaaad54
specs/ROADMAP-批次B类-远端PG与多机硬过滤-方案.md 0c7857454a7d
specs/STRATUM-设计系统规格.md 375da8d11302
specs/acceptance.md 22e711c8939c
specs/code-map.md 5227aa0377cd
specs/demo-data-baseline.md 1d9af215ac78
specs/memory-loop-enhancement-plan.md f47ac02bca3d
specs/project_id配置化_工程化落地方案.md aecc14b503c9
specs/project_id零配置_详细实施方案.md 688c791a22bb
specs/recall-echo-contract.md 3658f5e100b8
specs/reports/BATCH48-FIX-REPORT.md 7d62836888ad
specs/reports/RECALL-WEEK-PLAN.md 9747f8a52112
specs/reports/T4-存量明文盘点-2026-11-12.md 6dbc307b0320
specs/reports/WEBCHAT-ID-RECONCILE-PLAN.md 64327356860c
specs/reports/auto-mode-weights-eval-2026-11-25.md 645c996432db
specs/reports/dsh-hindsight-local-对比与借鉴-2026-11-14.md 505ceb6e31e6
specs/reports/dsh-hindsight-local-调研报告-2026-11-14.md 6a90063ae5da
specs/reports/hindsight-comparison-2026-11-24.md 977e25f5adb2
specs/reports/hindsight-comparison-and-roadmap-2026-11-21.md 1742b549d768
specs/reports/hindsight-追赶实施方案-2026-11-22.md 2e60acc36f91
specs/reports/p1-5-bm25-feasibility-2026-11-22.md 2512e3d88715
specs/reports/p1-6-7-8-reevaluation-2026-11-23.md e594da80c4b9
specs/reports/p1-6-offline-eval-2026-11-23.md bc1714b1260d
specs/reports/recall-quality-progress-2026-11-21.md de336dc45bf1
specs/reports/recall-weights-offline-eval-2026-11-22.md 7cb99bd074b3
specs/reports/召回模式全程序审查报告-2026-11-13.md e91202c37a63
specs/reports/审查-Agent侧记忆库与净化生长打通-2026-11-12.md ab5e7d6e7390
specs/requirements.md d4f76b0df902
specs/tasks/AGENT-ONBOARD.md 900d19783798
specs/tasks/AUDIT-LOG.md b778c455d43d
specs/tasks/CONFLICT.md c894269434e1
specs/tasks/CORE-AGENT.md 7987b75fbe3a
specs/tasks/FEEDBACK.md 31eb401168c3
specs/tasks/FORGETTING.md ffeae5ece068
specs/tasks/GLOBAL-PARAMS.md edd78e0bf912
specs/tasks/GROWTH-AGENT-EVOLUTION.md 98826ff21587
specs/tasks/GROWTH.md 658ccf9fc2e8
specs/tasks/HOME-LOGIN.md 835294c0f1ef
specs/tasks/LIFECYCLE.md 9c03e85fc540
specs/tasks/LLM-CONFIG.md 40b08d305f08
specs/tasks/LOGS.md a6eaff19bc00
specs/tasks/MEMORY-MANAGE.md a586bcf0d38c
specs/tasks/MONITOR.md d37cef8d352e
specs/tasks/RECALL-ECHO-RAG.md 1dfd636c66d8
specs/tasks/RECALL-HIGHLIGHT.md ed83180a0849
specs/tasks/RECALL-SCORE-FIX.md 60241239cf8f
specs/tasks/RECALL-SHAPING-P1.md 95d36635f6b1
specs/tasks/RECALL-SHAPING.md ea503c66775f
specs/tasks/RETRIEVAL.md c9a2b6c83a87
specs/tasks/SECURITY.md 8a4a4441bc8f
specs/tasks/SELF-EVOLUTION.md 0c8859348583
specs/tasks/SETUP.md 21f41f4ab238
specs/tasks/SYNC.md 6271b8a85d1e
specs/tasks/USER-REGISTER.md 2c4bdb921f96
specs/tasks/WRITE-PAGE.md 0062573b1e9f
specs/test-plan.md d478bcfa10a3
specs/topbar-consolidation-2026-11-08.md 3765d20edef7
specs/topbar-restore-compare-2026-11-08.md 65bdc9089a21
specs/working-set/agent-memory-sop.md bb07201d464d
specs/working-set/draft-tool-inventory.md 1a5a8399465d
specs/working-set/external-source/multiagent-memory-ops/agent-memory-sop.md a321ec2970eb
specs/working-set/external-source/multiagent-memory-ops/archive/draft-contract-multiuser.md 3f3f59e02765
specs/working-set/external-source/multiagent-memory-ops/archive/draft-sop-multiuser.md 11dc8d52dbf7
specs/working-set/external-source/multiagent-memory-ops/archive/draft-tool-inventory.md 1a5a8399465d
specs/working-set/external-source/multiagent-memory-ops/mcp-extension-contract.md 3c44fec7f85b
specs/working-set/external-source/multiagent-memory-ops/multiuser-design-status.md 55c32084c05f
specs/working-set/mcp-extension-contract.md 3c44fec7f85b
specs/working-set/multiuser-design-status.md 55c32084c05f
specs/workspace-view-gap-2026-11-08.md 05e258838ea9
specs/召回模式SystemPrompt模板.md f4a10a6f2d6c
specs/召回模式设计与实现方案.md 36beb430649c
specs/多用户三池隔离设计_D1-D25.md d0fc00a9fade
specs/已知边界台账.md e04d68ece4c7
specs/开发纪律_三道闸门.md d9f5ee298a8a
specs/批次44-D5工具面落地子方案.md 01cc6b6cc89d
specs/批次44-吸收项落地设计.md 2ced9348f942
specs/批次46-D6多用户三池与create_project子方案.md 17236628021f
specs/批次46-真正冲突裁决与摘要合并统计_落地方案.md 30403514d0a1
specs/接入Agent行为规范.md f66474597609
specs/改哪里-任务到文件速查.md 86efe439fccd
specs/文档对齐确认需求稿.md 5da42259c355
specs/记忆库写入分类与溯源规范.md 2fb0f14ebadc
specs/记忆库工具能力清单.md 5da556d65280
specs/需求规格书.md 67a0d93938bb
specs/需求规格书_Agent接入页字段级交互规格.md 5abdf956efd3
specs/需求规格书_Agent界面内联记忆标识.md 01227d78ce47
specs/需求规格书_UI页面设计.md 5c4da6598034
specs/需求规格书_其余页面字段级交互规格.md 2e060478caac
specs/需求规格书_内核API契约.md 7ea3677b0a9b
specs/需求规格书_同步机制详细设计.md d65a3a654ee5
specs/需求规格书_大模型与净化生长页字段级交互规格.md 3100266733ce
specs/需求规格书_审查结果.md 8ec4ea7802d9
specs/需求规格书_新增章节_十七_遗忘机制与用户体验设计.md ee61524897aa
specs/需求规格书_新增章节_十八_ID字段整理.md ee6b806565fe
specs/需求规格书_无头浏览器自动采集详细设计.md dd5fd41a4771
specs/需求规格书_日志记录页字段级交互规格.md b44afab6b9cb
specs/需求规格书_检索页字段级交互规格.md e6fa32f907de
specs/需求规格书_管理员与成员权限设计.md 5a6a81f5f6be
