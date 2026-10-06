---
title: 需求规格书_新增章节_十八_ID字段整理
status: imported
---

## 十八、需求文档 ID 字段整理


本章节对《需求规格书》中出现的各类 ID 字段做小类区分，并对每个 ID 字段给出中文释意（说明），供全文检索、审计追踪、数据建模与测试用例编写时参考。

### 18.1 小类划分总览

| 小类 | 含义 | 典型示例 |
|---|---|---|
| A 组织类 | 多租户架构中组织或用户身份的标识 | enterprise_id、team_id、user_id |
| B 记忆对象类 | 指向一条记忆实体本身的标识 | memory_id、id、mid |
| C 关联关系类 | 记忆之间的来源、合并、冲突等关系两端的标识 | from_id、to_id、source_ids、target_id、old_id、new_id、merged_id |
| D 上下文类 | 记忆所在上下文（会话、项目）的标识 | session_id、project_id、session_binding |
| E 版本与审计类 | 快照、审计、校验记录的标识 | snapshot_id、resource_id、request_id |
| F 业务决策类 | 项目内业务决策记录的标识 | decision_id |
| **G 端谱与同步类（19.10/19.11 新增）** | 多端接入、云同步、身份令牌等 | form、agent_ref、sync_token、conflict_id、dispute_flag |
| **H 模型反代理与预算类（19.8/2.4 新增）** | LLM 路由来源、额度/单价、预算标识 | llm_proxy_source、model_ref、proxy_budget、proxy_price_cap、decay_class |

> **新增字段登记规则（本目录的持续约定）**：
> 凡是后续对话或设计中新出现的**字段/ID**，必须按「**字段（英文名） + 中文说明**」格式补进 18.2 对应小类（不属于已有小类的，先归入 G/H 或新建小类），并在 18.5 登记表登记一行（新增时间、出处章节、小类、说明）。**不允许字段只散落在某章节而不进本目录。**

### 18.2 各小类 ID 字段明细

#### A. 组织类（多租户隔离）

| 字段名 | 中文说明 |
|---|---|
| enterprise_id | 企业（租户）唯一标识，多租户数据隔离的顶层边界 |
| team_id | 团队唯一标识，隶属于某企业，用于团队级记忆共享 |
| user_id | 用户（个人）唯一标识，隶属于某企业或团队，用于个人级记忆隔离 |

#### B. 记忆对象类

| 字段名 | 中文说明 |
|---|---|
| memory_id | 一条记忆（情景记忆或语义记忆）的唯一标识，用于检索、归档、恢复、合并等操作 |
| id | 通用记录主键，具体含义依所在表而定，如企业记忆、团队记忆、个人记忆、踩坑记录、合并记录等 |
| mid | 记忆 ID 的代码变量简称，常用于遍历 mem_ids 列表时取单条记忆；不作为正式落库列名 |

#### C. 关联关系类（来源、合并、冲突）

| 字段名 | 中文说明 |
|---|---|
| from_id | 迁移或引用关系中的"来源方"记忆 ID |
| to_id | 迁移或引用关系中的"目标方"记忆 ID |
| source_ids | 被合并的原始记忆 ID 集合，以 JSON 字符串保存（TEXT 列，序列化的 JSON 数组），用于合并可追溯 |
| target_id | 合并或去重操作中的"目标"记忆 ID，即合并后保留或新建的那条 |
| old_id | 冲突处理中被覆盖的旧事实记忆 ID |
| new_id | 冲突处理中新增或替代的新事实记忆 ID |
| merged_id | 合并操作后生成的新合并记忆 ID |

#### D. 上下文类（会话、项目）

| 字段名 | 中文说明 |
|---|---|
| session_id | 会话（对话）唯一标识，用于跨会话项目上下文绑定 |
| project_id | 项目唯一标识，用于项目级记忆、踩坑记录、决策记录的归属 |
| session_binding | 记忆与会话的绑定关系字段，替代旧 working 状态，标识该记忆在哪个会话上下文中活跃 |

#### E. 版本与审计类

| 字段名 | 中文说明 |
|---|---|
| snapshot_id | 记忆版本快照唯一标识，用于版本回滚与历史追溯 |
| resource_id | 审计日志中被操作资源（记忆或配置等）的标识，配合 action 字段记录操作对象 |
| request_id | 召回请求唯一标识，一次 recall 请求共享，串起该请求内的 rerank_on / cold_recall / recall_breach 等审计行 |

#### F. 业务决策类

| 字段名 | 中文说明 |
|---|---|
| decision_id | 项目决策记录唯一标识，用于决策历史查询与追溯 |

#### G. 端谱与同步类（19.10 / 19.11 新增）

| 字段名 | 中文说明 |
|---|---|
| form | 运行端形态标识（desktop/web/mobile/mac/linux/cli），决定发现能力、数据落点与反代理来源（19.10 矩阵）；审计 `auto_bind`/`sync` 必记，可归因"在哪个端发生" |
| agent_ref | 已接入 Agent 的唯一引用（`agent:<name>`），用于 MCP 工具绑定、反代理来源、`llm_proxy_source` 归因（19.2/19.5/19.8） |
| model_ref | 反代理可模型的引用（`agent:<name>:<model>`，可带档位），指向某 Agent 声明的某个免费/低价模型（19.8 全量映射） |
| sync_token | 全端同步的会话令牌，绑定账号（user_id+team_id）做跨端身份（19.11 同步身份） |
| conflict_id | 一条记忆冲突裁决的唯一标识，挂起 9.7 裁决队列，记录双方版本与两端 form |
| dispute_flag | 冲突"待裁决"标记字段，置真后记忆进入 P8 裁决队列（9.7 / 12.1） |
| pending_sync | 离线端"待回传"标记（移动端断网先写本地），联网批量回传且幂等后置零（19.11 §5） |
| sha256 | 记忆内容指纹（幂等键），同步回传去重、每日全量对账一致性校验（5.4 / 19.11 §3） |

#### H. 模型反代理与预算类（19.8 / 2.4 新增）

| 字段名 | 中文说明 |
|---|---|
| llm_proxy_source | 反代理来源审计字段（`agent:<name>`），记录"这次 LLM 调用借用了哪个 Agent 的模型 + 本次花费 + 生效模式 auto/manual"（19.8 / 4.3） |
| llm_fallback | 反代理/网络模型超限或失败后"回退本地"的审计字段（4.3 / 19.8） |
| proxy_budget | 反代理**免费额度上限**（次/月，逐来源，默认声明额度 ×0.9 留 10% 余量） |
| proxy_cost_cap | 反代理**低价付费月成本上限**（¥/月，逐来源），超了该低价源停用转其他/本地 |
| proxy_price_cap | 反代理**低价单价上限**（¥/千，用户定不可超；=0 即禁用所有付费低价、仅用免费） |
| proxy_select_mode | 反代理选择模式（auto=系统先免费后低价 / manual=用户按全量映射勾选；用户随时可定，切换记审计） |
| decay_class | 记忆热温冷分层判定字段（hot/warm/cold/archived/dormant），cold/dormant 影响召回与预算（15.3 / 17.7） |
| pinned | 记忆置顶标记，检索免检直接进候选集 Top K（17.5 / 17.8） |
| locked | 记忆锁定标记，豁免自动衰减/归档/合并/摘要等后台任务（17.8） |
| half_life_days | 记忆半衰期天数，驱动 decay_class 衰减节奏（可调参）（17.5） |
| access_count | 记忆被召回命中的累计次数（7.1 反馈驱动自生长的输入） |
| reinforce_count | 记忆被用户确认强化的次数（与 access_count 分家，17.4） |
| merged_from | 合并谱系：本条记忆"由谁合并而来"的来源（15.2） |
| merged_into | 合并谱系：本条记忆"合并进了谁"的目标（15.2） |

### 18.3 按表或结构归集

#### 18.3.1 enterprises / teams / users

- enterprise_id：企业ID
- team_id：团队ID
- user_id：用户ID

#### 18.3.2 企业、团队、个人记忆表

- id：该表记忆记录主键
- enterprise_id：所属企业
- team_id：所属团队（团队记忆表）
- user_id：所属用户（个人记忆表）
- memory_id：记忆本体ID，用于跨表引用

#### 18.3.3 会话绑定表

- from_id：来源记忆ID
- to_id：目标记忆ID
- session_id：会话ID

#### 18.3.4 审计日志表 audit_log

- id：审计记录主键
- enterprise_id：所属企业
- user_id：操作用户
- old_id：冲突覆盖中被替代的旧记忆ID（C 类；与 new_id 成对记录，见 18.4 约束5）
- new_id：冲突覆盖中新增/替代的新记忆ID（C 类；与 old_id 成对记录）
- resource_id：被操作资源ID（普通动作）；召回链路动作（rerank_on/cold_recall/recall_breach）可填 memory_id 或 request_id
- request_id：召回请求ID（E 类；一次 recall 请求唯一，串起该请求的 rerank/cold/breach 多条审计行，见 4.3）
- payload_tokens：本次召回返回的记忆 payload token 数（见 2.4.1 预算口径）
- pipeline_llm_tokens：召回链路自身 LLM 消耗（重排/注意力过滤，单独计量）

#### 18.3.5 项目记忆、踩坑、决策表

- id：记录主键
- project_id：所属项目
- decision_id：项目决策ID（仅决策表）

#### 18.3.6 记忆合并表 memory_consolidated

- id：合并记录主键
- merged_id：合并后生成的记忆ID
- source_ids：被合并来源记忆ID集合
- target_id：合并目标记忆ID

#### 18.3.7 记忆快照表 memory_snapshots

- id：快照记录主键
- snapshot_id：快照唯一标识
- memory_id：被快照的记忆ID

#### 18.3.8 记忆归档表 memory_archived

- id：归档记录主键，通常与被归档记忆的 memory_id 一致

### 18.4 使用约束

1. 唯一性范围：enterprise_id、team_id、user_id 在组织表内全局唯一；memory_id、snapshot_id、decision_id 在各自实体范围内唯一。
2. 跨表引用一致性：memory_id 在记忆主表、会话绑定表、审计日志表、快照表、合并表中必须指向同一记忆本体。
3. 审计追溯：所有对记忆对象的操作（归档、合并、覆盖、恢复、删除）必须记录 resource_id 或 memory_id、action、user_id。
4. 合并可回溯：memory_consolidated 必须同时记录 merged_id 与 source_ids，不允许合并后找不到来源。
5. 冲突覆盖可回溯：old_id 与 new_id 必须成对记录在审计日志中，禁止只记录新事实而不记录被覆盖的旧事实。
6. ID 命名统一：mid 仅为代码变量简称，正式落库字段一律使用 memory_id，不使用 mid 作为列名。

### 18.5 新增字段登记表（持续登记，格式：字段 + 中文说明）

> 规则：后续任何新增字段/ID 必须在此登记一行（格式「字段（英文名） | 中文说明 | 出处章节 | 小类 | 登记日期」），同时补进 18.2 对应小类。本次对话（19.x 端谱/反代理/同步/日志）已登记的字段如下。

| 字段 | 中文说明 | 出处章节 | 小类 | 登记日期 |
|---|---|---|---|---|
| form | 运行端形态（desktop/web/mobile/mac/linux/cli），决定发现能力/数据落点/反代理来源，审计必记 | 19.10 / 19.11 | G | 本次对话 |
| agent_ref | 已接入 Agent 唯一引用（`agent:<name>`），用于绑定/反代理归因 | 19.2 / 19.5 / 19.8 | G | 本次对话 |
| model_ref | 反代理模型引用（`agent:<name>:<model>`，含档位） | 19.8 | G | 本次对话 |
| sync_token | 全端同步会话令牌，绑定账号做跨端身份 | 19.11 | G | 本次对话 |
| conflict_id | 冲突裁决唯一标识，挂 9.7 裁决队列 | 9.7 / 19.11 | G | 本次对话 |
| dispute_flag | 冲突"待裁决"标记，置真进 P8 队列 | 9.7 / 12.1 | G | 本次对话 |
| pending_sync | 离线端"待回传"标记，回传幂等后置零 | 19.11 | G | 本次对话 |
| sha256 | 记忆内容指纹（幂等键），同步去重 + 对账校验 | 5.4 / 19.11 | G | 本次对话 |
| llm_proxy_source | 反代理来源审计（哪个 Agent 模型 + 花费 + auto/manual） | 19.8 / 4.3 | H | 本次对话 |
| llm_fallback | 反代理/网络超限或失败回退本地的审计字段 | 19.8 / 4.3 | H | 本次对话 |
| proxy_budget | 反代理免费额度上限（次/月，逐来源，留 10% 余量） | 19.8 | H | 本次对话 |
| proxy_cost_cap | 反代理低价付费月成本上限（¥/月） | 19.8 | H | 本次对话 |
| proxy_price_cap | 反代理低价单价上限（¥/千，用户定不可超；0=禁用付费低价） | 19.8 | H | 本次对话 |
| proxy_select_mode | 反代理选择模式（auto 先免费后低价 / manual 用户勾选） | 19.8 | H | 本次对话 |
| decay_class | 记忆热温冷分层（hot/warm/cold/archived/dormant） | 15.3 / 17.7 | H | 本次对话 |
| pinned | 记忆置顶标记，检索免检进 Top K | 17.5 / 17.8 | H | 本次对话 |
| locked | 记忆锁定标记，豁免后台自动任务 | 17.8 | H | 本次对话 |
| half_life_days | 记忆半衰期天数，驱动 decay_class | 17.5 | H | 本次对话 |
| access_count | 记忆被召回命中累计次数（自生长输入） | 7.1 / 17.4 | H | 本次对话 |
| reinforce_count | 记忆被用户确认强化次数（与 access_count 分家） | 7.1 / 17.4 | H | 本次对话 |
| merged_from | 合并谱系：由谁合并而来 | 15.2 | H | 本次对话 |
| merged_into | 合并谱系：合并进了谁 | 15.2 | H | 本次对话 |
| l0_auth | L0 原始加密对话查阅的授权凭据（管理员授权 + 密码，本次会话有效） | 4.3 / P15 | H | 本次对话 |
