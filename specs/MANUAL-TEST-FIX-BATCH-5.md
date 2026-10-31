# 手动测试报告 · 修复批次 5（门禁收口：lint / 覆盖率 / Windows CI / 死代码）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-071600/MultiAgent Memory-0.1.0-setup.exe`（121,914,696 B = 116.27 MiB）
- SHA256：`5b9ee1bf690851eb742e748699101394346977731c4c94759851e0bb514cfdf8`
- 未打包目录：`release/installer-20261030-071600/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`；便携包/开发态 `%APPDATA%\multi-agent-memory`（既有约定，本轮未迁移）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md`、`specs/MANUAL-TEST-FIX-BATCH-2.md`、`specs/MANUAL-TEST-FIX-BATCH-3.md`、`specs/MANUAL-TEST-FIX-BATCH-4.md`

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 5-A lint 门禁 | typescript-eslint 8.72 在导入时硬拒绝 TypeScript 7.0（parser 即抛错，上游 issue #10940 待支持 ≥7.1），无法在不降级 TS 的前提下接 ESLint；改用 **oxlint 1.90**（Rust 实现，原生解析 TS/TSX，不依赖 TS API）。配置 correctness=error + `react/rules-of-hooks`=error + `react/exhaustive-deps`=warn；React Compiler 系列规则（refs/immutability/set-state-in-effect 等）暂关（存量页面大量 ref/memo 惯用法，需专项重构）。`npm run lint` 已接入 `verify:fast` | `.oxlintrc.json`（新增）、`package.json` |
| 5-A 基线告警清零 | 修掉基线 14 条 warning：`memories.ts` 正则字符类无谓转义、`vector.ts` 热路径 `new Array` 加注释豁免、`sync.ts`/`main.ts` 展开空回退、`agent.ts` 冗余空数组判断、`useGrowthReal.ts` 的 `Number() ?? 1` 改为 NaN 安全（原写法对非法 layer 永远得不到 1）、`coreMemoryOps.ts` 未用 catch 参数、`e2e/harness.ts` Playwright fixture 空解构豁免、AgentOnboard 测试 4 处正则 `$` 改 `endsWith`、GrowthPage `metrics` 改 `useMemo` 稳定引用、`useMonitorMirror`/`KbManagementCard` 依赖补全 | `src/core/memagent/{memories,agent,sync,vector}.ts`、`src/electron/main.ts`、`src/web/{growth/GrowthPage.tsx,growth/useGrowthReal.ts,memory/coreMemoryOps.ts,monitor/useMonitorMirror.ts,params/KbManagementCard.tsx}`、`e2e/harness.ts`、`src/web/AgentOnboard/__tests__/AgentOnboardPage.test.tsx` |
| 5-B 覆盖率门禁 | 接入 `@vitest/coverage-v8`（v8 provider）。统计 `src/**`，排除单测、`test-setup`、Electron 主进程胶水（`main.ts`/`preload.ts`）与页面入口（`main.tsx`/`*Entry.tsx`）——这些由 E2E 覆盖、单测环境无法加载。阈值：**行 74% / 语句 71% / 函数 67% / 分支 61%**（基线行 77.51 / 语句 74.40 / 函数 70.98 / 分支 64.70，留约 3pp 余量防抖）。`npm run test:coverage` 已替换 `verify:fast` 中的普通单测 | `vite.config.ts`、`package.json`、`.gitignore` |
| 5-C Windows CI | `.github/workflows/ci.yml` 新增 `windows-gate`（windows-latest：`npm ci` + `verify:fast` = typecheck + lint + 覆盖率单测），覆盖 Windows 路径/换行差异；Ubuntu `quality-gate` 增加 `npm run lint` 步骤 | `.github/workflows/ci.yml` |
| 5-D 死代码收尾 | 删除 `src/web/AgentOnboard/agentDetect.ts` 与其测试（`LocalAgentDetect.tsx` 批次4 删除后已无生产引用）；`src/electron/agentDetect.ts` 为另一个模块（主进程探测用），保留 | 删除 2 个文件 |
| 文档同步 | README / code-map / test-plan / MANUAL-TEST 测试计数更新为 **91 文件 / 841 用例**；命令表补充 `lint`、`test:coverage`、`windows-gate`；`verify:fast` 说明改为 typecheck + lint + 覆盖率单测 | `README.md`、`specs/{code-map,test-plan,MANUAL-TEST}.md` |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint，373 文件 / 123 规则） | **0 error / 0 warning**（约 70ms） |
| 单元/集成测试 | `npm test` | **91 文件 / 841 用例全过** |
| 覆盖率阈值 | `npm run test:coverage` | 行 77.63%（≥74）/ 语句 74.50%（≥71）/ 函数 70.98%（≥67）/ 分支 64.83%（≥61），通过 |
| Web 构建 | `npm run build` | 通过（19 个页面入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 真浏览器 E2E | `npm run test:e2e`（= `node e2e/run.mjs --workers=1`） | **21 个 spec / 88 用例全过（30.6s）** |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir 双目标） |

门禁有效性验证（本机实测）：

- **lint 能拦住真错误**：临时文件写条件调用 `useState` → `react/rules-of-hooks` 报 error，`oxlint` 退出码 1；删除临时文件后恢复 0/0。
- **覆盖率阈值生效**：阈值定义在 `vite.config.ts`，低于阈值时 vitest 退出码非 0（`verify:fast` 即红）。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-071600/MultiAgent Memory-0.1.0-setup.exe` | 121,914,696 B = **116.27 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-071600/win-unpacked/` | 可直接运行 `MultiAgent Memory.exe`（249,934,848 B） |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 仍被本机工作区索引器占用（EPERM），`tools/package-builder.cjs` 自动输出到时间戳目录，属预期。

## 4. 本轮手动测试用例（重点）

> 日志：`%APPDATA%\MultiAgent Memory\main.log`（便携包/开发态为 `multi-agent-memory`）。

### 4.1 lint 门禁（5-A）

1. 仓库根执行 `npm run lint`：应输出 `Found 0 warnings and 0 errors`，退出码 0。
2. 任意 TSX 里临时写一个条件 Hook（例：`if (x) { const [v] = useState(0); }`）再执行 `npm run lint`：应报 `react/rules-of-hooks` error、退出码 1；测试完删除该临时改动。
3. 执行 `npm run verify:fast`：应依次跑 typecheck → lint → 覆盖率单测，任一失败即中断。

### 4.2 覆盖率门禁（5-B）

1. 执行 `npm run test:coverage`：末段应打印四项覆盖率与阈值比对，退出码 0。
2. 打开 `coverage/index.html` 可查看逐文件明细（`coverage/` 已加入 .gitignore，不入库）。
3. 临时把 `vite.config.ts` 的 `thresholds.lines` 改为 99 再跑 `npm run test:coverage`：应以覆盖率不足失败（验证阈值真的阻断），改回 74 后恢复通过。

### 4.3 Windows CI（5-C）

1. 打开 `.github/workflows/ci.yml`：应有 `quality-gate`（Ubuntu，含 lint 步骤）、`windows-gate`（windows-latest，跑 `verify:fast`）、`e2e`（Ubuntu）三个 job。
2. 推送后在 GitHub Actions 页面应看到 `windows-gate` 与 Ubuntu 门禁同时执行；Windows job 与本地 `verify:fast` 等价（本机 Windows 已全绿，CI 侧需 push 触发验证）。

### 4.4 死代码删除回归（5-D）

1. 仓库内已无 `src/web/AgentOnboard/agentDetect.ts`；全局搜索 `coreDetectLocalAgents` / `coreAgentConfig` 应无结果。
2. 安装包版打开「Agent 接入配置页」：一键接入四段流程、本机检测、卡片保存/恢复均正常（删除的仅是批次4 已废弃的独立检测卡渲染层调用面）。
3. 主进程本机探测不受影响（`src/electron/agentDetect.ts` 保留）：接入页「检测本机」仍能返回安装证据。

### 4.5 回归（本轮改动涉及页面逻辑）

1. **自我净化与生长页**：指标卡、优化清单、Δ 面板正常渲染（`metrics` 改为 useMemo 稳定引用，行为应无变化）。
2. **记忆层级管理页**：L0 解锁、浏览请求失败时仍返回空态而非崩溃（catch 参数调整）。
3. **监控仪表盘**：切换 filter（等级/窗口/Agent）仍会触发 `monitor_view` 镜像上报（依赖补全后语义不变）。
4. **全局参数页 → 记忆库管理卡**：备份配置/列表加载正常（effect 依赖补全 `available`，仅在可用性变化时重跑）。
5. **写入页 / 记忆库 / 生命周期 / 审计**：写入、查重、状态机操作正常（内核仅清理无谓转义与冗余判断，不改变行为）。

## 5. 已知问题 / 说明

- **lint 工具为 oxlint 而非 ESLint**：typescript-eslint 8.72 硬拒绝 TS 7.0（上游 issue #10940 计划支持 TS ≥7.1）。待上游支持后可将规则平移回 ESLint（规则名基本一一对应）；在此之前 oxlint 提供同等 correctness + react-hooks 门禁。
- **React Compiler 规则暂关**：`react/refs`、`immutability`、`set-state-in-effect` 等在存量 19 页触发 20+ 处，属专项重构范畴，本批次不混入功能改动。
- **覆盖率阈值是防回退下限**：基线 2026-10-30（行 77.6%），新增大量未测代码会触发；Electron 主进程与页面入口不计入单测覆盖率（由 E2E 覆盖）。
- **Windows CI job 尚未在 GitHub 实跑**：本机 Windows 同等命令全绿；需推送后观察首次运行。
- **双打包路径的 userData 目录不同**：安装包 `%APPDATA%\MultiAgent Memory`，便携包/开发态 `%APPDATA%\multi-agent-memory`；属既有约定，待确认后迁移。
- **同步引擎仍未接线**：维持批次4 的诚实口径（`E_NOT_IMPLEMENTED` + 审计 + UI「同步未接线」）。
