# MultiAgent Memory — MCP 工具扩展接口契约（草案 v1.0）

<!-- doc-version: v1.1 -->

> 目标系统：`memagent-mcp` v1.0.0（`src/core/memagent/`）｜协议：MCP 2025-06-18｜传输：HTTP 8204 / TCP 8202
> 定位：**内核零改动**，把内核已实现、但 MCP 侧未透出的能力暴露给多 Agent
> 关联：`agent-memory-sop.md` §13（需求侧）、§7.2/§7.3（用法侧）

---

## 0. 为什么是这 6 项（问题陈述）

内核打分公式（`forgetting.ts:52`）：

```
score = relevance × ( 0.35·新鲜度 + 0.30·重要性 + 0.15·可信度 + 0.20·访问boost ) + pinned×0.15
```

| 输入 | 权重 | 应由谁写入 | MCP 现状 | 后果 |
|---|---|---|---|---|
| 新鲜度 f | 0.35 | recall 自动回写 `last_access_time` | ✅ 通 | — |
| 重要性 imp | **0.30（最高）** | 写入时标注 | ❌ `write_memory` 无入参 → 恒 0.5 | `fact`(365天) 与 `context`(2天) 的半衰期差异**无法表达** |
| 可信度 conf | 0.15 | 用户 confirm/reject | ❌ 无 feedback 工具 → 恒 0.5 | 被纠正过的错误记忆与新写入的正确记忆衰减速度相同 |
| 访问 boost | 0.20 | `access_count/10` | ⚠️ 只能被动 | Agent 无法主动强化 |

同时：内核有完整的 11 个记忆运维操作（`coreMemoryOp`）、用户反馈（`coreFeedback`）、遗忘引擎（`coreGc`），
**MCP 只暴露 4 个只读/写内容的工具** → Agent 只能加不能减，库单调膨胀。

## 1. 设计原则
1. **内核零改动**：全部为 MCP 适配层透出，复用 `coreMemoryOp` / `coreFeedback` / `coreGc` / `storage.listMemories`。
2. **向后兼容**：所有新增字段**可选**、有默认值；老客户端（不传新字段）行为**逐字节不变**。
3. **审计不断链**：新增写操作必须落 `audit_log`，`action='memory_op'`，`detail.op` 归因。
4. **安全继承**：所有内核既有约束（locked 豁免、钳制、令牌项目作用域）**自动生效**，MCP 层不得绕过。
5. **令牌作用域一致**：`recall` / `write` / `list` / `manage` 四者对 `project_id` 的校验口径必须一致（`projectInScope`）。

---

## 2. `write_memory` 扩展（新增 4 个可选入参）

**现状**（`mcpSchema.ts:38`）：入参仅 `content` / `project_id`（必填）+ `category` / `user_id` / `session_id` / `source_agent`。

### 2.1 Schema 增量

```jsonc
{
  "name": "write_memory",
  "inputSchema": {
    "type": "object",
    "properties": {
      "content":      { "type": "string",  "description": "原始会话片段（具体、可复用）" },
      "project_id":  { "type": "string",  "description": "项目 ID（必填）" },
      "category":    { "type": "string",  "enum": ["fact","decision","pitfall","insight","preference","context"] },
      "user_id":     { "type": "string",  "description": "用户 ID（须与会话身份一致）" },
      "session_id":  { "type": "string",  "description": "会话 ID（溯源）" },
      "source_agent":{ "type": "string",  "description": "来源 agent 标识" },

      "importance": {
        "type": "number", "minimum": 0.1, "maximum": 1,
        "description": "重要性 0.1–1，默认 0.5。写入时必须评估：这条被误删/被降权的代价有多大。\n建议：规范/硬约束 0.9；架构决策 0.8；踩坑 0.7；临时上下文 0.3。\n不传 = 0.5（等价于旧行为）。"
      },
      "confidence": {
        "type": "number", "minimum": 0.05, "maximum": 1,
        "description": "初始可信度 0.05–1，默认 0.5。事实类给 0.8；推断类给 0.5；待验证给 0.3。\n后续可由 feedback 工具的 confirm/reject 调整。"
      },
      "half_life_days": {
        "type": "integer", "minimum": 1,
        "description": "半衰期天数覆盖。省略时按 category 默认策略：fact 365 / preference 180 / decision 30 / pitfall 14 / insight 30 / context 2。\n显式传值优先于策略（内核 freshnessOf 已支持）。"
      },
      "tags": {
        "type": "array", "items": { "type": "string" }, "maxItems": 12,
        "description": "可选标签，用于后续 list_memories 过滤（≤12 个，单标签 ≤24 字符）"
      }
    },
    "required": ["content", "project_id"]
  }
}
```

### 2.2 内核映射
- `MemReq`（`types.ts:140`）新增 4 个可选字段 → `coreMemoryOp` 的 `bump()` 逻辑不变。
- 写入路径需把 `importance` / `confidence` / `half_life_days` / `tags` 落到 `Memory` 主表
  （`importance`/`confidence`/`half_life_days`/`tags` 字段**已存在**，见 `types.ts:504-510`，仅 MCP 入参未暴露）。
- `tags` 若主表无对应列，需 `storage` 层加字段（向后兼容：可空 JSON 列）。

### 2.3 兼容性
- 老客户端不传 → `importance=0.5`、`confidence=0.5`、`half_life_days=category 默认`、`tags=[]`，
  **与现状逐字节一致**（现状本就是 `?? 0.5` 兜底）。
- 建议同时更新 `MCP_INSTRUCTIONS` 第 4 条（沉淀），加入「写入时必须评估 importance」。

---

## 3. 新增 `feedback` 工具（P0）

**内核映射**：`coreFeedback(mem_id, kind, ctx)`（`memories.ts:634`）
**语义**：confirm → `confidence +0.1` 且 `reinforce_count +1`；reject → `confidence −0.05`（下限 0.05）；disputed → 不动分，挂 9.7 裁决（写 `conflict_id`）。

```jsonc
{
  "name": "feedback",
  "description": "对一条召回结果给出用户反馈，直接影响该记忆的可信度与强化计数。\n确认（confirm）→ confidence +0.1 且 reinforce_count +1；否定（reject）→ confidence −0.05（下限 0.05）；有争议（disputed）→ 不改分，挂冲突待裁决。\n在用户明确认可/否定召回内容时调用；不要凭自己的判断调用，用户没表态就不调用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mem_id":   { "type": "string", "description": "记忆 ID（来自 recall_memory 返回的 hits[].mem_id）" },
      "verdict":  { "type": "string", "enum": ["confirm", "reject", "disputed"], "description": "反馈类型" },
      "reason":   { "type": "string", "description": "可选原因（≤200 字），会写入审计 detail" },
      "conflict_id": { "type": "string", "description": "disputed 时可选：已有的冲突 ID（来自其他 Agent 的 disputed 记录）" }
    },
    "required": ["mem_id", "verdict"]
  }
}
```

**返回**（对齐 `FeedbackResult`，`types.ts:555`）：
```jsonc
{
  "ok": true,
  "mem": { "mem_id": "...", "confidence": 0.6, "reinforce_count": 2, "importance": 0.7 },
  "trust_delta": 0.1,
  "request_id": "req_..."
}
```

**约束**：
- `mem_id` 必须属于令牌作用域内的项目，否则报「当前 MCP 令牌作用域不含项目 X」。
- `disputed` 不改分，仅挂冲突 → 返回 `trust_delta: 0`。

---

## 4. 新增 `manage_memory` 工具（P0）

**内核映射**：`coreMemoryOp(mem_id, op, ctx, patch)`（`memories.ts:533`）

```jsonc
{
  "name": "manage_memory",
  "description": "记忆生命周期运维：置顶/取消置顶、锁定/解锁、归档/恢复、降权、强化、删除。\n用于修正错误、过时或噪声记忆，保持记忆库不膨胀。\n重要：delete 会清正文与 L0 密文且可跨端传播，不可逆——除非用户明确要求删除某条记忆，否则用 forget（降权不删）或 archive（归档可恢复）。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mem_id":  { "type": "string", "description": "记忆 ID" },
      "action":  {
        "type": "string",
        "enum": ["pin","unpin","lock","unlock","archive","restore","forget","remember","param","migrate","delete"],
        "description": "操作类型：\npin/unpin 置顶（打分 +0.15 且免检进候选集）\nlock/unlock 锁定（豁免一切自动迁移与手动操作，仅 unlock 放行）\narchive/restore 归档 / 恢复即回温（→hot）\nforget 降权 −0.2（不删）｜remember 强化 +0.2\nparam 调参（配合 patch）\nmigrate 改衰减档位（配合 patch.decay_class）\ndelete 删除墓碑（不可逆，需用户明确要求）"
      },
      "patch": {
        "type": "object",
        "properties": {
          "importance":    { "type": "number", "minimum": 0.1, "maximum": 1 },
          "confidence":    { "type": "number", "minimum": 0.05, "maximum": 1 },
          "half_life_days":{ "type": "integer", "minimum": 1 },
          "pinned":        { "type": "boolean" },
          "locked":        { "type": "boolean" },
          "decay_class":   { "type": "string", "enum": ["hot","warm","cold","archived","dormant"] }
        },
        "description": "仅 action='param' / 'migrate' 时使用；内核会做钳制兜底。"
      },
      "reason": { "type": "string", "description": "可选原因（≤200 字），写入审计 detail" }
    },
    "required": ["mem_id", "action"]
  }
}
```

**返回**（对齐 `MemOpResult`，`types.ts:543`）：
```jsonc
{
  "ok": true,
  "mem": { "mem_id": "...", "decay_class": "archived", "importance": 0.5, "pinned": false },
  "request_id": "req_..."
}
```

**错误语义**（沿用内核，**不得改写**）：
| 情况 | 返回 |
|---|---|
| 记忆不存在 | `ok:false, mem:null` |
| 目标是 `locked` 且 action ≠ `unlock` | `ok:false, blocked_locked:true` + 审计 `detail.blocked='locked'` |
| `delete` 成功 | `ok:true, mem:null`（墓碑：清正文 + 清 L0 密文 + 移除向量 + `deleted:true` + `pending_sync:true`） |

**权限与红线**：
- `delete` 建议默认**不开放**给 Agent（配置开关 `MCP_ALLOW_DELETE=1` 才暴露）；优先 `forget` / `archive`。
- `param` / `migrate` 会改衰减状态，**必须**继承 `locked` 检查（内核已有，MCP 层不得提前 return 绕过）。
- 全部操作写审计 `action='memory_op'`，`detail.op` 归因，`version + 1`。

---

## 5. 新增 `list_memories` 工具（P1）

**内核映射**：`storage.listMemories({...})` + `projectInfosFromMemories`（`mcpRecall.ts:227` 已有同款过滤范式）

```jsonc
{
  "name": "list_memories",
  "description": "按条件盘点项目内的记忆（治理用）。不带 query 时按时间倒序返回该项目的记忆清单，可用于发现过时、重复、低价值条目。\n与 recall_memory 的区别：recall 是语义检索（找答案），本工具是清单盘点（做治理）。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id":  { "type": "string", "description": "项目 ID（省略：唯一项目自动定位）" },
      "category":    { "type": "string", "enum": ["fact","decision","pitfall","insight","preference","context"] },
      "decay_class": { "type": "string", "enum": ["hot","warm","cold","archived","dormant"] },
      "source_agent":{ "type": "string", "description": "按写入来源过滤（如 workbuddy）" },
      "tag":         { "type": "string", "description": "按单个标签过滤（需 §2 落地 tags）" },
      "updated_since": { "type": "integer", "description": "仅返回 updated_at ≥ 该毫秒时间戳的条目" },
      "limit":       { "type": "integer", "minimum": 1, "maximum": 100, "description": "返回条数，默认 20" },
      "offset":      { "type": "integer", "minimum": 0, "description": "偏移，默认 0" }
    }
  }
}
```

**返回**：`{ ok:true, total, offset, limit, items:[{mem_id, category, decay_class, pinned, locked, importance, confidence, access_count, updated_at, snippet}] }`
> `snippet` 取 `content_l1` 前 200 字（**不返回 L0 密文**，L0 查阅仍须走授权会话）。

---

## 6. `recall_memory` 扩展：`scope='session'`（P1）

**目的**：给「工作记忆」一个正确出口——按会话 + 时间窗取回本会话近期的记忆，而不是新增 `memory_type` 字段。

```jsonc
{
  "name": "recall_memory",
  "inputSchema": {
    "properties": {
      // ...现有字段不变...
      "scope": {
        "type": "string", "enum": ["project", "session"],
        "description": "检索范围，默认 project（项目内全量语义检索）。\nsession = 只取本 session_id 近期写入的记忆（工作记忆视图），需同时传 session_id。\n适用于「上次我们聊到哪」「本次会话已确定了什么」这类问题；一般问答用 project。"
      },
      "session_id": {
        "type": "string",
        "description": "scope='session' 时必填：会话 ID（写入时用的同一个）。scope='project' 时可省略。"
      }
    }
  }
}
```

**实现要点**：
- `scope='session'` → 存储层按 `session_id` 过滤 + 按 `created_at` 倒序 + 截断至最近 N 条（如 10），**不再走向量语义检索**（工作记忆要的是"我们刚才说了什么"，不是"最相关的是什么"）。
- 仍然受令牌作用域与预算裁剪约束；命中数不足时如实返回，不补造。

---

## 7. 暴露遗忘引擎报告（P2）

**内核映射**：`coreGc({ project_id, resolve_conflicts? })` → `ForgettingCycleReport`

```jsonc
{
  "name": "gc_report",
  "description": "触发/查询记忆遗忘周期的结果：本次有多少条被降档、多少条被合并成长期概览、多少条新建了摘要。\n用于让 Agent 知道「记忆为什么变了」，避免把自动归档误判为记忆丢失。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "项目 ID" },
      "dry_run":    { "type": "boolean", "description": "true = 只演算不落库（默认 true）" },
      "resolve_conflicts": { "type": "boolean", "description": "是否同时执行冲突裁决" }
    },
    "required": ["project_id"]
  }
}
```
**返回**：`{ ok:true, report:{ freshness_updated, migrated, summaries_created, summaries_filtered, merged_originals, compressed }, request_id }`

---

## 8. 错误码与统一口径
沿用现有错误码体系，**不新增语义**：

| 码 / 文案 | 触发条件 | Agent 应做 |
|---|---|---|
| `当前 MCP 令牌作用域不含项目 X` | `project_id` 越界 | 改用 `list_projects` 里的真实项目 |
| `write_memory.project_id 必填（R2）` | 缺 project_id | 先 `list_projects` |
| `write_memory.content 必填且须为字符串` | content 缺失/类型错 | 补齐 |
| `E_L0_LOCKED` | 写密钥未解锁 | 挂起内容、提示安全页解锁、**解锁后原样重放**（SOP §10.2） |
| `blocked_locked: true` | 目标已 locked | 改用写入新条目 + 「替代 mem_xxx」 |
| `短料拒收 short_low_signal` | 有效字 <30 且无硬事实/技术证据 | **改写**（补事实与证据）后重写，不要重试原文 |
| `dedup.grafted` | 与已有记忆相似已合并 | 正常；见 SOP §7.3 自纠偏判据 |

---

## 9. 实施落点（内核零改动）
| 文件 | 改动 |
|---|---|
| `src/core/memagent/mcpSchema.ts` | `MCP_TOOLS` 增改 4 项 + 新增 3 工具（`feedback`/`manage_memory`/`list_memories`/`get_write_status`）；`MCP_INSTRUCTIONS` 第 4 条补 importance 引导 |
| `src/core/memagent/mcp.ts` | `switch (method)` 增 `feedback` / `manage_memory` / `list_memories` / `gc_report` / `get_write_status` 五个 case；`write_memory` 分支透传新字段 |
| `src/core/memagent/mcpRecall.ts` | `runRecallTool` 增 `scope='session'` 分支 |
| `src/core/memagent/types.ts` | `MemReq` 增 4 个可选字段；**`L0Port` 增可选方法 `status?()`**（§11） |
| `src/core/memagent/mcpAuth.ts` | **不改**；`projectInScope` 直接复用 |
| `src/core/memagent/memories.ts` | **不改**；`coreMemoryOp` / `coreFeedback` / `coreGc` 原样调用 |
| `src/core/memagent/l0vault.ts` | **不改**；`status()` 已实现（`l0vault.ts:788`） |
| `src/core/memagent/agent.ts` | 暴露 `_memoryOp` / `_feedback` 的调用位（`types.ts:697-700` 已有签名） |
| `specs/需求规格书_内核API契约.md` | 补 §2.3 / 新增 §2.4–2.9 的 MCP 面描述 |

---

## 10. 验收用例（契约级）
1. **向后兼容**：老客户端只传 `content`+`project_id` → 返回结构与改动前**逐字节一致**。
2. **重要性生效**：写入 `importance=0.9` 的 fact，10 天后 `decay_class` 仍为 `hot`；同条件 `importance=0.3` 的 context 已降至 `cold`。
3. **反馈生效**：对同一条记忆 `confirm` 两次 → `confidence` 由 0.5 → 0.7、`reinforce_count=2`；`reject` 一次 → 0.45。
4. **locked 豁免**：对 `locked=true` 的记忆调 `manage_memory(action='archive')` → 返回 `blocked_locked:true`，且 `decay_class` **未变**。
5. **作用域一致**：`manage_memory` 作用于令牌作用域外项目的 `mem_id` → 报作用域错误，不泄露该记忆是否存在。
6. **审计不断链**：每次 manage/feedback 均可在 `audit_log` 查到 `action='memory_op'` 且 `detail.op` 正确。
7. **会话作用域**：`scope='session'` 只返回该 `session_id` 的条目，不返回同项目其他会话的记忆。
8. **删除不可逆**：`delete` 后 `content`/`content_l0_enc`/`embedding` 均为空，`deleted=true`，且 L0 库中密文一并销毁。

---

## 11. 新增只读工具 `get_write_status`（P0）

**为什么需要**：Agent 目前**无法在写入前知道 L0 写密钥是否解锁** —— `write_unlocked` 只存在于主进程内存
（`L0Vault.status()`）与 Electron IPC `l0:status`（渲染层 → 主进程），MCP / HTTP 侧没有任何出口
（8204 只服务 `/mcp` 与 `/recall/<id>`；8200 接入配置、8201 镜像、8202 TCP MCP、8203 Webhook）。
唯一信号是写入回执里的 `E_L0_LOCKED` —— 那时内容已备好却写不进去。

**实现成本极低（内核逻辑零改动）**：
- `main.ts:2458` 已把 `l0: l0Vault` 注入 MCP server（`McpHttpOptions.l0?: L0Port`，`mcpHttp.ts:120` 转交内核）；
- `L0Vault.status()`（`l0vault.ts:788-793`）**已实现**，返回 `{ has_admin_wrap, write_unlocked, active_sessions, active_grants }`；
- 只需给 `L0Port` 接口补一个**可选**方法，MCP 侧加一个 case：

```ts
// types.ts —— L0Port 增加可选方法（向后兼容：老实现不提供时 MCP 侧如实回 unknown）
export interface L0Port {
  seal(plain: string): Promise<string>;
  decrypt(req: { l0_session_id: string; project_id: string; mem_id: string; envelope: string }): Promise<string>;
  sessionInfo?(l0_session_id: string): Promise<{ grant_id?: string; user_id: string; scope_project_ids: string[]; expires_at: number }>;
  /** 写密钥状态（只读）。未实现时调用方须如实回 unknown，不得猜测。 */
  status?(): Promise<{
    has_admin_wrap: boolean;
    write_unlocked: boolean;
    active_sessions: number;
    active_grants: number;
  }>;
}
```

```jsonc
{
  "name": "get_write_status",
  "description": "读取 L0 写密钥的解锁状态（只读，无副作用）。写入前调用可避免撞上 E_L0_LOCKED。\nwrite_unlocked=false 表示写密钥已锁定（常见于应用重启后主进程清空 writeDek），此时应提示用户在 MultiAgent Memory 安全页解锁写密钥，而不是改写内容或反复重试。\n本工具不返回任何密钥材料，只返回布尔状态与计数。",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
```

**返回**：
```jsonc
{
  "ok": true,
  "write_unlocked": true,
  "has_admin_wrap": true,
  "active_sessions": 0,
  "active_grants": 0,
  "source": "vault.status"
}
```

**未实现时**（`opts.l0.status` 不存在）：返回 `{ "ok": true, "write_unlocked": null, "source": "unavailable" }`
—— **如实说不知道，不猜**（与内核"无日志就诚实 skip"的既有风格一致）。

**配套改动**：探针 `ops/ensure-memory.ps1` 增 `-CheckWrite` 参数 → 写前读一次状态，
`write_unlocked=false` 就**不发起写入**、直接提示解锁。

**与 §10.3（pending / flush）的关系**：两者都要，缺一不可——
`get_write_status` 是**预防**（少撞锁），pending/flush 是**兜底**（撞了也不丢）。
只做预防，遇到"解锁期间正好要写"仍会丢内容；只做兜底，每次都要走一遍落盘。

---

## 12. 落地顺序建议
| 批次 | 内容 | 理由 |
|---|---|---|
| **第一批** | §2（write_memory 新入参）+ §3（feedback）+ **§11（get_write_status）** | 投入最小、解锁两把锁死的旋钮、让 Agent 写前就能知道锁状态，直接决定衰减与排序质量 |
| **第二批** | §4（manage_memory，不含 delete）+ §5（list_memories） | 让 Agent 具备"减"的能力，止住库膨胀；delete 暂不开 |
| **第三批** | §6（recall scope=session）+ §7（gc_report） | 补工作记忆出口与可观测性 |
| **第四批** | 按需开 `delete`（配置开关 + 人工确认话术） | 风险最高，最后评估 |

---

> 变更纪律：所有新增工具必须遵守 **§1 设计原则 5 条**；任何绕过内核既有约束（locked 豁免、钳制、作用域、审计）的实现一律不予合入。

---

## 13. 多用户隔离契约条款

> 合并自历史草稿 `draft-contract-multiuser.md`（原拟 §14，已归档至 `archive/`）。所有结论已定（D1–D25，详见 `multiuser-design-status.md`）。

### 13.1 问题
当前 `scope_project_ids` 是静态配置（`mcp.json`），无"按登录用户动态发放受限令牌"的机制。要实现"每人只看到自己私人记忆 + 共享"，必须：
- (a) 约定每用户独立 `project_id`；
- (b) 规定登录时由令牌代理 mint 受限令牌。
本条款把这两点固化为契约。

### 13.2 约定：project_id 命名
- `P-shared`：共享池（保留名）。
- `P-<user_id>`：用户私人池（保留前缀 `P-` + 用户登录标识；保留 `P-u*` 前缀）。
- `P-archive`：归档池（保留名，可选）。
- 业务项目 ID 不得占用上述保留名。

### 13.3 约定：令牌作用域
- 用户 X 的会话令牌必须满足：`scope_project_ids` ⊇ `['P-shared', 'P-<X>']`，且**不得**包含其他用户的私人池 `P-<Y>`（Y≠X）。
- 管理员/审计令牌可含 `P-archive` 与全部池，但不得下发给普通用户。
- 禁止 `['*']` 下发给真实用户会话。

### 13.4 令牌代理（外部组件，规范其接口契约）
令牌代理**不在**记忆 MCP 内实现，但记忆服务与其对接需满足：
- 输入：已认证用户标识 `user_id`、可选 TTL；
- 输出：MCP Bearer 令牌，其 `scope_project_ids` 按 §13.3 计算；
- 需支持 revoke（注销/超时）；
- 管理员令牌带 `is_admin` 声明（见 D20）。

> 记忆服务侧仅需消费令牌并做 `projectInScope` 校验（已有），**无需新增代码**即可支持本隔离模型——前提是代理按约定 mint。

### 13.5 可选新增 MCP 工具：`create_project`（P2，本期不开）
为让代理/管理员自动化建私人池（本期由外部 IAM/管理端在 onboarding 时建，不在 MCP 开放）：
```json
{
  "name": "create_project",
  "description": "创建项目（用于按需开通每用户私人池 P-<user>）。仅管理员令牌可调用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "项目 ID，须符合 §13.2 命名" },
      "kind": { "type": "string", "enum": ["shared","private","archive"], "description": "池类型，决定默认可见性约定" }
    },
    "required": ["project_id","kind"]
  }
}
```
- 内核映射：`storage.createProject({ project_id, kind })`。
- 权限：仅含 `is_admin` 声明或 `'*'` 的管理员令牌可调用。

### 13.6 验收用例（契约级）
1. **私人隔离**：用户 u1 令牌（`['P-shared','P-u1']`）recall `P-u2` → 报错"作用域不含项目 P-u2"；recall `P-u1` 与 `P-shared` 成功。
2. **共享可达**：u1、u2 都能 recall `P-shared` 同一批记忆。
3. **命名约束**：`create_project` 用保留名 `P-shared` 新建 → 拒绝或幂等复用，不覆盖既有共享池。
4. **反模式拦截**：任何用户令牌不得含他人私人池；静态 `['*']` 不得下发给用户会话（部署检查项）。
5. **生命周期**：撤销 uX 令牌 + 将 `P-uX` 迁移至 `P-archive` 后，无任何用户令牌能 recall `P-uX`。
6. **一次性召回**：`recall_memory(scope='user+shared')` 一次返回 `P-shared`+`P-uX` 合并（见 §6 扩展）。

### 13.7 内核落点
| 位置 | 改动 |
|---|---|
| `mcpAuth.ts` | `projectInScope` 维持；对保留名 `P-shared`/`P-archive` 的语义约定文档化（无逻辑改动） |
| `storage` | 新增 `createProject`（仅 §13.5 启用时） |
| 令牌代理 | **外部实现**，记忆服务不改动 |

### 13.8 不变式与 L1 分流实施（已定：混合 + 默认 P-shared）
- **不变式**：`P-shared` 仅接收脱敏后的 L1；分流步骤只消费 L1 产物，绝不消费 L0。管线须保证"脱敏先于分流"。
- **L1 分流（混合路径）**：
  - 显式意图 `for='team'` / `for='me'` → 直接定 `project_id`；
  - 无意图 → 管线按 `category` + 残留个人标记自动定 `project_id`；
  - 低置信 → Agent 向用户确认。
  - 决策树与兜底方向见 SOP §15.6.2（兜底已定 = `P-shared`）。
- **内核落点补充**：精炼管线新增 `routeL1()` 阶段，在脱敏之后、持久化之前为 L1 记录打 `project_id`；该阶段消费 L1 产物，天然满足不变式。

### 13.9 决策记录（已定结论 D1–D25 节选）
- 三池 + 登录令牌代理（D3、D4）；L0 保密归档不进池、L1 分流（D5、D6、D7、D8、D9）。
- 脱敏闸门：服务端可信内核、fail-safe、B+定向人工复核、两者并用策略、规则同步+模型异步（D10、D14、D15、D16）。
- 管线集中跑于可信内核（D17）；私人池 `P-<user_id>`（D18）；令牌代理外部 IAM + `is_admin` 声明（D19、D20）。
- 召回 `scope='user+shared'`、按人不按设备、`create_project` 本期不开（D21、D22、D23）。
- 全局搜索与导出/导入均需要（D24、D25）。
- 完整 25 条见 SOP §15.9 与 `multiuser-design-status.md`。

---

## 14. 工具清单（读 / 写 / 管理）

> 合并自历史草稿 `draft-tool-inventory.md`（已归档至 `archive/`）。目标工具集：读 7 / 写 2 / 管理 3 = 12 个 MCP 工具 + 内部管线 + 外部令牌代理。

### 14.1 读（Read）
| 工具 | 作用 | 状态 | 备注 |
|---|---|---|---|
| `recall_memory` | 语义召回（单 `project_id` 内） | 现有 | 主入口；`scope='user+shared'` 见 §6/§13 |
| `recall_memory(scope='session')` | 工作记忆（按 `session_id`+时间窗） | 草案§6 | 不走向量检索 |
| `get_user_preferences` | 取用户偏好（按 `user_id`） | 现有 | 跨租户拒 |
| `list_projects` | 列令牌作用域内的项目 | 现有 | `projectInScope` 校验 |
| `list_memories` | 按 `category`/`decay_class`/时间 过滤+分页 | 草案§5 | 浏览/审计 |
| `get_write_status` | 读 L0 写密钥解锁态（只读） | 草案§11 | 写前探锁 |
| `decrypt_l0` | 解密单条 L0 原始归档 | 现有内核/IPC | 特权：仅持 L0 会话/管理封装 |

### 14.2 写（Write）
| 工具 | 作用 | 状态 | 备注 |
|---|---|---|---|
| `write_memory` | 写入 → 落 **L0 全量归档** | 现有+§2 | 新增 `importance`/`confidence`/`half_life_days`/`tags`；绝不直写池 |
| `feedback` | 对记忆 `confirm`/`reject`/`disputed` | 草案§3 | 反哺精炼与置信 |

### 14.3 管理（Manage）
| 工具 | 作用 | 状态 | 备注 |
|---|---|---|---|
| `manage_memory` | 更新/合并/移动/锁定/钉住/归档/（删除） | 草案§4 | 含跨池搬移（脱敏后 `P-<user>`↔`P-shared`）；`delete` 需配置开关+人工确认 |
| `gc_report` | 触发/查看遗忘引擎报告 | 草案§7 | 遗忘周期、合并、摘要 |
| `create_project` | 开通每用户私人池 `P-<user>` | 草案§13.5（本期不开） | 仅管理员令牌；本期由外部/管理端建 |

### 14.4 内部管线 / 外部组件（非 MCP 工具，系统必备）
| 能力 | 归属 | 作用 | 关键约束 |
|---|---|---|---|
| **采集器 Collector** | 内部 | 扫会话日志 → L0（全量） | 后台周期（5min） |
| **脱敏闸门 Desensitization Gate** | 内部·服务端强制 | L0→L1 清洗+脱敏 | 可信内核、fail-safe；强度=B+定向人工复核（D14），策略=两者并用（D15），时机=规则同步+模型异步（D16） |
| **routeL1** | 内部 | 脱敏后 L1 打 `project_id` | 消费 L1 产物，满足不变式（§13.8） |
| **精炼管线** | 内部 | L1→L6 逐层 | `layer` 自动产生 |
| **令牌代理 Token Broker** | 外部 | 登录 mint `['P-shared','P-uX']`、revoke | 外部 IAM（D19）；`is_admin` 声明（D20） |

### 14.5 不变式
- 写永远落 L0；共享内容只能由脱敏后的 L1 经 `routeL1` 晋升。
- 读按令牌作用域（`projectInScope`），越界即拒。
- 共享 = 已脱敏（管线脱敏先于分流，见 §13.8）。
