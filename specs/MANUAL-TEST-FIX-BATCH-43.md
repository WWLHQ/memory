---
title: 批次43 P0 止血：WorkBuddy 新版会话日志采集恢复
date: 2026-11-12
status: partial
blocked_by: l0_write_lock
scope: 采集器新源/parser、打包产物、真机重启与新包运行态核对
---

# 批次43 · P0 止血手测报告

> **诚实声明**：2026-11-12 11:00~11:03 已按用户约定执行「关闭旧桌面端 → 重新打包 → 启动新包 → 核对运行态」，**重启成功且新源在新包内生效**（首轮 `collected=50`）。但真实入库仍为 **0 条**：重启后 L0 写密钥默认锁定（`get_write_status` → `l0_unlocked:false`），32 条写入全部 `failed_l0_locked`，游标按设计不推进并进入退避。故本报告仍为 `partial`，§4 记录已执行部分与唯一剩余阻塞，不冒充回填完成。

## 1. 事故与修复目标

11-06 起 WorkBuddy 客户端把会话正文从 `~/workbuddy/**/*.md` 迁到 `~/.workbuddy/projects/**/*.jsonl`，`defaultAgentSources()` 仍只配旧目录 → 11-06~11-10 连续 5 天 0 入库、零报错（静默失效）。P0 目标：把新格式接回采集链路，恢复事故窗口数据流。

详见 `specs/POSTMORTEM-2026-11-11-静默失效与双通路自发现方案.md`、`specs/DECISION-2026-11-12-方案对比与融合自发现架构.md` §6.1、`specs/code-map.md` 批次59。

## 2. 改动清单（4 个文件 + 自动生成索引）

| 文件 | 改动 |
|---|---|
| `src/core/memagent/sessionCollector.ts` | 新增 `parseWorkbuddyJsonl()` + 6 个常量/正则；`parser` 联合加 `'workbuddy-jsonl'`；`scanSessionLogs` 的 JSONL 分支 / parse 路由 / recursive 缺省各加该 literal；`defaultAgentSources()` 新增 `workbuddy-projects` 源 |
| `src/core/memagent/__tests__/workbuddyJsonlCollector.test.ts` | 新增 25 例（解析器 10 / 源注册 2 / 端到端 5 / C2 输入变异 8） |
| `specs/code-map.md`、`specs/DECISION-2026-11-12-方案对比与融合自发现架构.md` | 批次59 可追溯映射 + §6.1 P0 落地回执 |
| `specs/code-index.generated.md` | `npm run code:index -- --write` 自动重建（368 源码 / 132 文档；索引按设计跳过 `__tests__/` 与 `*.test.*`） |

**未改**：`main.ts`（`buildSources()` 自动拿到新源）、`tools/collect-daemon.mjs`（`defaultAgentSources()` 无参调用同样生效）、游标推进条件 `committed && applied.failed === 0`、L0 双锁、质量门、100 个 IPC 通道、端口。

**新源口径**：`name:'workbuddy-projects'`（**必须与旧 `workbuddy` md 源不同**，否则 `${name}:${rel}` 游标串位）、`dir=~/.workbuddy/projects`、`recursive:true`、`maxDepth:4`、`filePattern:/\.jsonl$/`、不声明 roles（批次35 缺省只采 user）。

**真实格式（本机 121 个 jsonl 只读实测）**：`type:'message'` + 顶层 `role` / `content:[{type:'input_text'|'output_text',text}]` + `sessionId` + `timestamp`（**epoch 毫秒数字**）。user 消息 80% 以上是宿主注入（`<system-reminder>` / `<cb_summary>` 压缩摘要，内部重放 66 处历史 `<user_query>` / `<task-notification>` / 续接模板）。parser 口径：**先剥注入块 → 再提取 `<user_query>` → 只采真实输入**；未闭合注入块 / 续接模板 / >20,000 字符巨型文本拒采。

## 3. 已自动验证（全部实测通过）

### 3.1 三道闸门

| 闸门 | 结果 |
|---|---|
| **A·影响面回归** | 既有采集器三套件 47/47 全绿（`sessionCollector.test.ts` 38 / `dshZstdCollector.test.ts` 4 / `collectDaemon.test.ts` 5）；`npm run test:gate` **226 文件 / 2724 例，失败 0，重试 0**（4 片均第 1 次通过：631 / 675 / 649 / 769 例；产物目录按纯净度纪律于收尾清理，输出摘要留在本报告与提交日志）；typecheck 0 错、oxlint 0/0（647 文件 123 规则）、`check:no-demo` 0 命中、`validate_project.py` 失败 0、`code:index:check` 一致 |
| **B·效果验证** | 新套件 25/25；离线真源只读扫描（121 文件、不写库）：事故窗口 `11-06=37 / 11-07=1 / 11-08=3 / 11-09=31 / 11-10=68`（合计 **140** 条），端到端 `collected=1280`、`deduped=250`、`roleSkipped=10637`、`skipped=0`，**注入污染 0 条**，最长内容 5040 字符，样本全为真实用户提问 |
| **C·变异验证** | C1：把 `parts.join('\n').replace(WB_HOST_BLOCK_RE,'')` 改为 `parts.join('\n')`（不剥注入块）→ **3 条核心用例真实红灯**（摘要重放被采 2 条 / 整条注入未返回 null / 回填硬指标 6≠5）→ 原样还原（SHA256 `d52ab9e02e47dd897dbddaef0f12be08ac68fa0ac22430d0fb218270fadf586c` 前后一致、无变异残留）→ 25/25 复绿。C2：9 例输入变异（无 content / content 非数组 / role 缺失 / Claude 嵌套 message 误入 / 未闭合 system-reminder / 纯续接模板 / 纯图片块 / 坏行 / ISO 时间漂移）全部如实拒绝或降级，外加合法输入反面 1 例防过滤过头 |

`verify:fast` 出现 3 个红灯（`PgSyncHub` 5s 超时），单独复跑同组用例 **31/31 全绿**；`test:gate` 同一批 2724 例 0 失败 0 重试，确认为覆盖率并发下的既存不稳定，与本轮改动无关（前两轮纯文档改动时同一批用例同样表现）。

### 3.2 打包产物（2026-11-12 10:47）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe`，127,985,837 B |
| 安装包 SHA256 | `bf4a10588960f633a873373e0eb1723bd1612b34777d102789e8e3c3d22aa4fa` |
| `latest.yml` sha512 | `8+JVV64SPfnW4S+Yq7fU0g4W8TpjnX3932Xp/SNH3uzrf1do7Y0wm1T9SRQdDgsZEf1WiO8IW4EvqETasJfpTA==`（与包一致） |
| 免安装版 | `release/installer/win-unpacked/MultiAgent Memory.exe`，249,934,848 B |
| 包内主进程 | `release/installer/win-unpacked/resources/app.asar.unpacked/dist-electron/main.cjs`，865,440 B，SHA256 `c96ce48e32431dcdd91784c36d5644ba2831797f3016880cf8c301ebd90c0c59`，**与 `dist-electron/main.cjs` 逐字节一致** |
| 包内 P0 标记 | `workbuddy-jsonl`×4、`parseWorkbuddyJsonl`×2、`workbuddy-projects`×1、`WB_HOST_TAGS`×3、`WB_MAX_CONTENT_CHARS`×2、`WB_USER_QUERY_RE`×3 |

> **验证口径修正**：`electron-builder.config.cjs` 有 `asarUnpack: ['dist-electron/**/*']`，主进程代码在 `app.asar.unpacked/` 而**不在** `app.asar` 内；安装包是 NSIS 压缩的，明文 grep 不到字符串属正常。故以解包后的 `main.cjs` 与构建源逐字节比对为准。
>
> **打包副作用**：本次 `package.json` 未被 electron-builder 改写（`git diff -- package.json` 为空），无需 `git checkout --`。`import.meta` CJS warning 为非阻塞既存项。
>
> **EBUSY 残留**：`release/` 下 21 个历史 `installer-*` 目录与固定路径 `release/win-unpacked/` 因句柄占用未能删除/收口（该目录现只剩 resources 等文件、无主程序 exe，属残缺旧包）。`release/` 已 gitignored，不影响交付；待重启桌面端释放句柄后可清理，`CODEBUDDY_SAFE_DELETE_ENABLED=0` 只对 Node 层 `fs.rm` 生效，Bash `rm -rf` 多文件目录会被安全护栏 fail-closed 拒删。

### 3.3 按约定关闭旧端后重新打包（2026-11-12 11:01）

用户约定「程序有优化后要将旧桌面端关闭并打包新程序，然后重启新桌面端」，已落为 `AGENTS.md` §0.2。重启前确认旧端已完全退出（进程 0、8200~8204 无监听、`main.log` 停在 10:41），因此本次打包不再受桌面端句柄占用。

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe`，127,985,743 B，SHA256 `a8ecc131ecd0edc6d090677ce9530dfebb74381834451d8e2ad2b593a2710cb2` |
| 免安装版 | `release/installer/win-unpacked/MultiAgent Memory.exe`，249,934,848 B（11:01:26） |
| 包内主进程 | `release/installer/win-unpacked/resources/app.asar.unpacked/dist-electron/main.cjs`，865,440 B，SHA256 `c96ce48e32431dcdd…`，**与构建源逐字节一致**，含 `workbuddy-jsonl`×4 / `workbuddy-projects`×1 |
| `package.json` 副作用 | `git diff -- package.json` 为空，无需还原 |
| 未收口 | `release/win-unpacked/` 仍为 11-11 的残缺旧包（主进程代码不含 P0 标记、无主程序 exe），21 个历史 `installer-*` 目录仍 EBUSY；`release/` 已 gitignored，不阻塞交付 |

> 与 10:47 那次的差异：那次旧桌面端仍在运行，`release/win-unpacked` 被占用导致固定路径未收口；本次固定安装包路径 `release/installer/` 已确认刷新为新代码，故启动该路径下的完整新包。

## 4. 真机重启与运行态核对（**已执行 2026-11-12 11:00~11:03**）

| 步 | 实测结果 |
|---|---|
| 1 关旧端 | 已确认退出：`tasklist` 无 `MultiAgent Memory.exe`、`netstat` 8200~8205 无监听、`main.log` 末条 `02:41:22Z collector:role-gate`（北京 10:41） |
| 2 重打包 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` 退出码 0，产物见 §3.3 |
| 3 启新包 | `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY ./MultiAgent Memory.exe`（后台托管） |
| 4 启动判据 | 3 个进程（主 49764 / 35776 / 45448）；8200/8201/8202/8203/8204 **全部 LISTENING**；`bootstrap:done`；静态服务 62732；`bootstrap:mcp-http-listening {"port":8204}` |
| 5 MCP 复验 | `initialize` 200、`get_write_status` → `{"l0_unlocked":false,"writeDek_present":false,"pending_count":0}`；`recall_memory` 正常返回 |

**新源在新包内确实生效**（这是本轮最重要的正面证据，`main.log` 03:02:57~03:03:03 UTC）：

```
collector:first-scan:start
collector:role-gate {"roleSkipped":277,"collected":50,"deduped":3203}
collector:cursor-hold {"failed":32,"failed_l0_locked":32,"collected":50,"reason":"l0_locked"}
collector:backoff {"fails":1,"delayMs":600000,"reason":"采集异常: collector:round-not-advanced(l0_locked)","capMs":7200000}
collector:first-scan:done {"collected":0,...}   ← 失败轮返回空结果，不是「没扫到」
```

即：P0 代码已进入采集链路并扫到 50 条（`maxItemsPerRun` 上限）、去重 3203、角色过滤 277；**但 32 条写入全部因 L0 写密钥未解锁失败**，`canAdvance=false` → 游标不推进、`seenHashes` 回滚、进入 10 分钟退避。这是 `main.ts:3170-3237` 与 `memories.ts:219-221` 的预期诚实降级，不是新缺陷。

**唯一剩余阻塞**：L0 写密钥是内存态，每次重启默认 `write_unlocked:false`。需在桌面端「安全页 → L0 管理」用管理密码重新解锁写密钥，然后点手动重跑（或等退避轮次）。解锁后复核：

1. `main.log` 出现 `[collector] period done: collected=N written=M` 且 `M > 0`，不再有 `cursor-hold(l0_locked)`；
2. `collector-cursor.json` 出现 `workbuddy-projects:` 前缀游标（当前仍为 288 源、前缀 `claude-code:11 / workbuddy:262 / deepseek-harness:15`，新前缀 0）；
3. `memories.db.json` 的 `memories` 字典从重启前基线 **2915 条**增加；抽查新行是真实用户提问，不得含 `system-reminder` / `cb_summary` / 续接模板；
4. 全历史 1280 条按 `maxItemsPerRun=50`、5 分钟一轮约需 26 轮（≈2h），首轮 `written>0` 即达成硬指标；若干轮后可按 `source_agent=collector:workbuddy-projects` 复核 11-06~11-10 回流。

事故窗口数据仍完整留在本机 121 个 jsonl 里，一条没丢；解锁后回填不丢数据。

## 5. 已知边界

1. T8（Trae `ModularData/ai-agent/database.db` / Qoder `main.sqlite` 的 SQLite reader）仍未修，11-06 后这两路会话正文仍不回流；DSH / Codex / Claude Code 这几日本机无新会话落盘。P0 只止血 WorkBuddy 主路径。
2. 本次只做止血，**不做防复发**（T1 埋点/轮次回执、T2 契约注册表、T3 失败审计与 `/health`、T4 canary、T5 二选一 spool 均未动）。下次 Agent 再换落盘路径仍会静默失效。
3. 新源不受 `detectedAgentNames` 白名单过滤（与三主源同级），桌面端 `main.ts:3093` 与 `tools/collect-daemon.mjs:66` 两处都会扫它；daemon 只暂存、写入由桌面端 drain 交接，既有去重（seenHashes + coreWrite dedup）兜住重复。
4. 手测报告状态仍为 `partial`（`blocked_by: l0_write_lock`）：§4 的关闭旧端 / 重打包 / 启新包 / 运行态核对均已执行并留证，但真实入库为 0 条，卡在重启后 L0 写密钥未解锁（安全设计，需用户输管理密码）。解锁并出现 `written>0` 后改为 `done` 并补记实测入库条数。不把「扫到 50 条」冒充「已入库」。
