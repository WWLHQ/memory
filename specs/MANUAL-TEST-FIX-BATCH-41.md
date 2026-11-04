# 批次41 手动测试报告 · 审计搬出记忆库 + 队列卫生 + 退避/退出/备份校验 + 删除如实告知（收口与首次真机执行）

日期（UTC+08:00）：2026-11-04
分支：`main`（批次 35–41 已按问题点分 11 笔提交，`origin/main` 停在 `3c23bfe`；其后 5 笔未推送：`1652bd8` 41-R、`5845937` 41-S 立案、`bb63b5a` 需求规格书 §19.25、`948bcf5` 41-T 存量字段回填通道、`35755be` 41-T 文档收口。**HEAD 与 ahead 数随每笔提交漂移，本节不再硬编码，核对用 `git log --oneline -1` 与 `git status -sb`**；`git push` 需用户另行授权）
上一批次：批次40（`specs/MANUAL-TEST-FIX-BATCH-40.md`）
起因（用户原话）：「审计搬出记忆库」→「跑」（授权走完 41-Z：`verify` → `package` → 本报告）→ 追加「队列幽灵对账」（复查 41-C，产出 **41-P**）→ 追加「轮换 DSH MCP Bearer 令牌」（**41-L 已真机执行**，用户口径「全量换 + 全量重写」）

---

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,048,686 字节 = **116.39 MB** |
| SHA256 | `d0f31b70a702236cfb16cc10f9ccf7a050270e23f075c50ce85ff309a4c5cadf` |
| 落盘完成（UTC+08:00） | 2026-11-04 **12:11:56**（本批 41-R 收口重打包；此表原写的是 10:17:07 那一版 `E5160D30…45A30634` / 122,048,550 B，**已被取代**——那一版里没有 41-P 的 `l0-rebuild` 对账，也没有 41-R 的双写） |
| 出厂核对（不是「源码写了」，是「包里有没有」） | 只读比对 `app.asar.unpacked/dist-electron/main.cjs`（581,094 B）：`void mlog("mcp:recall_detail_view", { outcome });` 与 `actionLog("mcp", "recall_detail_view", { outcome });` **两行都在**、`reconcileRefineQueueDir("l0-rebuild")` **命中**、渲染层 `app.asar` 内 `召回明细页` **命中** |
| 在跑的产物 | 12:14 用 `release/installer/win-unpacked/MultiAgent Memory.exe` 起回，写锁 `{"pid":3880,…}`；8204 可用（真发一次召回得 200） |
| `npm run verify` | **退出码 0**。最近一次是 **41-T 收口轮（2026-11-04 12:52–12:55 UTC+08:00）**，一整条链跑完未分段（typecheck → oxlint → 索引新鲜度 → 覆盖率 → `build:electron` → E2E）；上一轮为 41-R 收口（12:0x） |
| `npm run typecheck` | 干净（`tsc --noEmit` + `tsc --noEmit -p tsconfig.electron.json`） |
| `npm run lint` | oxlint **0 warnings / 0 errors** |
| `npm run code:index:check` | 代码索引已是最新（**308 个文件**；41-T 新增 `fieldBackfill.ts` + `FieldBackfillCard.tsx` 两个文件，从 306 涨上来） |
| 单测 | vitest **149 文件 / 1754 例全过**（41-T 本批 **+2 文件 / +19 例**：`fieldBackfill.test.ts` 11 例 + `FieldBackfillCard.test.tsx` 8 例；此前 41-R +2 例） |
| `npm run test:coverage` | Statements **81.89%**（11338/13844）/ Branches **74.18%**（8200/11054）/ Functions 77.98% / Lines **84.93%**（9841/11587）——41-T 轮 |
| `npm run test:e2e` | Playwright **106 passed**（41-T 轮 48.7s） |
| **41-T 没有重新打包** | 安装包仍是 **12:11:56 那一版**（`d0f31b70…4c5cadf`），**里面没有 41-T**：`FieldBackfillCard` 与 `ledger:fields*` 两条 IPC 只存在于源码与 `dist/`（`npm run verify` 的 `build:electron` 产物），现役 `app.asar.unpacked/dist-electron/main.cjs` 里 `grep ledger:fieldsBackfill` **命中 0**。原因不是忘了，是打包按批次19 流程会先结束正在补炼的实例（当前写锁 `{"pid":3880}`），**要不要现在重启由用户决定**（与 §6 第 12 条同一件事的另一面：41-P/41-R 已在包里，41-T 不在） |
| 打包过程 | **共两次**。第一次（10:17，41-Z 收口）：一次 EPERM 回退按批次21 既定路径走完——`release/installer` 被外部进程占用 → 先输出到 `release\installer-20261104-021635` → 构建成功后删旧目录并**收口回 `release/installer`**（`旧安装包目录清理 1 个`）。同时按流程删除便携产物 `release\win-unpacked` → `release/` 下只有 `installer` 一个目录。**第二次（12:11，41-R 收口）**：同一回退再次触发（`[package] release/installer 被外部进程占用（EPERM），本次输出改到 release\installer-20261104-041129`），构建成功后照样收口回 `release/installer`（`旧安装包目录清理 0 个`）。**旧实例退出的证据不在打包日志里**：`killReleaseProcesses()`（批次27 的「先礼后兵」：`CloseMainWindow()` → 3 秒 → `Stop-Process -Force`）的 `Write-Output` 落在 PowerShell stdout，而 `package-builder.cjs` 只用它判断要不要多睡 800ms、**不转发成 `[package]` 行**，所以日志里一条关闭记录都没有——只能从别处证：`actions.log` 的 `[app:bootstrap:start]` 在 `02:51:48`（10:51，41-L 重启）与 `04:14:14`（12:14，本批新产物）之间**没有任何一次新启动**，且 12:14 新进程能拿到写锁（`{"pid":3880}`）、当前 `tasklist` 只有这一套 4 个进程 = 旧实例确实已退。**这条观测缺口本批没修**（属打包脚本自身的人话输出，与 41-R 同类但不在本批范围）。这一版产物才同时含 41-P 与 41-R。 |
| 未做 | **41-R 没做任何账本改写**（只加一条观测的双写）；**41-T 建的是通道，没有替用户点执行**——那 **533 行缺 `sha256` + 1 行缺 `embedding` 此刻仍是空的**，卡片就位 ≠ 存量已回填；也**没有点过**安全页任何需口令按钮（`SPLIT` / `RESET` / `REJUDGE` / `REBUILD`）——用户机上那两轮 `REJUDGE` 是用户自己点的（124 行已于 2026-11-03 14:43 清除，见 §6 与批次36/40 报告的校正）。提交状态：批次 35–41 已在 `3c23bfe` 及其前 5 笔进入 `origin/main`；**41-R `1652bd8`、41-S 立案文档 `5845937`、需求规格书 §19.25 `bb63b5a`、41-T 存量字段回填通道 `948bcf5` 四笔已提交并已推送与否见 §0 表头**（表头列出全部未推送笔次；本行写就时那笔「41-T 文档收口」还不存在，所以不在此列——**以 `git status -sb` 为准，不要拿本节当权威**）。**41-T 未进安装包**（见上一行），所以用户机上现在还**点不到**那张卡。**41-L 已做**（令牌轮换见 §2 末尾，属运维动作、零代码改动、没碰账本） |

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

边界（不留给用户猜）：① **退役值仍在上面 5 份 `.bak-*` 里**——备份原文件是 `wireMcpClient` 的既定行为，批次26-B P2-15 只保留最新 3 份。它已**不能访问任何东西**（服务端只认新值），要把备份也清干净得手工删，本批没有替你删；② `mcp-token.txt` 请求 0600，但 Windows 上 `fs.statSync().mode` 报 **666**——应用首次写入时也是这个值（真实权限由 NTFS ACL 决定，不看 POSIX 位），属既有表现、不是本次回归；③ 令牌就绪只写 `main.log` 的 `mlog`，**动作日志无对应键**（与 41-B 的 `forgetting:cycle` 同一类观测缺口）；④ ~~**本会话的 Qoder 侧连接器没实测**：「重载 Qoder 后召回走新令牌」是推断，需你重载 Qoder 后按 §1.1 的召回审计核对~~ **〔已于 2026-11-04 12:21 闭合，本条作废〕**：原先两条证据都在——`~/.qoder-cn/settings.json` 里那条 `Authorization` 已按**指纹**核对 = 与新令牌一致（重写生效），而重载后 Qoder 侧 `recall_memory` 也真跑通了（HTTP 200 + 命中 2 条 + 明细链接可点开 200）= 新令牌在 Qoder 侧确认可用。**但那条审计的 `client` 被写成了 `verify-41r/0.0.1`（我 12:14 探测脚本的自报名），不是 `qoder-desktop-mcp-host`** —— 由此立案 **41-S：调用方身份可跨客户端串号**（判据、实测与三个修法候选见本报告 §6 第 11 条）；⑤ 单令牌仍是**机器级凭据**（拿到即全库 + §1.1 召回），按客户端隔离属 41-K/45-B。

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

**41-T 存量补齐缺失的 `sha256` / `embedding`（新增；判据本体有单测，IPC/备份/索引注入是接线级 —— 本批**未点执行**）**
- 现状实测（2026-11-04 12:40，只读真实账本）：1532 活行里 **533 行缺 `sha256`**（全 `layer=L1`、`refined_by=stub`、创建时刻集中在 2026-10-30 UTC）、**1 行缺 `embedding`**（那行是 pinned 的 `params_01M6AGZS9K4CTQM23HV64MYF1E`）。成因：`sha256` 随提交 `843282c`（2026-10-31 17:55）才进 `coreWrite`，那之前写入的行行上就是空的。
- 步骤①（预览，只读）：安全页「存量补齐缺失的指纹与向量」卡（管理员登录）→ `data-testid="fields-backfill-preview-report"` 应显示「缺 sha256 533 条 · 缺 embedding 1 条 · 本轮会写盘 N 条」，且 `fields-backfill-sample` 里**只有字段名与层名，一个正文都不上屏**。
- 步骤②（执行）：点 `data-testid="fields-backfill-run"`（**本通道没有逐字口令**，因为它不删行、不改正文、不动 `layer`/`version`/`updated_at`/L0）→ `actions.log` 依次出现 `[kernel:ledger:fields-backup] {"dir":"…field-backfill-…","copied":[…]}` 与 `[kernel:ledger:fields-backfill] {"total":…,"sha256_filled":533,"embedding_filled":1,"indexed":1,"protected_rows":1,…}`。
- 步骤③（核对补得对不对，三条都要过）：
  - 同源公式：任取一行被补的 `sum_`/历史行，`sha256` 应**恰等于** `sha256hex(该行 content)`、`embedding` 应**恰等于** `embedSync(该行 content_l1, 64)`——不是别的层、不是随机值。
  - 元数据没被顺手改：`version`、`updated_at`、`layer`、`content`、`content_l1`、`quality_gate_v` 与执行前逐字相同（执行前先把这几列快照下来对比）。
  - 召回真的回来了：那 1 行缺向量的行，执行前用它的 L1 原文做语义检索召不回（恒 0 分），执行后应能命中。
- 步骤④（幂等）：再点一次「重新预览」→「本轮会写盘」**必须为 0**、执行按钮消失（`fields-backfill-clean` 出现）；`actions.log` 里 `memory_op/op=field_backfill` 的行数不再增长。
- 步骤⑤（备份闸门）：把备份目录配成不可写路径后再点执行 → 应**如实报错且一行不写**，并出现 `[kernel:ledger:fields-backup-fail]`（error 级）。
- 边界（照旧声明）：① **本批我没有点执行**，那 533+1 行此刻仍是空的——卡片就位 ≠ 存量已回填；而且**这张卡目前在用户机上也还点不到**：41-T 没有重新打包（§0 倒数第二行 + §6 第 12 条），现役安装包 `main.cjs` 里 `ledger:fieldsBackfill` 命中 0，要打这一步得先结束正在补炼的 pid 3880；② 缺 `content` 或缺 `content_l1` 的行**不猜**，只计进 `unfillable_*` 并原样留着（两个字段都缺且都算不出的行在两项里各计一次，所以相加是「项」不是「行」）；③ `indexed` 只统计「本行**新**建了向量且注入了索引」的行，`main.ts` 注入的是 `collectorVector`（与采集器/补炼/重建同一实例），没注入时恒 0，不假装建过索引；④ 审计只记字段名与长度，**正文与算出的指纹都不落账本**。

**41-R 明细页查看事件双写进 `actions.log`（新增；回调本体有单测，`main.ts` 那两行是接线级 → 已真机执行）**
- 现状实测（发现方式）：2026-11-04 11:51 真点了一次明细页 → `main.log` 有 `mcp:recall_detail_view` **3 条**、`actions.log` **0 条**，所以日志记录页（读 `actions.log`）看不到「明细页被点开过」这件事。
- **真机已验证（2026-11-04 12:14，本批新产物 `release/installer/win-unpacked`，写锁 `{"pid":3880}`）**：向 8204 发一次真 `recall_memory`（客户端自报 `verify-41r`）→ `display.mode = markdown-compact` 且带 `detail_url` → 点开该链接得 **200 / 5,548 B**（页面全文里检索当前令牌命中 **0**，`leakToken=false`）→ 再把 URL 里 22 位 id 换成同长度的假 id 访问 → **404**。随后核对落盘：
  - `actions.log` **2 条**：`[…T04:14:49.580Z] [info] [mcp:recall_detail_view] {"outcome":"ok"}` 与 `…581Z] … {"outcome":"miss"}`（= 北京时间 12:14:49，此前该键在 `actions.log` 里是 **0 条**）。
  - `main.log` 同键 **5 条**（旧 3 条 + 本次 2 条）= 双写两条路径都在写，不是搬走。
  - 没验的只剩**渲染层观感**：日志记录页人话视图里「打开召回明细页（一次性链接） · outcome=ok」这一行的实际显示（`programLogLabels.test.ts` 断言了键与人话标题、`{outcome,id,html}` 只输出 `outcome=ok`，但页面截图需要你目视确认）。
- 断言的边界：值**只有** `ok`/`miss` 两个字面量——一次性 id、页面正文、令牌都不经回调出口（`mcpHttp.test.ts` 批次41-R 例锁的就是这个序列）；本条只修观测，票据 30 分钟 TTL / 纯内存 / 不消费的口径没动。
- 同批量到的 **41-Q 本批未修**：`clientSupportsHtmlDetails` 白名单判据是首段**精确等于 `qoder`**，本机 Qoder Desktop 自报 `qoder-desktop-mcp-host/1.0.0` → recall 审计 **0 命中**（11:51 实测 100 条、12:15 复测 102 条，其中 2 条是本会话为验证 41-L/41-R 自己发的），`html-details` 档从未生效。要不要把该机自报名加进白名单，取决于「Qoder 聊天气泡是否真渲染 `<details>`」——这条**还没有证据**，盲改会把失效 HTML 铺回气泡，所以留给你拍板（见 §6 第 2 条）。

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
| **41-R** | 闭合 41-L 时真点了一次明细页，量出 `mcp:recall_detail_view` 只在 `main.log`（3 条）、`actions.log` **0 条** → 日志页看不见。现改 `mlog` + `actionLog` 双写（批次34 对 `llm:*` 的同款口径），值只有 `ok`/`miss` | `src/electron/main.ts` 的 `runMcpHttpServer({onViewDetail})` + `src/web/Home/programLogLabels.ts` | `mcpHttp.test.ts`（批次41-R describe 1 例：`['ok','miss']` 序列 + 值域只有这两个字面量）· `programLogLabels.test.ts` +2 断言（新键有人话、`{outcome,id,html}` 只输出 `outcome=ok`）；`main.ts` 那两行属接线级、**已真机验掉**（12:14 真点：`actions.log` 该键 0 条 → 2 条，`ok` + `miss`）；只剩日志记录页**人话视图那一行的实际渲染**待用户目视，核对过程见 §3 |
| **41-T** | 给批次41-B 记账的那笔存量（**533 行缺 `sha256` + 1 行缺 `embedding`**）一条**只填空字段**的回填通道：`sha256 = sha256hex(content)`、`embedding = embedSync(content_l1)`（与写入 / 补炼 / 重建三条管道同源，**不从别的层凑**），算不出的行原样留着并如实计 `unfillable_*`；不删行、不改正文、不动 `version`/`layer`/质量门戳/L0 → **不设逐字口令**（与 `REJUDGE`/`RESET`/`REBUILD` 不同类），但「备份失败就拒绝改写」照守；幂等（二次预览「本轮会写盘」= 0） | `src/core/memagent/fieldBackfill.ts` + `main.ts` 的 `ledger:fieldsPreview`/`ledger:fieldsBackfill` + `preload.ts` `ledgerFields` + `hostBridge.ts` + `src/web/security/FieldBackfillCard.tsx` + `programLogLabels.ts` | `fieldBackfill.test.ts` **11**（预览计数含「缺但补不了」/ 同源相等 / 只动元数据不动 `version`·`updated_at`·`layer` / 向量注入 vs `indexed:0` / pinned·locked / 填不出不猜 / 无管理员与无备份都拒绝 / 幂等 / 正文与算出的指纹都不落审计）· `FieldBackfillCard.test.tsx` **8**（浏览器不可用 / 非管理员不起预览 / 预览真值 / 样本不上正文 / 执行回执 / 无可补行不给点 / 主进程拒绝原样显示 / IPC 抛错）；**两个 IPC handler 与备份/索引注入属接线级，本批未点执行**，步骤见 §3 |

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
2. **41-L 已做，且已于 2026-11-04 11:50 真机闭合**（轮换本身 10:47–10:56，用户口径「全量换 + 全量重写」）：证据、五份备份文件名与探针结果见 **§2 末尾**，逐条边界（`.bak-*` 里仍留着已失效的旧值、Windows 上报 666、动作日志无令牌就绪键、按客户端隔离仍属 41-K/45-B）也写在那里。
   - **闭合证据（2026-11-04 11:50:18–11:51:17，UTC+08:00）**：本会话经 Qoder 连接器真调了一次 `recall_memory`，内核审计新增 `action=recall`，`detail.client = qoder-desktop-mcp-host/1.0.0`、`request_id = req_01M6JAVN7E0H2B443GXJZAMQ59`、命中 5 条、`scanned_memories=1531`；返回值里 `rollup.today_calls=1` 与「审计里轮换（10:56）之后 recall 行数 = 1」两条独立口径一致——**新令牌在真客户端上端到端可用**，此前 §6.2 的「本会话 Qoder 连接器未实测」作废。顺带把一次性明细页也验了：`GET /recall/<id>` 返回 **200 / 4,928 B / 4 个 `<details>`**，`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、CSP `default-src 'none'`，页面正文**不含当前令牌**（按值比对，非按形状）。
   - **本次闭合顺剂量出两个新缺陷（① 已立案为 41-Q 未修；② 已随 41-R 修掉）**：① **三档分发的第一档在该用户机上从未生效**——`clientSupportsHtmlDetails` 的判据是 `client.split('/')[0]` **精确等于 `qoder`**（`src/core/memagent/mcpRecall.ts:22-26`），而现役 `audit.jsonl` 的 **100 条 recall 行里命中白名单 0 条**，Qoder Desktop 实际自报 `qoder-desktop-mcp-host/1.0.0` → 得到的是 `display.mode = markdown-compact`。所以 AGENTS §1.1 与 §9 批次29 写的「当前 `qoder/*` 得 `<details>` 折叠版」**两头都不成立**（既不是前缀匹配，也没有一个 Qoder 命中）。② **`mcp:recall_detail_view` 只进 `main.log`，不进 `actions.log`**（`main.ts:2552` 用的是 `mlog`，不是 `actionLog`）——`main.log` 实测 3 条命中（最近 `2026-11-04 11:51:17`），而 `actions.log` 全量 **0 条**，所以 AGENTS §3/§9 批次33-C 的「落 `mcp:recall_detail_view` 动作日志」不准，日志页看不到明细页是否被点开过。这与 §2 末尾「动作日志无令牌就绪键」、批次41-B 的 `forgetting:cycle` 是同一类观测缺口。**② 已随本批 41-R 修掉并于 12:14 真机验证**（`mlog` + `actionLog('mcp','recall_detail_view',{outcome})` 双写；`actions.log` 该键由 0 条 → 2 条 `ok`/`miss`，见 §3 与 §4 表末行）；① 仍是待你拍板的 **41-Q**，本批没动白名单判据。
3. **41-I 观测数据已足量，待用户定档**（2026-11-04 11:43 实测，判据用生产函数 `depthCapFor` + `meaningfulLength`，不是重算）：全库 1532 活行按深度上限分布 `cap L1 298 · L2 493 · L3 461 · L4 154 · L5 126`；**11-04（批次40-C 规则下）done 220 行 = 高于 cap 0 行（闸门确实守住了）· 恰好=cap 139 · 低于 cap 81 行（37%）**，81 行**全部**是 `refined_by=llm_partial` 且**都带 `stop_code`**（`too_short 68 · bad_json 9 · too_long 4`，没有一行是「停下来说不清为什么」）；对照 11-03（批次39 绝对规格）done 262 行 = 高于新 cap 70 行、0 行走 L6 通道 → 40-C 的行为改动是真发生了。**但 L4/L5 实际产出近乎为零**：全库带 L4 正文 1 行、带 L5 正文 0 行，而 cap 够 L4/L5 的 280 行里已 done 的 93 行全停在 L3 以下。旧文本「今日样本约 50 行 / `thin` 占比 33/46 ≈ 72%」是批次40 当天的快照，已被本条取代。**定档三个选项（调档位 / 深层只排云端引擎 / 接受 L3 封顶 + L6 索引）仍属用户拍板**，我没有替用户改任何档位常量。
4. **41-N 未回收**：批次35–40 的手测验收反馈（尤其批次40 §4 A–E）用户尚未给。
5. **数据层账目（2026-11-04 11:42 复核，其中一条是本报告的错）**：批次35「清空重采」（`RESET`）**从没点过**（`audit.jsonl` 里 0 条 `op=ledger_purge`），SPLIT / REBUILD 同样从未执行（无对应 `op`）。~~批次40 判出的 124 行 `short_low_signal` 存量仍在库里~~ **此句先前是错的，现已按证据改正**：审计 `2026-11-03 14:43:03` 有 `security_change / op=rules_rejudge`，`gate_version=3 · total=1585 · purge=124 · purged=124 · restamped=1461 · by_code={short_low_signal:124} · by_layer={L1:124}`，且执行前落了备份目录 `backups/rules-rejudge-2026-11-03T06-43-03-474Z`；`2026-11-04 11:42` 的 `npm run rejudge --json` 只读回放 1532 行得 **would_block 0 / deletable 0 / passed 1532**（两轮重判合计 `rejudge_purge` 审计 181 条 = 11-02 的 57 + 11-03 的 124，逐条对得上）。533 行缺 `sha256`、1 行缺 `embedding` 仍未回填（~~不在本批顺手改~~ **〔2026-11-04 12:40 更新〕本批已给出回填通道（41-T：纯函数 + `ledger:fields*` IPC + 安全页卡 + 强制备份），但我没有替用户点执行**——12:40 只读复测仍是 533/1，两者都是「通道就位、存量未动」。它同时是批次42 云端同步（`sync` 对账会把缺 `sha256` 的行列进 `missing`）的前置事实，步骤见 §3「41-T」。
6. **`audit-archive/` 不进滚动备份**：`backups/` 只有在档 `audit.jsonl` 的快照；轮转从不删数据，但要异地留存请整体备份数据目录。
7. **审计历史与归档一次装进内存**（`loadAll`）：审计行数继续涨时这是内存占用上限，本批没做「按需查档」。
8. **41-E/41-F/41-D/41-O/41-B/41-P/41-T 的 handler 接线无自动化测试**（Electron/主进程级），判据本体由单测覆盖，行为需按 §3 实机核对。41-T 那两个 handler（预览/执行）尤其如此——备份闸门、`collectorVector` 注入、逐行 `putMemory` 都只在真点下去那一刻才第一次真跑。`sqliteStorage.ts`（node:sqlite，未注入生产）仍把审计放在表里，本批没动。
9. **41-P / 41-R 现已出厂**（原先这条写的是「41-P 不在 §0 那个包里」）：10:17:07 那版包（`E5160D30…`）确实没有 41-P 与 41-R，**12:11:56 重打包后两者都在**——只读比对 `app.asar.unpacked/dist-electron/main.cjs`：`reconcileRefineQueueDir("l0-rebuild")` 命中、`recall_detail_view` 双写两行命中。代价如实记一句：打包按批次19 流程结束了当时正在补炼的实例（`actions.log` 的 `[app:bootstrap:start]` 在 `02:51:48` 与 `04:14:14` 之间无新行 = 旧实例确已退；12:14 由我起回新产物，写锁 `{"pid":3880}`），**这条重启也意味着 41-P 的「下次启动全量对账自净」这条兜底路径在本机又被走了一次**（`refine:backfill-scan` 见 §5 口径）。仍未点过任何需口令按钮，所以 `why=l0-rebuild` 的真机样本还是**没有**。
10. **本会话有一次凭据意外落盘（操作失误，不是代码问题，按项目规矩记账并给出实测范围）**：11:02:16 我为核对接入配置执行了 `cat ~/.qoder-cn/settings.json | head -30`，那一次工具返回（1,153 B）**同时打印了当前 MCP Bearer 令牌与一个 provider `apiKey` 的明文**。落盘范围已按值逐文件核对（只报次数，不复述值）：会话转录 `~/.qoder-cn/projects/D--Work-Folder-Agnet-Deepseek-Harness-2026-10-06-16-15-17/d4dc6f09-ee2c-4429-861d-1c3da64e68b6.jsonl` 里当前令牌（指纹 `6fef9c55022c`）**明文命中 2 次**；本会话运行日志 `logs/runs/2026-11-04T09-38-55-974+08-00-saol91-p8156/qodercli.log` 里**命中 0 次**（日志只有我那条命令行文本，没有值）。影响与取舍：① 泄露面是**本机磁盘上的转录文件**，不外网；② 但转录会被后续会话读取、也可能随「整体备份数据目录」被复制到别处（§6 第 6 条正是我建议的异地留存方式），所以**如果你把 `~/.qoder-cn` 或这份转录同步到网盘、提交仓库或贴给别人，请先再轮换这两条凭据**——MCP 令牌走 41-L 同一套（改 `mcp-token.txt` + `wireMcpClient` 全量重写 5 家 + DSH 随宿主），provider `apiKey` 去对应厂商控制台换；不往外复制转录则无需动。③ 以后我读含凭据的文件一律**只做 sha256 前 12 位指纹比对**，不再 `cat`；本次是明知 41-L 自己刚立下的口径仍动了 `cat`，属于我的执行偏差，值不写进本报告。

11. **41-S 新立案（本批只测量、没有修）：8204 的「调用方身份」可以跨客户端串号——我为验 41-R 发的探测，把自己冒充到了真客户端头上。**
    - **机制**（读代码得到的结构，实测只坐实了下面「能确证的两步」）：`src/core/memagent/mcpHttp.ts:124-126` 有两张表——`clientBySession`（`initialize` 时生成的 sid → 自报名）与 `clientByUa`（**UA → 最近一次 `initialize` 的自报名**）；取值顺序在 `mcpHttp.ts:343-345` = `会话头 → 同 UA 最近一次 initialize → UA 识别`。**凡是「做过 initialize 但后续请求不回传 `Mcp-Session-Id`」的客户端，都共用同一条 UA 记录**，而 `remember()` 是 delete+set，**最后一次 initialize 赢**。
    - **实测**（两次真调用，只读 `audit.jsonl`）：12:14:49 我用 Node 脚本 `initialize(clientInfo.name=verify-41r)` + `tools/call`（不带会话头）→ 审计 `client=verify-41r/0.0.1`；12:21:21 **Qoder Desktop 的 `multiagent_memory` 连接器真调了一次**（命中 2 条）→ 审计里**也被记成 `client=verify-41r/0.0.1`**。**最解释得通的根因是 UA 撞车**：本机一次性回显服务实测 **Node 的 `fetch` 默认就发 `User-Agent: node`**（返回 `{"ua":"node","session":null}`），而 Electron 主进程本身就是 Node → 两个不同客户端在同一条 `clientByUa['node']` 上互相覆盖。
    - **能确证的只有两步**：12:14:49 我的探测**自己没带会话头**（脚本里就没写），所以走 UA 兜底；12:21:21 那次 Qoder 调用**没有命中它自己的会话记录**——要么它没带 `Mcp-Session-Id`，要么它带的 sid 不在当前进程这张表里。**「Qoder 连接器究竟带不带会话头」在服务端侧无法证明**（这一层不落原始请求头日志，我也没为它加临时探针），所以那句「根因是 UA 撞车」是按现有两张表的取值顺序**推**出来的最解释得通的一条，不是我看到的。修与不修都按这条边界说，别写成观测。
    - **同一次测量也闭合了 41-L 的边界④**：那笔「Qoder 侧连接器没有实测证据、『重载后自动用上新令牌』只是推断」现在有反证——重载后 `recall_memory` 真跑通（200 + 命中 2 条 + `display.detail_url` 可用），**新令牌在 Qoder 侧确认可用**；但代价是这条审计行的身份是我的探测名，所以「每条 recall 的 `detail.client` 都可证」这个默认假设**不成立**。
    - **影响面不止是日志难看**：① `clientSupportsHtmlDetails` 按这个自报名选展示档位 → 甲客户端可能吃到乙客户端的档位（本机这次两边都不是 `qoder`，侥幸没改变结果）；② **批次30 的「以审计为接入证据」会升级错的那一家**——`applyRecallEvidence`（`src/electron/mcpClients.ts`）正是按 `client.split('/')[0]` 匹配 `spec.id`/`auditClientIds`，把 `no_config/missing_entry/missing_auth` 升成「审计检测到真实调用 N 次 = 已接入」，串号等于**把 A 的调用算成 B 的接入证据**，与 §7.4「绝不伪造已接入」直接冲突；③ 41-Q 那条「recall 审计 0 命中」的计数里，**部分行的真实调用方不可证**（上面写的 100/102 都按字面 `detail.client` 统计，含被串号的行）。
    - **为什么没顺手修**：要拍口径，不是机械修复。三个候选——**(A)** UA 兜底只认「有辨识度的 UA」，`node`/`curl/*`/`Python-urllib/*` 这类通用串一律判 `unknown`（fail-safe：走纯 Markdown 档，且**不**作为接入证据）；**(B)** 直接取消 `clientByUa`，只认客户端回传的 `Mcp-Session-Id`（最干净，但今天靠 UA 兜底才认得出的客户端会一起降为 `unknown`，批次30 的 Zcode/DSH 那类升级会失效）；**(C)** 不改判据，改为把「`detail.client` 只作观测、不作接入证据」写进批次30 与 §1.1（等于承认身份不可证，UI 与文档口径都要动）。**等你选，我按选的那条做，并补 `mcpHttp.test.ts` 的串号用例（现在 0 条覆盖）。**

12. **「重新打包让 41-P 进安装包」这条请求的前提已过期（2026-11-04 12:35 只读复核，所以我没有再打一次包）**：现役 `release/installer/`（12:11:56 那一版，`d0f31b70…` / 122,048,686 B）**已经含 41-P**——只读比对 `app.asar.unpacked/dist-electron/main.cjs`：`reconcileRefineQueueDir("l0-rebuild")` 命中 1 次、`recall_detail_view` 双写两行命中；在跑的写锁是 `{"pid":3880,…}`（不是请求里说的 `38552`，那是 10:51 那一版实例的 pid，12:14 已被 41-R 收口包替换）。**再打一次包只会打断正在补炼的实例，换不来任何新代码**，所以这一步按「已满足」处理。真正需要重新打包的是**本节的 41-T**（新代码 + 新卡片），是否现在就打（会结束 pid 3880 的补炼轮次）等你一句话。

13. **41-T 出厂后的第一条实机核对不是「补了多少」，而是「有没有少」**：执行完必须抽查三件事（§3 步骤③）——补上的 `sha256` 恰等于 `sha256hex(content)`、`embedding` 恰等于 `embedSync(content_l1)`、且 `version`/`updated_at`/`layer`/正文与执行前逐字相同。这个通道的全部风险都在「顺手改了不该改的元数据」，不在「没补上」。
