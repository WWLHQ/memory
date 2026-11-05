# 多 Agent 记忆读写 SOP（标准作业程序）

<!-- sop-version: v1.9 -->

> 适用系统：memagent-mcp（MultiAgent Memory）v1.0.0｜项目：P1｜协议：MCP 2025-06-18
> 适用范围：所有接入本记忆库的 Agent（WorkBuddy / Claude Desktop / Cursor / 其他）
> 版本：v1.6（v1.2 隔离模型 + L0 门禁｜v1.3 认知分类映射｜v1.4 语义模板 + 可观测闭环 + 运维接口需求｜v1.5 采集器机制与写入策略｜**v1.6 写入前锁状态预检：两种拒绝的判别、先落盘再写的保全流程**）｜**v1.9 反向补：回显两档(折叠气泡/HTML 兜底)、5 召回模式、运维架构四方向（批次43 对齐本项目 specs）**

---

## 1. 目的
规范多 Agent 如何向共享记忆库**写入与读取**，确保：
- (a) 项目知识在 Agent 间**共享**；
- (b) 私人记忆**严格隔离、不外泄**；
- (c) 写入井井有条、可读、可溯源。

## 2. 系统概览
- 服务：memagent-mcp v1.0.0，HTTP 暴露（`http://127.0.0.1:8204/mcp`），Bearer Token 鉴权。
- 工具（仅 4 个，实测自 `tools/list`）：`recall_memory` / `write_memory` / `list_projects` / `get_user_preferences`。
- 当前项目：P1（单项目，1500+ 条记忆）。
- 安全：L0 AES-256-GCM 加密 → L1–L6 精炼；**写入必须先在桌面端解锁 L0 写密钥**（见 §10.2）。
- 会话租户：`user_id=u1`，`team_id=t1`，`enterprise_id=e1`，令牌项目作用域 `scope_project_ids=['*']`。

## 3. 核心概念：三个正交维度
| 维度 | 取值 | 含义 |
|---|---|---|
| **令牌项目作用域（谁能看）** | `scope_project_ids`：`'*'`（本机单用户默认，全账本）/ 显式项目列表 | 唯一真实的租户闸门（§4） |
| **type（是什么）** | `fact` / `decision` / `pitfall` / `insight` / `preference` / `context` | 知识分类 |
| **state（状态）** | `hot`/`warm`/`cold`、`pinned`/`locked`、层 `L1–L6` | 生命周期 / 权重 |

> ⚠️ **v1.0 记忆没有 `scope` 字段**（实测 `write_memory` 入参不含 scope，源码 `mcpAuth.ts` / `mcpRecall.ts` 亦无此概念）。
> 可见性完全由「令牌 `scope_project_ids`」+「写入时选的 `project_id`」决定。临时/归档用 state 表达，不要自造 scope。

### 3.1 认知记忆分类 ↔ 现有字段（不要新增"记忆类型"字段）
系统的 `需求规格书` 早期即采用认知分类（程序记忆 → 工作记忆 → 语义记忆 → 情景记忆），代码层则落成
`layer` + `decay_class` + `category` 三正交实现。**认知分类是这两条轴的组合函数，不是独立属性**：

| 认知分类 | 落在哪个字段 | 判定口径 |
|---|---|---|
| 工作记忆 | `decay_class=hot` | 近期活跃、始终加载；本质是会话活跃上下文 |
| 情景记忆 | `layer=L2` | 会话摘要，携带时间戳 / 来源 / session_id |
| 语义记忆 | `layer=L3/L4/L5` | 得失 → 模式 → 洞察，已去情境化、跨事件可复用 |
| 长时记忆 | `decay_class=cold` + `merged_into` | 老旧情景合并出的"长期概览" |
| 程序记忆 | 项目共享的固定规范条目 | 如本 SOP；各 Agent 加载即生效 |

> **为什么不再加一个 `memory_type` 字段**：
> ① 已有三条正交轴，再加第四条会造成"同一维度两种说法"，写入端不知该填 `layer` 还是 `memory_type`；
> ② 叠加式定义会产生冗余——一条记忆既是语义记忆又是长时记忆时该写几个值；
> ③ 「工作记忆」本质是**临时工作区**，不该进长期库；跨会话保留"最近几轮"用 `hot` + `session_id` 表达即可。
>
> **关键分工**：`layer` 由系统自动逐层精炼产生，**Agent 一律不手填**；Agent 只决定
> `content`（写法）、`category`（是什么）、`project_id`（给谁看）、`session_id`（哪次会话）。

## 4. 隔离模型（v1.0 真实实现：令牌作用域 + 项目级共享）
- **记忆本身无 scope 字段**。`write_memory` 实测入参：`content`、`project_id`（必填）+ `category`、`user_id`、`session_id`、`source_agent`（可选）。
- **唯一闸门 = MCP 令牌的 `scope_project_ids`**：`'*'` 全放行；否则只能命中显式列出的项目。
  `recall_memory` / `write_memory` / `list_projects` 三者**统一口径**校验，越界报错：
  「当前 MCP 令牌作用域不含项目 X（scope 校验，批次26-B P1-10）」。
- **共享的天然单位是 `project_id`**：recall 只在单个项目内检索 → 同一项目内的所有 Agent 天然共享；
  跨项目共享靠把该项目列进令牌作用域。
- **私密内容的正确做法**：不要指望记忆自带私密标记，而是**写进个人专属项目**（如 `P-personal`），
  并给个人 / 受限 Agent 单独签发**只含该项目**的令牌 → 别人的令牌读不到，项目本身也不共享。
- **用户租户校验**：`get_user_preferences` 的 `user_id` 必须与会话租户一致，否则报「禁止跨租户读取」；
  本机实测 `u1` 通过、`u2`/`u9` 被拒 → **统一用 `u1`**。
- **写入分流优先级（首命中即生效）**：
  1. 含密钥 / PII / 私钥 / 身份证 → 写**个人专属项目**，绝不写共享项目；
  2. 明确要团队共享 → 共享项目（如 `P1`）；
  3. 个人偏好 / 笔记 / 不共享给团队 → 个人专属项目；
  4. 都没命中 → 默认共享项目。

## 5. 身份契约（每条记忆必带）
| 字段 | 取值 | 来源 |
|---|---|---|
| `user_id` | 全员统一 `u1` | 会话租户（与 MCP Token 绑定） |
| `source_agent` | `workbuddy` / `claude-desktop` / `cursor` / … | 见 §6 命名表 |
| `project_id` | `P1`（多项目先 `list_projects`） | 运行时；**决定共享范围**（§4） |
| `category` | 6 类目之一 | §7 |
| `session_id` | 本次会话 | 运行时（建议填，溯源用） |

> `user_id` 必须与 MCP Token 的**会话租户**一致，否则 `get_user_preferences` / 用户作用域读取会被拒（"禁止跨租户读取"）。
> 查看位置：记忆库数据文件 `memories.db.json` 的 `user_id` 字段；或桌面客户端「设置 / 账户」页。

## 6. source_agent 命名表（定下不改，否则溯源断链）
| Agent | source_agent |
|---|---|
| WorkBuddy | `workbuddy` |
| Claude Desktop | `claude-desktop` |
| Cursor | `cursor` |
| 其他 | `gemini-cli` / `codex` 等（小写、连字符、无空格中文） |

**全局约定**：所有 Agent 用同一 `user_id`（`u1`），跨 Agent 的事实 / 偏好才能对齐。

## 7. 分类约定（6 类目）
| 类目 | 用途 | 写法要点 |
|---|---|---|
| `fact` | 客观事实 | 技术栈 / 架构 / 接口契约 / 状态；一句话 + 证据 |
| `decision` | 关键决策 | 决策编号（D12）+「为何选 A 不选 B」 |
| `pitfall` | 踩坑 | 必须「现象 → 原因 → 规避」三段 |
| `insight` | 洞察 | 可复用的规律 / 方法论 |
| `preference` | 偏好 | 用户 / 团队持久偏好；同步也进 `get_user_preferences` |
| `context` | 背景 | 目标 / 范围 / 边界 / 规范条文；低频更新 |

### 7.1 情景写法 vs 语义写法（决定能被炼到第几层）
| | 情景写法（易停在 L2） | 语义写法（可升 L4/L5） |
|---|---|---|
| 时间 | 写明「何时 / 哪次会话」 | 去掉时间，去情境化 |
| 主体 | 「本次调试中…」「今天发现…」 | 「该系统采用…」「写入前应…」 |
| 结论 | 这次发生了什么 | 一条可复用的规则 |
| 示例 | 「2026-11-03 调试发现 8204 未启动导致 write 报 10061」 | 「记忆服务未运行时写入报 upstream connect failed(10061)，写入前应先做健康探针」 |

> **精炼机制（源码 §2.1/§2.2 实测）**：逐层生成、逐层查重，**命中即嫁接并停止**（L1 阈值 0.70 / L2 0.75 / L3 0.80 / L4 0.85）。
> 若内容与库中已有记忆高度相似，就停在 L1（清洗脱敏层），**永远不会精炼到 L2–L6**。
> 实测本次写 SOP 时三段分别以 sim ≈ 0.72 / 0.71 / 0.88 命中已有同主题记忆 → 全部嫁接停在 L1。
> **推论**：要产出高层语义记忆（模式 / 洞察），内容必须与已有记忆**有足够差异**，而不是把同一件事换个说法再写一遍。
> 同时也说明嫁接机制是**去重而非丢失**——新内容会并入已有记忆，不会制造重复条目。

### 7.2 各 category 的语义化模板（Agent 直接套用）
内核炼化能力很强，但**输入是原文，原文的写法决定产出在哪一层**。同一 category 内两种写法结果完全不同：

| category | ❌ 情景写法（停在 L2） | ✅ 语义写法（可升 L4/L5） |
|---|---|---|
| `fact` | 「今天发现 8204 没启动会报 10061」 | 「记忆服务未运行时写入报 upstream connect failed(10061)，写入前应先做健康探针」 |
| `decision` | 「这次我们选了方案 B」 | 「决定采用方案 B，因为 A 无法处理 X；不选 A 的原因是 Y；适用边界：单机场景」 |
| `pitfall` | 「踩了个坑」 | 「现象：X｜原因：Y｜规避：Z」（规格书**强制**三段式） |
| `insight` | 「这个规律挺有意思」 | 「在同类任务中，当 A 与 B 同时出现时必然失败——因为二者争同一资源」 |
| `preference` | 「以后按这个来」 | 「偏好：评审场景用方案 A，赶进度场景用方案 B；例外：线上故障一律用 A」 |
| `context` | 「当前需求是 X」 | ⚠️ **不要用 context 承载长期知识**——其半衰期仅 2 天、自动归档 14 天 |

> **料量也是约束**（`depthCapFor`）：源文 ≥240 字→可到 L5；≥120→L4；≥60→L3；≥30→L2；**<30 字 → 停在 L1**。
> 且 L1 是准入层：有效字 <30 且既无硬事实又无技术证据 → 质量门 v3 直接拒（记码 `short_low_signal`）。
> **「写得短」不是省事，是会被拒或停在最浅层。**

### 7.3 写入后的可观测闭环（Agent 自纠偏）
`write_memory` 返回里的 `dedup.action` / `dedup.sim` / `dedup.graft_layer` 是 Agent 唯一的反馈信号：

| 返回 | 含义 | Agent 该做什么 |
|---|---|---|
| `action='filtered'` | 被质量门拦（噪声 / 短料 / 裸链接） | **改写后再写**，不要重试原文 |
| `action='grafted'`, `graft_layer='L1'` | 与已有记忆高度相似，**停在最浅层** | 若本意是高层语义 → **换措辞增加差异后重写**；若本意就是补充细节 → 正常，已并入 |
| `action='grafted'`, `graft_layer` ≥ L2 | 已并入更深层 | 正常，无需动作 |
| 无 `dedup` | 全新记忆 | 正常 |

> 判据：**若 `graft_layer=L1` 而你本意是"可复用的规律/规范"（而非补充细节），说明这段和库里已有的太像，
> 重写时把"何时发生的"换成"应该怎么做"，让语义层有机会长出来。**

## 8. 写入规范
### 8.1 触发逻辑（何时写）
- **① 指令自检**：对话中识别出新决策 / 踩坑 / 事实 / 偏好 / 洞察 → 写。
- **② 用户显式**：「记住这个」「存一下」→ 写（确定性最强）。
- **③ 生命周期钩子**：会话结束由 hook 总结沉淀 → 写（兜底，最稳）。
- **判定门槛**：耐久 · 可复用 · 非冗余 · 敏感必隔离。否则**不写**。

### 8.2 写入流程（七步）
1. **检测**：本轮是否形成新耐久知识？
2. **判定**：值得存？（耐久 / 复用 / 非冗余）否 → 不写。
3. **查重**：先 `recall_memory` 看是否已存在相似记忆，避免重复。
4. **分类 + 定项目**：定 `category`（§7）+ 选 `project_id`（共享项目 or 个人专属项目，§4）。
5. **调用**：`write_memory(content, project_id, category, user_id, source_agent, session_id)`
   （**无 scope 参数**；私密性靠选对 `project_id`，不是靠记忆字段）。
6. **校验**：返回错误（缺字段 / 越权 / `E_L0_LOCKED`）→ 如实告知，不伪造。
7. **门禁兜底**：若返回 `[E_L0_LOCKED] L0 写密钥未解锁` → **内容绝不能丢**：挂起待解锁，解锁后**原样重放**（见 §10.2）。

### 8.3 守则
- **节流**：不每轮写，仅确有新耐久知识时写（防膨胀 / 噪声）。
- **原子**：一条一主题、带关键词（利于召回）。
- **纠错**：写新条目标注「替代 `mem_xxx`」，不删旧。
- **保密**：共享项目绝不写密钥 / PII；敏感内容一律个人专属项目。

## 9. 读取（Recall）规范
### 9.1 触发逻辑
用户消息涉及本项目实现 / 架构 / 历史 / 决策 / 踩坑 / 偏好 / 事实，或含「记得 / 上次 / 之前 / 老规矩 / 继续上次」→ **先 recall 再答**；未命中才回退读代码 / 本地笔记（本地笔记 ≠ 本记忆库）。

### 9.2 处理管线
触发 → 解析项目（`single→P1`）→ **令牌作用域校验**（不含该项目则直接报错）→ 语义扫描（全量向量检索，**限本项目内**）→ 排序召回（`top_k` 按 `score`）→ 组装（`hits` + 项目背景）→ 模式 / 场景调节 → 预算裁剪（≤ `hard 3000t`）→ 呈现 + 回显。

### 9.3 模式选用（批次43 反向补自本项目 `recallModes.ts` / `需求规格书_内核API契约.md` §2.1）
- **`auto` / `null`（自动，默认）**：Agent 按 scene×关键词自动分配；`critical` 场景禁 `minimal`；中英混排查询不触发极简（走 scene 默认）。
- **`top_insight`（顶层洞察优先）**：优先返回可复用的顶层结论 / 洞察；权重 (f0.20, i0.40, c0.10, a0.30)。
- **`fact_first`（事实优先）**：事实优先 + 带背景，适合要靠谱答案；权重 (f0.10, i0.20, c0.40, a0.30)。
- **`event_replay`（事件复盘）**：按时间线 / 事件回放，适合「上次发生了什么」；权重 (f0.40, i0.15, c0.15, a0.30)。
- **`pattern_reasoning`（模式推理）**：优先模式 / 规律类记忆；权重 (f0.15, i0.25, c0.10, a0.40)（注：权重和 0.90 ≠ 1.0，为规格书 §2.4.3 缺陷，待修订）。
- **`minimal`（极简轻量）**：不带背景，省 token（实测 injected 仅 98t，省 73%），适合高频 / 低延迟；中文 <30 字 / 英文 <12 词触发，但 `critical` 与中英混排不触发。
- **scene**：`default`｜`critical` 禁 `minimal`（关键问答不出错）｜`task_start` 开头拉背景。

### 9.4 呈现与回显（批次43 反向补：两档 + 互通）
- **首选（折叠气泡）**：两行 🧠 Memory 摘要 + 可展开折叠气泡——气泡内联展开显示四段明细（项目背景 / 命中记忆 / Token 用量 / 省钱与费用），点击收起。
- **兜底（HTML `<details>`）**：客户端不支持气泡折叠时，回退 `<details>` 四段（summary = 🧠 Memory 提示行，内层四段：项目背景 / 命中记忆 / Token / 省钱与费用，可点开收起）。
- `detail=true`：需要时（如气泡/HTML 均不可用）用同 query 再调一次并置 `detail=true`，得纯 Markdown 四小节。
- **铁律**：原样回显 `display.markdown`；URL / 数字 / 金额不得改写；不自行展开明细（仅用户明确要看时，用同 query 再调一次并置 `detail=true`）。
- **互通约束**：档位参数（档位名 / 阈值 / 能力判定键 / 四段字段 / `detail_url` 形态 / 折叠展开文案）必须与 APP 桌面端 `mcpRecall.ts`（`recallDisplayMode` / `clientSupportsHtmlDetails`）及 `recallInsight.ts` 对齐，取自同一真源，避免「Agent 回显与 APP 渲染口径分裂」。
> 注：本项目（批次43）已取消 markdown-full / 单行 作为最弱兜底；无法渲染气泡与 HTML 的极端客户端由 APP 侧 fail-safe 处理（占位/提示，不编造明细）。

### 9.5 记账
每次返回 `savings`（省了多少 token / ¥），用于成本治理；不要伪造数字。

## 10. 生命周期与稳定性（含静默启动韧性）
### 10.1 服务可用性（进程层）
- **会话结束钩子**：总结器提取新决策 / 坑 / 洞察 → 走 §8.2 写入（兜底防丢，不依赖 LLM 中途自觉写）。
- **后端常驻**：代理在 8204，后端进程须运行，否则 recall / write 报 `upstream connect failed (10061)`。
- **静默启动（核心韧性，应对"该写没写 / 该读没读"）**：
  把"服务是否在线"下沉为**幂等可重试的本地脚本**，而非依赖 Agent 自觉。两层保障：
  1. **读写前探针 `ops/ensure-memory.ps1`**：每次 recall / write **之前**由 Agent 先调用它。
     - 在线 → 返回 `online:true` 直接继续；
     - 掉线 → **静默拉起** `MultiAgent Memory.exe`（`-WindowStyle Hidden`，无窗口），轮询等待就绪后返回 `online:true`；
     - 仍失败 → 返回 `online:false`，Agent 走"如实说明、不伪造"分支。
     - 调用：`powershell -NoProfile -ExecutionPolicy Bypass -File "…/ops/ensure-memory.ps1"`
     - 安全自检：`…ensure-memory.ps1 -DryRun -Url http://127.0.0.1:9999/mcp` 只报告"会做什么"、**不真正启动**进程。
  2. **常驻看门狗 `ops/watchdog.ps1`**：开机 / 登录即启动，每 30s 探一次，掉线自动拉起。
     - 安装：`…watchdog.ps1 -Install` → 注册 `MultiAgentMemoryWatchdog` 计划任务（登录 + 开机触发）；
     - 单次：`…watchdog.ps1 -Once`；卸载：`…watchdog.ps1 -Uninstall`。
  > 验证（2026-11-03）：在线探针实测 `{"action":"already_up","online":true,"pid":2132}`；DryRun 掉线实测 `{"action":"would_launch"}` 且未误启进程。exe 路径：`D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\installer\win-unpacked\MultiAgent Memory.exe`。

### 10.2 L0 写密钥门禁（进程活着 ≠ 能写）
- **现象**：`write_memory` 返回 `错误：[E_L0_LOCKED] L0 写密钥未解锁：请管理员在安全页解锁后再写入（§4.4.4）`。
  此时 **recall 正常**（读走解密/查阅会话），**只有写被拦**。
- **根因**：v1.0 所有写入都要先经 L0 封装加密（`l0:seal`），写密钥（DEK）由主进程持有；
  未解锁时 `writeDek === null` → 报 `E_L0_LOCKED`。**无任何 HTTP / MCP 旁路**，这是有意的安全设计。
- **唯一解锁路径（人工，一次）**：
  1. 打开 **MultiAgent Memory** 桌面应用 → **安全页**；
  2. 「写密钥（只加密，不可解密）」区块 → 输入**管理密码** → 点「解锁写密钥」；
  3. 若提示「管理密码：未设置」，先在同页「首次初始化：设置管理密码」（≥ 8 位）再解锁。
- **策略**：
  - 管理密码连续错 5 次 → 锁 15 分钟；连续查阅空闲 5 分钟自动锁定（`L0_IDLE_TIMEOUT_MS`）。
  - 解锁状态只存在于主进程内存 → **重启应用即回到锁定态**，需重新解锁。
  - **Agent 侧铁律**：收到 `E_L0_LOCKED` 时，**把待写内容挂起保存**（不要丢弃、不要谎称已写），
    提示用户解锁后**原样重放**；解锁期间可继续只读（recall）。
- **写前体检**：~~可用写探针先试写一次小内容，确认未被锁再批量写~~ → **作废**。实测证明短内容会被质量门在 L0 封装**之前**拦掉，
  根本走不到锁检查；探针无法探测锁状态。改用 §10.2.3 的「先落盘 → 再写 → 拒绝不丢 → 解锁后重放」。

### 10.2.1 写入被拒的两种错误（先分清，再动作）
写入路径的检查顺序是**固定**的：
```
content → 质量门(L0→L1 v3) → 五维查重/嫁接 → L0 封装(写密钥) → 落盘
```
| 返回 | 含义 | 与锁有关？ | 下一步 |
|---|---|---|---|
| `dedup.filtered` + `spec_violations: 短料拒收 / 裸链接` | 没过质量门（有效字 <30 且无硬事实；或裸链接） | ❌ 无关 | **改写内容**（补硬事实与技术细节）后重写 |
| `[E_L0_LOCKED] L0 写密钥未解锁` | 过了质量门，但 L0 封装时写密钥未解锁 | ✅ 有关 | **去解锁写密钥**，内容不要改 |

> **关键推论**：只有过了质量门的内容才会走到 L0 封装 →
> ① 短内容探针**探测不到**锁状态；② 看到 `E_L0_LOCKED` 就证明内容本身合规，**不要改写内容去绕过，要去解锁**。

### 10.2.2 锁状态当前无处可读（事实陈述，别再找）
- `write_unlocked` 只存在于 `L0Vault.status()`（主进程内存）与 Electron IPC `l0:status`（渲染层 → 主进程）。
- **MCP / HTTP 侧没有任何端点暴露它**：8204 只服务 `/mcp`（POST）与 `/recall/<id>`（GET 一次性明细页）；
  8200 = Agent 接入配置，8201 = 镜像拓扑，8202 = TCP MCP，8203 = Webhook（需 mcp-token）。
- 结论：**当前接口下 Agent 无法在写入前读到锁状态**，唯一信号就是写入回执里的 `E_L0_LOCKED`。

**写密钥什么时候会失效（源码实测，这决定了写入策略）**
`writeDek` 只有四条清空路径，**没有 TTL、也没有空闲超时**（`L0_IDLE_TIMEOUT_MS` 只管查阅会话）：

| 触发 | 代码位置 | 说明 |
|---|---|---|
| **锁屏** | `main.ts:3009` `powerMonitor.on('lock-screen')` → `onSecurityLock('screen_lock')` | 清 writeDek + viewDek + 作废 active grants |
| **休眠** | `main.ts:3010` `powerMonitor.on('suspend')` → `onSecurityLock('suspend')` | 同上 |
| **退出** | `main.ts:2990` `app.on('before-quit')` → `onExit()` | 退出清空内存密钥 |
| **重启** | `main.ts:2409` `onAppRestart()` | 作废授权 + 删除 wrapped DEK + 密钥清空 |
| 手动锁定 | `l0vault.ts:499` `lockWrite()` | 安全页点「锁定写密钥」 |

> **运维实况（2026-11-03 实测）**：17:10:11 写完 SOP 三段 → 17:10:2x 写契约 §10 成功 → 紧接着 §11 撞 `E_L0_LOCKED`，
> 中间仅隔几秒 —— 期间发生了一次**锁屏或休眠**。
> **推论：写密钥的有效期 = 从解锁到下一次锁屏/休眠/退出的时间，可能只有几分钟。**
> 因此 ①「先解锁再批量写」是赌运气，批量写到一半被锁屏打断就会中途失败；
> ② Agent **不能假设「我解锁过就一直能写」**；③ pending 落盘不是可选项，是刚需。

### 10.2.3 层一（零改动，立即可用）：先落盘 → 再写 → 拒绝不丢 → 解锁后重放
Agent 的标准写入动作改为四步，**粒度是「一条记忆」而不是「一批记忆」**：
1. **先落盘**：`ops/pending-write.ps1 -Content "<正文>" -Category <类> [-ProjectId P1]` → 生成 pending JSON。
2. **再写**：用**同样的** `content` / `project_id` / `category` / `user_id` / `source_agent` / `session_id` 调 `write_memory`。
3. **成功后**：删掉对应 pending 文件。
4. **被拒后**：pending 文件**保留**（不删），如实告知「请在 MultiAgent Memory 安全页解锁写密钥」；
   解锁后跑 `ops/flush-pending.ps1` → 成功的移到 `pending/done/`，仍被拦的继续保留（**退出码 2**）。

> **为什么必须逐条落盘**：锁屏/休眠会在任意时刻清掉写密钥（§10.2.2）→
> 批量写到第 7 条被锁屏打断时，前 6 条已写、第 7 条及以后丢失。逐条落盘则**最多丢当前这一条**，
> 且能精确重放。这是"批量写"与"逐条写"在可靠性上的本质差别。

> 为什么这比"等接口补齐"更实在：它一次覆盖 **E_L0_LOCKED / 锁屏 / 休眠 / 应用重启 / 进程崩溃 / 会话中断 / 网络中断** 七种失败，
> 且**不依赖任何内核改动**。实测：锁住时合规内容 → `blocked=1`（保留、退出码 2）；短内容 → 质量门拒收（内容问题，不算锁）。

### 10.2.4 层二（接口补齐后）：写前直接读锁状态
契约草案新增只读工具 **`get_write_status`**（见 `mcp-extension-contract.md` §11）：
- MCP server 已经持有 `opts.l0`（运行时就是 `L0Vault` 实例），且 `L0Vault.status()` **已实现**；
- 只需给 `L0Port` 接口补一个**可选**方法 `status?()`，MCP 侧加一个 case → **内核逻辑零改动**。
- 之后 `ensure-memory.ps1` 可加 `-CheckWrite` 参数：写前探针读一次锁状态，锁着就**不发起写入**、直接提示解锁。

### 10.2.5 Agent 侧铁律
1. 写入前**先落盘**（§10.2.3），永远不要"直接写、失败了再说"。
2. `short_low_signal` / `filtered` → 改内容；`E_L0_LOCKED` → 去解锁，**不改内容**。
3. 被拒时**如实告知 + 保留 pending + 给出解锁指引**；绝不谎称已写、绝不丢弃内容、**绝不反复重试**
   （重试无用，锁不会自己解开）。
4. 解锁后由 `flush-pending.ps1` 统一重放，**不手工重打一遍**（避免重复条目）。

### 10.3 失败处理
- 工具不可用时如实说明并继续，不假装检索 / 写入过。
- `ensure-memory.ps1` 返回 `online:false` → 直接告知"记忆服务当前不可用"，不要重试轰炸。
- 返回 `E_L0_LOCKED` → 走 §10.2 挂起重放，不要重试轰炸（重试也不会成功）。

## 10.1 身份复核（user_id 已验证）
- `user_id = u1` 已通过 `get_user_preferences` 成功返回确认；`u2` / `u9` 会被拒（"禁止跨租户读取"）。
- 所有 Agent 写入统一用 `u1`；MCP Bearer Token（在 `mcp.json`）与会话租户绑定，勿混用。

## 11. 速查清单
- **写前**：值得存？查重？`category` + `project_id` 定了吗？身份四件套齐了？**已落盘 pending 了吗**？
- **锁**：区分两种拒绝——`short_low_signal`/`filtered` = 改内容；`E_L0_LOCKED` = 去解锁、不改内容、不重试轰炸；
  被拒内容留在 `ops/pending/`，解锁后跑 `ops/flush-pending.ps1` 重放。
- **读前**：是项目相关问题？令牌作用域含该项目？选对 mode / scene？需明细才 `detail=true`？
- **永远**：`private` 内容进个人专属项目；URL / 金额不改写；不伪造；`user_id` 用 `u1`；
  被 `E_L0_LOCKED` 拦时**挂起重放，不丢内容**。

## 12. 落库记录（本 SOP 自身已在记忆库中）
- 写入时间：2026-11-03｜项目：`P1`｜`category=context`｜`user_id=u1`｜`source_agent=workbuddy`。
- 写入方式：拆 3 段写入（`ops/write-sop-final.ps1`），系统按章节精炼为分节 L1 记忆：
  | mem_id | 覆盖章节 |
  |---|---|
  | `mem_01M6G6FWD9XWY03PY78FK928D3` | §4 隔离模型（令牌作用域 + 项目级共享） |
  | `mem_01M6G6FWZD726NAQMTEY77FJZY` | §8 写入规范 |
  | `mem_01M6G6FXJ5K26Y4H2VM2A9XSVR` | §10 生命周期与稳定性（含静默启动、L0 门禁） |
- 召回验证：中文查询「多 Agent 记忆读写 SOP」「记忆写入 规范 分类 source_agent」「静默启动 写密钥 解锁」均可命中上述记忆。
- **v1.4 落库（2026-11-03 16:45）**：拆 3 段手动写入，`OK_PARTS=3/3`。
  - Part1 → `grafted` sim 0.836（嫁接更新旧 Part1 目标 `mem_01M6G6GDW2NT0C20XFK7C5YJGZ`）
  - Part2 → `action=new`（§7.1–§9 全新内容，独立成条 `mem_01M6G9B18B6D9Y46ST3X0ACC5N`）
  - Part3 → `grafted` sim 0.712（嫁接更新旧 Part3 目标 `mem_01M6G6GGAK1A300BT5VPD42GHY`）
- **另有采集器自动入库**（见 §14）：本文档与契约草案的正文已被采集器按标题切分入库，故同一内容存在多个版本，
  已知噪声与清理方式见 §14.4。
- 维护提示：
  - SOP 文件头含 `<!-- sop-version: vX.Y -->`（机器可读），`ops/write-sop-final.ps1` 自动读取该标记做版本化去重，
    版本变化即重写、未变即跳过；改版本号后重跑该脚本即可同步进记忆库。
  - **推荐路径（新）**：改文件 → 重跑脚本或直接交给采集器，**不要**手工把整篇灌进 `write_memory`（会重复，理由见 §14.2）。

## 13. 记忆运维接口扩展需求（待开发，MCP 侧）
### 13.1 现状：内核能力齐全，MCP 只暴露了 4 个工具
MCP 现有：`recall_memory` / `write_memory` / `list_projects` / `get_user_preferences`。
内核已实现、Agent 却完全用不到的能力（全部带审计）：

| 内核能力 | 位置 | MCP 是否暴露 |
|---|---|---|
| `coreMemoryOp`：remember / forget / pin / unpin / lock / unlock / archive / restore / param / migrate / delete（11 个操作） | `memories.ts:533` | ❌ |
| `coreFeedback`：confirm(+0.1) / reject(−0.05) / disputed(挂裁决) | `memories.ts:634` | ❌ |
| `coreGc` 遗忘引擎 + `ForgettingCycleReport` | `memories.ts:505` | ❌ |
| `listMemories` 列表 / 过滤 / 分页 | `storage` 层 | ❌ |

### 13.2 打分公式与两把锁死的旋钮
`score = relevance × ( 0.35·新鲜度 + 0.30·重要性 + 0.15·可信度 + 0.20·访问boost ) + pinned×0.15`

| 输入 | 权重 | 应由谁写入 | MCP 现状 |
|---|---|---|---|
| 新鲜度 f | 0.35 | recall 自动回写 `last_access_time` | ✅ 已通 |
| 重要性 imp | **0.30（最高）** | 写入时标注 | ❌ `write_memory` 无入参 → **恒 0.5** |
| 可信度 conf | 0.15 | 用户 confirm / reject | ❌ 无 feedback 工具 → **恒 0.5** |
| 访问 boost | 0.20 | `access_count/10` | ⚠️ 只能被动（被召回才涨） |

> **后果**：类别策略（fact 半衰期 365 天 / context 2 天）在 MCP 通道里无法表达；
> 被用户纠正过的错误记忆与刚写入的正确答案衰减速度相同；库只增不减，噪声挤占 `top_k`。

### 13.3 扩展清单（内核零改动，只透出）
| 优先级 | 改动 | 内核映射 |
|---|---|---|
| **P0** | `write_memory` 增加可选入参 `importance` / `confidence` / `half_life_days` / `tags` | `MemReq` 扩展 |
| **P0** | 新增 `feedback` 工具（`confirm`/`reject`/`disputed`） | `coreFeedback` |
| **P0** | 新增 `manage_memory` 工具（pin/unpin/lock/unlock/archive/restore/forget/param/migrate） | `coreMemoryOp` |
| **P1** | 新增 `list_memories` 工具（按 category / decay_class / 时间过滤 + 分页） | `storage.listMemories` |
| **P1** | `recall_memory` 增加 `scope='session'`（按 `session_id` + 时间窗过滤） | **「工作记忆」的正确出口** |
| **P2** | 暴露遗忘引擎报告（freshness_updated / migrated / summaries_created / merged_originals） | `ForgettingCycleReport` |

### 13.4 红线
- **`delete` 默认不开放给 Agent**：删除会清正文 + 清 L0 密文 + 移除向量，且**可跨端传播**，误删不可逆。
  优先用 `forget`（降权不删）与 `archive`；`delete` 留人工确认。
- **`locked` 豁免天然继承**：`coreMemoryOp` 最外层已有 `if (m.locked && op !== 'unlock')`，MCP 直接调用即自动生效。
- **`param` / `migrate` 绕过"locked 免降级"的设计意图**，建议只给受限子集，或在 MCP 层补 locked 检查。
- 一切 MCP 侧新增写操作必须写审计（`action='memory_op'`，含 `detail.op` 归因）。

### 13.5 接口未落地前的 Agent 临时替代
- **无法降权** → 用「纠正式写入」：写一条新记忆并标注「替代 `mem_xxx`」，正文说明旧记忆哪部分已过时（符合 §8.3 纠错守则）。
- **无法锁定关键记忆** → 把硬约束写进共享项目的 `preference` / `context`，正文写明「这是硬约束，勿删」。
- **无法回传置信** → 召回后向用户确认，得到确认再写一条 `category=fact` 的「已确认结论」。

### 13.6 契约草案
完整接口契约（JSON Schema / 内核映射 / 权限 / 向后兼容）见同目录 **`mcp-extension-contract.md`**。

**落库状态（2026-11-03 17:01）**：契约草案已按 `##` 章节粒度入库 P1，共 13 节（Preamble + §0–§11），
每节一条独立 `context` 记忆，标记形如 `[MCP Extension Contract v1.0 - Section 9]`。
- 写入脚本 `ops/write-contract-sections.ps1`（**幂等**：按账本精确标记查重，已存在即跳过，可随时重跑补齐）。
- 覆盖检查 `ops/check-contract-coverage.ps1` → 输出 `sections / marked / collectorOnly / missing`。
- 契约文件头含 `<!-- doc-version: v1.0 -->`（机器可读），改版本号后重跑写入脚本即同步。

## 14. 采集器自动入库机制（写入策略修正，重要）
### 14.1 机制（源码 `main.ts:466-471` 实测）
记忆服务有一个**后台采集器**，会自动摄取 Agent 的会话日志：
- 数据源：真实存在的 Agent 会话日志（Claude Code JSONL / workbuddy Markdown 等），**无日志则诚实 skip**。
- 周期：**5 分钟**（`COLLECTOR_INTERVAL_MS = 300_000`），首扫延迟 10s，单轮上限 **50 条**。
- 去重：`collector-cursor.json` 持久化游标（offset + contentSha）+ `seen` 哈希集合，增量扫描。
- 切分：**按 markdown 标题切成章节级记忆**（实测：契约草案的 `## 9. 实施落点`、`## 10. 验收用例`、`## 11. 落地顺序建议` 各自成为独立记忆）。

### 14.2 由此得出的写入策略（重要修正）
**同一个内容可能被入库两次**：一次来自手动 `write_memory`，一次来自采集器摄取会话转录
（因为 Agent 写文档时，文档全文本身就在会话记录里）。实测账本中出现次数：
`sop-version` = 2、`落地顺序建议` = 2、`各 category 的语义化模板` = 4。

因此**规范类 / 长文档类**内容推荐走这一条路：

> **写文件 → 让采集器入库**，而**不是**手动 `write_memory` 整篇灌入。
> 理由：① 采集器按标题切分，粒度更细、召回更好；② 不会与手动写入重复；③ 免去"切几段、怎么切"的猜测。

而**短小、一次性、需要立刻可检索**的知识（结论、约定、偏好）仍应手动 `write_memory` —— 它更快、更可控。

### 14.3 副作用与纪律（必须遵守）
采集器摄取的是**整个会话**，所以：
- 会话里出现的一切都会入库 —— 包括**被否决的方案、临时草稿、我引用的源码片段**。
- **纪律一**：不要在对话里粘贴密钥 / 凭证 / PII（会随会话入库；L0 加密只保护原文，不阻止入库）。
- **纪律二**：被否决的方案要显式写明「已否决，勿采纳」，或事后在桌面端归档；否则它和正确结论一样可被召回。
- **纪律三**：讨论中的**推测**要标注为推测，否则会与已验证事实同等权重地参与召回。
- **纪律四**：会话结束前若产出了规范类文档，**确认文件已落盘**即可，不需再手动灌一遍。

---

## 15. 多用户部署：私人记忆隔离 + 团队共享

> 合并自历史草稿 `draft-sop-multiuser.md`（原拟 §16，已归档至 `archive/`）。所有结论已定（D1–D25，详见 §15.9 与 `multiuser-design-status.md`）。
> 目标：每人登录只看到自己私人记忆 + 团队共享记忆，**不引入物理分库/分文件**。

### 15.1 需求定义
- 每个登录用户 **U** 的 Agent 会话应当能 recall：
  1. U 自己的**私人记忆**；
  2. **团队共享记忆**；
  - 且**不能** recall 其他任何用户的私人记忆。
- 写入同理：U 只能写入自己的私人池与共享池，不能写入他人私人池。

### 15.2 架构约束（来自 v1.0 源码/实测，不可绕过）
| 事实 | 来源 | 对设计的影响 |
|---|---|---|
| 记忆记录无 `scope` 字段 | `write_memory` 入参实测 + `mcpAuth.ts`/`mcpRecall.ts` | 不能靠记忆字段标"私人/共享" |
| 隔离唯一闸门 = 令牌 `scope_project_ids` + 读写 `project_id` | `mcpAuth.ts` | 私人隔离必须落到 `project_id` + 受限令牌 |
| 同 `project_id` 内所有记忆互相可见 | `mcpRecall.ts` | `user_id` 不隔离读取，私人必须独立 `project_id` |
| recall 只在单个 `project_id` 内检索 | `mcpRecall.ts` | "共享+私人"需两次 recall 再合并（或 `scope='user+shared'`） |
| `get_user_preferences` 按 `user_id` 校验、跨租户拒 | `mcpAuth.ts` | 偏好走原生 `user_id` 隔离，不需 `project_id` |
| 当前令牌 `['*']`、单用户 `u1`、单项目 `P1` | 部署实测 | 多用户前必须改为按登录发放受限令牌 |

> 补充：L0 属**保密归档层**，不计入 `P-shared`/`P-<user>` 任一池；recall 只作用于 L1+。故"分流"仅针对 L1，不在原始采集层。

### 15.3 三池模型（推荐落地形态）
- **共享池 `P-shared`**：团队共享知识（决策、坑、规范、项目背景）。所有用户令牌都包含。
- **私人池 `P-<user>`**：每用户一个专属项目（`P-u1`、`P-u2`…）。只有该用户令牌包含。
- **归档池 `P-archive`**（可选）：离职/停用用户的私人池移入；普通用户令牌不含，仅供管理员审计召回。

> 命名约定：私人池 ID 直接用登录标识（与 `user_id` 同源，如 `P-u1`），保留 `P-u*` 前缀，避免与业务项目 ID 撞名。

### 15.4 登录 → 令牌签发（真正的隔离闸门）
1. 用户 X 通过身份系统登录；
2. **令牌代理（Token Broker）** 为 X mint 一枚 MCP 令牌：`scope_project_ids = ['P-shared', 'P-uX']`；
3. 该令牌随会话下发给 X 的 Agent/客户端；
4. 注销/超时 → 令牌吊销（短 TTL 或显式 revoke）。

禁止事项：
- 禁止把静态 `['*']` 令牌下发给任何真实用户/客户端；
- 禁止用同一枚令牌服务多个不同用户。

### 15.5 Agent 读取流程（会话内）
对 X 的会话：
1. `recall_memory(scope='user+shared')` → 一次返回 `P-shared` + `P-uX` 合并（推荐）；
2. 或显式两次 `recall_memory(project_id='P-shared')` + `recall_memory(project_id='P-uX')` 再合并。

若误调 `recall_memory(project_id='P-uY')`（Y≠X）→ 令牌不含 `P-uY` → 报"当前 MCP 令牌作用域不含项目 P-uY"（§4），Agent 如实告知、不伪造。

### 15.6 采集与分流（L0 归档 · L1 分流）
本系统的"分流"发生在**脱敏之后的 L1**，不在原始采集层。

#### 15.6.1 L0：保密归档，不进任何池
- 所有原始会话/产出经**全量采集**落入 **L0**，加密归档，**不进入 `P-shared` 也不进入 `P-<user>` 任一池**。
- L0 只有持 L0 会话/管理封装才能解密查阅（现有 L0 vault 设计），普通 recall 不触及原始层。
- 因此 L0 没有"分流"问题——它永远保密留档。

#### 15.6.2 L1：清洗脱敏后的真实分流点
L0 →（清洗 + 脱敏）→ L1，脱敏后的 L1 才被分到私人池或共享池。

**实施路径（混合）**：
- 有**显式意图** `for='team'` / `for='me'` → 直接映射到 `P-shared` / `P-<user>`，最可靠；
- 无显式意图 → 管线按 `category` + 残留个人标记**自动分流**；
- 低置信度时由 Agent 向用户确认一次。

**L1 分流决策树（首命中即生效）**：
| # | 条件 | 落点 |
|---|---|---|
| 0 | 显式意图 `for='team'` | `P-shared` |
| 0' | 显式意图 `for='me'` | `P-<user>` |
| 1 | `category = preference` | `P-<user>` |
| 2 | `category = context` 且偏个人 | `P-<user>` |
| 3 | `category ∈ {fact, decision, pitfall, insight}` 且**无残留个人标记** | `P-shared` |
| 4 | 含残留个人标记（不确定） | `P-<user>`（fail-safe） |
| 5 | 兜底（默认 `P-shared`） | `P-shared` |

#### 15.6.3 不变式（强制）
- **`P-shared` 只接收脱敏后的 L1**：分流步骤只能消费 L1 产物，绝不消费 L0。由管线顺序（脱敏先于分流）保证"共享 = 已脱敏"，不依赖人工盯防。
- 脱敏漏网导致敏感内容误入 `P-shared` 时，按 §8.3 写替代条 + 强化脱敏；因 L1 已脱敏，跨池搬移不泄漏秘密，可用 `manage_memory` 移动，不必依赖 `delete`。

#### 15.6.4 纠错
- L1 已脱敏，从 `P-<user>` 搬到 `P-shared`（或反之）不会泄漏，用 `manage_memory` 移动或写替代条即可。

### 15.7 用户生命周期运维
- **入职**：建 `P-uX`（外部 IAM/令牌代理在 onboarding 时建，或管理员脚本/管理端；本期不开 MCP `create_project`）；令牌代理登记 X → 登录即发 `['P-shared','P-uX']`。
- **离职/停用**：撤销 X 令牌；将 `P-uX` 内容迁移/移入 `P-archive`（**勿 delete**，保留审计）；后续不再有任何令牌含 `P-uX`。
- **项目重组**：共享知识在 `P-shared` 内用 `manage_memory` 纠错，不跨池搬。

### 15.8 误区与反模式
- ❌ 用 `user_id` 隔离私人记忆——读取不隔离，同池互见。
- ❌ 物理分文件/分库——闸门是令牌不是文件，分文件不增安全性、且要改存储/备份/遗忘/recall，收益为零。
- ❌ 给客户端发 `['*']` 令牌——等于无隔离。
- ❌ 把私人记忆写进 `P-shared` 期望靠字段隐藏——无 `scope` 字段，写进去人人可读。

### 15.9 决策记录（已定结论 D1–D25）
1. **D1** 不建独立物理文件/库；私人隔离靠 `project_id` 分离 + 令牌作用域。
2. **D2** 隔离唯一闸门 = 令牌 `scope_project_ids` + `project_id`；`user_id` 不隔离读取。
3. **D3** 三池：`P-shared` / `P-<user>` / `P-archive`（可选）。
4. **D4** 登录→令牌代理 mint 受限令牌 `['P-shared','P-uX']`；禁静态 `['*']` 下发用户。
5. **D5** L0 = 全量采集加密归档，**不进任何池**；recall 只作用于 L1+。
6. **D6** L1 = 清洗+脱敏后产物，是真实分流点。
7. **D7** L1 分流 = **混合**（显式意图优先 + 无意图按 category/残留标记自动 + 低置信问用户）。
8. **D8** L1 兜底 = **默认 `P-shared`**。
9. **D9** 不变式：`P-shared` 仅收脱敏 L1；分流只消费 L1，绝不消费 L0。
10. **D10** 脱敏闸门必须**服务端可信内核**、fail-safe（疑敏不进共享）。
11. **D11** 纠错：L1 已脱敏，跨池搬移用 `manage_memory`，不依赖 `delete`。
12. **D12** 目标工具集 = 12 个 MCP 工具（读7/写2/管3）+ 内部管线 + 外部令牌代理。
13. **D13** recall 仅单 `project_id` 内检索；"共享+私人"由 `scope='user+shared'` 或两次 recall 合并。
14. **D14** 脱敏强度 = **B+定向人工复核**（规则+模型 fail-safe；高风险类目升人工复核）。
15. **D15** 脱敏策略 = **两者并用**（可抽取秘密→片段脱后共享；本质个人→整条转私人）。
16. **D16** 扫描时机 = **规则同步 + 模型异步**。
17. **D17** 精炼管线 = **集中跑于可信内核**。
18. **D18** 私人池 ID 命名 = **`P-<user_id>`**（保留 `P-u*` 前缀）。
19. **D19** 令牌代理 = **外部 IAM**（记忆服务只消费校验）。
20. **D20** 管理员令牌 = **外部 IAM 加 `is_admin` 声明**。
21. **D21** 召回支持 **`scope='user+shared'`**（一次返回 `P-shared`+`P-<user>` 合并）。
22. **D22** 私人池跨设备 = **按人不按设备**。
23. **D23** `create_project` 本期**不开** MCP 工具（外部/管理端建，绑定 onboarding）。
24. **D24** 跨项目检索/全局搜索 = **需要**（跨可见项目聚合检索）。
25. **D25** 导出/导入 = **需要**（按池/用户/全量，配套归档与合规）。

### 14.4 当前库内的已知噪声（如实记录）
本次 SOP 落库时 v1.2 与 v1.4 两版并存（`§12` 表中的旧 mem_id 仍在），
加上采集器入库的章节级记忆，同一章节存在多个版本。召回层会做相似去重，但**排序噪声真实存在**。
- 清理方式（当前 MCP 无运维工具，见 §13.3）：在桌面端「记忆」页勾选旧条目 → 归档（`archive`，可恢复）；
  或等 `manage_memory` 落地后用脚本批量 `archive` 旧版本 mem_id。
- 归档而非删除：`delete` 会清 L0 密文且不可逆，`archive` 可 `restore` 回温。

---

## 16. 运维架构四方向（批次43 反向补自本项目 `MCP运维与多Agent写入规范.md`）

> 本项目侧的运维视角，目标侧原未覆盖，摘要补回，便于双向一致。

### 16.1 方向1：宕机后端守护
MCP 与后端同进程；单写者存储（`<db>.lock` 原子建锁，锁被活进程持有 → 自动只读）；守护本质是「重新分配写锁归属」，不是加副本。推荐路径：C 为主目标（独立后端守护独占写锁），A 为即刻第一步（supervisor 保活整 app），阶段 0→3 渐进。

### 16.2 方向2：健康检查与运行手册
三档：存活（Liveness：TCP 8202 `connect`+`initialize` / HTTP 8204 `GET /health`）、就绪（Readiness：`/health?deep=1`，存储可达/L0 状态/token 有效/audit 可追加）、指标（Metrics：`/metrics`，recall 次数/p95 latency/saved_tokens/连接数）。落地点：`mcpHttp.ts` 加 `GET /health`(含 `?deep=1`) 与 `GET /metrics`（待实现）。

### 16.3 方向3：跨机扩展
三大硬约束：① 本地优先定位冲突（跨网需重做威胁模型）；② 单令牌不够（需 per-agent 独立凭据 + 独立 scope）；③ 单写锁禁止多机并发写（跨机写前提先接通 `sync`）。推荐：反向代理 TLS 终结 + per-agent 令牌 + 中心写者或分片 + `pgSyncHub`。

### 16.4 方向4：多 Agent 写入规范
现状安全网：source_agent 溯源、ULID 唯一 ID、dedup 拦完全一致、`FileStorage` 单写锁串行化、`projectInScope` 隔离。规范条款：身份必填（**禁止依赖默认 `'mcp'`**）、只落 L0、去重优先、冲突外置、诚实隔离。待补能力：per-agent 配额/限流、近重复检测、默认身份禁用（多 Agent 下缺 source_agent 应拒写而非默认）。

