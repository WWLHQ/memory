# MCP 运维与多 Agent 写入规范

> 文档目的：把记忆库 MCP 服务的四条运维 / 治理方向——**① 宕机后端守护、② 健康检查与运行手册、③ 跨机扩展、④ 多 Agent 写入规范**——合为一篇，作为落地依据。
> 配套文档：`记忆库工具能力清单.md`（能力盘点）、`接入Agent行为规范.md`（接入行为准则）。
> 本文为设计规格，不含实现代码；凡涉及落地均标注"待实现"。
>
> **纳入版本管理（2026-11-05，用户确认）**：本文原为外部生成、长期未跟踪的 spec，现纳入本仓库 `specs/`。
> 批次43 的 R3「反向补回目标 SOP 运维四方向」即以本文为来源。纳入时按「活文档要实」纪律就地校正
> 4 处过时/错误的**现状声明**（见 §0 末尾校正说明）；设计意图、方案对比与「待实现清单」保持原貌，
> 「待实现」标注本身就是诚实声明，不因纳入版本管理而冒充已落地。

---

## 0. 现状基线（四方向共享事实，均已代码核实）

- **MCP 与后端同进程**：`src/electron/main.ts` 同进程内启动 `runMcpServer`(TCP 8202, `:2547`)、`runMcpHttpServer`(HTTP 8204, `:2554`)、`createWebhookHttpServer`(8203, `:2596`)、`startRefineQueue`(`:2545`)、会话采集器(`:2610` 起，周期 5min)；`l0Vault` 同进程持 DEK/会话，30s `sweep`(`:2507`)，`before-quit` 调 `l0Vault.onExit()`(`:3181`)。
- **无独立子进程后端模式**：`hostScan.ts`/`agentDetect.ts` 的 `execFileSync` 仅扫描别家进程，不 spawn 自有后端。
- **单写者存储**：`fileStorage.ts` 用 `<db>.lock`（`O_EXCL` 原子建锁，内容含 `pid`），注释明确「**锁被活进程持有 → 自动只读**」。两个进程不能同时写。
- **回环绑定**：TCP 8202 `server.listen(port,'127.0.0.1')`(mcp.ts:286)；HTTP 8204 默认 `host='127.0.0.1'`(mcpHttp.ts:149, listen 于 :410)。
- **单一共享令牌**：`McpOptions.token` 单值，所有 Agent 共用；令牌落 `userData/mcp-token.txt`(0600)，明文不进日志。
- **无 health 端点**：`mcpHttp.ts` 内 grep `health` 零命中；仅 home 后端有 `/api/health`（LoginModal 探针用），MCP 自身无存活 / 深度检查。
- **指标已埋未暴露**：`agent.ts` 审计含 `latency_ms`/`saved_tokens`/`pipeline_llm_tokens`/`evidence_thin` 等，但无端点，`monitor.html` 标注"未采集"。

### 0.1 纳入版本管理时的现状校正（2026-11-05 代码实测）

| # | 原声明 | 实测 | 处置 |
|---|---|---|---|
| 1 | §4.1「`write_memory` 带 `source_agent`（MCP 默认 `'mcp'`）」 | **过时**：批次44-D1（`14af325`）已去除默认值，TCP/HTTP 两端均要求 `source_agent` 必填且拒绝字面 `mcp`（`mcp.ts:201-205`、`mcpHttp.ts:246-250`、`mcpSchema.ts:53`） | 就地改为「必填、无默认值」 |
| 2 | §4.3「默认身份禁用」列为待补缺口 | **已落地**，同 D1；不是待办 | 标注「已闭合」并写明证据 |
| 3 | §3.2 / §3.3「Token Broker 已能 mint `['P-shared','P-<user>']`」 | **错误**：全仓 `src/` 对 `TokenBroker` / `tokenBroker` / `mint` 零命中，多用户三池与令牌代理 mint 受限令牌尚未实现，属 **D6**（用户已确认 `create_project` 并入 D6） | 改为「未落地，跨机前须先完成 D6」。〔**批次46-D6 已落地（2026-11-06）**〕D6-4 落地内核级令牌库 `tokenStore.ts`（`mcp-tokens.json` 0600、只存 sha256、`mint`/`resolve`）+ D6-5 `mint_token` 管理工具；三池门禁 D6-2 落地（`classifyProject`/`projectInScope` 三池版）；本条历史校验记录保留，当前能力以 `记忆库工具能力清单.md` 为准 |
| 4 | §4.2 条款 4「删除(`memory_op` delete)需配置开关 + 人工确认」 | MCP 工具名是 `manage_memory`，且 delete 默认关闭由 `MCP_ALLOW_DELETE=1` / `allowDelete:true` 放行（批次44-D5-2） | 名称与开关口径对齐 |

> 未校正项经复核仍成立：MCP 无 `GET /health`（`mcpHttp.ts` 对 `health` 零命中）；`sync` 未接线（`agent.ts` 如实抛 `E_NOT_IMPLEMENTED`）；`GET /recall/<id>` 明细页只听回环；`audit.jsonl` 为召回/写入权威审计源。

---

## 1. 方向 1：宕机后端守护（解决宕机）

### 1.1 问题定义
主进程崩溃 / 卡死 / 强杀 / 用户退出 → 8202/8204/8203 全灭，且 collector / refineQueue（同为写者）也停摆，所有接入 Agent 召回与写入失败。

### 1.2 核心约束
单写锁决定"再起一个副本"无效（第二实例抢不到锁变只读，写能力丢失）。守护本质是**重新分配写锁归属**，不是加副本。

### 1.3 方案对比
| 方案 | 描述 | 保活粒度 | 复杂度 | 局限 |
|---|---|---|---|---|
| A 外部 supervisor 拉起整 app | nssm/launchd/systemd 监控 app，崩了自动重启 | 整 app | 低 | 重启间隙仍断；不解决 UI 假死 |
| B 进程内 MCP 子进程 | `child_process.fork` 起 MCP worker，main 监督拉起 | 仅 MCP | 中 | 仍共享数据根；L0 vault 归属待定；collector/refine 未解耦 |
| C 独立后端守护 | 抽全部后端成独立 node 进程，独占写锁；桌面退化为 UI+IPC 客户端 | 后端独立 UI | 高 | 重构大但最彻底 |

### 1.4 推荐路径：C 为主目标，A 为即刻第一步
- **阶段 0（立刻）**：supervisor（nssm/launchd/systemd）保活整 app，覆盖"崩了无人重启"主宕机面。
- **阶段 1（过渡）**：后端模块边界化 + CLI 入口 `memory-backend`，仍同进程起，边界清晰、可单测。
- **阶段 2（目标）**：main 不再持写锁，spawn `memory-backend` 子进程独占 `FileStorage` 写锁 + `l0Vault`；桌面经本地 `Unix socket`/Windows `named pipe` 连接；主进程 `FileStorage` 转只读或走 backend API；**移除 main 的 `l0Vault.onExit()`**（改 backend 负责）。
- **阶段 3**：supervisor 保活 backend 子进程；backend 崩了桌面仍活，自动拉起。

### 1.5 守护内部结构（阶段 2）
- 拥有（写者）：`FileStorage`(写锁)、`l0Vault`(DEK/会话/sweeper/onExit)、`collector`、`refineQueue`、`mcp`、`mcpHttp`、`webhook`、`homeServer`(8201)、`agentOnboard`(8200)。
- 暴露：MCP 8202/8204 + Webhook 8203 + 管理/健康检查接口。
- 与桌面通信：本地 socket；桌面原 IPC 桥改为转发 backend；桌面不再直持 DEK，`decrypt_l0` 走 backend。
- 生命周期：登录启动，登出/退出 backend `onExit` 释放锁与 DEK。

### 1.6 关键问题逐项
| 问题 | 决策 |
|---|---|
| 写锁归属 | 阶段 2 起只归 backend；桌面只读 |
| L0 DEK/会话 | 随 backend；`decrypt_l0` 走 backend |
| 冷启动竞态 | 约定 **backend 先起**，桌面后连；赢家写、输家只读 |
| 密钥环权限 | `l0-keyring.json` 仅 backend 进程用户可读(0600) |
| 端口冲突 | 已有 `EADDRINUSE` 日志，守护需明确上报 |
| 日志归属 | backend 写独立日志，不混 `main.log` |
| `before-quit` 双释放 | 抽离后必须移除 main 的 `l0Vault.onExit()` |
| collector/refine 停摆 | 一并迁入 backend，否则写能力残缺 |

### 1.7 回退
- 单写锁硬约束：阶段 2 前**绝不能** main 与 backend 同时写。
- backend 不可用 → 桌面回退内置 MCP（抢锁失败变只读，至少 recall 可用），或 supervisor 回退拉起整 app。

---

## 2. 方向 2：健康检查与运行手册

### 2.1 健康检查（三档）
| 档 | 检查 | 探法 | 失败判据 |
|---|---|---|---|
| 存活 Liveness | 进程在、端口通 | TCP 8202 `connect`+`initialize`；HTTP 8204 `GET /health` | 连不上/超时/非预期 |
| 就绪 Readiness | 能服务 | `/health?deep=1`：存储可达、L0 状态可读、token 有效、`audit.jsonl` 可追加 | 任一项异常→503 |
| 指标 Metrics | 运行质量 | `/metrics`（recall 次数/p95 latency/saved_tokens/连接数/单行超限断开数） | 超阈值告警，不阻断 |

- **落地点（待实现）**：`mcpHttp.ts` 加 `GET /health`(含 `?deep=1`) 与 `GET /metrics`；TCP 8202 用 `initialize` 当存活探针。指标计数器进程内维护，复用 `agent.ts` 审计字段，不新增存储。

### 2.2 运行手册骨架
- **启动顺序**：数据根就绪 → 令牌 `mcp-token.txt` 存在且 0600 → 起 MCP(8202) → MCP-HTTP(8204) → Webhook(8203) → 探 `/health` 确认就绪。
- **关停**：`before-quit` → `l0Vault.onExit()` 释放锁与 DEK；MCP `stop()`。
- **常见故障 → 恢复**：
  | 现象 | 根因 | 处理 |
  |---|---|---|
  | `EADDRINUSE` | 端口被旧/重复实例占 | 查占用、释放或换端口（日志 `mcp-listen-error`）|
  | `-32001 unauthorized` | Agent token 与文件不符 | 重新分发令牌，**明文不进日志** |
  | 写入只读 / recall 正常但 write 报锁 | 第二实例抢到 `<db>.lock` | 确认单写者，杀重复进程 |
  | write 报 `E_L0_LOCKED` | L0 写密钥未解锁 | 走 L0 授权 `unlockWrite` 或确认 vault 会话 |
  | Agent 连 8204 超时 | 桌面未运行/未监听 | 如实告知"工具不可用"，不伪造；查 `main.log` |
- **日志位置**：`main.log`(启动/错误)、`actions.log`(如 `mcp:recall_detail_view`)、`audit.jsonl`(每次 recall/write 真审计，判定"是否真检索过"的权威源；轮转进 `audit-archive/`)。
- **监控接入**：`/metrics` 接进 `monitor.html`，沿用 `useMonitorReal` 的"未采集"诚实口径，不拿 0 冒充已接通。

---

## 3. 方向 3：跨机扩展

### 3.1 现状
TCP 8202、HTTP 8204 均绑 `127.0.0.1`，本地优先、无云；认证为单一共享令牌；存储单写锁。

### 3.2 三大硬约束
1. **本地优先定位冲突**：跨机=数据或传输跨网络，需重做威胁模型，可能偏离产品定位——先确认"真跨机"还是"同机多客户端"。
2. **单令牌不够**：一个共享密钥跨网分发=任意持有者可读写全部可见池；需升级为**每客户端/每 Agent 独立凭据 + 独立 scope**。〔校正〕令牌代理 mint 受限令牌与多用户三池 `P-shared`/`P-<user>`/`P-archive` **曾未落地**（内核零命中），属 D6。〔**批次46-D6 已落地（2026-11-06）**〕：`tokenStore.ts` 令牌库（0600、仅哈希、过期即失效）+ `mint_token` 管理工具（仅管理员）+ 三池门禁 `projectInScope` 三池版；每令牌独立 `user_id`/`scope_project_ids`/`is_admin`，跨机部署前能力已就绪（跨机传输层本身仍属方向 3 未实现）。
3. **单写锁禁止多机并发写**：多机写只有两条路——① 单一写者（中心库）；② 分片（每机独立池 + `pgSyncHub` 同步中枢）。注意 `sync` 当前**未接线（诚实报错）**，跨机写前提是先接通 `sync`。

### 3.3 推荐方案（若确要跨机）
| 层 | 做法 | 说明 |
|---|---|---|
| 传输 | 反向代理（nginx/Caddy）TLS 终结，MCP 仍绑 127.0.0.1 由代理暴露 | **不要直接 `0.0.0.0` 裸奔**；回环明文可接受，跨网必须 TLS |
| 认证 | 每客户端独立令牌 + `projectInScope` scope；强制 mTLS 或 token+IP 白名单；防重放(nonce/时间戳) | 替换单一共享密钥；〔**批次46-D6 已落地**〕mint/三池已就绪（`tokenStore.ts` + `mint_token` 工具 + 三池门禁），跨机传输层（mTLS/白名单）本身仍待方向 3 |
| 数据 | 中心写者（一写多读）或 分片 + `pgSyncHub` 同步 | 多机写必须先接通 `sync` |
| 审计 | 跨机调用方 `detail.client` 已记录（批次41-S 校正：不带 session-id 按 UA→最近 initialize 归并，可能串） | 跨机更需可靠归属，先修 41-S 判据 |

### 3.4 威胁模型
- 静态：L0 已 AES-256-GCM 加密，密钥环 0600——跨机不用改。
- 传输：回环明文可接受；跨网必须 TLS。
- 暴露面：`GET /recall/<id>` 明细页、Webhook 8203 同样只听回环，跨机要一并过代理 + 令牌。

### 3.5 开放问题
1. 真跨机，还是同机多客户端？（后者零网络改动，只需方向 4）
2. 团队共享，还是远程 Agent 接入？（决定中心写者 vs per-agent 令牌）
3. 是否接受偏离本地优先定位？（若否，跨机做成可选部署模式而非默认）

---

## 4. 方向 4：多 Agent 写入规范

### 4.1 现状（已具备的安全网）
- 溯源字段：`write_memory` 带 `source_agent`（**必填、无默认值**：批次44-D1 已去除默认 `'mcp'`）、`session_id`、`user_id`。
- 唯一 ID：`mem_id` 用 ULID。
- 去重：`dedup.ts` 拦完全相同内容（`filtered` 不入库）；`conflict_id` 标记同源冲突。
- 串行化：`FileStorage` 单写锁让所有写漏斗进同一写者，Agent 端无需自锁。
- 隔离：`projectInScope` 拒越界/跨租户写；写只落 L0，绝不直写池（行为规范已定）。

### 4.2 写入规范（条款）
1. **身份必填**：每个 Agent 必须发**自身** `source_agent` + `session_id`，**禁止依赖默认 `'mcp'`**（多 Agent 下默认值使溯源失效）。
2. **只落 L0**：绝不直写池；共享内容只能由脱敏后的 L1 经 `routeL1` 晋升。
3. **去重优先**：写前先 `recall` 查同类；近重复优先 `feedback(confirm)` 强化既有，不各写一遍。
4. **冲突外置**：`conflict_id` 冲突由遗忘/合并管线（非 Agent）裁决；Agent 不得直接 overwrite 他人记忆，删除走 `manage_memory(action=delete)` 且默认关闭（`MCP_ALLOW_DELETE=1` 或 `allowDelete:true` 才放行，批次44-D5-2），一律优先 `forget` / `archive`。
5. **诚实隔离**：各 Agent 只写真实观测，不伪造、不代写；跨租户写被 `projectInScope` 拒。
6. **category 纪律**：选最贴近一类，不塞单一类别。
7. **幂等意识**：相同 `(content,agent,project)` 应被 `dedup` 拦下；Agent 带稳定指纹减少近重复。

### 4.3 待补能力（缺口，待实现）
| 缺口 | 说明 | 建议 |
|---|---|---|
| per-agent 配额/限流 | 防单 Agent 刷屏写、撑爆 L0 | 加 per-agent 速率/每日上限 |
| 近重复检测 | `dedup` 只挡完全一致，语义近重复仍产多条 | 强化 qualityGate 的 near-dup 合并 |
| ~~默认身份禁用~~（**已闭合**） | ~~`'mcp'` 默认在多 Agent 下失真~~ | ✅ **批次44-D1 已落地**：TCP/HTTP 缺 `source_agent` 或为字面 `mcp` 一律 `-32602`，无默认值；此行保留以便追溯，不再是缺口 |
| `disputed` 可见性 | `feedback(disputed)` 挂裁决，发起方是否可知未定 | 明确裁决结果是否回传发起方 |

### 4.4 开放问题
1. 是否需要 per-agent 写入配额？还是靠 `dedup` + 人工确认兜底？
2. `disputed` 裁决结果是否对发起 Agent 可见？
3. 多 Agent 下是否启用"默认身份拒写"硬约束（影响现有单 Agent 默认行为）？

---

## 5. 四方向依赖关系

- **方向 1（守护）**是基础：保证写通道本机不宕。
- **方向 2（健康）**提供可观测性：守护之上才能知道"活着没、写得动没"。
- **方向 4（多 Agent 写入）**是**方向 3（跨机）的前置纪律**：远程 Agent 接入前，身份/隔离/配额必须先立住，否则跨网放大写入混乱。
- **方向 3** 必须建立在方向 1 之上：暴露在公网的 MCP 一崩就裸，先有守护再谈跨机。

---

## 6. 落地路线总览

| 阶段 | 内容 | 风险 |
|---|---|---|
| 阶段 0 | 外部 supervisor 保活整 app（方向 1-A） | 低 |
| 阶段 1 | 后端模块边界化 + `memory-backend` CLI（方向 1-B/阶段1） | 低 |
| 阶段 2 | 独立守护 + 写锁归属切换 + 移除 main `onExit`（方向 1-C/阶段2） | 高 |
| 阶段 3 | 守护保活 + 健康检查接入监控（方向 1-阶段3 + 方向 2） | 中 |
| 并行可即做 | 方向 4 的"默认身份拒写""per-agent 配额"（代码改动，不依赖守护） | 低 |
| 可选 | 方向 3 跨机（先答 3.5 开放问题，先接通 `sync`） | 高 |

---

## 7. 待实现清单（非现状，需代码/配置）
- [ ] 方向 1-阶段 0：supervisor 配置 + 崩溃重启验证
- [ ] 方向 1-阶段 1：`memory-backend` 模块边界 + CLI 入口
- [ ] 方向 1-阶段 2：`child_process` spawn + 本地 socket + 锁归属切换 + 移除 main `l0Vault.onExit`
- [ ] 方向 2：`mcpHttp.ts` 加 `GET /health`(含 `?deep=1`) + `GET /metrics`
- [ ] 方向 3：反向代理 TLS 模板 + per-agent 令牌扩展 + `sync` 接通
- [ ] 方向 4：默认身份拒写、per-agent 配额/限流、near-dup 合并
