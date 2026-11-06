---
status: done
---

# 手动测试报告 · 修复批次 4（未接线模块诚实化 + 门禁）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-070315/MultiAgent Memory-0.1.0-setup.exe`（121,914,808 B = 116.27 MiB）
- SHA256：`4e3b6bf806a7b55e363065aff9d3112edb47c61e72d0c74897c62f3a05c0a5e3`
- 未打包目录：`release/installer-20261030-070315/win-unpacked/MultiAgent Memory.exe`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`；便携包/开发态 `%APPDATA%\multi-agent-memory`（既有约定，本轮未迁移）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md`、`specs/MANUAL-TEST-FIX-BATCH-2.md`、`specs/MANUAL-TEST-FIX-BATCH-3.md`

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 4-A 遗忘引擎调度接线 | `runForgettingCycle` 此前只有定义、无生产调用；现由主进程按 6h 周期真实执行（首跑 10min），读取参数页 `auto_organize` 开关：关闭时按 AC-14 只记 `skipped` 审计、不改任何记忆。整轮 `beginBatch/commitBatch` 一次写盘；审计 `bootstrap:forgetting-scheduled` / `forgetting:cycle:done` / `forgetting:cycle:error`。`MAM_FORGETTING_DISABLED=1` 可整体关闭，`MAM_FORGETTING_FIRST_DELAY_MS` / `MAM_FORGETTING_INTERVAL_MS` 可调 | `src/electron/main.ts` |
| 4-B 跨项目聚类隔离 | 合并分组键含 `enterprise_id + team_id + project_id + category + 内容前缀`，并对摘要组二次校验同租户/团队/项目；跨项目、跨团队、跨租户绝不合并（摘要继承首条归属，混组会串档）。`locked` 原文不参与合并，`auto_merge !== true` 的类别不自动合并 | `src/core/memagent/forgetting.ts` |
| 4-C 同步引擎诚实化 | `MemAgent.sync()` 不再用本地条数伪造 pushed/pulled 成功：写 `sync` 审计（`implemented:false, reason:'sync hub not wired'`）后抛 `E_NOT_IMPLEMENTED`。首页顶栏/仪表盘同步态固定诚实标注：`wired=false` 时显示「同步未接线」（有待回传时附 `N 条待回传`），绝不显示「已同步」 | `src/core/memagent/agent.ts`、`src/web/Home/TopBar.tsx`、`src/web/Home/Dashboard.tsx`、`src/web/Home/coreHome.ts` |
| 4-D iframe 存储能力门禁（E2E 修复中发现） | `InMemoryStorage` 原先只要检测到 iframe 就改走宿主消息桥；纯浏览器通览页（父窗口无 preload）内所有 iframe 页面读账本都要先等 3s 桥超时再降级。现改为仅 `hostCapability() === 'bridge'`（父窗口确有原生 preload）才走桥，否则落进程内内存账本，页面即时渲染诚实空态；Electron 概览页 iframe 行为不变 | `src/core/memagent/storage.ts`、`src/desktop/__tests__/hostBridge.test.ts` |
| 门禁：E2E 接真实账本 | 50 个因删除演示种子数据而失真的用例全部重写为真实账本口径：空账本断言诚实空态（审计/生命周期/冲突/日志/监控/反馈/生长/安全/检索/内联标识），可交互页面保留真实同页闭环（写入、参数保存、L0 解锁、反馈校验、生长手动触发、策略审计、一键接入本地持久化恢复） | `e2e/*.spec.ts` |
| 门禁：E2E 稳定性 | 全部 spec 静态服务/后端改用系统分配端口（`0`），不再与桌面 8200/8201 或 MCP 8202/8204 争用；`afterAll` 统一用 `closeServer` / `stopRunningServer` 防御未初始化；`layered-preview.spec.ts` 去掉 D 盘绝对路径改用 `pathToFileURL`；删除全部 `waitForTimeout`（验证码/解锁等改为确定性断言）；21 个 spec 全部 `disconnectBrowser()` | `e2e/servers.ts`、`e2e/harness.ts`、`e2e/*.spec.ts` |
| 门禁：verify / 文档 / 死代码 | `npm run verify` 已含 E2E；README / code-map / test-plan / MANUAL-TEST 测试计数更新为 92 文件 / 844 用例；删除已合并进一键接入卡且无任何引用的死组件 `LocalAgentDetect.tsx`；`@electric-sql/pglite` 确认为 devDependency（仅 `pgSyncHub` 测试与 type-only 引用，运行时不打包） | `package.json`、`README.md`、`specs/*.md` |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **92 文件 / 844 用例全过** |
| Web 构建 | `npm run build` | 通过（19 个页面入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 真浏览器 E2E | `npm run test:e2e`（= `node e2e/run.mjs --workers=1`） | **21 个 spec / 88 用例全过（31.8s）** |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir 双目标） |

新增/调整测试：

- `src/desktop/__tests__/hostBridge.test.ts`：新增 2 例 —— 纯浏览器 iframe（父窗口无 preload）必须是进程内内存账本且可读写；父窗口有 preload 时必须走宿主桥（非内存实现）。
- `e2e/security.spec.ts`：修正前缀选择器误命中表容器（`member-table`/`key-table`），数据行改查 `tbody tr`。
- `e2e/overview.spec.ts`：通览页 iframe 内联标识页现可即时读到 localStorage 接入名单（4-D 修复后），断言切换器 + 统一账本空态 + 不伪造标记。
- `e2e/register.spec.ts` / `e2e/layered-preview.spec.ts`：删除固定 sleep，改为等待验证码文本 / 元素可见等确定性条件。
- `e2e/write.spec.ts`：写入内容改为 ≥10 个有效字符，覆盖质量门禁真实落库路径。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-070315/MultiAgent Memory-0.1.0-setup.exe` | 121,914,808 B = **116.27 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-070315/win-unpacked/` | 可直接运行 `MultiAgent Memory.exe` |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 仍被本机工作区索引器占用（EPERM），`tools/package-builder.cjs` 自动输出到时间戳目录，属预期。

## 4. 本轮手动测试用例（重点）

> 日志：`%APPDATA%\MultiAgent Memory\main.log`（便携包/开发态为 `multi-agent-memory`）。
> 环境变量在启动安装包前用 CMD 设置；建议用短周期验收调度。

### 4.1 遗忘引擎周期调度（4-A）

1. 启动前设置 `set MAM_FORGETTING_FIRST_DELAY_MS=5000`、`set MAM_FORGETTING_INTERVAL_MS=60000`，再启动应用。
2. 打开 `%APPDATA%\MultiAgent Memory\main.log`：
   - 出现 `bootstrap:forgetting-scheduled`（含 firstDelayMs / intervalMs）；
   - 约 5s 后出现 `forgetting:cycle:done {"why":"first",...}`，此后每约 60s 一条 `why:"interval"`；
   - 报告字段含 `migrated` / `summaries_created` / `merged_originals` / `freshness_updated` 等。
3. 参数页把「自动整理」关掉，等下一轮：审计页应新增 `gc` 且 `detail.skipped`（AC-14），记忆列表的任何层/状态不得变化。
4. 重新开启后：热层超期记忆按 17.7 迁移（hot→warm→cold→dormant），`locked/pinned` 不迁移。
5. 设置 `MAM_FORGETTING_DISABLED=1` 重启：只出现 `forgetting:scheduler-disabled`，不再有任何 `forgetting:cycle:*`。

### 4.2 跨项目聚类隔离（4-B）

1. 建两个项目（P1/P2），各写入 2 条 `decision` 类别、内容前缀相同的记忆；触发一轮遗忘周期：两项目各自不足 3 条 → 均不得生成 `sum_` 摘要。
2. 同一项目内写入 3 条同类别、同前缀内容 → 生成 1 条摘要（L3），原文降 cold 保留并带 `merged_from`。
3. 任一原文 `locked` 导致同组不足 3 条 → 不合并。
4. 自动合并结论可在记忆库管理页核对：摘要归属（项目/团队/企业）必须与来源同组一致，不得跨项目。

### 4.3 同步引擎诚实化（4-C）

1. 首页顶栏（已登录）显示「同步未接线」；若存在待回传条数，显示「同步未接线 · N 条待回传」。任何情况下未接线时不得出现「已同步」。
2. 首页仪表盘同步卡片同样显示真实待回传计数（offline 时为「离线 N 条待回传」），不得显示虚假同步成功。
3. 通过内核/接口触发 `sync`：应返回 `E_NOT_IMPLEMENTED`（文案「云端同步尚未接线」），并在审计页看到一条 `sync` 记录，`detail.implemented=false`、`detail.reason=sync hub not wired`。

### 4.4 概览页 iframe 存储能力（4-D）

1. **Electron 安装包**：打开通览页 → Agent 接入；内联标识演示页直接打开 `inlineattribution.html`（批次48 A30 起不在主导航）。页面应立即显示真实账本数据（桌面主进程持久库），行为与修复前一致（父窗口有 preload → 走宿主桥）。
2. **纯浏览器**（无 Electron preload，如静态 `dist/` 或本地开发预览）：直接打开 `inlineattribution.html`（批次48 A30 起该演示页不在通览页主导航，但构建产物仍可达，首屏带「演示页（DEMO）」标识）：应立即显示接入名单切换器 + 统一账本空态（若本机未接入则显示诚实空态），不应出现约 3 秒的「加载真实账本中…」后再退化为空态。
3. 通览页任意 iframe 页面不得出现长时间空白/卡住；空账本一律显示明确空态文案。

### 4.5 E2E 与构建门禁

1. `npm run verify`：typecheck → vitest（92 文件 / 844 用例）→ `build:electron` → E2E（21 spec / 88 用例）全绿；无端口冲突（不占用 8200/8201/8202/8204）。
2. 反复执行 `npm run test:e2e` 两次：注册用例使用每次运行唯一手机号，可重复执行；不残留 Chromium 进程与临时服务。
3. `npm run package` 可重复执行：`release/installer` 被占用时自动输出到 `release/installer-<时间戳>`，产物自检通过。

## 5. 已知问题 / 说明

- **同步引擎仍未接线**：本轮只做诚实化（明确 `E_NOT_IMPLEMENTED` + 审计 + UI 标注），未实现真实同步中枢；待接线后 `wired=true` 才会显示「已同步」。
- **lint / 覆盖率门禁未配置**：仓库当前无 ESLint 与覆盖率依赖（需新增 npm 依赖并处理全仓规则），本轮未引入；类型检查 + 全量单测 + E2E 作为现有门禁。
- **CI 跨平台**：`.github/workflows/ci.yml` 的 E2E job 仍为 Ubuntu；Windows 专用路径（netstat/taskkill 清理 CDP、便携打包）本轮在本机实测通过，但未新增 Windows runner job。
- **双打包路径的 userData 目录不同**：安装包 `%APPDATA%\MultiAgent Memory`，便携包/开发态 `%APPDATA%\multi-agent-memory`；属既有约定，本轮未做迁移以免影响既有手动测试数据。
- **Electron 侧 iframe 宿主桥**：4-D 只收紧「父窗口无原生能力时不再尝试桥」；Electron 内（父窗口有 preload）仍走桥，需在安装包版通览页做一次回归确认（见 4.4-1）。
