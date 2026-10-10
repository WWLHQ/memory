# REQ-006 / P4 生命周期页 — 任务拆分（原子任务 · 供 Agent 执行）

> 来源：`specs/需求规格书_其余页面字段级交互规格.md` §P4 生命周期页（9.10 / 17.4 / 17.5）。
> REQ-006 是 9 子页大伞；本文件只做 **P4 生命周期页**（继 P8/P2/P11 之后的下一个子页）。
> 实现基线：沿用「原型驱动 + 逻辑层纯函数单测 + 后端 mirror 注入点」模式，复用暗色设计系统。
> 数据来源：本地种子 + 内存态为真相；后端 mirror 可选 fire-and-forget，无端点时 safe-noop。

---

## 边界总览（全任务共享）
- 新增：`lifecycle.html`（Vite 入口）、`src/web/lifecycle/**`、`specs/tasks/LIFECYCLE.md`
- 修改：`vite.config.ts`（加 `lifecycle` entry）、`src/web/overview/Overview.tsx`（导航 + 计数 6→7）
- 不动：已有各页自身、内核其它模块（越界即违规）

---

## T1 脚手架与导航接入
- 目标：建立生命周期页空壳并能被 Overview 导航到达
- 输出：`lifecycle.html`、`src/web/lifecycle/lifecycleEntry.tsx`、`LifecyclePage.tsx`（空壳）、`theme.css`、`vite.config.ts` 加 entry、`Overview.tsx` VIEWS 加 `{ id:'lifecycle', ic:'⏳', lbl:'生命周期页', desc:'P4 · 六态机 + 调参', src:'/lifecycle.html', req:'REQ-006' }` + 计数 +1
- 验收：`npm run build` 含 lifecycle 产物；vitest 挂载测试渲染标题
- 边界：仅 `lifecycle.html` / `src/web/lifecycle/`(空壳+theme) / `vite.config.ts` / `Overview.tsx`
- 提交：`feat(REQ-006/P4-T1): 生命周期页脚手架与导航接入`

## T2 数据模型 + 种子 + 纯逻辑层（核心，纯函数 + 单测）
- 目标：定义生命周期记录类型（复用 P8 MemoryRecord 形状扩展）、种子、纯函数
- 输出：
  - `src/web/lifecycle/types.ts`：`LifecycleRecord`（id/content/status 六态/replaced_by/replaced_at/half_life_days/confidence/importance/access_count/reinforce_count/pinned/locked/decay_class/ageDays）、`LifeOp`（migrate/archive/batch_migrate/param）
  - `src/web/lifecycle/seed.ts`：`SEED_LIFECYCLE`（覆盖六态 + 1 条 deprecated 带 replaced_by + N/M 默认 90/180）
  - `src/web/lifecycle/logic.ts` + `logic.test.ts`：
    - `freshnessPreview(ageDays, halfLifeDays)` = 0.5^(age/hl)，下限 0.05（17.5）
    - `STATUS_FLOW`（9.10.1 六态机）+ `canMigrate(status, target)` 合法迁移校验
    - `applyLifecycle(rec, op)` → migrate（写审计 lifecycle_change + request_id）/ 调参（half_life>0 下限钳制、confidence 下限 0.05、importance 下限 0.1）/ 批量迁移；`locked` 记忆面板全置灰（仅展示不可写，G4）
    - `importanceLevel(importance)` → 1–5 级映射（15.1）
    - `staleThreshold` 检查：hibernating N=90d / archived M=180d（9.10.1）
- 验收：`npm test -- lifecycle/logic` 全绿（六态迁移合法/非法、freshness、下限钳制、locked、N/M）
- 边界：仅 `src/web/lifecycle/{types,seed,logic}.ts`(+test)
- 提交：`feat(REQ-006/P4-T2): 生命周期数据模型 + 种子 + 纯逻辑层`

## T3 状态查看器组件（六态机只读展示）
- 目标：实现 §P4 状态查看器（选中高亮、六态可执行迁移提示、deprecated 关联 replaced_by 跳转、N/M 参数展示）
- 输出：`LifecycleCard.tsx` + 组件测试（六态渲染、migrate 按钮按 canMigrate 禁用、deprecated 显示替代链接、N/M 默认值）
- 验收：组件测试覆盖 合法/非法迁移禁用、deprecated 展示
- 边界：仅 `src/web/lifecycle/LifecycleCard.tsx`(+test)
- 提交：`feat(REQ-006/P4-T3): 生命周期状态查看器`

## T4 调参面板组件（sliders + locked 置灰）
- 目标：实现 §P4 调参面板（half_life/confidence/importance 滑杆实时刷新 freshness 预览、pinned/locked 开关、decay 徽标、access/reinforce 只读分家、locked 后全部置灰）
- 输出：`ParamPanel.tsx` + 组件测试（滑杆 onChange → onParam、locked → 全部 disabled + 提示文案、freshness 预览随参数刷新）
- 验收：组件测试覆盖 locked 置灰 / freshness 联动
- 边界：仅 `src/web/lifecycle/ParamPanel.tsx`(+test)
- 提交：`feat(REQ-006/P4-T4): 生命周期调参面板`

## T5 页面编排（列表 + 批量迁移）+ mirror 注入 + 组合 E2E
- 目标：生命周期列表（复 P8 风格）+ 选中联动查看器/调参面板 + 批量迁移（勾选多条 → 如 stale→archived，写审计 lifecycle_change + request_id）+ `useLifecycleMirror`（safe-noop）+ `e2e/lifecycle.spec.ts` 自包含
- 验收：`npm run test:e2e --workers=1` 该 spec 绿；`npm run verify` 全绿
- 边界：仅 `src/web/lifecycle/{LifecyclePage,useLifecycleMirror}.ts(x)` + `e2e/lifecycle.spec.ts`
- 提交：`feat(REQ-006/P4-T5): 生命周期页编排 + 批量迁移 + 自包含 E2E`

---

## 拆分说明
- 本拆分**只做 P4**；与 P8（记忆管理列表）共享部分字段模型但独立实现（跨页复用后置）。
- 跳转「生命周期页调参（带 memory_id）」即本页；审计落库/展示属 P11（已建，本页只产审计动作占位）。
