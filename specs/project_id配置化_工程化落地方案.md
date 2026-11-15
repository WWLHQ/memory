# project_id 配置化 · 工程化落地方案

> 状态：**阶段 0 结论已收口 → 本文 §4–§12 的配置化实施全部冻结**；当前执行真源见 [`project_id零配置_详细实施方案.md`](project_id零配置_详细实施方案.md)。本文保留为「将来真需项目隔离时」的阶段 1 备选设计。
> 时间：2026-11-15 09:05 创建 / 10:04 收口（所有行号/数字以该时刻工作树与真机账本为准；实施时以符号名为准，行号会漂移）
> 纪律真源：`AGENTS.md` §0 / §0.1 / §0.2、`specs/开发纪律_三道闸门.md`、`specs/需求规格书.md` §19.4 / §19.5
> 前置：本轮首步已直连 8204 `recall_memory`（命中 1 条，未标证据不足）；结论仍以源码 + 真机为准。

---

## 0. 结论先行

当前 `project_id` 不是「配置」，是**散落在四条入口里的四种硬编码/显式传参**，其中量最大的后台采集链路写死 `'P1'`。本方案把它收敛成：

**一个纯函数解析器 + 一份可持久化配置 + 所有写入入口统一调用 + 审计可追溯 + 历史数据不动**。

推荐路径：**缺省 `static`（行为与现状逐字节一致）→ 用户显式切换 `by_workspace` 才分流**；不做历史迁移、不新增 MCP 工具、不新增页面。

---

## 1. 现状梳理（现查现证）

### 1.1 四条入口与真源

| # | 入口 | 决定者 | 真源 |
|---|---|---|---|
| 1 | 后台会话采集（量最大） | **硬编码 `P1`**，用户不可配 | `sessionCollector.ts:1064/1074/1089` 三处 `opts.project_id ?? 'P1'`；唯一注入点 `electron/main.ts:3278` |
| 2 | daemon 待判队列交接 | **硬编码 `P1`** | `electron/main.ts:3180`，`session_id: undefined` |
| 3 | MCP `write_memory` | 客户端**必填** + `projectInScope` 三池门禁 | `mcpSchema.ts:102/112`、`mcpHttp.ts:336-339`、`mcp.ts:207` |
| 4 | Web 写入页 | 默认 `DEFAULT_PROJECT_ID`，`listProjectIds()` 校正，用户可改不可空 | `WritePage.tsx:51/74`、`logic.ts:28`、`WriteForm.tsx:119` |

读取侧：`mcpRecall.ts:100-116`（`resolveProjectId`：显式 > 唯一项目自动定位 > 0/多项目报错）、`mcpAuth.ts:48-85`（三池分类与 `projectInScope`）、`mcpReadTools.ts:93-98`（`list_memories` 的 infos 先按 scope 过滤）、`web/retrieval/coreEngine.ts:117-133`（默认「全部项目」逐项目召回后按 `mem_id` 去重合并）。

### 1.2 真机数据（08:58 实测）

- `memories.db.json`：3770 条 = **P1 3765** / P-shared 4 / P_SYSTEM 1。
- 注册表 `projects` **只有 `P-shared`**（`kind=shared`，`created_by=bootstrap`，`display_name` 空）→ **P1 无注册记录**，是纯隐式项目，无中文名、不绑定任何工作区目录。
- P1 记忆最早 `2026-11-04 14:49`，审计最早 P1 行 `2026-10-29 17:15`；`list_projects` 报 P1 3757 / P-shared 3（口径差异来自 deleted/merged 过滤，属预期）。
- 全仓库 Grep 无 `workspace → project` 映射逻辑；`ProjectRecord.display_name` 对 P1 为空。

### 1.3 已知债（不是新发现）

- `specs/demo-data-baseline.md:35`：`DEFAULT_PROJECT_ID='P1'` 登记为「A10 回落占位」。
- `specs/AUDIT-FULL-REVIEW-2026-10-31.md:151`：早把「项目 ID 硬编码 `'P1'`…真实项目应来自 `list_projects`」列为待修项。
- `需求规格书.md:3606-3624`：19.4 定义 `project_id` 为**跨 Agent 共享域锚**；`:3716` 的 `project_id=P1` 只是举例字符串，**P1 不代表任何业务项目**。

### 1.4 工作区在途改动（硬约束）

`git status` 显示 M5 批次在途：28 个 `M` + 23 个 `??`，其中 **`specs/code-index.generated.md` 已被修改**、`meta/index.md`、`src/electron/main.ts`、`src/core/memagent/types.ts`、`mcpSchema.ts`、`paramsSnapshot.ts` 均在途。

→ **本轮及 T0 禁止重建索引**，否则覆盖并行会话产物；实施时须先 `git status` 复核，只改本方案相关文件，禁止 `git add .`。

---

## 2. 目标 / 非目标 / 验收 AC

### 2.1 目标
G1 采集写入的 `project_id` 可配置、可推导、可追溯；G2 缺省行为与现状完全一致；G3 不破坏 19.4 项目隔离、三池可见性、L0 查阅授权；G4 历史 3765 条 P1 数据零改动。

### 2.2 非目标
N1 不新增 MCP 工具（`mcpSchema.ts` 恰好 12 个，D6-5 契约有测试锁）；N2 不新增独立页面；N3 不改 `recall_memory` 的解析/回显口径；N4 不迁移历史数据；N5 不动 `P_SYSTEM` / `P-shared` 语义。

### 2.3 验收 AC

| AC | 判据 |
|---|---|
| AC-1 | 配置缺省/文件缺失/损坏时，采集写入 `project_id` 恒为 `P1`，审计与回执与改动前逐字段一致 |
| AC-2 | `mode=by_workspace` 且规则命中时，写入落规则指定项目；`resolved_from='mapping'` 与 `rule_id` 真落审计 |
| AC-3 | 同一 `CollectedItem.key` 的所有条目解析到同一项目（会话视图不被拆散） |
| AC-4 | 规则未命中按 `unmapped` 处理：`default` 落默认项目 / `hold` 明确不入库且留痕 |
| AC-5 | 规则产出的项目 ID 非法（空、`P-` 私有池前缀、超长、非 slug）→ 明确拒绝并回落默认，**绝不静默入私有池** |
| AC-6 | 桌面端 drain（daemon pending）与实时 onScan 两条链路解析结果一致 |
| AC-7 | MCP `write_memory` 与 Web 写入页行为不变（必填 / 可改 / 三池门禁） |
| AC-8 | `list_projects` 能列出新项目；检索页「全部项目」与指定项目两种口径均正常 |
| AC-9 | 只读盘点 `dry_run=true` 的迁移报告：库与审计**零变更** |
| AC-10 | 配置读写走登录/管理员门禁；配置文件随数据根迁移与备份 |

---

## 3. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 新增**单一真源** `src/core/memagent/projectRouting.ts`（纯函数 + 归一化），所有写入入口只调它 | 杜绝「各入口各写一套」，符合 19.4 单一锚 |
| D2 | 优先级 = 显式传入 > 规则命中 > 默认项目；**不猜** | 与 `resolveProjectId` 现有「不猜」口径一致；MCP 多项目不指定仍报错 |
| D3 | **只对新增写入生效，历史不动** | 见 §8 L0 授权风险；也避免 3765 条整库重归属 |
| D4 | 不新增 MCP 工具 | 12 工具契约 + 测试锁；配置走 IPC 与文件 |
| D5 | 不改 L0 存储、不改三池分类；解析结果仍过 `projectInScope` | `mcpAuth.ts` 是权限真源，旁路会造越权 |
| D6 | UI 复用现有卡片与原型，中文名唯一来源放 `src/web/shared/projectLabels.ts` | 用户 UI 铁律：禁原始 JSON / 英文字段名进渲染，整页人话 |
| D7 | 缺省 `mode='static'` | 保证 AC-1「既有行为未变」，用户显式切换才分流 |

### 3.1 待用户拍板（实施前必须回答）· 附推荐答案

| # | 问题 | **推荐** |
|---|---|---|
| P1 | 缺省模式 | `static`（行为不变），用户显式切 `by_workspace` 才分流 |
| P2 | 未命中策略 | 一期只做 `default`；`hold` 二期，日常不用 |
| P3 | 按工作区名自动派生 ID | **否**（见 §3.2 真机证据） |
| P4 | 历史迁移 | 只做 `dry_run=true` 只读盘点，不写入 |
| P5 | 配置卡片宿主 | 复用「大模型配置」所在参数区，不新增页 |

### 3.2 推荐配置策略：少而稳、白名单、默认兜底

**真机证据（2026-11-15 09:23 现查）**：`~/.workbuddy/projects` 有 **42 个顶层工作区目录 / 139 个 jsonl**，其中 **41 个是 `d-Work Folder-Agnet-WorkBuddy-WorkSpace-<时间戳>` 这类临时目录**（还有一个 `...-免费API转接` 含中文），只有 1 个是本项目 `d-Work Folder-Agnet-Deepseek Harness-2026-10-06-16-15-17`；`.claude/projects` 另有 5 个。当下 `list_projects` = P1 3762 条 / P-shared 1 条。

→ **「一工作区一项目 / 自动派生」会立刻造出 42+ 个无语义且带时间戳的项目**，后果：
1. `recall_memory` 省略 `project_id` 的自动定位彻底失效，每个 Agent 每次调用都必须显式带项目（昨天实测多项目即报错）；
2. 中文名/显示名无处可挂，UI 只能列一堆 `d-Work-Folder-...`；
3. 同一条知识散在多个临时项目里，19.4「共享域」被切碎，去重（`memories.ts:262` 按项目查重）还会各存一份。

**结论：最好 = 阶段式 + 极少数语义项目 + 显式白名单 + 默认兜底。**

- **阶段 0（现在就该采用）**：不启用分流，**继续单项目 `P1`**。单机单用户、42 个目录本质上是同一条任务流；19.4 的 `project_id` 是「跨 Agent 共享域锚」，不是目录标签。单项目能拿到自动定位、跨 Agent 共享最强、零维护、零迁移风险。
- **阶段 1（出现真实隔离需求才切）**：项目总数控制在 **2–4 个**，ID 用**语义化小写 slug**（如 `memdesk`），**禁 `P-` 前缀**（`classifyProject` 会判成 user 私有池，非 owner 不可见）；规则只做白名单，把本项目那条目录映射到 `memdesk`，其余 41 个临时目录一律落默认 `P1`；`unmapped=default`、`require_registered=true`（先 `create_project` 登记）、`hold` 不开；历史 3762 条不动，`P1` 自然变成「历史 + 未分类」。
- **触发隔离的真正条件**：不同客户/保密域、不同令牌 `scope_project_ids`、需要独立遗忘策略；**不是**「我有多个工作区目录」。

#### 可直接落盘的 `project-routing.json`

阶段 0（等价于现状，零风险）：

```json
{
  "version": 1,
  "mode": "static",
  "default_project_id": "P1",
  "unmapped": "default",
  "require_registered": false,
  "rules": []
}
```

阶段 1（需要隔离时再切；`path_glob` 用真机真实目录名，空格是字面量）：

```json
{
  "version": 1,
  "mode": "by_workspace",
  "default_project_id": "P1",
  "unmapped": "default",
  "require_registered": true,
  "rules": [
    {
      "id": "r-memdesk",
      "source": "workbuddy-projects",
      "path_glob": "*Deepseek Harness-*/**",
      "project_id": "memdesk",
      "enabled": true,
      "note": "MultiAgent Memory 本体与本项目会话"
    }
  ]
}
```

#### 反模式（明确禁止）
一目录一项目 / 自动派生 ID / 把目录名直接当 `project_id`（含空格、中文，且 §4.3 只收 `[A-Za-z0-9_-]`）/ 用 `P-` 前缀自定义项目 / 给 `P1` 改名或迁移历史（3762 条 + 全部审计口径，收益为零）/ 改写历史 `project_id`（`l0vault.ts:598` 的 L0 scope 校验会拒）/ 把原始 JSON 贴到 UI（人话铁律）。

#### 方案补丁（写进 T4）
`mcpRecall.ts:69-73` 的 `ProjectInfo` 只有 `project_id / memories / last_activity`，**不含 `display_name`**；真机注册表里 `P-shared` 的 `display_name` 也是空。→ 即使 `create_project` 登记了中文名，`list_projects` 也返回不了，UI 仍只能显示 ID。**T4 须给 `ProjectInfo` 增 `display_name?: string`（从注册表合并），并让 `projectLabels.ts` 兜底中文名**，否则「中文名可配」是空承诺。

### 3.3 不配置时的最小形态（回答「参数能不能删」）

**歧义澄清**：§3.2 的「阶段 0 保持单项目 `P1`」= **本方案 T1–T5 全部不实施**，不是「只做一半」。

**可以删：本方案新增的整个配置层。**
- 不新增 `project-routing.json`、`projectRouting.ts`、IPC 通道、配置卡片、`resolved_from` / `rule_id` 审计字段；
- `main.ts:3278` 保持 `project_id: 'P1'`，`sessionCollector.ts:1064/1074/1089` 三处 `?? 'P1'` 保持；
- 唯一值得做的**零风险整理**：把散落三处的字面量收敛到 `DEFAULT_PROJECT_ID` 单点常量（纯重构，不改行为、不碰任何契约、不需要打包闭环，但仍须过三道闸门）。

**不能删：`project_id` 参数与数据字段**（09:30 源码现查）。

| 层 | 硬证据 | 删了坏什么 |
|---|---|---|
| 数据模型 | `types.ts:75` `RecallReq.project_id: string; // 必填（19.4 跨 Agent 共享锚）`；`Memory` 记录同带 | 19.4 共享域锚消失，跨 Agent 共享无从定义 |
| 内核读写 | `agent.ts:105/183`（召回 + 会话视图按项目过滤）、`memories.ts:262`（同项目查重）、`:364/414`（Memory + 向量元数据）、`:237/435`（审计归因） | 召回/去重/精炼/审计全部失去隔离维度 |
| 权限 | `mcpAuth.ts:66` `projectInScope` 及其 6+ 调用点（`mcpRecall.ts:214/306/314`、`mcpReadTools.ts:94/96/155`、`mcpManageTools.ts:66`、`mcpHttp.ts:338`、`mcp.ts:207`） | 三池可见性（shared/user/archive/general）整体失效 |
| L0 授权 | `l0vault.ts:598` `scope_project_ids.includes(req.project_id)` | 原文查阅的授权 scope 无从校验 |
| MCP 契约 | `mcpSchema.ts:112` `required:['content','project_id']`、`mcpHttp.ts:336`、`mcp.ts:203` 双传输、`需求规格书.md:3628`（19.5 写调用必带） | 外部 Agent 接入直接崩；`agentOnboard/service.ts:448-449` 配方与 `validators.ts:23-34`（R2）都依赖它 |
| 测试锁 | `mcp.test.ts:94`、`types.test.ts:36`、`webhook.test.ts:221`、`mcpGcTools.test.ts:147`、`mcpHttp.test.ts:1120`、`WriteForm/WritePage/logic` 三处 UI 断言 | 至少 10+ 用例立刻红，不是「顺手改改」 |

**「隐藏」≠「删除」**：`recall_memory` 的 `project_id` 本来就可省略（`mcpRecall.ts:107` 单项目自动定位），已对用户隐形；`write_memory` 必填是**刻意设计**——写入不能猜归属，且要防跨租户 / 跨池误写。若为了减少认知负担，正确做法是在接入配方 / 客户端侧把 `P1` 固定注入、UI 不展示英文字段名（人话铁律），**底层字段与参数一律保留**。把 `write_memory.project_id` 改成「单项目时自动补 P1」看似能省参数，实则在多项目场景会静默写错库并破坏 R2，不做。

**一句话**：不配置 = 方案零实施（最多一次常量收敛），不是删参数；参数/字段是内核契约，删了要连隔离、权限、L0 授权、跨 Agent 接入一起重写。

### 3.4 配置的意义 / `list_projects` 存废（2026-11-15 09:38 现查收口）

**结论三句**
- **配置层（T1–T5）**：阶段 0 零实施，用户「不用设置」成立。
- **`project_id` 参数/字段**：内核契约，不能删（§3.3 已列硬证据）。
- **`list_projects` MCP 工具**：**不能取消**。它不是「配置项」，是只读查询工具 + 多项目报错的唯一逃生出口 + 严格首步门禁测试探针。**「不用配置」≠「删工具」**，这是本轮需纠正的混淆。

**现查真机证据（09:38，非沿用旧结论）**

| 项 | 当下值 |
|---|---|
| 账本 `memories.db.json` | 3774 条：`P1` 3769 / `P-shared` 4 / `P_SYSTEM` 1；注册表仅 `P-shared`（`display_name` 空） |
| `list_projects` 真实返回 | `total=2`：`P1` 3765、`P-shared` 1（`P_SYSTEM` 与 3 条 `merged_into` 被 `projectInfosFromMemories` 过滤） |
| `tools/list` | 12 个工具，`list_projects` 排第 3 |
| 未召回直调 `list_projects` | 被严格首步门禁硬拦：`⛔ 本会话尚未调用 recall_memory…所有工具均已锁定` |

→ **「值都是 P1」在真机不成立**：`ensureSharedProject`（`main.ts:3070`）启动恒建 `P-shared`，故 `resolveProjectId` 的「唯一项目自动定位」分支**永不触发**，省略 `project_id` 必然落到多项目报错分支。`project_id` 仍是生效的区分维度（shared 池对任意令牌恒可见，general 池受 `scope_project_ids` 约束）。

**不能取消 `list_projects` 的 5 条硬理由**
1. **报错文案唯一逃生出口**：`mcpRecall.ts:109/114` 写死「调用 list_projects 后显式传入 project_id」；`mcpSchema.ts:83/102` 两处 description 同样指向它。删工具 = 把 Agent 引向不存在的工具，而该报错在真机是**常态**不是边缘。
2. **三池可见性唯一对外观测口**：`runListProjectsTool` 合并注册表项目 + 记忆反推隐式项目并应用 `projectInScope`；`mcpScope.test.ts` / `mcpThreePool.test.ts` 用它验证受限令牌只见 scope 内项目，`create_project` / `mint_token` 的效果也靠它验收。
3. **12 工具清单精确锁**：`mcpHttp.test.ts:82-86`、`mcp.test.ts:69` 用 `toEqual` 锁定工具名与顺序，删 1 个立刻红 2 处。
4. **严格首步召回门禁探针**：`recallGateStrict.test.ts` 14 处以它为「非 recall 工具」代表，验证硬拦 / 默认关闭只软提醒 / 会话头缺失不误杀 / gate off 等；真机 09:38 已实测硬拦生效。删了整张门禁测试矩阵失去探针。
5. **引用面 40+ 处**：`mcpHttp.test.ts` 13 / `mcp.test.ts` 3 / `mcpScope.test.ts` 3 / `mcpReadTools.test.ts` 1 / `mcpSchema.ts` 5（instructions §1§4§9 + 两处 description）/ `mcpRecall.ts` 3，另有双传输 case `mcp.ts:195`、`mcpHttp.ts:331`，以及 `coreMemoryOps.ts:366`、`kernelProjects.ts:1` 的同口径注释。不是「顺手删一个工具」，是跨十几个文件的重构。

**正确做法**：在客户端接入配方 / 注入层把 `P1` **固定注入**（零配置、用户不感知），`list_projects` 保留但不主动调用。工具零改动、契约零风险。

**可选后续（需单独拍板，非本轮实施）**：让 `resolveProjectId` 把 `P-shared` 这类「恒可见系统池项目」从「需用户确认的多项目」中排除，只在出现第二个 general 业务项目时才报错。属内核语义改动，须过三道闸门 A/B/C + 打包 + 用户实测 + 确认。

**本轮边界**：纯核实与解释，**零源码改动**；工作树存在 M5 在途改动（含 `specs/code-index.generated.md` 已修改），故不重建索引、不打包、不提交。

---

## 4. 数据模型与配置持久化

### 4.1 接口（新增 `src/core/memagent/projectRouting.ts`）

```ts
export const PROJECT_ROUTING_FILE = 'project-routing.json';
export const PROJECT_ROUTING_VERSION = 1;

export interface ProjectRoutingRule {
  id: string;                    // 稳定短 id，写进审计便于回查
  source: string;                // 采集源名，如 'workbuddy-projects'
  path_glob: string;             // 相对路径匹配（仅 * / ** / 字面量，不引第三方 glob）
  project_id: string;
  enabled: boolean;
  note?: string;                 // 中文说明，供 UI 显示
}
export interface ProjectRoutingConfig {
  version: 1;
  mode: 'static' | 'by_workspace';
  default_project_id: string;    // 缺省 'P1'
  unmapped: 'default' | 'hold';  // 一期实现 default
  require_registered: boolean;   // 缺省 false，保持现状允许隐式项目
  rules: ProjectRoutingRule[];   // 有序，首个命中生效
}
export interface ProjectResolution {
  project_id: string;
  resolved_from: 'explicit' | 'mapping' | 'default';
  rule_id?: string;
  reason?: string;               // 仅用于中文提示/审计，不含原始 JSON
}
export function normalizeProjectRouting(raw: unknown): ProjectRoutingConfig;
export function resolveProjectForItem(
  item: { key: string; agent: string; explicit_project_id?: string },
  cfg: ProjectRoutingConfig,
): ProjectResolution;
```

### 4.2 落盘（复用 `llmGateway.ts:152-163` 模式）
- 文件：`%APPDATA%/MultiAgent Memory/project-routing.json`，与 `llm-config.json` 同目录。
- `loadProjectRouting(dir)`：`try/catch` → 坏文件/缺失一律 `defaultProjectRouting()`（**不猜测性迁移**，同 `paramsSnapshot.ts:171-175` 口径）。
- `saveProjectRouting(dir, cfg)`：`normalize` 后 `writeFileSync(..., JSON.stringify(cfg, null, 2))`。
- `dataRoot.ts:24-44` 的 `DATA_ROOT_FILES` 白名单追加该文件名（随数据根迁移 + 纳入备份）。

### 4.3 归一化校验（必须硬拦）
`version` 非 1 → 回默认；`mode` 非法 → `static`；`default_project_id` 空/超 64 字符 → `'P1'`；`rules` 非数组 → `[]`；逐条校验 `project_id`：
- 非空、≤64、只允许 `[A-Za-z0-9_-]`；
- **禁止 `P-` 前缀**（`classifyProject` 会把 `P-<x>` 判为 user 私有池）、禁止 `P_SYSTEM`；
- `P-shared`/`P-archive` 只允许显式且需 `isAdmin` 账户（主进程采集账户为引导账户，可放行但写审计）。
命中非法规则 → **丢弃该规则并落 `actions.log` 告警**，不让它影响写入。

---

## 5. 解析算法（纯函数，无 IO）

```
resolveProjectForItem(item, cfg):
  1. explicit_project_id 非空 → { project_id, resolved_from:'explicit' }
  2. cfg.mode === 'static'    → { default_project_id, 'default' }
  3. 拆 key：source = item.agent；rel = key 去掉 "<agent>:" 前缀
     workspace = rel 的第一段路径（不含文件名）；路径分隔符统一 '/'
  4. 顺序遍历 cfg.rules（enabled 且 source 相等且 glob 命中 rel/workspace）
     → 首个命中 { rule.project_id, 'mapping', rule_id }
  5. 未命中 → unmapped='default' ? { default_project_id, 'default' } : { hold 信号 }
  6. 所有出口：project_id 必须已通过 §4.3 校验；调用方再过 projectInScope
```

**不变式**：解析器只依赖 `item.key` + `item.agent` + 配置，同一 key 恒得同一结果 → 直接满足 AC-3（会话视图 `agent.ts:105` 按 project_id 过滤，不会被拆散）。

---

## 6. 逐文件改造清单

| 文件 | 现状行 | 改动 | 影响 |
|---|---|---|---|
| `src/core/memagent/projectRouting.ts` | 新增 | 类型 + 归一化 + 解析纯函数 + 默认配置 | 无副作用，可纯单测 |
| `src/core/memagent/sessionCollector.ts` | `CollectedItem:408`、`applyScanToStore:1051-1099` | `CollectedItem` 增 `project_id?: string`；三处 `opts.project_id ?? 'P1'` 改为逐条 `resolveProjectForItem(item, cfg)`；`CollectorBridgeOpts` 增 `resolve` 回调（保持内核不依赖配置文件） | 审计 `detail` 增 `resolved_from` / `rule_id` |
| `src/electron/main.ts` | `3180`、`3255-3279` | drain 回调与 onScan 两处都注入同一个 `resolve`；配置在 bootstrap 载入一次并随 IPC 更新热替换 | **daemon 不用改**：pending 分片已含 `key`，解析发生在桌面端单写者侧 |
| `src/electron/projectRoutingIpc.ts` | 新增 | `load/save` + 两通道，读走 `requireSession`、写走 `requireAdmin`（照抄 `main.ts:1112-1122`） | 新增通道需登记 `ipcChannels.ts` + `preload.ts` |
| `src/electron/ipcChannels.ts` / `preload.ts` | — | 增 `projectRoutingGet/Set` 通道与桥方法 | 白名单 |
| `src/electron/dataRoot.ts` | `24-44` | `DATA_ROOT_FILES` 追加文件名 | 备份/迁移 |
| `src/web/shared/projectLabels.ts` | 新增 | 项目路由所有中文名唯一来源（模式、未命中策略、来源、解析方式、原因） | UI 铁律 |
| `src/web/.../ProjectRoutingCard.tsx` + 宿主页 | 新增组件 | 严格对齐 `design/ui/净化生长与大模型_原型.html` 的「配置卡片 + 保存配置 + 回执」结构；项目下拉复用 `design/ui/检索页_原型.html` / `QueryBar.tsx:93-100` | **不新增页面**；表单字段，不贴 JSON 文本框 |
| `specs/code-map.md` / `meta/index.md` | — | 补本方案台账与索引指针 | 文档 |
| `src/core/memagent/__tests__/projectRouting.test.ts` 等 | 新增 | 见 §9 | 测试源码保留 |

**明确不改**：`mcpSchema.ts`（12 工具）、`mcpRecall.ts`、`mcpAuth.ts`、`memories.ts`、`agent.ts`、`collectDaemon.ts`。

---

## 7. 可观测（遵守「整页人话」）

- 每条采集写入审计 `detail` 增：`project_resolved_from`（中文名由 `projectLabels.ts` 提供）、`project_rule_id`（稳定短 id）；
- 每批结束 `actions.log` 一条 `collector:project-routing`，只记「各项目条数 + 命中规则数 + 回落条数」，**不记原始 JSON / payload**；
- 回查统一用「审计 ID + 时间」，不提供「展开原文」入口；
- 检索结果行已标来源项目（`retrieval/types.ts:30`），无需改。

---

## 8. 兼容 / 迁移 / L0 硬风险

1. **历史数据零改动**（AC-4 / D3）：`memories.db.json` 3765 条 P1 保持原样。
2. **L0 授权是真风险**：`l0vault.ts:592-599` 的 `decrypt` 虽不把 `project_id` 编进密文，但会校验 L0 会话 `scope_project_ids` 是否含该 `project_id`；`memories.ts:591` 的解密请求同样带它。→ 若把历史条目改成新项目，非 `'*'` 授权的用户会 `E_L0_NO_GRANT`。**因此 T5 只做 `dry_run=true` 的只读盘点报告，禁止改写 `project_id`**；若要迁移，须先扩 L0 授权并单独立项。
3. **去重语义变化**：`memories.ts:262` 查重只扫 `listMemories({ project_id })`。分流后同一内容在不同项目会各存一条——这是 19.4 项目隔离的预期结果，必须用测试钉住；如要全局去重，另立 `dedup_scope` 二期项，**不在本方案**。
4. **L0 写锁**：重启后默认 `write_unlocked:false`（§0.2），新项目写入会诚实进 pending，属预期安全行为，UI 需提示解锁而非报缺陷。
5. **配置热更新**：解析纯函数无状态，配置对象在 IPC 保存后整体替换引用即可，不需要重启；但**正在执行的一批**用批次开始时的快照，避免半批换规则。

---

## 9. 测试矩阵

| 层 | 用例（名称即断言） |
|---|---|
| 单元 | `缺省配置 → 恒 P1 且 resolved_from=default`；`显式优先于规则`；`首个命中生效`；`规则 disabled 跳过`；`中文/空格路径 glob`；`非法 project_id 被丢弃并告警`；`P- 前缀规则被拒`；`坏配置文件回默认`；`同一 key 幂等` |
| 集成 | `applyScanToStore` 两项目分流后审计字段真变；`drainCollectPending` 与 onScan 结果一致；`projectInScope` 越界拒绝 |
| E2E | 真构建产物 + 真后端：配置 `by_workspace` → 采一条会话 → `list_projects` 出现新项目 → 检索页「全部项目」两条都在；反向断言：未改配置时跑同样流程，账本与审计与基线一致 |
| **C1 变异** | 把解析器里 `mode === 'static'` 短路改成「总是走规则」→ AC-1 用例必须红；把「首个命中」改成「最后一个命中」→ 规则顺序用例必须红；把 `P-` 前缀校验删掉 → 非法规则用例必须红。还原后 `git diff` 为空 + 全绿 |
| **C2 变异** | 空账本 / 单项目 / 多项目 / 规则指向不存在项目 / 配置损坏 / `scope='session'` 跨项目不串 / 受限令牌越界 / 历史 P1 行无新字段 → 明确拒绝或诚实空态 |

---

## 10. 原子任务拆分（每个 = 一次三道闸门 + 展示等确认）

| 任务 | 内容 | 关键闸门 |
|---|---|---|
| **T0** | 本方案文档 + 待拍板项确认（**当前所处阶段**） | C3 文档反向核对；不重建索引（在途改动） |
| T1 | `projectRouting.ts` 纯函数 + 归一化 + 全量单测（**不接任何写入入口**） | A：零调用点；B：解析矩阵全绿；C1/C2 如上 |
| T2 | 配置落盘 + IPC 门禁 + `dataRoot.ts` 白名单 | A：备份/迁移回归；B：保存后重载真变、越权被拒；C1：删 `requireAdmin` 必须红 |
| T3 | 采集两链路接入（onScan + daemon drain） | A：既有 P1 路径逐字段未变；B：两条链路分流一致；C1：改回硬编码 P1 必须红 |
| T4 | 审计/可观测 + UI 卡片（对齐原型） | A：UI 回归；B：审计字段真落、页面无英文/JSON；C1：去掉 `resolved_from` 必须红 |
| T5 | 只读迁移盘点 `dry_run=true` | B3 反向断言库与审计**零变更**；C1：去掉 dry_run 短路必须红 |
| T6 | 索引重建 + 全门禁 + 打包闭环 + 用户实测 + 确认 + 提交 | §0.2 五步；提交前展示改动清单 + 门禁输出 + 拟用信息 |

每个任务收尾按 `specs/开发纪律_三道闸门.md` §4 给出 **A / B / C 三栏证据**（命令 + 实测数字 + 用例名），写入提交信息与 `code-map.md`。

---

## 11. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 规则写错导致新写入落错项目 | §4.3 硬校验 + 每批 `actions.log` 计数 + 审计 `rule_id` 可回查 | 配置切回 `static` 即恢复 P1；已写入条目不自动回滚 |
| 覆盖在途改动 | 逐文件 `git diff` 复核，禁 `git add .` | `git checkout -- <单文件>`（仅本方案新增/改动文件） |
| 索引与文档集合不一致 | T0 不动索引；T6 在在途改动收口后统一 `npm run code:index -- --write` + `code:index:check` | — |
| 打包后旧进程跑旧口径 | §0.2 五步闭环 | 关端重打包 |

---

## 12. 交付闭环与提交纪律

- T1–T5 属源码改动 → 每次按 §0.2「关旧端 → 重打包 → 验产物 → 启新端 → 核运行态」；`CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package`，随后 `git diff -- package.json` 必须为空。
- **停 · 等用户实测产物 → 停 · 等用户明确确认 → 才 commit/push**；门禁全绿不构成自动提交理由。
- 提交前展示：改动清单 + 门禁输出 + 拟用 conventional commit（`Co-Authored-By: CodeBuddy Code`）；在途改动单列，禁止带入。
- 收尾按 §0.1「跑验 → 扫 → 清 → 核 → 报」清临时物。

---

## 13. 待用户拍板（开工前）

1. §3.1 的 P1–P5 五个选择；
2. 是否接受「不迁移历史 P1、只做只读盘点」；
3. UI 卡片宿主页确认（涉及原型对齐，须显式批准偏离）；
4. 在途 M5 改动何时收口（决定 T6 索引重建时机）。

> **本轮交付到此为止**：只产出方案，零源码改动、未重建索引、未打包、未提交。

---

## 附录 A · 现状取证命令（可复现）

```bash
git status --short
# 真机账本项目分布（PowerShell）
$j = Get-Content "$env:APPDATA/MultiAgent Memory/memories.db.json" -Raw | ConvertFrom-Json
@($j.memories.PSObject.Properties | ForEach-Object { $_.Value }) | Group-Object project_id
# 注册表
$j.projects.PSObject.Properties | ForEach-Object { $_.Name }
# 采集写入审计
Get-Content "$env:APPDATA/MultiAgent Memory/audit.jsonl" | Select-String '"source":"collector"' | Select-Object -Last 5
```
