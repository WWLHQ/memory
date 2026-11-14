# dsh-hindsight-local 仓库调研报告

> 调研对象：`https://github.com/snakejohn/dsh-hindsight-local`（插件名 `dsh-hindsight-memory`）
> 调研时间：2026-11-14 ｜ 版本：`v0.1.9`（`package.json:3`），`dev` 分支另有未发布改动
> 方式：`git clone --depth 1` 到本机临时目录逐文件实读源码；README、`docs/技术说明.md`、`docs/使用文档.md`、`CHANGELOG.md`、`docs/bench/*` 交叉核对；并实跑其自带测试套件
> 结论口径：**文档与源码冲突时一律以源码为准**，冲突项集中列在 §9
> 本报告只做只读调研，未改动本工作区任何运行时源码

---

## 0. 一句话结论

这是一个**给 DeepSeek Harness（dsh）用的零依赖 Node.js ESM 插件**：用 dsh 的 Hook 把每轮对话写进本机启动的 [Hindsight](https://github.com/vectorize-io/hindsight) 记忆服务，下一次提问前召回少量相关记忆注入上下文。它本身**不实现向量库、不实现事实抽取、不实现重排**，这三件事都交给 Hindsight 服务端；插件的真正价值集中在四块：**时间感知客户端修正、防回灌/幂等写入、召回结果的二次整形（原文 + 精确词 + 新旧覆盖）、以及「不改 dsh 源码」的一键本地部署与状态面板**。

| 维度 | 事实 |
|---|---|
| 形态 | dsh 插件（`dsh.bundle.patch` + `dsh.client`），Node ≥ 20，纯 ESM，**`dependencies` 为空**（`package.json:35,13-25`） |
| 后端 | Hindsight API `1.1.0` / `hindsight-api-slim[embedded-db]`，嵌入式 Postgres `pg0://dsh-hindsight`，默认 `127.0.0.1:8888` |
| 模型 | embedding `BAAI/bge-m3`（1024 维）、reranker `BAAI/bge-reranker-v2-m3`（硅基流动）；抽取 LLM 默认**跟随 dsh 当前默认模型**（`config.js:128-166`） |
| 面板 | 无构建手写 `window.__ModuleLoader__` 包，只 `require('react')`；挂 3 个官方插槽（`web/client.js:985-1002`） |
| 许可证 | MIT ｜ 平台：Linux 实机验证，Windows/macOS 代码路径齐但未真机验证（`docs/技术说明.md:358`） |

---

## 1. 功能清单（用户可感知）

| 功能 | 表现 | 实现位置 |
|---|---|---|
| 长期记忆 | 关掉 dsh、换新对话仍能回忆 | `runtime.js:308-373` 召回 / `:478-590` 写入 |
| 时间问答 | 「早上 7 点干了啥」「昨天下午」「3 天前」「7am」能命中时间段 | 客户端 `timeparse.js:88-145`，注入块 ★ 加权 `recall.js:95-104` |
| 自动记 / 手动导入 | 每轮自动写；首装**不**导入历史，设置页点「现在就记住」选工作区或会话 | `backfill.js:20-100`、`config.js:220-231`（`backfill.enabled=false`） |
| 记住哪些内容可选 | 默认只记用户 + 助手；工具调用/思考/系统提示/归档/子代理可单独开 | `transcript.js:252-261`、`config.js:244-252` |
| 工作区 → 记忆库 | 一个工作区绑一个 bank，多个工作区可指向同一 bank，支持中文库名 | `bank.js:70-98`、`lib/bankmigrate.js` |
| 归档不记 | dsh 里归档的会话整段排除 | `runtime.js:139-156,500-504` |
| 一键本地部署 | 无命令行、无 Python 也行：自动装 uv + Python 3.12 + slim 包 | `lib/bootstrap.js`、`lib/lifecycle.js`、`lib/local.js` |
| 状态卡片 / 控制面板 | 左栏 🟢「记忆正常」；点开看各库数量、浏览/搜索记忆、失败项、导出日志 | `web/client.js`、`lib/rpc.js` |
| 「现在就记住」 | 手动补录，已记过的不重复 | `rpc.js:271`、`index.js:161-178` `/memory-retain` 命令 |
| 不卡聊天 | 服务挂了/超时/限流时只是「暂时不带记忆」 | `runtime.js:358-372`、`index.js:19-20` |
| 上下文裁剪 | 超 N 轮把旧历史折叠成摘要（**默认关闭**） | `lib/prune.js`、`config.js:265-277` |

---

## 2. 架构与数据流

```
dsh Host (Cordis)
 ├─ index.js  apply(ctx, config)          ← 插件入口 / 热重载 / 注册 RPC 与命令
 ├─ lib/runtime.js  MemoryRuntime        ← 状态机：5 个 Hook + 统计 + 游标 + flush
 │    ├─ lib/transcript.js               ← session 事件 → turn 文本（过滤自注入消息）
 │    ├─ lib/recall.js / engmem.js       ← 召回请求构造 → 二次整形 → <memory-context> 注入
 │    ├─ lib/bank.js / bankmigrate.js    ← 工作区 → bank_id 路由
 │    ├─ lib/backfill.js                 ← 官方 sessionPersistence 读历史会话
 │    └─ lib/ops.js / prune.js           ← 异步操作真实状态 / 官方 compaction 裁剪
 ├─ lib/client.js + http.js              ← Hindsight REST（/v1/default/banks/{id}/...）
 ├─ lib/lifecycle.js / local.js / deploy.js / bootstrap.js
 │                                      ← 探活 → 拉起 → 等健康 → 优雅关闭（含维度/代理/日志/密钥）
 ├─ lib/rpc.js + web/client.js           ← owner-only `/api/dsh-hindsight` + 无构建 React 面板
 └─ 本机 Hindsight 1.1.0（pg0 内嵌库）
       ├─ LLM：对话 → 事实（后台异步 worker）
       ├─ Embedding：bge-m3 建 1024 维索引
       └─ Reranker：bge-reranker-v2-m3（留空退化为 rrf 纯排名融合）
```

**一轮对话的完整链路**：

1. `agent/created`（serial）→ 建会话状态、恢复 retain 游标、预热 bank（`runtime.js:799-811`）。
2. `agent/pre-step`（waterfall，`prepend:true` 最外层）→ 先 `await decide()` 拿到 `{kind:'enter', messages}`，再用真实用户输入召回，把记忆块作为**一条合成 user 消息**追加（`runtime.js:719-749`、`recall.js:300-307`）。
3. 模型回答 → `agent/turn-stopping`（serial）**同步返回**、把重活丢进 `setTimeout(0)` 宏任务（`runtime.js:382-403`），从不在关键路径做 HTTP。
4. `retainAgent` 读增量事件、构造 MemoryItem、POST `/memories`（`async:true`）→ Hindsight 后台抽取。
5. `agent/status === 'idle'` 时才通过 `agent.runMaintenance()` 拿独占槽执行裁剪（`runtime.js:761-775`、`prune.js:73-86`）。

**防回灌是硬约束**：注入消息带 `source.kind='plugin:dsh-hindsight-memory'`（`transcript.js:12`、`recall.js:305`）；`readTurns()` 遇到 `plugin:` 开头的消息直接跳过（`transcript.js:188-194`），`stripInjected()` 再兜底剥掉 `<memory-context>`（`transcript.js:247-249`），并且 `promptOf()` 也只取真实用户输入（`transcript.js:294-303`）。所以「召回 → 又被写回记忆」的放大闭环在三个入口都被切断。

---

## 3. 实现方式逐层拆解

### 3.1 插件挂载与热重载（不改宿主源码）

- `cordis.patch.yml` 用 `- insert:` 把插件挂进 profile 树并持久化默认配置（`:6-87`）；`package.json` 的 `dsh.bundle.patch` / `dsh.client.inject` 声明客户端共享包（`:13-25`）。
- `Config` 由 `lib/schema.js` 动态解析 **dsh 自己的** `@deepseek-ai/schemastery`（依次试 `DSH_HINDSIGHT_SCHEMASTERY`、`realpath(process.argv[1])`、`process.execPath`、cwd、`import.meta.url`），**不打包依赖**；根节点 `.volatile()`、密钥字段 `role('secret')`、刻意不写默认值（`schema.js:18-55,64-69`）。解析不到时 `Config=undefined`，插件照常跑，只是没有面板。
- **踩过坑并写进注释**：loader 取 default export 当 runtime，所以必须 `Object.assign(apply, { Config, inject })`，否则 `runtime.Config` 为 undefined、宿主不列命名空间（`index.js:249-254`）。
- 设置页保存是 volatile 更新、不重挂载：`loader/volatile-update` → `reload()` 串行 `previous.stop()` + `startGeneration()`（`index.js:189-200`）。`scopedCtx()` 用 **Proxy**（不是 `Object.create`，因为 Cordis ctx 本身是反射 Proxy）记录 `on`/`inject` 的 disposer，供整代拆除（`index.js:47-76`）。
- `enabled:false` 是真开关：不探活、不拉服务、不发一个字节、不改可见历史（`index.js:96-100`）。
- 还注册了 TUI 命令 `/memory-retain [all|status]`（`index.js:161-178`）与 30s 轮询「跟随 dsh 默认模型」变化后自动重启本地服务（`:224-236`）。

### 3.2 写入链路 retain：幂等 + 游标 + 不丢内容

- `readTurns()` 直接读 dsh 的 append-only 事件日志 `session.snapshotEvents(sinceSeq)`，支持 `sinceSeq` 增量、`dirty` 标记只重发变过的轮次；`resumeSeq` 故意**留最后一轮可重读**——转向(steering)导致回答变长时，复用同一个 `document_id` 让 Hindsight upsert 覆盖，而不是丢尾巴（`transcript.js:135-243`）。
- `renderTurn()` 每行打上**原始事件时间的本地时区戳** `[2026-10-24 周六 07:03 (Asia/Shanghai)] USER（用户本人）: …`，助手行带角色名（`transcript.js:269-283`）；`MemoryItem.timestamp` 写 `isoLocal()`，这样「07 点」这类事实能被抽取 LLM 正确归时（`runtime.js:435-440`）。
- 每条 item 带 `document_id = <sessionId>:t<turnIndex>`、tags（`dsh`/`session:*`/`workspace:*`）、metadata（全部字符串，避免 Hindsight 422）（`runtime.js:419-434`）。
- **工程标识符保真**：`extractIdentifiers()` 用 11 类正则抽出路径、`path::symbol`、camelCase/snake_case/kebab 代号、`--flag`、`test:unit`、配置键、版本号、错误码，写进 extraction `context` 要求逐字保留，并另存 `metadata.identifiers`（`engmem.js:75-133`、`runtime.js:415-434`）。
- 每会话 single-flight（两次 turn-stopping 只发一次，第二次置 `retainQueued`）、每轮 `sent[document_id] = sha1(content)` 去重、分批 `max_turns_per_batch=8`（`runtime.js:478-590`）。
- 429/瞬时错误用指数退避 + 抖动（base 2s / max 60s，最多 3 次），失败**不推进游标**（`runtime.js:553-578`）；游标落盘 `~/.dsh-hindsight/state/cursor-<sha256>.json`，重启/resume 不重发历史（`:594-628`）。
- 服务没起来时 `waitReady(20s)`；网关探测判定 down 时暂停写入，恢复后 `#onBackendReady()` 主动 flush 所有非进行中的会话（`:505-515,881-889`）。

### 3.3 召回链路 recall：客户端整形是核心竞争力

1. **清洗查询**：`cleanRecallQuery()` 剥掉 `<memory-context>`、答题格式套话（「请返回 JSON」「用字段 value」「只使用记忆、不要猜测」「题号 Q01」）、JSON 模板、字段短语（`engmem.js:14-70`）。CHANGELOG 说明动机：同一套工程题，带格式要求时只答对 1/27（`CHANGELOG.md:4`）。
2. **时间窗**：`parseTimeWindow()` 自己解析中英文相对时间，支持「前天/昨天/今天/N 天前」、时段（凌晨/早上/中午/下午/傍晚/晚上）、中文数字钟点、半/一刻/三刻、`7am`、`07:03`；裸「7 点」取**最近一次已过去的 7 点**；返回 `{start,end,label,precision}`（`timeparse.js:65-145`）。原因是 Hindsight 的 `DateparserQueryAnalyzer` 只能解析到「天」、且按 UTC 日界算，东八区早上 7 点会落到前一天（`timeparse.js:1-9`）。
3. **请求**：`buildRecallRequest()` 把绝对时间拼进 query（并把服务端检索范围前后各放宽一天）、带 `query_timestamp`（本地时区 ISO）、`budget=mid`、`max_tokens=1200`、**`include.chunks`** 索要事实背后的原话（`recall.js:24-54`）。分数阈值**只在本端过滤**，避免服务端二次过滤把时间命中但相似度低的事实丢掉（`:50-51`）。
4. **二次整形 `selectSources()`**（`recall.js:130-230`）：按 `chunk_id`/`document_id` 把事实分组回「一次 retain 的原文」；用 `lexicalScore()` 对原文做精确词加权（标识符权重 3、CJK 二元组/英文词权重 1），命中标识符额外 +0.5；时间窗内 +`window_boost(0.5)`；最终 `rank = 服务端分 + 0.6*词面分 + 0.5*(有标识符命中) + 时间窗加权`。服务端返回了原文但对应要点被 token 上限挤掉的「chunk-only」候选也保留。
5. **新旧覆盖 `supersededIds()`**（`engmem.js:180-256`）：识别「X 已作废 / 替代 X / 改为 Y / X 已完成」，把旧记录里的 X 标「已被取代」，并**强制把那条较新的记录一起注入**（哪怕字面不相关，最多补 2 条），避免模型把过时的待办当当前事实（`recall.js:210-228`）。
6. **注入块 `formatRecallBlock()`**（`recall.js:232-297`）：`<memory-context bank="...">` 头部写明「只是背景、可能过时」「路径/符号以原文为准、不是当前 cwd」「同一事项以时间最新为准」；带当前本地时间、时间窗标签、★ 标记；每条 `[n] 时间戳 ｜最新/★` + `原文：`（超过 600 字用 `excerpt()` 按相关句摘）+ 要点 + 取代提示；硬字符预算 `max_chars=4000`，装不下就 `break`（`:282-292`）。无命中时也把「当前本地时间」注入，让模型能诚实回答「没有找到该时间段记忆」。

### 3.4 分库路由与迁移

`resolveBankId()` 优先级：**精确路径映射 → 最长目录前缀映射（`prefix_match`）→ 模板 `dsh-{slug}-{hash}`**（`bank.js:70-98`）。中文库名用 `bk-<sha1 前 8>` 生成 ASCII id，原文作显示名，不会互相塌缩（`:43-48`）。旧版 `bank.default_bank` 曾导致所有工作区实际写进同一个库、显式映射形同虚设；现在启动时由 `lib/bankmigrate.js` 一次性把**所有**已知工作区映射到那个旧库并记 `bank-migration.json`（幂等、`replaced` 留痕），随后清除该设置（`CHANGELOG.md:16,28`）。

### 3.5 补录与裁剪

- `backfillSessions()` 通过官方 `sessionPersistence.list() / open(id,'read')` 读会话（避免自己解 `jsonl.zstd` 和格式迁移目录），按 `createdAt` 从旧到新、跳过归档/子代理/活跃会话/已追平的会话，节流一次一个，复用同一套 `retainAgent()` 与游标，因此**重跑/中断都不重复**（`backfill.js:20-100`）。
- `prune.js` 不改 append-only 日志，只规划切点：超过 `trigger_after_turns(12)` 且保留最近 `keep_recent_turns(6)` 轮，避开 system 节点、把切点从 tool 节点往前挪以保持 call/result 配对，然后 `agent.runMaintenance()` 里调 `compaction.compactRegion(start,end,agent,signal)`（`prune.js:21-86`）。**默认 `prune.enabled=false`**，注释说明 dsh 自带压力压缩、过早折叠会丢细节（`config.js:265-268`）。

### 3.6 本地服务：一键部署 / 生命周期 / 隔离

- `planLocal()` runner 顺序 **`venv → uvx → pip → docker`**（`local.js:110-124`）；`venv` 默认，在 `~/.dsh-hindsight/venv` 装 `hindsight-api-slim[embedded-db]==1.1.0`，以 `hindsight-api --host 127.0.0.1 --port 8888` 启动；marker 文件 `dsh-installed.txt` 内容须等于包名才跳过重装。
- 没有 Python ≥3.11 时：`ensureUv()` 从 PyPI wheel 抽 `uv.exe`（镜像顺序：自定义 → 清华 → 阿里云 → PyPI），`uv python install 3.12` 装到 `~/.dsh-hindsight/python`；Python 解释器会先探测 `ctypes/ssl/sqlite3`，损坏的便携版直接跳过（`bootstrap.js:45-89`、`lifecycle.js:117-119`）。Windows 中文用户名自动改用 ASCII 数据根 `C:\Users\Public\dsh-hindsight`（`config.js:81-82`、`CHANGELOG.md:40`）。
- **0.1.6 起子进程 cwd 是 `<数据根>/run`，不是插件目录**：Windows 下进程 cwd 会锁住插件目录，导致 dsh 开着时 pnpm 更新插件失败；因此把插件 `.env` 复制一份到 run 目录，命中 hindsight-api 的 `load_dotenv(find_dotenv(usecwd=True), override=True)`（`lifecycle.js:532-537`、`CHANGELOG.md:33`）。**`docs/技术说明.md:343-344` 仍写「cwd 必须是插件根目录」，已过时**。
- 子进程环境由 `serviceEnv()` / `localEnv()` 生成 `HINDSIGHT_API_EMBEDDINGS_*` / `RERANKER_*` / `LLM_*`、`DATABASE_URL=pg0://dsh-hindsight`、`RETAIN_CHUNK_SIZE=1500`、`RETAIN_MAX_COMPLETION_TOKENS=8000`、`LLM_TIMEOUT=300`、并发 1（`config.js:634-689`、`local.js:54-92`）；reranker 空 → `rrf`，LLM 空 → `none`（只存原话）。启动前 `stripInheritedHindsight()` 丢掉父进程所有 `HINDSIGHT_*`/`DSH_HINDSIGHT_*`，防止旧 `DIMENSIONS=1024` 让硅基流动 bge-m3 报 400/20015（`childenv.js:15-45`）。
- **密钥只进插件根 `.env`**（`DSH_HINDSIGHT_EMBEDDING_API_KEY` 等 4 个键），绝不写 `cordis.patch.yml`；每次写入镜像备份到 `~/.dsh-hindsight/plugin.env`，防止「移除后重装插件」丢密钥（`dotenv.js:23-46,150-156`、`CHANGELOG.md:37,45`）。
- 启动前**维度三向校验**：`expected_dim(1024)` vs `POST /embeddings` 实测维度 vs `~/.dsh-hindsight/embedding-dim.json` 记录的库维度，任一不符拒绝启动并用中文提示（`dimension.js:19-71`）——因为 Hindsight 1.1.0 的 `vector(N)` 列建库时固定，有数据后不能改。
- 生命周期：探活 `/health`（2.5s 超时）→ 拉起 → 轮询等健康（总 300s / 1.5s 间隔，子进程提前退出即放弃）；`stop()` 先 SIGTERM、宽限 5s（keep-alive 抬到 30s）后 SIGKILL，非 Windows detached 用 `kill(-pid)` 打整组，最后 `pg0.stop()` 关内嵌库；pid 文件 `hindsight.pid` 用来找回「上次 dsh 留下、这次只是接上」的进程并在「重启服务/重新部署」时真正停掉（`lifecycle.js:250-278,395-410,962-1057`）。
- 日志：`~/.dsh-hindsight/logs/` 的 `hindsight.log` / `install.log` / `plugin.log`，单文件 5MB、最多 3 份、总额 25MB、保留 14 天；`collapseRepeats()` 折叠重试刷屏；导出日志用 `redact()` 打码 `sk-`/`rk-`/`Bearer`/键值型 KEY|TOKEN|SECRET|PASSWORD（`logfiles.js:14-25,29-112`）。代理用 `cleanNoProxy()` 丢弃 `[::1]` 等 httpx 解析不了的条目并补齐 localhost，Windows 从注册表读系统代理（`proxy.js:19-30,97-123`）。

### 3.7 设置面板 / RPC / 状态卡片

- `web/client.js` 是**无构建**的 `window.__ModuleLoader__.load({id, factory})` 闭包，只 `require('react')`（react-dom 可选用于 Picker portal），CSS 以字符串注入；注入 `slots`/`locale`/`configForms` 三个服务，挂 `plugins.bundle.config`（设置/状态两页）、`plugins.bundle.activation`（启用后弹窗）、`sidebar.footer.action`（侧栏卡片，`order:50`）（`web/client.js:1-16,985-1002`）。
- 三步向导：选「已配置 / 未配置」→ 粘贴密钥（700ms 防抖 `checkKey` 校验并拉模型列表）→「一键开始」批量 `mutate` 写 `setup:local` + 三通道默认值（`client.js:693-764`）。另有高级设置（服务商/模型搜索、工作区→库映射与新建中文名库、记住哪些内容、侧栏卡片开关）、状态页（部署五步进度、各库数量、JobRow、最近与失败写入）、记忆浏览（按库服务端分页 10 条/页 + 搜索）、导入旧对话、重试失败项、导出日志。
- RPC：唯一路由 `POST /api/dsh-hindsight`，经 dsh 官方 `connection.fetch.register` 注册，Host/Origin 隔离 + 仅 owner Peer；信封 `{endpoint,payload}` → `{ok,value|error}`（`rpc.js:55-66,309-312`、`index.js:207-216`）。共 **22 个 endpoint**：`overview/workspaces/banks/createBank/bankMigration/memories/presets/models/checkKey/dshLlm/saveKeys/clearKeys/dotenv/checkConnection/restart/redeploy/sidebar/retainNow/sessions/dismissImport/retryFailed/exportLogs`（`rpc.js:69-308`）。
- 侧栏状态靠**长轮询**：`sidebar({since,wait})` 最多挂起 25s、每秒比对状态签名变化才返回（`rpc.js:257-264,437-438`），客户端 `useSidebarStatus` 死循环续接；`overview.keyState` 只返回来源名不返回密钥；`dotenv` 回显打码（`rpc.js:95,247-251`）。

### 3.8 配置体系与降级

- 优先级：**默认值 → 外部 JSON（`config.file`/`DSH_HINDSIGHT_CONFIG_FILE`）→ 内联 config（`cordis.patch.yml`）→ `DSH_HINDSIGHT_*` 环境变量**（`config.js:466-583`）。`ENV_MAP` 是点路径转大写下划线的表，带 `bool/number/list/json/string` 类型，非法值只 warning 并回退默认（`:291-384,412-439`）。`setup` 是特例：内联已选定后 env 不再覆盖，防 `.env` 把用户显式选择顶掉（`:497-498`）。
- **降级矩阵**（`docs/技术说明.md:219-232` + 源码核对）：服务未起且 `autostart=false` → 一条 warning、跳过；拉起失败/就绪超时 → 继续无记忆运行；recall 5xx/429/超时 → 不注入、**按 bank 冷却 60s**（一个库限流不影响别的工作区）、同会话只 warn 一次（`runtime.js:358-372`）；retain 失败 → 不推进游标、下一轮补；`compactRegion` 抛错 → 退回 dsh 原生压缩；没有 compaction 服务 → 只关裁剪。`apply()` 返回 `stats()` 可观测 recalls/recallsFailed/injections/retains/retainsFailed/prunes/prunesFailed/service。

---

## 4. 数据落盘与隐私

| 内容 | 位置 |
|---|---|
| 记忆库 | Hindsight 自带 pg0 内嵌 Postgres，`pg0://dsh-hindsight`（Linux 上 `~/.pg0`） |
| 写入游标 / 操作台账 | `~/.dsh-hindsight/state/cursor-*.json`、`_operations.json` |
| 密钥与配置 | 插件根 `.env`（0600、UTF-8 无 BOM）+ 备份 `~/.dsh-hindsight/plugin.env`；`.env` 已 gitignore |
| Python / venv / uv / 日志 / pid | `~/.dsh-hindsight/{python,venv,bin,logs,run,state}` |

**会出本机的**：对话原文发给抽取 LLM（默认跟随 dsh 的模型服务商）；建索引与重排文本发给 embedding/reranker 服务商（默认硅基流动）。**只留本机的**：数据库、日志、密钥。插件不把密钥写进日志，归档会话不记。端口默认绑 `127.0.0.1`，不暴露到局域网。

---

## 5. 性能实测（仓库自报，非本次复现）

数据来自 `README.md` 与 `docs/bench/summary.json`（LoCoMo 数据集，CC BY-NC 4.0，仅评测用；抽取模型 `deepseek-flash`）：

| 指标 | 数值 | 核对 |
|---|---|---|
| 写入规模 | 992 轮 / 3 库 / 48 次写入，0 失败 0 限流 | `summary.json:30-38` |
| 花费 | 余额前后差 ≈ ¥2.36～2.37；按 token 用量估算 ¥0.84 | `summary.json:36,45-48` |
| 召回命中率 | 50 题 94%；时间类 36 题 **97.2%**；其他 14 题 85.7% | `summary.json:94-101` |
| 上下文节省 | 约 **84.9%**（63165 字全量 vs 9512 字注入，按字符估算） | `summary.json:85-92` |
| 召回延迟 | P95 **3.31 / 3.77 / 4.92 s**（147 / 220 / 341 条记忆） | `summary.json:62-84` |
| 长消息 | 约 1.2 万 token 消息 7.6s 写完 | `summary.json:49-60` |
| 内存 | Linux 上 slim + pg0 约 540–553 MB | `docs/技术说明.md:324-326` |

⚠️ README 把这组数据标为 **v0.1.1** 实测，而当前版本是 v0.1.9；且 token 数是按字符估算、非厂商 tokenizer（`summary.json:92`），不能当严格基准。

---

## 6. 测试体系与本机实跑结果

- 零依赖、只用 `node:assert`；`tests/harness.mjs` 提供 fake Cordis ctx/session/agent/client，`tests/mock-hindsight.mjs` 是纯 `node:http` 的 Hindsight 1.1 mock（按 openapi 字段白名单校验 + 关键词召回），集成测试无真服务时自动 SKIP（`DSH_TEST_HINDSIGHT_URL` 可指真服务）。
- `npm test` = `node tests/run-all.mjs`，逐文件 spawn 独立进程、用 mkdtemp 隔离真实 home（`tests/run-all.mjs:13-60`），共 **37 个用例文件**。
- **本机（Windows / Node v22.22.2）实跑结果：`26/37` 文件通过（约 168 条 PASS + 2 SKIP），11 个文件失败**，全部是平台/环境差异而非逻辑缺陷：
  - POSIX 路径断言在 Windows 得到 `C:\srv\...`：`test-config-bank.mjs:107`、`test-default-bank-migration.mjs:18`、`test-nonascii-home.mjs:36`、`test-bank-scope-migration.mjs:36`（hash 因路径不同）、`test-panel-local.mjs:57`；
  - macOS/Unix 专有：`test-macos.mjs:30`（PATH 前缀）、`test-restart-keepalive.mjs:53`（负 pid 进程组 SIGTERM）；
  - CRLF 行尾多出 `\r`：`test-v014.mjs:59`；
  - 依赖真实 Python/联网 pip：`test-broken-python.mjs:96`（清华镜像找不到 1.1.0 包）、`test-childenv-embhealth.mjs:207`、`test-dotenv-deploy.mjs:68`。
  - 这与仓库自述「Linux 已完整实测，Windows/macOS 代码路径已写好但未真机验证」完全吻合，也说明其测试套件**隐含 POSIX 假设**。

---

## 7. 版本演进（CHANGELOG 提炼）

| 版本 | 关键变化 |
|---|---|
| v0.1.3 | 进度按 Hindsight **真实 operation 状态**显示（此前「已提交」冒充完成）；失败自动退避重试 + 「重试失败项」；「同时处理数」默认 1 |
| v0.1.4 | 「记住哪些内容」同步写 `.env`；首图版本号脚本化并发版测试把关 |
| v0.1.5 | `.env` 备份防重装丢密钥；修同一轮重复 retain；中文用户名 ASCII 数据根；密钥不再进 `cordis.patch.yml`；移除 `bank.scope` |
| v0.1.6 | 服务 cwd 移到 `<数据根>/run`，解决 Windows 插件目录被占用导致更新失败 |
| v0.1.7 | `setup` 持久化 `.env` 防掉回「需要设置」；剥离继承的 `HINDSIGHT_*`（修 dimensions 400/20015）；侧栏缓存向量探测；`default_bank` 迁移；日志只看近 10 分钟 |
| v0.1.8 | 迁移覆盖全部工作区；命名库立即建空库；重启/重部署真停 keep-alive 服务；检测损坏 Python；`deepseek-chat/reasoner` → `deepseek-flash` |
| v0.1.9 | 修侧栏误报：只认 WARNING/ERROR，401/403/429 必须带上下文，排除时间戳毫秒与 `thoughts_tokens=401` |
| dev 未发布 | **工程开发记忆**：清洗答题格式套话、标识符逐字保留、召回附「原文」片段、新需求覆盖旧需求标「已被取代」、去掉 session 编号 |

---

## 8. 值得借鉴的点（对照本工作区的 MultiAgent Memory）

1. **三处防回灌**（注入消息 source 标记 / 读日志过滤 / 文本剥离）＋ `document_id` 确定性幂等，比单点过滤稳；本项目在「进库分流只认 session_id」之外可参考其「已发送内容 sha1 去重 + 游标不推进」的断开续传写法。
2. **时间语义放在客户端修**：服务端按 UTC 天解析相对时间是通用坑，其「本地时区戳 + `query_timestamp` + 前后各放宽一天 + 本端精确时间窗 ★ 加权」是一套完整解法，可直接对照本项目 `recallModes.ts` / 时间类召回。
3. **异步写入不等于已写入**：`OpTracker` 以 `GET /operations/{id}` 的真实状态驱动 UI 与重试、409「还在排队」不算失败、定期对账——对应本项目「诚实进 `cursor-hold` / 退避」的设计哲学，可参考其状态机与展示口径。
4. **召回结果二次整形**：原文 chunk + 标识符精确词加权 + 新旧覆盖，能补服务端抽取丢路径/符号、token 截断漏召回两类损失；比单纯调 rerank 阈值有效。
5. **owner-only 精确路由 + 25s 长轮询 + 官方插槽**：完全不改宿主源码就做完整控制面板；密钥只留服务端、回显打码、导出日志脱敏。
6. **降级粒度按 bank 冷却**、失败不推进游标、`enabled:false` 真开关、所有 Hook 全 try/catch——「记忆插件绝不能打断对话」落到了代码注释与实现两处。

---

## 9. 文档与源码不一致清单（重要，别照文档抄）

| # | `docs/技术说明.md` 说法 | 源码现状 |
|---|---|---|
| 1 | §5「测试基线 5 个文件 / 57 项」、§1 目录树列 10 个 lib 文件 | 实际 37 个用例文件、`lib/` 30+ 文件（`tests/run-all.mjs:13-35`） |
| 2 | §3.3 三通道 `provider/base_url/model` 默认全为 `''` | 默认已是硅基流动预设：`bge-m3` / `bge-reranker-v2-m3` / `llm.mode='follow'`（`config.js:128-166`） |
| 3 | §3.1 `startup_timeout_ms=60000` | 实为 `300000`（`config.js:42`） |
| 4 | §3.4 `recall.min_prompt_chars=8` / `prune.enabled=true` | 实为 `6` / `false`（`config.js:201,268`） |
| 5 | §10「以插件根目录为 cwd 启动 Hindsight，cwd 必须是插件根目录」 | 0.1.6 起 cwd 是 `<数据根>/run`，`.env` 复制过去（`lifecycle.js:532-537`、`CHANGELOG.md:33`） |
| 6 | §10「`.env` 升级时保留」 | 重装会替换插件目录，靠 `~/.dsh-hindsight/plugin.env` 备份恢复（`CHANGELOG.md:37`） |
| 7 | §10「进程环境变量 > .env > 配置文件」 | `resolveConfig` 是 `默认 → 外部 JSON → 内联 config → env`，`.env` 是经 env 源注入、非独立层（`config.js:473-500`） |

一致且可信的部分：配置优先级、插槽名、schemastery 解析路径、25s 长轮询、零依赖、降级语义。

---

## 10. 局限与风险

- **平台**：Linux 端到端验证过；Windows/macOS 只做了单测里的路径规划。本次 Windows 实跑 11 个用例失败虽属测试假设问题，但也印证了「Windows 未真机验证」。
- **外部依赖**：首次部署需联网下载 uv/Python/slim 包（3–10 分钟）；抽取 LLM、embedding、reranker 都要第三方密钥，免费额度会限流；插件本体省不了这笔推理成本与隐私外发。
- **模型通道归属服务端**：`attach` 已有 Hindsight 时，插件改不了它的 embedding/reranker/LLM，只能在客户端做 `top_n` 与分数阈值二次过滤。
- **维度不可迁移**：换 embedding 模型或迁移库时维度必须一致，否则 Hindsight 有数据后拒绝启动；插件只能拦截并中文提示，不负责迁移。
- **文档漂移**：`docs/技术说明.md` 多处停留在早期版本（见 §9），README 性能数据标 v0.1.1 而当前 v0.1.9。
- **面板只在 web/desktop**：TUI 无面板，靠 `cordis.patch.yml` / 外部 JSON / 环境变量；非常规安装解析不到 schemastery 时面板消失。
- **未发布 dev 改动**：工程记忆那套（清洗套话/原文/覆盖）已在 `main` 的源码与 CHANGELOG dev 段里，但**尚未发版**，README 未承诺。

---

## 11. 关键文件索引（源码位于临时克隆目录）

| 关注点 | 文件 |
|---|---|
| 入口 / 热重载 / 注册 | `index.js`、`cordis.patch.yml`、`lib/schema.js` |
| 运行时编排 / 5 个 Hook | `lib/runtime.js`（1084 行） |
| 会话 → 文本 / 防回灌 | `lib/transcript.js` |
| 召回请求 / 整形 / 注入块 | `lib/recall.js` |
| 查询清洗 / 标识符 / 精确词 / 覆盖 | `lib/engmem.js` |
| 本地时区 / 相对时间解析 | `lib/timeparse.js` |
| 工作区 → bank | `lib/bank.js`、`lib/bankmigrate.js` |
| REST 客户端 | `lib/client.js`、`lib/http.js` |
| 异步操作真实状态 | `lib/ops.js` |
| 历史补录 / 裁剪 | `lib/backfill.js`、`lib/prune.js` |
| 部署 / 生命周期 / 环境 | `lib/lifecycle.js`（1076 行）、`local.js`、`deploy.js`、`bootstrap.js`、`childenv.js`、`dimension.js`、`proxy.js`、`dotenv.js`、`keystate.js`、`logfiles.js`、`log.js`、`dataroot.js`、`presets.js`、`host.js`、`llmprobe.js`、`embhealth.js` |
| 配置 | `lib/config.js`（654 行） |
| 面板 / RPC | `web/client.js`（994 行）、`lib/rpc.js` |
| 文档 / 压测 / 版本 | `README.md`、`docs/技术说明.md`、`docs/使用文档.md`、`docs/bench/*`、`CHANGELOG.md` |

---

## 12. 核验记录（三道闸门在只读调研任务上的落地）

- **A·影响面回归**：`git clone` 到 `%TEMP%\dsh-hindsight-local-review`，本工作区零源码改动；`git status --short` 显示 13 个既有在途改动 + 1 个既有未跟踪报告，均非本轮产生，未纳入任何提交；`node tools/code-index.mjs --check` → 「代码索引已是最新（380 个源码文件、140 个文档）」，故未重写索引文件以免覆盖在途改动。
- **B·效果验证**：报告每条结论给出 `文件:行号`；README / 技术说明 / CHANGELOG / `docs/bench/summary.json` 与源码交叉核对；自带测试套件实跑 `26/37` 通过并逐条归因 11 个失败。
- **C·变异验证（等价形式）**：不修改目标仓库代码，改以「文档↔源码冲突」做真值检验——发现 7 处文档过时（§9），逐条回到源码确认现值（如 cwd、默认值、测试基线），并对压测数据核对原始 JSON 而非只信 README 转述。
- **交付状态**：仅新增本报告文件，**未执行 commit / push / 打包 / CI**；按约定需先展示改动清单并等人工确认，且工作区存在非本轮在途改动，本轮不触碰。
- **记忆库检索（补记）**：本轮 MCP 工具索引缺失，但按工作区日志记载的办法直连本机 8204 `/mcp` 成功调用 `recall_memory`：命中 1 条（1,880t，另一项目的功能需求清单），`evidence_thin=true`「未命中权威来源」，与本次外部仓库调研主题无关，故 **未采信为任何事实依据**，报告结论全部来自目标仓库源码实读。
