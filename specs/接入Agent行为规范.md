# 接入 Agent 行为规范

> 适用范围：任何通过 MCP（TCP `127.0.0.1:8202` / HTTP `127.0.0.1:8204`，服务名 `multiagent_memory`）接入本记忆库的 Agent 客户端。
> 定位：本文件是 `mcpSchema.ts` 中 `MCP_INSTRUCTIONS` 的结构化展开，也是 `AGENTS.md` §1 MCP 章节的落地细则。**客户端可能不注入 `initialize.instructions`（Qoder 实测未注入）→ 本文件是其触发规则的兜底，新会话生效。**
> 是否真的检索过，以数据根 `audit.jsonl` 的 `recall` 审计为准，不以 Agent 自述为准。

---

## 1. 总原则

1. **优先用本库**：涉及本项目实现 / 架构 / 历史决策 / 踩坑 / 偏好 / 事实类问题，先 `recall_memory` 再回答。
2. **诚实不伪造**：记忆、省量、金额、审计回执全部来自真实账本，不得改写、编造或假装检索过。
3. **租户闭包**：Agent 只能以会话身份读写，禁止冒用其它 `user_id`、越界读写其它池。
4. **作用域校验**：所有读 / 管操作统一 `projectInScope`；令牌作用域不含的项目一律拒绝。
5. **写只落 L0**：`write_memory` 只产生加密原始归档，绝不直写 `P-shared` / `P-<user>`；共享内容只能由脱敏后的 L1 经 `routeL1` 晋升。

---

## 2. 召回触发规范（读纪律）

**触发条件（默认优先）**：用户消息只要涉及——
- 本仓库 / 本项目的实现、架构、历史决策、踩过的坑、用户偏好、事实；
- 或关键词「记得 / 上次 / 之前 / 老规矩 / 继续上次」；

→ 优先调用 `recall_memory` 再回答。

**回退顺序（仅当本库未命中或工具不可用时）**：读代码 → 工作区笔记 → 客户端自带 memory 文件。**客户端自带的 memory / 笔记不是本记忆库，不能替代首选检索；形成新结论时用 `write_memory` 落库。**

**project_id 规则**：
- 可省略：账本只有一个项目时自动定位；
- 多项目时先调用 `list_projects` 并向用户确认，再带 `project_id` 召回。

---

## 3. 回显规范（强制）

每次 `recall_memory` 成功返回后，**必须把该次返回的 `display.markdown` 整段原样输出到最终回答末尾**。服务端按客户端能力选档。

> **互通约束**：全档位参数（档位名 / 触发阈值 / 客户端能力判定键 / 四段明细字段 / `detail_url` 形态 / 折叠展开文案）必须与 APP 桌面端 `src/core/memagent/mcpRecall.ts`（`recallDisplayMode` / `clientSupportsHtmlDetails`）及 `recallInsight.ts`（`buildRecallCompactMarkdown` / `buildRecallDetailPage`）对齐，取自同一真源，避免「Agent 回显与 APP 渲染口径分裂」。

### 3.1 两档（取消 markdown-full / 单行 兜底）
| 档位 | 判据 | 客户端收到内容 |
|---|---|---|
| **折叠气泡（首选 compact 档）** | 客户端支持气泡折叠（或服务端判定可折叠） | 两行 🧠 Memory 摘要 + **可展开折叠气泡**——气泡内联展开显示四段明细（项目背景 / 命中记忆 / Token 用量 / 省钱与费用），点击收起 |
| **HTML `<details>`（兜底 fallback）** | 客户端不支持气泡折叠（如 `client.split('/')[0]` 命中白名单 `{qoder, qoder-desktop-mcp-host}` 或 fail-safe） | `<details>` 四段（summary = 🧠 Memory 提示行，内层四段：项目背景 / 命中记忆 / Token / 省钱与费用，可点开收起）|

> 不再保留 markdown-full / 单行兜底。无法渲染气泡与 HTML 的极端客户端，由 APP 侧 fail-safe 处理（占位/提示，不编造明细），其形态由 APP 内参数定义。
> **〔批次41-Q 校正〕** 白名单含 `qoder-desktop-mcp-host` 是因 Qoder Desktop 自报 UA 为 `qoder-desktop-mcp-host/1.0.0`（首段非 `qoder`）。但「Qoder 聊天气泡是否真渲染 `<details>`」**尚无实测证据**——若实机像 DSH 那样把标签原样吐成文本，按 fail-safe 把该项撤下（改回只留 `qoder`），并在手测报告记录。
> **互通**：折叠气泡与 HTML `<details>` 的四段明细内容、字段、文案、`detail_url` 形态必须同源；新增/修改任一档位参数须同步 `mcpRecall.ts`/`recallInsight.ts` 与服务端下发逻辑。

**回显硬约束（任何档位）**：
- 禁止自行补写或预先展开明细（明细只能来自本次或下一次工具返回）；
- 禁止自行构造折叠结构（气泡 / `<details>` 由服务端返回，Agent 不自行拼装 HTML）；
- token 数字与金额必须原样保留，不得改写；
- 需要明细时，用**同一个 query** 再调用一次并置 `detail=true`，然后原样输出那次返回的 `display.markdown`；**不要因为「这样更完整」就自动调 `detail=true`**（那等于把明细铺回聊天窗口，违背本档目的）；
- 明细页 URL（HTTP 档）**必须逐字保留**，不得截断或改写。

---

## 4. 金额规范

- `display.money` 为 `null` 表示用户尚未设置单价（全局参数页），**不得猜测或补全金额**。
- 返回的金额数字原样保留，不四舍五入、不换算。

---

## 5. 沉淀规范（写纪律）

**何时 `write_memory`**：会话中形成新的决策、踩坑、事实、偏好或洞察时，调用落库。

**写入约束**：
- `category` 选最贴近的一类：`fact` / `decision` / `pitfall` / `insight` / `preference` / `context`；
- `content` 要具体、可复用（原始会话片段），不要写已精炼过的总结；
- 写入前如不确定项目，先 `list_projects`；
- **只落 L0**：绝不直写 `P-shared` / `P-<user>`；精炼 / 脱敏 / 分流由内部管线完成；
- `user_id` 必须与会话租户一致（跨租户写入被拒）。

---

## 6. 反馈规范

对召回命中的记忆，用户确认 / 否定 / 争议时调用 `feedback`：
- `confirm`：置信度 +0.1；
- `reject`：置信度 −0.05；
- `disputed`：挂裁决，不直接降权。

反馈反哺精炼与置信度，**不**修改 L0 原文。

---

## 7. 租户与作用域纪律

- **令牌作用域**：`write_memory` / `recall_memory` / `manage_memory` 统一 `projectInScope`；`'*'` 全放行，否则只能操作显式列出的项目；越界即返回 `-32602`。
- **租户闭包**：`write_memory.user_id`、`get_preferences.user_id` 必须与会话身份一致，禁止跨租户读写。
- **多租户池**：私人池 `P-<user>` 与共享池 `P-shared` 隔离；Agent 只能见令牌授权范围内的池。

### 7.1 身份契约与 `source_agent` 命名表

每条记忆必带 `user_id` / `source_agent` / `project_id` / `category` / `session_id`。`source_agent` 是溯源主键，**禁止依赖 MCP 默认 `'mcp'`**（多 Agent 下默认值使溯源失效）。命名表**定下不改，否则溯源断链**：

| Agent | `source_agent` |
|---|---|
| WorkBuddy / 本助手 | `workbuddy` |
| Claude Desktop | `claude-desktop` |
| Cursor | `cursor` |
| Gemini CLI | `gemini-cli` |
| Codex | `codex` |
| 其他 | 小写、连字符、无空格中文（如 `qoder`、`vscode` 等）|

> 多用户下 `user_id` 必须与会话租户一致（见 `多用户三池隔离设计_D1-D25.md` D2：`user_id` 在读取时**不**隔离，私人隔离靠独立 `project_id`）。单用户实测期可统一 `u1`，但落库纪律仍以「与会话租户一致」为准。

---

## 8. 边界与诚实纪律

- **不泄露令牌**：不向用户展示 MCP 认证令牌（`Authorization` 头 / `mcp-token.txt` 内容）。
- **不伪造**：不伪造记忆内容、省量或审计回执。
- **工具不可达 / 未命中**：如实说明并继续回答，不得假装检索过记忆。
  - 桌面端未运行则 8204 不可达 → 如实说明，不编造记忆、不假装检索过。
  - 本库未命中 → 按 §2 回退顺序处理，并明示「客户端自带 memory 不是本记忆库」。

---

## 9. 跨客户端一致性

- 同一份提示 / 折叠明细对**所有**客户端生效（服务端返回），差异只在客户端注册与触发规则。
- 客户端接入配置页（AgentOnboard）真实读取 `~/.qoder-cn/settings.json`、`~/.claude.json`、`~/.cursor/mcp.json` 等判定接入状态；含令牌片段与一键写入仅管理员，写入前备份原文件。
- 白名单机制（`qoder` / `qoder-desktop-mcp-host`）决定 `html-details` 档是否生效，其余客户端一律走 `markdown-compact` 默认档。

---

## 10. 自检清单（Do / Don't）

**Do**
- ✅ 项目相关问题上来先 `recall_memory`，末尾原样回显 `display.markdown`；
- ✅ 多项目先 `list_projects` 确认 `project_id`；
- ✅ 形成新决策 / 踩坑 / 偏好时 `write_memory`；
- ✅ 工具不可用时如实说明并回退读代码 / 笔记。

**Don't**
- ❌ 不伪造记忆、省量、金额、审计回执；
- ❌ 不自行补写 / 展开明细、不添加 HTML 标签、不改写数字；
- ❌ 不泄露 MCP 令牌；
- ❌ 不越界读写其它池、不跨租户冒用 `user_id`；
- ❌ 不用 `write_memory` 直写 `P-shared` / `P-<user>`（只落 L0）；
- ❌ 不因「更完整」自动置 `detail=true` 把明细铺回聊天窗口。

---

## 11. L0 写密钥门禁与落盘兜底（批次43 对齐自 SOP §10.2）

> 进程活着 ≠ 能写。所有写入都要先经 L0 封装加密（`l0:seal`），写密钥（DEK）由主进程持有；未解锁时报 `E_L0_LOCKED`，**无任何 HTTP / MCP 旁路**（有意的安全设计）。recall 不受影响（读走解密/查阅会话）。

### 11.1 写入被拒的两种错误（先分清，再动作）
写入路径检查顺序固定：`content → 质量门(L0→L1) → 五维查重/嫁接 → L0 封装(写密钥) → 落盘`。

| 返回 | 含义 | 与锁有关？ | 下一步 |
|---|---|---|---|
| `dedup.filtered` + `spec_violations: 短料拒收 / 裸链接` | 没过质量门（有效字 <30 且无硬事实；或裸链接） | ❌ 无关 | **改写内容**（补硬事实与技术细节）后重写 |
| `[E_L0_LOCKED] L0 写密钥未解锁` | 过了质量门，但 L0 封装时写密钥未解锁 | ✅ 有关 | **去解锁写密钥**，内容不要改 |

> 推论：只有过了质量门的内容才走到 L0 封装 → 短内容探针探测不到锁状态；看到 `E_L0_LOCKED` 就证明内容本身合规，**不要改写内容去绕过，要去解锁**。

### 11.2 写密钥何时失效（无 TTL、无空闲超时，仅以下路径清空 `writeDek`）
| 触发 | 说明 |
|---|---|
| 锁屏 | `powerMonitor` `lock-screen` → 清 writeDek + viewDek + 作废 active grants |
| 休眠 | `suspend` → 同上 |
| 退出 | `before-quit` → `onExit()` 清空内存密钥 |
| 重启 | `onAppRestart()` → 作废授权 + 删除 wrapped DEK |
| 手动锁定 | 安全页「锁定写密钥」 |

> 写密钥有效期 = 从解锁到下一次锁屏/休眠/退出的时间，可能只有几分钟。**不能假设「解锁过就一直能写」**；`pending` 落盘不是可选项，是刚需。

### 11.3 落盘兜底工作流（逐条，非批量）
Agent 标准写入动作改为四步，粒度是「一条记忆」：
1. **先落盘**：把待写内容存为 pending（如 `ops/pending-write` + `flush-pending` 机制）生成 pending 记录；
2. **再写**：用**同样**的 `content` / `project_id` / `category` / `user_id` / `source_agent` / `session_id` 调 `write_memory`；
3. **成功后**：删掉对应 pending；
4. **被拒后**：pending **保留**（不删），如实告知「请在安全页解锁写密钥」；解锁后统一重放，**不手工重打一遍**（避免重复条目）。

> 为什么逐条落盘：锁屏/休眠会在任意时刻清掉写密钥，批量写到一半被锁屏打断会丢失后半。逐条落盘最多丢当前这一条，且能精确重放。覆盖 `E_L0_LOCKED` / 锁屏 / 休眠 / 应用重启 / 进程崩溃 / 会话中断 / 网络中断 七种失败，且**不依赖任何内核改动**。

### 11.4 写前探锁（预防）
`GET /health` 类探针与只读工具 **`get_write_status`**（草案，内核零改动，复用 `L0Vault.status()`）可在写前读一次锁状态，`write_unlocked=false` 就**不发起写入**、直接提示解锁。与 §11.3 兜底**两者都要**：探锁是「少撞锁」，pending 是「撞了也不丢」。

### 11.5 Agent 侧铁律
1. 写入前**先落盘**，永远不要「直接写、失败了再说」；
2. `short_low_signal` / `filtered` → 改内容；`E_L0_LOCKED` → 去解锁，**不改内容**；
3. 被拒时**如实告知 + 保留 pending + 给出解锁指引**；绝不谎称已写、绝不丢弃内容、**绝不反复重试**（重试无用，锁不会自己解开）；
4. 解锁后由重放机制统一重放，**不手工重打一遍**。
