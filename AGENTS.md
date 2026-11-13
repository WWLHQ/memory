> **本文件是唯一真源。** 2026-11-12 起 `AGENTS.full.md` 已删除：原 §3 改哪里、§9 已知边界两块大部头（合计约 96k 字符）已拆到 `specs/` 随规格库维护，其余章节全部并入本文件。
> **必须控制在 40,000 字符以内**（当前约 13k）——超过该上限会被 WorkBuddy 整份跳过加载，规则一条都不生效。新增内容优先写进 `specs/` 再在此留指针。

# AGENTS.md — 协作与维护指南

> 目标：人或大模型在 5 分钟内回答三个问题——**代码在哪、怎么复现、改完怎么验**。
> 阅读顺序：本文件 → [`specs/code-map.md`](specs/code-map.md)（人工维护的模块地图）→ [`specs/code-index.generated.md`](specs/code-index.generated.md)（自动导出符号索引，`npm run code:index -- --write` 刷新）。

## 0. 开发纪律：三道闸门（2026-11-05 起强制）

**每个原子动作收尾必须过 A·影响面回归 / B·效果验证 / C·变异验证 三道闸门**，缺一不得提交、不得宣称完成。
单一真源见 [`specs/开发纪律_三道闸门.md`](specs/开发纪律_三道闸门.md)：
A = 影响面清单 + 全量回归 + 静态门禁 + 索引一致性 + 既有行为未变；
B = 每条 AC 的正向端到端用例，断言状态/审计**真的变了**（只读类反向断言**真的没变**）；
C = **至少一次代码级变异**（临时把关键判定改错 → 指定测试必须红灯 → 原样还原 → 必须绿灯）+ 输入/状态变异矩阵。
收尾时按文档 §4 模板给出三栏证据，写入提交信息、`code-map.md` 与成果说明，并等待人工确认再进入下一原子任务。

### 0.1 纯净度纪律（2026-11-12 起强制，与三道闸门并列）

**验收即清扫**：验证通过后、`commit` 之前，清掉本次为「验证」而产生的一切东西。仓库与构建目录只留交付物。
判定标准一句话：**下一个任务不会再用的，就是临时物。**

| 必须删（临时物） | 必须留（交付物） |
|---|---|
| 一次性验证脚本与探针：`*-probe.mjs`、`tmp-*.js`、`verify-*.ps1` | `tools/` 下被 `package.json` script 或 CI 引用的脚本（如 `tools/recall-stats.mjs`） |
| 散落在**仓库根目录**的 `*-report.md`、`*-fix-report.md` | `specs/` 规格、`specs/reports/` 正式报告 |
| `test-results/`、`playwright-report/`、`coverage/`、失败截图 | `e2e/`、`__tests__/` 下的用例**源码** |
| 构建残留：根目录 `main.cjs`（真入口是 `dist-electron/main.cjs`）、旧 `dist*` 副本、历史 `release/installer-*` | `dist/`、`dist-electron/`、`release/installer/`（当前交付产物） |
| `*.log`、临时 html、`*.bak`、`nul` | 持续累积的数据文件（如 `specs/reports/recall-snapshots.jsonl`） |

**收尾五步**（用户 2026-11-12 授权默认执行，不必每次再问）：
跑验（三道闸门）→ 扫（列临时物路径+体积）→ 清（按路径逐项删，删不掉的单列）→ 核（`git status` 只剩待提交项，复扫 `test-results/`、`coverage/`、`*.log`）→ 报（复述删了什么/留了什么/为什么），然后才 `commit`。

四条硬边界：

1. **禁 `rm -rf` 扫根目录**，按具体路径逐项删。
2. **`.gitignore` 不等于可留**——测试产物每次验证完都要删，忽略只是防止误入库。
3. 删不掉的**如实说**并给出可执行命令，**不得换 shell 工具或写脚本穿透安全检查**（本机 `rm -rf` 被 genie-trash 守护 fail-closed 拦截即属此类；`CODEBUDDY_SAFE_DELETE_ENABLED=0` 只对走 Node `fs.rm` 的打包脚本有效，对 Bash 的 `rm` 无效）。
4. **报告归位**：一次性修复报告写进 `specs/reports/`；外部程序误写的垃圾（如显卡驱动日志 `NVIDIA Corporation/`）删掉并补 `.gitignore` 防复发。

### 0.2 交付闭环纪律（用户 2026-11-12 约定，长期生效）

**程序有优化（任何会进入运行时的改动）后，必须走完整闭环：关闭旧桌面端 → 重新打包 → 验证产物 → 启动新桌面端 → 核对运行态。** 只提交代码、只打包不重启、或只重启不重打包，都算未完成——旧进程仍跑旧口径，用户看到的行为与仓库不一致（批次60 观察计划里「常驻进程仍跑旧口径，必须重启桌面端」即此坑）。

| 步 | 动作 | 判据 / 已知坑 |
|---|---|---|
| 1 | 关旧端 | `MultiAgent Memory.exe` 进程数 0、8200~8204 无 LISTENING；否则打包会 EBUSY，产物收口不到固定路径 |
| 2 | 重打包 | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package`；随后 `git diff -- package.json` 必须为空，非空则 `git checkout -- package.json`（electron-builder 会清空 `scripts`/`devDependencies` 且不还原） |
| 3 | 验产物 | 安装包 exe 非空 + SHA256；**主进程代码在 `resources/app.asar.unpacked/dist-electron/main.cjs` 而非 `app.asar` 内**，须与 `dist-electron/main.cjs` 逐字节一致且含本轮改动标记（NSIS 压缩包明文 grep 不到字符串属正常） |
| 4 | 启新端 | `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY "./MultiAgent Memory.exe"`，用后台托管；不清 `ELECTRON_RUN_AS_NODE` 会以纯 Node 模式启动、不起 Chromium |
| 5 | 核运行态 | `main.log` 有 `bootstrap:done` + 8202/8203/8204 LISTENING + `get_write_status`；**重启后 L0 写密钥默认 `write_unlocked:false`**，须在安全页重新解锁，否则采集/写入诚实进 `cursor-hold(l0_locked)` 与退避，属预期安全行为不是代码缺陷 |

**边界**：纯文档/规格改动沿用「重建索引 + 三道闸门 + 推送」，不触发重新打包（不改变运行时行为）；但只要本轮有源码改动，即使同时改了文档仍必须走本闭环。历史 `release/installer-*` 与 `release/win-unpacked` 因句柄占用删不掉时如实记录，`release/` 已 gitignored，不阻塞交付、不绕过安全护栏强删。

## 1. 项目是什么

MultiAgent Memory：Electron 45 + React 19 + Vite 的本地优先「多 Agent 记忆」桌面应用（22 个 HTML 入口，含批次37-B 的首启强制向导 `setup.html`）。
数据与审计全部落本机，无云依赖；未接线的能力会显式报错，绝不伪造数据。
**批次37 起数据分两个库文件**：`memories.db.json`（L1–L6 可检索正文）与 `memories.l0.json`（L0 原文，只存 v2/v1 密文信封），密钥环 `l0-keyring.json` 与 L0 库同目录；两个目录由首启向导让用户各自选定（可同可不同）。**批次41-A 起内核审计另成第三份文件** `audit.jsonl`（追加式 JSONL，跟 `memories.db.json` 同目录，轮转出的旧档进同目录 `audit-archive/`）——审计不再参与整库序列化，记忆库体积不随审计增长。

| 层 | 目录 | 职责 |
|---|---|---|
| 记忆内核 | `src/core/memagent/` | 存储（FileStorage/PGlite）、L0 原数据库（`l0Store`）与拆分/重建/恢复（`l0Split`/`rebuild`/`l0Recovery`）、召回、合并、遗忘、审计、MCP、webhook、sync |
| 桌面主进程 | `src/electron/` | bootstrap、静态服务、数据根与两库位置、双库备份、IPC、悬浮窗、动作日志 |
| 本机后端 | `src/home/`、`src/agentOnboard/`、`src/auth/` | 登录/会话/账号角色/审计镜像、Agent 接入、密码哈希与锁定 |
| 渲染页面 | `src/web/` | 22 个页面（Setup/Home/Overview/Memory/Write/Audit/…/Security/Params） |
| 渲染基座 | `src/desktop/`、`src/shared/` | 宿主桥（iframe 代理）、IPC 存储适配、跨端日志格式 |
| 端壳/验收 | `src/electron/`、`e2e/` | Playwright 点击级 E2E（真构建产物 + 真后端） |

本机端口（不要硬编码，渲染层统一走 `src/web/backend.ts`）：静态页随机端口、home `8201`、agentOnboard `8200`、MCP `8202`/`8204`、webhook `8203`。

### 1.1 Agent 先查记忆库（MCP）

桌面端在 `127.0.0.1:8204/mcp` 暴露标准 MCP 服务 `multiagent_memory`（批次46-D6-5 后共 **12 个工具**：`recall_memory` / `write_memory` / `list_projects` / `get_preferences` / `get_write_status` / `list_memories` / `get_memory` / `feedback` / `manage_memory` / `gc_report` / `create_project` / `mint_token`；`gc_report` 缺省 `dry_run=true` 只演算不改库；`create_project`/`mint_token` 为**管理员专属**——`mint_token` 明文令牌只在结果出现一次须原样转交用户，非 admin 调用一律被明确拒绝）。**接入 Agent 回答本仓库实现、架构、历史决策、踩坑、偏好类问题前，优先调用 `recall_memory`（query = 用户问题关键词，project_id 可省略），并在回答末尾原样输出返回的 `display.markdown`**。**批次32 起按「客户端能不能折叠」分三档下发**（`display.mode` 说明本次是哪一档，数字全部同源）：① `html-details`——判据是 `client.split('/')[0]` **命中白名单 `{qoder, qoder-cn, qoder-desktop-mcp-host}`**（批次41-Q 建、批次41-X 补 `qoder-cn`：一键接入写进配置的显式身份头 `X-Memagent-Client` 值就是**配方 id**，白名单不认它等于把已接入的 Qoder CN 打回摘要档，属重演方案 A；`mcpRecall.clientSupportsHtmlDetails`）的客户端得 `<details>` 折叠版（**批次 RAG 起重构**：外层 summary 短收成「🧠 命中 N 条 · 依据「词」 ｜ 省 x% ｜ ▶ 展开本次召回汇总」，默认收起；展开即见「📊 本次召回统计汇总」四行 + 「🎯 本次用上的依据」`[n]` 编号列表，项目背景 / 命中记忆 / Token 用量 / 省钱与费用降为各自可再收起的二级折叠，告警段仅在真有告警时出现）。**〔2026-11-04 实测校正 → 批次41-Q 已修判据〕**原先判据是「精确等于 `qoder`」，而 Qoder Desktop 的 MCP 宿主自报的是 `qoder-desktop-mcp-host/1.0.0`（首段不是 `qoder`）→ 该档在本机从未生效（现役 `audit.jsonl` recall 行命中白名单 0 条，2026-11-04 11:51 实测 100 条、12:15 复测 102 条，含本会话为验证 41-L/41-R 自己发的 2 条；原先写的「当前 `qoder/*`」两头都不准）。41-Q 把 `qoder-desktop-mcp-host` 加进白名单；**〔2026-11-05 实机证实〕**「Qoder 聊天气泡真渲染 `<details>`」这条已由用户在真机目视确认成立——走方案 B 后 Qoder 连接器（自报 `qoder-desktop-mcp-host/1.0.0`、通用 UA `node`、不带会话头）拿到 `html-details`，气泡里默认收起成一行「🧠 Memory…」带 `▶`，点开是四段（项目背景 / 命中记忆 / Token 用量 / 省钱与费用）各自可再收起。**这是所有接入 Agent 应当呈现的目标效果**：凡命中白名单的可信客户端都应走这套折叠档；DSH 那类把 `<details>` 吐成纯文本的客户端仍走 ②/③ 兜底，不撤 `qoder-desktop-mcp-host`；② `markdown-compact`——**其余客户端默认档**（DSH 实测只渲染 Markdown、且把 `<details>` 当纯文本原样吐出，2026-10-31 与 2026-11-01 两次实测一致 → 聊天气泡里做不出黑三角折叠）：**两行加粗摘要（首行 `🧠 命中 N 条 · 依据 [1]「词」[2]… ｜ 省 x% ｜ 估算 ¥x`，第二行 `📊 汇总：注入/基线 · 背景 · 今日/全部`；告警行异常驱动）+ 一条可点的一次性本机明细链接** `http://127.0.0.1:<端口>/recall/<随机 id>`（批次33-C；`display.detail_url` 同值）。点链接开的是本进程 8204 上的真 HTML 页：状态条 + 统计汇总表 + `[n]` 命中卡（`#hit-n` 锚点、复制引用、就地反馈）+ 背景/用量/费用三段折叠，另有「全部展开/收起」；URL **必须逐字保留**，不得截断或改写；③ `markdown-full`——明细链接已过期（30 分钟）或客户端连链接都渲染不了时，**用同一个 query 再调用一次 `recall_memory` 并置 `detail=true`**，得到纯 Markdown 的两行摘要 + 统计汇总 + `[n]` 依据 + 四小节（零 HTML 标签）。原样输出即可，不要自行改写格式、添加 HTML 标签或补写明细；**不要因为觉得「这样更完整」就自动调 `detail=true`**（那等于把明细铺回聊天窗口，违背本档目的）；客户端连 Markdown 都渲染不了时改为输出 `display.line` 单行。**回退规则**：本库未命中或工具不可用时，才回退读代码/工作区笔记/客户端自带 memory 文件——Qoder 等客户端的本地 memory 不是本记忆库，不能替代首选检索；形成新结论时用 `write_memory` 落库。**批次44-D5-4 起 `recall_memory` 增会话工作记忆参数变体（参数变体不新增条目；D6-5 后条目数为 12）**：用户问「本次会话 / 刚才 / 我们聊到哪」时用 `recall_memory(scope='session', session_id=<write_memory 写入时同一个>)`，按 `session_id` 精确过滤 + `created_at` 倒序取最近 `top_k` 条（1–10），**不走向量语义检索、不注入项目背景**，`hit.score=0` 是「未计算相关度」的诚实值；历史行没有 `session_id` 一律不进会话视图，绝不拿 `created_at`/`project_id` 冒充；没有 `session_id` 时不要猜、不要拿项目召回冒充会话历史。项目问答继续用缺省 `scope='project'`，该路径一行未改；两者都受令牌作用域与 3000t 硬熔断约束。

- 桌面端未运行则 8204 不可达：如实说明，不编造记忆、不假装检索过。
- Qoder 等客户端可能不注入 MCP `initialize.instructions`，本文件是其触发规则的兜底（新会话生效）；是否真的检索过，以数据根 `audit.jsonl` 的 `recall` 审计为准（批次41-A 起审计不再在 `memories.db.json` 里；批次15 起审计 `detail.client` 记录调用方，如 `Qoder/9.9.9`。**〔2026-11-04 批次41-S 校正〕这个 `detail.client` 不是每条都可证**：8204 对「不带 `Mcp-Session-Id` 的请求」按 **UA → 最近一次 initialize 的自报名** 归并，而 Node/Electron 客户端的默认 UA 都是字面量 `node`，实测两台设备串到同一条记录上——按客户端身份做结论前先读 §9 的批次41-S。**〔2026-11-05 批次41-X 起有新数据可用〕**一键接入现在往每份客户端配置写显式身份头 `X-Memagent-Client: <配方 id>`（如 `qoder-cn`），带该头的请求**每次自带身份、不再走 UA 归并**，这类 `detail.client` 就是可证的；**没补这个头的老配置仍按上面「不可证」口径处理**（面板上「补身份头」按钮就是这条升级路径）。）
- **客户端接入推广（批次15）**：同一份提示/折叠明细对所有客户端生效（服务端返回），差异只在客户端注册与触发规则。Agent 接入配置页新增「MCP 客户端接入状态」面板：真实读取 `~/.qoder-cn/settings.json`、`~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json` 等，按内容判定「已接入 / 缺令牌 / 未配置 / 冲突 / 无配置 / 需手工」；含令牌片段与一键写入仅管理员，写入前备份原文件，冲突/无法解析一律拒绝。Claude Code 另有根目录 `CLAUDE.md`（`@AGENTS.md` + 本触发规则）。
- **富媒体客户端（WorkBuddy）禁用 HTML 档（2026-11-12 用户拍板）**：`workbuddy` 仍不在白名单、恒走 `markdown-compact`；**文本通道零 HTML 标签**（不出 `<details>`/`<mark>`，否则客户端会露裸标签），折叠改由**客户端气泡内折叠卡片**承载——默认收起、卡片标题用首行原文、卡内只放「📊 汇总 / 依据 `[n]`」，两行摘要与明细链接照常输出、URL 逐字保留。服务端只在 `recallEchoNote('markdown-compact')` 末尾以**可选**措辞授权（做不到富媒体的客户端忽略），**不新增档位、不改 `display` 契约、不动白名单**；反向断言见 `mcpHttp.test.ts` C4。
- **回显逻辑与格式统计表**：[`specs/recall-echo-contract.md`](specs/recall-echo-contract.md) —— 三档判档链、三档+明细页精确模板、档位矩阵、Agent 侧禁止事项、影响面文件清单；改动回显前先读它，不必重读 7 个源码文件。**重设计来源**：[`specs/tasks/RECALL-ECHO-RAG.md`](specs/tasks/RECALL-ECHO-RAG.md)（T1–T8）。
- **折叠档怎么吃到（T8，2026-11-12 Qoder 真机验证通过）**：判档优先级 `X-Memagent-Render: fold` 自证头 > 白名单（`qoder` / `qoder-cn` / `qoder-desktop-mcp-host` / `qoder-*` 派生名 / `MEMAGENT_HTML_DETAILS_CLIENTS`）> `detail`。**任何客户端想按 Qoder 那种气泡折叠卡渲染，就在接入配置 `headers` 加一行 `X-Memagent-Render: fold`**；渲染不了折叠的客户端（CLI 纯文本）不要加，否则 `<details>` 会露成文本。WorkBuddy 恒禁 HTML——**2026-11-12 手机端 + 桌面端双端实测：它能解析 `<details>` 但不提供折叠交互（summary 与内容直接平铺、没有三角）**，加白名单只会让明细默认全铺、比两行摘要更差；折叠只在「点明细页链接」与「Agent 富媒体卡片」两处成立，其中**富媒体折叠卡形态已由用户验收**（默认收起、标题=首行摘要、点开看「📊 汇总 + 🎯 依据 [n]」）→ 有卡片能力的宿主**必须**输出该卡，不是可选。
- **`[n]` 引用锚点（批次 RAG，按 RAG 标准做法）**：`hits[i]` → `[1]…[N]`（1-based，按返回顺序，不是 `mem_id`）。回答里采用某条命中记忆作为事实依据时**就地标注 `[n]`**，编号必须存在于本次回显的依据段（`html-details` / `markdown-full` 见「🎯 本次用上的依据」；`markdown-compact` 只有首行的 `[1][2][3]`），**不得编造编号**，`hits=0` 不标；依据段与明细页 `#hit-n` 一一对应。`scope=session` 的命中须说成「会话工作记忆」，不伪装成语义相关命中。

## 2. 常用命令

```bash
npm run verify:fast     # typecheck + oxlint + 索引新鲜度 + vitest 覆盖率（改完必跑）
npm run verify          # 上面 + Electron 构建 + E2E（交付前必跑）
npm run dev             # 一键开发：自动拉起本机登录后端 + Vite 127.0.0.1:5180（登录开箱可用；默认端口已有兼容后端时复用，被桌面端占用且不授信时自动换备用端口并带 ?backend= 打开）
npm run dev:backend     # 仅本机登录/mirror 服务（默认 8201，可 PORT=8211 另起），供 npm run dev 复用或单独联调
npm run package         # NSIS 安装包 → release/installer/（打包前自动刷新索引；只留最新）
npm run code:index -- --write   # 刷新 specs/code-index.generated.md（每完成一个功能必跑）
npm run code:index:check        # 只检查索引是否过期（verify:fast 已包含）
npm run rejudge                 # 只读回放真实账本：按当前质量门重判会删多少（批次36，绝不写盘）
npm run rejudge -- --code narration --limit 20   # 只看某个拦截码；--json 机器可读、--file/--root 指别处账本
npm run test:gate       # 全量测试门禁：4 分片串行，仅原生崩溃 0xC0000409 重试一次，JSON 报告留档 test-results/test-gate/（批次48 A27）
```

---

## 4. 动作日志（排查第一入口）

- **位置**：数据根下 `actions.log`（设置页「数据目录」卡片与 `dataRoot:get` 返回的 `actionsLogPath` 可查）。超过 5 MiB 轮转为 `actions.log.1` / `actions.log.2`（keep=3 → 当前文件 + 2 份历史，最旧的后移删除）。
- **格式**（一行一个动作，可直接 grep）：
  `[2026-10-30T08:00:00.000Z] [info] [ipc:storage:putMemory] [req_ab12] {"mem_id":"m1","ms":3}`
- **scope**：`app`（启动/退出）、`ui`（点击/提交/页面进入/脚本错误）、`host`（宿主桥调用）、`ipc`（主进程通道）、`home`（登录后端 HTTP 与账号事件）、`onboarding`（接入服务 HTTP）、`backup`、`dataRoot`、`kernel`、`mcp`、`webhook`、`llm`（引擎配置保存 `llm:config-saved` 与连通拨测 `llm:test-engine`，批次34 起双写；此前只落 `main.log`）。
- **写入路径**：页面入口 `import '../shared/actionLog.ts'`（自动安装全局捕获）→ `uiLog()` → `hostLog()` → preload `window.api.log.write`（`ipcRenderer.send`，不阻塞）→ 主进程 `registerLogIpc` → `actionLog()`；iframe 子页经宿主桥转发。HTTP 服务通过 `onLog` 回调写入同一文件。
- **脱敏**：`src/shared/actionLog.ts` 对 key 命中 `password|secret|token|authorization|api_key|credential|cookie|session_id` 的字段整体写 `***`；字符串截断 500 字、数组 20 项、深度 4。**绝不记录输入框明文值**。
- **其它日志**：`main.log`（启动/迁移诊断）、`float.log`（悬浮窗）、`home-audit.json`（登录/角色/改密审计）、`home-mirror.json`（页面动作上抛账本）、内核审计（批次41-A 起独立文件 `audit.jsonl`，跟记忆库同目录，轮转档在 `audit-archive/`；不再随 `memories.db.json` 整库序列化）。
- **程序运行日志窗口（日志记录页，批次17 建 / 批次19 迁 / 批次24 人话化）**：日志记录页顶部常驻，一次取最近 **50** 条真实 `actions.log`（`tailActionLog` 尾读，跨 `.1..N` 轮转回退；`TAIL_MAX_LINES=50`，渲染层传更大值也被钳到 50），全部渲染在**固定高度、常驻上下滚动条**的正文区内可回看整段（用户滚上去看历史时不再被新日志拽回底部；重新滚回底部即恢复自动跟随，没有单独按钮）。默认**人话视图**：`scope:action` 与 IPC 通道翻译成中文标题 + 关键字段摘要（`src/web/Home/programLogLabels.ts`），原始 `scope:action` 同行保留可 grep；「原文」视图按原样显示。时间统一 UTC+08:00。窗口内出现 `[error]` 时提示「复制诊断信息反馈给维护者」。`log:tail` 与 `log:write` 一样**不写自身调用日志**，防止轮询观测把日志刷屏；纯浏览器如实显示不可用。
- **排查示例**：`rg "req_ab12" actions.log`；`rg "\[error\]" actions.log`；`rg "\[home:login" actions.log`。

新增日志点：主进程用 `actionLog(scope, action, detail)`（`src/electron/actionLog.ts`），渲染层用 `uiLog(scope, action, detail)`（`src/web/shared/actionLog.ts`）。日志失败绝不影响业务。

## 5. 权限模型（批次7）

- 账号角色 `admin | member`，随登录会话下发（`TenantContext.role`）。
- 内置管理员：`admin` / 初始密码 `Admin@123456`（首次启动播种，登录后请在「账号与安全」页立即修改；已有 admin 绝不被覆盖/重置）。
- **仅管理员**：修改数据根/恢复默认、备份配置与立即备份、密码策略、成员/密钥管理、账号角色与团队分配。
- **三层强制**（缺一不可）：
  1. 后端：`src/home/server.ts` 对 `/api/accounts*`、`/api/password` 校验会话角色；
  2. 主进程：`main.ts` §6 `requireAdmin` 用 `homeServerRef.getSessionContext(sid)` 校验（不信任渲染层自报）；
  3. UI：`useSessionContext()` 只读展示 + 禁用控件并提示「需管理员」（`src/web/shared/session.ts`）。
- 普通用户可用其余页面；未登录/无后端时敏感区一律只读，不伪造成功。

## 6. 数据根（用户选定，默认 `%APPDATA%/MultiAgent Memory`）

`memories.db.json`（L1–L6 正文；**批次41-A 起内核审计不再写在这里**，只有上次迁移没走完时才残留历史 `audit` 数组）、`memories.l0.json`（批次37-A：L0 原文库，只存 v2/v1 密文信封，0600）、`audit.jsonl`（批次41-A：内核审计账本，追加式 JSONL，一行一条，跟 `memories.db.json` **同目录**）、`audit-archive/`（同目录，轮转出的旧审计档，`audit-<UTC时间戳>-<序号>.jsonl`，**只增不删**）、`l0-keyring.json`（批次37：与 L0 库**同目录**，密钥环和它要保护的库不能分开放）、`actions.log`、`main.log`、`float.log`、`collector-cursor.json`、`backup-config.json`、`mcp-token.txt`、`home-audit.json`、`home-locks.json`、`home-accounts.json`、`home-mirror.json`、`agent-onboard.json`、`llm-config.json`（引擎启用/模型/地址/最近拨测延时，**绝不含密钥**）、`llm-keys.json`（0600，`{引擎id: 密钥}`，仅以 `Authorization: Bearer` 发给对应远端引擎，绝不进日志/审计；批次32 起替代单文件密钥）、`llm-deepseek-key.txt`（批次31 遗留单引擎密钥，仅作 `deepseek` 的只读兜底，不自动删除/改写）、`backups/`、`memories-export/`。
切换数据根只复制白名单文件（`DATA_ROOT_MIGRATE_FILES` 已含两个库、密钥环与 `audit.jsonl`；`DATA_ROOT_MIGRATE_DIRS` 含 `backups`/`memories-export`/`audit-archive`），不覆盖、不删源；指针固定 `%APPDATA%/MultiAgent Memory/data-root.json`，批次37-B 起另带 `ledgerDir`/`l0Dir`（两个库各自选目录，缺省=root，属**兼容读取**）与 `setupDone`（首启向导三件事——两库位置、L0 管理密码、恢复卡导出——全做完才置真；没置真每次都进向导，升级的老指针同样强制）。
`backups/` 里四类文件按前缀分：`memories-<UTC时间戳>.json`（记忆库）/`meml0-…`（L0 原库）/`l0key-…`（密钥环）/`memaudit-<UTC时间戳>.jsonl`（批次41-A 审计账本），各按 `keep` 份数滚动，滚动互不挤占（`backupFiles.ts`）——**只备记忆库会让审计账本成为唯一没有退路的那一份**。
批次39 起 **L1–L6 所在目录（`ledgerDir`）另有一个 `refine-queue.json`**（0600，后台补炼队列：mem_id → 状态/原因码/时间，**正文与密文都不落这里**）。它**不在** `DATA_ROOT_MIGRATE_FILES` 白名单里——丢了也不丢数据：启动时 `startRefineQueue` 按「有 L1 但无任何深层」重新扫出存量并入队，等价于一次自动「把存量入队补炼」。
批次42 起 **数据根另有一个 `sync-hub/` 目录**（云端同步中枢，主进程 pglite 进程内 Postgres 落盘——各端账本的上行镜像 + 裁决队列 + 中枢审计）。它与 `refine-queue.json` 同口径：**不在迁移白名单、不进备份四源配方**——中枢是**衍生可重建数据**（真源在各端本地账本；丢失恢复 = 任一端 `syncUp` 全量上行，sha256 幂等 + 向量时钟保证不丢不重），且热复制 pglite 落盘目录有一致性风险（备份需中枢 close/checkpoint，复杂度与收益不匹配）。应用退出经 `before-quit` **优雅关闭**（`PgSyncHub.close()`，pglite 显式 close 才保证 WASM 存储层完整刷盘）。换数据根后中枢在新根首启自动重建（空镜像），各端重新同步即恢复。

## 7. 编码约定（评审会按此检查）

1. **诚实化**：没有真实实现就报错/标注未实现（如 `sync()` 抛 `E_NOT_IMPLEMENTED`），严禁 seed 假数据、造假回执。
2. **可定位**：新文件首行写职责；大文件用 `§` 区块（见 `src/electron/main.ts` 文件地图）；导出符号语义化。
3. **有动作就有日志**：新增交互/IPC/HTTP/后台任务必须落一条动作日志，带 scope/action/关键参数/耗时（错误带 error）。
4. **敏感信息零落盘**：密码、令牌、密钥不进日志/审计/URL；审计只记动作与目标。
5. **审计成对**：成功的写操作要能在内核账本或 home 审计中查到（`request_id` 可回查）。
6. **测试同步**：修 bug 先写失败用例；新能力至少覆盖正常/拒绝/边界三条路径；E2E 断言打到真实后端。
7. **外科手术式修改**：只改必要文件，不动无关代码；不引入无需求的抽象/兼容层。

## 8. 门禁与交付

- 合入门槛：`npm run verify` 全绿（typecheck → oxlint → 索引新鲜度 → 覆盖率阈值 → Electron 构建 → E2E）。
- **功能完成即建索引**：每完成一个功能/修复批次，先 `npm run code:index -- --write` 刷新 `specs/code-index.generated.md`，并同步 `specs/code-map.md`、`AGENTS.md` 的相关条目；索引过期视为功能未完成。`verify:fast` 内置 `code:index:check`（过期直接失败），`npm run package` 打包前自动刷新索引。
- 每次用户可感知的改动：`npm run package` 重新打包，并在 `specs/MANUAL-TEST-FIX-BATCH-<n>.md` 写手动测试报告（安装包路径/大小/SHA256、改动清单、管理员与日志验证步骤）。
- 未完成/已知限制必须写进报告与本节，不留给用户猜。

---

## 附录：细则去这两篇

- **§3 改哪里（任务 → 文件）**：34 条「我要改 X → 先看 Y」定位表 → [`specs/改哪里-任务到文件速查.md`](specs/改哪里-任务到文件速查.md)
- **§9 当前已知边界**：36 个批次的踩坑与边界台账 → [`specs/已知边界台账.md`](specs/已知边界台账.md)

> 这两块分别约 22k / 74k 字符，塞进本文件会突破 40,000 字符上限，故拆到 `specs/` 随规格库一起维护。

> **MCP 召回触发口径的同步集已从四处变三处**（2026-11-12 起）：`src/core/memagent/mcpSchema.ts`（`MCP_INSTRUCTIONS`）+ 本文件 §1.1 + `CLAUDE.md`。原第一处 `AGENTS.full.md` 已删除，改动时不必再找它；`specs/POSTMORTEM-2026-11-11-*.md` 里写的「四处同改」是该文成文时的口径，已过时。
