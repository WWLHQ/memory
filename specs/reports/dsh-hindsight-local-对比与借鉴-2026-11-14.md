# dsh-hindsight-local 与 MultiAgent Memory 对比与借鉴建议

> 日期：2026-11-14 ｜ 承接 `specs/reports/dsh-hindsight-local-调研报告-2026-11-14.md`
> 口径：外部侧结论来自上一份报告的源码实读（`文件:行号`）；本侧结论来自本工作区源码实读与只读核查；召回规范口径另核对本机记忆库命中 [1]《读取（Recall）规范》（`score=0.327`，L1）
> 性质：只读分析 + 建议，**未改动任何运行时源码，未 commit / push / 打包 / CI**

---

## 0. 一句话结论

外部仓库是**「宿主插件 + 服务端黑盒语义引擎」**，我们是**「独立产品 + 自研记忆内核」**。它把语义能力整体外包给 Hindsight（LLM 抽事实 / 1024 维 bge-m3 / reranker），自己只做客户端整形与工程化；我们把记忆全生命周期（分层、去重合并、衰减、召回模式、预算、加密、审计、成本记账）都自己实现，纯本地、零外部模型，代价是**语义检索弱（64 维 hash 词袋）且完全没有时间语义**。

因此两者互补性极强：**它的「客户端整形层」值得我们抄，我们的「治理层」是它没有的**。最该补的不是换大模型，而是「时间表达式 + 原文保真 + 幂等续传」这三块不依赖外部模型的纯逻辑。

---

## 1. 定位与规模

| | 外部 dsh-hindsight-local | 我们 MultiAgent Memory |
|---|---|---|
| 形态 | dsh 插件，`dsh.bundle.patch` + `dsh.client`，零依赖 Node ESM | 独立 Electron 桌面产品 + MCP 服务 + Web/移动端，22 个 HTML 入口（`AGENTS.md:57,66`） |
| 版本 / 规模 | v0.1.9；`lib/` 30+ 文件、`web/client.js` 994 行、`lib/runtime.js` 1084 行 | v0.1.0（`package.json:2-4`）；`src/` 637 个代码文件约 10.2 万行、263 个测试文件、172 篇文档 |
| 接入 | 挂宿主 5 个官方 Hook + 3 个官方 UI 插槽，不改宿主源码 | 标准 MCP `POST /mcp` 听 `127.0.0.1:8204`（`mcpHttp.ts:575-598,698-703`），另有 hook 硬前置召回 |
| 部署 | 自动装 uv / Python 3.12 / venv（备选 uvx/pip/docker）后拉起 8888 | Electron 安装包；改动后必须人工「关旧端→重打包→启新端」（`AGENTS.md:43-51`） |

---

## 2. 逐维度差异

| 维度 | 外部 | 我们 | 判定 |
|---|---|---|---|
| 存储 | pg0 内嵌 Postgres + `vector(1024)`，按 bank 分库；游标 `~/.dsh-hindsight/state/cursor-*.json` | `memories.db.json`（L1–L6 原子写）+ `memories.l0.json`（v2 密文信封，0600）+ `audit.jsonl`（>16MiB 轮转），`fileStorage.ts:5,62`、`l0Store.ts:3,91`、`auditLog.ts:17,20`；`SqliteStorage` 存在但未作桌面主源 | 我们更轻，但库大了单文件原子写有上限 |
| 语义检索 | bge-m3 1024 维 + bge-reranker-v2-m3 + LLM 事实抽取，需联网/密钥/费用 | `JsVectorBackend` hash 词袋 + cosine，`DEFAULT_VECTOR_DIM=64`、中文 2-gram、索引内存可丢弃，无 embedding 模型/无 reranker（`vector.ts:1-9,53-89`）；`pipeline_llm_tokens` 恒 0（`agent.ts:383`） | **最大能力鸿沟，也是最大卖点差异** |
| 数据模型 | 事实 + chunk 原文 + `document_id` + tags | L0 加密原文 / L1 脱敏 / L2 摘要≤300字 / L3 得失 / L4 模式 / L5 洞察 / L6 投影（`layerRules.ts:44-49`）；字段含 `decay_class/pinned/locked/merged_into/墓碑`（`types.ts:675-753`） | 我们建模远 richer，对方靠 LLM 现抽 |
| 写入 | 5 个 Hook 自动抓每轮；`document_id=<session>:tN` + 内容 sha1 去重、失败不推进游标、429 退避 | MCP `write_memory` / `quick_add` / `import_from_agent`（`mcp.ts:201-242`）；L0 锁定时入 pending 队列并明确「不是写入成功」（`mcp.ts:246-264`）；发件箱待判 `state:'pending'`（`personal.ts:250-321`）；去重 `grafted/duplicated/filtered`（`types.ts:204-212`） | 我们「诚实语义」更强，对方「断线续传」更完整 |
| 防回灌 | 三处切断：注入消息 `source.kind=plugin:*`、读日志跳过 `plugin:`、文本剥离 `<memory-context>`（`transcript.js:12,188-194,247-249`） | 主通道是 MCP 工具回显由 Agent 原样输出；hook prelude 把 `hits[].content` **原样**拼接（`recallPrelude.ts:4,63-76`），明确「绝不注入 display.markdown/回显话术」 | 我们目前不自动注入，回灌风险本就低；但一旦做自动注入必须补对方那套 |
| 召回整形 | 清洗答题套话 → 服务端范围 ±1 天 → 按 chunk 回原文 → 标识符精确词加权(3) → `supersededIds` 新旧覆盖 → 4000 字注入块（`recall.js:130-297`、`engmem.js:180-256`） | 内核语义扫描限 `project_id`（`agent.ts:176`）→ 5 档模式分流（`recallModes.ts:47-98,225-276`）→ GAP-1 权重 `0.35/0.30/0.15/0.20`（`shared/growthConfig.ts:14,67-69`）→ 半衰期衰减 → 预算 1500/2000/3000 硬裁剪（`agent.ts:41-42,235-254`）；`scope=session` 时 `dispatch:null`（`agent.ts:96-153`） | 我们强在**策略与治理**，对方强在**结果保真** |
| 时间语义 | 自研 `timeparse.js` 解析「昨天下午/3 天前/7am」，本地时区戳 + `query_timestamp` + 命中时间窗 ★ 加权 | **没有**：全仓检索 `timeparse|parseTimeWindow|window_boost|query_timestamp` 仅命中上一份外部调研报告；时间只影响 `freshnessOf` 半衰期（`forgetting.ts:46-53`） | **我们明确的空白，优先级最高** |
| 注入形态 | 合成一条 user 消息自动注入，`<memory-context>` 带免责头、当前本地时间、原文摘录 | 回显三档（`html-details`/`markdown-full`/`markdown-compact`）+ **铁律「原样输出 `display.markdown`、URL/数字/金额不得改写」** [1]（`mcpRecall.ts:14,260`、`AGENTS.md:74`）；`detail_url` 为 30 分钟内存票据（`recallDetailTickets.ts:8-9,28`） | 我们的口径是「不替用户改一个字」，不能照搬自动注入文案 |
| 安全 | owner-only 单路由 `/api/dsh-hindsight`、密钥只进 `.env` + `plugin.env` 备份、日志 `redact()` 脱敏、绑 `127.0.0.1` | 令牌 ≥32 字符 + 三池作用域门禁（`mcpAuth.ts:64-85,107-111`）、**L0 双锁**（写锁 `write_unlocked` / 查阅锁 `active_sessions` 互不替代，`l0vault.ts:175,563-566`）、审计 append-only（`auditLog.ts:171-183`）、loopback 强制校验（`recallHook.ts:36-44`） | 我们明显更重、更完整 |
| 降级 | 按 bank 冷却 60s、`enabled:false` 真开关、每个 Hook 全 try/catch | MCP hook fail-open（2.5s 超时、服务未起 `continue:true`，`recallHook.ts:10,20`）；pending 队列不丢写入 | 双方都做到「记忆挂了聊天照常」 |
| 可观测 | 22 endpoint、25s 长轮询侧栏状态卡、OpTracker 按真实 operation 状态驱动 UI、`stats()` | 回显统计 + cost/saved_cny 成本记账（`recallInsight.ts:264-265`）、明细页、审计日志；CI 四门禁 + 代码索引双档（`AGENTS.md:7`、`.github/workflows/ci.yml:34-53`） | 对方更贴用户实时状态，我们更贴工程治理 |
| 隐私/成本 | 对话原文发第三方 LLM / embedding / reranker；实测 992 轮约 ¥2.36 | 数据与审计全落本机、无云依赖；仅可选 LLM 精炼出网（`已知边界台账.md:21,27`） | 我们「纯本地零费用」是硬优势 |

---

## 3. 三条最关键的能力鸿沟

1. **语义质量 vs 独立性**：对方是真 embedding + rerank + LLM 抽事实，能召回「字面不相关但语义相关」的内容；我们是 64 维词袋 + 词面覆盖融合，中英混排、同义改写会漏召。但换来的是 `pipeline_llm_tokens=0`、零密钥、零出网、零费用——**不建议为了追平语义把这个卖点推翻**。
2. **时间问答**：对方修的是通用坑（服务端按 UTC 天界解析相对时间，东八区早上 7 点会落到前一天），解法完全是客户端纯逻辑（本地时区戳 / `query_timestamp` / 前后放宽一天 / 本端 ★ 加权），**不依赖任何外部模型**，是我们最该直接吸收的一块。
3. **结果保真**：对方召回时把「事实」按 `chunk_id` 拼回一次 retain 的原文，并显式标注「已被取代」，还用标识符精确词加权补服务端抽取丢路径/符号的损失；我们 L2 摘要 ≤300 字，`recallPrelude` 只是原样拼 hits，既没有原文也没有新旧关系展示。

---

## 4. 可借鉴清单（按优先级分档）

### P0 · 可直接吸收（纯逻辑、不破坏现有架构）

| # | 做法 | 落到哪里 | 注意 |
|---|---|---|---|
| 1 | **时间表达式解析 + 本地时区戳 + `query_timestamp` + 命中时间窗加权** | 新建 `src/shared/timeWindow.ts`（纯函数 + 单测），在 `agent.ts` 打分处作为**修正项**叠加，不改 `recallModes.ts` 的 5 档 | 必须作为打分修正，不要变成第 6 个模式；「零命中时仍注入当前本地时间」这招也能让 Agent 诚实回答「没找到该时段记忆」 |
| 2 | **确定性幂等写入**：`document_id=<session>:tN` + 内容 sha1 去重 + **失败绝不推进游标** + 429 指数退避抖动 | `pendingWrites.ts` / `sessionCollector.ts`，给 `WriteResult` 加 `cursor`/`content_hash` | 我们已有 pending 队列与「pending ≠ 成功」，缺的是「内容级去重 + 断点续传」；这是补强不是重写 |
| 3 | **异步真实状态驱动 UI**：按 operation id 轮询真实状态、409「还在排队」不算失败、定期对账 | 监控/审计页状态机，参考 `ops.js` | 我们 `audit.jsonl` 已有事实源，只差展示口径 |
| 4 | **标识符逐字保真 + 精确词加权**（标识符权重 3、CJK 二元组/英文词权重 1） | `vector.ts` 的 `tokenCoverage` 或 `forgetting.ts` 打分 | 我们本来就是词袋检索，加精确词权重成本极低、收益直接 |
| 5 | **注入内容打 source 标记 + 采集侧过滤**（对方三处切断） | `recallPrelude.ts` 注入头 + `sessionCollector.ts` 采集过滤 | 当前我们不做自动注入，先补上等于买保险，成本几乎为零 |

### P1 · 需改造（架构差异大，先出方案再动手）

| # | 做法 | 前提 / 风险 |
|---|---|---|
| 6 | **召回结果回拼原文 + 新旧覆盖**：`supersededIds` 把旧记录标「已被取代」并强制补带新记录 | 我们没有 chunk 结构，需先给 L2–L5 记忆加脱敏后的 `source_excerpt`（L0 是密文、不参与检索，不能直接引用）；替代捷径：复用现有 `merged_into`/`merged_from` 墓碑关系，在召回时强制补带合并后的新记录，成本远低于造 chunk |
| 7 | **`<memory-context>` 式免责头**（「只是背景、可能过时」「路径/符号以原文为准」「同一事项以时间最新为准」） | 与我们的回显铁律冲突 [1]：**不得改写 `display.markdown`**；只可能放进 hook 的 system prelude，而 `recallPrelude.ts:4` 明确「绝不注入话术」—— **偏离现有约定，须用户显式批准** |
| 8 | **侧栏 25s 长轮询状态卡 / 一键部署向导** | 我们导航计数是 `postMessage` 一次性回传（`navCountChannel.ts:24-33`），改长轮询要评估与现有通道冲突；自动装 Python/uv 与 Electron 打包纪律冲突，不建议整包照搬 |

### P2 · 明确不建议

- **接第三方 LLM 抽取 / 1024 维 embedding / reranker**：会推翻「纯本地、零费用、`pipeline_llm_tokens=0`」的硬优势，并引入密钥与出网。若真要提升语义，优先评估**本地离线 embedding（ONNX 小模型）**，但仍属架构级变更。
- **自动安装运行时（uv / Python / venv / docker）**：与 `AGENTS.md §0.1` 纯净度、打包纪律冲突。
- **在 Web 或回显层另写第二套模式词表**：`web/retrieval/logic.autoDispatch` 刚删且有测试锁「别再长回来」；任何新增分流规则必须回到 `core/memagent/recallModes.ts` 单一真源。同理，时间窗规则也应单点定义。

---

## 5. 反向借鉴：我们有哪些是它没有的

- **L0 加密原文 + 双锁**：写锁只供加密、查阅锁才给解密，两把 DEK 互不替代；对方没有任何静态加密或查阅鉴权。
- **记忆治理**：L0–L6 分层、半衰期衰减、GC 策略、`merged_into` 合并影子、`deleted` 墓碑与 `hardFilter`；对方只有「事实 + 文档」，新旧关系靠字符串启发式 `supersededIds`。
- **令牌作用域三池门禁 + append-only 审计 + 密钥 0600**：对方只有 owner Peer 与 `.env` 权限位。
- **成本治理**：每次召回返回 `savings`（注入/基线/裁剪/省 token 与 ¥）、回显三档与明细页票据 [1]；对方连「这次注入花了多少」都不记账。
- **工程门禁**：CI 四门禁、`test:gate` 四分片、代码索引双档、纯净度收尾五步；对方 37 个用例文件且隐含 POSIX 假设（Windows 实跑 26/37）。

---

## 6. 落地纪律（承接本项目约定）

1. 每个原子动作先展示成果、等人工确认，再走下一步；收尾过三道闸门（A 影响面回归 / B 效果验证 / C 变异验证）。
2. 任何新增「模式 / 权重 / 词表」必须单一真源（内核 `recallModes.ts` / `shared/growthConfig.ts`），Web 与回显只读内核。
3. 若涉及代码改动：全门禁 → 打包 → **等用户实测** → **等用户明确确认** → 才 commit / push；禁 `git add .`，不得把在途文件带进提交。
4. 本轮为只读分析，**不触发上述打包与提交流程**。

---

## 7. 核验记录（三道闸门在只读任务上的落地）

- **A · 影响面回归**：`git status --short` 显示 **14 个既有在途改动**（`meta/STATE.md`、`specs/code-index.generated.md`、`specs/recall-echo-contract.md`、`mcpHttp.ts`/`mcpSchema.ts`/`recallInsight.ts`、3 个 memagent 测试、4 个 recallHard 文件）+ **2 个未跟踪报告**，均非本轮产生；本轮只新增本报告，未触碰任何在途文件。
- **索引状态（与上一轮不同，如实记录）**：本轮复跑 `node tools/code-index.mjs --check` 返回 **「代码索引已过期：请运行 npm run code:index -- --write」**（上一轮为「已是最新 380/140」）。成因是新增报告文档使文档集合变化；但 `specs/code-index.generated.md` 本身是并行会话在途改动，**本轮不重写以免覆盖**，等用户拍板后统一重建。
- **B · 效果验证**：外部侧每条结论可回溯上一份报告的 `文件:行号`；本侧结论由只读源码核查给出 `文件:行号`；模式档位 / 预算 / 回显铁律 / 记账口径另与本机记忆库命中 [1]《读取（Recall）规范》交叉核对。
- **C · 变异验证（等价形式）**：以「文档 ↔ 源码」与「自述 ↔ 已知边界」做真值检验——上一份报告 §9 已列出外部侧 7 处文档漂移；本侧用 `specs/已知边界台账.md` 逐条核实「明确未实现」清单（无时间窗、无 chunk 整形、无自动装运行时、无长轮询、无冲突检测引擎、auto 极简档不生效），避免把「没做」误写成「做了」。
- **交付状态**：仅新增本报告文件；**未 commit / push / 打包 / CI**。

---

## 8. 记忆库检索记录

本轮第一条动作即检索自建记忆库：MCP 工具索引仍缺失，按工作区日志的办法直连本机 `127.0.0.1:8204/mcp`（token 文件 → initialize 拿 `Mcp-Session-Id` → `tools/call recall_memory`），真实命中 **1 条**：《9. 读取（Recall）规范》（`mem_01M6NFBYP87BAX0MZ136RGBPXE`，L1，`score=0.327`），用于核对模式分流、预算 1500/2000/3000、回显铁律与 `savings` 记账口径；另有 4 条项目背景（298t），与本次对比主题无关，未采信为结论依据。**工具索引缺失 ≠ 记忆库停用。**
