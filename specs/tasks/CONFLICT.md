# REQ-006 / P7 冲突裁决页 — 任务拆分（原子任务 · 供 Agent 执行）

> 来源：`specs/需求规格书_其余页面字段级交互规格.md` §P7 冲突裁决页（12.1 / 9.7 / 16.2 / 18.2-E）。
> REQ-006 是 9 子页大伞；本文件只做 **P7 冲突裁决页**（继 P8/P2/P11/P4 之后的下一个子页）。
> 实现基线：沿用「原型驱动 + 逻辑层纯函数单测 + 后端 mirror 注入点」模式，复用暗色设计系统。
> 数据来源：本地种子 + 内存态为真相；后端 mirror 可选 fire-and-forget，无端点时 safe-noop。
> 裁决动作写 `old_id/new_id` 成对审计（18.4 约束5），落库/展示属 P11（已建，本页只产审计占位）。

---

## 边界总览（全任务共享）
- 新增：`dispute.html`（Vite 入口）、`src/web/dispute/**`、`specs/tasks/CONFLICT.md`
- 修改：`vite.config.ts`（加 `dispute` entry）、`src/web/overview/Overview.tsx`（导航 + 计数 7→8）
- 不动：已有各页自身、内核其它模块（越界即违规）

---

## T1 脚手架与导航接入
- 目标：建立冲突裁决页空壳并能被 Overview 导航到达
- 输出：`dispute.html`、`src/web/dispute/disputeEntry.tsx`、`DisputePage.tsx`（空壳）、`theme.css`、`vite.config.ts` 加 `dispute: 'dispute.html'`、`Overview.tsx` VIEWS 加 `{ id:'dispute', ic:'⚖️', lbl:'冲突裁决页', desc:'P7 · 人工审核队列 + 9.7 三模式', src:'/dispute.html', req:'REQ-006' }` + 计数 +1
- 验收：`npm run build` 含 dispute 产物；vitest 挂载测试渲染标题
- 提交：`feat(REQ-006/P7-T1): 冲突裁决页脚手架与导航接入`

## T2 数据模型 + 种子 + 纯逻辑层（核心，纯函数 + 单测）
- 目标：定义冲突条目类型、四枚举、种子、纯函数
- 输出：
  - `src/web/dispute/types.ts`：`ConflictRecord`（id/old_id/new_id/old_content/new_content/old_confidence/new_confidence/conflict_type/conflict_score/dispute_flag/overdue_days/replaced_by/replaced_at/created_at）、`ConflictType`（direct_contradiction/partial_overlap/context_dependent/uncertain）、`Verdict`（auto_override/user_confirm/merge/hold）
  - `src/web/dispute/seed.ts`：`SEED_CONFLICTS`（覆盖 4 种 conflict_type + 1 条超期>7d + 1 条已替代带 replaced_by）+ `CONFIRM_TYPE_LABEL`
  - `src/web/dispute/logic.ts` + `logic.test.ts`：
    - `typeLabel(t)` → 中文（9.7 四类可读化）
    - `overdueDays(created)` → 距今天数；`isOverdue(r)` → >7d 高亮（12.1）
    - `applyVerdict(rec, v)` → 9.7 三模式 + 保留：
      - auto_override：旧→deprecated、new `trust+0.1`、`replaced_by` 回填、`old_id/new_id` 成对（18.4 约束5）
      - user_confirm：保留旧值，new 挂 dispute
      - merge：两条均 deprecated，生成合并记忆
      - hold：维持 dispute
    - `auditPair(rec, v)` → old_id/new_id 成对审计对象（16.2）
- 验收：`npm test -- dispute/logic` 全绿（4 类标签 / 超期判定 / 各 verdict 迁移 / 成对审计）
- 提交：`feat(REQ-006/P7-T2): 冲突数据模型 + 种子 + 纯逻辑层`

## T3 队列组件（筛选/超期排序/左右分栏对比）
- 目标：实现 §P7 队列字段（dispute 筛选、超期排序高亮、old/new 左右分栏、conflict_type 徽标、conflict_score>0.7、替代回填展示）
- 输出：`DisputeQueue.tsx` + 组件测试（筛选/排序/左右对比/conflict_score 徽标/超期高亮）
- 提交：`feat(REQ-006/P7-T3): 冲突队列（筛选/超期/左右分栏）`

## T4 裁决操作区（9.7 三模式 + 保留 + 成对审计）
- 目标：实现 §P7 裁决操作（确认新值/确认旧值/合并/保留争议）+ 成对审计钩子 + toast
- 输出：`DisputeVerdict.tsx` + 组件测试（各 verdict 触发回调 / 已替代记忆禁用再裁决 / 成对审计）
- 提交：`feat(REQ-006/P7-T4): 冲突裁决操作（9.7 三模式 + 成对审计）`

## T5 页面编排 + mirror 注入 + 组合 E2E
- 目标：队列(T3) + 裁决(T4) 联动 + `useDisputeMirror`（safe-noop）+ `e2e/dispute.spec.ts` 自包含
- 验收：`npm run test:e2e --workers=1` 该 spec 绿；`npm run verify` 全绿
- 提交：`feat(REQ-006/P7-T5): 冲突裁决页编排 + 自包含 E2E`

---

## 拆分说明
- 本拆分**只做 P7**；与 P11（监控"待裁决"→P7、审计 old_id/new_id）天然联动，但本页只产审计占位，不落地审计库。
- 「合并记忆生成」为占位（merge 后标注 generated，真实合并落库属 P8/内核后置）。
