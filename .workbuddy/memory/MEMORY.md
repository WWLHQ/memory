# 项目长期记忆（MEMORY.md）

## 仓库与 CI
- 远端：`https://github.com/WWLHQ/memory`（公开仓，默认分支 `main`），GitHub Actions 跑 CI。
- CI 门禁三道（`.github/workflows/ci.yml`）：`npm test` → `python tools/validate_project.py` → `python tools/generate.py --check`。
- **关键约定**：`build/` 是 SSOT 产物、**gitignored 不入库**。CI 必须**先 `python tools/generate.py` 重建 build/，再 `generate.py --check`**，否则全新 checkout 下 `--check` 必红（build/ 不存在）。
- 本地零依赖：`node --test`（Node 22 内置），无需 `npm install`；`npm test` 跑全部 45 例。

## Git / 推送习惯
- 本机无 `gh` CLI、Bash 工具非交互；推 GitHub 用 classic PAT。
- **推送含 `.github/workflows/*.yml` 的提交，PAT 必须带 `workflow` 作用域**（仅 `repo`/`public_repo` 不够）。
- 推完立即 `git remote set-url origin <干净URL>` 去除 token，并建议在 GitHub 删除该 PAT。
- 任务提交粒度：每原子任务（T1/T2…）单 commit；CICD 配置修复走 PR 验证双触发。

## 当前进度
- REQ-003（Agent 接入页）代码全量落盘（T1–T12），T1/T2 已分别 commit；T3–T12 此前写入但未逐任务提交。
- 下一步候选：补 T3–T12 逐任务 commit；或推进 REQ-004~REQ-012（补字段级 AC/TC + 跑通一个功能）。

## 提交约定
- **每次提交必须写提交日志**（conventional commit 风格）：`type(scope): 简述`（首行 ≤72 字），空行，正文写 Why/What/影响范围，结尾 `Co-Authored-By: CodeBuddy Code <noreply@codebuddy.ai>`。2026-10-07 起生效，CodeBuddy 每次 commit 遵守。
- 原子任务理想每任务一 commit；但 REQ-003 全量代码已在 initial commit `04cb27b` 打包（未逐任务拆）。决策：不重写已推送历史，改为在 `specs/code-map.md` 写任务→文件/函数归属以保证可追溯。

## 执行流程约定（用户 2026-10-07 明确）
- **每完成一个原子任务（一步），先展示成果（测试/门禁输出 + 改动清单），等人工确认后再继续下一步。** 不擅自连跑多步。
- 接真实后端按 T13→T14→T15 原子推进，沿用 TDD + 每任务一 commit + 门禁（npm test / validate / generate --check）。

## 打包 → 验证 → 推送流程（用户 2026-11-10 明确，长期生效）
- **每次改完代码都要重新打包来验证；验证 OK 后才允许推送。** 不得跳过打包直接 push，也不得打包未验证就 push。
- 顺序：全门禁（typecheck/lint/test:gate/check:no-demo/code:index + E2E + validate + generate --check）→ `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` → 验证打包产物 → commit + push。
- 打包路径固定不改（N7 约定）：安装包 `release/installer/`、免安装版 `release/win-unpacked/`；`CODEBUDDY_SAFE_DELETE_ENABLED=0` 用于绕过批量删除护栏（dist/assets 文件数常 >50）。
- 验证产物至少核对：安装包 exe 存在且非空、win-unpacked 内主程序 exe/资源齐全、包内前端产物含本轮改动的类名/特性、SHA256 记录。
- 推送沿用「Git / 推送习惯」：remote 当前为 SSH `git@github.com:WWLHQ/memory.git`；若改用 HTTPS+PAT，PAT 需 `workflow` 作用域，推完立即 `git remote set-url` 去 token。
- **打包副作用（2026-11-10 发现）**：`npm run package` 会让 electron-builder 改写根 `package.json`（清空 `scripts` 与 `devDependencies`）且**不还原** → 打包后必须 `git checkout -- package.json` 还原，否则后续 `npm test`/`npm run typecheck` 全部失效。提交前用 `git status` 确认，别把它当成代码改动提交进去。
- **本机启动打包产物的坑**：PowerShell `Start-Process` 会因环境里存在**大小写重复的代理变量**（`HTTP_PROXY`/`http_proxy`/`HTTPS_PROXY`/`https_proxy`）直接抛「已添加项。字典中的关键字」异常，应用根本没启动 —— 这是**环境问题不是应用缺陷**。
- **启动打包产物必须同时清 `ELECTRON_RUN_AS_NODE`**（2026-11-10 定位，最隐蔽的一个坑）：WorkBuddy 自身环境注入 `ELECTRON_RUN_AS_NODE=1` 与 `NODE_OPTIONS=--require=...node-language-shim.cjs`。有 `ELECTRON_RUN_AS_NODE=1` 时 Electron **以纯 Node 模式运行**（不起 Chromium、不触发 `app.whenReady`）→ 表现为「进程活着但只有 1 个、无子进程、8202/8203/8204 全不监听、命令行参数报 `bad option: --xxx`」，极易误判成产品缺陷。正确启动命令：
  `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY "./MultiAgent Memory.exe"`
  （Bash 后台 `&` 起的进程会随 Bash 工具会话结束被回收，验证要用 `run_in_background` 托管，或前台 `timeout N` 跑并看退出码 124=仍存活。）
- 启动成功的判据别只看 `tasklist`（exe 名含空格易漏）：看 `netstat` 的 8202/8203/8204 是否 LISTENING + `main.log`/stdout 有 `bootstrap:done`。静态服务端口从 `main.log` 的 `bootstrap:static-server {"port":NNNNN}` 取。
- `release/` 下历史 `installer-*` 旧目录常因系统句柄占用删不掉（EBUSY），属跨天残留；`release/` 已 gitignored，不入库、不影响交付，不必强删。

## 实现与规格的差异（REQ-003）
- `specs/tasks/AGENT-ONBOARD.md` 按 TS+React 拆 `src/web/AgentOnboard/*.tsx` 单组件；**实际落地为纯 ESM JS**（零依赖、Node 内置 `node:test`），UI 合并进 `src/agentOnboard/render.js`、集成进 `service.js`、端矩阵进 `formMatrix.js`、`validators.js` 承载 R1–R10、`e2e.test.js` 承载 T12。可追溯映射以实际 JS 为准（见 `specs/code-map.md` REQ-003 任务级表）。

## 个人记忆 / L0 关键口径（2026-11-10 确认，长期有效）
- **L0 是两把独立的锁**（§4.4.4，互不替代）：写锁 `write_unlocked`（`unlockWrite`/`lockWrite`，管「能不能写」）· 查阅锁 `active_sessions`（`unlock`/`lock(session_id)`，管「能不能解密查阅」）。状态栏曾用 `active_sessions` 推导「已锁定」→ 写锁已解锁时仍显示锁定（误导 bug），已改为直读写锁。
- **进库分流**：agent 写入的账本行按 `session_id` 分流 —— 有 `session_id` = **会话信息 → 直接放行**（留共享池，不打扰用户）；无 `session_id` = **agent 提取的记忆 → 进发件箱**等用户判定（是我的→私人池 / 不是我的→进共享）。判据只认内核写入时落的 `session_id`，绝不靠正文关键字猜。
- **个人记忆入口**：主导航「个人记忆」→ 打开**记忆库全页的个人记忆 Tab**（`memory.html?tab=personal`）；壳层常驻面板改由**状态栏快捷按钮**进入（460px 浮层装不下 2910 条候选，双窗会被挤没）。两处共用 `PersonalMemoryPane` + `personalMemoryPane.css`（组件自带样式，不依赖 `memoryManagement.css`）。
- **跨页状态刷新**：写锁解锁走主进程 IPC、不写 localStorage → 首页/状态栏原本不刷新（红条常驻不消失）。已加 `src/web/shared/l0WriteLockSignal.ts`：写锁变化时写 `memdesk.l0.writeLockSignal.v1` 信号键，同源其它文档经 storage 事件重读真实 `l0Status()`。**信号只带时间戳、不携带状态值**（真值永远来自内核）。注意：storage 事件只在「其它」同源文档触发，同文档 setItem 收不到 → 测试须用另一标签页/iframe 写入。

## 壳层页面形态与刷新口径（2026-11-10 用户要求，长期有效）
- **记忆助手已是独立整页**：`assistant.html` + `src/web/assistant/AssistantPage.tsx`（自带 `assistantPage.css`），页面自己调 `loadOverview()` 取快照（原壳层浮窗 `shell/MemoryAssistant.tsx` 已删除）。`NavItem.panel` 机制**已整体移除**（全站再无面板型导航项）。
- **功能导航折叠 = 窄图标栏，不是归零**：`navCollapsed` 时 `--nav-w` 取 `NAV_COLLAPSED_W=44`（原来取 0 → 栏体消失、功能全没了）。折叠态树项加 `.icon-only`：只显示 `.tico` 图标，`.tlabel`/`.tcount`/`.tw` 隐藏，名称走 `title`；组标题退化为细分隔线；点击图标仍打开对应页面。
- **刷新三层语义（统一约定）**：
  1. **F5 = 全站刷新**：`reloadNonce` 递增 → 全部打开的 iframe 重挂（页面重新挂载即重取数）+ 状态栏/底部面板/导航角标/概览快照一并重读。壳层文案统一为「刷新全部页面」。
  2. **页面内「刷新/重读」= 只重取本页数据**，不重挂页面、不丢会话与已填内容。用 `useRefreshAll`（`src/web/shared/kernelLoad.tsx`）把本页多个 `useKernelLoad` 数据源合成一个入口。
  3. **卡片级「刷新」= 只重取该卡片自己的数据源**（安全页各卡片等）。
- **修掉的真实缺陷**：记忆库页有 6 个数据源（列表/分层策略/冲突队列/待重放/库位置/个人记忆），原「刷新」只调了其中 2 个的 retry，其余仍显示旧值 → 已全部走 `refreshAll`。
- **页面配色变量有两套，别混用**：`shared/theme.css` 只有深色 `--bg/--txt/--muted`；**记忆库页那套（`memoryManagement.css`）才是标准**：`--text/--muted/--faint/--panel/--field/--line/--line-2/--accent/--chip/--win`，浅色默认 + `html[data-theme="dark"]` 深色。**新页面一律引 `memoryManagement.css` 并用这套变量名**，否则会退化成浏览器默认深色（记忆助手整页曾因此整页发黑）。
- **状态栏 L0 格要同时显示两把锁**：`查阅锁`（解密查阅会话，`active_sessions`）+ `写锁`（写密钥，`write_unlocked`），格式 `查阅2会话 · 写已解`；hover 说明写明「两把锁互不替代」。浏览器模式读不到时如实显示「不可用」，不冒充任一状态。

## 项目纯净度约定（用户 2026-10-10 明确）
- **验收/验证完成后，验证用的临时文件必须删除**（如 test-results/、失败截图、临时 html/log、一次性脚本）。
- **项目文件夹保持纯净**：与项目无关的文件及时清理，不留在仓库根目录。
- Windows 下避免产生 `nul` 垃圾文件（Git Bash 里 `> NUL` 会生成名为 nul 的实体文件，应使用 `> /dev/null`）。
- 验收收尾时默认执行一轮垃圾清扫并汇报清理清单，再走 commit。
- **入口 html / 产物文件名一律全小写**：Windows 文件系统大小写不敏感会掩盖 URL 与文件名的大小写错位，Linux CI 上直接 404（P13 时期 inlineAttribution.html 教训，5726a35 修复）。新增页面入口时命名前先确认。
- 跨平台排查 CI 失败：本地 WSL Ubuntu clone 到 ~/ 本地盘（勿在 /mnt 挂载盘 npm ci，会 EIO 损坏 Windows node_modules）跑 CI 同款命令（--workers=1）即可复刻；node_modules 损坏用 npm install 增量修复。

## WSL Linux 复刻环境（2026-10-10 建立）
- WSL2 Ubuntu 26.04.1，node v20.20.2（⚠️ 无 node:sqlite，22.13+ 才有——sqliteStorage 测试跳过或升 node 22）；用户 lhq，sudo 需密码（不能 playwright install --with-deps 自动化）
- E2E 复刻工作区：~/memory-wsl（git clone 自 Windows 仓库，勿共用 node_modules）；playwright chromium 系统库 Ubuntu 26.04 已齐，headless 直启 OK
- 基线：npm run test:e2e 85/85（27.4s）全绿；pglite/pgSyncHub 6/6 Linux 全绿
