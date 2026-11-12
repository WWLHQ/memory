---
title: 批次43 P0 止血：WorkBuddy 新版会话日志采集恢复
date: 2026-11-12
status: partial
scope: 采集器新源/parser、打包产物、待执行的真机重启回填
---

# 批次43 · P0 止血手测报告

> **诚实声明**：本报告区分「已自动验证」与「待人工执行」两部分。**本次未重启桌面端**，因此真实记忆库尚未新增行；§4 的真机回填验证列为待执行，不冒充已测。代码、单测、门禁、打包产物均已验证完成。

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

## 4. 待人工执行：真机重启与回填验证（**尚未执行**）

当前桌面端仍在运行（8200~8204 均 LISTENING），跑的是**旧包**。新代码只有在重启到新包后才会进入采集链路。步骤：

1. 关闭当前桌面端（4 个 `MultiAgent Memory.exe` 进程；会短暂中断 8204 MCP，重启后恢复）。
2. 从新包启动，**必须清掉环境注入坑**：
   ```bash
   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
       -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY \
       "./release/installer/win-unpacked/MultiAgent Memory.exe"
   ```
   判据：`main.log` 出现 `bootstrap:done`，`netstat` 8202/8203/8204 LISTENING。
3. 等首轮采集（`runOnStart:false` + 首扫延迟，或 5 分钟周期）。核对：
   - `main.log` / stdout：`[collector] period done: collected=N written=M`，且**不再**只有 `collector:role-gate {"collected":0,...}`；
   - `collector-cursor.json` 出现 `workbuddy-projects:` 前缀的游标；
   - `memories.db.json` 按创建日出现 11-12 的新行（`N > 0` 即硬指标达成）；
   - 抽查新行内容：应是真实用户提问，**不得**含 `system-reminder` / `cb_summary` / 续接模板。
4. 全历史回填不是一次性灌入：`main.ts:3102` `maxItemsPerRun=50`、`maxMessagesPerFile` 缺省 500、5 分钟一轮 → 1280 条约需 26 轮（≈2h）。首轮 > 0 即达成硬指标。
5. 若要复核 11-06~11-10 的历史输入确实回流，可在采集若干轮后用记忆库页按 `source_agent=collector:workbuddy-projects` 检索。

**重启前的诚实状态**：真实记忆库仍是 11-11 的 2911 条 + 11-11 那条 `params_` 记录，事故窗口数据**仍在本机 jsonl 里、一条没丢**，但尚未入库。

## 5. 已知边界

1. T8（Trae `ModularData/ai-agent/database.db` / Qoder `main.sqlite` 的 SQLite reader）仍未修，11-06 后这两路会话正文仍不回流；DSH / Codex / Claude Code 这几日本机无新会话落盘。P0 只止血 WorkBuddy 主路径。
2. 本次只做止血，**不做防复发**（T1 埋点/轮次回执、T2 契约注册表、T3 失败审计与 `/health`、T4 canary、T5 二选一 spool 均未动）。下次 Agent 再换落盘路径仍会静默失效。
3. 新源不受 `detectedAgentNames` 白名单过滤（与三主源同级），桌面端 `main.ts:3093` 与 `tools/collect-daemon.mjs:66` 两处都会扫它；daemon 只暂存、写入由桌面端 drain 交接，既有去重（seenHashes + coreWrite dedup）兜住重复。
4. 手测报告状态 `partial`：待 §4 执行完成后改为 `done` 并补记实测入库条数。
