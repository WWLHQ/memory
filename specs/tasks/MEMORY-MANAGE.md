# REQ-006 / P8 记忆管理页 — 任务拆分（原子任务 · 供 Agent 执行）

> 来源：`specs/需求规格书_其余页面字段级交互规格.md` §P8 记忆管理页（17.3 / 9.5 / 9.10.1 / 17.4）。
> REQ-006 是 9 子页的大伞，本文件只做其中 **P8 记忆管理页**（用户指定先做的子页）。
> 实现基线：**沿用本项目已验证的「原型驱动 + 逻辑层纯函数单测 + 后端 mirror 注入点」模式**
> （参见 `src/web/AgentOnboard/`、`src/web/overview/`）。无现成 P8 原型 HTML，UI 依规格 §P8 自设计，
> 复用既有 `theme.css` 暗色主题与组件风格。
>
> 数据来源：**本地种子 + 内存态为真相**（操作即改本地 state）；后端 mirror 为可选 fire-and-forget，
> 失败静默、不阻塞 UI（与原型语义优先一致）。home server 暂无 memory 端点，故 mirror 为 safe-noop。

---

## 边界总览（全任务共享）
- 新增：`memory.html`（Vite 入口）、`src/web/memory/**`、`specs/tasks/MEMORY-MANAGE.md`
- 修改：`vite.config.ts`（加 `memory` entry）、`src/web/overview/Overview.tsx`（导航加记忆管理 + 计数）
- 不动：已有 `AgentOnboard/`、`Home/`、`InlineAttribution/`、`overview` 自身渲染逻辑（仅加一项导航）

---

## T1 脚手架与导航接入
- 目标：建立记忆管理页空壳并能被 Overview 导航到达
- 输入：`vite.config.ts` entry 结构、`src/web/overview/Overview.tsx` 的 `VIEWS`/`PLANNED`、`src/web/AgentOnboard/agentOnboardEntry.tsx` 入口样板
- 输出：
  - `memory.html`（仿 `agentonboard.html`）
  - `src/web/memory/memoryEntry.tsx`（createRoot 挂载 `MemoryPage`）
  - `src/web/memory/MemoryPage.tsx`（空壳，渲染标题/占位）
  - `src/web/memory/theme.css`（仿 `AgentOnboard/theme.css` 暗色主题）
  - `vite.config.ts` 加 `memory: 'memory.html'`
  - `Overview.tsx`：`VIEWS` 加 `{ id:'memory', ic:'🗂️', lbl:'记忆管理页', desc:'P8 · 列表+17.3 操作', src:'/memory.html', req:'REQ-006' }`；顶部「N 个已落地视图」计数 +1
- 验收：`npm run build` 含 memory 产物；vitest 挂载测试渲染标题；`Overview` 含 memory 项
- 边界：仅 `memory.html` / `src/web/memory/`(空壳+theme) / `vite.config.ts` / `Overview.tsx`
- 依赖：无前置；被 T2~T5 依赖
- 提交：`feat(REQ-006/P8-T1): 记忆管理页脚手架与导航接入`

## T2 数据模型 + 种子 + 纯逻辑层（核心，纯函数 + 单测）
- 目标：定义 `MemoryRecord` 类型、种子数据，并把可算规则抽成纯函数单测覆盖
- 输入：规格 §P8 字段（id/content/type/tags/importance/confidence/access_count/reinforce_count/pinned/locked/archived/decay_class/status/merged_from/merged_into/created_at/updated_at）；§15.3 decay；§17.8 pinned 置顶；§17.4 locked；G3 cold 仅 L2
- 输出：
  - `src/web/memory/types.ts`：`MemoryRecord`、`MemoryStatus`（active/hibernating/archived/deprecated/stale/dormant）、`DecayClass`
  - `src/web/memory/seed.ts`：`SEED_MEMORIES: MemoryRecord[]`（覆盖各 decay/status/pinned/locked/merged 样例，含 1 条 cold 仅 L2）
  - `src/web/memory/logic.ts` + `logic.test.ts`：
    - `decayClass(ageDays, halfLifeDays)` → hot/warm/cold/archived/dormant（§15.3 / 17.5）
    - `sortMemories(list)` → pinned 置顶 → 其余按 confidence 降序（§17.8/R5）
    - `summarizeContent(rec)` → cold/dormant 返回 L2 占位符，其余返回 content（G3）
    - `applyOp(rec, op)` → `remember`(升 importance/confidence→hot) / `forget`(降权不删) / `pin`/`unpin` / `lock`/`unlock` / `archive` / `restore` / `delete`(彻底删除)；返回新 record + 审计动作枚举（G6）；`locked` 记忆除 `unlock` 外全部拒绝并提示
- 验收：`npm test -- memory/logic` 全绿（覆盖 decay 各档 / pinned 置顶 / 各 op 迁移 / locked 约束 / cold 仅 L2）
- 边界：仅 `src/web/memory/{types,seed,logic}.ts`(+test)
- 依赖：T1
- 提交：`feat(REQ-006/P8-T2): 记忆数据模型 + 种子 + 纯逻辑层`

## T3 列表组件（列渲染 + 排序 + 状态/谱系）
- 目标：实现 §P8 记忆列表行与列
- 输入：T2 的 `MemoryRecord`/`sortMemories`/`summarizeContent`/`decayClass`
- 输出：`src/web/memory/MemoryTable.tsx` + `MemoryRow.tsx` + 组件测试
  - 列：id、content（cold 仅 L2 占位符，G3）、type/tags、importance/confidence 进度条、access_count/reinforce_count 分家、pinned/locked/archived 图标、decay_class 温度徽标、status 六态、`merged_from/merged_into` 谱系、created_at/updated_at
  - 排序：pinned 置顶 → confidence 降序（T2 `sortMemories`）
- 验收：组件测试覆盖 cold 仅 L2 / pinned 置顶 / 各状态徽标渲染
- 边界：仅 `src/web/memory/{MemoryTable,MemoryRow}.tsx`(+test)
- 依赖：T2
- 提交：`feat(REQ-006/P8-T3): 记忆管理列表（列渲染 + 排序 + 状态/谱系）`

## T4 操作区（17.3 文案 + locked 约束 + 审计）
- 目标：实现 §P8 操作按钮与行为，含 17.3 推荐文案与 G6 审计钩子
- 输入：T2 的 `applyOp`（含 locked 约束）；§17.3 文案：
  - 记住：「已提升这条信息的优先级。」
  - 忘记：「这条信息已降权，后续会较少主动出现。你可以稍后恢复。」
  - 恢复 / 置顶 / 锁定 / 取消置顶·解锁 / 归档 / 彻底删除（各自 17.3 文案）
  - `locked` 记忆：仅可解锁，其余操作禁用并提示「已锁定，先解锁才能操作」
- 输出：`src/web/memory/MemoryActions.tsx` + 组件测试（操作触发 state 变更 + toast 文案；locked 约束）
- 验收：组件测试覆盖 记住/忘记 toast、locked 仅可解锁、彻底删除确认
- 边界：仅 `src/web/memory/MemoryActions.tsx`(+test)
- 依赖：T2、T3
- 提交：`feat(REQ-006/P8-T4): 记忆管理操作区（17.3 文案 + locked 约束 + 审计）`

## T5 详情/编辑 + 后端 mirror 注入 + 组合 E2E（自包含 harness）
- 目标：行点击展开详情/内联编辑（MEMORY.md 编辑概念）、接后端 mirror 注入点、补一条自包含 E2E
- 输入：T2~T4；`src/web/AgentOnboard/useBackendMirror.ts`（resolveBackendUrl 模式）
- 输出：
  - `src/web/memory/useMemoryMirror.ts`：`resolveBackendUrl` 同款（?backend= 覆盖，默认 localhost:8200）；本地 state 为真相，mirror fire-and-forget（无端点时 safe-noop）
  - `MemoryPage.tsx` 编排：列表 + 操作 + 详情抽屉（选中行展开全字段 + 内联编辑 content/importance 等，本地生效）+ toast
  - `e2e/memory.spec.ts`：仿 `e2e/register.spec.ts` 自包含 harness（自带 static server + home backend + 独立端口 + 预置 session），断言核心链路：列表渲染 → 点「记住」toast → locked 约束
- 验收：`npm run test:e2e --workers=1` 该 spec 绿；`npm run verify` 全绿
- 边界：仅 `src/web/memory/{MemoryPage,useMemoryMirror}.ts(x)` + `e2e/memory.spec.ts`
- 依赖：T1~T4
- 提交：`feat(REQ-006/P8-T5): 记忆详情/编辑 + mirror 注入 + 自包含 E2E`

---

## 拆分说明（范围边界）
- 本拆分**只做 P8**，不做 P2/P4/P5/P6/P7/P9/P11/P12（它们仍属 REQ-006 规划中）。
- 后端接入：home server 暂无 memory 端点，mirror 为 safe-noop（本地内存态即真相），不在本 REQ 新建后端。
- 审计：操作产生审计动作枚举（G6），但审计落库/审计页跳转属 P11，本页只产动作、不落地。
- MEMORY.md 编辑：本页做「内联编辑 content 等本地字段」概念，真正的 MEMORY.md 文件读写同步属规格 9.5，可后置。
