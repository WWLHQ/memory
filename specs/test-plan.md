---
title: 测试标准
status: active
---

# 测试标准（多 Agent 记忆助手）

> 每条 TC 对应一条 AC。自动化运行器：**Vitest（单测/组件）+ Playwright（E2E，CDP 外部浏览器）**。
> 门禁命令见文末「当前自动化门禁」；本文命令均在仓库根执行。

## TC-001 产品定位评审
对应 AC-001：评审通过产品定位文档。

## TC-002 租户隔离测试
对应 AC-002：构造多租户数据，验证隔离与无串档。

## TC-003 Agent 接入配置测试（字段级）
对应 AC-003：覆盖 AC-003.1~AC-003.10。运行环境：Vitest + jsdom；命令 `npx vitest run src/agentOnboard`。
- TC-003.1 状态机流转（AC-003.3）：`npx vitest run src/agentOnboard/__tests__/stateMachine.test.ts`
- TC-003.2 校验 R1 租户禁手填（AC-003.1）：`validators.test.ts` → checkR1
- TC-003.3 校验 R2 project_id 必填（AC-003.5）：`validators.test.ts` → checkR2
- TC-003.4 校验 R3 critical 禁极简（AC-003.5）：`validators.test.ts` → checkR3
- TC-003.5 校验 R4 双通道至少一（AC-003.6）：`validators.test.ts` → checkR4
- TC-003.6 校验 R5 密钥不回流（AC-003.7）：`validators.test.ts` → checkR5
- TC-003.7 校验 R6 熔断联动降级（AC-003.3/AC-003.6）：`validators.test.ts` → checkR6
- TC-003.8 校验 R7 request_id 审计（AC-003.8）：`validators.test.ts` → checkR7
- TC-003.9 校验 R8 只读召回/P2 确认（AC-003.4）：`validators.test.ts` → checkR8
- TC-003.10 校验 R9 可撤销（AC-003.4）：`validators.test.ts` → checkR9
- TC-003.11 校验 R10 限本机（AC-003.4）：`validators.test.ts` → checkR10
- TC-003.12 全量汇总（R1–R10 基线全绿）：`npx vitest run src/agentOnboard`

## TC-004 内联标识测试
对应 AC-004：四类标识按规范渲染。

## TC-005 首页/登录测试
对应 AC-005：首页直达与租户上下文一致。

## TC-006 其余页面测试
对应 AC-006：写入/查重/冲突裁决字段交互符合预期。

## TC-007 内核 API 测试
对应 AC-007：端壳注入与核心 API 契约回归通过。

## TC-008 云同步测试
对应 AC-008：多端同步一致性 + 冲突对账收敛。
- 引擎层（SyncHub / PgSyncHub / syncUp / syncDown / reconcile）已有单测且全绿。
- **生产接线状态：未接线（本版本明确不提供云端同步）。** 内核 `MemAgent.sync()` 明确抛 `E_NOT_IMPLEMENTED` 并写 `implemented:false` 审计；首页顶栏/仪表盘显示「同步未实现（本版本不提供云端同步）」，不得展示「已同步」。接线前不得把引擎单测当作端到端同步验收。

## TC-009 大模型/净化页测试
对应 AC-009：配置与净化页字段交互符合规格。

## TC-010 遗忘机制测试
对应 AC-010：遗忘操作可见且生效。
- 引擎：`runForgettingCycle`（层迁移 / 重复识别合并 / 冷压缩）+ 单测覆盖跨项目、跨团队、跨租户拒绝合并，以及 17.6 `auto_merge=false` 类别不自动合并。
- 调度（批次48 A23.2）：Electron 主进程单 tick（默认 60s）评估四个 cron 任务（衰减/裁决提醒/自生长/归档），时刻真源 `shared/growthConfig.ts#SCHEDULE_TASKS`，cron 计算纯函数 `shared/cron.ts`；每次执行写 `schedule_run` 审计。`MAM_SCHEDULE_DISABLED=1` 全关，`MAM_FORGETTING_DISABLED=1` 只关衰减/归档，`MAM_SCHEDULE_TICK_MS` / `MAM_SCHEDULE_FIRST_DELAY_MS` 可调。
- 参数页知识库策略表（半衰期/归档/合并）目前只保存为偏好记忆，尚未被调度消费。

## TC-011 日志页测试
对应 AC-011：日志数据模型与交互符合规格。

## TC-012 检索页测试
对应 AC-012：状态机与 scene 联动符合规格。

## TC-013 数据存放位置测试（批次 6）
对应 AC-013：数据存放位置可指定、可迁移，且全部应用数据真实挂载在所选数据根。
目标：安装后首次启动即引导用户指定数据根，且全部应用数据确实挂载在该位置。
- 单元：`src/electron/__tests__/dataRoot.test.ts` 覆盖指针读写/损坏、路径校验（绝对/相对/UNC，win32/posix）、可写探测、旧数据探测、白名单迁移（默认跳过、旧 `dbDir`、覆盖前 `.bak`）。
- 手测：见 `specs/MANUAL-TEST.md` §4.1 与 `specs/MANUAL-TEST-FIX-BATCH-6.md`。

## TC-014 管理员权限 + 全链路动作日志（批次 7）
对应 AC-014：内置管理员拥有全部权限；敏感操作仅管理员可执行；任何动作可在 `actions.log` 追溯。
- 单元（账号/权限）：`src/auth/__tests__/admin.test.ts`（播种/升级/不覆盖密码、最后一个管理员保护、团队分配、改密规则、快照迁移）与 `src/home/__tests__/admin.test.ts`（401/403 鉴权矩阵、角色/团队变更审计、重启保留、HTTP 日志）。
- 单元（日志）：`src/shared/__tests__/actionLog.test.ts`（脱敏/截断/循环/单行格式）、`src/electron/__tests__/actionLog.test.ts`（落盘/轮转/失败静默）、`src/desktop/__tests__/hostBridge.test.ts`（`hostLog` native/bridge/无宿主三态）。
- 页面门禁：`src/web/security/__tests__/SecurityPage.test.tsx`（管理员可改；成员只读且不落账）。
- E2E：`e2e/security.spec.ts`（未登录/成员/管理员三态 + 真实后端账号表 + 改密失败提示 + 策略变更审计）。
- 手测：见 `specs/MANUAL-TEST-FIX-BATCH-7.md`。

---

## 自我净化与生长页 · 判重权重回归（批次48 A23.3）

用户已确认的 6 条定义（原方案落地，`src/core/memagent/regression.ts`）：
1. 目标函数 = 写入期「合并 / 不合并」二分类 **F1**（positive = 合并）。
2. 成功门槛 = 测试集 F1 提升 ≥ 0.02 **且** precision 下降 ≤ 0.05，两者同时满足才采纳。
3. 样本不足（总数 < 40 或负例 < 10）→ 不调整，写 `insufficient_samples` 审计并带 counts。
4. 允许同时调整权重与阈值（阈值限 [0.50,0.95]、六层单调不减、末尾合法性校验，不合法回滚）。
5. 反馈时间窗 30 天，同一记忆多次写入/反馈取最近一次。
6. 冷启动不回溯推断历史五维分：只采信写入审计里的 `dedup_eval`（schema_v=1 + dims + policy 快照），
   旧账本记录一律不参与；样本不足期间如实 no-op。

自动化覆盖：
- `src/core/memagent/__tests__/regression.test.ts`：窗口/schema 版本/取最近一次、样本不足（总数与负例两种）、
  确定性 70/30 哈希划分、阈值 0.9→0.5 采纳、已最优未达门槛、classify 指标、`insufficient_samples` 与
  `weight_tuned` + `param_save` 落账（账本配置真变）。
- `src/web/growth/__tests__/scheduleRuns.test.ts`：四态投影（never_run / insufficient_samples / not_adopted /
  adopted）与 `regressionStatusText` 四态文案两两不同；冷启动文案必须含「正在积累样本，非故障」。
- `src/web/growth/__tests__/GrowthPage.test.tsx`：空账本手动触发 → 只写 `insufficient_samples`、不产生 `weight_tuned`。
- `e2e/growth.spec.ts`：页面先显示「未到运行时间」；手动触发后显示「样本不足 · 积累样本」，Δ 曲线保持空态。

审计字段（全部真实可查）：`insufficient_samples`（kind/counts/minimum）、`weight_regression`
（kind/status/reason/counts/before/after/proposed）、`weight_tuned`（kind/status/counts/before/after 配置快照/metrics）。

---

## 生长页 · Web 端调度架构与「未调度」标注（批次48 A23.4）

- 调度唯一宿主 = 桌面端 Electron 主进程；Web 端不执行调度、不设置定时器，只读展示配置与账本。
- 三件事必须可见：**调度宿主**（审计 `host` 优先）、**最近一次 `schedule_run` 审计时间**、**下次到期**（审计 `next_due_at`）。
- 无记录一律「尚未运行（账本无 schedule_run 记录）」「下次到期 —（无记录）」，禁止由 cron 反推。
- 页面任何位置不出现「已调度」；启停开关只写 `growth:v1` 配置，不代表已调度。

自动化覆盖：
- `src/web/growth/__tests__/GrowthPage.test.tsx` 的「ScheduleTimeline × 调度架构与未调度标注」：无记录三处文案 + 架构说明；
  有真实审计时按审计时间/`next_due_at`/`host` 展示；两例均断言卡片文本不含「已调度」。
- `e2e/growth.spec.ts`：Web 端 `sched-arch` 含「调度由桌面端执行」「本页不执行调度」，`sched-run-self_growth`
  含「尚未运行」「schedule_run 记录」，`sched-next-self_growth` 含「无记录」，`sched-host-self_growth` 含
  「Web 端不执行调度」，且 `schedule-timeline` 不含「已调度」。

---

## 当前自动化门禁（2026-10-30）

| 命令 | 内容 | 通过标准 |
|---|---|---|
| `npm run typecheck` | 渲染/内核（tsconfig）+ Electron（tsconfig.electron）双配置 `tsc --noEmit` | 0 错误 |
| `npm run lint` | oxlint correctness 规则（含 react-hooks） | 0 error |
| `npm test`（= `npx vitest run`） | **149 个测试文件 / 1754 条用例**（2026-11-04 41-T 轮实测；每批都变，以 `npm run verify:fast` 输出为准） | 全绿 |
| `npm run test:coverage` | vitest + v8 覆盖率（排除 Electron 主进程胶水与页面入口，由 E2E 覆盖） | 行 ≥74% / 语句 ≥71% / 函数 ≥67% / 分支 ≥61% |
| `npm run test:e2e` | 先 `vite build`，再用 Playwright（`workers=1`，CDP 外部 Chromium）跑 **22** 个 spec（`ls e2e/*.spec.ts` 现查） | 全绿 |
| `npm run verify:fast` | typecheck + lint + 覆盖率单测 | 全绿且达阈值 |
| `npm run verify` | verify:fast + `build:electron` + E2E | 全绿 |

E2E 约定：
- 所有 spec 的静态服务与后端均监听 **端口 0（系统分配）**，不再固定占用 8123–8142 / 8200–8205，可与已运行的桌面应用并存。
- `beforeAll` 失败时 `afterAll` 通过 `staticSrv?.stop()` / `closeServer()` / `stopRunningServer()` 安全收尾。
- `globalSetup`/`globalTeardown` 按 `process.platform` 选择 `netstat`+`taskkill`（Windows）或 `lsof`+`process.kill`（POSIX）。
- `layered-preview.spec.ts` 用 `pathToFileURL` 按仓库相对路径定位预览页，不依赖盘符。
