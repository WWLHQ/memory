---
status: done
---

# 手动测试报告 · 修复批次 1（数据丢失线）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-054049/MultiAgent Memory-0.1.0-setup.exe`（121,910,347 B = 116.26 MiB）
- SHA256：`d24141039b02187fc6022625abca69cbcf11aa16b22a2cdab4dec39e6e3095cf`
- 未打包目录：`release/installer-20261030-054049/win-unpacked/MultiAgent Memory.exe`
- 数据目录：`%APPDATA%\MultiAgent Memory`
- 关联报告：`specs/MANUAL-TEST-PHASE-A.md` ~ `MANUAL-TEST-PHASE-E.md`；本轮对应审核清单批次 1（P0-A 采集游标 / P0-B sync 假成功 / P0-C 目录切换覆盖）

## 1. 本轮改了什么

| 项 | 内容 |
| --- | --- |
| 1-A 采集器游标 | `applyScanToStore` 返回 `{ written, failed }`，单条写失败计数不再被吞；`main.ts` onScan 仅在 **commitBatch 成功且 failed=0** 后推进并持久化游标；失败时回滚扫描期新增的 `seenHashes` 并保留旧游标，下一轮重采（coreWrite 去重兜底）；新增主日志 `collector:scan-apply-error` / `collector:commit-error` / `collector:cursor-hold` |
| 1-B sync 诚实化 | `agent.sync()` 不再用本地记忆条数伪造 `pushed/pulled`；未接同步中枢前统一抛 `E_NOT_IMPLEMENTED` 并写 `sync` 审计（`implemented:false`）；`ErrorCode` 新增该码；契约测试同步更新 |
| 1-C 目录切换 | 新增 `pendingMove`：切换只登记配置并 400ms 后自动重启；bootstrap **无在途写时**执行迁移（目标已有文件先 `<target>.bak-<时间戳>` 备份；迁移审计写入目标库），成功才切换 `dbDir`，失败自动回滚继续用原库；bootstrap 改为按 `activeDbPath()` 打开存储；删除旧 `setDbDir`；`backup:saveConfig` 禁止修改 `dbDir`/`pendingMove`；UI 提示改为「应用即将自动重启并完成迁移」 |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **89 文件 / 793 用例全过** |
| 相关用例定向 | `npx vitest run sessionCollector contract` | 39 用例全过 |
| Web 构建 | `npm run build` | 通过（19 个页面入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir 双目标） |

测试变更说明：

- `sessionCollector.test.ts` 三个用例改为断言 `{ written, failed }`；「单条失败不阻塞整批」现同时断言 `failed=1`。
- `contract.test.ts` 的 sync 断言由 `E_SYNC_CONFLICT` 改为 `E_NOT_IMPLEMENTED`（冲突分支已随假实现一并移除）。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-054049/MultiAgent Memory-0.1.0-setup.exe` | 121,910,347 B = **116.26 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-054049/win-unpacked/` | 可直接运行 `MultiAgent Memory.exe` |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 仍被本机工作区索引器占用（EPERM），`tools/package-builder.cjs` 按既有逻辑自动输出到时间戳目录，属预期。

## 4. 本轮手动测试用例（重点）

### 4.1 采集器（1-A）

| # | 操作 | 期望 |
| --- | --- | --- |
| A-1 | 启动应用，产生新的本机 Agent 会话内容，等待首扫（10s）或一个采集周期（5min） | 主日志出现 `collector:period done`；`%APPDATA%\MultiAgent Memory\collector-cursor.json` 的 `updatedAt` 前进；记忆页可见新采集条目；无 `cursor-hold` |
| A-2 | 先 `attrib +R "%APPDATA%\MultiAgent Memory\memories.db.json"`，再产生新会话内容并等待一轮采集 | 主日志出现 `collector:commit-error`；`collector-cursor.json` 的 `updatedAt` **不变**；解除只读（`attrib -R`）后下一轮补采成功、游标前进，记忆库无重复条目 |
| A-3 | 单条写失败路径 | 由单测覆盖（`written=1, failed=1`）；代码审阅确认 onScan 在 `failed>0` 时保留旧游标并回滚 seen |

### 4.2 同步接口（1-B）

| # | 操作 | 期望 |
| --- | --- | --- |
| B-1 | 接口层调用 `sync({direction:'push'})`（当前无 UI 入口，仅单测/开发调用） | 抛 `E_NOT_IMPLEMENTED`；审计中出现 `sync` 记录且 `implemented:false`；不再返回虚假 pushed/pulled |

### 4.3 记忆库保存位置（1-C）

| # | 操作 | 期望 |
| --- | --- | --- |
| C-1 | 参数页 → 记忆库管理 → 更改位置… → 选择空目录 | 提示「已登记新的记忆库位置：应用即将自动重启并完成迁移」；应用自动重启；重启后显示新路径；新目录出现 `memories.db.json`（含原记忆 + `db_dir_migrate` 审计）；`backup-config.json` 的 `dbDir` 为新目录且无 `pendingMove`；主日志 `backup:db-dir-migrated` |
| C-2 | 目标目录预先放置一个旧 `memories.db.json` 后再切换 | 生成 `memories.db.json.bak-<时间戳>`；新库内容为当前数据，旧目标文件可从 .bak 恢复 |
| C-3 | 点击「恢复默认」 | 自动重启；路径回到 `%APPDATA%\MultiAgent Memory\memories.db.json`；数据完整；自定义目录文件保留 |
| C-4 | 切换完成后执行「立即备份一次」 | 备份文件内容为新库（包含切换后新增的记忆），不再备份旧路径快照 |
| C-5 | 选择一个不可写目录（如无管理员权限的 `C:\Windows\System32`）切换 | 应用重启后仍使用原库、数据完整；主日志 `backup:db-dir-migrate-error`；`backup-config.json` 无 `pendingMove`、`dbDir` 未变 |
| C-6 | IPC 层传入 `\\host\share`（开发工具调用） | 返回「不支持网络共享（UNC）路径」；配置不变 |
| C-7 | 修改备份时间/开关后保存 | `dbDir` 与 `pendingMove` 不变（普通配置保存无权改库路径） |

## 5. 回归清单

- 登录 / 登出、写入 → 记忆列表、检索、删除 → 审计、立即备份、采集器增量采集均正常。
- 目录切换自动重启后登录状态仍有效（账号/会话文件在 `userData`，不在记忆库文件内）。
- 关闭主窗后 8200–8204 与静态服务全部退出，无残留进程。

## 6. 已知问题 / 边界

- 切换位置会**自动重启应用**（400ms 后）：若界面有未保存草稿会丢失；本轮未做草稿保护。
- 迁移发生在重启后的 bootstrap，不存在“会话中途换库”丢写；切换登记后、重启前的写入仍会先落旧库，并在重启迁移时一并复制。
- 迁移审计写入目标库；原库保留原有审计（不重复追加）。
- UNC 拒绝仅 win32 生效；其它平台依赖 `isAbsolute` 校验。
- 未签名安装包 SmartScreen 提示、`author` 缺失提示、esbuild `import.meta` CJS 告警均为既有现象，不影响运行。
- 工作区未提交（流程约束，非遗漏）。

## 7. 版本控制状态

- 本轮修改（未提交）：`src/electron/main.ts`、`src/core/memagent/sessionCollector.ts`、`src/core/memagent/agent.ts`、`src/core/memagent/types.ts`、`src/core/memagent/__tests__/sessionCollector.test.ts`、`src/core/memagent/__tests__/contract.test.ts`、`src/electron/preload.ts`、`src/web/memory/backup.ts`、`src/web/params/KbManagementCard.tsx`、本报告。
- `git status` 统计（含前序轮次）：85 A / 16 AM / 28 D / 174 M / 1 MM / 5 R / 1 RM；未执行 `git commit` / `git push`。
