---
title: 需求规格书_内核API契约
status: imported
---

# 内核 API 契约（memagent-core）

> 配套：《需求规格书》第 19 章（19.10 端谱 / 19.11 技术架构）、《需求规格书_同步机制详细设计》。
> 本契约把 `memagent-core`（TypeScript 内核）对 6 个端壳（桌面/Web/移动/macOS/Linux/CLI）暴露的 **API 签名、数据 schema、错误码、各端 Provider 注入** 定死，让各端可**并行开发**且**业务逻辑零复制**（19.11 红线①）。
> 内核 = 唯一事实源；端壳只调用，不实现业务。

## 0. 设计原则（来自 19.11）

| 原则 | 约束 |
|---|---|
| 内核零 UI 耦合 | 端壳只能调 `memagent-core` API；召回/写入/生命周期/反代理路由/同步全部在内核，端壳不得复制 |
| 语言 | TypeScript + Node.js 运行时；各端壳经同一 API |
| 向量检索可插拔 | `VectorBackend` 默认 JS 实现，性能瓶颈切 **Rust/WASM**，接口同构、切换无感（19.11 结论 2） |
| LLM 全端一致 | 反代理路由（先免费后低价 + 单价上限 + 成本封顶，19.8）**写在内核**，`LlmProvider` 只负责"这个 model 怎么调" |
| 全端同账号同步 | 同步身份 = 账号（user_id + team_id）；桌面本地库 = P0 主源（19.10） |
| 每端注入 | 端壳启动时注入 `Form`（端形态）+ `LlmProvider` + `VectorBackend` + `StorageBackend`，内核据此降级/路由 |

## 1. 入口与端壳注入

```ts
import { createMemAgent, type Form, type LlmProvider, type VectorBackend, type StorageBackend } from "memagent-core";

const ma = createMemAgent({
  form: "desktop",            // 端壳注入：desktop|web|mobile|mac|linux|cli（19.10）
  account: { user_id, team_id, enterprise_id },   // 同步身份（18.2-A）
  llm: new DesktopLlmProvider(),   // 各端不同实现，见 §5
  vector: new JsVectorBackend(),   // 或 new RustWasmVectorBackend()（性能瓶颈时）
  storage: new SqliteStorage(),    // 桌面/CLI/移动本地；Web 无本地（用服务端）
});
```

**红线**：`form` 决定发现能力与数据落点（19.10 矩阵）；内核据 `form` 自动降级（Web 端不渲染"扫本机进程"，19.9 R⑥）。

## 2. 核心 API（端壳调用面）

| API | 签名 | 返回 | 出处 |
|---|---|---|---|
| 召回 | `ma.recall(RecallReq) → RecallResult` | 命中记忆 + 证据 + 预算 + request_id | 2.4 |
| 写入 | `ma.write(MemReq) → WriteResult` | 新 mem_id + 查重结果 + 审计 | 2.2 / 6.1 |
| 生命周期 | `ma.gc(GcReq) → GcReport` | 衰减/裁决/嫁接报告 | 9.7 / 6.2 |
| 偏好 | `ma.getPrefs(user_id) → Pref[]` | 个人偏好（user_id 级跨 Agent） | 19.4 |
| 一键接入 | `ma.discover(DiscoverReq) → DiscoverResult` | 发现 + 打标 + 绑定 + 测通 | 19.9 |
| 同步 | `ma.sync(SyncReq) → SyncReport` | 回传/拉取/裁决/对账 | 19.11 / 5.1 |
| 查阅 | `ma.browse(BrowseReq) → BrowseResult` | L0–L6 某层内容（L0 需授权） | §4 |
| **L0 授权** | `ma.l0RequestAccess` / `ma.l0GrantAccess` / `ma.l0Unlock` / `ma.l0Heartbeat` / `ma.l0Lock` | 申请/发放/解锁/连续会话心跳/结束 | §4.3 / 4.4 |
| 日志 | `ma.logs(LogReq) → LogPage` | 运行日志 + 异常（分页/过滤） | §4 |
| 撤销绑定 | `ma.unbind(agent) → void` | 撤销自动绑定（审计 unbound） | 19.9 |

### 2.1 召回 `recall`
```ts
interface RecallReq {
  query: string;
  top_k?: number;                 // 1–10，默认 5
  project_id: string;             // 必填（19.4 跨 Agent 共享锚）
  user_id?: string;               // 个人偏好才用（19.4 / 9.2）
  scene?: "task_start"|"critical"|"default";
  mode?: "top_insight"|"fact_first"|"event_replay"|"pattern_reasoning"|"minimal"|null; // null=自动（16.5 critical 禁 minimal）
}
interface RecallResult {
  hits: Hit[];                    // 含 decay_class/pinned/locked/score/证据链接
  payload_tokens: number;         // 返回宿主 Agent 的 token（2.4.1）
  pipeline_llm_tokens: number;    // 召回链路自身 LLM 消耗（2.4.1）
  budget: { soft:1500, warn:2000, hard:3000, status:"ok"|"warn"|"fused" };
  evidence_thin?: boolean;        // 逃生阀（2.4.3）
  request_id: string;             // 审计链路（18.2-E）
}
```

### 2.2 写入 `write`
```ts
interface MemReq {
  content: string;
  category: "fact"|"decision"|"pitfall"|"insight"|"preference"|"context"; // 17.6 六类
  project_id: string;
  user_id?: string;
  session_id?: string;
  source_agent?: string;          // 哪个 Agent 沉淀（19.x）
}
interface WriteResult {
  mem_id: string;
  dedup: {
    action: "new"|"merged"|"duplicated"|"grafted"|"filtered"; // grafted=分支嫁接；filtered=质量门拦截
    sim: number;
    graft_to?: string;        // 分支嫁接：目标 memory_id
    graft_layer?: "L1"|"L2"|"L3"|"L4"|"L5"|"L6"; // 命中层
  };
  audit: AuditRef;
}
```
> L0 加密由端壳注入的 `L0Vault` 完成；`MemReq` **不接受明文 L0 密码**。写密钥未解锁 → `E_L0_LOCKED`，不落明文、不降级。逐层生成/查重/嫁接规则见《需求规格书》§2.2/§6.1/§6.2。

## 2.3 记忆打分与衰减公式（批次43 对齐自 SOP §13.2 / 契约 §0）

召回排序与衰减计分采用固定权重公式（来源 `forgetting.ts`）：

```
score = relevance × ( 0.35·新鲜度 + 0.30·重要性 + 0.15·可信度 + 0.20·访问boost ) + pinned×0.15
```

| 输入 | 权重 | 应由谁写入 | MCP 现状 | 后果 |
|---|---|---|---|---|
| 新鲜度 f | 0.35 | recall 自动回写 `last_access_time` | ✅ 通 | — |
| 重要性 imp | 0.30（最高） | 写入时标注 | ❌ `write_memory` 无入参 → 恒 0.5 | `fact`(365天) 与 `context`(2天) 的半衰期差异无法表达 |
| 可信度 conf | 0.15 | 用户 confirm/reject | ❌ 无 feedback 工具 → 恒 0.5 | 被纠正过的错误记忆与新写入的正确记忆衰减速度相同 |
| 访问 boost | 0.20 | `access_count/10` | ⚠️ 只能被动 | Agent 无法主动强化 |

**两把锁死旋钮**（当前 MCP 通道无法表达）：
- `importance` 因 `write_memory` 无入参，恒 0.5，无法区分规范(应 0.9) / 架构决策(0.8) / 踩坑(0.7) / 临时上下文(0.3)；
- `confidence` 因无 `feedback` 工具，恒 0.5，用户 confirm/reject 无法回写。

**整改方向（与 `mcp-extension-contract.md` §2 一致）**：`write_memory` 新增可选入参 `importance` / `confidence` / `half_life_days` / `tags`，并新增 `feedback` 工具（confirm +0.1 / reject −0.05 / disputed 挂裁决），解锁两把旋钮。

> 注意：本公式是**衰减/召回排序打分**，与 `recallModes.ts` 的**召回模式选择权重**（如 top_insight 0.20/0.40/0.10/0.30）是两回事，文档与实现须显式区分，避免混淆。

## 3. 数据 schema（内核 ↔ 存储）

### 3.1 记忆主表 `memories`
| 字段 | 类型 | 说明 |
|---|---|---|
| `mem_id` | string(ULID) | 主键 |
| `project_id` | string | 跨 Agent 共享域（19.4） |
| `user_id` | string? | 仅个人偏好类（9.2） |
| `enterprise_id`/`team_id` | string | 租户（18.2-A，全局注入禁手填） |
| `category` | enum | 17.6 六类 |
| `layer` | L1\|L2\|L3\|L4\|L5\|L6 | **最高连续层**（不含 L0；缺层即止，不跳层） |
| `content_l0_enc` | text(加密信封) | **L0 原始加密对话 v2 信封**（DEK + 随机 IV/tag），仅授权可查（§4.4） |
| `content_l1`…`content_l6` | text | 各层可读内容；Lk 只存真实 LLM 产物 |
| `embedding` | vector | **从 L1 生成**；Rust/WASM 后端产出（§5） |
| `graft_to` | string? | 分支嫁接：目标 memory_id |
| `graft_layer` | L1…L6? | 分支嫁接：命中层 |
| `grafted_from` | string[]? | 目标记忆上记录的所有嫁接分支 memory_id |
| `decay_class` | hot\|warm\|cold\|archived\|dormant | 17.7 分层 |
| `pinned`/`locked` | bool | 17.5/17.8 置顶/豁免 |
| `sim`/`conflict_id` | — | 查重/冲突（6.1/9.7） |
| `version` | int + vector clock | **同步用**（§同步文档） |
| `created_by_agent` | string | 来源 Agent |

### 3.2 审计 `audit_log`（全动作可查，4.3 / 18.2-E）
| 字段 | 说明 |
|---|---|
| `request_id` | 审计链主键 |
| `action` | recall / write / **graft** / gc / auto_bind / unbound / sync / llm_proxy / llm_fallback / log_view / **l0_view** / **l0_auth_request** / **l0_auth_grant** / **l0_auth_deny** / **l0_auth_revoke** / **l0_auth_expire** / **l0_auth_fail** |
| `agent` / `form` | 哪个 Agent + 哪个端（19.10） |
| `project_id`/`user_id` | 隔离锚 |
| `ts` | 时间戳 |
| `detail` | 上下文（本次花费/命中数/裁决结果等） |

> **所有动作都写审计**（19.11 红线 + 4.3）：`recall`/`write`/`gc`/`auto_bind`/`sync`/`l0_view`/`llm_proxy_source` 全记，日志页可查（§4）。

## 4. 查阅与日志 API

### 4.1 全层查阅 `browse`（L0–L6 可查，L0 需连续授权会话）
```ts
interface BrowseReq {
  layer: "L0"|"L1"|"L2"|"L3"|"L4"|"L5"|"L6";
  project_id: string;
  session_id?: string;
  l0_auth?: {
    grant_id?: string;       // 管理员发放的 grant；管理员直接查阅可省略
    password?: string;       // 首次解锁；不落盘、不回显、不进日志
    l0_session_id?: string;  // 已解锁后的连续查阅会话（推荐，后续请求不再传密码）
  };
}
interface BrowseResult {
  rows: Row[];
  l0_masked: boolean;
  l0_session?: { l0_session_id: string; expires_at: number; idle_timeout_ms: number };
  audit: AuditRef;
}
```
| 规则 | 说明 |
|---|---|
| L1–L6 直接可查 | 界面可浏览全部精炼层内容（17.x）；Lk 无真实产物 → 空态，不回落 L1 |
| **L0 首次解锁** | 必须带 `grant_id` + `password`（非管理员）或管理员管理密码；指定账号必须与 grantee 一致；成功后返回 `l0_session` |
| **L0 连续查阅** | 后续请求带 `l0_session_id`；每次 `browse` 刷新活动时间；5 分钟无活动 → 会话失效、grant 作废、删除 wrapped DEK；再次查阅须重新申请 |
| **L0 审计** | 成功 → `l0_view`（form/request_id/user_id/grant_id/l0_session_id/project_id/mem_ids）；失败 → `l0_auth_fail`，不得写 `l0_view` |
| **全有或全无** | 一次请求中任一命中记忆解密失败 → 整次 `E_AUTH_L0`，不返回部分明文 |
| 未授权/密码错 | L0 列恒显示遮罩 `[L0 已加密 · 需授权]`，不泄露明文 |

### 4.2 日志 `logs`（日志记录页数据源）
```ts
interface LogReq { level?: "info"|"warn"|"error"; form?: Form; action?: string; since?: ts; limit?: number; cursor?: string; }
interface LogPage { items: LogItem[]; next_cursor?: string; }
interface LogItem { ts; level; form; action; agent?; request_id; message; ref_audit: string; }
```
- 日志页 = `logs` 的分页 + 过滤 UI（level/form/action/时间）；每条可跳审计（`ref_audit`）。
- **异常**特指：熔断 OPEN、同步失败、反代理额度超限、L0 解密失败、向量后端报错——`level=error`，置顶。
- **动作枚举**：`recall` / `write` / `graft` / `gc` / `auto_bind` / `unbound` / `sync*` / `llm_proxy` / `llm_fallback` / `log_view` / `l0_view` / `l0_auth_request` / `l0_auth_grant` / `l0_auth_deny` / `l0_auth_revoke` / `l0_auth_expire` / `l0_auth_fail` / `security_change`。

### 4.3 L0 授权与会话 API（2026-10-30 拍板）

```ts
interface L0AccessRequest { project_ids: string[]; reason?: string; }
interface L0AccessRequestResult { request_id: string; status: "pending"; }
interface L0GrantReq { request_id?: string; grantee_user_id: string; scope_project_ids: string[]; password?: string; }
interface L0Grant { grant_id: string; grantee_user_id: string; scope_project_ids: string[]; status: "active"|"expired"|"revoked"|"consumed"; created_at: number; last_view_at?: number; expires_at?: number; }
interface L0UnlockReq { grant_id?: string; password: string; }   // 管理员直接查阅可省略 grant_id
interface L0UnlockResult { l0_session_id: string; grant_id?: string; expires_at: number; idle_timeout_ms: number; }
```

| API | 角色 | 说明 | 审计 |
|---|---|---|---|
| `ma.l0RequestAccess(req)` | 已登录用户 | 申请指定 project 的 L0 查阅；返回 request_id | `l0_auth_request` |
| `ma.l0ListRequests()` / `ma.l0ListGrants()` | 管理员 | 审批面板数据 | 只读 |
| `ma.l0GrantAccess(req)` | 管理员 | 指定账号 + 一次性密码 + scope；用授权密码包裹 DEK | `l0_auth_grant` |
| `ma.l0DenyRequest(request_id, reason)` | 管理员 | 拒绝申请 | `l0_auth_deny` |
| `ma.l0RevokeGrant(grant_id, reason)` | 管理员 | 撤销未过期/活动授权 | `l0_auth_revoke` |
| `ma.l0Unlock(req)` | grantee/管理员 | 校验账号+密码，解开 DEK，创建 5min 连续会话 | 首次 `browse` 记 `l0_view` |
| `ma.l0Heartbeat(l0_session_id)` | grantee/管理员 | 刷新活动时间；不写 `l0_view` | 无（避免噪声） |
| `ma.l0Lock(l0_session_id)` | grantee/管理员 | 主动结束查阅；作废 grant | `l0_auth_expire` |
| `ma.l0UnlockWrite(password)` / `ma.l0LockWrite()` | 管理员 | 解锁/锁定后台写入 DEK 缓存 | `security_change` |
| `ma.l0MigrateLegacy(old_password?)` | 管理员 | `content_orig` / v1 信封迁移到 v2 | `security_change` |

**红线**：
- 授权密码/DEK 不落盘、不进日志/审计/URL；`l0_session_id` 仅主进程内存。
- **5 分钟无活动 → 会话失效、grant 作废、删除 wrapped DEK；再次查阅重新申请。**
- 应用重启/锁屏/休眠 → 所有 `active` grants 作废；写密钥缓存清空。
- 未解锁写密钥 → `E_L0_LOCKED`；不落明文、不降级。
- `l0_view` 只在成功后记；失败写 `l0_auth_fail`。

## 5. 各端 Provider 注入（全端一致的路由 + 各端不同的实现）

### 5.1 LlmProvider（19.8 反代理）
```ts
interface LlmProvider {
  listModels(): Model[];           // 该端可用的模型（含 档位/单价/免费额度/余量）
  call(model: string, prompt: string, ctx: Ctx): Promise<Resp>;
}
```
| 端 | Provider 实现 | listModels 来源 |
|---|---|---|
| 桌面/mac | `DesktopLlmProvider`（本机 MCP 枚举 + 各 Agent 免费/低价端点） | 全量跨 Agent（19.8） |
| Web/移动 | `RemoteLlmProvider`（用户配置的远程端点，经服务端代理） | 受限 |
| CLI/Linux | `SystemLlmProvider`（系统级模型端点） | 系统 |

**路由（内核统一，全端一致，19.8）**：`先免费 → 后低价（单价 ≤ proxy_price_cap，用户定不可超）→ 成本封顶 proxy_cost_cap → 超限回退本地`；审计记 `llm_proxy_source` + 花费 + 生效模式（auto/manual）。

### 5.2 VectorBackend（JS ↔ Rust/WASM 可插拔）
```ts
interface VectorBackend {
  embed(texts: string[]): Promise<Float32Array[]>;
  search(vec: Float32Array, k: number, filter: Filter): Promise<Scored[]>;
}
```
| 实现 | 场景 |
|---|---|
| `JsVectorBackend` | 起步（默认，全端可用） |
| `RustWasmVectorBackend` | 大规模 embedding 检索/重排的性能层（同构接口，切换无感，19.11 结论 2） |

### 5.3 StorageBackend（数据落点，19.10）
| 端 | 实现 | 落点 |
|---|---|---|
| 桌面 | `SqliteStorage`（SQLite + DuckDB 向量） | **本地库 = P0 主源** |
| CLI/移动 | `SqliteStorage`（本地/系统） | 本地/系统库 |
| Web | `ServerStorage`（无本地，直读服务端镜像） | 服务端 |
| CLI/Linux | `SystemStorage`（`~/.config` 或 `/var/lib`，team_id 隔离） | 系统独立库 |

## 6. 错误码（各端统一处理）

| 码 | 含义 | 端壳行为 |
|---|---|---|
| `E_AUTH_L0` | L0 未授权/密码错/换账号/解密失败 | 保持遮罩，提示授权；写 `l0_auth_fail` |
| `E_L0_LOCKED` | L0 写密钥未解锁（后台写入/采集） | 不落明文；提示管理员解锁；采集器不推进游标 |
| `E_L0_NO_GRANT` | 非管理员未申请/未获授权 | 遮罩 + 引导“申请查阅” |
| `E_L0_EXPIRED` | 授权/连续会话已过期（5min 无操作、重启、锁屏、被撤销） | 遮罩 + 提示“重新申请” |
| `E_BUDGET_FUSE` | 召回预算硬熔断（3000t） | 降级 minimal/占位符 |
| `E_LLM_FALLBACK` | 反代理超限，已回退本地 | 记 `llm_fallback`（4.3） |
| `E_SYNC_CONFLICT` | 版本冲突待裁决 | 进 9.7 裁决队列（P8） |
| `E_FORM_DISABLED` | 当前端能力不可用（19.9 R⑥） | 不渲染该功能 |
| `E_QUOTA` | 某 Agent 免费额度耗尽 | 该源停用，转其他源/本地 |
| `E_VECTOR` | 向量后端报错 | 回退 JS 实现 |

## 7. 各端调用样例

```ts
// 桌面端：一键接入 + 全量发现
const d = await ma.discover({ form:"desktop", signals:["mcp","proc","hb","manual"] });
// Web 端：降级（proc 不可用，内核据 form 自动排除）
const w = await ma.discover({ form:"web", signals:["mcp","hb"] });
// CLI：无 GUI，命令驱动
const c = await ma.discover({ form:"cli", signals:["mcp","proc"] });
// 全端一致的召回
const r = await ma.recall({ query:"为什么上次重构失败", project_id:"P1", scene:"critical" });
// L0 授权查阅：用户申请 → 管理员发放一次性密码 → 用户解锁 → 连续查阅 → 5min 无操作失效
const req = await ma.l0RequestAccess({ project_ids:["P1"], reason:"核对 L1 摘要与原文" });
const grant = await ma.l0GrantAccess({ request_id:req.request_id, grantee_user_id:"u_1", scope_project_ids:["P1"] }); // 管理员；密码由安全通道交付
const s = await ma.l0Unlock({ grant_id:grant.grant_id, password:"…" });
const b = await ma.browse({ layer:"L0", project_id:"P1", l0_auth:{ l0_session_id:s.l0_session_id } });
await ma.l0Heartbeat(s.l0_session_id); // 页面可见+有焦点时每 60s
// 5min 无活动 → 会话失效、grant 作废；再次查阅重新申请
// 日志页
const lg = await ma.logs({ level:"error", form:"web", since: now()-24*3600e3 });
```

## 8. 验收用例（契约级）

| 用例 | 期望 |
|---|---|
| 桌面→Web 同 recall | 两端口径一致（内核保证），仅 Provider/Storage 不同 |
| 反代理全端 | 桌面/Web/CLI 同用途反代理，路由"先免费后低价+单价上限"一致（内核实现） |
| 向量切 WASM | `JsVectorBackend` ↔ `RustWasmVectorBackend` 召回结果一致（接口同构） |
| L0 查阅（全流程） | 未授权 → `l0_auth_request` 申请 → 管理员指定账号 + 一次性授权密码（`l0_auth_grant`）→ 指定账号凭该密码 `l0Unlock` 成功 → 首次 `browse` 记 `l0_view`；未授权/错账号/错密码/过期一律遮罩 + `l0_auth_fail`，不得用 `l0_view` 冒充失败 |
| L0 连续会话 | 会话内每 60s 心跳；中断 < 5min 可继续，≥ 5min 自动锁定、grant 作废并删除 wrapped DEK；再次查阅必须重新申请（`l0_auth_expire` → `l0_auth_request`） |
| L0 后台写入 | 写密钥未解锁 → `E_L0_LOCKED`，不落明文、不降级、采集器游标不前进；管理员 `l0_write_unlock` 后仅可写不可查阅；锁屏/休眠/退出清空写密钥 |
| 逐层查重与嫁接 | L1–L6 每层生成后立即按该层阈值查重；命中 → `dedup.action='grafted'` + `graft_to`/`graft_layer`，停止更深层；未命中 → 继续下一层；无真实 LLM → 只落 L1（`refined_by='stub'`） |
| 日志页 | `logs` 按 level/form/时间过滤，异常置顶，每条可跳审计 |
| 能力降级 | Web 端 `discover` 的 `proc` 信号自动剔除（E_FORM_DISABLED） |
