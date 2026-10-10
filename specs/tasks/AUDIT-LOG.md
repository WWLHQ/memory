# REQ-006 / P11 审计日志页 — 任务拆分（原子任务 · 供 Agent 执行）

> 来源：`specs/需求规格书_其余页面字段级交互规格.md` §P11 审计日志页（4.3 / 18.2-E，独立窗口）。
> REQ-006 是 9 子页大伞；本文件只做 **P11 审计日志页**（用户指定继 P8/P2 之后的下一个子页）。
> 实现基线：**沿用本项目已验证的「原型驱动 + 逻辑层纯函数单测 + 后端 mirror 注入点」模式**。
> 无现成 P11 原型 HTML，UI 依规格 §P11 自设计，复用暗色设计系统。
> 数据来源：本地种子审计 + 内存态为真相；后端 mirror 可选 fire-and-forget，无端点时 safe-noop。
>
> ⚠ 同工作区 P8（记忆管理）、P2（写入页）已构建待人工验收、尚未提交；本 P11 同样按流程开发，同处未提交状态。

---

## 边界总览（全任务共享）
- 新增：`audit.html`（Vite 入口）、`src/web/audit/**`、`specs/tasks/AUDIT-LOG.md`
- 修改：`vite.config.ts`（加 `audit` entry）、`src/web/overview/Overview.tsx`（导航：审计日志页由 PLANNED 移入 VIEWS + 计数）
- 不动：已有 `AgentOnboard/`、`Home/`、`InlineAttribution/`、`memory/`、`write/` 自身、overview 渲染逻辑（仅改导航）

---

## T1 脚手架与导航接入
- 目标：建立审计日志页空壳并能被 Overview 导航到达（从 PLANNED 移入 VIEWS）
- 输入：`vite.config.ts` entry、`Overview.tsx` 的 `VIEWS`/`PLANNED`、`agentOnboardEntry.tsx` 样板
- 输出：`audit.html`、`src/web/audit/auditEntry.tsx`、`src/web/audit/AuditPage.tsx`（空壳）、`src/web/audit/theme.css`（复用设计系统）、`vite.config.ts` 加 `audit: 'audit.html'`、`Overview.tsx` VIEWS 加 `{ id:'audit', ic:'📋', lbl:'审计日志页', desc:'P11 · 4.3 统一审计 + request_id 追踪', src:'/audit.html', req:'REQ-006' }` 并将 PLANNED 中 audit 项移除、计数 +1
- 验收：`npm run build` 含 audit 产物；vitest 挂载测试渲染标题；Overview 含 audit 项且 PLANNED 无 audit
- 边界：仅 `audit.html` / `src/web/audit/`(空壳+theme) / `vite.config.ts` / `Overview.tsx`
- 依赖：无前置；被 T2~T5 依赖
- 提交：`feat(REQ-006/P11-T1): 审计日志页脚手架与导航接入`

## T2 数据模型 + 种子 + 纯逻辑层（核心，纯函数 + 单测）
- 目标：定义审计条目类型、动作枚举、种子、并把可算规则抽成纯函数单测覆盖
- 输入：§P11 过滤栏 + 审计行全量字段（4.3）+ 链路追踪（18.2-E）+ 导出
- 输出：
  - `src/web/audit/types.ts`：`AuditEntry`（action/resource_type/resource_id/old_status/new_status/old_id/new_id/evidence_thin/request_id/payload_tokens/pipeline_llm_tokens/ip_address/device_info/created_at/enterprise_id/user_id）+ `AuditAction` 枚举 + `AuditFilter`
  - `src/web/audit/seed.ts`：`SEED_AUDIT`（覆盖各 action 样例，含同 request_id 多条以演示链路追踪）
  - `src/web/audit/logic.ts` + `logic.test.ts`：
    - `filterEntries(list, f)` → 按 enterprise_id/user_id/ip/device/action/request_id/created_at 区间过滤
    - `chainByRequest(list, requestId)` → 该 request_id 全部行（链路追踪）
    - `exportCsv(list)` / `exportJson(list)` → 字符串（供下载）
    - `actionLabel(action)` → 中文动作名（4.3 枚举可读化）
- 验收：`npm test -- audit/logic` 全绿（覆盖过滤各维 / 链路聚合 / 导出格式 / 动作可读化）
- 边界：仅 `src/web/audit/{types,seed,logic}.ts`(+test)
- 依赖：T1
- 提交：`feat(REQ-006/P11-T2): 审计日志数据模型 + 种子 + 纯逻辑层`

## T3 过滤栏组件
- 目标：实现 §P11 过滤栏（enterprise_id/user_id/ip/device/action/request_id/created_at 区间）+ 应用过滤
- 输入：T2 的 `filterEntries` / `AuditAction` 枚举
- 输出：`src/web/audit/FilterBar.tsx` + 组件测试
  - 各文本输入 + action 下拉（枚举）+ created_at 起止；「查询」按钮应用过滤；「重置」
  - action 下拉含 4.3 全部枚举（recall/write/verify/dispute/archive/ban/merge + recall_skip/recall_breach/rerank_on/rerank_fallback/cold_recall + mode_dispatch/mode_fallback/evidence_thin）
- 验收：组件测试覆盖 输入过滤条件 → onChange/onQuery 回调；action 枚举渲染
- 边界：仅 `src/web/audit/FilterBar.tsx`(+test)
- 依赖：T2
- 提交：`feat(REQ-006/P11-T3): 审计日志过滤栏`

## T4 审计列表 + 行展开（request_id 链路追踪）
- 目标：实现 §P11 审计行全量字段 + 点 request_id 展开该链路全行（18.2-E）+ 跳检索页上下文占位
- 输入：T2 的 `chainByRequest` / `actionLabel`；§P11 行字段
- 输出：`src/web/audit/AuditTable.tsx` + 组件测试
  - 表头 + 行：时间/action(中文)/resource/old→new/request_id(可点)/payload/pipeline_llm/ip/device/evidence_thin
  - 点 request_id → 展开该 request_id 同链路所有行（高亮）
  - 「跳检索页」占位链接（/overview.html 或检索页，占位）
- 验收：组件测试覆盖 行渲染 / 点 request_id 展开链路 / evidence_thin 显示
- 边界：仅 `src/web/audit/AuditTable.tsx`(+test)
- 依赖：T2、T3
- 提交：`feat(REQ-006/P11-T4): 审计列表 + request_id 链路追踪`

## T5 导出 + mirror 注入 + 组合 E2E（自包含 harness）
- 目标：导出 CSV/JSON（§P11）+ 后端 mirror 注入点 + 自包含 E2E
- 输入：T2 的 `exportCsv`/`exportJson`；`useBackendMirror` 同款 resolveBackendUrl 模式
- 输出：
  - `src/web/audit/useAuditMirror.ts`：resolveBackendUrl 同款（?backend= 覆盖），本地为真相，mirror safe-noop
  - `AuditPage.tsx` 编排：过滤栏(T3) + 列表(T4) + 导出按钮（CSV/JSON，触发下载占位或 console）+ toast
  - `e2e/audit.spec.ts`：仿 `e2e/write.spec.ts` 自包含（静态服务 + 独立端口，无后端），断言核心链路：页面渲染 → 过滤 → 点 request_id 展开链路 → 导出按钮存在
- 验收：`npm run test:e2e --workers=1` 该 spec 绿；`npm run verify` 全绿
- 边界：仅 `src/web/audit/{AuditPage,useAuditMirror}.ts(x)` + `e2e/audit.spec.ts`
- 依赖：T1~T4
- 提交：`feat(REQ-006/P11-T5): 审计日志导出 + mirror 注入 + 自包含 E2E`

---

## 拆分说明（范围边界）
- 本拆分**只做 P11**，不做 P2/P4/P5/P6/P7/P8(已完成待验)/P9/P12（仍属 REQ-006 规划中）。
- 后端接入：home server 暂无 audit 端点，mirror 为 safe-noop（本地种子即真相），不在本 REQ 新建后端。
- 导出：生成 CSV/JSON 字符串（浏览器下载用 Blob/anchor，E2E 仅断言按钮与生成函数）；真实落库与检索页联动为占位。
- 「跳检索页」为占位导航（检索页 REQ-012 尚未实现，跳 /overview.html）。
