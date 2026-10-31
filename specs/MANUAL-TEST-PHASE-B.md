---
status: done
---

# 手动测试报告 · Phase B（发布完整性）

- 日期：2026-10-30
- 分支：main（未提交，改动见文末"版本控制状态"）
- 产物：`release/win-unpacked/MultiAgent Memory.exe`（9:35 重新打包，Electron 45.1.0）
- 数据目录：`%APPDATA%\MultiAgent Memory`（日志 `main.log`）
- 关联报告：`specs/MANUAL-TEST-PHASE-A.md`（功能面用例 A1–A5 仍然有效，本轮未改业务流程）

## 1. 本轮改了什么

| 项 | 内容 |
| --- | --- |
| 新增 `tsconfig.electron.json` | 继承主配置，`include: src/electron/**/*.ts, src/desktop/**/*.ts`，排除产物目录；Electron/desktop 代码首次纳入类型检查 |
| `typecheck` 串联 | `tsc --noEmit && tsc --noEmit -p tsconfig.electron.json` |
| `verify` 扩展 | `typecheck(all) && test && build && build:electron` |
| 修掉潜伏缺陷（由新配置暴露） | `reconciler.stopped` 原为 `reconciler['stopped']` 永远 undefined → 在 `Reconciler` 接口补 `stopped` getter；删除不存在的事件 `app.on('uncaught-exception')` / `app.on('unhandled-rejection')` / `webContents.on('crashed')`；去掉重复 electron import；删除未用的 `HashIndex` / `cfg`；`category`/`action` 收窄为 `Category`/`AuditAction` |
| 版本控制收口 | 89 个原本未跟踪的源码/测试/工具/文档纳入 Git 索引（不提交）；19 个 Vite HTML 入口全部被跟踪（含此前遗漏的 `floatattribution.html`、`memory-layered.html`）；`.gitignore` 只忽略构建/运行产物 |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 负向验证 | 临时在 `src/electron/` 放未使用变量 | 主配置通过、electron 配置报 `TS6133`，证明覆盖生效（探针已删除） |
| 单元/集成测试 | `npx vitest run` | 86 文件 / 753 用例全过 |
| Web 构建 | `vite build` | 19 个 HTML 入口构建成功 |
| Electron 构建 | `node tools/build-electron.cjs` | `main.cjs` 176,672 B、`preload.cjs` 4,308 B，构建成功 |
| 总门禁 | `npm run verify` | 退出码 0 |

已知非阻塞告警：esbuild 对 `src/agentOnboard/server.ts:24` 的 `import.meta` 在 CJS 下告警；该处走 `typeof __dirname !== 'undefined'` 分支，CJS 部署不会执行 `import.meta` 分支，属无害告警。

## 3. 打包与启动冒烟（本轮实机）

启动方式（在 PowerShell 中清除本 shell 的 `ELECTRON_RUN_AS_NODE` 后直接运行 exe；资源管理器双击不受影响）：

```powershell
$env:ELECTRON_RUN_AS_NODE=''
& 'D:\Work Folder\Agnet\Deepseek Harness\2026-10-06-16-15-17\release\win-unpacked\MultiAgent Memory.exe'
```

| 检查点 | 期望 | 实测 |
| --- | --- | --- |
| 进程启动 | 主进程存活 | PID 3620，9:35:43 启动 |
| 启动完成 | `bootstrap:done` | 已记录（9:35:43） |
| 端口 | 8200–8204 全部 LISTENING | 5/5 通过（归属 PID 3620） |
| 首轮采集 | 延迟 10s 后执行并落盘 | 9:35:53 开始，9:35:57 完成：`collected:50, deduped:1784, skipped:8` |
| 静态页 | `overview.html` 返回 200 | 200（本次静态端口 63969） |
| Origin 收口 | 恶意 Origin 返回 403 | `Origin: http://evil.example` → 403 |
| 调试残留 | 不生成 exe 目录 `debug.log` / `%LOCALAPPDATA%\MultiAgentMemory-dbg` | 未生成 |

> 说明：冒烟启动的实例当前保持运行，可直接手动点验；重新打包前请先关闭它。

## 4. 本轮手动测试用例（发布完整性）

| # | 操作 | 期望 |
| --- | --- | --- |
| B1 | 在仓库根执行 `npm run verify` | 依次完成双 tsconfig 类型检查、753 用例、Web 构建、Electron 构建，退出码 0 |
| B2 | 临时在 `src/electron/main.ts` 顶部加 `const unusedProbe = 1;`，执行 `npm run typecheck` | 报 `TS6133`，退出码 1；删除后恢复通过 |
| B3 | 执行 `git ls-files --error-unmatch overview.html floatattribution.html memory-layered.html` | 三条均成功（19 个 Vite 入口全部被跟踪） |
| B4 | 执行 `git check-ignore -v src/electron/main.ts src/desktop/hostBridge.ts tools/build-electron.cjs` | 无输出、退出码 1（源码不被忽略） |
| B5 | 启动 exe，等待约 15 秒 | 主窗与浮窗正常；8200–8204 监听；`main.log` 出现 `bootstrap:done` 与 `collector:first-scan:done` |
| B6 | 浏览器手动访问 `http://127.0.0.1:8200/api/health` 并伪造 `Origin: http://evil.example` | 403（仅本机精确 Origin 放行） |

## 5. 回归清单

业务流程未改动，按 Phase A 报告执行即可：首页/记忆/写入/审计/生命周期/争议/参数/监控/反馈/安全/检索/日志/模型/成长/层级 15 个视图 + 接入页 + 浮窗。重点回归：

- 浮窗归因写入后，内联归因页可见同一条记录；
- 记忆页 `.rid` 溯源可打开；
- 安全页变更写入 `security_change` 审计；
- 关闭主窗后进程与 8200–8204 全部退出。

## 6. 已知问题 / 边界

- `overview.html` 的 iframe 子页面没有 `window.api`，统一走 `src/desktop/hostBridge.ts` 消息桥（设计如此；`registerPreloadScript` 对子 frame 无效）。
- 采集器账户仍为本地单账户（u1/t1/e1），未接真实登录。
- 旧数据目录 `%APPDATA%\multi-agent-memory` 不做自动迁移。
- 工作区仍未提交：89 个新文件已入索引，153 个修改、14 个删除、1 个重命名尚未暂存/提交（未获提交授权）。

## 7. 版本控制状态（本轮执行）

```
89 A（新增并已暂存）
153 M（已修改，未暂存）
14 D（已删除，未暂存）
1 RM（重命名，未暂存）
```

未执行 `git commit` / `git push`。
