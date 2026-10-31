# 手动测试报告 · 修复批次 7（管理员账号 + 全链路动作日志 + 可维护性）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-081255/MultiAgent Memory-0.1.0-setup.exe`（121,923,759 B = 116.28 MiB）
- SHA256：`baacf259b3721b17e3b7ce8a3ce3e8ed4a5f9b05cb0ceee2fa26fa7b42b425e5`
- 未打包目录：`release/installer-20261030-081255/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 数据根指针：`%APPDATA%\MultiAgent Memory\data-root.json`（固定，不随用户所选目录漂移）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md` ～ `specs/MANUAL-TEST-FIX-BATCH-6.md`

> 说明：本轮第一次打包（16:09）发现「UI 动作日志脚本在构建产物中仍是 `/src/...` 开发路径，打包后 404」的缺陷；已改为 19 个页面入口显式 import 并重新跑门禁、重新打包。**请只使用上方 08:12:55 的安装包，不要使用更早的构建。**

## 0. 本轮用户决策

1. **内置管理员账号**：`admin` / 默认密码 `Admin@123456`，登录后可在「账号与安全」页修改。
2. **敏感操作仅管理员**：数据位置更改/恢复、安全策略修改、成员/角色/团队管理、备份设置与执行；其余页面普通成员可用，敏感入口显示「需管理员」。
3. **可读可维护性 + 全链路日志**：面向人和大模型优化定位效率；任何有动作的地方都要输出日志，便于快速定位 BUG。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 7-A 管理员账号与权限 | 账号增加 `role: 'admin' \| 'member'`；启动时若不存在 admin 则播种内置管理员（同一账号已存在但没有管理员身份时升级为 admin，已有 admin 的密码不会被覆盖）。新增管理接口：账号列表、角色修改、团队分配、本人改密；**最后一个管理员不可降级**。登录弹窗提示首次管理员凭据；顶栏显示「（管理员）」。旧账号快照缺角色时迁移为 member，管理员角色随快照导出/导入保留 | `src/auth/loginService.ts`、`src/home/server.ts`、`src/web/Home/LoginModal.tsx`、`src/web/Home/TopBar.tsx`、`src/web/security/AccountAdminCard.tsx`、`src/web/security/accountsClient.ts` |
| 7-B 管理员门禁（三层） | ① 后端：`/api/accounts`、`/api/accounts/update` 仅 admin 会话可调用（401/403 + `home:accounts*_forbidden` 日志）；② 主进程：`requireAdmin` 基于 home 会话校验，门禁 `backup:saveConfig` / `backup:chooseDir` / `backup:runNow` / `dataRoot:change` / `dataRoot:restoreDefault`（拒绝时写 `ipc:<channel>` warn 日志）；③ UI：安全页策略/成员/密钥，参数页数据位置与备份按钮对非管理员只读/禁用并显示「🔒 需管理员」。日志页 L0 解锁与删除仍仅管理员 | `src/electron/main.ts`、`src/web/security/{SecurityPage,PwdPolicyCard}.tsx`、`src/web/params/KbManagementCard.tsx`、`src/web/logs/logic.ts` |
| 7-C 全链路动作日志 | 统一格式与脱敏 `shared/actionLog.ts`；主进程落盘 `electron/actionLog.ts`（同步 append、5 MiB 轮转、保留 3 份、控制台镜像、失败静默）；`handleIpc`/`handleIpcEvent` 为每个 IPC 记录耗时与错误；`registerLogIpc` 校验渲染层 payload 并截断 scope/action；preload `window.api.log.write`；`hostBridge.hostLog` 支持顶层与 iframe 转发；渲染层自动捕获 page_view / click / submit / change / script_error / unhandled_rejection（不记录输入值）；home 与 agentOnboard 服务通过 `onLog` 写同一文件。**本轮的修复**：UI 日志改为由 19 个页面入口显式 `import '../shared/actionLog.ts'` 安装，移除会把开发路径带进产物的 Vite HTML 注入插件 | `src/shared/actionLog.ts`、`src/electron/actionLog.ts`、`src/electron/{main,preload}.ts`、`src/desktop/hostBridge.ts`、`src/web/shared/actionLog.ts`、19 个页面入口、`vite.config.ts` |
| 7-D 可维护性 | 新增协作入口 `AGENTS.md`（分层、命令、任务→文件、日志排查、权限模型、编码约定、已知边界）；`src/electron/main.ts` 顶部「文件地图」（§1–§11 + actions.log 排查入口）；新增代码索引工具 `npm run code:index`（`--json` / `--write` → `specs/code-index.generated.md`，当前 249 个源码文件）；同步 README / code-map / test-plan / MANUAL-TEST | `AGENTS.md`、`tools/code-index.mjs`、`specs/code-index.generated.md`、`src/electron/main.ts`、`package.json`、`README.md`、`specs/*.md` |
| 测试 | 新增：shared 日志格式/脱敏 13 例、主进程落盘/轮转 9 例、管理员账号 12 例、home 管理接口 10 例、宿主桥日志 5 例、安全页角色 1 例；E2E security 重写为「未登录 / 普通成员 / 管理员」三种身份，共 8 例 | `src/shared/__tests__/actionLog.test.ts`、`src/electron/__tests__/actionLog.test.ts`、`src/auth/__tests__/admin.test.ts`、`src/home/__tests__/admin.test.ts`、`src/desktop/__tests__/hostBridge.test.ts`、`src/web/security/__tests__/SecurityPage.test.tsx`、`e2e/security.spec.ts` |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit`（strict） | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning** |
| 单元/集成测试 | `npm test` | **96 文件 / 905 用例全过** |
| 覆盖率 | `npm run test:coverage` | 语句 74.02%、分支 64.76%、函数 70.5%、行 77.26%（阈值 71/61/67/74），通过 |
| Web 构建 | `npx vite build` | 通过（19 个 HTML 入口）；产物已确认无 `/src/web/shared/actionLog.ts` 开发路径，`ui:page_view` 已打入 chunk |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功（仅存量 `import.meta` CJS 警告） |
| 真浏览器 E2E | `npm run test:e2e` | **21 spec / 92 用例全过（约 32s）** |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir） |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-081255/MultiAgent Memory-0.1.0-setup.exe` | 121,923,759 B = **116.28 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-081255/win-unpacked/` | `MultiAgent Memory.exe` 249,934,848 B，可直接运行 |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 被本机索引器占用（EPERM），打包脚本自动输出到时间戳目录，属预期。

## 4. 手动测试用例（重点）

> 日志位置：`<数据根>\actions.log`（默认 `%APPDATA%\MultiAgent Memory\actions.log`），与 `memories.db.json` 同目录。
> 账号库：`<数据根>\home-accounts.json`；登录/角色/改密审计：`<数据根>\home-audit.json`。

### 4.1 管理员默认账号、登录与改密（7-A）

1. 安装并启动，进入首页登录门控，点「▶ 登录」。
2. **预期**：登录弹窗底部显示「首次使用管理员：`admin` / `Admin@123456`（登录后请在「账号与安全」页修改默认密码）」。
3. 用 `admin` / `Admin@123456` 登录。
4. **预期**：顶栏显示「你好，admin（管理员） · 团队 …」；首页四卡正常。
5. 打开「账号与安全」页：
   - 管理员账号卡可见账号表，至少包含 `admin` 行且角色为 `admin`；
   - 密码策略控件可编辑；
   - 「试一试」样例校验仍可用。
6. 在管理员账号卡中修改密码：旧密码 `Admin@123456`，新密码自定（≥6 位，两次一致）→ 成功提示。
7. 退出登录，用**新密码**登录 → 成功；用**旧密码**登录 → 失败（连续输错 5 次锁定 15 分钟，属既有策略）。
8. 重启应用后用新密码仍可登录（账号已落盘）。
9. 把唯一的管理员账号降级为成员 → **预期**：提示最后一个管理员不可降级，角色不变。
10. 用另一账号登录并被提升为管理员后，再降级原管理员应允许（系统中始终至少一个 admin）。

### 4.2 普通成员只读门禁（7-B）

1. 退出登录 → 注册新账号（手机号/邮箱 + ≥6 位密码 + 页面验证码）。
2. 登录后观察顶栏：**不得**出现「（管理员）」。
3. 打开「账号与安全」页：
   - 账号卡显示「🔒 需管理员：账号/角色/团队管理与密码修改仅管理员可操作」；
   - 密码策略控件**全部禁用**，但「试一试」样例校验仍可用；
   - 成员表 / 密钥表无管理按钮。
4. 打开「参数」页 →「数据存放位置」卡片显示「🔒 需管理员：更改数据位置与备份设置仅管理员可操作」；「更改位置 / 恢复默认 / 选择备份目录 / 立即备份」按钮禁用并带「需管理员权限」提示。
5. （可选，高级）用成员会话直接请求 `GET http://127.0.0.1:8201/api/accounts` → 应返回 403，且 `actions.log` 出现 `home:accounts_forbidden`。
6. （可选）以成员身份强行触发备份/数据根 IPC → 主进程返回「需管理员权限」，并在 `actions.log` 写 `ipc:backup:saveConfig` 等 warn 日志（`denied:"not_admin"`）。

### 4.3 管理员独占操作（7-B）

1. **数据位置**：admin 登录 → 参数页点「更改位置」或「恢复默认位置」→ 正常弹出选择/确认并重启；成员登录时同样按钮禁用。
2. **备份**：admin 可保存备份配置、选择目录、立即执行一次备份；成员不可。
3. **安全策略**：admin 切换密码策略项 → toast 含 `req_` 回执，内核审计出现 `security_change`；成员操作被拦截。
4. **成员/角色/团队**：admin 在账号表把成员提升为 admin 或修改团队 → 目标账号重新登录后顶栏团队/角色变化；`home-audit.json` 出现 `role_change` / `team_assign`，`actions.log` 出现 `home:role_change` / `home:team_assign`（含操作者 `by`）。
5. **日志页**：L0 解密解锁与删除仅 admin；普通成员恒遮罩。

### 4.4 全链路动作日志（7-C）

1. 启动应用，依次打开首页、安全页、参数页、记忆管理页，并点击几个按钮/提交一次表单。
2. 退出应用，用记事本/VS Code 打开 `<数据根>\actions.log`。
3. **预期**（每行一条，格式见下）：
   - `ui:page_view`、`ui:click`、`ui:submit` / `ui:change`（含 `page`、`tag`、`testid`、按钮文案；**不含输入框内容**）；
   - `ipc:<channel>`（成功含 `ms`，失败含 `error`）；
   - `home:http`（含 method/path/status/ms）、登录相关 `home:login_ok` / `home:login_fail` / `home:logout` / `home:register`；
   - 管理员操作 `home:role_change` / `home:team_assign` / `home:password_change`；
   - 启动标记 `app:bootstrap:start`（含数据根）。
4. 行格式：

   ```text
   [2026-10-30T08:12:55.123Z] [info] [ui:click] {"tag":"button","page":"security.html","testid":"pwd-upper","text":"大写"}
   [2026-10-30T08:12:56.456Z] [info] [ipc:storage:putMemory] {"ms":3}
   [2026-10-30T08:13:01.789Z] [info] [home:http] {"method":"POST","path":"/api/login","status":200,"ms":12}
   ```

5. 敏感信息检查：登录/改密/备份操作后，全文件搜索实际密码、令牌值 → **不得出现**；对应字段应为 `***`。
6. 错误可定位：制造一次失败（如成员触发管理员 IPC）→ 应出现 `level=warn` 的 `denied`；页面脚本异常 → `ui:script_error`（`level=error`）。
7. 用审计回执中的 `req_...` 在 `actions.log`、`home-audit.json`、内核审计（`memories.db.json` 的 audit）中检索，链路应能对上。
8. 轮转（可选）：日志超过 5 MiB 后出现 `actions.1.log`，最多保留 `actions.1.log`～`actions.3.log`（单测已覆盖；手测非必须）。
9. **重要**：打包版中必须能看到 `ui:*`。若只有 `ipc:*` / `home:*` 而无任何 `ui:*`，说明 UI 日志未安装，请报告。

### 4.5 可维护性交付（7-D）

1. 打开仓库根目录 `AGENTS.md`：应能按「任务 → 文件」表直接定位页面/内核/主进程代码，并按第 4 节理解日志写入路径与排查方式。
2. 执行 `npm run code:index`：终端输出按模块分组的文件索引；`npm run code:index -- --write` 生成 `specs/code-index.generated.md`（当前 249 个源码文件）。
3. 打开 `src/electron/main.ts`：顶部应有「文件地图」（§1 路径常量 … §11 窗口生命周期），各段前有 `// ── §N ... ──` 搜索锚点；第 60 行附近标注 `actions.log` 排查入口。
4. 排查演练：随机给一个报错或页面，按 `AGENTS.md` 的映射表找到入口文件，再按 scope/action grep `actions.log` 复现链路。

### 4.6 回归（不应受本轮影响）

1. 首页四卡仍来自真实账本；写一条记忆后「累计记忆 / 累计动作」+1。
2. 同步仍显示「同步未实现（本版本不提供云端同步）」，不得出现「已同步」。
3. 遗忘调度按参数页「自动整理」开关执行（可用 `MAM_FORGETTING_*` 环境变量缩短周期）。
4. 数据位置更改/恢复默认后重启，`actions.log` 随白名单一起复制到新目录。
5. 注册/登录/锁定、Agent 接入、检索、冲突、审计、日志等页面功能正常。
6. 安全页 E2E 三种身份（未登录 / 成员 / 管理员）行为与自动化一致。

## 5. 已知限制（不作为缺陷）

1. **本版本不提供云端同步**：UI 固定标注「同步未实现（本版本不提供云端同步）」。
2. **管理员默认密码是公开的**：`admin` / `Admin@123456` 仅用于首次进入；当前不会强制改密，请在首次登录后立即在「账号与安全」页修改。
3. **账号/团队为本地账号体系**：存储在 `<数据根>\home-accounts.json`，不是企业 SSO；团队由管理员分配、顶栏只读。
4. **密码策略卡目前只写审计**：修改会记录 `security_change`，但策略保存在页面状态，尚未持久化、也未在注册/登录时强制执行；历史密码查重暂无域模型（页面已标注）。
5. **普通成员当前无法在 UI 自行改密**：改密入口在仅管理员可见的账号卡内；后端 `/api/password` 本身允许登录用户凭旧密码修改，后续可开放成员入口。
6. **动作日志会轮转覆盖**：默认单文件 5 MiB、保留 3 份历史；更早的日志会被删除。日志只记元素摘要，不记输入值，因此无法从日志还原用户填写的密码/密钥。
7. **新增页面需显式引入日志模块**：页面入口必须 `import '../shared/actionLog.ts'` 才有 `ui:*` 日志；这一约定已写入 `AGENTS.md`。本轮已移除会把开发路径带进产物的 Vite HTML 注入方案。
8. **成员/密钥表可能为空**：内核暂无对应域模型，空表是真实初始态；账号表来自本地 home 账号库。
9. `release/installer` 目录可能被本机索引器占用，打包脚本自动改用时间戳目录。

## 6. 验收结论（待用户手测确认）

- 代码与自动化门禁全部通过：typecheck / lint（0 警告）/ 905 单测 / 覆盖率阈值 / E2E 92 例 / 打包。
- 待用户按第 4 节在 **08:12:55 安装包** 上完成手动验收，重点：
  1. `admin` / `Admin@123456` 登录、改密与「最后一个管理员」保护；
  2. 普通成员在安全页/参数页的只读与「需管理员」提示；
  3. 管理员独占的数据位置、备份、角色/团队操作；
  4. `<数据根>\actions.log` 中存在 `ui:*`、`ipc:*`、`home:*` 日志，格式正确、敏感字段为 `***`；
  5. `AGENTS.md` + `npm run code:index` 能快速定位代码。
