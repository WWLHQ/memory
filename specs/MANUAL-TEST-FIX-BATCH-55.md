# 批次55 手动测试报告（2026-11-21）

## 用户需求（12 条原话 → 全部落地）

1. 「确认同步中枢和冲突裁决改没改/自测没有/与方案对比没有」→ 已给出批次54 产物级证据链：`dist/assets/dispute-T7DNkYz8.js` 含「冲突队列（0）」「不自动覆盖 · 保存原文」；`sync-DxtJIcBQ.js` 无 sync-tabs、含「通道与游标」「L0 排除」；feedback bundle 含「回显反馈」；上轮安装包 129,315,311B F3C86960…97C782 已安装并核运行态。
2. 深色主题适配 11 页（用户逐条点名）：首启向导 / 审计日志 / 日志记录 / 账号安全 / 全局参数 / 同步中枢 / 大模型配置 / 网页端接入 / 生长与自动化 / 生命周期 / 层级管理。
3. 「用户反馈改为反馈」。
4. 「改完要自测，自测通过再打包」→ 全量门禁绿后才打包。

## 改动清单

### 深色主题（useHostTheme 挂载 + CSS 令牌）
- 9 页挂 `useHostTheme()`（html[data-theme] 随壳层 localStorage `memdesk.shell.theme.v1` 切换）：
  - [AuditPage.tsx](../src/web/audit/AuditPage.tsx)、[LogsPage.tsx](../src/web/logs/LogsPage.tsx)、[SecurityPage.tsx](../src/web/security/SecurityPage.tsx)、[ParamsPage.tsx](../src/web/params/ParamsPage.tsx)、[SyncPage.tsx](../src/web/sync/SyncPage.tsx)、[ModelsPage.tsx](../src/web/models/ModelsPage.tsx)、[WebOnboardPage.tsx](../src/web/webonboard/WebOnboardPage.tsx)、[GrowthPage.tsx](../src/web/growth/GrowthPage.tsx)、[MemoryLayeredPage.tsx](../src/web/memory/MemoryLayeredPage.tsx)
  - setup / lifecycle 原本已挂（批次54 前已接），本轮不重复改。
- CSS 盘点结论：`shared/p0.css`、`p0Legacy.css`、`sync/theme.css`、`memory/theme.css`、`audit/theme.css`、`logs/extras.css`、`models/extras.css`、`params/recallHard.css` 全部为令牌引用，深色值由 p0.css `html[data-theme="dark"]` 令牌块自动生效，**无需逐页改 CSS**。
- 唯一硬编码浅色的 [setupPage.css](../src/web/setup/setupPage.css) 补深色令牌块（`html[data-theme="dark"] .sw-page` 重定义 --sw-* 全套 + 徽标/输入框/代码块/警示框/遮罩硬编码件逐条覆写）。

### 改名（用户反馈 → 反馈）
- [views.ts](../src/web/shell/views.ts)：导航 label「用户反馈」→「反馈」、PAGES label「用户反馈页」→「反馈页」
- [FeedbackPage.tsx](../src/web/feedback/FeedbackPage.tsx) 页头 h1 →「反馈页」；[FeedbackForm.tsx](../src/web/feedback/FeedbackForm.tsx) 卡标题 →「反馈（13.7 反馈表单…）」；[Overview.tsx](../src/web/overview/Overview.tsx) 通览卡 →「反馈页」
- 测试同步：[views.test.ts](../src/web/shell/__tests__/views.test.ts)、[FeedbackPage.test.tsx](../src/web/feedback/__tests__/FeedbackPage.test.tsx)

## 三道闸门证据

### A · 影响面回归
- `npm run verify:fast` 全绿：typecheck + oxlint + 索引新鲜度 + **320 文件 / 4064 测试 0 失败** + 覆盖率阈值（Statements 81.94% / Branches 73.9% / Functions 78.73% / Lines 85.2%）。
- 影响面未动：sync/dispute 全部 testid、数据逻辑、批次54 用例（syncPage.test 断言 sync-tabs 不存在等）原样通过。

### B · 效果验证（正向用例）
- 11 个页面测试各新增 1 条「跟随壳层深色主题：挂载即设置 html[data-theme="dark"]」（模式照批次54 AssistantPage 用例）：先 `localStorage.setItem('memdesk.shell.theme.v1','dark')` → render → 断言 `data-theme==='dark'` → finally 还原。
  - 10 个文件追加：audit/logs/security/params/sync/models/growth/lifecycle/memory(MemoryLayered)/setup
  - 新建 [WebOnboardPage.test.tsx](../src/web/webonboard/__tests__/WebOnboardPage.test.tsx)（浏览器模式无宿主 IPC 依赖，口径同 WebchatAutoCard 浏览器用例）
- 定向 11 文件 130 测试全绿；改名相关 views.test + FeedbackPage.test 30/30 绿（断言 label「反馈」、feedback-form 含「反馈」、回显反馈块保留）。

### C · 变异验证
- 变异：临时删除 AuditPage.tsx 的 `useHostTheme();` 调用 → `AuditPage.test.tsx` **1 failed**（恰好深色用例 `expected null to be 'dark'`，其余 9 条不受影响）→ 原样还原 → 复跑 3 文件 30/30 全绿。

## 打包与运行态核验（交付闭环）

| 步 | 结果 |
|---|---|
| 关旧端 | 进程 0、8200–8204 无 LISTENING 后打包 |
| 重打包 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` 成功；`git diff package.json` 为空 |
| 验产物 | `MultiAgent Memory-0.1.0-setup.exe` 129,315,564 B，SHA256 `2B6D066A2D90FFEE346E735730994D5554AA4B4C503B7A54D01F4CE3EB801AEB`；dist 标记：`setup-BDCGEapJ.css` 含 `html[data-theme=dark] .sw-page`、bundle 含「反馈（13.7 反馈表单」、旧 label「用户反馈」消失、hostTheme 键进共享 chunk |
| 安装 | `/S` 静默安装成功；安装后 `resources/app.asar` 含 `sw-page` 新标记 |
| 启端 | 清 ELECTRON_RUN_AS_NODE/NODE_OPTIONS/四代理后启动，进程 4 |
| 核运行态 | main.log `bootstrap:done`（2026-11-21T09:17:50Z）+ 8202/8203/8204 LISTENING（PID 24984） |

## 已知边界与清扫

- 历史 `release/installer-*` 13 个目录因句柄占用 EPERM 删不掉（已知边界，release/ 已 gitignore，不阻塞）。
- `coverage/`（13.5MB）验证完已删；无其它临时物残留。
- 深色覆盖口径：本轮只动用户点名的 11 页；Home/Overview/Monitor/MemoryManagement/Write/Retrieval 等其余页未点名不动（外科手术纪律），其中 overview/memory 已有主题支持。
- setup 深色为批次55 新增适配（原页面刻意固定浅色稿值）；浅色值未变。
