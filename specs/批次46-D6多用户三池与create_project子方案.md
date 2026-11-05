# 批次46-D6 · 多用户三池 + create_project + 令牌代理受限令牌（需求/方案定稿）

> 状态：**需求与方案定稿，待用户确认两处关键岔路（见 §0）后即可进入原子编码（D6-1 … D6-6）**。
> 上游真源：`specs/MCP运维与多Agent写入规范.md` §3.2/§3.3（明确「令牌代理 mint 受限令牌与多用户三池尚未落地，属 D6」）、`specs/批次46-真正冲突裁决与摘要合并统计_落地方案.md`（D6 任务拆分 #16）、`specs/记忆库工具能力清单.md`（第 53 行 `create_project` 原标「🔲 净新增（D23 本期不开）」，经用户「并入 D6」确认）。
> 纪律：每个原子子任务一提交，收尾过 A/B/C 三道闸门（`specs/开发纪律_三道闸门.md`）。

---

## 0. 待确认的两处岔路（决定设计走向）

D6 范围虽已由用户枚举（create_project / 三池 / 令牌代理 mint / is_admin / StorageBackend.createProject），但其中两处有实质实现分歧，需先定：

### 岔路 A：令牌代理落到什么程度
- **A1（推荐）· 完整落地令牌代理**：新增文件化令牌库（`mcp-tokens.json`，0600），支持 `mint` 受限令牌（携带 `scope_project_ids` + `is_admin` + 可选 `expires_at`）；MCP 鉴权从「比对单一共享字符串」改为「按令牌库解析出 `McpAccount`（scope + is_admin）」。现有 `userData/mcp-token.txt` 转为**引导管理员令牌**（bootstrap admin，永远 is_admin=true、scope=`['*']`），其余 Agent 改用 mint 出的受限令牌。→ 为跨机（方向 3）准备好 per-client 凭据基础，且不破坏本地优先。
- **A2 · 最小落地**：保留单共享令牌不变，仅给 `McpAccount` 加 `is_admin` 布尔、`create_project` 要求 is_admin；令牌 mint 推迟到跨机阶段。→ 改动小，但不解决「单令牌跨网分发」问题，三池的 scope 仍只能靠手工配置 `scope_project_ids`。

### 岔路 B：三池用「显式注册表」还是「命名约定」
- **B1（推荐）· 显式项目注册表**：`StorageBackend` 增 `createProject/getProject/listProjects`（库内持久化项目元数据：`project_id` / `kind` / `owner_user_id` / `display_name` / `created_at`）。三池是 `kind` 枚举值（`shared` / `user` / `archive` / `general`）。`list_projects` 合并「注册表项目 + 既有隐式项目（记忆里出现但无注册项的，按 general 兼容）」，向后兼容。
- **B2 · 纯命名约定**：不建注册表，`P-shared`/`P-<user>`/`P-archive` 仅靠 `project_id` 前缀约定 + `projectInScope` 规则；`create_project` 仅做轻量元数据登记（甚至只校验命名）。→ 改动最小，但 `owner_user_id`/`display_name` 等元数据无处落、门禁弱。

> 默认推荐 **A1 + B1**：一次把「本地优先多用户」地基打牢，且为跨机（方向 3）预留 per-client 凭据与项目治理，不偏离本地优先定位。若选 A2/B2 则本方案相应段落降级。

---

## 1. 现状基线（代码核实，非推断）

- **项目是隐式的**：`list_projects` / `list_memories` 都从 `storage.listMemories({})` 反推 `projectInfosFromMemories`（`mcpReadTools.ts:93`），**无项目注册表**。
- **`StorageBackend` 接口**（`types.ts:776`）只有记忆 + 审计 + 批量，**无 createProject / getProject / listProjects**。
- **`McpAccount`**（`mcpAuth.ts:8`）只有 `user_id/team_id/enterprise_id/scope_project_ids`，**无 `is_admin`**。
- **令牌**：单一共享 `McpOptions.token` 字符串；`assertMcpToken`/`tokenEquals`/`tokenFromHeaders`（`mcpAuth.ts`），**无令牌库、无 mint**。引导令牌落 `userData/mcp-token.txt`（0600，`main.ts:505-520`）。
- **`projectInScope`**（`mcpAuth.ts:24`）：`'*'` 全放行或显式列表；是所有读写工具的统一作用域门禁。
- **home 端已有管理员账户体系**（`home/server.ts` 的 `seedAdminAccount`/`setAccountRole`），但**与 MCP 令牌账户是两回事**，D6 的 `is_admin` 走令牌库级别（见 §0 A1），不与 home 账户耦合。
- **`tools/list` 现 10 工具**（`mcpSchema.ts:23` MCP_TOOLS），`create_project` 尚未存在。

---

## 2. 目标与范围

把「单共享令牌 + 隐式项目」升级为「令牌代理受限令牌 + 显式项目注册表 + 三池治理」，本地优先、不裸奔公网。交付 5 件事：

1. **`StorageBackend.createProject` 及配套**：项目注册表（持久化、向后兼容隐式项目）。
2. **三池模型**：`P-shared`（全员可见）/ `P-<user>`（每用户私有，自动供给）/ `P-archive`（归档池，隐藏）。以 `ProjectKind` 枚举承载。
3. **`is_admin`**：令牌记录与 `McpAccount` 携带 `is_admin`；`create_project` 与令牌 mint 仅管理员可调用。
4. **令牌代理 mint 受限令牌**（按 §0 A1）：令牌库 + mint + 按库解析账户。
5. **`create_project` MCP 工具**（管理员专属）：创建/登记项目、指定池与归属。

> 明确**不在 D6**：跨机传输（反向代理/mTLS，方向 3）、`sync` 接通、`/health`/`/metrics`（方向 2）。这些保持原「待实现」状态。

---

## 3. 关键设计

### 3.1 项目注册表（B1）
- `types.ts` 增 `ProjectKind = 'shared' | 'user' | 'archive' | 'general'` 与 `ProjectRecord { project_id; kind; owner_user_id?; display_name?; created_at; created_by }`。
- `StorageBackend` 增 `createProject(input): Promise<ProjectRecord>`、`getProject(id): Promise<ProjectRecord | null>`、`listProjects(filter?): Promise<ProjectRecord[]>`；`InMemory` 与 `FileStorage` 各实现（`FileStorage` 落 `projects.json`，单写锁内）。
- **向后兼容**：`listProjects` 返回「注册表项目 ∪ 记忆里出现但无注册项的（按 general 兜底）」；`getProject` 查不到时，若该 `project_id` 在记忆里存在，返回 general 兼容记录；都不存在才 null。`write_memory` 仍可写到任意 `project_id`（允许 ad-hoc），但 `create_project` 提供受管入口。
- **三池规则**：
  - `P-shared`：启动时若注册表无 `P-shared` 则自动建（kind=shared，`is_admin` 或引导令牌可写全员可见）；`projectInScope` 对 `P-shared` 永远放行（无论 scope 列表）。
  - `P-<user>`：首次为该 `user_id` 签发/访问时自动建（kind=user，owner=该 user）；只有 `owner_user_id === account.user_id` 或 `is_admin` 才在 scope 内。
  - `P-archive`：归档/删除落地的目标池（kind=archive），`list_projects` 与常规召回**默认隐藏**，仅 `is_admin` 可见。

### 3.2 `is_admin` 与令牌代理（A1）
- `mcpAuth.ts` 的 `McpAccount` 增 `is_admin: boolean`。
- 新增 `TokenRecord { token; scope_project_ids; is_admin; label?; expires_at?; created_at; created_by }` 与令牌库 `TokenStore`（文件化 `mcp-tokens.json`，0600；`InMemoryTokenStore` 供测试）。
- `assertMcpToken` 改为：先用旧逻辑校验强度；再 `tokenStore.resolve(token)` → 命中则返回 `McpAccount`（scope + is_admin），未命中（且非引导令牌）则 `-32001 unauthorized`。引导令牌（`mcp-token.txt`）在库缺失时作为隐式 admin 记录。
- `McpOptions` 增 `tokenStore`（注入）；`main.ts` 装配时传入文件化实例（路径 `userData/mcp-tokens.json`）。
- **mint 入口**：新增管理员专属 MCP 工具 `mint_token`（或并入 `create_project` 同族）；参数 `label` / `scope_project_ids` / `is_admin` / `expires_at?`，返回一次性明文令牌（只回显一次，库里只存哈希）。`is_admin=true` 的令牌仅允许由已持有 `is_admin` 的令牌 mint。

### 3.3 `create_project` 工具
- `mcpSchema.ts` MCP_TOOLS 增 `create_project`（第 11 个工具，`tools/list` 从 10 → 11，并更新 `required`/`description`）。
- 参数：`project_id`（必填，命名规则校验：shared 固定 `P-shared`、user 为 `P-<user>`、其余 `P-<slug>`）、`kind`（默认 general）、`display_name?`、`owner_user_id?`。
- 门禁：调用前校验 `account.is_admin === true`，否则 `-32602`；`project_id` 重名/非法命名明确拒绝。
- 两端（`mcp.ts` / `mcpHttp.ts`）新增 `create_project` case，复用 `runCreateProjectTool(storage, args, account)`。

### 3.4 作用域门禁下沉
- `projectInScope` 保留；额外在 `mcpReadTools`/`mcpRecall`/`mcpWrite` 等接入点确认：`P-shared` 恒可见、`P-<user>` 仅归属、`P-archive` 仅 admin；越界/无 scope 仍 `-32602`。

---

## 4. 任务拆分（每子任务 = 一原子提交，独立三道闸门）

| 子任务 | 内容 | 主要落点 | AC 概要 |
|---|---|---|---|
| **D6-1** | 项目注册表：`StorageBackend.createProject/getProject/listProjects` + 向后兼容 | `types.ts`、`storage.ts`(InMemory)、`fileStorage.ts`、`__tests__/storage*.test.ts` | 注册表增删查；`listProjects` 合并隐式；`FileStorage` 落盘 + 单写锁；既有 list_projects 行为不变 |
| **D6-2** | 三池模型：`ProjectKind` + `P-shared` 自动建 + `P-<user>` 自动供给 + `P-archive` 隐藏 + `projectInScope` 规则 | `mcpAuth.ts`、`storage.ts`、`mcpReadTools.ts`、`mcpRecall.ts` | 三池语义；`P-shared` 恒可见、`P-<user>` 仅归属、`P-archive` 仅 admin；越界拒绝 |
| **D6-3** | `is_admin` 字段 + 门禁骨架（先不接令牌库，默认引导令牌 is_admin=true） | `mcpAuth.ts`、`mcp.ts`、`mcpHttp.ts`、`mcpSchema.ts`(指令) | `create_project` 占位校验 is_admin；非 admin 明确拒绝；其余工具不受影响 |
| **D6-4** | 令牌代理：TokenStore + TokenRecord + mint + 按库解析 McpAccount + 引导令牌兼容 | `tokenStore.ts`(新)、`mcpAuth.ts`、`mcp.ts`/`mcpHttp.ts` 接线、`main.ts` 装配、密钥文件 0600 | 文件化令牌库；mint 受限令牌（scope/is_admin/过期）；解析失败 unauthorized；库缺失时引导令牌为 admin |
| **D6-5** | `create_project` + `mint_token` 两工具落地（TCP/HTTP 共用编排）+ `tools/list` 11 工具 + 指令 | `mcpSchema.ts`、`mcpGcTools?`→`mcpProjectTools.ts`(新)、`mcp.ts`、`mcpHttp.ts`、`__tests__/mcp.test.ts`、`__tests__/mcpHttp.test.ts` | 两工具管理门禁；端到端链路；`tools/list` 断言 11；越界/非 admin 拒绝 |
| **D6-6** | 活文档同步：工具能力清单、需求规格书 §19.5、MCP运维规范 §3、code-map | `specs/*` | 同步三池/令牌代理/is_admin/create_project 口径；回填本批次哈希 |

> 子任务顺序 D6-1 → D6-2 → D6-3 → D6-4 → D6-5 → D6-6；每个独立提交、独立过闸；A1/B1 前提下如此拆分，若选 A2/B2 则 D6-4 降级、D6-1 可简化。

---

## 5. 影响面与风险

- **A 影响面**：`StorageBackend` 接口新增方法 → 所有实现（InMemory/FileStorage）与 `MemAgentOptions` 装配点；`McpAccount` 加字段 → 所有 `account.scope_project_ids` 调用点（mcp.ts/mcpHttp.ts/mcpRecall.ts/mcpReadTools.ts/mcpManageTools.ts/mcpGcTools.ts + 测试）；`mcpAuth` 校验改路径 → 全部鉴权测试（mcpScope.test.ts）；`tools/list` 10→11。
- **风险**：令牌库引入持久化文件与密钥管理，需严格 0600 + 不进日志；`P-shared` 恒可见若误用会泄漏；`P-archive` 隐藏若遗漏会暴露已删记忆；注册表与隐式项目合并逻辑若出错会破坏 list_projects。
- **回归基线**：46-4 全量 178 文件 / 2164 项、受影响 3 套件 124 例；D6 每个子任务至少跑全量 + 受影响套件 + typecheck + oxlint + code:index。

---

## 6. 三道闸门约定（沿用）

- **A·影响面回归**：影响面清单 + 全量 `vitest run --maxWorkers=1` + 受影响套件 + `npm run typecheck`(两工程) + `npx oxlint` + `npm run code:index -- --write`/`--check`。
- **B·效果验证**：AC→正向端到端用例断言状态/注册表/令牌库真变了；反向断言（非 admin 被拒、越界被拒、archive 隐藏、库缺失时引导令牌仍 admin）真没变。
- **C·变异验证**：C1 代码级变异（如把 is_admin 门禁改恒 true、把 P-shared 恒可见改条件）必须红灯，还原后逐字一致；C2 参数/状态矩阵（scope 组合、token 过期、owner 错配、重名、非法命名）。纯文档子任务（D6-6）用 C3 反向核对。
