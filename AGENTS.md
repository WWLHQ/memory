> **本文件为精简索引。** 原文件共 109113 字符（2026-11-12 复核），超过 WorkBuddy 的 40,000 字符上限，会被整份跳过加载，导致规则一条都不生效。
> 完整原文已原样保存在 [`AGENTS.full.md`](AGENTS.full.md)，查阅任何细节请打开该文件。
> 回滚：把 `AGENTS.full.md` 复制回 `AGENTS.md` 即可。

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

桌面端在 `127.0.0.1:8204/mcp` 暴露标准 MCP 服务 `multiagent_memory`（批次46-D6-5 后共 **12 个工具**：`recall_memory` / `write_memory` / `list_projects` / `get_preferences` / `get_write_status` / `list_memories` / `get_memory` / `feedback` / `manage_memory` / `gc_report` / `create_project` / `mint_token`；`gc_report` 缺省 `dry_run=true` 只演算不改库；`create_project`/`mint_token` 为**管理员专属**——`mint_token` 明文令牌只在结果出现一次须原样转交用户，非 admin 调用一律被明确拒绝）。**接入 Agent 回答本仓库实现、架构、历史决策、踩坑、偏好类问题前，优先调用 `recall_memory`（query = 用户问题关键词，project_id 可省略），并在回答末尾原样输出返回的 `display.markdown`**。**批次32 起按「客户端能不能折叠」分三档下发**（`display.mode` 说明本次是哪一档，数字全部同源）：① `html-details`——判据是 `client.split('/')[0]` **命中白名单 `{qoder, qoder-cn, qoder-desktop-mcp-host}`**（批次41-Q 建、批次41-X 补 `qoder-cn`：一键接入写进配置的显式身份头 `X-Memagent-Client` 值就是**配方 id**，白名单不认它等于把已接入的 Qoder CN 打回摘要档，属重演方案 A；`mcpRecall.clientSupportsHtmlDetails`）的客户端得 `<details>` 折叠版（summary = 🧠 Memory 提示行，内层四段：项目背景 / 命中记忆 / Token 用量 / 省钱与费用，点击展开）。**〔2026-11-04 实测校正 → 批次41-Q 已修判据〕**原先判据是「精确等于 `qoder`」，而 Qoder Desktop 的 MCP 宿主自报的是 `qoder-desktop-mcp-host/1.0.0`（首段不是 `qoder`）→ 该档在本机从未生效（现役 `audit.jsonl` recall 行命中白名单 0 条，2026-11-04 11:51 实测 100 条、12:15 复测 102 条，含本会话为验证 41-L/41-R 自己发的 2 条；原先写的「当前 `qoder/*`」两头都不准）。41-Q 把 `qoder-desktop-mcp-host` 加进白名单；**〔2026-11-05 实机证实〕**「Qoder 聊天气泡真渲染 `<details>`」这条已由用户在真机目视确认成立——走方案 B 后 Qoder 连接器（自报 `qoder-desktop-mcp-host/1.0.0`、通用 UA `node`、不带会话头）拿到 `html-details`，气泡里默认收起成一行「🧠 Memory…」带 `▶`，点开是四段（项目背景 / 命中记忆 / Token 用量 / 省钱与费用）各自可再收起。**这是所有接入 Agent 应当呈现的目标效果**：凡命中白名单的可信客户端都应走这套折叠档；DSH 那类把 `<details>` 吐成纯文本的客户端仍走 ②/③ 兜底，不撤 `qoder-desktop-mcp-host`；② `markdown-compact`——**其余客户端默认档**（DSH 实测只渲染 Markdown、且把 `<details>` 当纯文本原样吐出，2026-10-31 与 2026-11-01 两次实测一致 → 聊天气泡里做不出黑三角折叠）：**两行加粗摘要 + 一条可点的一次性本机明细链接** `http://127.0.0.1:<端口>/recall/<随机 id>`（批次33-C；`display.detail_url` 同值）。点链接开的是本进程 8204 上的真 HTML 页，四段明细在那里用真 `<details>` 折叠，另有「全部展开/收起」；URL **必须逐字保留**，不得截断或改写；③ `markdown-full`——明细链接已过期（30 分钟）或客户端连链接都渲染不了时，**用同一个 query 再调用一次 `recall_memory` 并置 `detail=true`**，得到纯 Markdown 四小节（零 HTML 标签）。原样输出即可，不要自行改写格式、添加 HTML 标签或补写明细；**不要因为觉得「这样更完整」就自动调 `detail=true`**（那等于把明细铺回聊天窗口，违背本档目的）；客户端连 Markdown 都渲染不了时改为输出 `display.line` 单行。**回退规则**：本库未命中或工具不可用时，才回退读代码/工作区笔记/客户端自带 memory 文件——Qoder 等客户端的本地 memory 不是本记忆库，不能替代首选检索；形成新结论时用 `write_memory` 落库。**批次44-D5-4 起 `recall_memory` 增会话工作记忆参数变体（参数变体不新增条目；D6-5 后条目数为 12）**：用户问「本次会话 / 刚才 / 我们聊到哪」时用 `recall_memory(scope='session', session_id=<write_memory 写入时同一个>)`，按 `session_id` 精确过滤 + `created_at` 倒序取最近 `top_k` 条（1–10），**不走向量语义检索、不注入项目背景**，`hit.score=0` 是「未计算相关度」的诚实值；历史行没有 `session_id` 一律不进会话视图，绝不拿 `created_at`/`project_id` 冒充；没有 `session_id` 时不要猜、不要拿项目召回冒充会话历史。项目问答继续用缺省 `scope='project'`，该路径一行未改；两者都受令牌作用域与 3000t 硬熔断约束。

- 桌面端未运行则 8204 不可达：如实说明，不编造记忆、不假装检索过。
- Qoder 等客户端可能不注入 MCP `initialize.instructions`，本文件是其触发规则的兜底（新会话生效）；是否真的检索过，以数据根 `audit.jsonl` 的 `recall` 审计为准（批次41-A 起审计不再在 `memories.db.json` 里；批次15 起审计 `detail.client` 记录调用方，如 `Qoder/9.9.9`。**〔2026-11-04 批次41-S 校正〕这个 `detail.client` 不是每条都可证**：8204 对「不带 `Mcp-Session-Id` 的请求」按 **UA → 最近一次 initialize 的自报名** 归并，而 Node/Electron 客户端的默认 UA 都是字面量 `node`，实测两台设备串到同一条记录上——按客户端身份做结论前先读 §9 的批次41-S。**〔2026-11-05 批次41-X 起有新数据可用〕**一键接入现在往每份客户端配置写显式身份头 `X-Memagent-Client: <配方 id>`（如 `qoder-cn`），带该头的请求**每次自带身份、不再走 UA 归并**，这类 `detail.client` 就是可证的；**没补这个头的老配置仍按上面「不可证」口径处理**（面板上「补身份头」按钮就是这条升级路径）。）
- **客户端接入推广（批次15）**：同一份提示/折叠明细对所有客户端生效（服务端返回），差异只在客户端注册与触发规则。Agent 接入配置页新增「MCP 客户端接入状态」面板：真实读取 `~/.qoder-cn/settings.json`、`~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json` 等，按内容判定「已接入 / 缺令牌 / 未配置 / 冲突 / 无配置 / 需手工」；含令牌片段与一键写入仅管理员，写入前备份原文件，冲突/无法解析一律拒绝。Claude Code 另有根目录 `CLAUDE.md`（`@AGENTS.md` + 本触发规则）。

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

## 完整章节索引（正文见 AGENTS.full.md）

- ## 0. 开发纪律：三道闸门（2026-11-05 起强制）
- ## 1. 项目是什么
- ## 2. 常用命令
- ## 3. 改哪里（任务 → 文件）
- ## 4. 动作日志（排查第一入口）
- ## 5. 权限模型（批次7）
- ## 6. 数据根（用户选定，默认 `%APPDATA%/MultiAgent Memory`）
- ## 7. 编码约定（评审会按此检查）
- ## 8. 门禁与交付
- ## 9. 当前已知边界

> 需要上面任一章节的完整内容时，请读取 `AGENTS.full.md` 并定位对应标题。
