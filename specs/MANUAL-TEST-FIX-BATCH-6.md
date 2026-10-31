# 手动测试报告 · 修复批次 6（数据存放位置 + 同步「未实现」标注）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-074405/MultiAgent Memory-0.1.0-setup.exe`（121,918,271 B = 116.27 MiB）
- SHA256：`1499482f79e0c8ea6028c5e56728f269e2632eb64c61fa5707c5e9baaa52b328`
- 未打包目录：`release/installer-20261030-074405/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 数据根指针：`%APPDATA%\MultiAgent Memory\data-root.json`（固定，不随用户所选目录漂移）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md` ～ `specs/MANUAL-TEST-FIX-BATCH-5.md`

## 0. 本轮用户决策

1. 数据位置选 **A（统一目录）且软件要改**：安装后**首次启动**必须引导用户指定数据库位置；此后记忆库、采集游标、main.log/float.log、mcp-token.txt、备份配置、本地服务令牌等**全部数据**挂载在该位置；用户选默认时默认就是 `%APPDATA%\MultiAgent Memory`。
2. 同步选 **A**：保持未接线，并在产品中**明确标注为「未实现」**。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 6-A 数据根基础设施 | 新增纯 Node 模块（不依赖 Electron）：指针 `data-root.json` 读写（原子 tmp→rename）、路径校验（绝对路径 / 拒绝相对与 UNC 根）、可写探测、旧数据探测与摘要、白名单迁移。白名单：`memories.db.json`、`collector-cursor.json`、`main.log`、`float.log`、`mcp-token.txt`、`backup-config.json`、`home-audit.json`、`agent-onboard.json`、`backups/`、`memories-export/`。迁移只复制、不删除源；目标已存在默认跳过；`overwrite=true` 时目标先改名 `*.bak-<时间戳>` 再覆盖。旧版 `backup-config.json` 的 `dbDir` 作为旧库来源被识别 | `src/electron/dataRoot.ts`（新增）、`src/electron/__tests__/dataRoot.test.ts`（新增，14 例） |
| 6-B 首次启动引导 + 迁移 | 启动早期解析指针：缺失 → `first-run`；损坏 → `corrupt`；路径非法/不可写/已删除 → `unusable`。`app.whenReady()` 后在创建主窗口前弹「首次启动：选择数据存放位置」（使用默认位置 / 选择文件夹… / 退出）；选定后写入指针并 `app.relaunch()` 重启一次，重启时在 ready 前 `app.setPath('userData', 根目录)`——Chromium 缓存与全部应用数据落在同一目录。首次选择空目录时额外检测旧数据（默认目录 / 旧 `multi-agent-memory`）并询问是否迁移，绝不合并两份不同记忆库。指针写失败→弹错误框并继续本次会话（下次重新询问）；取消→退出应用 | `src/electron/main.ts`（`resolveDataRootAtStartup` / `chooseDataRootInteractive` / `chooseMigrationSource` / `prepareDataRoot` / `applyDataRootMigration` / `importLegacyDbDir`） |
| 6-C 展示与更改 | 新 IPC：`dataRoot:get/open/change/restoreDefault`（`ipcChannels.ts` 单一真源 + 启动自检 + preload `window.api.dataRoot` + hostBridge `CHANNEL_TO_NATIVE`）。参数页「知识库管理」新增「数据存放位置」卡片：显示当前根目录/是否默认/实际记忆库路径，按钮「打开目录 / 更改位置 / 恢复默认位置」。更改/恢复走选择器→校验→可写探测→（目标已有数据时确认将 `.bak` 备份）→写指针→重启。旧版 P8 `dbDir` 设置与 5 个备份 IPC 全部退役；旧自定义库在启动时一次性导入（新根无库才导入），并从 `backup-config.json` 清除 `dbDir`/`pendingMove` | `src/electron/{ipcChannels,preload,main}.ts`、`src/desktop/hostBridge.ts`、`src/web/memory/{dataRoot.ts,backup.ts}`、`src/web/params/KbManagementCard.tsx` |
| 6-D 同步明确未实现 | 顶栏同步 pill / 首页横幅 / `MemAgent.sync()` 错误与审计文案统一为「同步未实现（本版本不提供云端同步）」；有 `pending_sync` 时追加「N 条待回传」；`wired=false` 时绝不显示「已同步」 | `src/core/memagent/agent.ts`、`src/web/Home/{TopBar,Dashboard,coreHome}.tsx/ts`、`src/types/home.ts` |
| 测试 | 新增 dataRoot 单测 14 例；更新 TopBar / Dashboard / coreHome 同步文案断言 | `src/electron/__tests__/dataRoot.test.ts`、`src/web/Home/__tests__/*` |
| 文档同步 | README / code-map / test-plan / MANUAL-TEST 测试计数更新为 **92 文件 / 855 用例**；新增「数据存放位置」说明与 TC-013；同步口径改为「未实现（本版本不提供云端同步）」 | `README.md`、`specs/{code-map,test-plan,MANUAL-TEST}.md` |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit`（strict） | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning** |
| 单元/集成测试 | `npm test` | **92 文件 / 855 用例全过** |
| 覆盖率阈值 | `npm run test:coverage` | 语句 75.02%、分支 65.37%、函数 71.3%、行 78.17%（阈值 71/61/67/74），通过 |
| Web 构建 | `npm run build` | 通过（21 个 HTML 入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功（仅存量 `import.meta` CJS 警告） |
| 真浏览器 E2E | `npm run test:e2e` | **21 spec / 88 用例全过（29.5s）** |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir） |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-074405/MultiAgent Memory-0.1.0-setup.exe` | 121,918,271 B = **116.27 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-074405/win-unpacked/` | `MultiAgent Memory.exe` 249,934,848 B，可直接运行 |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 被本机索引器占用（EPERM），打包脚本自动输出到时间戳目录，属预期。

## 4. 手动测试用例（重点）

> 日志：`<数据根>\main.log`。默认数据根为 `%APPDATA%\MultiAgent Memory`。
> 测试「首次启动」前请先删除 `%APPDATA%\MultiAgent Memory\data-root.json`（仅删指针，不删数据），或使用干净系统/新用户。

### 4.1 首次启动引导（6-B）

1. 安装并首次启动（无 `data-root.json`）。
2. **预期**：在出现主窗口前弹出「选择数据存放位置」对话框，标题「首次启动：选择数据存放位置」，正文显示默认位置 `%APPDATA%\MultiAgent Memory`，按钮「使用默认位置 / 选择文件夹… / 退出」。
3. 选择「使用默认位置」→ 应用自动退出并重启一次；重启后正常进入主界面。
4. 检查 `%APPDATA%\MultiAgent Memory\data-root.json`：`root` 应为 `%APPDATA%\MultiAgent Memory`，`version=1`，有 `updatedAt`。
5. 重复步骤 1–2 后选「选择文件夹…」并指定一个新文件夹（如 `D:\MAM-Data`）→ 重启后 `data-root.json` 的 `root` 指向该文件夹；`D:\MAM-Data` 下出现 `memories.db.json`、`main.log` 等真实数据文件。
6. 重复步骤 1–2 后选「退出」→ 应用直接退出，不创建主窗口、不生成数据。

### 4.2 旧数据检测与迁移（6-B）

1. 准备旧数据：让默认目录存在 `memories.db.json`（先用默认位置跑一次并写一条记忆），删除 `data-root.json`。
2. 首次启动选择**另一个空文件夹**。
3. **预期**：弹出「检测到旧数据」，显示迁移源目录、文件数、体积、最近修改时间；按钮「迁移旧数据 / 不迁移（从空库开始）」。
4. 选「迁移旧数据」→ 重启后新目录出现旧库与日志/备份配置；旧目录**保留**（不删除、不搬移）。
5. 选「不迁移」→ 新目录从空库开始；旧目录不受影响。
6. 若存在旧开发态目录 `%APPDATA%\multi-agent-memory` 且有数据，应作为候选被列出，但不会自动迁移。

### 4.3 数据挂载完整性（6-C）

1. 使用自定义数据根启动，完成登录、写入一条记忆、修改一次参数、做一次备份。
2. 在数据根目录逐项核对：
   - `memories.db.json`（记忆库）
   - `collector-cursor.json`（采集游标，采集跑过一轮后）
   - `main.log`、`float.log`（日志）
   - `mcp-token.txt`（本地服务令牌）
   - `backup-config.json`（备份配置）
   - `home-audit.json`（首页镜像账本）
   - `agent-onboard.json`（接入配置）
   - `backups/`（备份产物）
   - `memories-export/`（导出产物，按需）
3. **预期**：以上文件全部位于所选根目录；`%APPDATA%\MultiAgent Memory` 下除 `data-root.json` 外不应持续产生业务数据（Chromium 缓存也应随根目录）。
4. 参数页「知识库管理」→「数据存放位置」：显示当前根目录（非默认时无「（默认）」后缀）、实际记忆库路径；「打开目录」能打开资源管理器定位。
5. 浏览器模式（无 Electron）下该卡片应显示不可用提示，不报错。

### 4.4 更改位置 / 恢复默认（6-C）

1. 在有数据的情况下点「更改位置」，选一个**空文件夹** → 确认后重启；新目录含复制过来的数据，旧目录保留。
2. 点「更改位置」，选一个**已有数据**的文件夹 → 应弹出确认框说明目标文件将备份为 `*.bak-<时间戳>` 后覆盖；确认后重启，目标目录出现 `.bak-*` 文件与新数据。
3. 点「恢复默认位置」（当前为自定义目录）→ 若默认目录已有旧数据，同样出现 `.bak` 确认；恢复后重启，指针指回默认目录，数据以默认目录为准，自定义目录保留不被删除。
4. 在参数页由默认目录再次点「恢复默认位置」→ 应提示已在默认位置（不重启、不复制）。

### 4.5 目录损坏 / 不可用修复（6-B）

1. 先正常使用自定义目录，再退出应用，把该目录删除（或改为只读）。
2. 重新启动。
3. **预期**：弹出「数据目录不可用，请重新选择」，显示上次目录与失败原因；按钮「重新选择文件夹… / 改用默认位置 / 退出」。
4. 选「改用默认位置」且默认目录可写 → 重启后回到默认目录；原目录若仍存在数据，可作为迁移源被询问。
5. 删除 `data-root.json` 内容写入非法 JSON 后启动 → 应视为损坏并重新进入选择流程，不崩溃、不静默使用随机目录。

### 4.6 同步「未实现」标注（6-D）

1. 登录后观察顶栏同步 pill 与首页横幅。
2. **预期**：
   - 顶栏显示「同步未实现（本版本不提供云端同步）」；有 `pending_sync` 时追加「· N 条待回传」；
   - 断网/内核不可达时显示「离线 N 条待回传 · 同步未实现（本版本不提供云端同步）」；
   - 任何状态下**不得**出现「已同步」字样；
   - 若触发同步（内核 API），返回错误信息为「云端同步未实现（本版本不提供云端同步）」，审计 `action=sync, implemented:false`。

### 4.7 回归（不应受本轮影响）

1. 首页四卡仍来自真实账本（写一条记忆后累计记忆 +1）。
2. 备份/恢复、Agent 接入、日志、检索等页面功能正常。
3. 老用户的 `backup-config.json` 中 `dbDir` 被清除后，备份配置其余字段保留，备份功能正常。

## 5. 已知限制（不作为缺陷）

1. **本版本不提供云端同步**：同步引擎单测存在但生产未接线，UI 固定标注「同步未实现（本版本不提供云端同步）」。
2. **首次选择/更改位置后自动重启一次**：为保证 Chromium 缓存与全部数据落到新目录，属预期行为。
3. **指针固定在 `%APPDATA%\MultiAgent Memory\data-root.json`**：删除或损坏会重新进入选择流程；重装应用不会删除该指针。
4. **旧版 P8「记忆库保存位置（dbDir）」退役**：旧自定义库只在目标根无库时一次性导入，之后统一由数据根管理。
5. 若首启选择了自定义目录，默认目录可能残留首次会话的单实例锁/缓存文件，不影响使用。
6. 首次启动前若其它实例正在运行（同一 userData），单实例锁会直接退出第二个实例，需先关闭已运行实例再测首启。

## 6. 验收结论（待用户手测确认）

- 代码与自动化门禁全部通过（typecheck / lint / 855 单测 / 覆盖率 / E2E 88 例 / 打包）。
- 待用户按第 4 节在安装包上完成手动验收，重点：首次启动引导、数据挂载完整性、更改/恢复默认、目录损坏修复、同步「未实现」文案。
