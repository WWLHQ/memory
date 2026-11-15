# project_id 零配置 · 详细实施方案

> 状态：**可执行方案，待拍板后开工**（本轮未改任何源码）
> 时间：2026-11-15 10:04（所有行号 / 数字均为该时刻现查所得；实施时以符号名为准，行号会漂移）
> 纪律真源：`AGENTS.md` §0 / §0.1 / §0.2、`specs/开发纪律_三道闸门.md`、`specs/需求规格书.md` §19.4 / §19.5
> 上位结论：[`project_id配置化_工程化落地方案.md`](project_id配置化_工程化落地方案.md) §3.2 / §3.3 / §3.4
> 本文件取代上位方案的 T1–T6 作为**当前执行真源**；上位方案保留为「阶段 1 真需项目隔离时」的备选设计。

---

## 0. 目标与边界（一句话）

**目标**：让用户和接入 Agent 都不必设置、也不必被询问 `project_id`，首步召回链路在严格门禁下不再出现「必然两次失败 + 打扰用户」；同时 `project_id` 字段、12 个 MCP 工具、`list_projects`、三池权限、L0 授权、历史 3769 条 `P1` 数据**全部不动**。

**非目标**：不新增配置文件 / 解析器 / IPC / UI 卡片；不删参数；不取消 `list_projects`；不迁移历史；不改 `projectInScope`、`l0vault`、`memories.ts`、`types.ts`。

**本轮交付**：本方案文档 + 现查基线。源码零改动、不重建索引、不打包、不提交。

---

## 1. 现查基线（10:04，非沿用旧结论）

| 项 | 当下实测值 |
|---|---|
| 账本 `memories.db.json` | 3774 条：`P1` 3769 / `P-shared` 4 / `P_SYSTEM` 1；注册表仅 `P-shared`（`display_name` 空） |
| `list_projects` 真实返回 | `total=2`：`P1` 3765、`P-shared` 1（`P_SYSTEM` 与 3 条 `merged_into` 被 `projectInfosFromMemories` 过滤） |
| `tools/list` | 12 个工具，`list_projects` 排第 3 |
| 真机运行态 | `MultiAgent Memory` 进程在；8200–8204 全部 LISTENING |
| 严格首步门禁 | **已开启**：未召回直调 `list_projects` 返回 `⛔ 本会话尚未调用 recall_memory…所有工具均已锁定`；先 `recall_memory` 后同会话调 `list_projects` 成功 |
| 工作树 | M5 在途 28 个 `M` + 23 个 `??`；**`mcpSchema.ts` / `main.ts` / `types.ts` / `code-index.generated.md` 均在途** |
| 客户端配置 | `~/.workbuddy/mcp.json` 仅 `type` / `url` / `headers`（`Authorization`、`X-Memagent-Client`），**无工具参数默认值字段** |

---

## 2. 现查发现的三个缺陷（本方案要解决的真问题）

### D1 · 指令与严格门禁互相打架（真机可复现的两轮失败，非死锁）

`mcpSchema.ts:65` `MCP_INSTRUCTIONS` 第 1 条写：

> `project_id 可省略：账本只有一个项目时自动定位；有多个项目时先调用 list_projects 并向用户确认。`

第 4 条（`:68`）写「写入前如不确定项目，先 `list_projects`」。而真机恒有 2 个项目 → 省略 `project_id` 必然命中 `mcpRecall.ts:112-114` 的多项目报错，文案又指向 `list_projects`。但严格门禁下 `mcpHttp.ts:510-519` 规定：**本会话未调用过 `recall_memory` 时，所有非 recall 工具（含 `list_projects`）一律硬拦**。

→ 精确链路（**不是死锁**，`mcpHttp.ts:509-523` 明确 `recall_memory` 自身永远放行以解锁）：Agent 依 §1 先调 `list_projects` → 被硬拦（第 1 次失败）；改调 `recall_memory` 不带 `project_id` → 多项目报错（第 2 次失败），但会话此时已标记「已召回」；报错文案再引导 `list_projects` → 这次才调得通 → 列出 `P1`、`P-shared` → 依 §1 还得「向用户确认」。**两次必然失败 + 一次打扰用户**，且用户看到的是一个自己从没建过的 `P-shared`。这才是「感觉还得设置一下」的根因：**链路与指令问题，不是配置项问题**。

### D2 · 接入配方把项目 ID 写成小写（真 bug）

`src/agentOnboard/service.ts:448-449`：

```ts
recall_memory: { project_id: 'p1', scene: 'default', mode: null }, // R2 带 project_id
write_memory: { project_id: 'p1' },
```

真机账本是大写 `P1`（`project_id` 区分大小写，`classifyProject` 与 `listMemories({project_id})` 均按原值匹配）。按该配方接入的 Agent 会写入 / 召回一个**根本不存在的 `p1` 项目**，静默分库或 0 命中。

**现查口径修正（ripgrep 精确统计，勿按旧稿估计动手）**：全仓 `'p1'` 字面量共 **687 处**，但其中**绝大多数是测试夹具里的占位项目 ID / 优先级 badge（`'p0'|'p1'|'p2'|'p3'`），与本缺陷无关，一律不改**。真正的「配方默认下发点」只有 **4 行、2 个文件**：

| 文件 | 行 | 内容 |
|---|---|---|
| `src/agentOnboard/service.ts` | 448 / 449 | 一键接入生成卡片的 `mcpTools` 默认值 |
| `src/web/AgentOnboard/useBackendMirror.ts` | 55 / 56 | UI 卡片 → 服务层入参的镜像映射 |

需要同步的**配方断言仅 1 处**：`src/agentOnboard/__tests__/e2e.test.ts:82`（`assert.equal(c.mcpTools!.recall_memory!.project_id, 'p1')`）。其余 `agentOnboard/__tests__` 里的 `'p1'` 是「构造卡片时的输入值」，R2 只校验非空、不校验大小写，改或不改都不影响门禁；**按最小改动原则保持原样**，仅在代码注释里说明「此处 p1 是夹具占位，非真机项目」。另 `design/ui/Agent接入页_原型.html:136/153` 的 `badge:"p1"` 是优先级徽标 `MVP·P1`，与 `project_id` 无关，**禁止误改**（UI 铁律：严格对齐原型）。

### D3 · 上一轮结论修正：MCP 客户端配置不支持工具参数默认值

上一轮我给的做法是「在客户端接入配方 / 注入层把 `P1` 固定注入，用户零配置」。**现查证实该路径在当前架构下不可直接落地**：`mcp.json` 只有 `type` / `url` / `headers`，标准 MCP 配置没有 per-tool 默认 arguments；全仓 Grep 无 `default_project` / `toolDefaults` / 自定义 project header 的读取逻辑（`mcpHttp.ts` 只认 `Authorization`、`X-Memagent-Client`、`X-Memagent-Render`、`Mcp-Session-Id`、strict-gate 头）。

→ 「固定注入」只能落在**服务端**：要么改指令文案让 Agent 显式带 `P1`，要么改内核让省略参数自动定位。两者都不是「配置文件里加一行」。**这条须主动纠正上一轮口径。**

---

## 3. 方案选型（推荐 B）

| 路径 | 做法 | 能否「不用设置」 | 改动面 | 风险 | 结论 |
|---|---|---|---|---|---|
| **A** | 只改 `MCP_INSTRUCTIONS` / 工具 description 文案，要求 Agent 一律显式传 `P1`，并说明门禁顺序 | 部分（用户不问了，但 Agent 每次仍要带参数） | 1 个在途文件 + 2 处 description | 低；依赖 Agent 遵守指令 | 保底，可与 B 同做 |
| **B（推荐）** | 内核 `resolveProjectId` 增加「恒可见系统池项目不参与自动定位」；`P-shared` / `P-archive` 不算「需要用户选择」的业务项目 | **能**（省略 `project_id` 自动定位唯一业务项目 `P1`） | 1 个纯函数 + 2 处调用点 + 指令文案 + 测试 | 中（语义改动，须三道闸门 + 打包实测） | **采纳需拍板 B1** |
| **C** | 新增默认项目配置 / 自定义 header 注入 | 能 | 新增配置层 + 双传输解析 + 备份白名单 | 高，且与「不配置」目标自相矛盾 | **否决** |

**为什么 B 不破坏既有测试**：`mcpHttp.test.ts:445` 的多项目报错用例用的是 `P1` + `P2`（两个 general 业务项目），仍会报错；`mcp.test.ts:319`、`mcpHttp.test.ts:281`、`mcpReadTools.test.ts:66` 的 `resolved_from='single_project'` 断言仍是单业务项目，仍绿。只有「`P1` + `P-shared`」这一种组合从报错变为自动定位。

**为什么只排除 shared / archive，不排除 user 池**：`P-<user>` 是用户私有业务项目，有真实归属语义，必须计入候选；`P-shared` 由 `ensureSharedProject`（`main.ts:3070`）启动自动建、`P-archive` 仅 admin 可见，都不是用户业务项目。另注：`runRecallTool`（`mcpRecall.ts:211`）的 `infos` 来自**全量账本**、未按令牌过滤，非 admin 令牌会看到自己无权访问的 `P-archive` 并被算进「多项目」——排除 archive 顺带修掉这个既有不合理。

---

## 4. 验收 AC（可测）

| AC | 判据 |
|---|---|
| AC-1 | 真机 `recall_memory` 不带 `project_id` → `isError=false`，`resolved_from='single_project'`，`project_id='P1'` |
| AC-2 | 严格门禁开启的新会话：首步 `recall_memory`（不带 `project_id`）一次成功；后续 `list_projects` 不被拦；全程无失败调用、无需询问用户 |
| AC-3 | `list_projects` 仍如实返回 2 个项目（`P1` + `P-shared`），不因自动定位逻辑而少列 |
| AC-4 | 两个 general 业务项目（`P1`+`P2`）时省略 `project_id` **仍报错**且文案仍引导 `list_projects` |
| AC-5 | `write_memory.project_id` 仍必填；12 工具清单与顺序逐字不变；`projectInScope` 越界仍拒绝 |
| AC-6 | 接入配方下发的 `project_id` 与真机账本一致（统一为 `P1`），R2 校验仍通过 |
| AC-7 | HTTP 8204 与 TCP 8202 两条传输行为一致 |
| AC-8 | 账本 / 审计 / L0 授权零变更（历史 3769 条 `P1` 一条不动） |
| AC-9 | 指令文案与门禁顺序一致，不再出现「先 list_projects」与「未召回硬拦」冲突 |

---

## 5. 逐文件改造清单（路径 B，精确到符号）

### 5.1 `src/core/memagent/mcpRecall.ts` — 内核语义（核心）

新增两个纯函数（无 IO，可纯单测）。`mcpRecall.ts:5` **已经**从 `./mcpAuth.ts` import 了 `projectInScope`，只需在同一条 import 语句追加 `classifyProject`，**不新增 import 行**（避免重复导入被 oxlint 判 warning）：

```ts
// mcpRecall.ts:5 现状：
// import { projectInScope, DEFAULT_MCP_ACCOUNT, type McpAccount } from './mcpAuth.ts';
// 改为：
// import { projectInScope, classifyProject, DEFAULT_MCP_ACCOUNT, type McpAccount } from './mcpAuth.ts';

/** 恒可见 / 管理类系统池项目：由服务端自动建立，不是用户业务项目。
 *  list_projects 仍如实列出；只在「省略 project_id 的自动定位」时不计入候选。 */
export function isSystemPoolProject(projectId: string): boolean {
  const pool = classifyProject(projectId);
  return pool === 'shared' || pool === 'archive';
}

export function autoLocatableProjects(infos: ProjectInfo[]): ProjectInfo[] {
  return infos.filter((p) => !isSystemPoolProject(p.project_id));
}
```

`resolveProjectId`（现 `:100-116`）增加**第三个可选参数，缺省 `{}` 保证旧调用逐字不变**：

```ts
export function resolveProjectId(
  infos: ProjectInfo[],
  explicit: unknown,
  opts: { excludeSystemPools?: boolean } = {},
): ResolvedProject {
  // 显式 project_id / 类型校验两段保持原样不动
  const candidates = opts.excludeSystemPools ? autoLocatableProjects(infos) : infos;
  if (candidates.length === 1) return { project_id: candidates[0].project_id, resolved_from: 'single_project' };
  if (candidates.length === 0) {
    // 区分「账本真的空」与「只有系统池项目」；后者明确提示显式传项目，不猜
    throw new McpToolError(infos.length === 0
      ? '未提供 project_id，且账本暂无记忆：请先写入一条记忆，或显式传入 project_id（可调用 list_projects 查看）'
      : '未提供 project_id，且账本仅有系统共享池项目：请显式传入业务项目 ID（可调用 list_projects 查看）');
  }
  const preview = candidates.slice(0, 5).map((p) => p.project_id).join('、');
  throw new McpToolError(
    `未提供 project_id，且账本有 ${candidates.length} 个业务项目：${preview}。`
    + '请先询问用户，或调用 list_projects 后显式传入 project_id（严格门禁下须先完成首步 recall_memory）。',
  );
}
```

调用点（2 处，均显式开启）：

```ts
// mcpRecall.ts:212  runRecallTool
const project = resolveProjectId(infos, args.project_id, { excludeSystemPools: true });
// mcpReadTools.ts:95  runListMemoriesTool（建议同步，单列 AC 与测试）
const { project_id, resolved_from } = resolveProjectId(infos, args.project_id, { excludeSystemPools: true });
```

`runListProjectsTool`（`:291-327`）**一字不改** → 满足 AC-3。

### 5.2 `src/core/memagent/mcpSchema.ts` — 指令文案（**在途文件，须逐行合并**）

该文件当前有 1 行 M5 在途新增（`:169` 附近 `recall_id` 字段）。改造只能按精确字符串定点替换，**禁止整文件重写 / `git checkout --` 覆盖在途改动**。

- `MCP_INSTRUCTIONS` 第 1 条（`:65`）：把「账本只有一个项目时自动定位；有多个项目时先调用 list_projects 并向用户确认」改为「本机默认业务项目为 `P1`，系统共享池项目不参与自动定位；确有多个业务项目时才需 `list_projects` 并向用户确认。**严格首步门禁下必须先调用 `recall_memory`，再调用包括 `list_projects` 在内的其它工具**」。
- 第 4 条（`:68`）：「写入前如不确定项目，先 `list_projects`」→「写入前如不确定项目，可在首步召回后调用 `list_projects`；`write_memory.project_id` 必填，本机固定 `P1`」。
- `recall_memory.project_id` description（`:83`）、`write_memory.project_id` description（`:102`）：补「本机默认 `P1`」。
- `MCP_TOOLS` 数量与顺序、`RECALL_FIRST_*` / `RECALL_GATE_STRICT_*` 五个常量、`withRecallFirstNotes()`、`mcpInstructions()` **全部不动**。

### 5.3 `src/agentOnboard/service.ts:448-449` — 修 D2

**只改 4 行**：`service.ts:448/449` 与 `useBackendMirror.ts:55/56` 的 `'p1'` → `'P1'`，并加注释标明真源是内核 `DEFAULT_PROJECT_ID`；同步改 `e2e.test.ts:82` 那一处断言。**不改**其余 683 处测试夹具占位值，不改 `design/ui/Agent接入页_原型.html` 的优先级 badge。`validators.ts:23-34`（R2 只校验非空）、`types/agentOnboard.ts:268-269` 逻辑不改。

> 分层约束：`agentOnboard` 属本机后端，`web/AgentOnboard` 属渲染层，两者都不得 import 渲染层 `web/shared/kernelProjects.ts`。统一常量收敛放到 T4，本任务只改字面量 + 注释。

### 5.4 明确不改

`mcpAuth.ts`、`memories.ts`、`l0vault.ts`、`agent.ts`、`types.ts`、`sessionCollector.ts`、`main.ts`（T4 前）、`collectDaemon.ts`、`mcpHttp.ts` / `mcp.ts` 的 `tools/call` 分发与 12 工具 case、`mcpSchema.ts` 的 12 项定义、`dataRoot.ts`。

---

## 6. 测试矩阵

| 层 | 用例（名称即断言） | 归属 |
|---|---|---|
| 单元 | `P1+P-shared → 自动定位 P1 且 resolved_from=single_project`；`P1+P2 两个 general → 仍报错且文案含 list_projects`；`仅系统池项目 → 明确提示显式传项目，不猜`；`空账本 → 原空态文案逐字不变`；`显式 project_id 优先于自动定位`；`P-<user> 私有池仍计入候选`；`非 admin 令牌不被 P-archive 干扰` | `mcpRecall.test.ts` / 新增 `projectAutoLocate.test.ts` |
| 集成 | HTTP 8204 不带 `project_id` 的 `tools/call recall_memory` → `isError=false`；TCP 8202 同口径；`list_projects` 仍返回 2 项；`write_memory` 缺 `project_id` 仍 `isError=true`；`projectInScope` 越界仍拒 | `mcpHttp.test.ts` / `mcp.test.ts` / `mcpReadTools.test.ts` / `mcpScope.test.ts` |
| 门禁 | 严格门禁开启：首步 recall 不带项目成功 → 随后 `list_projects` 成功；未召回直调 `list_projects` 仍硬拦；`recall_memory` 自身永远放行 | `recallGateStrict.test.ts`（现有 14 处探针全绿） |
| E2E | 真构建产物 + 真后端：新会话首步 `recall_memory` 不带项目即成功、零失败调用、零询问用户；配方下发项目 ID 与账本一致 | `e2e/` |
| **C1 变异** | ① `isSystemPoolProject` 改为恒 `false` → AC-1 用例必须红；② `opts.excludeSystemPools` 缺省改 `true` → 既有 `single_project` 及多项目报错用例必须红；③ 删掉 `projectInScope` 后置校验 → 越界用例必须红。三次均须「红灯 → 原样还原 → `git diff` 为空 → 全绿」 |
| **C2 矩阵** | 空账本 / 单业务项目 / 单业务+系统池 / 多业务项目 / 仅系统池 / 受限令牌 / `scope='session'` 组合 / 历史 `P1` 行无新字段 / 非法 `project_id` 类型 → 明确拒绝或诚实空态，绝不静默成功 |

**既有回归必须点名钉住**：`mcpHttp.test.ts:445`「多项目且未指定 project_id → isError 引导 list_projects」、`mcp.test.ts:319` / `mcpHttp.test.ts:281` / `mcpReadTools.test.ts:66` 的 `single_project`、`mcpHttp.test.ts:82-86` 与 `mcp.test.ts:69` 的 12 工具 `toEqual` 清单、`mcpThreePool.test.ts` 的 `ensureSharedProject` 幂等。

---

## 7. 原子任务拆分（每个 = 一次三道闸门 + 展示等确认）

| 任务 | 内容 | 改动文件 | 三道闸门要点 |
|---|---|---|---|
| **T0** | 本方案文档 + 现查基线 + 待拍板项确认（**当前**） | 本文档、`.workbuddy/memory/2026-11-15.md` | C3 纯文档：逐条与源码 / 命令输出反向核对 + 声明变异；**不重建索引** |
| **T1** | 内核 `isSystemPoolProject` / `autoLocatableProjects` / `resolveProjectId` 可选参数 + 纯单测，**暂不接调用点** | `mcpRecall.ts` + 新测试 | A：零调用点、既有 4 处 `single_project` 全绿；B：解析矩阵全绿；C1 变异 ①②③ |
| **T2** | 接通 `runRecallTool` / `runListMemoriesTool` 两处调用点 + HTTP/TCP 集成用例 | `mcpRecall.ts:212`、`mcpReadTools.ts:95` + 测试 | A：双传输 + 三池回归；B：AC-1/3/4/5/7 状态断言；C1：调用点漏传 `opts` 必须红 |
| **T3** | 指令文案去环 + 接入配方大小写（D1 + D2 合并为一个原子任务，因都动文案/配方且共享测试门禁） | `mcpSchema.ts`（在途，定点替换）、`service.ts` + `useBackendMirror.ts` 4 行 + `e2e.test.ts:82` | A：12 工具清单 / 门禁 14 处探针全绿；B：AC-2/6/9；C1：把文案改回「先 list_projects」→ 链路用例必须红 |
| **T4**（可选） | 常量收敛：4 处 `main.ts` + 3 处 `sessionCollector.ts` 的 `'P1'` → 单一真源 | `main.ts`（在途）、`sessionCollector.ts`、新增 `src/shared/defaultProject.ts` | A：采集 / 审计逐字段未变；B：写入仍是 `P1`；C1：常量改错 → 采集断言必须红。**纯重构，不碰契约** |
| **T5** | 全门禁 + 索引重建（须等 M5 收口）+ 打包闭环 + 用户实测 + 确认 + 提交 | `code-map.md` / `meta/index.md` / 索引 | §0.2 五步；提交前展示改动清单 + 门禁输出 + 拟用信息 |

每个任务收尾按 `specs/开发纪律_三道闸门.md` §4 给出 **A / B / C 三栏证据**（命令 + 实测数字 + 用例名），写入提交信息与成果说明，**等人工确认后**才进入下一任务。

---

## 8. 门禁命令（本机 PowerShell 执行策略禁脚本，统一用 `npm.cmd`）

```bash
npm.cmd run typecheck
npm.cmd run lint                    # oxlint：0 warnings / 0 errors
npm.cmd run test:gate               # 全量，记录文件数 / 用例数 / 失败数
npm.cmd run test -- src/core/memagent/__tests__/mcpHttp.test.ts src/core/memagent/__tests__/mcpRecall.test.ts
npm.cmd run check:no-demo
npm.cmd run code:index:check        # T0–T4 冻结期间只 check，不 --write
```

**索引冻结**：`specs/code-index.generated.md` 与 `meta/index.md` 均在 M5 在途，`npm run code:index -- --write` 会覆盖并行会话产物 → **T0–T4 一律不重建**，T5 待在途改动收口后统一执行 `--write` + `--check`。

---

## 9. 交付闭环（T2/T3/T4 属运行时源码改动，必须走 §0.2）

| 步 | 动作 | 判据 |
|---|---|---|
| 1 | 关旧端 | `MultiAgent Memory.exe` 进程数 0、8200–8204 无 LISTENING |
| 2 | 重打包 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm.cmd run package`；随后 `git diff -- package.json` 必须为空，非空则 `git checkout -- package.json` |
| 3 | 验产物 | 安装包 exe 非空 + SHA256；主进程代码在 `resources/app.asar.unpacked/dist-electron/main.cjs`，须与 `dist-electron/main.cjs` 逐字节一致且含本轮改动标记 |
| 4 | 启新端 | `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY "./MultiAgent Memory.exe"` |
| 5 | 核运行态 | `main.log` 有 `bootstrap:done` + 8202/8203/8204 LISTENING + `get_write_status`；**重启后 `write_unlocked:false` 属预期**，须在安全页重新解锁 |

**两道等待**：打包完成 → **停 · 等你实际测试产物** → **停 · 等你明确确认** → 才 `commit` / `push`。门禁全绿不构成自动提交理由。

提交前展示：改动清单 + 门禁输出 + 拟用 conventional commit（`type(scope): …` + Why/What + `Co-Authored-By: CodeBuddy Code`）；M5 在途改动单列，**禁止 `git add .`**。收尾按 §0.1「跑验 → 扫 → 清 → 核 → 报」清临时物。

---

## 10. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 自动定位忽略 `P-shared` 后，真机那条 `P-shared` 归并摘要不再被默认召回 | 它是 bootstrap 系统产物；显式传 `project_id='P-shared'` 仍可查；AC-3 保证 `list_projects` 仍列它 | 把 `{ excludeSystemPools: true }` 改回缺省，行为逐字回到现状 |
| 两处调用点漏接 / 只接一处 → HTTP 与 TCP 口径漂移 | 两处都走同一 `runRecallTool`；TCP `mcp.ts:189` 与 HTTP `mcpHttp.ts:326` 共用该函数，仍须双端实测 | 同上 |
| 覆盖 M5 在途改动（`mcpSchema.ts` / `main.ts`） | 逐文件 `git diff` 复核，定点字符串替换，禁整文件重写、禁 `git checkout --` 覆盖在途 | 仅 `git checkout -- <本轮新增文件>`；在途文件不动 |
| 配方大小写误伤 683 处测试夹具占位值 / 原型优先级 badge | 只改 §5.3 列出的 4 行 + 1 处断言；动手前用 `Grep "'p1'"` 复核清单，明确区分「配方下发点 / 夹具占位 / badge」；`validators` R2 逻辑不变 | 逐文件还原（仅 5 处） |
| 指令文案改动破坏 12 工具 / 门禁测试锁 | `MCP_TOOLS` 与五个门禁常量一字不动，只改纯文案字符串 | 定点还原文案 |
| 打包后旧进程跑旧口径 | §0.2 五步闭环 | 关端重打包 |

---

## 11. 开工前待拍板（4 项）

| # | 问题 | 推荐 |
|---|---|---|
| **B1** | 是否采纳**路径 B**（内核 `resolveProjectId` 语义改动，让省略 `project_id` 真正自动定位）？ | **是**——这是「不用设置」唯一能落地的服务端路径 |
| **B2** | 是否同时修 D2 配方小写 `'p1'`（4 行下发点 + 1 处断言）？ | **是**，与 T3 合并为一个原子任务 |
| **B3** | 是否做 T4 常量收敛？ | **否**（纯整理，收益低且动在途的 `main.ts`）；真要做得等 M5 收口 |
| **B4** | M5 在途改动何时收口？决定 T5 索引重建与打包时机 | 由你定；在此之前不动索引、不打包、不提交 |

> **本轮到此为止**：只产出方案与现查基线，零源码改动。确认 B1–B4 后从 T1 开始，每个原子任务收尾给三栏证据并停下等你确认。

---

## 附录 A · 现查取证命令（可复现）

```powershell
# 账本项目分布
$j = Get-Content "$env:APPDATA/MultiAgent Memory/memories.db.json" -Raw -Encoding utf8 | ConvertFrom-Json
$rows = @($j.memories.PSObject.Properties | ForEach-Object { $_.Value })
$rows | Group-Object project_id | Sort-Object Count -Descending
# 配方小写 bug
Select-String -Path src/agentOnboard/service.ts -Pattern "'p1'"
# 12 工具与门禁（直连 8204：initialize → recall_memory → tools/list / list_projects）
# 详见 §1 真机实测记录
```

## 附录 B · 与上位方案的关系

上位 `project_id配置化_工程化落地方案.md` 的 §4–§12（配置文件 / 解析器 / IPC / UI 卡片 / T1–T6）在阶段 0 **全部不实施**；其 §3.1 P1–P5 拍板项随之失效。仅当将来真出现「第二个需要隔离的业务项目」时，才按该方案阶段 1 启用，且仍须遵守「历史零迁移、白名单规则、默认兜底」三条。
