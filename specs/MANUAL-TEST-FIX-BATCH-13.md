# 手动测试报告 · 修复批次 13（提示行可折叠明细）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（121,959,798 B = **116.31 MiB**）
- SHA256：`745de8ceee33754957b2d3fde34d7ea63a9a553e31d338858c46f637a635fac9`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B；目录合计 375,283,973 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-12.md`（触发与回显加固）、`specs/MANUAL-TEST-FIX-BATCH-11.md`（提示行主体）
- 通用手测入口：`specs/MANUAL-TEST.md`

> **本批次无数据模型/审计字段变更，可直接覆盖安装**。只新增 `display.markdown`（结果块与 `structuredContent`）并调整指令/工具描述；旧版本忽略该字段即可。

## 0. 审计核验：Qoder 的召回是否真实可用

用户要求「查看审计看是否真实可用」。直接查数据根 `memories.db.json` 的 `audit` 数组（`action="recall"`），结论：**真实可用**。

| 时间（UTC） | request_id | 查询 | 命中 | 注入 | 省量 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-30T15:14:22.119Z | `req_01M66P0K9A1NC1B9D76CX43VAC` | `L0 生成 L1 入库逻辑 质量门 checkL0ToL…`（Qoder 侧提问） | 5 条（753t） | 1,051t（+背景 298t） | 2,869,100t（全量 2,870,151t） |
| 2026-10-30T15:28:05.065Z | `req_01M66PSQ24MPGE7R8H3YK89469` | 同关键词（本批次打包后的 8204 实机探针） | 5 条（753t） | 1,051t | 2,869,100t |

- 15:14 这条与用户截图中的提示行数字完全一致（753t 命中 + 298t 背景 = 1,051t 注入），说明 Qoder 聊天窗口里看到的命中/背景/省量均来自真实召回，不是模型编造。
- 审计同时记录 `scanned_memories=1641`、`bg_mems`、`mems`、`budget_trimmed_tokens=0` 与 `corpus_tokens=2870151`，可按 `request_id` 回查。
- 当日（本地 10-30）累计 7 次 `recall` 审计；其中 14:45 一条为批次11 之前的旧记录（无 `injected_tokens/saved_tokens`），提示行会按其规则追加「旧记录」告警。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 13-A 四段折叠明细 | 新增 `buildRecallMarkdown`：外层 `<details>`（`<summary>` = 提示行）+ 内层四段各自可收起/展开——`📎 项目背景` / `🧠 命中记忆` / `⚡ Token 用量` / `💰 省钱与费用`；记忆内容 HTML 转义（`& < >`）、空白折叠、单条 ≤120 字 | `src/core/memagent/recallInsight.ts` |
| 13-A 数据同源 | `display` 增加 `markdown` 字段，与 `display.line`、`money`、`rollup` 由**同一次 recall + 同一份 recall 审计累计**生成 | `src/core/memagent/mcpRecall.ts` |
| 13-A 传输下发 | `tools/call` 内容块由 3 块变 4 块：`[display.line, 完整 JSON, display.markdown, RECALL_ECHO_NOTE]`；TCP 8202 经共用 payload 同步携带 `display.markdown` | `src/core/memagent/mcpHttp.ts`、`mcpRecall.ts` |
| 13-A 回显策略 | `MCP_INSTRUCTIONS` 规则 2 与 `recall_memory` 工具描述改为「优先原样输出 display.markdown；客户端不渲染 HTML 时回退 display.line」；末块 `RECALL_ECHO_NOTE` 同步改写 | `src/core/memagent/mcpSchema.ts`、`mcpHttp.ts` |
| 13-A 客户端兜底 | `AGENTS.md §1.1` 改为「回答末尾原样输出 display.markdown，HTML 不渲染时回退 display.line」 | `AGENTS.md` |
| 测试 | `recallInsight.test.ts` 新增 `buildRecallMarkdown` 5 组用例（5 对 `<details>`、summary=提示行、转义、120 字截断/空白折叠、空命中、金额 null/¥10 分支、旧记录告警）；`mcpHttp.test.ts` 断言内容块 4、`content[2] === display.markdown`；`mcp.test.ts`（TCP）同步断言 | `src/core/memagent/__tests__/*.test.ts` |
| 文档 | 需求规格书 §19.12 增「折叠明细（批次13）」并更新触发契约/代码落点/测试；`specs/code-map.md` 新增批次13 区块；`AGENTS.md §9` 更新为批次11/12/13；`specs/MANUAL-TEST.md` 索引改为 1..13 | `specs/*.md`、`AGENTS.md` |

### 关键设计（为什么这样改）

- **四段独立折叠**：外层 summary 始终显示提示行（不展开也能看到关键数字），展开后四段各自可再收起——用户可只关心「省了多少钱」或「命中了哪几条」，不必滚一大段 JSON。
- **数字只算一次**：`buildRecallMarkdown(result, hint, price)` 直接消费 `buildRecallHint` 的结果，summary 与四段明细共用同一 `savings/rollup/money`，不可能出现「提示行说省 1,051t、明细说省别的」。
- **内容安全**：记忆正文可能含 `<script>`、`&` 等字符；`mdInline` 统一转义并折叠空白、截断到 120 字，既避免破坏 `<details>` 结构，也避免聊天窗口执行/展示异常 HTML。
- **保留纯文本退路**：`content[0]` 仍是纯提示行；`RECALL_ECHO_NOTE` 明示「不渲染 HTML 时输出 display.line」。客户端只要支持 Markdown/HTML 任一种，用户都能看到提示。
- **诚实边界不变**：token 仍是 `ceil(字符数/2)` 估算；单价未设置时明细同样写「金额未开」，不出现任何默认价格。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程 + Electron 类型检查 | `npm run typecheck` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning**（408 文件 / 123 规则 / 77ms） |
| 单元/集成测试 | `npm run test:coverage` | **103 文件 / 1034 用例全过** |
| 覆盖率 | 同上 | 语句 75.37%（7192/9542）、分支 66.57%（4669/7013）、函数 70.71%（1719/2431）、行 78.31%（6266/8001）；阈值 71/61/67/74，通过 |
| 正式打包 | `npm run package` | 退出码 0（vite + esbuild + electron-builder NSIS） |
| 真浏览器 E2E | `npm run test:e2e` | **93 用例全过（32.7s）** |
| 代码索引 | `npm run code:index -- --write` | 262 文件（新增导出 `buildRecallMarkdown`） |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` | 121,959,798 B = **116.31 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer/win-unpacked/MultiAgent Memory.exe` | 249,934,848 B（目录合计 375,283,973 B） |
| 增量块映射 | `release/installer/MultiAgent Memory-0.1.0-setup.exe.blockmap` | 随包生成 |

安装包未配置代码签名（沿用既有构建配置，Windows 可能提示「未知发布者」，选择「仍要运行」）。

## 4. 手动测试步骤（Qoder CN）

### 4.1 准备

1. 覆盖安装本批次安装包（或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`）并确认程序在运行——MCP HTTP 8204 由桌面端托管，关闭即不可达。
2. 确认 Qoder 设置中 `MultiAgent Memory` 服务器仍在（`C:/Users/<用户>/.qoder-cn/settings.json` → `mcpServers`，URL `http://127.0.0.1:8204/mcp`，Authorization 取自数据根 `mcp-token.txt`；**不要把令牌粘到聊天/截图**）。
3. **新开一个 Qoder 会话**（MCP 工具描述与工作区 `AGENTS.md` 均按会话加载；旧会话看不到本批次改动；桌面端重启后旧连接也会失效）。

### 4.2 折叠明细（本批次核心）

1. 在 Qoder 聊天窗口提问：「你还记得 L0 生成 L1 的入库逻辑吗？」（或其他项目关键词）。
2. **预期**：Qoder 先调用 `recall_memory`，回答末尾出现一个可折叠块，收起时只显示一行：
   `🧠 Memory ｜ 命中 N 条（Xt） ｜ 📎 背景 N 条（Xt） ｜ ⚡ 本次省 Xt（全量约 Xt） ｜ 💰 金额未开：未设置单价（全局参数页可设 ¥/百万 token）`
3. 点开外层后应看到**四段各自可折叠的明细**：
   - `📎 项目背景 N 条（Xt）`：每条 `[category] 摘要`（≤120 字）；
   - `🧠 命中记忆 N 条（Xt）`：每条 `[L1/hot] 摘要（相关度 0.xx）`；
   - `⚡ Token 用量（本次注入 Xt）`：本次注入（命中+背景）、全量基线、预算裁剪与软/告警/硬阈值、扫描条数；
   - `💰 省钱与费用（本次省 Xt）`：未设单价时给 token 省量与「金额未开」；设单价后给本次/今日/全部金额与单价。
4. 每段标题行点击应能**单独**收起/展开，互不影响。
5. **若 Qoder 把 `<details>` 显示成源码而不是折叠块**：说明该客户端不渲染 HTML，模型应回退输出单行提示行（见 4.3）；把截图/现象记录下来即可，不影响数据正确性。

### 4.3 回退（纯文本客户端）

1. 若聊天窗口只出现一行 `🧠 Memory ｜ …`，那就是设计内的回退形态（`content[0]` 纯提示行），可用且数字完整。
2. 需要明细时，客户端需支持 Markdown/HTML 折叠；不支持时请看 4.4 的命令行核验。

### 4.4 命令行核验（可选）

用令牌调用 8204 `tools/call`（`recall_memory`）应看到 `result.content` 有 **4** 块：

1. 纯提示行（全等于 `structuredContent.display.line`）；
2. 完整 JSON（含 `saved_tokens` 等）；
3. 折叠明细（全等于 `structuredContent.display.markdown`；含 1 个外层 + 4 个内层 `<details>`，共 5 对）；
4. `【展示要求】…优先输出 display.markdown…不渲染 HTML 时输出 display.line…`。

本轮实机探针（重启后的 `win-unpacked`，2026-10-30T15:28:05Z，`req_01M66PSQ24MPGE7R8H3YK89469`）输出：

```
initialize 200 has_markdown_rule= true has_line_fallback= true
recall 200 isError= false blocks= 4
block0 == display.line: true
block2 == display.markdown: true
details_pairs: 5 / 5
line: 🧠 Memory ｜ 命中 5 条（753t） ｜ 📎 背景 5 条（298t） ｜ ⚡ 本次省 2,869,100t（全量约 2,870,151t） ｜ 💰 金额未开：未设置单价…
money: null | rollup: today 7 次，全部 7 次（含 1 条旧记录）
```

### 4.5 金额分支

1. 「全局参数」页 → 普通配置 → 「成本单价」填 `10` → 保存。
2. 再提问：明细「💰 省钱与费用」段应出现 `本次：花费 ¥…（省 ¥…）`、`今日：N 次…`、`全部：N 次…`、`单价：¥10/百万 token`，且 `全部 ≥ 今日 ≥ 本次`。
3. 清空单价保存 → 再提问：恢复「金额未开」，明细不再出现 ¥ 金额。
4. 输入 `-1` → 保存被拦截（「成本单价不可为负」）。

### 4.6 客观核验（不看模型自称）

打开数据根 `memories.db.json`，在 `audit` 数组中找 `action="recall"` 的最新记录：应有与新一次提问对应的 `request_id`、`query`、`hits`、`injected_tokens`、`saved_tokens`；数字应与提示行/明细一致。没有这条审计 = 工具未被调用，折叠块不可能出现。

### 4.7 安全与回归

1. 错误令牌 → `401`；带 `Origin` 头 → `403 origin_not_allowed`。
2. 审计/`actions.log` 不得出现令牌明文；折叠明细只含截断后的记忆摘要，不含密钥。
3. 其余页面（首页/记忆库/审计/参数/安全等）E2E 已回归通过，安装后可抽查 1–2 页。

## 5. 已知限制（不应作为缺陷）

- **折叠依赖客户端渲染 HTML**：`<details>/<summary>` 是标准 HTML；Qoder 基于 VS Code，预期支持渲染，但本报告未替用户确认其 UI 行为——若不渲染，按设计回退单行 `display.line`。是否折叠不影响账本与数字。
- **明细是截断摘要**：每条记忆最多 120 字、空白折叠；完整命中正文以 `structuredContent.hits` 为准（模型仍可据此作答）。
- **触发/回显仍是概率性**：MCP 无法强制客户端调用工具或强制模型照抄提示；约束放在工具描述、结果末块、`AGENTS.md §1.1` 三处。若未出现提示，用 4.6 审计核验并在提示词里点名工具。
- **`AGENTS.md` 按会话加载**：修改后需新会话生效。
- **token 是估算**：`ceil(字符数/2)`，与真实 tokenizer 有偏差；金额是按用户单价折算的参考值，不是厂商账单。
- **旧审计不算省量**：批次11 之前的 `recall` 审计无 `injected_tokens/saved_tokens`，只计调用次数并在设单价后追加「旧记录」告警。
- **令牌是静态文件**：`mcp-token.txt` 轮换后需同步更新 Qoder 设置，否则 `401`。

## 6. 回滚与数据说明

- 覆盖安装批次12 安装包即可回滚；本批次只新增 `display.markdown` 并改指令/描述，旧版本忽略该字段。
- 提示行与折叠明细只是展示层行为，不影响账本、审计与召回结果。
- 测试产生的 `recall` 审计会计入「今日/全部」累计；需要干净累计时请先备份数据根或使用独立数据根。
