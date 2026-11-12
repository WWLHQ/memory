---
title: 静默失效事故复盘与双通路自发现方案
date: 2026-11-12
status: draft
scope: 采集侧静默失效 / MCP 在线侧异常 / 离线决策 / sidecar 常驻进程
origin: 2026-11-11 ~ 2026-11-12 用户与 CodeBuddy 的排查与设计对话
---

# 静默失效事故复盘与双通路自发现方案

> **一句话结论**：系统所有组件都在正常运行，但业务产出连续 5 天为 0，且没有任何告警。根因不是某个 bug，而是「沉默不可判定」——系统无法区分「正常没发生」与「故障没发生」。解法不是补几个阈值，而是让状态显式、带原因、可自证，并把离线时的决策权交回用户。
>
> **本文状态**：2026-11-12 落盘，全部内容为只读排查与设计，**尚无一行实现代码落地**。

---

## 0. 元信息与阅读顺序

- 事故窗口：2026-11-06 ~ 2026-11-10（连续 5 天采集记忆 0 入库）
- 发现时间：2026-11-11（人工翻 16 MB 记忆库才发现）
- 数据是否丢失：**否**。WorkBuddy 287 个活跃 `.jsonl`、Trae 274 MB `database.db`、Qoder 108 MB `main.sqlite` 均仍在本地，补上源与 parser 后可回填。
- 阅读顺序：§1 事故 → §2 根因矩阵 → §3 问题汇总 → §4 自发现体系 → §5 MCP 在线侧 → §6 离线决策 → §7 sidecar B 详细设计 → §8 落地顺序 → §9 未决事项 → §10 证据索引。

---

## 1. 事故：静默失效（silent failure）

### 1.1 排除「写入链路故障」

| 检查项 | 实测证据 | 结论 |
|---|---|---|
| 采集守护 | `main.log` 每 5 分钟一轮 `collector:role-gate {"roleSkipped":326,"collected":0,"deduped":3634}`；11-06~11-10 无 `backoff` / `round-not-advanced` / `scan-apply-error` | 一直在跑，且扫到了文件，全是旧数据被去重/角色过滤 |
| 采集游标 | `collector-cursor.json` 288 源，前缀仅 `claude-code:11 / workbuddy:262 / deepseek-harness:15`；`lastRun` 分布 `11-11:11 / 11-04:83 / 11-05:194` | 采集器「世界」里只有 3 个 Agent，277/288 游标停在 11-04/11-05 |
| 记忆库 | `memories.db.json` 16,311,823 B / 2911 条；按创建日 `11-04:806`、`11-05:2104`、`11-11:1`（`params_` 参数记录，非采集记忆） | 11-06~11-10 恰好 0 条 |
| L0 / 写锁 | `write_unlocked` 已解锁，无 `E_L0_LOCKED` pending 堆积 | 不是锁住写不进 |

自证：2026-11-11 多次 `recall_memory` 命中的全是 11-04/11-05 时期老记忆，11-06 之后没有一条新知识入库 —— 零入库在检索侧也能复现。

### 1.2 定性

- 监控的是「**组件在不在跑**」，不是「**数据在不在流**」。
- 根因层级：**上游契约漂移（upstream path/schema drift）+ 缺少数据新鲜度 SLO**。采集器与 6 个 Agent 之间存在从未写下来的隐式契约「会话写到这些路径、用这些格式」；Agent 单方面改了落盘方式，采集器路径不存在就当作「没新数据」静默 skip。
- 系统里 `0 条新数据` 与 `管道坏了` **完全不可区分**，因此不可能告警。
- 对应数据工程经典事故：ETL 天天成功、上游改 schema、一周后业务方发现全空。

---

## 2. 六 Agent 根因矩阵

| Agent | 11-06 后真实活跃位置 | 采集器当前源 | 判定 |
|---|---|---|---|
| **WorkBuddy** | `~/.workbuddy/projects/**/*.jsonl`，**287 个活跃 jsonl**，最新 11-11 18:04（样本 14967 行 / 302 user / 1963 assistant） | `~/workbuddy/**/*.md`（`workbuddy-md`），11-06 后只剩 3 个脚本文件 | **主因**：路径漏配 + 缺 jsonl parser |
| **Trae CN** | `%APPDATA%/Trae CN/ModularData/ai-agent/database.db` 274,288,640 B（11-09 14:06）+ `-wal` 4,412,552 B；`User/globalStorage/state.vscdb`（`ItemTable` 171 行，配置/模型非正文）；`inbox/*.jsonl` 是消息总线 digest | `~/.trae/sessions`（本机不存在） | 漏配 + 缺 SQLite reader |
| **Qoder CN** | `%APPDATA%/com.qodercn.app.stable/main.sqlite` 107,986,944 B（11-11 15:02），`chat_sessions` 12 行 / `chat_session_messages` 703 行含 `payload_json` / `chat_session_search_segments` 3200 行 | `~/.qoder/sessions`（本机不存在） | 漏配 + 缺 SQLite reader |
| **DeepSeek Harness** | `~/.dsh` 11-06 后活跃文件 **0** | `~/.dsh/storages/session_projcache/sessions/*.json`（`dsh-projcache`），数据停在 11-05 前 | 源本身无新数据 |
| **Codex** | `~/.codex/sessions` 60 个 rollout 最新 11-02 16:48；11-06 后活跃 `logs_2.sqlite`（`logs` 表列 `level/target/feedback_log_body/...`，非对话正文）与 global state | 无 Codex 专用源 | 会话正文未落到已知路径 |
| **Claude Code** | `~/.claude/projects/*.jsonl` 11-06 后活跃 **0**，最新 11-02 16:44 | `claude-jsonl` + recursive，**配置正确** | 源没问题，只是没新数据 |

**时间线**：11-04/11-05 的 2910 条来自 Claude / WorkBuddy-md / DSH 老路径；11-06 起主力切到 WorkBuddy 新客户端（写 `.workbuddy/projects/*.jsonl`）与 Trae/Qoder（写 SQLite），老路径同时停产 → 采集器继续勤快扫旧路径、dedup 旧数据 → 产出 0 条。

**两个易误判点**：
1. `agent-onboard.json` 8 张卡全 `CONNECTED` ≠ 采集覆盖。那是 MCP 接入握手态（`service.ts:480` 写静态快照），与本地会话日志位置是两套独立机制。
2. `detectedAgentNames` 白名单帮不上忙：初始为空 → `defaultAgentSources({agents: undefined})` 遍历所有扩展目录，本机全不存在 → 恒定 `skipped:6`；带 `agentNames` 也只是过滤已有源，不会凭空造出新路径或 parser。

---

## 3. 两天讨论的问题点汇总（16 条）

| # | 问题点 | 根因 / 结论 | 状态 |
|---|---|---|---|
| **A · 采集侧静默失效（11-11）** ||||
| 1 | 11-06~11-10 连续 5 天 0 入库 | 不是写失败/锁/守护问题 | 已查清 |
| 2 | 六 Agent 根因矩阵 | 见 §2 | 已查清 |
| 3 | 采集器「健康」假象 | 游标停在 11-04/11-05，扫到的全是旧数据 | 已查清 |
| 4 | 8 卡全 CONNECTED | 静态持久化快照，非实时链路健康 | 已查清 |
| **B · 从「猜」到「自证」（11-11~12）** ||||
| 5 | 阈值/判定表防不住复发 | 纯文件扫描在路径漂移时会把事故误判成 `quiet_ok` | 已定方案 |
| 6 | 「怎么判断有会话输入」 | 判据是**增量 Δ 而非存在**；内容/文件/握手三水印 OR 融合；握手补上路径漂移盲区 | 已定方案 |
| 7 | 守恒不变量 + 轮次回执 + canary | 见 §4 | 已定方案 |
| 8 | 失败零审计、无 `/health`/watchdog | 见 §5 | 已查清 |
| **C · 在线侧边界（11-12）** ||||
| 9 | 昨晚两次 `internal_error` | **用户主动关闭桌面端**，重启即通；`internal_error` 全仓零匹配，是宿主 SDK 包装，不是服务端 bug（最初误判成服务挂了） | 已澄清 |
| 10 | 连不上分不清「关了/崩了」 | 与采集侧「0 入库分不清没用/坏了」是同一个病 | 已定性 |
| 11 | CONNECTED 滞留、会话 Map 无 TTL | 无后台复核；`MAX_CLIENT_SESSIONS=256` 淘汰最早、无 DELETE /mcp；`list_projects` 静默返空、`E_BUDGET_FUSE` 从不 throw | 已查清 |
| **D · 离线决策与交互（11-12）** ||||
| 12 | A/B/C 融合、先提示二选一 | 决策权交给人：重开 / 缓冲 / 跳过 | 已定方案 |
| 13 | 提示无处可弹 | 桌面端关了 UI 不存在 → 只能落 Agent 侧；`mcpSchema.ts:48`「继续回答」与「先提示」硬冲突，须四处同改 | 已查清 |
| 14 | spool 不能复用 pending 队列 | 见 §6.2 | 已查清 |
| 15 | 重开与单实例 | `requestSingleInstanceLock` 让重开幂等；无 exe 路径解析、无 `launchHint`、无托盘/自启 | 已查清 |
| **E · 进程架构（11-12）** ||||
| 16 | 加常驻进程判在线 | 极窄 sidecar（形态 B），三级状态把推断变读取，见 §7 | 待拍板 |

**贯穿两天只有一条根因**：系统的「沉默」无法区分正常与故障 —— 采集侧 0 条、在线侧连不上、CONNECTED 快照、失败零审计，全是同一个病。对应也只有一条解法：**状态显式 + 带原因 + 可自证 + 决策权交人**。

---

## 4. 双通路自发现体系：不要猜，要证明

### 4.1 两条通路必须分别自证，不能互相推导

- **通路 A（在线）**：Agent ⇄ 8204 MCP ⇄ 记忆内核（`recall_memory` / `write_memory`）
- **通路 B（旁路）**：本地会话日志 → collector → 记忆内核（每 5 分钟）

8204 挂了，B 照样跑（读本地文件不依赖 8204）→ 采集侧回执/守恒**发现不了 MCP 故障**；反过来 B 挂了，A 正常 → 就是本次事故。

### 4.2 四条不变量

```
采集侧：declared        == committed + rejected(带原因) + pending
在线侧：declared_calls  == received  + failed(带 code/agent/session)
回执：  两条通路每轮都必须产 receipt（缺回执 = 链路死，与业务量无关）
探针：  两条通路各自每日 canary 必通
```

- **轮次回执**：无论有没有数据都产 `roundReceipt`，写进已有 `audit.jsonl`（追加式、带 `prev_hash` 链）。告警只有两条确定规则：回执缺失超过一个调度周期 → 一级（守护/装配死了）；`balanced=false` 或 `declared>0 && committed=0` → 二级，且回执直接给出差额原因。**关键收益：「什么都没发生」也必须被证明。**
- **canary 全链路探针**：系统自造带唯一标记的 synthetic 会话，走完 `发现→解析→去重→写影子池→回读校验→清理`，每段打点。全通 = 能力被证明；卡住 = 精确到段。与用户是否使用无关，静默期也能体检。隔离硬要求：独立 `__health__` project、不进 recall、不进精炼、不计费、TTL 自动清理。
- **契约自注册**：Agent 在 `initialize` 用 `clientInfo` + `capabilities.sessionSource` 声明 `{path, parser, formatVersion, probeGlob}`；记忆库自动注册并校验存在性。契约变更本身即事件（事前预警）。第三方改不了代码时退化为 discovery：扫到「大量新写入但不在注册表」的目录 → 生成「待确认契约」。
- **A/B 互补**：canary 证明「管道能干活」，守恒对账证明「真实数据没丢」，不可互替。

### 4.3 明确不做

- 不把自学习基线 / EWMA 当主判据（冷启动无数据、不可解释、本质还是猜）。
- 不靠阈值枚举判定表当主判据（降级为回执字段来源）。
- 不动采集守护、游标推进条件 `committed && applied.failed === 0`、L0 写锁、pending 队列（实测正常）。

---

## 5. Agent 侧 MCP 异常：现状核查

### 5.1 已有能力

| 能力 | 位置 |
|---|---|
| 令牌鉴权 `-32001`、Origin/1MiB 防护、作用域 `-32602` | `src/core/memagent/mcpHttp.ts:490/528/542`、`mcpAuth.ts:66` |
| **L0 锁诚实降级**：`E_L0_LOCKED` → `status:'pending'` + 队列 + 重放，文案「这不是写入成功」 | `mcpHttp.ts:294-313`、`mcp.ts:246-265` |
| 七态客户端配置扫描 + 备份式一键修复（`wire`/`wireAll`，conflict/invalid 拒写、`.bak-` 备份 + 原子替换） | `src/electron/mcpClients.ts:156-299`、`McpClientsPanel.tsx:199-281` |
| `initialize` 会话 ID、`X-Memagent-Client` 身份头、`mcp_call` 审计 | `mcpHttp.ts:556-577`、`agentOnboard/mcpClients.ts:182` |

### 5.2 缺失

| 缺失 | 证据 |
|---|---|
| **失败调用零审计**：401/403/413/400/parse error 直接返回，`mcp_call` 只记成功调用 → 宕机时零记录、又无心跳，无法区分「没人调」和「调不通」 | `mcpHttp.ts:368-391`；`AuditAction` 无 `mcp_error` |
| 无 `/health`、无 watchdog、无崩溃重启、无端口占用自愈 | `specs/MCP运维与多Agent写入规范.md:91` 明写「待实现」；`docs/会话采集启动指南.md:24` |
| 会话是进程内存 Map，`MAX_CLIENT_SESSIONS=256` 淘汰最早，无 TTL / DELETE /mcp / 断连清理 | `mcpHttp.ts:218-246` |
| CONNECTED 是静态持久化快照，点测通才实时探测，无后台复核 | `agentOnboard/service.ts:336/480`、`stateMachine.ts:31` |
| 两处「把异常吞了」：`list_projects` catch→`registry=[]` 静默返空；`E_BUDGET_FUSE` 只在类型声明、全仓无 throw | `mcpRecall.ts:271-275`、`types.ts:59` |
| `server.on('error')` 不判 `EADDRINUSE`、不换端口，`main.ts:2984` catch 只写日志继续 bootstrap → 8204 静默缺失 | `mcpHttp.ts:613-616`、`main.ts:2984-2986` |

**易混淆点**：三档 `display` 降级（`mcpRecall.ts:14/255`）只针对客户端能否渲染 `<details>`，与服务端故障无关，不能当故障降级用。

### 5.3 诚实降级统一口径

范本就是 `E_L0_LOCKED`：明确告知、进队列、待重放、绝不返回假成功。所有 MCP 异常照此模板；同时修掉 `list_projects` 静默返空（须带 `degraded:true` + reason）与 `E_BUDGET_FUSE` 静默裁剪（须真 throw/上报）。宁可让 Agent 看到明确错误，也不能让它把「空」当成「没有记忆」。

---

## 6. 离线决策：A / B / C 融合

### 6.1 状态机（决策权交回用户）

```
recall/write 调用失败
  → 分类：ECONNREFUSED / 端口无监听 → desktop_offline（正常）
          连上但 5xx / 超时 / isError → mcp_down（真故障，红条 + watchdog）
  → 【提示 · 不自动执行任何动作】
     "记忆库未启动。这批请求如何处理？"
       ┌ [重开桌面端并重试]   ← C，改为显式授权
       ├ [缓冲，恢复后补报]   ← B，改为当场授权
       └ [跳过，本次不用记忆] ← A 的保守面，如实声明"本次回答未检索记忆库"
  → 无论选哪个，落一条 decision 记录（可审计，不缓存内容）
  → 重开：拉起 → probe 复验 → 通过才重放原请求；不通就如实说"已启动但未连通"
  → 缓冲：写 spool → 桌面端恢复后逐条补报 → 复验 → 对账销账
```

A 的诚实底座保留，B/C 不再是系统自选策略，而是用户点了才执行的动作。

### 6.2 spool 不能复用现有 pending 队列

四个理由：① 桌面关闭时内核进程不存在（8204 是 Electron 主进程内 `httpCreateServer`，`main.ts:2973`；退出 `mcp.stop()/mcpHttp.stop()` `:3972`），ECONNREFUSED 时零 HTTP 字节；② `enqueuePending` 只在服务活着且抛 `E_L0_LOCKED` 时触发，错误类型不匹配；③ 桌面实际装配是 `MemoryPendingStore`（`main.ts:2900`），`FilePendingStore` 存在但**未被引用**、进程重启即清空；④ pending 项是 `MemReq` 而非任意 JSON-RPC 请求。且现有 pending 无 TTL、无上限、无清空、无专用审计。

**spool 设计**：

| 约束 | 设计 |
|---|---|
| 位置 | `<数据根>/offline-spool/pending-<id>.json`；数据根从 `data-root.json` 取（当前 `%APPDATA%/MultiAgent Memory`，该目录下现无 spool 目录、无 `pending-*.json`） |
| 内容 | 仅 `{id, ts, agent, method, params, attempts, expires_at}`，**只存工具调用参数，不存对话全文**；**禁存 Authorization / token** |
| 加密 | 写密钥未解锁时**拒绝缓冲并提示**，不静默写明文 |
| 生命周期 | TTL 72h（待确认）+ 上限 200 条（待确认）+ 到期提示而非静默补报 |
| 可见可控 | 状态栏角标「待补报 N 条」+ 接入页面板，可查看 / 一键清空 / 立即补报 |
| 对账 | `declared == applied + failed + expired`，不允许静默丢条 |

可复用：`PendingStore` 接口、`pendingStoreFile.ts` 落盘形状、`pendingWritesView.ts` 只读摘要口径。

### 6.3 硬冲突：四处规则必须同改

`src/core/memagent/mcpSchema.ts:48` 的 `MCP_INSTRUCTIONS` 第 5 条写的是「工具不可用时……如实说明**并继续回答**」，与「先停下问用户」直接对立；Agent 收到该 instruction 会直接续答，新规则不生效。

必须同改：`mcpSchema.ts:44,48` + `AGENTS.full.md:34,36` + `AGENTS.md:38,40` + `CLAUDE.md:17,22`。少改一处即白写。约束：`AGENTS.md` 必须保持 < 40,000 字符，**不能**拿 `AGENTS.full.md` 整份回滚（会重新超限被跳过）。`tools/` 下无自动同步脚本。

### 6.4 重开分支与单实例

`main.ts:3986-3999` 有 `requestSingleInstanceLock` + `second-instance`（只 `restore/show/focus`）→ 重开幂等，不会起第二个 8204，但也不能靠反复点修故障。缺口：全 `src` 无 `app.getPath('exe')` / `process.execPath` 解析、无 `Tray` / `setLoginItemSettings`（**无托盘常驻、无开机自启**）、配方 `MCP_CLIENT_SPECS` 只有 `configPath/connectHint/rulesHint`，**没有 launchHint** → 需补启动命令字符串。

---

## 7. sidecar B 详细设计（推荐形态）

### 7.1 为什么需要它

前面所有方案在「桌面端关了」时都失去载体：UI、8204、spool 托管方、canary、提示全部消失，Agent 只能从 `ECONNREFUSED` **推断**「大概没启动」——仍是猜。加一个不随桌面端退出的极窄进程，Agent 就能**读**明确状态。

另一条佐证：批次60 观察计划记载「常驻进程仍跑旧口径，必须重启桌面端」—— 当前所有逻辑绑死单一主进程，改一行状态判断都要重启整个桌面端；独立 sidecar 可单独重启/更新。

### 7.2 三种形态对比与选择

| 形态 | 做法 | 判断 |
|---|---|---|
| A 完整后台服务 | 把 8204 从主进程剥离成独立 Node 服务，UI 只当客户端 | **不选**：改变「关掉桌面端 = 关掉记忆库」的语义，违背用户主动关闭的意图；密钥/解锁态要重设计；改动面最大 |
| **B 极窄 sidecar（选）** | 独立小进程，只管「状态 + spool + 提示」，不碰密钥和记忆库 | 隐私面最小、生命周期独立、能托管前面所有方案 |
| C 托盘 + 开机自启 | 完整后台化 | 全 `src` 无 Tray / setLoginItemSettings，改动最大；开机自启须用户显式授权 |

### 7.3 职责边界（划死，否则会变成第二个内核）

**做**：探测 8204、回答状态、托管 offline spool、发系统通知、跑 canary、写独立回执链。
**不做**：不读 `memories.db.json` / `memories.l0.json`、不持 L0 密钥、不做召回/写入、不代答任何记忆请求、不代理 MCP 流量。

→ 它挂了也不危及数据安全，只是「状态读不到」，降级为 `all_offline` 如实说明。

### 7.4 进程形态与生命周期

- **纯 Node 脚本**（不引 Electron）：避开 `ELECTRON_RUN_AS_NODE=1`、`NODE_OPTIONS=--require=...node-language-shim.cjs`、大小写重复代理变量（`HTTP_PROXY`/`http_proxy`…）三个已知启动坑。
- **启动方式**：
  - 由桌面端 `spawn` 时必须 `detached: true` + `unref()` + `stdio: 'ignore'`，否则主进程退出会带走它；
  - 更稳的是安装时独立注册（NSIS 安装项 / 用户显式开启开机自启），生命周期完全不依赖桌面端。
- **单实例**：sidecar 自己一把锁 —— 固定端口 `EADDRINUSE` 即视为已有实例，直接退出；不要与 `main.ts:3986` 的 `requestSingleInstanceLock` 语义混淆。
- **端口**：新增一个固定本地端口（建议 8205，需在 `src/web/backend.ts` 统一登记，不得在渲染层硬编码；现有 8200/8201/8202/8203/8204 已占用）。
- **退出/卸载**：必须能一键关闭；安装包卸载要清理进程与 spool 目录；默认**不**自动开机自启。

### 7.5 状态模型（核心价值：把推断变读取）

```
sidecar 在线 + 8204 在线     → ok              正常
sidecar 在线 + 8204 不在线   → desktop_offline 明确「桌面端没开」，不是故障
sidecar 在线 + 8204 连上但错 → mcp_down       真故障 → 红条 + watchdog
连 sidecar 也 ECONNREFUSED   → all_offline     如实说明，不猜
```

- 判定依据是**主动探测**（TCP connect + 一次只读 `ping`/`get_write_status`），不是「最近有没有收到请求」。
- 探测频率与桌面端采集轮次对齐（建议 30s~1min），结果写入 `link-receipt`（带 `prev_hash`），桌面端恢复时读链判断 sidecar 中途有没有死过。
- **「谁看护看护者」不套娃**：不引第三个进程。最后一层靠连接错误类型这个确定事实 + 回执链，有限且可判定。

### 7.6 最小 API（全部只读优先，写操作仅 spool）

| 端点 | 用途 | 返回要点 |
|---|---|---|
| `GET /status` | 状态查询 | `{state, desktop_pid?, mcp_8204, checked_at, receipt_seq, spool_count, last_error?}` |
| `GET /spool` | 待补报摘要 | 只读摘要（不含正文/密钥，复用 `pendingWritesView.ts` 口径） |
| `POST /spool` | 缓冲一条请求 | 仅 `{agent, method, params, ts}`；校验禁存 Authorization/token；写密钥未解锁时拒绝 |
| `POST /spool/clear` | 一键清空 | 需显式动作，写审计 |
| `POST /hint` | 触发二选一提示 | 系统通知 / 供 Agent 侧规则读取 |
| `GET /receipt` | 回执链尾 | 供桌面端恢复后对账 |

**所有响应带 `state`，不允许返回「空」冒充正常。**

### 7.7 交互时序

```
Agent 调 recall_memory 失败
  → 先问 sidecar GET /status（sidecar 始终在）
  → 得到 desktop_offline（不是猜）
  → 弹二选一：重开 / 缓冲 / 跳过
  → 选重开：sidecar 按 launchHint 拉起桌面端（单实例锁保证幂等）
             → 轮询 /status 直到 ok → 复验 → 重放原请求
  → 选缓冲：POST /spool（当场授权，TTL/上限/加密按 §6.2）
             → 桌面端恢复后由主进程拉取 spool 逐条补报
             → 对账 declared == applied + failed + expired → 销账
  → 选跳过：如实声明"本次回答未检索记忆库"，不伪造
```

### 7.8 sidecar 上线后，前几轮方案自动简化

| 原方案痛点 | sidecar 后 |
|---|---|
| 提示无载体（桌面端关了 UI 不在） | 系统通知 + Agent 规则兜底 |
| spool 需 Agent 自己写文件 | 由 sidecar 托管，Agent 只发一个 HTTP |
| canary / 回执必须按 `desktop_running` 门控（否则整晚误报） | sidecar 常驻，门控自然消失 |
| 双通路账本无统一采集点 | sidecar 即统一采集点 |
| 错误分类只能在 Agent 侧推断 | 服务端直接给 `state` |

**仍需保留**：四处规则同改（`mcpSchema.ts` + AGENTS×2 + CLAUDE.md），因为「先提示二选一」这条行为约束还在；`launchHint` 仍需补。

### 7.9 代价与风险（必须认）

- 多一个进程 = 多一个故障点、多一份包体积、多一套升级/卸载清理。
- 必须能一键关闭，默认不自动开机自启。
- 打包：`electron-builder.config.cjs` 要把它打进 `release/win-unpacked/resources/`，`package.json` 加脚本；**打包后必须 `git checkout -- package.json`**（electron-builder 会清空 `scripts`/`devDependencies` 且不还原）。
- 纯文档/配置改动不触发 `npm run package`（打包规则针对代码改动）。

### 7.10 影响面清单（预估，实现前需逐文件复核）

**新增**：`src/agentOnboard/offlineSpool.ts`、`src/web/AgentOnboard/OfflineChoiceCard.tsx`、`tools/sidecar.mjs`（或 `src/electron/sidecar/`）、对应单测与 E2E。
**修改**：四处规则、`src/agentOnboard/mcpClients.ts`（`launchHint`）、`src/web/backend.ts`（端口登记）、`src/web/shell/statusbar.ts` + `Workspace.tsx`（状态/角标单元格）、`src/electron/main.ts`（spool 拉取与补报 IPC、sidecar spawn/停止）、`electron-builder.config.cjs`、`package.json`。
**UI 复用**：`navCounts.ts` + `Workspace.tsx:1915-1957` 的 `tcount`、`Workspace.tsx:1482-1485`「共 N 条待重放」、`taskpane.ts` 的 unavailable 口径。**不要新建写页队列页**（`WritePage.tsx:78` 明确 pending 不展示）。

**必须保持不变**：`E_L0_LOCKED → pending + 诚实文案`、`getWriteStatus` 三字段、8204 鉴权/Origin/1MiB 与各响应码、首步召回门禁、recall 三档回显与明细 URL 逐字保留、`requestSingleInstanceLock` + `second-instance`、`before-quit` 清密钥与 `mcpHttp.stop()`、数据根指针与 `setPath('userData')`、`audit.jsonl` 审计口径、令牌不落 spool/日志/URL。

---

## 8. 落地顺序（按原子任务推进，每步展示成果等确认）

| 步骤 | 内容 | 验收要点 |
|---|---|---|
| **T1** | 四处规则同改（「先二选一」口径）+ `mcpSchema.ts` | E2E 断言「不可达时不得直接续答」 |
| **T2** | `offlineSpool.ts` + 单测（TTL/上限/重放/不存令牌/不吞错） | C 变异：临时允许写入 token → 指定用例必须红 |
| **T3** | sidecar B 骨架：`/status` + 回执链 + 单实例锁 + detached 生命周期 | 桌面端关闭后 `/status` 仍返回 `desktop_offline` |
| **T4** | 二选一 UI + 状态栏角标 + `launchHint` 重开复验 | 重开幂等、复验不通过不重放 |
| **T5** | 双通路账本：回执守恒 + canary 探针 + 失败调用入审计 | 注入「上游有新文件但 0 产出」→ 必须红 |
| **T6** | 采集源修复（P0 止血）：WorkBuddy `.workbuddy/projects/*.jsonl` 源 + `workbuddy-jsonl` parser | **回填 11-06~11-10 产出 > 0 条新记忆** |
| **T7** | Trae / Qoder SQLite reader（需先探明 Trae `database.db` 的 chat 正文表） + 契约自注册/discovery | 源健康可见、契约变更事前提示 |

每步按 8 点边界（单一目标/输入输出/验收命令/修改边界/依赖/上下文/独立回滚）→ 三道闸门 → `npm run code:index -- --write` → CI/CD 推送。

**三道闸门**（`specs/开发纪律_三道闸门.md`）：
- A 影响面回归：影响面清单 + `verify:fast` / `test:gate` + 静态门禁 + 索引一致性 + 既有行为未变
- B 效果验证：每条 AC 正向端到端，断言状态/审计**真的变了**（只读类反向断言真的没变）
- C 变异验证：至少一次代码级变异（临时改错关键判定 → 指定测试红 → 还原 → 绿）+ 输入/状态变异矩阵

---

## 9. 未决事项（需用户拍板）

1. sidecar 形态是否确认采用 B；是否允许开机自启（默认否）。
2. spool TTL / 上限：暂定 72h / 200 条。
3. 「跳过」是否记忆本次选择（避免每次都弹）。
4. 采集源修复是否授权开工（用户目前只说「排查」+「先落盘」，未说实现）。
5. #47 C1 真机采集仍 `in_progress`：等价验收收口 / 授权清库后手动点按钮 / 保持。
6. 工作树历史改动：2026-11-12 08:31 核查时 `git status --short` 为空，远端 SSH `git@github.com:WWLHQ/memory.git`；此前「大量未提交改动」已在近几日提交清理。
7. 决策类任务：B1/B4 多机上线（起 PG 服务端 + 补集成测试）、B3 真实 LLM 精炼（API Key + 预算）。
8. 并行线：批次60 召回打分 A 方案一周观察（2026-11-12~19，自动化 `eb758e74-…` 每日 21:00 快照），与本方案独立。

---

## 10. 证据索引（本机只读核查，2026-11-11 ~ 11-12）

| 类别 | 位置 |
|---|---|
| 真实数据根 | `%APPDATA%/MultiAgent Memory`（`data-root.json` → 同目录；`memories.db.json` / `memories.l0.json` / `audit.jsonl` / `collector-cursor.json` / `agent-onboard.json` / `main.log` / `actions.log` / `members.json`） |
| 采集器 | `src/core/memagent/sessionCollector.ts`（`defaultAgentSources()`、parser 联合类型）、`collectDaemon.ts`、`src/electron/main.ts`（`collector:triggerNow`、`role-gate`、游标推进条件） |
| MCP HTTP | `src/core/memagent/mcpHttp.ts`（`:196` 建服务、`:486` createServer、`:605` listen、`:294-313` pending、`:368-391` 审计、`:613` error）、`src/core/memagent/mcp.ts`（TCP 8202 同口径） |
| 规则文档 | `AGENTS.md` / `AGENTS.full.md` / `CLAUDE.md` / `src/core/memagent/mcpSchema.ts`（`MCP_INSTRUCTIONS`） |
| pending | `src/core/memagent/pendingWrites.ts` / `pendingStoreFile.ts` / `src/shared/pendingWritesView.ts`、`src/electron/main.ts:2900` |
| 客户端接入 | `src/agentOnboard/mcpClients.ts`、`src/electron/mcpClients.ts`、`src/web/AgentOnboard/McpClientsPanel.tsx` |
| 打包/启动 | `electron-builder.config.cjs`、`src/electron/main.ts:3986-3999`（单实例）、`specs/MANUAL-TEST-PHASE-A.md:14-16`（exe 启动命令） |
| 待实现标记 | `specs/MCP运维与多Agent写入规范.md:91`（`GET /health` 待实现） |

> **落盘说明**：本文为对话结论的持久化快照，不含实现代码；后续实现以本文 §8 顺序推进，每次变更后须回写「状态」列并重建索引。
