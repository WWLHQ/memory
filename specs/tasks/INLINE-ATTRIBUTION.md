---
title: 原子任务 · REQ-004 Agent 界面内联记忆标识
status: done
---

# 原子任务：Agent 界面内联记忆标识（REQ-004）

> 本文件是 `meta/TASK_SPLITTING.md` 规范在 **REQ-004（Agent 界面内联记忆标识）** 上的真实再创作。
> 来源：[需求规格书_Agent界面内联记忆标识.md](需求规格书_Agent界面内联记忆标识.md)（19.7）、[需求规格书.md](需求规格书.md) 第 19 章、[设计/ui/Agent界面内联标识_原型.html](设计/ui/Agent界面内联标识_原型.html)、[specs/acceptance.md](acceptance.md) 的 AC-004。
> 拆分原则：越底层越先（类型/纯逻辑/配置上下文）→ 越纯越先（判定）→ 四类标记组件（自决可见性）→ 反馈闭环/摘要 → 宿主集成 → 测试。每个任务可被一条命令验收，单独提交。
> 技术栈：TS 内核 + React 19 UI（与 REQ-003/REQ-005 一致）；验收命令：`npm run typecheck`（tsc strict）/ `npm test`（vitest）/ `npm run test:e2e`（Playwright）。

## 范围边界（务必先读，避免越界）
- **本 REQ 只做"展示 + 用户当场干预的 UI 闭环"**，不实现内核能力：
  - 实际 `write_memory` 写入、召回计算、token 统计 → **REQ-007（内核 API）**。本 REQ 的 💾 沉淀标记 / ⚡ 省 token 仅**展示**后端已算好的数据。
  - 审计页（request_id 可溯源 4.3）→ **REQ-011（日志记录页）**。本 REQ 点 request_id 仅触发 `onOpenAudit(req)` 回调桩（先 toast/占位）。
  - 反馈（13.7 trust_delta / 9.10 stale）→ 通过 **`FeedbackPort` 端口**收口：本 REQ 给 `LocalMockFeedbackPort`（本地写审计 + toast），真实内核端口留待 REQ-007 接入。组件只依赖端口接口，不直连后端。
- **不打断原则（§0）**：标记全部内联、零布局位移；一键折叠由 T9 Toggle 提供；hover/click 弹层不阻塞 Agent 输出。
- **诚实约束（§4）**：`evidence_thin` / `aging_hint` 为**必须显示项**，任何 `off`/降级都不可隐藏（只可调详略）。

## T1 内联标识数据模型 / 类型定义
- 目标：定义 REQ-004 全部领域类型，作为后续任务的契约基线
- 输入：规格 §1（四类标识字段级规范）、§2（四类字段）、§4（开关与降级）、原型 `MEM` 结构与交互
- 输出：`src/types/inlineAttribution.ts`：
  - `DecayClass = 'hot'|'warm'|'cold'|'dormant'`
  - `MemoryInjectionMark { memory_id; summaryL2: string; decay_class: DecayClass; aging_hint: string; request_id: string; evidence_thin?: boolean }`
  - `TokenSaving { actual_payload: number; full_baseline: number; saved: number; breakdown: Array<{ reason: string; tokens: number }> }`
  - `BackgroundItem { id: string; kind: 'stack'|'constraint'|'decision'|'pitfall'; text: string }`
  - `BackgroundMark { count: number; items: BackgroundItem[] }`
  - `AgingWarnMark { kind: 'aging'|'evidence_thin'; text: string; request_id: string }`
  - `WriteBackMark { memory_id: string; request_id: string; summary: string }`
  - `AttributionLevel = 'full'|'token_only'|'off'`
  - `AttributionConfig { show_memory_attribution: boolean; attribution_level: AttributionLevel }`
  - 反馈：`FeedbackAction = 'confirm'|'reject'|'disputed'`、`TrustDelta`（confirm +0.1 / reject −0.05 / disputed → 冲突裁决队列 P7）、`FeedbackPort` 接口（`writeAudit(req, delta): void`）
- 验收：`npm run typecheck` + `npm test`（`src/types/__tests__/inlineAttribution.test.ts`）
- 边界：仅 `src/types/`、`src/types/inlineAttribution.ts`
- 依赖：无；被 T2~T12 全部依赖
- 提交：`feat(REQ-004): define inline attribution types`（含 T1）

## T2 衰减 / 老化 / 证据判定纯逻辑
- 目标：实现不依赖 UI 的判定函数——衰减层分级、老化文案、证据不足标记、单回答归因汇总
- 输入：T1 类型；规格 §2.1（decay_class 温度点）、§2.4（aging_hint 45 天前、evidence_thin）、§3（每回答 1 行贡献摘要）
- 输出：`src/inlineAttribution/decay.ts`：
  - `decayClassFromAge(days: number): DecayClass`（≤7 hot / ≤45 warm / ≤180 cold / 其余 dormant）
  - `agingHintText(mark): string`（`aging_hint` 非空原样返回；否则按 age 给 9.6 文案）
  - `isEvidenceThin(mark): boolean`
  - `summarizeAttribution(injections, saving, writeBack): string`（生成「来自 N 条记忆 · 省 X token」一行摘要）
- 验收：`npm test -- inlineAttribution.decay`（覆盖 4 档衰减、45 天边界、证据不足、汇总文案）
- 边界：仅 `src/inlineAttribution/decay.ts` + 测试
- 依赖：T1；被 T3 / T7 / T9 依赖
- 提交：`feat(REQ-004): attribution decay/aging logic`（含 T2）

## T3 ① 记忆注入标记组件（内联 🧠 + 弹层）
- 目标：渲染内联 `🧠` 小标（按 decay_class 着色），hover/click 弹层展示 memory_id + L2 摘要 + 衰减层 + 老化提示 + request_id 跳审计 + 记住/忘记/标错
- 输入：T1 类型、T2 判定、T9 配置上下文；规格 §2.1、原型 `showPop`/`.mem-tag` 行为
- 输出：`src/web/InlineAttribution/MemoryInjectionTag.tsx` + 测试：
  - 渲染 `🧠`，`decay_class` 决定颜色（hot/warm/cold/dormant 四色）
  - 消费 `useAttributionConfig()`：**仅 `full` 时渲染**（非 full 不挂载，呼应降级）
  - 弹层含 memory_id、L2 摘要、decay 层、aging 提示（有则黄字）、request_id（`onOpenAudit(req)` 回调）
  - 三个干预按钮 → `onFeedback(memory_id, action)`（confirm/reject/disputed，类型来自 T1）
  - 点击外部关闭弹层
- 验收：`npm test -- MemoryInjectionTag`（四色渲染、弹层字段、干预回调、外部关闭、full 外不渲染）
- 边界：仅 `src/web/InlineAttribution/MemoryInjectionTag.tsx` + 测试
- 依赖：T1, T2, T9；被 T10 依赖
- 提交：`feat(REQ-004): memory injection tag`（含 T3）

## T4 ② Token 节省标记组件（底部 ⚡ 一行 + 分解）
- 目标：渲染回答底部 `⚡ 本次省 X token` 一行，可展开归因分解
- 输入：T1 的 `TokenSaving`、T9 配置上下文；规格 §2.2、原型 `.tokbar`
- 输出：`src/web/InlineAttribution/TokenSavingBar.tsx` + 测试：
  - 消费 `useAttributionConfig()`：**`off` 时不渲染**，其余渲染**
  - 展示 `payload actual/full_baseline`、`saved`、归因分解（极简 / L2 占位符 / 超支裁剪）
  - 点击展开/收起 `breakdown` 列表
- 验收：`npm test -- TokenSavingBar`（数值渲染、展开收起、分解项、off 不渲染）
- 边界：仅 `src/web/InlineAttribution/TokenSavingBar.tsx` + 测试
- 依赖：T1, T9；被 T10 依赖
- 提交：`feat(REQ-004): token saving bar`（含 T4）

## T5 ③ 背景免重复标记组件（会话头 📎）
- 目标：渲染会话头部 `📎 已带项目背景 N 条`，可展开技术栈/约束/决策列表
- 输入：T1 的 `BackgroundMark`、T9 配置上下文；规格 §2.3、原型 `.bgmark`
- 输出：`src/web/InlineAttribution/BackgroundChip.tsx` + 测试：
  - 消费 `useAttributionConfig()`：**`off` 时不渲染**（背景属"标识"一类，off 全隐），其余渲染**
  - 渲染条数 + 摘要（技术栈·约束·近 N 决策）；点击「展开/收起」items 列表
- 验收：`npm test -- BackgroundChip`（条数、展开收起、items 渲染、off 不渲染）
- 边界：仅 `src/web/InlineAttribution/BackgroundChip.tsx` + 测试
- 依赖：T1, T9；被 T10 依赖
- 提交：`feat(REQ-004): background chip`（含 T5）

## T6 ④ 老化 / 证据警示组件（内联 ⚠️ · 恒显示）
- 目标：渲染内联 `⚠️` 警示；aging 可 confirm/reject，evidence_thin 可「切事实优先」；**恒显示不可关**
- 输入：T1 的 `AgingWarnMark`、T2 判定、T9 配置上下文；规格 §2.4、§4（诚实约束）、原型 `.warn-tag`
- 输出：`src/web/InlineAttribution/AgingWarnTag.tsx` + 测试：
  - **不受 `attribution_level` 影响，始终渲染**（诚实约束，T9 上下文对其返回 visible=true）
  - `aging`：文案 + 「我确认这条仍有效」(confirm +0.1) / 「确实过时」(reject −0.05 → stale)
  - `evidence_thin`：文案 + 「切事实优先重试」按钮
  - 两动作分别回调 `onFeedback(id,'confirm'|'reject')` / `onSwitchFactFirst(req)`
- 验收：`npm test -- AgingWarnTag`（两类文案、confirm/reject、切事实优先回调、任意 level 均渲染）
- 边界：仅 `src/web/InlineAttribution/AgingWarnTag.tsx` + 测试
- 依赖：T1, T2, T9；被 T10 依赖
- 提交：`feat(REQ-004): aging/evidence warning tag`（含 T6）

## T7 用户干预反馈闭环（端口式）
- 目标：把 记住/忘记/标错 / confirm/reject 收敛为 trust_delta 并写审计（request_id，4.3），预留内核接入点
- 输入：T1 的 `FeedbackAction`/`TrustDelta`/`FeedbackPort`；规格 §3（13.7 → 7.2 自生长）、§2.4（9.10 stale）
- 输出：`src/inlineAttribution/feedback.ts`：
  - `applyFeedback(action): TrustDelta`（confirm +0.1 / reject −0.05 / disputed → 冲突裁决队列 P7）
  - `FeedbackPort` 接口（`writeAudit(req, delta)`）+ 默认 `LocalMockFeedbackPort`（本地写审计 + toast），真实内核端口留待 REQ-007
  - 组件通过 prop 注入 port，不直连后端
- 验收：`npm test -- inlineAttribution.feedback`（三种动作 trust_delta 值、写审计调用、disputed 路由）
- 边界：仅 `src/inlineAttribution/feedback.ts` + 测试
- 依赖：T1；被 T3, T6, T10 依赖（提供回调 handler）
- 提交：`feat(REQ-004): feedback loop port`（含 T7）

## T8 每回答贡献摘要 + 写入沉淀标记
- 目标：每回答底部 1 行「记忆贡献摘要」，以及 💾 自动 write_memory 沉淀标记（**展示**，实际写入属 REQ-007）
- 输入：T1 的 `WriteBackMark` + T2 `summarizeAttribution`；规格 §3（每回答 1 行）、原型 `.savebar`、T9 配置上下文
- 输出：`src/web/InlineAttribution/AttributionSummary.tsx`（贡献摘要行）+ `WriteBackMark.tsx`（💾 沉淀标记，含 `onOpenAudit(req)` 跳审计回调）
  - 两者均消费 `useAttributionConfig()`：**`off` 时不渲染**，其余渲染
- 验收：`npm test -- AttributionSummary`（摘要文案 = 来自 N 条 · 省 X token；WriteBackMark 渲染 + 跳审计回调；off 不渲染）
- 边界：仅 `src/web/InlineAttribution/AttributionSummary.tsx` + `WriteBackMark.tsx` + 测试
- 依赖：T1, T2, T4, T9；被 T10 依赖
- 提交：`feat(REQ-004): per-answer attribution summary`（含 T8）

## T9 配置上下文 + 可开关与降级（诚实约束）
- 目标：提供 `AttributionConfigProvider`/ `useAttributionConfig()` 配置上下文 + Toggle 控件；**诚实约束**：evidence_thin/aging_hint 恒显示
- 输入：T1 的 `AttributionConfig`/`AttributionLevel`；规格 §4（可开关、降级）、原型 177–192 行开关逻辑
- 输出：
  - `src/web/InlineAttribution/AttributionConfig.tsx`：`AttributionConfigProvider`（持有 `show_memory_attribution` 默认 true、`attribution_level` 默认 `full`）+ `useAttributionConfig()`（返回 `{ level, isVisible(kind) }`，其中 `kind='aging'|'evidence_thin'` 时 `isVisible` 恒 true）
  - `AttributionToggle.tsx`：full / token_only / off 三段控件，切换给 toast（off 时提示「⚠ 证据警示仍强制显示 · 19.7」）
  - **注意**：本上下文是底层依赖，建议紧随 T2 落地；T3~T6、T8 在实现时即消费它决定可见性（即使任务编号在其后）
- 验收：`npm test -- AttributionConfig`（三 level 下 `isVisible` 矩阵：full 全 true；token_only 仅 aging/evidence_thin 类 true、其余 false；off 仅 aging/evidence_thin 类 true 其余 false）
- 边界：仅 `src/web/InlineAttribution/AttributionConfig.tsx` + `AttributionToggle.tsx` + 测试
- 依赖：T1；被 T3, T4, T5, T6, T8 依赖
- 提交：`feat(REQ-004): attribution config context + toggle`（含 T9）

## T10 宿主集成：对话演示页 + 入口 + 通览导航
- 目标：把四类标识嵌进「Claude Code 风格对话演示页」作为真实宿主，并接入通览页（从「规划中」提升为「已落地」）
- 说明：标记组件是**可复用 overlay**，任意回答渲染器均可内联使用；本任务的交叉演示页仅为 exercise harness，不绑定某一业务页
- 输入：T3~T9 组件、T9 `AttributionConfigProvider`；原型 `.agentframe` 布局；overview 导航（REQ-005 通览）
- 输出：
  - `src/web/InlineAttribution/AgentConversationDemo.tsx`：会话头 + 背景条 + 对话气泡内联 🧠/⚠️ + 底部 ⚡ + 💾，外层包 `AttributionConfigProvider` 并挂 `AttributionToggle`；注入示例 attribution 数据（对齐原型 MEM）
  - `src/web/InlineAttribution/inlineAttributionEntry.tsx` + `inlineAttribution.html` + `vite.config.ts` 增加 `inlineattribution` 入口
  - `src/web/overview/Overview.tsx`：把「Agent 界面内联标识」从 `PLANNED` 移到 `VIEWS`（src=`/inlineattribution.html`）
- 验收：`npm run typecheck` + `npm run test:e2e` 起手（演示页渲染 + 导航可达）
- 边界：仅 `src/web/InlineAttribution/`、`inlineAttribution.html` 入口、`vite.config.ts`、`Overview.tsx` 导航项
- 依赖：T3~T9；被 T11 / T12 依赖
- 提交：`feat(REQ-004): agent conversation demo + overview nav`（含 T10）

## T11 单元测试汇总（vitest 收口）
- 目标：补齐并收口 T1~T9 全部逻辑/组件单测，确保 `npm test` 绿
- 输入：T1~T9 全部产出
- 输出：各 `*.test.ts(x)`（类型 + decay + 四类标记 + 反馈 + 摘要 + 配置上下文）
- 验收：`npm test`（全量，含 REQ-004 新增用例）
- 边界：仅测试文件
- 依赖：T1~T9
- 提交：`test(REQ-004): unit tests for inline attribution`（含 T11）

## T12 真浏览器 E2E（Playwright 点击级）
- 目标：在真实浏览器验证四类标识渲染、开关降级（诚实约束）、弹层干预、背景展开、token 分解
- 输入：T10 演示页；规格 §5 验收用例；AC-004
- 输出：`e2e/inlineAttribution.spec.ts`：
  - 回答内联 🧠 + hover 弹层（memory_id/L2/衰减/可干预）
  - 底部 ⚡ 省 token + 分解展开
  - 会话头 📎 展开背景列表
  - 切 `token_only` → ①🧠 隐藏、⚡⚠💾 仍在；切 `off` → ①②③💾 隐藏、**⚠ 恒显示**（诚实约束）
  - 点「忘记/记住」→ toast + `onFeedback` 回调；点 request_id → `onOpenAudit` 回调
  - 无脚本异常
- 验收：`npm run test:e2e`（含本 spec，e2e 总数 +1）
- 边界：仅 `e2e/inlineAttribution.spec.ts`
- 依赖：T10, T11
- 提交：`test(REQ-004): inline attribution e2e`（含 T12）
