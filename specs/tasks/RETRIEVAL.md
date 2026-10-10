# REQ-012 检索页 — 任务拆分（原子任务 · 供 Agent 执行）

> 来源：`specs/需求规格书_检索页字段级交互规格.md`（字段级交互规格，已结构化）。
> 实现基线：沿用本项目已验证的「原型驱动 + 逻辑层纯函数单测 + 后端 mirror 注入点」模式
> （参见 `src/web/AgentOnboard/` 与 `src/web/overview/`）。
> 本页是**前端检索结果页**：引擎裁决 / 预算裁剪等重逻辑以**纯函数**实现并单测覆盖，
> 真实后端走 `useBackendMirror` 同款 fire-and-forget 注入点（`?backend=` 可覆盖，默认 `localhost:8200`）。
>
> 状态机（§0）：`IDLE → LOADING → RESULT → (重查) LOADING`；失败分支 `ERROR / EMPTY`。

---

## 边界总览（全任务共享）
- 新增：`retrieval.html`（Vite 多入口）、`src/web/retrieval/**`、`specs/tasks/RETRIEVAL.md`
- 修改：`vite.config.ts`（加 entry）、`src/web/overview/Overview.tsx`（加导航入口）、`src/web/main.tsx`（如需）
- 不动：已有 `AgentOnboard/`、`Home/`、`InlineAttribution/`、内核其它模块（越界即违规）

---

## T1 脚手架与导航接入
- 目标：建立检索页空壳并能被导航到达
- 输入：`vite.config.ts` 现有 entry 结构、`src/web/overview/Overview.tsx` 导航区、`src/web/main.tsx`
- 输出：`retrieval.html` + `src/web/retrieval/RetrievalPage.tsx`（空壳，渲染标题/状态占位）、`vite.config.ts` 加 `retrieval` entry、`Overview.tsx` 加「检索页」入口
- 验收：`npm run build` 含 retrieval 产物；vitest 组件挂载测试通过（渲染标题）
- 边界：仅 `retrieval.html` / `src/web/retrieval/` / `vite.config.ts` / `Overview.tsx`
- 依赖：无前置；被 T2~T7 依赖
- 提交：`feat(REQ-012/T1): 检索页脚手架与导航接入`

## T2 检索页纯逻辑层（核心，纯函数 + 单测）
- 目标：把规格里所有"可算"的规则抽成纯函数，单测覆盖
- 输入：规格 §1.1 scene 联动表、§1.2 mode 联动、§2.4.4 自动分流裁决、§3 排序/decay、§5/R9 预算三档、§7 校验、§8 边界约束
- 输出：`src/web/retrieval/logic.ts` + `logic.test.ts`，至少覆盖：
  - `resolveSceneBudget(scene)` → 预算/默认模式/回灌深度/重排/可用 mode 列表（§1.1）
  - `resolveModeLinkage(scene, mode)` → 含 critical 禁用 minimal（R5/§1.1）、mode 回落（§7.3/4）
  - `autoDispatch(query, scene, cfg)` → 2.4.4 自动分流（含 zh<30/en<12 极简信号、关键词命中 fact_first 等示例）
  - `sortHits(hits)` → pinned 置顶 → score 降序 → confidence 次级（§3）
  - `decayClass(age, halfLife)` → hot/warm/cold/archived/dormant + `freshness=0.5^(age/half)`（§3.1/17.5）
  - `budgetLevel(payload)` → 1500 裁剪 / 2000 告警 / 3000 硬熔断（R9）
  - `validateQuery(query)` → trim 非空、语言长度检测（§7.1/2）
- 验收：`npm test -- retrieval/logic` 全绿（覆盖上表各分支，含 §9 验收用例里的自动分流/极简/硬熔断样例）
- 边界：仅 `src/web/retrieval/logic.ts`(+test)
- 依赖：T1
- 提交：`feat(REQ-012/T2): 检索页纯逻辑层（scene/mode/分流/预算/排序/校验）`

## T3 查询栏组件
- 目标：实现 §1 查询栏（query / scene / mode 下拉 + 检索按钮 + 校验 + 联动 toast）
- 输入：T2 的 `resolveSceneBudget` / `resolveModeLinkage` / `validateQuery`；§1.1/1.2/1.3/§7
- 输出：`src/web/retrieval/QueryBar.tsx` + `QueryBar.test.tsx`
  - scene 切换 → mode 下拉候选更新；若当前 mode 被禁 → 回落 + toast「mode 已按场景调整」（§1.1）
  - critical → minimal 置灰 + tooltip「合规场景禁用极简（16.5）」、重排默认 ON（R5）
  - query 空 → 检索按钮 disabled（§7.1）；实时语言长度→极简提示（不阻止提交）
  - session 上下文默认继承（§1.3，仅展示，禁手填 user/team 等，R1）
- 验收：组件测试覆盖 空查询禁用 / critical 禁 minimal / scene 切换回落 toast
- 边界：仅 `src/web/retrieval/QueryBar.tsx`(+test)
- 依赖：T2
- 提交：`feat(REQ-012/T3): 检索页查询栏（scene/mode 联动 + 校验）`

## T4 结果列表组件
- 目标：实现 §3 结果列表（hits 行字段 + 操作 + 排序）
- 输入：T2 的 `sortHits` / `decayClass`；§3.1/3.2/R2/R3/R4
- 输出：`src/web/retrieval/ResultList.tsx` + `ResultRow.tsx` + 组件测试
  - 行字段：memory_id、content（cold/dormant 仅 L2 占位符，R2）、decay chip、pinned 钉（置顶，R3）、locked 锁（R4）、freshness/importance/confidence 进度条、score、tags、合并谱系、冲突 ⚡
  - 操作：查看（展开上下文面板）、记住（升 importance/confidence→Hot，toast）、忘记（降权不删，toast）、反馈（跳反馈页预填 memory_id）
  - Top K 默认 3–5，可「加载更多」至 10
- 验收：组件测试覆盖 pinned 置顶 / cold 仅 L2 / 记住-忘记 toast
- 边界：仅 `src/web/retrieval/ResultList.tsx` + `ResultRow.tsx`(+test)
- 依赖：T2
- 提交：`feat(REQ-012/T4): 检索页结果列表（行字段 + 记住/忘记/反馈）`

## T5 横幅 + 预算面板 + 上下文面板
- 目标：实现 §2 生效模式横幅、§5 预算面板、§4 上下文面板
- 输入：T2 的 `budgetLevel`；§2/§4/§5/R8/R9；`request_id` 跳转审计（R8）
- 输出：`ModeBanner.tsx` / `BudgetPanel.tsx` / `ContextPanel.tsx` + 组件测试
  - 横幅：scene/mode chip、mode_fallback 灰字、hit_keywords、次模式注入折叠（极简主模式隐藏，R6）、request_id 可复制+跳转、evidence_thin 黄条+「切事实优先重试」、cold_recall 蓝 chip
  - 预算面板：payload 进度条三档变色、pipeline_llm 次级、stage1→stage2 漏斗、rerank 闸门状态（critical 强制开，R5；失败回退记 rerank_fallback，R10）、budget_breach + breach_detail
  - 上下文面板：全文中 cold/dormant 仅 L2 + 「展开原文(审计)」、关联记忆、命中高亮、该条参数只读、跳转链接
- 验收：组件测试覆盖 三档预算变色 / 极简隐藏次模式 / request_id 可点
- 边界：仅 `src/web/retrieval/{ModeBanner,BudgetPanel,ContextPanel}.tsx`(+test)
- 依赖：T2、T4
- 提交：`feat(REQ-012/T5): 检索页横幅/预算/上下文面板`

## T6 状态机与异常态 + 假引擎/注入点
- 目标：实现 §0 状态机与 §6 全部异常态文案 + 触发链路（含后端 mirror 注入点）
- 输入：T2 逻辑；§0/§6；`useBackendMirror` 同款模式（参考 `src/web/AgentOnboard/useBackendMirror.ts`）
- 输出：`RetrievalPage.tsx` 状态编排 + `useRetrieval.ts`（hook：IDLE/LOADING/RESULT/EMPTY/ERROR）+ 假引擎 `fakeEngine.ts`（用 T2 逻辑产 mock hits，便于无后端演示）+ mirror 注入点
  - LOADING：骨架屏、查询栏禁用、预算面板隐藏
  - EMPTY / evidence_thin（补查命中/未命中）/ ERROR（硬熔断禁用检索 3s、超时回退第二层）/ critical+evidence_thin 文案与按钮（§6 全表）
  - request_id 每次新生成（R7/R8）；二次查询保留 session_id（§7.6）
- 验收：`useRetrieval` 单测覆盖状态迁移 + 异常态文案；组件测试覆盖 ERROR 禁用 3s / EMPTY 重试按钮
- 边界：仅 `src/web/retrieval/{RetrievalPage,useRetrieval,fakeEngine}.ts(x)`(+test)
- 依赖：T3、T4、T5
- 提交：`feat(REQ-012/T6): 检索页状态机/异常态 + 假引擎与 mirror 注入`

## T7 视觉对齐原型 + 组合 E2E（自包含 harness）
- 目标：对齐 `design/ui/检索页_原型.html` 视觉，并补一条自包含 E2E（参照 `e2e/register.spec.ts` harness 模式）
- 输入：`design/ui/检索页_原型.html`、`e2e/` 现有 harness 套路
- 输出：样式/布局对齐原型；`e2e/retrieval.spec.ts`（自带 static server + home backend + 独立端口，预置 session，断言核心链路：空查询禁用→输入→RESULT→记住 toast）
- 验收：`npm run test:e2e --workers=1` 该 spec 绿；`npm run verify` 全绿
- 边界：仅 `src/web/retrieval/` 样式 + `e2e/retrieval.spec.ts`
- 依赖：T1~T6
- 提交：`feat(REQ-012/T7): 检索页原型视觉对齐 + 自包含 E2E`

---

## 拆分说明（范围与优先级）
- 以上为**全保真拆分**。若先要 MVP，可只做 `T1+T2+T3+T4+T6(核心态)` 跑通主链路（IDLE→RESULT→记住/忘记），
  `T5(预算/上下文面板)` 与 `T7(视觉精修+E2E)` 后置。
- 所有"引擎裁决/预算裁剪/冷召回"在**前端纯函数 + 假引擎**层实现与演示；真实后端接入沿用 mirror 注入点，不在本 REQ 内新建后端服务。
- 上下文/反馈页跳转（§3.2/§4）仅做「带参数跳转」占位，落地依赖对应 REQ 页面。
