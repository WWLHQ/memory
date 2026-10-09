# 原子任务：首页与登录卡片（REQ-005）

> 本文件是 `meta/TASK_SPLITTING.md` 规范在 **REQ-005（UI 信息架构与首页/登录）** 上的真实再创作。
> 来源：[需求规格书_UI页面设计.md](需求规格书_UI页面设计.md) 第 0 章（§0.1 全局租户上下文 / §0.2 首页 / §0.3 登录卡片）、[需求规格书.md](需求规格书.md) 第 18.2 / 19.x 章、[设计/ui/登录与首页_原型.html](设计/ui/登录与首页_原型.html)、[设计/ui/index.html](设计/ui/index.html)。
> 拆分原则：越底层越先（类型/租户上下文/密码哈希纯逻辑）→ 越纯越先（登录业务/锁定/仪表盘聚合）→ UI 组件 → 集成 → E2E。每个任务可被一条命令验收，单独提交。
> 技术栈：TS 内核 + React 19 UI + Rust/WASM 向量层（19.11）；验收命令：`npm run typecheck`（tsc strict）/ `npm test`（vitest）/ `npm run test:e2e`（Playwright）。**UI 硬约束**：结构/样式/文案/交互严格对齐 `design/ui/登录与首页_原型.html`（`.topbar/.pill/.gains/.gain/.dash-grid/.stat/.login-modal/.rid/.toast` 等 class 与 `data-*` 交互点须保留）。
> 复用：端形态自动识别（19.10）复用 `src/agentOnboard/formMatrix.ts` 的 `detectForm`；功劳 4 卡复用 `src/web/AgentOnboard/Gains.tsx`（与 REQ-003 效果证据区同构，避免重复实现）。跨 REQ 依赖：租户隔离语义归属 **REQ-002**，本文件仅消费 `TenantContext`，不重新定义隔离规则。

---

## 执行工作流（REQ-005 落地纪律 · 用户约定）

> 每个原子任务**严格按以下顺序执行**，前一步不过不进下一步：
> 1. **测试已提前规划**：本文件每个任务的「验收（提前规划的测试）」块已写明测试文件、用例清单、验收命令——实现前即确定"怎么算过"。
> 2. **实现本任务代码**（仅动该任务边界内的文件）。
> 3. **先跑本任务验收命令，必须全绿**（不跑全量掩盖单任务问题）：
>    - 纯逻辑/类型：`npm run typecheck` + `npm test -- <tag>`
>    - UI 组件：`npm test -- <Component>`
>    - 后端：`npm test -- <server>`
>    - E2E：`npm run test:e2e`（对应 spec 文件）
> 4. **请人工确认**：展示该任务的测试结果 + 代码 diff 摘要，等你明确确认。
> 5. **确认后才进入下一任务**；测试不过绝不请确认，也绝不进下一任务。

---

## T1 全局租户上下文 + 首页领域类型
- 目标：定义 REQ-005 全部领域类型，作为后续任务的契约基线；落地 §0.1 全局上下文与首页数据形状
- 输入：REQ-005 规格 §0.1（enterprise_id/team_id/user_id/session_id/视角）/ §0.2（顶栏/同步态/功劳/异常/活跃/待办）/ §0.3（登录字段）
- 输出：`src/types/home.ts`：
  - `TenantContext = { enterprise_id: string; team_id: string; user_id: string; perspective: 'personal'|'team'|'enterprise'; session_id: string }`（团队只读，用户不可自选，P12）
  - `SyncState = { form: Form; role: 'primary'|'mirror'|'offline'; lastReconcileAt: number; pendingSync: number }`（离线端显示"离线 N 条待回传"，19.11 §5）
  - `LoginForm = { account: string; password: string; form: Form }`（form 自动识别只读）
  - `LoginResult = { ok: true; context: TenantContext } | { ok: false; reason: 'empty'|'no_account'|'wrong'|'locked'; lockedUntil?: number }`
  - `HomeDashboard = { gains: Gain[]; anomalies: AnomalyItem[]; activeMemories: ActiveMemory[]; todos: TodoItem[] }`
  - `Gain` 与 REQ-003 共用（同 4 指标口径 19.7）
- 验收（提前规划的测试）：`src/types/__tests__/home.test.ts` + `npm run typecheck` + `npm test -- types/__tests__/home`
  - [ ] `TenantContext` 必含 enterprise_id/team_id/user_id/session_id/perspective 五字段；`perspective` 仅 personal/team/enterprise 三值
  - [ ] `SyncState.role` 三态；`offline` 时 `pendingSync >= 0`
  - [ ] `LoginResult` 两分支类型可区分（ok:true 带 context / ok:false 带 reason 枚举）
  - [ ] `HomeDashboard` 四区块字段齐全；`Gain` 形状与 REQ-003 `Gains` 一致（🪙/⚡/🔁/💸）
  - [ ] `tsc --noEmit` 零错误
- 边界：仅 `src/types/`、`src/types/home.ts`
- 依赖：无（复用 `Form`/`FormBadge` 来自 agentOnboard）；被 T2~T9 全部依赖
- 提交：`feat: define home & tenant-context types`（message 含 T1）

## T2 密码哈希与校验（4.1 安全）
- 目标：实现密码哈希与校验纯函数，满足"哈希存储、传输加密、界面不回显"
- 输入：哈希库文档（bcrypt / argon2 / 平台密钥链）；规格 §4.1
- 输出：`src/auth/hash.ts` → `hashPassword(plain): string`、`verifyPassword(plain, hash): boolean`（常量时间比较，防时序）
- 验收（提前规划的测试）：`src/auth/__tests__/hash.test.ts` + `npm test -- auth/__tests__/hash`
  - [ ] `hashPassword(plain)` 产出非明文，且同明文两次哈希结果不同（含 salt）
  - [ ] `verifyPassword(plain, hash)` 对正确密码返回 true
  - [ ] `verifyPassword(错密码, hash)` 返回 false
  - [ ] 防时序：正确/错误密码的 verify 耗时差在阈值内（多次采样取均值比对）
  - [ ] 空密码 / 含特殊字符密码不崩
- 边界：仅 `src/auth/hash.ts` + 其测试
- 依赖：T1（类型）；被 T3 依赖
- 提交：`feat: password hash & verify`（含 T2）

## T3 登录业务逻辑 + 锁定策略（4.2）
- 目标：实现登录校验、失败锁定、注入租户上下文、记审计；确定同步身份（user_id + 管理员分配 team_id）
- 输入：T1 `LoginForm`/`LoginResult`/`TenantContext`、T2 `verifyPassword`；规格 §0.3（错 5 次锁 15min，4.2）、§4.3（审计 action=login · form:<端>）
- 输出：`src/auth/loginService.ts` → `login(input: LoginForm): LoginResult`（含内存锁定表：连续失败≥5 → 锁 15min；账号不存在→no_account；团队只读不在此选择）；`lockoutState(account)`
- 验收（提前规划的测试）：`src/auth/__tests__/login.test.ts` + `npm test -- auth/__tests__/login` ✅ 9 passed
  - [x] 正确账号密码 → `ok:true` 且 `context.user_id`=输入账号、`context.team_id`=管理员分配只读值（非用户输入）
  - [x] 账号空 → `reason:'empty'`
  - [x] 账号不存在 → `reason:'no_account'`
  - [x] 密码错 → `reason:'wrong'`
  - [x] 连续错 5 次 → 第 6 次 `reason:'locked'` 且 `lockedUntil` 在未来；锁定期内任何尝试均 `locked`
  - [x] 锁定到期后可重试
  - [x] `LoginForm` 无 team_id 字段（团队只读，不来自用户输入）
  - [x] 成功路径产出审计描述：`action=login` 且带 `form`
- 边界：仅 `src/auth/` + 测试（审计通过注入后端，本任务只产出 action 描述，不直连 DB）
- 依赖：T1, T2；被 T5 / T9 / T10 依赖
- 提交：`feat: login service & lockout`（含 T3）
- 状态：✅ 已实现并验收（typecheck 0 错；T3 9 测全绿；T1 9 + T2 6 回归全绿）。待人工确认后进 T4。

## T4 首页 Dashboard 数据聚合（纯函数）
- 目标：把后端/镜像数据组装成首页四大区块；未登录返回灰置占位；数字可溯源 request_id
- 输入：T1 `HomeDashboard`；规格 §0.2（功劳 4 卡 / 异常速览置顶 error / 活跃记忆 TopN + decay_class / 待办 9.7 + 反代理额度）
- 输出：`src/home/dashboard.ts` → `buildDashboard(ctx: TenantContext | null, raw): HomeDashboard | null`（ctx 为 null → 返回 null，UI 据此灰置）；每个异常/记忆/待办带 `request_id` 溯源字段
- 验收（提前规划的测试）：`src/home/__tests__/dashboard.test.ts` + `npm test -- home/__tests__/dashboard` ✅ 7 passed
  - [x] `ctx=null` → 返回 `null`（UI 灰置）
  - [x] `ctx` 有效 + raw → 四区块（gains/anomalies/activeMemories/todos）齐全
  - [x] 异常列表按 `error` 置顶（熔断 OPEN / 同步失败在最前）
  - [x] 每个异常/记忆/待办项 `request_id` 非空（可溯源）
  - [x] 活跃记忆带 `decay_class`（hot/warm/cold）
  - [x] 待办含 9.7 待裁决数 + 反代理额度字段
- 边界：仅 `src/home/` + 测试
- 依赖：T1；被 T7 依赖
- 提交：`feat: home dashboard aggregator`（含 T4）
- 状态：✅ 已实现并验收（typecheck 0 错；T4 7 测全绿）。待人工确认后进 T5。

## T5 全局租户上下文 Provider（React）
- 目标：把登录得到的 `TenantContext` 注入 React 上下文，全页可读；团队只读、不可改
- 输入：T1 `TenantContext`、T3 `login`；规格 §0.1（视角矩阵过滤可见范围）/ §0.3（团队只读）
- 输出：`src/web/Home/tenantContext.tsx` → `TenantProvider`、`useTenant()`（返回 context 或 null=未登录）、`useLogin()`/`useLogout()`（调用 T3/T9 后端）
- 验收（提前规划的测试）：`src/web/Home/__tests__/tenantContext.test.tsx` + `npm test -- Home/__tests__/tenantContext` ✅ 6 passed
  - [x] 未登录 `useTenant()` 返回 `null`
  - [x] 登录后子组件 `useTenant()` 读到非 null context
  - [x] 登出后 `useTenant()` 回到 `null`
  - [x] `context.team_id` 只读（无 setter / 试图改写不生效）
  - [x] `useLogin`/`useLogout` 触发注入后端调用（mock）
- 边界：仅 `src/web/Home/tenantContext.tsx` + 测试
- 依赖：T1, T3；被 T6 / T7 / T8 / T9 依赖
- 提交：`feat: tenant context provider`（含 T5）
- 状态：✅ 已实现并验收（typecheck 0 错；T5 6 测全绿）。待人工确认后进 T6。

## T6 首页顶栏组件（登录态自适应）
- 目标：渲染顶栏：未登录「欢迎使用 · 未登录 · [▶ 登录]」；已登录「你好 user_001 · 团队 team_001（只读）· 当前端[桌面·主源] · 已同步 · [登出]」
- 输入：T1 `TenantContext`/`SyncState`、T5 `useTenant`；原型 `.topbar`/`.hi`/`.pill.ok`/`.btn` + `btnOpenLogin`/`btnLogout`/`syncPill`
- 输出：`src/web/Home/TopBar.tsx` + 组件测试
- 验收（提前规划的测试）：`src/web/Home/__tests__/TopBar.test.tsx` + `npm test -- Home/__tests__/TopBar` ✅ 5 passed
  - [x] 未登录：渲染「欢迎使用…未登录」+ `▶ 登录` 按钮；`hiAuth`/`syncPill`/`登出` 隐藏
  - [x] 已登录：渲染 `hiAuth`（含 user_001 / team_001）+ `syncPill` + `登出`；`▶ 登录` 隐藏
  - [x] 点击 `▶ 登录` → 触发 `onLogin` 回调
  - [x] 点击 `登出` → 触发 `onLogout` 回调
  - [x] 团队文案只读（无编辑控件）
- 边界：仅 `src/web/Home/TopBar.tsx` + 测试
- 依赖：T1, T5；被 T9 依赖
- 提交：`feat: home TopBar`（含 T6）
- 状态：✅ 已实现并验收（typecheck 0 错；T6 5 测全绿）。待人工确认后进 T7。

## T7 首页 Dashboard 区块组件（功劳 + 异常 + 活跃 + 待办）
- 目标：渲染首页四区块；未登录整体灰置（`.gain.off` / `.off-placeholder`），已登录填数据；数字可点溯源 request_id（弹审计 modal，非常驻）
- 输入：T4 `buildDashboard`、T1 `Gain`（复用 REQ-003 `Gains.tsx`）、原型 `.gains`/`.gain`/`.dash-grid`/`.stat`/`.list`/`.rid`/`.off-placeholder` + `req_x1`/`req_x2`/`req_x3` 溯源点
- 输出：`src/web/Home/Dashboard.tsx`（含 `Gains` 复用 + `Anomalies`/`ActiveMemories`/`Todos` 子块）+ 组件测试
- 验收（提前规划的测试）：`src/web/Home/__tests__/Dashboard.test.tsx` + `npm test -- Home/__tests__/Dashboard` ✅ 5 passed
  - [x] 未登录：显示 `.off-placeholder`，4 卡/异常/活跃/待办不渲染数据
  - [x] 已登录：4 卡数据（🪙 -58% / ⚡ -34% / 🔁 3.2× / 💸 省¥19）+ 异常置顶 error + 活跃 Top3 + 待办
  - [x] 点击 `.rid` → 触发 `onTrace(request_id)` 回调
  - [x] 功劳 4 卡复用 `Gains`（渲染 🪙⚡🔁💸）
  - [x] 离线端（`pendingSync>0`）：显示「离线 N 条待回传」
- 边界：仅 `src/web/Home/Dashboard.tsx` + 测试（审计 modal 由全局 `useAuditModal` 提供，本任务只抛 `onTrace`）
- 依赖：T4, T1；被 T9 依赖
- 提交：`feat: home Dashboard blocks`（含 T7）
- 状态：✅ 已实现并验收（typecheck 0 错；T7 5 测全绿）。待人工确认后进 T8。

## T8 登录卡片组件（§0.3 弹出子视图）
- 目标：渲染登录弹卡：账号/密码/端形态(只读自动识别)/团队(只读)/登录方式(密码·扫码·系统密钥)；校验非空、错 5 次锁提示；记审计
- 输入：T1 `LoginForm`/`LoginResult`、T3 `login`、T5 `useLogin`；原型 `.login-modal`/`.login-box`/`#acc`/`#pwd`/`#btnLogin`/`#btnScan`/`#btnKey`/`#loginErr` + 端形态 `detectForm` 复用
- 输出：`src/web/Home/LoginModal.tsx` + 组件测试
- 验收（提前规划的测试）：`src/web/Home/__tests__/LoginModal.test.tsx` + `npm test -- Home/__tests__/LoginModal` ✅ 10 passed
  - [x] 默认隐藏；触发打开 → 显示 `.login-modal.show`
  - [x] 账号空 → 点登录显示「账号不能为空」且不调用 `login`
  - [x] 密码错 → 显示「密码错误，已记审计」+ `login` 被调用 + 锁定提示
  - [x] 正确 → 触发 `onSuccess(context)`
  - [x] 端形态只读（自动识别，无输入控件）
  - [x] 团队只读（无编辑控件）
  - [x] 扫码按钮 → `onScan` 回调 + toast
  - [x] 系统密钥按钮 → `onKey` 回调
  - [x] 关闭 `×` → 隐藏
- 边界：仅 `src/web/Home/LoginModal.tsx` + 测试
- 依赖：T1, T3, T5；被 T9 依赖
- 提交：`feat: login modal`（含 T8）
- 状态：✅ 已实现并验收（typecheck 0 错；T8 10 测全绿）。待人工确认后进 T9。

## T9 首页装配容器（HomePage）
- 目标：串起 TopBar + Dashboard + LoginModal；初始进入即首页（未登录态，不阻塞）；登录成功刷新为已登录数据；登出回灰置
- 输入：T5/T6/T7/T8；原型 `setAuthed(false)` 初始直接进入、`#btnOpenLogin` 弹卡、`#btnLogout` 复位
- 输出：`src/web/Home/HomePage.tsx` + `src/web/main.tsx` 路由接入（首页为默认路由）+ 集成测试
- 验收（提前规划的测试）：`src/web/Home/__tests__/HomePage.test.tsx` + `npm test -- Home/__tests__/HomePage` ✅ 5 passed
  - [x] 初始渲染未登录态（灰置），不阻塞登录
  - [x] 点 `▶ 登录` → 弹出 LoginModal
  - [x] 登录成功 → 整页刷新为已登录（TopBar 变 + Dashboard 出数据）
  - [x] 登出 → 回灰置
  - [x] 无控制台异常（收集 `console.error` 为空）
- 边界：仅 `src/web/Home/HomePage.tsx` + 测试（不改 auth/后端）
- 依赖：T5, T6, T7, T8；被 T11 / T12 依赖
- 提交：`feat: assemble HomePage`（含 T9）
- 状态：✅ 已实现并验收（typecheck 0 错；T9 5 测全绿）。待人工确认后进 T10。
- 路由接入说明（**已落地 · 用户"先进行首页路由"决策**）：`src/web/main.tsx` 现已挂载 `HomePage`（含 `useLoginMirror` + 种子 feed + `.rid` 溯源审计 modal），`index.html` 成为 REQ-005 首页（默认路由，覆盖 REQ-003 默认页）。REQ-003 接入页迁至独立入口 `agentonboard.html` + `src/web/AgentOnboard/agentonboardEntry.tsx`（保留其 E2E 验证，不受影响）。原 T12 E2E 临时入口 `home.html`/`homeEntry.tsx` 已删除，`e2e/home.spec.ts` 改访问 `index.html?backend=:8201`，`e2e/app.spec.ts` 改访问 `agentonboard.html`。

## T10 登录后端 HTTP 服务（零依赖，可选镜像）
- 目标：实现 `POST /api/login`：校验账号密码（调 T2/T3）、返回 `TenantContext`、写审计 action=login；`POST /api/logout` 写 action=logout；锁定表持久化
- 输入：T2 `verifyPassword`、T3 `loginService`、T1 类型；规格 §4.1/§4.3；对齐 REQ-003 `server.ts` 风格（node:http + JSON 持久化 + CORS）
- 输出：`src/home/server.ts` → `createServer({ port, dataFile })`（端点 `/api/login` `/api/logout` `/api/me`）；审计写入复用统一 audit 表（4.3.1 枚举 login/logout/login_fail/team_assign）
- 验收（提前规划的测试）：`src/home/__tests__/server.test.ts` + `npm test -- home/__tests__/server` ✅ 7 passed
  - [x] `POST /api/login` 正确 → 200 + 返回 `TenantContext`
  - [x] 密码错 → 401 + 审计含 `login_fail`
  - [x] 锁定期内 → 423
  - [x] 账号不存在 → 401/404
  - [x] `POST /api/logout` → 200 + 审计 `logout`
  - [x] `GET /api/me` 登录态返回 context，未登录 401
  - [x] 持久化：重启后锁定表 / 审计保留（`.data/`）
- 边界：仅 `src/home/server.ts` + 测试 + `.data/`（gitignore）；不改前端/校验/UI
- 依赖：T1, T2, T3；被 T11 依赖
- 提交：`feat: home login backend`（含 T10）
- 状态：✅ 已实现并验收（typecheck 0 错；T10 7 测全绿；全量 140 测无回归）。待人工确认后进 T11。
- 跨任务改动说明：为支持"锁定表持久化"，对 T3 `loginService.ts` 仅**加性**新增 `exportLockSnapshot`/`importLockSnapshot`（不改既有逻辑/测试）；对 T1 `home.ts` 的 `LoginAudit.action` 扩到 4.3.1 全枚举（login/login_fail/logout/team_assign）。二者均为 T10 所需，T1/T3 原测试不受影响（全量已验证）。

## T11 前端登录 API client（镜像）
- 目标：实现调用登录后端的前端 client，挂到 `useTenant` 的 login/logout；默认 `http://localhost:8200`，`?backend=` 可覆盖（对齐 REQ-003 `useBackendMirror`）
- 输入：T10 接口契约、T1 `LoginForm`/`LoginResult`；规格 §0.3（同步身份=账号+team_id）
- 输出：`src/web/Home/useLoginMirror.ts` → `useLoginMirror()`（login/logout 调后端，失败回退本地只读占位）；fire-and-forget，不改原型视觉
- 验收（提前规划的测试）：`src/web/Home/__tests__/useLoginMirror.test.tsx` + `npm test -- Home/__tests__/useLoginMirror` ✅ 6 passed
  - [x] `login()` → `fetch` `POST /api/login` 请求体含 `account`/`password`
  - [x] 成功 → 注入 `context`（经 TenantProvider 注入后端 context）
  - [x] 失败（网络/401）→ 不崩，回退本地只读占位
  - [x] `logout()` → `POST /api/logout`
  - [x] `?backend=` 覆盖默认地址（且 `opts.backend` 优先）
- 边界：仅 `src/web/Home/useLoginMirror.ts` + 测试
- 依赖：T10, T5；被 T9（接入点）依赖
- 提交：`feat: login API client`（含 T11）
- 状态：✅ 已实现并验收（typecheck 0 错；T11 6 测全绿；全量 146 测无回归）。待人工确认后进 T12。
- 跨任务改动说明：T11 的 login 为异步（fetch），需放宽 `LoginFn` 类型为其返回 `LoginResult | Promise<LoginResult>`（tenantContext.tsx），并让 `TenantProvider.login` 兼容 await 同步/异步 loginFn、让 `LoginModal.handleLogin` 改 async；T5/T8/T9 相关测试改用 `await act(async () => ...)` 冲刷微任务。均为接入真实后端所必需，T5/T8/T9 原行为不变、测试仍全绿。

## T12 端到端验收（真浏览器点击级）
- 目标：Playwright 真浏览器验证首页进入（未登录灰置）+ 登录成功刷新 + 审计断言 + 登出复位 + 同步态
- 输入：T9 页面、T10 后端、T11 镜像；原型红线 ①~⑤
- 输出：`e2e/home.spec.ts`
- 验收（提前规划的测试）：`npm run test:e2e`（home 用例）✅ 6 passed
  - [x] 首屏进入不阻塞登录（未登录灰置）
  - [x] `▶ 登录` 弹卡
  - [x] 密码错 → 锁定提示 + 审计（**断言确实打到真实后端 :8201**）
  - [x] 登录成功 → 顶栏变已登录 + 功劳 4 卡出数据
  - [x] 数字可点溯源 `request_id`（弹审计 modal）
  - [x] 登出 → 回灰置
  - [x] 无脚本异常（`pageerror` 收集为空，干净退出）
- 边界：仅 `e2e/home.spec.ts`（另含 T11 接入缝与 E2E 入口的加性改动，见下）
- 依赖：T9, T10, T11
- 提交：`test: e2e home`（含 T12）
- 状态：✅ 已实现并验收（typecheck 0 错；T12 6 测全绿；全量 E2E 13 测 / 146 单测无回退）。**待人工确认后 REQ-005 全链路收尾。**
- 跨任务/边界改动说明（为让真浏览器页面打到真实后端，做如下加性改动）：
  - **T11 接入缝**：`HomePage.tsx` 加性新增 `loginFn`/`onLogout` 可选 props，转发到内部 `TenantProvider`（T9 时该接入点留空）。这是 T11 `useLoginMirror` 的合法集成缝，与 T10/T11 同例加性改动，不改组件既有行为。
  - **E2E 入口**：新增 `home.html`（根目录）+ `src/web/Home/homeEntry.tsx`（挂载 `HomePage`、注入 `useLoginMirror` 经 `?backend=` 覆盖到 `:8201`、种子 feed、`onTrace` 弹审计 modal）。**不动 `index.html`**，REQ-003 默认页不受影响。
  - **vite.config**：`build.rollupOptions.input` 增加 `home.html` 多入口（保留 `index.html`）。
  - **后端端口**：E2E 用 `:8201`（home server，T10 `createServer` 进程内起服并预置 `e2e_user`/`e2e_lock`/`e2e_lock2`），与 REQ-003 的 `:8200` 隔离；静态端口 home 用 `8124` 避开 app.spec 的 `8123`。
  - **已知构建警告**：`node:crypto` 被外部化进浏览器包（来自 `TenantProvider` 默认 import 的 T3 本地 `login`）；E2E 页面注入的是 `useLoginMirror`，运行时从未调用 `localLogin`，故无 `pageerror`、测试干净。属 T5 既有浏览器打包副作用，不在 T12 边界内，留待后续清理。

---

## 验收总览
- 类型门禁：`npm run typecheck`（tsc strict）— T1 起逐任务可过
- 单元/组件：`npm test`（vitest）— T1~T11 各带测试
- 真浏览器：`npm run test:e2e`（Playwright）— T12 覆盖首页+登录全链路
- 全量：`npm run verify` = typecheck → test → validate_project.py → generate.py --check

## 与 REQ-003 的复用点（避免重复实现）
- 端形态自动识别 `detectForm`：`src/agentOnboard/formMatrix.ts`
- 功劳 4 卡组件 `Gains`：`src/web/AgentOnboard/Gains.tsx`
- 审计弹出 modal：全局 `useAuditModal`（若 REQ-011 已建则复用，否则 T7 仅抛 `onTrace`）
- 后端风格 / 前端镜像模式：`server.ts` / `useBackendMirror.ts`（T10/T11 对齐）
