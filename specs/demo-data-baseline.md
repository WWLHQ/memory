# 演示/种子数据基线清单（批次42 · 阶段0 冻结）

> 生成：2026-11-04｜用途：作为阶段6 `tools/check-no-demo.mjs` 门禁的白名单基线，逐批清零 A/B/D/E 类。
> 口径：基于全量审查 + 同日本仓 grep 校准（`FakeLlmProvider|PROXY_CATALOG|forceBreach|forceTimeout|claude-free|gpt4o-mini|local-small|INJECTED|DEFAULT_PROJECT_ID|Admin@123456|demo1234|seedMemory|getKernelWithSeed|演示级|演示用|契约级演示|占位|safe-noop|dryRun`），排除 `__tests__/e2e/design/tools/archive`。
> 处置分类：**A 必删**（真违反红线）｜**B 必补真实实现**｜**C 诚实降级保留**（重新标注）｜**D 非软件资产隔离**｜**E 种子预置**（确认处置）。

## 0. 门禁基线数值（阶段0 实测）
| 门禁 | 结果 |
|---|---|
| typecheck（`tsc --noEmit` 双配置） | 通过 |
| lint（oxlint，503 文件 / 123 规则） | 0 warning / 0 error |
| code:index:check | 通过（308 文件最新） |
| 覆盖率（vitest --coverage） | lines 84.94% · statements 81.91% · functions 77.99% · branches 74.18% |
| E2E（上次 test-results） | passed |
| git status | 阶段0 仅新增 `specs/` 两文件 + 仓库外备份，未改源码 |

## 1. 账本备份（阶段0 动作①）
- 位置：`D:/Work Folder/Agnet/Deepseek Harness/_phase0-baseline-backup-20261104T153500/`（**仓库外，不入库**）
- 内容：`memories.db.json`(2020986B) / `memories.l0.json`(889303B) / `audit.jsonl`(3725104B) / `l0-keyring.json`(410B) / `data-root.json`(283B)
- 校验：5 文件 `src==dst` 字节一致
- 注意：桌面端运行时快照（15:34–15:38 仍有写入），非事务一致；仅作最后兜底恢复

## 2. A 类·必删（真违反红线）
| # | 文件:行 | 非真实内容 | 运行时可见 | 阶段 |
|---|---|---|---|---|
| A1 | `src/core/memagent/llm.ts:6,11-13` | `FakeLlmProvider` 假模型表（claude-free/gpt4o-mini/local-small，price/quota/used 假值）；`call()` 返「[model]+prompt前40字」假输出 | 是（内核默认回退） | 3 |
| A2 | `src/core/memagent/mcp.ts:68`、`mcpHttp.ts:117`、`src/web/kernel.ts:188,204` | 装配 `FakeLlmProvider` 为默认 LLM | 是 | 3 |
| A3 | `src/web/models/catalog.ts:49-54` | `PROXY_CATALOG` 虚构代理源（claude-code/cursor-trial/codex/x-agent）+ 假 price/quota | 是（模型页首屏） | 3 |
| A4 | `src/web/models/coreModels.ts:50,59,89`（+`82,92` dryRun） | 用 `PROXY_CATALOG` 造 `ModelInfo` | 是 | 3 |
| A5 | `src/web/models/ModelsPage.tsx:24` | 首屏 `PROXY_CATALOG.map(c=>({...c,used:0}))` 假目录 | 是（首屏即假） | 3 |
| A6 | `src/web/retrieval/useRetrieval.ts:25,34,40` | `forceTimeout`/`forceBreach` 参数 + 篡改真结果（payload_tokens=3100/breach=true/breach_detail 写死） | 是 | 2 |
| A7 | `src/web/retrieval/RetrievalPage.tsx:74,120,121` | 模拟硬熔断/模拟超时按钮（伪造数据） | 是 | 2 |
| A8 | `src/web/retrieval/coreEngine.ts:89,118,123` | `project_id` 写死 `'P1'`；`pipeline_llm_tokens:640` 写死；`breach_detail` 写死文案 | 是 | 2 |
| A9 | `src/web/write/WritePage.tsx:18` | `INJECTED={session_id:'s1',project_id:DEFAULT_PROJECT_ID}` 演示值（注释自认「演示值」） | 是 | 2 |
| A10 | `src/web/shared/kernelProjects.ts:5` | `DEFAULT_PROJECT_ID='P1'` 回落占位（A8/A9 共用） | 是（空账本回落） | 2/3 |
| A11 | `src/auth/loginService.ts:17`、`src/home/server.ts:50` | `DEFAULT_ADMIN_PASSWORD='Admin@123456'` 出厂种子口令（**更正：前次审查报告误记为 Admin@123456，以此为准**） | 是（播种管理员） | 1 |
| A12 | `src/web/security/AccountAdminCard.tsx:53,101`、`src/web/Home/LoginModal.tsx:265` | 明文展示出厂口令 `Admin@123456` | 是（未登录可见） | 1 |
| A13 | `src/web/InlineAttribution/AgentConversationDemo.tsx:13,206` | 演示占位 `project=P1` / `user=`（演示占位）；跳过登录门控 | 是（演示页） | 5 |
| A14 | `src/web/Home/tenantContext.tsx:67,77,88` | 仅凭 localStorage sid 造占位 context（`user_id:'restored-user'`） | 是 | 5 |
| A15 | `src/web/audit/AuditTable.tsx:80` | 跳检索页占位假链接（指向 `/overview.html`） | 是 | 5 |
| A16 | `src/web/audit/AuditPage.tsx:110` | 文案「检索页 REQ-012 待实现」（该页已落地，过时）+ safe-noop 标注 | 是 | 5 |
| A17 | `src/web/logs/LogsPage.tsx:148` | 跳转处置「占位」假 toast | 是 | 5 |
| A18 | `src/web/retrieval/RetrievalPage.tsx:43,93,112,113` | 4 处「（占位）」toast（跳反馈/审计/生命周期/链路） | 是 | 2 |
| A19 | `src/web/Home/TopBar.tsx:5` | 注释示例文案 `user_001/team_001`（示例非凭据，应清理） | 否（注释） | 5 |

## 3. B 类·必补真实实现
| # | 文件:行 | 现状 | 阶段 |
|---|---|---|---|
| B1 | `src/core/memagent/forgetting.ts:235,264,296` | 「演示级」合并（内容前8字符聚类）、冷压缩（仅计数） | 4 |
| B2 | `src/core/memagent/vector.ts:69` | 「演示用内存倒排」 | 4 |
| B3 | `src/core/memagent/recallInsight.ts:8` | 「契约级演示」token≈chars/2 | 4 |
| B4 | `src/web/growth/useGrowthReal.ts:42-55` | 五维评分兜底填数（semantic??0.5 / llm_judge=0 / structure 公式推值） | 4 |
| B5 | `src/web/models/coreModels.ts:167-192` + `VectorCard.tsx:58` | 三向量模型名挂 hash 起步实现（「权重尚未加载」「云端通道尚未接入」） | 4 |
| B6 | `src/web/models/coreModels.ts:150-154,208-216` | `param_save` 映射成 `llm_proxy` 伪造审计回执 | 3 |
| B7 | `src/core/memagent/agent.ts:253-264,349-352` | sync 抛 `E_NOT_IMPLEMENTED` / L0 授权未接线 | 4/5 |
| B8 | `src/web/monitor/useMonitorReal.ts` | 10 卡恒「—」；检索性能分母用全量审计 | 4 |
| B9 | `src/web/params/KbPolicyTable.tsx:20` | 数值保存为偏好记忆但不生效 | 5 |
| B10 | `src/web/write/DedupCard.tsx:32` | 三模式未接入写路径 | 5 |
| B11 | `src/web/Home/coreHome.ts:229-231` | 同步 `wired=false`（未实现） | 5 |

## 4. C 类·诚实降级（保留，重新标注；不算造假）
- 各 `useXxxMirror.ts`（audit/write/memory/feedback/dispute/lifecycle/params/security）的 safe-noop：与 `mirrorClient.ts` 实际已真接 `/api/mirror/audit` 口径不一，**阶段5 核实**——真接则删过时注释并让失败可见；确无端点则保留但失败改可见错误。
- `src/web/memory/MemoryLayeredPage.tsx:496`「尚未接入真实 LLM」诚实说明：保留。
- L2 占位符（cold/dormant 仅 L2 摘要）：`ContextPanel.tsx:21`、`ResultRow.tsx:29`、`retrieval/types.ts:20`、`coreEngine.ts:41`、`logic.ts:27`、`LayerGraphPanel.tsx:464,493`、`MemoryPage.tsx:135`、`logic.ts:43`、`MemoryInjectionTag.tsx:37`：真实隐私语义，保留。
- 脱敏占位符：`crypto.ts:316`、`layerRules.ts:128,137`、`qualityGate.ts:548,558`、`inlineAttribution.ts:11,30`、`types.ts:257`：真实脱敏语义，保留。
- `coreModels.ts:82,92` `dryRun:true`：明确 dry-run 标注，保留（确认确为 dry-run）。
- `coreOnboard.ts:81` 内核 discover 占位：返回空、不假 agent、审计真写——保留标注。

## 5. D 类·非软件资产（隔离/清理，不进 dist）
- `design/ui/` 13 个原型 HTML（部分含演示数据）：不进 dist，明确标注「原型」。
- `tools/archive/` 5 脚本引用演示账号：归档，运行时不加载。
- `.data/drill-d/` 演练账本（含 stub 行）：不入库，演练用。
- `e2e/` fixtures：保留在测试目录（非运行数据）。

## 6. E 类·种子/预置（确认处置）
- `src/core/memagent/agent.ts:318,408` `_seedMemory` + `src/web/kernel.ts:177` `getKernelWithSeed`：生产内核里的灌种子接口，仅 `__tests__` 调用、页面不调——保留但加编译期隔离/明确标注「测试专用」。
- `tools/dev-backend.mjs:21,67`、`tools/dev.mjs:102`：`user_001/demo1234` 演示账号，明文口令——dev 工具，移除明文或改 env 注入。
- 数据根历史 stub：批次24/28-C 已建自动清理，需实机核对 `data-root` 是否残留 stub 行（审计可见）。

## 7. 阶段4 侦察修正（2026-11-04；上方阶段0 冻结表格不改动）
- **B2 改判为 C 类**：`src/core/memagent/vector.ts:69` 原记「B 类·必补真实实现（演示用内存倒排）」。阶段4-C 侦察确认 `JsVectorBackend` 是生产唯一**真实**后端（真算 embedSync/cosine、全表 cosine 扫描 + filter + sort + top-k），`RustWasmVectorBackend` 全仓源码零实现（仅规格 §5.2 规划）。故 B2 实为三处**不实声明**（自称演示 / 自称倒排 / 把未实现后端写成现状），改按 **C 类诚实重标注**处置，已在阶段4-C 清除并在 `MANUAL-TEST-FIX-BATCH-42.md` §9 关账。
- **B1 拆分**：`forgetting.ts:235/264/296` 拆为 4-A（聚类判据接真 + 注释）与 4-B（冷压缩仅计数接真），两步均已闭环；冷压缩口径经用户确认采用「清索引副本 + 行上向量保留 + 幂等计数」，磁盘正文压缩未落地已如实标注。
- **B6 补充**：基线把 `coreModels.ts` 的 `param_save`→`llm_proxy` 映射标为阶段3，但阶段3（3-A/3-B/3-C）未触碰；**阶段4-G 已按真伪造接真并清除**（详见下条）。
- **B3 改判为口径契约化**：`recallInsight.ts:8` 原记「B 类·契约级演示 token≈chars/2」。阶段4-D 侦察确认 `estTokens` 是全链路同源的确定性**本地预算单位**（硬熔断/背景/省量/金额/UI 都读它），零依赖下无真实 tokenizer，且改公式会断裂历史审计与 3000t 阈值语义。故删演示标注、把魔法数 2 提为 `CHARS_PER_BUDGET_UNIT`、写明「中文低估真实 BPE」限制并加不变量测试。关联发现（金额用估算 token 算真钱、`useInlineReal.ts:197`「真实」措辞）留阶段5。
- **B4 判定为真伪造并已接真**：`useGrowthReal.ts:42-55` 的 `semantic ?? 0.5`、层号自造 `structure`、`llm_judge=0` 均为编造值，UI 还把 0 显示成「0.00 分」。阶段4-E 改为：无可信测量的维度记 null 并显示「未测量」，综合分按已测维度权重归一化（对齐内核 `fourDimScore` 无 LLM 口径）。侦察补充：内核 `dedup.ts` 确有 `baseDimensionScores` 真评分器，但它是两文本对比评分，不适用单条记忆展示语义（自比恒 1.0），故不冒充。
- **B5 改判为 C 类·结论层诚实化（已清除）**：基线记「三向量模型名挂 hash 起步实现（`coreModels.ts:167-192` + `VectorCard.tsx:58`）」。阶段4-F 侦察确认**算法层本来诚实**：`coreVectorProbe` 云端档如实 `ok:false` +「未验证：云端嵌入通道尚未接入」，本地档真跑 `new JsVectorBackend(dims).embed()` 并校验维度/非零，返回文案注明「hash 起步实现 · 权重尚未加载」；`VectorCard.tsx:58` 也已写明模型名仅用于维度/部署声明。真正的不实点在 **UI 结论层**：`VectorCard.tsx:47` 把 `ok=true` 包装成 toast「**连通测试通过**」，按钮也叫「连通测试」，而所选 `sentence-transformers / bge-m3` 权重与云端通道根本未接入。故按 C 类处置：toast 前缀改「本地 hash 后端可用（非所选模型连通）」/「模型连通未验证」，按钮改「探测本地后端」，补说明与注释；`coreModels.ts` 注释明确 `ok=true` **不等于模型连通**。**不改探测算法**（真跑 embed、云端恒未验证均保持）。
- **B6 判定为真伪造并已接真**：`coreModels.ts:150-154`（`coreSaveConfig` 返回值）与 `:208-216`（`coreAuditTail` 的 `param_save` 分支）把「保存 model_config」硬包装成 `event:'llm_proxy'` + 编造 `llm_proxy_source:'agent:local'` / `cost:0` / `mode:'local'`，UI 还把这三条假列渲染出来；保存配置从未发生代理调用。阶段4-G 改为：`ProxyAuditEntry` 拆成 `ProxyCallAuditEntry | ModelConfigAuditEntry` 判别联合，`param_save` 按**真实事件类型**回显 `event:'model_config'`，字段全取自账本 `detail`（历史缺字段记 `null` 显示「未记录」，不拿 0/空串冒充）；真实 `llm_proxy`/`llm_fallback` 回显保持不变。
- **B7 改判为 C 类·诚实重标注（已清除）**：基线记「`agent.ts:253-264,349-352` sync 抛 `E_NOT_IMPLEMENTED` / L0 授权未接线」严重度 4/5，两半都不准确。① **L0 授权实际已接线**：`src/web/kernel.ts:161-164` 的 `hostL0Ports()` 在桌面壳真注入 `new HostL0Admin()`（`src/web/shared/l0Port.ts:76` 走主进程 IPC `l0:requestAccess / l0:grant / l0:listGrants …`），`L0Vault` 实现完整 `L0AdminPort`；`agent.ts` 抛 `E_NOT_IMPLEMENTED` 只是**纯浏览器/未注入端口时的诚实降级**，不是功能缺失。② **sync 抛未实现是诚实标注**：`sync.ts` 的 `SyncHub`/`syncUp`/`syncDown`/`reconcile` 与 `pgSyncHub.ts` 的 Postgres 中枢**已实现且有集成测试**，但 `MemAgent` 无 hub 注入口、主进程零调用方，故未接入内核 API；`agent.sync()` 如实报错并写 `implemented:false` 审计，`coreHome.ts` 固定 `wired:false`。真正红线是三处**不实措辞**（把「引擎已实现、未接 API」写成「本版本未实现」；把「缺端口降级」写成「未接线」）。阶段4-H 按 C 类处置：只改声明与错误消息、不动行为，并新增 6 例契约测试锁住「已实现 ≠ 已接线」边界 + 禁止伪造 `pushed/pulled`。**用户已确认不选择「真接真 sync()」**（用进程内内存中枢冒充云端同步会制造新的假数据，与专项冲突）。
- **B8 判定为混合型并已跨模块接真**：基线记「10 卡恒「—」；检索性能分母用全量审计」严重度 4。侦察确认 **9 卡确属诚实未采集**（Agent 探活 3 / RawArchive 堆积 / 冷存储 2 / pipeline_llm_tokens p95 / 延迟 p99 / 哈希校验），但另有 4 处真问题：① `payload_tokens p95` 谎称「账本无口径」，而 `agent.ts:167` 的 recall 审计 detail **真写了** `payload_tokens`；② 规格 §12.1 的「(1h)/(24h)/(1d)」窗口全用 `queryAudit({})` 全量、零 `ts` 过滤；③ 命中率 = `recall 调用数/(recall+cold_recall+recall_breach)`，后两个 action 在内核账本**无写入点** → 恒 100%；④ 证据不足率分母里的 `evidence_thin` 审计根本不写入账本 → 恒 0%。另文件头声称「标注未采集」但 `MetricGrid` 只渲染「—」。**用户选择「跨模块全面接真」**：阶段4-I 给 `agent.ts` 的 recall 审计 detail 补真实 `evidence_thin` / `latency_ms` / `pipeline_llm_tokens`（顺便补上 `web/audit/coreAudit.ts:39` 一直在读却从未被写入的两个字段）；`useMonitorReal.ts` 按规格加 1h/24h/1d 真过滤、`percentile` 最近秩分位数、命中率改按真实 `detail.hits>0` 占比、`payload p95`/`延迟 p99` 真算；`MetricGrid` 对「—」卡补「未采集」标注。历史审计缺 detail 字段的行**不计入分母**，不拿 0/false 冒充；`pipeline_llm_tokens` 内核恒 0（未接网关 usage）保持「—」。
- 其余条目保持阶段0 判定不变。

## 8. 阶段5 侦察修正（2026-11-04 续；上方阶段0 冻结表格不改动）
- **A15 已清除（阶段5-A·真接线）**：基线记 `AuditTable.tsx:80` 跳检索页占位假链接指向 `/overview.html`。侦察确认检索页 `retrieval.html` / `RetrievalPage.tsx` 已落地且接真内核 recall，只是从不消费 URL 参数。已新增 `src/web/audit/auditLink.ts`（`retrievalContextHref` / `readTrailRequestId` / `trailEntries` 单一真源）与 `src/web/retrieval/AuditTrailCard.tsx`（真调 `coreLoadAudit()` 回放同 request_id 的审计行），并在 `RetrievalPage.tsx` 挂载。无参数不渲染、查无记录如实显示空、读取失败显式报错、不模拟召回结果。旧 `/overview.html` 与「（占位）」title 在生产代码零命中。
- **A16 已清除（阶段5-A·诚实重标注）**：`AuditPage.tsx:110` 旧文案「检索页 REQ-012 待实现」已过时；「后端镜像当前为 safe-noop（home server 暂无 audit 端点）」也不实 —— `src/home/server.ts:570,586` 真实现并持久化 `POST/GET /api/mirror/audit`，`src/home/__tests__/server.test.ts:156` 有服务端测试，`mirrorClient.ts:16` 真发该 POST。note 已改为真接口径；`useAuditMirror.ts` 删掉不实声明 + 空预留 `useEffect` + 未用 `urlRef`/`resolveBackendUrl`，注释明确「失败静默」是 fire-and-forget 设计而非「没有端点」。
- **C 类 mirror 核实（部分完成）**：`audit` 一路已确认为**真接**并按上条纠正。其余 7 个 `useXxxMirror.ts`（write/memory/feedback/dispute/lifecycle/params/security）与各页面仍留「home server 暂无 X 端点 / safe-noop」旧声明，`mirrorClient.ts` 头注释也仍写「safe-noop 语义保留」；它们同样真走 `/api/mirror/audit`。**口径统一 + 失败可见留 5-C**，本动作未扩散改动。
- **新增落点（供索引/verify 对照）**：`src/web/audit/auditLink.ts`、`src/web/retrieval/AuditTrailCard.tsx`、`src/web/audit/__tests__/auditTrailHonesty.test.tsx`（13 例）；改动 `AuditTable.tsx` / `AuditPage.tsx` / `useAuditMirror.ts` / `RetrievalPage.tsx` / `AuditTable.test.tsx`。代码索引 310 文件。
- **A17 已清除（阶段5-B·真接线）**：`LogsPage.tsx:148` 旧「跳转处置：…（占位）」假 toast 与 `LogCards.tsx` 的可点 `<span onJump>` 一并移除。`logs/logic.ts` 新增 `ERROR_TARGET_ROUTE`：3 类有真实落地页（`breaker_open`→`/agentonboard.html`、`quota_exceed`→`/models.html`、`conflict_pending`→`/dispute.html`，入口与 `overview/Overview.tsx` VIEWS 同源、全小写、`existsSync` 验证存在）→ 渲染真 `<a href>`；3 类确无对应页（`sync_fail` / `l0_decrypt_fail` / `vector_error`）→ `href:null` + 本版本可执行说明（`sync_fail` 明写「同步引擎已实现但未接入内核 API」，与 4-H 结论一致），不伪造跳转。`target` 文案与既有 `logic.test.ts` 断言不回归。
- **A19 已清除（阶段5-B·注释）**：`src/web/Home/TopBar.tsx:5` 注释里的原型示例 `user_001/team_001` 改为「值全部来自 useTenant 真实会话」口径；生产代码不再出现这两个示例值（`TopBar.test.tsx` / `HomePage.test.tsx` 里它们是 `registerAccount` 构造的真实登录态夹具，保留）。
- **保留项澄清**：`src/web/logs/LogCards.tsx:228`「空账本回落默认占位项目」是 A10 的真实回落语义，不是演示数据；`agentonboard` 等入口全小写，符合 Linux CI 大小写纪律。
- **C 类 mirror 已全部核实并清除（阶段5-C；§4「阶段5 核实」条目结案）**：侦察确认**真接** —— `src/home/server.ts:570,586` 实现并持久化 `POST/GET /api/mirror/audit`（`src/home/__tests__/server.test.ts:156` 有服务端测试），8 个 `useXxxMirror` 全真调 `mirrorReport`。旧声明「home server 暂无 X 端点 / mirror 为 safe-noop / 失败静默」及 7 个空预留 `useEffect` + 未用 `urlRef`/`resolveBackendUrl` 死代码已清除；`WritePage` / `MemoryPage` / `AuditPage` 等页面 note 与 2 个 e2e 头部注释同步改真接口径。**失败可见**落地：`mirrorClient.ts` 新增失败状态/订阅/事件派发 + `uiLog(level:'error')`，`.then` 真查 `res.ok`（旧实现把 HTTP 500/404 当成功），`mirrorFetch` 失败也记录、不冒充「查无」；`shared/mirrorFailureEvent.ts`（零依赖，避免循环 import）+ `shared/mirrorFailureNotice.ts`（有 `#root` 才建 DOM、`pointer-events:none` 的不阻塞提示条）由全部 20 页入口已加载的 `shared/actionLog.ts` 幂等安装一次，无需改 7 个页面。
- **范围外保留**：`src/web/AgentOnboard/useBackendMirror.ts:214`「合并回填（失败静默，页面仍与原型一致）」属 Agent 接入后端通道，非 `/api/mirror/audit`，不在基线 C 类 8 个 mirror 内，留后续动作核实。
- **B9 判定为真演示数据并已「接真到单一真源」（阶段5-E·已清除）**：基线记 `KbPolicyTable.tsx:20`「数值保存为偏好记忆但不生效」，实际更严重 —— `defaults.ts:24-31` 六行是**原型期编造的中文分类**（项目/决策/偏好/流程/事实/上下文知识）与**另一套数字**（半衰期 30/60/90/45/14/7 天），而内核 `forgetting.ts:27-34` 的 `POLICIES` 实际生效 365/180/30/14/30/2 天；`kb: string` 与 `Record<Category, …>` 无映射、`archive_days` 对应的 `auto_archive_days` 在内核只定义未使用（`classifyLayer` 按固定 3/30/90 天）、`paramsSnapshot.ts` 只解析 `cfg.auto_organize`、`ForgettingOptions` 无 policy 注入口、`main.ts:3025` 只传 `enabled/weeklyCompress/vector`。**用户选择「接真到单一真源」而非「全量接真」**（后者要造标签映射 + 新增归档判定 + 改内核行为）。处置：新增 `kernelKbPolicies()` 直接由 `policyFor(category)` 派生六行、分类键统一为内核 `CATEGORIES`、`CATEGORY_LABEL` 只做中文翻译；`KbPolicyTable` 改为**只读镜像**（零输入框、不再从偏好快照回填 `kbs`），note 明写「归档阈值内核未使用」「`cautious` 按不自动合并」「保存偏好快照不改写策略」。零内核行为变更，`coreSaveParams` 仍写快照以兼容既有账本。
- **B10 改判为 C 类·诚实重标注（阶段5-E·已清除）**：基线记 `DedupCard.tsx:32`「三模式未接入写路径」。侦察确认内核 `types.ts:151` 的 `dedup.action` 只有 `new / grafted / duplicated / filtered` 四种自动裁决结果，`memories.ts:346` 也只产出这四种；`merge / overwrite / keep` 三模式设计上就不存在，旧 note 把它写成「待办式功能缺口」不实。处置：note 改列四种真实结果并写明「全部由内核自动裁决、不存在用户可选三模式」；顺手把 `coreWrite.ts` / `write/types.ts` 的 `dedup_action` 联合收敛为 `create/graft/keep/filtered`，删掉 `WritePage.tsx` 永不命中的 merge toast、`logic.ts` 的 merge 文案分支与 `logic.test.ts` 里伪造的 `'merge'` 夹具（改走真实 `keep`）。**不新增内核能力**。
- **B11 改判为 C 类·诚实重标注（阶段5-E·已清除）**：基线记 `coreHome.ts:229-231`「同步 `wired=false`（未实现）」。4-H 已确认 `SyncHub/PgSyncHub` 已实现且有集成测试但未接入 `agent.sync` 与桌面主进程，`agent.sync()` 抛 `E_NOT_IMPLEMENTED`；`syncL0Honesty.test.ts` 6 例与 `coreHome.test.ts:123-157` 5 例已锁住边界，`TopBar.tsx:65-70` 在 `wired !== true` 时显示「同步未实现（本版本不提供云端同步）」且不渲染 `formatAgo(lastReconcileAt)`。**用户已确认不拿进程内内存中枢冒充云端同步**。处置：保持 `wired=false` 一字不改，只在 `coreHome.ts` / `TopBar.tsx` 补注释说明 `lastReconcileAt` 只供 `wired=true` 展示、`wired=false` 时不被读取；新增阶段5 契约测试锁定「账本有 `sync_up` 审计 → `lastReconcileAt` 非零但 `wired` 仍为 false」。
- **新增落点（供索引/verify 对照）**：`src/web/shared/__tests__/phase5EHonesty.test.tsx`（16 例，覆盖 B9/B10/B11）；改动 `defaults.ts` / `KbPolicyTable.tsx` / `ParamsPage.tsx` / `DedupCard.tsx` / `coreWrite.ts` / `write/types.ts` / `write/logic.ts` / `WritePage.tsx` / `write/__tests__/logic.test.ts` / `Home/coreHome.ts` / `Home/TopBar.tsx`。代码索引 312 文件最新。
- **阶段4 遗留金额/token 文案已清除（阶段5-F）**：4-D 把 `estTokens` 契约化为「本地预算单位 t」，但 UI 仍把 `t × 用户自设单价` 的结果显示成真账单。现 `recallInsight.ts` 的 `moneyPart` / `moneyShort` 明写「金额估算（本地预算单位 t × 单价）」「💰 估算 本次」，`saveLines` 写「估算花费」并新增「金额口径：…为估算值，不是网关真实 usage 账单」；`RecallMoney` 接口注释写明「金额是估算，不是账单」；`NormalConfigCard.tsx` / `paramsSnapshot.ts` / `web/params/types.ts` 的「¥/百万 token」统一为「¥/百万预算单位 t」；`useInlineReal.ts:197` 的「**真实** token 节省估算」改为「本地预算单位 t 的节省估算」。同步更新 `recallInsight.test.ts`（5 处精确断言 + 1 处注释）与 `mcpHttp.test.ts`（2 处）。**算法与 `CHARS_PER_BUDGET_UNIT=2` 一字未改**，金额数值仍同源。
- **4-I 遗留 growth `latency_ms` 已接真（阶段5-F）**：`agent.ts:175` 自 4-I 起就在 recall 审计真写 `detail.latency_ms`，`useMonitorReal.ts:64` 已据此算 p99；但 `useGrowthReal.ts` 仍恒 0 且注释写「账本无真实延迟采样」，属事实已变、说明未跟上。现从真实 recall 审计取有限非负数样本算平均值，新增 `GrowthMetrics.latency_samples` 区分「无样本 → —」与「有样本 0ms」；`GrowthPanels.tsx` 显示真值并把 note 改为「真实 recall 审计 `detail.latency_ms` 平均值」。历史缺字段 / 非 recall 动作 / 负值 / NaN / Infinity / 字符串一律不计入分母，与 4-I 同口径。
- **`MANUAL-TEST-BATCH.md` 历史清单已归档并就地更正（阶段5-F）**：该文件 `status: done` 的六批手测预期大量基于当时的演示/种子数据，且与 5-A/5-B/5-C/5-E 的改动直接冲突。现 frontmatter 改 `status: archived` + `superseded-by: specs/MANUAL-TEST-FIX-BATCH-42.md`，顶部加归档声明（「不可作为当前验收依据」）与「批次42 更正索引」；已推翻的预期（固定模型目录与模拟代理调用、P6 硬编码徽标/时间线、种子条数、五维条形图与三模式按钮、占位 toast/link、mirror safe-noop、明文示例口令等）**就地改为诚实口径且不复现旧假值**；未逐条复核的条目明确按历史记录理解，不编造新的具体数字。
- **新增落点（供索引/verify 对照）**：`src/web/shared/__tests__/phase5FHonesty.test.tsx`（18 例：金额 7 / latency 6 / 文档 5）。代码索引 312 文件最新。
- **A13 已清除（阶段5-D·接真登录态）**：基线记 `AgentConversationDemo.tsx:13,206` 演示占位 `project=P1` / `user=` 并「显式跳过门控」。侦察确认 `:56` 还有 `userId = ctx?.user_id ?? 'U1'` 假回落，`:206` 硬编码 `project=P1`；`HomePage.tsx:36` 的 `requireLogin` 注释也把「内联标识演示页」举为跳过门控的例子。**用户选择「接真登录态」而非「诚实空态」**（不做成只加标注的 C 类）。处置：新增 `InlineGate` 三态分流（确认中 → 「正在确认登录身份…」；确认后无真实 context → 登录门禁 + 真跳首页登录按钮；有真实 context → 才挂载 `InlineInner` 数据层），未登录时 `useKernelLoad` 根本不挂载、不读账本；头部 `project=P1 · user=…（演示占位）` 改为 `/api/me` 返回的 `user_id / enterprise_id / team_id`（`data-testid="inline-tenant"`）；删掉 U1 回落与跳过门控注释；`HomePage.tsx` 注释同步更正。**不新增登录表单**，登录仍走既有首页 `LoginModal`；演示页自此不再「不要求登录」。
- **A14 已清除（阶段5-D·接真登录态）**：基线记 `tenantContext.tsx:67,77,88` 仅凭 localStorage sid 造 `user_id:'restored-user'` 占位 context，恢复失败还「保持占位上下文」。处置：`context` 初始恒为 `null`，新增 `restoring` 状态与 `useTenantRestoring()` hook；有 sid 时只用 `/api/me` 的 **2xx + 真 context** 恢复，非 2xx / 缺 context / 网络错误 / 无 sid / `?backend=` 显式关闭后端一律保持 `null` 并结束确认态；`login` 成功与 `logout` 同步收敛 `restoring`。`shared/session.ts` 的 `fetchSessionContext()` 本就「未登录一律 null」，本改动让 `TenantProvider` 与它同口径，不再有第二套「占位身份」。
- **测试与 e2e 同步**：`tenantContext.test.tsx` 把「初始是占位上下文」断言改为「初始 null + restoring=true → 真响应后真实租户」，新增非 2xx / 缺 context / 网络失败 / 无 sid 四路；`AgentConversationDemo.test.tsx` 以真 session + `/api/me` 响应走接真链路，新增未登录门禁、恢复失败保持门禁、真实租户标识三例；`e2e/inlineAttribution.spec.ts` 起真实 `homeBackend` 真登录取 `sessionId` 并加 `?backend=`，新增「未登录 → 登录门禁」用例。**e2e 不再靠无登录直访绕过门控**。
- **C 类范围外已核实（2026-11-04）**：`src/web/AgentOnboard/useBackendMirror.ts:214`「合并回填（失败静默，页面仍与原型一致）」经核实为**真实 best-effort 后端镜像同步**（回填后端真实卡片状态 + `computeAgentStats` 真实审计统计；`test`/`rotate` 后端不可达如实返回失败原因），非演示/种子数据回流、非不诚实态；按诚实原则保留，不改动。`toServiceInput` 的 `project_id/user_id` 占位 `'p1'/'u1'` 属配置桥接占位（门禁 `A12` 不命中），建议后续从租户上下文注入真实值。详见关账报告 C 类核实小节。
- **阶段6 门禁固化已完成（2026-11-04）**：新建 `tools/check-no-demo.mjs` —— **白名单恒为空数组且启动自检**（非空即报错退出 1），21 条判据覆盖阶段2–5 已清除的伪造标识；扫描范围只含 `src/` 生产代码，排除 `__tests__` 与 `*.test.*`；`specs/` 历史基线清单、`design/ui` 原型 HTML、`tools/archive` 归档脚本、`e2e` fixtures、`.data` 演练账本属非软件资产，**是范围界定、不是白名单例外**。`package.json` 新增 `check:no-demo` 并串入 `verify:fast`（位于 `test:coverage` 之前，失败即短路）；CI 的 `quality-gate` / `windows-gate` 两个 job 本就跑 `verify:fast`，自动覆盖，`ci.yml` 注释写明内含零白名单门禁。**不锁 E 类种子口令**（`DEFAULT_ADMIN_PASSWORD` / dev 演示账号属阶段1 安全前置未决项，是真实功能而非演示数据回流），**不误伤合法用途**（`slice(0,8)` 分页截断/sha 短码、`/overview.html` 真实入口、L2/脱敏占位符、明示 dry-run、零模型 stub）。为让白名单真正为空，就地改写 **9 处**历史说明使其不复现旧标识（阶段3/4/5 的 5 处 + 首跑门禁扫出的 4 处），零行为变更。**D/E 类资产已处置（2026-11-04 后续）**：D1 `tools/dev-backend.mjs`/`tools/dev.mjs` 演示账号 `user_001/demo1234` 改为环境变量 `DEV_SEED_*` 注入（缺省回退保持本地 dev 不破）；D2 `design/ui/` 四个原型 HTML 补「原型/设计稿非生产代码」标注；D3 `src/core/memagent/agent.ts` 的 `_seedMemory` 导出点补「测试专用/仅测试灌数」标注；E 类种子口令 `DEFAULT_ADMIN_PASSWORD`（`Admin@123456`）改为环境变量 `ADMIN_SEED_PASSWORD` 注入（缺省回退，属阶段1 安全前置真实功能，仅首次播种使用，`LoginModal` 首登提示同步说明可由 env 覆盖）。门禁判据不锁种子口令，D/E 处置不影响零白名单门禁。详见关账报告 D/E 小节。
- 其余条目保持阶段0 判定不变；**A 类于阶段5-D 全部清零、B 类 B1–B11 全部清零**，阶段4 遗留金额/token 文案、4-I 遗留 growth 延迟、旧演示手测预期全部清零；**阶段5 收尾 `npm run verify`（EXIT=0）与阶段6 门禁固化均已完成**；遗留：C 类范围外保留项 `src/web/AgentOnboard/useBackendMirror.ts:214`、源码提交授权（D/E 类资产与阶段1 出厂种子口令已于本轮处置）。
