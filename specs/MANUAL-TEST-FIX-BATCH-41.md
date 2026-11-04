# 批次41 手动测试报告 · 审计搬出记忆库 + 队列卫生 + 退避/退出/备份校验 + 删除如实告知（收口与首次真机执行）

日期（UTC+08:00）：2026-11-04
分支：`main`，HEAD 仍是 `3a4080a`（**批次35、36、37、38、39、40、41 的改动全部未提交**；`git commit`/`git push` 需用户明确授权，本批未提交）
上一批次：批次40（`specs/MANUAL-TEST-FIX-BATCH-40.md`）
起因（用户原话）：「审计搬出记忆库」→「跑」（授权走完 41-Z：`verify` → `package` → 本报告）→ 追加「队列幽灵对账」（复查 41-C，产出 **41-P**）→ 追加「轮换 DSH MCP Bearer 令牌」（**41-L 已真机执行**，用户口径「全量换 + 全量重写」）

---

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,048,550 字节 = **116.39 MB** |
| SHA256 | `E5160D30647EFC5E511D366A6BAEA2260E682869E5247691AB1DD26845A30634` |
| 落盘完成（UTC+08:00） | 2026-11-04 10:17:07 |
| `npm run verify` | **退出码 0**（typecheck → oxlint → 索引新鲜度 → 覆盖率 → `build:electron` → E2E 一条链跑完，未分段） |
| `npm run typecheck` | 干净（`tsc --noEmit` + `tsc --noEmit -p tsconfig.electron.json`） |
| `npm run lint` | oxlint **0 warnings / 0 errors** |
| `npm run code:index:check` | 代码索引已是最新（**306 个文件**；`npm run package` 的 `prepackage` 又自动刷新一次） |
| 单测 | vitest **147 文件 / 1733 例全过** |
| `npm run test:coverage` | Statements 81.76% / Branches 73.98% / Lines 84.83% |
| `npm run test:e2e` | Playwright **106 passed（37.3s）** |
| 打包过程 | 一次 EPERM 回退按批次21 既定路径走完：`release/installer` 被外部进程占用 → 本次先输出到 `release\installer-20261104-021635` → 构建成功后删旧目录并**收口回 `release/installer`**（日志 `[package] 已删除旧 release/installer，并把本次产物收口到固定目录` / `[package] 产物：release\installer；旧安装包目录清理 1 个`）。同时按流程删除便携产物 `release\win-unpacked` → **`release/` 下现在只有 `installer` 一个目录**。 |
| 未做 | 没有执行 `npm run rejudge` 之外的账本批量改写；**没有点过**安全页任何需口令按钮（`SPLIT` / `RESET` / `REJUDGE` / `REBUILD`）；未提交、未推送。**41-L 已做**（令牌轮换见 §2 末尾，属运维动作、零代码改动、没碰账本） |

> **判据校正（写给下一位维护者）**：用 `grep <符号> app.asar` 判断「产物里有没有某段代码」在本项目**不成立**。electron-builder 把 `dist-electron` 放进了 `app.asar.unpacked/`，asar 本体里 `grep audit.jsonl` 恒为 **0（假阴性）**。正确做法：比对 `app.asar.unpacked/dist-electron/main.cjs` 与刚构建的 `dist-electron/main.cjs` 的 md5（本次同为 `5c251652c6c712c2cf7f514fc96cce38`，`audit.jsonl` 命中 3 次），或直接看真机启动的动作日志。本报告初稿差点把「41-A 没进包」写成结论，就是这个假阴性造成的，已用真机启动证伪。

---

## 1. 本批最重要的一条：批次41 的代码此前从未在用户机上运行过

收口前实测（2026-11-04 09:45–09:49，只读）：

- 数据根写锁 `memories.db.json.lock` 内容 `{"pid":19008,…}`，该进程可执行路径 = `release/installer/win-unpacked/MultiAgent Memory.exe`，而这份 `win-unpacked` 是 **2026-11-03 14:32 的批次40-E 产物**。
- 那份 `app.asar` 里 `grep audit.jsonl` = 0 → 41-A 的 `FileAuditLog` 不在运行的二进制里。
- 由此可量化三笔「写了但没生效」的账：**审计仍 11,847 行躺在 `memories.db.json`**（库 14,283,011 B，每条审计整库 stringify）；**`refine-queue.json` 里 124 条幽灵仍在**（队列 1655 条 vs 活行 1532）；41-D/41-E/41-F/41-O 同样从未执行。

所以本报告的「收口」包含两步真实执行，而不只是文档与打包：

1. `npm run build && npm run build:electron && node tools/package-win.cjs` → 便携产物 `release/win-unpacked/`（不碰正在运行的 `release/installer/`，不产出安装包）。向 pid 19008 发 `CloseMainWindow()`（返回 `True`，走 `before-quit`：落盘 commit、清内存 L0 密钥），写锁自行释放 → 启动便携产物 → **10:08:50 41-A 存量迁移闸门自跑**。
2. `npm run verify`（绿）→ `npm run package` → `release/installer` 换成含批次41 的产物（便携目录按流程被删除，所以长期入口是安装包）→ 启动安装包产物（现运行进程 pid 37584，路径 `release/installer/win-unpacked/MultiAgent Memory.exe`）→ **10:18:33 第二次启动做幂等复验**。

---

## 2. 已真机执行并验证的三项（41-A / 41-C / 41-L），证据全部来自数据根

| 环节 | 动作日志 / 文件实测 |
|---|---|
| 迁移前先备份 | `[kernel:audit:log-backup] {"dir":"…/backups/audit-log-split-2026-11-04T02-08-50-029Z","copied":["memories.db.json","memories.l0.json","l0-keyring.json"]}` — **3 源**；`memories.db.json` 是迁移前的 14,283,011 B 快照。当时 `audit.jsonl` 还不存在，因此**没有第 4 源 `memaudit-`**，属「缺哪个源就明写缺哪个」，不是漏备 |
| 搬 | `[kernel:audit:log-migrated] {"migrated_rows":11847,"to":"…/audit.jsonl"}` |
| 观测 | `[kernel:audit:log-open] {"path":"…/audit.jsonl","rows":11847,"bytes":3067402,"archive_files":0,"archived_rows":0,"skipped_lines":0,"readonly":false}` |
| 结构核对 | `audit.jsonl` **11,847 行逐行 `JSON.parse` 通过、0 坏行**；`memories.db.json` 的 `doc.audit` 长度 **0**；库文件 **14,283,011 → 11,215,610 B（−3.07 MB）**；记忆行数 **1532 未变** → 迁移前后审计条数相等，`queryAudit` 全量口径一行没丢 |
| 幂等（第二次启动） | 只有 `[kernel:audit:log-open] rows=11855`，**不再出现 `log-migrated`** —— 与 `fileStorage.test.ts`「存量迁移与二次启动不重复」那条用例同口径，真机成立 |
| 追加式仍在写 | 收口过程中 `audit.jsonl` 11,847 → 11,856 → **11,872 行 / 3,074,069 B**（新行是 `memory_op`），写锁由新产物持有 —— 不是「搬完就静止」 |
| 41-C 幽灵对账 | 首次启动 `[kernel:refine:backfill-scan] … "pruned_ghosts":124`（队列 1655 → 1531，现量幽灵 **0**）；第二次启动 `"pruned_ghosts":0` = **幂等** |
| 时延收益 | **本机无足量样本，不给数字**：迁移后 `ipc:storage:putMemory` 命中 n=0，迁移前 n=3（中位 165 ms）。41-A 复刻实验的 28.7 倍属**临时目录测量**，不得当本机实测值引用 |

**41-C 复查「幽灵收干净了吗」（2026-11-04 10:29–10:31，只读）**：队列 **1531** 项 vs 活行 **1532** → **幽灵 0**，摘除后不回流、幂等仍在。状态分布 `pending 1150 · done 314 · skipped 65（全 `thin`）· failed 2（全 `bad_json`）`，当日 `dayRows=54/500`（应用正在补炼，这是运行中快照，`pending`/`dayRows` 每分钟都在变）。唯一「有 L1、无深层、却不在队列」的活行是 `params_01M6AGZS9K4CTQM23HV64MYF1E`（`pinned=true`）——保护行不入队是批次39/40 的既定口径，不是漏。
复查同时量出一个真缺口并已修：硬删通道**有四条**，41-C 只接了三条，第四条 `rebuildLayersFromL0` 的 purge 分支（`src/core/memagent/rebuild.ts:299`）没接对账 → 见下表 **41-P**（该接线**不在**本报告 §0 那个 10:17:07 的安装包里，要生效需重新打包）。

**41-L 轮换 MCP 机器令牌（2026-11-04 10:47–10:56，已真机执行，零代码改动）**

用户指令是「轮换 DSH MCP Bearer 令牌」。先量了一句能决定做法的事实：**本机的 MCP 凭据是机器级单令牌**，`assertMcpToken()` 只回一个字符串，`loadOrCreateMcpToken()`（`src/electron/main.ts:507-519`）只在 bootstrap 跑一次并同时喂 8202（TCP）、8204（HTTP）、8203（webhook）和接入面板；而 `deepseek-harness` 配方是 `configPath:null` + `inheritsFrom:'qoder-cn'` + `writable:true`——它**没有自己的配置面**，用的就是那一个令牌。所以「只换 DSH 一家」在现架构下做不到，我把这条摆出来后用户改口径为「全量换 + 全量重写」。按客户端/成员发独立密钥是 **41-K/45-B** 的事（方案已备，未实现）。

| 步 | 做了什么 | 实测证据 |
|---|---|---|
| 1 退 | 向持写锁的主进程发 `CloseMainWindow()` → 走 `before-quit`（落盘 commit、清内存 L0 密钥）→ `memories.db.json.lock` **自行释放**（没有手删锁文件） | `CloseMainWindow=True` / `StillRunning=False` |
| 2 换 | `mcp-token.txt` 用 `randomBytes(32).hex` 新值原子替换（tmp + rename）。**旧值全程零落盘**——我起草的脚本末尾原本要把旧令牌另存一份给下一步用，那等于白轮换，跑之前就删掉了 | 新令牌指纹 `6fef9c55022c`、退役值 `005925732bce`（sha256 前 12 位，**都不是令牌本身**）；现役 5 份客户端配置里退役值 **0 命中** |
| 3 重写 | 用**生产函数** `wireMcpClient(id, token, { currentToken })`（`src/electron/mcpClients.ts`，纯 Node 无 Electron 依赖）逐家跑 `qoder-cn`/`claude-code`/`codex`/`trae-cn`/`workbuddy` + `deepseek-harness`（委托宿主真实写入）；每家先 `.bak-<ISO>` 再合并，冲突/坏文件按既定拒绝 | 5 份备份：`settings.json.bak-2026-11-04T02-50-59-433Z`、`.claude.json.bak-…-435Z`、`config.toml.bak-…-438Z`、`Trae CN/User/mcp.json.bak-…-443Z`、`.workbuddy/mcp.json.bak-…-445Z` |
| 4 DSH 侧 | 本机另有一份 DSH 私有配置 `dsh-bundles/dsh-memagent-mcp/cordis.patch.yml`（被 `.gitignore:61` 的 `/dsh-bundles/` 覆盖，**绝不提交**）按「恰好一个 64 位 hex」守卫替换 | mtime 10:51:17，文件内唯一 hex64 指纹 = 新令牌 |
| 5 重启 | 安装包产物起来（同批进程 11548/34388/37012/38552，写锁 `{"pid":38552}`），启动观测正常 | `[app:bootstrap:start]` 02:51:48Z（=10:51:48 UTC+08:00）、`kernel:audit:log-open rows=11958`、`refine:backfill-scan pruned_ghosts:0` |

探针只回状态码，令牌值不打印、不落日志：

| 探针 | 结果 |
|---|---|
| 8204 `/mcp` `tools/call list_projects` + `Authorization: Bearer <新>` | **200**，响应体不含令牌明文 |
| 同上传错误令牌 | **401** `{"code":-32001,"message":"unauthorized"}` |
| 同上传 `x-mcp-token: <新>` | **200** |
| 同上不带凭据 | **401** |
| webhook 8203 `/ingest/status` 无令牌 | **401**（批次26-A 口径不变） |

边界（不留给用户猜）：① **退役值仍在上面 5 份 `.bak-*` 里**——备份原文件是 `wireMcpClient` 的既定行为，批次26-B P2-15 只保留最新 3 份。它已**不能访问任何东西**（服务端只认新值），要把备份也清干净得手工删，本批没有替你删；② `mcp-token.txt` 请求 0600，但 Windows 上 `fs.statSync().mode` 报 **666**——应用首次写入时也是这个值（真实权限由 NTFS ACL 决定，不看 POSIX 位），属既有表现、不是本次回归；③ 令牌就绪只写 `main.log` 的 `mlog`，**动作日志无对应键**（与 41-B 的 `forgetting:cycle` 同一类观测缺口）；④ **本会话的 Qoder 侧连接器没实测**：`~/.qoder-cn/settings.json` 里那条 `Authorization` 已按**指纹**核对 = 与新令牌一致（说明重写生效），但 `mcp_list` 查 `multiagent_memory` 在本次会话命中 0——令牌是 Qoder 启动时读走的，所以「重载 Qoder 后召回走新令牌」是推断，需你重载 Qoder 后按 §1.1 的召回审计核对；⑤ 单令牌仍是**机器级凭据**（拿到即全库 + §1.1 召回），按客户端隔离属 41-K/45-B。

---

## 3. 待实机走查（这些项只有单测，本批没有真机样本 —— 逐条给可执行步骤）

> 前提：用管理员登录（`release/installer/win-unpacked/MultiAgent Memory.exe`），数据根 `%APPDATA%\MultiAgent Memory`。核对入口统一是数据根 `actions.log` 与日志记录页顶部「程序运行日志」（人话视图）。

**41-B 遗忘摘要行的 `sha256` + 向量（0 条真机产物）**
- 现状实测：`main.log` 里 `forgetting:cycle` 共 **33 条**，最近一条 2026-11-04 09:55:31 `summaries_created:0`（`freshness_updated:1532 migrated:16`）——合并组需同键 ≥3 行才触发，本机一次都没凑齐。
- 步骤：凑出同一 `project_id + category + content 前 8 字` 的 ≥3 行 → 等遗忘周期（`FORGETTING_INTERVAL_MS` = 6h，或重启后 `why:"first"` 那轮）→ 数据根里出现 `sum_` 前缀行 → 断言该行 `sha256 = sha256hex(content_l1)`、`embedding` 非空，并在记忆库页用该行 L1 原文做语义检索能命中它。
- 顺带记录的观测缺口：该周期**只写 `main.log`、不写 `actions.log`**（`src/electron/main.ts:2972` 只有 `mlog`），属既有问题、不属批次41，本批未顺手改。

**41-D 采集器失败指数退避（今日 `collector:backoff*` 0 命中 = 未触发）**
- 现状实测：今日 `actions.log` 里 `collector:backoff` / `backoff-auto-stopped` / `backoff-recovered` **全部 0 条**——采集器一直在成功推进，退避状态机只有 `sessionCollector.test.ts` 5 例覆盖。
- 步骤：在安全页把 L0 写密钥锁定后不再解锁（或停掉采集源目录权限）→ 观察 `[collector:backoff]` 的 `delayMs` 按 5→10→20→40→80→120(分钟) 递增、封顶 2h → 连续 6 次失败后出现 `[collector:backoff-auto-stopped]` 且不再自动重试 → 解锁后出现 `[collector:backoff-recovered]`，`collector:status` 的 `consecutiveFails` 归 0、`autoRetryStopped` 回假。
- 别把「没日志」当「已验证」：这条在真机上属于**尚未实证**。

**41-E 主窗口创建失败必须报错并退出（无自动化，Electron 接线级）**
- 步骤：临时制造窗口创建失败（例如在启动参数里禁用 GPU/或把 `dist/index.html` 改名后启动）→ 应弹「主窗口创建失败」错框（含原因与 `main.log` 路径）→ `actions.log` 出现 `[app:bootstrap:window-failed]` 且 detail 带 `logPath` → **进程退出、`memories.db.json.lock` 被释放**（不再是「双击没反应但进程持锁活着」）。

**41-F 备份目录校验 + 删除只认本配方**
- 步骤①（校验）：参数页备份卡把目录改成相对路径 / UNC（`\\server\share`）/ 不可写路径 → 应**如实报错且不落配置**（`backup-config.json` 的 `dir` 不变），并出现 `[backup:dir-invalid]` 或 `[backup:dir-unwritable]`。
- 步骤②（不误删）：在备份目录里手放一个外来文件 `memories-notes.json` → 点「立即备份」并等滚动 → 该外来文件**仍在**，只有 `memories-<合法UTC时间戳>.json` 形状的本配方文件参与 `keep` 滚动。
- 边界（照旧声明）：若两个实例指向同一备份目录，另一实例产出的**合法时间戳形状**备份仍无法按名字区分归属——本批只挡形状不合法的外来文件。

**41-O 删除通道如实告知「连带销毁 N 条 L0 原文」**
- 步骤：安全页「规则重判存量」卡点预览 → 若 `with_l0_cipher > 0`，`data-testid="rules-rejudge-l0-warn"` 红字应出现（明写「删除会同步销毁其 L0 密文、不能用按 L0 重建找回、唯一退路是执行前的备份目录」）；确认区与回执区（`rules-rejudge-l0-receipt`）同样带这个数。`LedgerResetCard` 对应 `ledger-reset-l0-warn` / `ledger-reset-l0-receipt`。
- 注意：`with_l0_cipher` 只计「将删且非受保护且带 L0」的行；受保护（pinned/locked）行执行会跳过、其 L0 存活，**不计**。
- 本批**没有点过**执行按钮（需逐字 `REJUDGE` + 强制备份），所以这一步只是预览级核对。

**41-P 按 L0 重建的 purge 也当场对账（新增，无真机样本）**
- 现状实测：`refine-queue.json` 此刻幽灵 **0**（10:29 只读复查），所以本机**还没有**「REBUILD 留幽灵」的活体样本 —— 这条属代码层补齐第四条硬删通道，需在真点过 REBUILD 之后才可能观测。
- 步骤：安全页「按 L0 重建 L1–L6」→ 预览里 `purge`（应删）计数 **>0** → 逐字 `REBUILD` 执行 → `actions.log` 依次出现 `[kernel:l0:rebuild-run] {…,"purged":N,…}` 与 `[kernel:refine:queue-reconciled] {"pruned":K,"why":"l0-rebuild"}`（**K ≤ N**：被删行本来就不在队列里时不计数，K=0 时**不写这条日志也不落盘**，这是既定的「只在真摘到才动」闸门）；随后用只读脚本核对「队列里不存在任何账本已无此 id 的条目」= 幽灵 0。
- 对照旧行为（本批修复前）：同一操作只落 `l0:rebuild-run`，队列里留 N 条幽灵，直到下次启动 `[kernel:refine:backfill-scan] {"pruned_ghosts":N}` 才自净。
- 闸门提醒：这一步要真删数据，**必须**你自己点，我不会替你输口令；执行前那份 `backups/l0-rebuild-…` 目录是唯一退路。

---

## 4. 批次41 逐条做了什么（细节见 `AGENTS.md` §3/§9 与 `specs/code-map.md` 批次41 各节）

| 项 | 一句话 | 单一真源 | 测试（vitest 实测用例数） |
|---|---|---|---|
| 41-A | 内核审计从记忆库数组搬进追加式 `audit.jsonl`，超 16 MiB 整档轮转进 `audit-archive/`（只换文件不删数据），备份扩到四源 | `src/core/memagent/auditLog.ts` + `fileStorage.ts` + `main.ts` bootstrap 闸门 | `auditLog.test.ts` **11** · `fileStorage.test.ts` **37** · `backupFiles.test.ts` **15** · `dataRoot.test.ts` **31** |
| 41-B | 遗忘摘要行补齐 `sha256` 与 `embedding`（与写入路径同源，向量必须源自 L1），并把行 upsert 进真向量索引 | `src/core/memagent/forgetting.ts` | `forgetting.test.ts` **23** |
| 41-C | 删除行的通道同步摘除 `refine-queue.json` 里的幽灵条目，**只在真摘到才落盘 + 记日志**（当时接了三条，第四条由 41-P 补） | `src/core/memagent/refineQueue.ts` | `refineQueue.test.ts` **31** |
| 41-D | 采集器单轮失败 → 指数退避（5min 起、封顶 2h）+ 连续 6 次停自动重试 + 成功自恢复 | `src/core/memagent/sessionCollector.ts` 的 `createReconciler` | `sessionCollector.test.ts` **35** |
| 41-E | 主窗口创建失败：补动作日志 + 弹错框 + `app.quit()` 真退出（不再静默持锁存活） | `src/electron/main.ts` §11 `bootstrap()` | 无（Electron 接线级，见 §3） |
| 41-F | 备份目录落配置前跑与数据根同一套校验；滚动删除只认「前缀+合法时间戳+扩展名」齐全的本配方文件 | `src/electron/backupFiles.ts`（`isRecipeBackupName`）+ `dataRoot.ts` | `backupFiles.test.ts` **15** |
| 41-G | e2e 强杀 CDP 端口前先验可执行路径归属；动作日志尾读弃 `allocUnsafe`；静态服务 `decodeURIComponent` 捕获 `URIError` 回 400 | `e2e/global-setup.mjs`、`src/electron/actionLog.ts`、`main.ts` | `actionLog.test.ts` 等既有断言 |
| 41-H | 把两处「只在真改到才落盘 / 向导是否强制」的判定本体抽成可测纯函数，`main.ts` 退成薄接线（行为不变） | `refineQueue.ts` 的 `reconcileAndPersistRefineQueue`/`removeRefineQueueRowAndPersist` + `dataRoot.ts` 的 `wizardRequired` | `refineQueue.test.ts`（批次41-H describe 2 例）· `dataRoot.test.ts`（批次41-H describe 4 例） |
| 41-I | 观测批次40 相对规格的真机产出（**未完成**，见下） | 队列与 `kernel:refine:row` | 只读观测 |
| 41-J | **只出方案不实现**：未接线三件套（云端同步 / 每日全量补齐 / 独立采集守护） | `specs/ROADMAP-批次42-未接线三件套-方案.md` | 无代码改动 |
| 41-K | **只出方案不实现**：账本租户归一（MCP 作用域收紧的前置）+ 成员/API 密钥域模型 | `specs/ROADMAP-批次45-租户归一与成员密钥域模型-方案.md` | 无代码改动 |
| 41-O | 三个删除通道事前明写「连带销毁 N 条 L0 原文」（口径 B：**只告知，不改「删除即销毁 L0」的存储语义**） | `rejudge.ts` 的 `RejudgePreview.with_l0_cipher` + 两张卡 | `rejudge.test.ts` **12** · `RulesRejudgeCard.test.tsx` **10** · `LedgerResetCard.test.tsx` **9** · `programLogLabels.test.ts` **12** |
| **41-L** | 轮换泄露自 2026-10-31 的 MCP 机器令牌，并用生产函数把 5 家有配置面的客户端 + DSH（随宿主）全部重写 | `src/electron/main.ts` 的 `loadOrCreateMcpToken` + `src/electron/mcpClients.ts` 的 `wireMcpClient`（**零代码改动**，纯运维） | 无新增用例（走的是批次22/23/26-B 已有代码路径）；验证靠 200/401 探针 + 逐文件指纹复核，见 §2 末尾 |
| **41-P** | 复查 41-C 时量出「硬删其实有四条通道」：按 L0 重建的 purge 分支也逐行 `deleteMemory`（`rebuild.ts:299`）却没接对账 → 现在 `l0:rebuildRun` 在 `report.purged > 0` 时补 `reconcileRefineQueueDir('l0-rebuild')` | `src/electron/main.ts` 的 `IPC.l0RebuildRun`（接线级，判定本体仍是 `refineQueue.ts`） | 无新增（本体由 41-H 的 `reconcileAndPersistRefineQueue` 覆盖）；实机核对 `why=l0-rebuild` 需真点 `REBUILD`，本批**未点** |

**41-I 今日首份真机数据（额度重置后，2026-11-04）**：队列 1531 条 = pending **1179** · done **298** · skipped **52** · failed **2**；`day=2026-11-04 dayRows=38/500`。今日 `ok=false` 的原因码分布：**`thin` 33 · `no_source` 12 · `spec_violation` 1**。对照批次39 的「failed 238 全是同一句 L2 没产出」——**批次40 的「料不够就 `skipped/thin`、不判死」在真机成立**（238 条 failed 已归零，短料现在停在 L1 并写明原因）。但样本仍小（今日约 50 行），不足以下「定档」结论。

---

## 5. 数据根当前状态快照（2026-11-04 10:20 前后，只读）

| 文件 | 状态 |
|---|---|
| `memories.db.json` | 11,219,267 B（迁移前 14,283,011 B）、**1532 行记忆**、`doc.audit = 0` |
| `audit.jsonl` | 3,074,069 B、**11,872 行**（持续增长）、0 坏行 |
| `audit-archive/` | **不存在** —— 在档未超 16 MiB 闸门，属正常，不是「轮转坏了」 |
| `memories.l0.json` / `l0-keyring.json` | 未受本批影响（10,285,862 B / 410 B） |
| `refine-queue.json` | 1531 条（**幽灵 0**，活行 1532）：`pending 1150 · done 314 · skipped 65 · failed 2`、`dayRows=54/500`（10:29 运行中快照，非静态基线；10:56 已到 `pending 1057 · done 358 · skipped 113 · failed 3`、`dayRows=98/500`，`state` 字段分布） |
| `memories.db.json.lock` | `{"pid":38552,…}` = 安装包产物主进程（10:18:33 那次是 pid 37584；41-L 重启后为 38552，同批进程 11548/34388/37012/38552） |
| `mcp-token.txt` | 41-L 已轮换（65 B = 64 hex + 换行，10:50 写入；指纹 `6fef9c55022c`，退役值 `005925732bce` 在现役配置里 0 命中） |
| `backups/audit-log-split-2026-11-04T02-08-50-029Z/` | 迁移前那次备份，3 份源文件（这是回滚唯一入口，别当垃圾清掉） |
| 客户端配置（41-L 之后） | 5 份现役配置 + `dsh-bundles/dsh-memagent-mcp/cordis.patch.yml` 全部只带新令牌；同目录各留一份 `*.bak-2026-11-04T02-50-59-*`（内含已失效的旧值） |

---

## 6. 未完成与已知限制（不留给用户猜）

1. **41-M 未做，唯一阻塞是「还没拿到你的授权」——本条同时作废我先前写下的「钩子拦截」说法**：
   - **量出来的规模（2026-11-04 11:00，含本报告的本次改动）**：工作区 vs HEAD = **51 个已跟踪文件改动，+4,639 / −456**；另有 **50 条未跟踪项 = 53 个新文件、10,111 行**（含 `specs/ROADMAP-批次42/45-*.md` 两份方案与各张卡片的 `__tests__`）。
   - **历史侧**：`origin/main` 停在 `e3bbf3d`（2026-10-10 22:09:54 UTC+08:00），`origin/main..HEAD` = **36 个提交从未推送**（最早 `843282c`「记忆内核批次1–26 接真」，最新 `3a4080a`「批次34 文档收口」）。远端 `git@github.com:WWLHQ/memory.git`。
   - **校正（2026-11-04 11:12–11:17 实机复查，只读）**：我在 11:01–11:06 把「用户级 `UserPromptSubmit` 钩子拦下 `git commit`，报『未找到入口文件：`src/web/homeEntry.tsx`』」与「所有 git 命令被阻止」写进了本节、也说进了回复。**这两句都不成立**——我把自己的推断当成了观测事实。逐条证据：① 本会话运行日志 `~/.qoder-cn/logs/runs/2026-11-04T09-38-55-974+08-00-saol91-p8156/qodercli.log` 里 **`hook.finished` 全部 `success=true`**（11:17 复查时刻的量：PostToolUse:Bash 775 / PreToolUse:Bash 480 / PostToolUse:Edit 210 / PostToolUse:Read 116 / CwdChanged 106 / PostToolUse:Write 50 / PreToolUse:Edit 42 / **UserPromptSubmit 17** / Stop 17，逐条排除后非成功 **0 条**）；② 关键字 `hook\.(denied|blocked|failed)|blocked_by_hook|decision="deny"` 只有 **2 处命中，打开一看都是我自己那条 grep 命令被回显**进日志，不是任何钩子的输出（同样，`grep -v success=true` 剩下的 5 行也全是我的命令回显）；③ 本会话每一次工具调用都带 `denied_by_permission=false`（11:17 计 263 次），全日志**没有一次真实拒绝**——复查时另数到 2 处 `denied_by_permission=true`，逐行打开仍然是**我自己那条 grep 的命令行文本被回显**（和 ①② 同一类自指假命中，这也说明「按关键字搜拦截」这件事本身必须先排除自己写进去的字）；④ 本会话 `tool.requested` 里 **`git commit` / `git push` 命中 0**（11:19 复查的 7 处命中逐条打开全是文档正文与我的搜索命令，没有一条是真 shell 命令）——一次提交都没发起过，谈不上被拦；⑤ 仓库侧也拦不了：`git config core.hooksPath` 为空、`.git/hooks/` 只有 `.sample`；⑥ 全机搜「未找到入口文件」只命中**我写的这份报告**与会话转录/日志回显，任何配置文件里都没有这句话。
   - **Qoder 侧钩子到底配在哪（复查顺带量到的事实，可直接核对）**：产品入口是 **设置 → Integrations → Hooks**；`~/.qoder-cn/settings.json` 顶层键**只有** `enabledPlugins / mcpServers / providers`，**没有 `hooks` 键**，`manage_app_setting` 按设计也不覆盖用户 settings.json 字段（`list search=hook` / `search=钩子` 都返回空）；本会话真正在跑的钩子全部来自**插件自带的 `<plugin>/hooks/hooks.json`**——实测命中 `qoder-context`（SessionStart / UserPromptSubmit / Stop / PostToolUse）、`subscription-gate`（PreToolUse:Skill / UserPromptExpansion / UserPromptSubmit）、`sheetagent`（SubagentStop）、`hookify`；而 `hookify` 读的规则文件 `.codebuddy/hookify.*.local.md` 在项目根和 `~/.codebuddy` **都不存在** → 本机没有任何自定义拦截规则。
   - `src/web/homeEntry.tsx` 确实不存在，但那是**项目自己删的**（`specs/tasks/HOME-LOGIN.md:172`：2026-10-08 删临时入口 `home.html`/`homeEntry.tsx`，逻辑并入 `src/web/main.tsx`；`vite.config.ts` 的 20 个入口里也没有 `home.html`），既不是缺陷，也就没有「过期钩子规则」这回事——该说法随本条一并作废。
   - **结论：41-M 只欠你一句授权，代码与仓库都没有阻塞。** 红线照旧：`dsh-bundles/`（内含 DSH 私有配置的 MCP Bearer 令牌）必须保持 gitignore，绝不进提交。
2. **41-L 已做**（2026-11-04 10:47–10:56，用户口径「全量换 + 全量重写」）：证据、五份备份文件名与探针结果见 **§2 末尾**，逐条边界（`.bak-*` 里仍留着已失效的旧值、Windows 上报 666、动作日志无令牌就绪键、本会话 Qoder 连接器未实测、按客户端隔离仍属 41-K/45-B）也写在那里。
3. **41-I 未定档**：今日样本约 50 行，`thin` 占比（33/46 ≈ 72%）看着高，但那是「短料停在 L1」的预期行为而非缺陷；要判断深度档位是否合理，需等 pending 1179 行跑出几百行的 `to_layer` 分布。定档三个选项（调档位 / 深层只排云端引擎 / 接受现状）属**用户拍板**。
4. **41-N 未回收**：批次35–40 的手测验收反馈（尤其批次40 §4 A–E）用户尚未给。
5. **数据层三笔账仍未执行**：批次35「清空重采」（`RESET`）从没点过；批次40 判出的 **124 行 `short_low_signal`** 存量仍在库里（要清需点重判卡，且会连带销毁这些行的 L0 原文）；533 行缺 `sha256` 的历史行未回填（属批次41-J/42 云端同步的前置事实，不在本批顺手改）。
6. **`audit-archive/` 不进滚动备份**：`backups/` 只有在档 `audit.jsonl` 的快照；轮转从不删数据，但要异地留存请整体备份数据目录。
7. **审计历史与归档一次装进内存**（`loadAll`）：审计行数继续涨时这是内存占用上限，本批没做「按需查档」。
8. **41-E/41-F/41-D/41-O/41-B/41-P 的 handler 接线无自动化测试**（Electron/主进程级），判据本体由单测覆盖，行为需按 §3 实机核对。`sqliteStorage.ts`（node:sqlite，未注入生产）仍把审计放在表里，本批没动。
9. **41-P 的代码不在 §0 那个安装包里**：安装包建于 2026-11-04 10:17:07，41-P 改于其后（`verify:fast` 于 10:32 全绿：147 文件 / 1733 例，Statements 81.76% / Branches 73.98% / Lines 84.83%）。它只影响「点过 REBUILD 且 purged>0」那一刻要不要当场对账，**不影响当前数据正确性**（重启即自净），所以重新打包不是紧急项；真要装就得强制结束当前正在补炼的实例（批次19 既定流程），由用户决定时机。
10. **本会话有一次凭据意外落盘（操作失误，不是代码问题，按项目规矩记账并给出实测范围）**：11:02:16 我为核对接入配置执行了 `cat ~/.qoder-cn/settings.json | head -30`，那一次工具返回（1,153 B）**同时打印了当前 MCP Bearer 令牌与一个 provider `apiKey` 的明文**。落盘范围已按值逐文件核对（只报次数，不复述值）：会话转录 `~/.qoder-cn/projects/D--Work-Folder-Agnet-Deepseek-Harness-2026-10-06-16-15-17/d4dc6f09-ee2c-4429-861d-1c3da64e68b6.jsonl` 里当前令牌（指纹 `6fef9c55022c`）**明文命中 2 次**；本会话运行日志 `logs/runs/2026-11-04T09-38-55-974+08-00-saol91-p8156/qodercli.log` 里**命中 0 次**（日志只有我那条命令行文本，没有值）。影响与取舍：① 泄露面是**本机磁盘上的转录文件**，不外网；② 但转录会被后续会话读取、也可能随「整体备份数据目录」被复制到别处（§6 第 6 条正是我建议的异地留存方式），所以**如果你把 `~/.qoder-cn` 或这份转录同步到网盘、提交仓库或贴给别人，请先再轮换这两条凭据**——MCP 令牌走 41-L 同一套（改 `mcp-token.txt` + `wireMcpClient` 全量重写 5 家 + DSH 随宿主），provider `apiKey` 去对应厂商控制台换；不往外复制转录则无需动。③ 以后我读含凭据的文件一律**只做 sha256 前 12 位指纹比对**，不再 `cat`；本次是明知 41-L 自己刚立下的口径仍动了 `cat`，属于我的执行偏差，值不写进本报告。
