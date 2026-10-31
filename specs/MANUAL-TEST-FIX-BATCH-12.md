---
status: done
---

# 手动测试报告 · 修复批次 12（MCP 触发与提示行回显加固）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（121,959,000 B = **116.31 MiB**）
- SHA256：`326e5609ad60b080a7812751e2a4fe5aa6dc275fbde636d2b8b871eb27fb8411`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-11.md`（批次11 主体功能）
- 通用手测入口：`specs/MANUAL-TEST.md`

> **本批次无数据模型变更，可直接覆盖安装**：只改指令文本、工具描述、HTTP 工具结果的 content 块与仓库 `AGENTS.md`，不新增/修改审计字段与账本结构。

## 0. 触发本批次的现象（用户实测）

用户在 Qoder CN 聊天窗口提问「你还记得入库逻辑即 L0 生成 L1 的逻辑吗？」。现象与证据：

- Qoder 侧 MCP 服务器已登记且 `status=ready`，本会话工具目录也出现了 `mcp__multiagent_memory__*`（4 个工具），HTTP 8204 `initialize`/`tools/list`/`tools/call` 均正常；
- 但该轮回答是**读代码**得出的（引用了 `src/core/memagent/memories.ts` 等），**没有调用 `recall_memory`**；
- 证据：数据根 `memories.db.json` 的 `audit` 数组中，该时段**没有任何 `recall` 审计**（只有开发侧探针的 3 条），因此提示行不可能出现；
- 直接原因：Qoder 未把 MCP `initialize.instructions` 注入模型（MCP 规范中 instructions 是建议性的），仅靠指令下发无法保证触发；原指令第 5 条「不要向用户展示内部 token」与第 2 条「原样回显含 token 的 display.line」还存在语义冲突。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 12-A 工具描述强制触发 | `recall_memory` 描述改为「回答本项目相关问题（实现、架构、历史决定、踩过的坑、用户偏好）之前应先调用本工具，不要只读代码或凭印象作答」+「调用后必须在回答最后一行原样输出 display.line」 | `src/core/memagent/mcpSchema.ts` |
| 12-A 指令去歧义 | `MCP_INSTRUCTIONS`：触发升级为「默认动作」；回显升级为「强制、最后一行、单独一行」；第 5 条由「不要展示内部 token」改为「不要展示 MCP 认证令牌（Authorization 头 / mcp-token.txt）」，并明示提示行中的 token 数字/金额**必须保留** | `src/core/memagent/mcpSchema.ts` |
| 12-A 结果末块回显约束 | recall 的 `tools/call` 结果由 2 块变 3 块：`[提示行, 完整 JSON, RECALL_ECHO_NOTE]`；末块在模型读完大 JSON 后再要求一次「最后一行原样回显」 | `src/core/memagent/mcpHttp.ts` |
| 12-A 客户端兜底触发 | `AGENTS.md §1.1`：接入 Agent 回答本仓库实现/架构/历史决策/踩坑/偏好类问题前先调 `recall_memory`，最后一行回显 `display.line`；工具不可用如实说明；是否真的检索以 `recall` 审计为准（Qoder 会加载工作区 AGENTS.md） | `AGENTS.md` |
| 测试 | `mcpHttp.test.ts`：recall 结果 `content` 长度 3、`content[2]` 含 `🧠 Memory` 与 `最后一行` | `src/core/memagent/__tests__/mcpHttp.test.ts` |
| 文档 | 需求规格书 §19.12 增「触发可靠性（批次12）」并更新诚实边界/代码落点；`specs/code-map.md` 新增批次12 区块；`AGENTS.md §9` 更新为批次11/12 边界；`specs/MANUAL-TEST.md` 索引改为 1..12 | `specs/*.md`、`AGENTS.md` |

### 关键设计（为什么这样改）

- **不伪装「一定能触发」**：MCP 没有强制客户端调用工具的能力；能在服务端做的只有三件事——把触发条件写进模型必读的工具描述、把回显要求放进工具结果的最后一块、把工作区规则写进客户端会加载的 `AGENTS.md`。因此本批次把同一约束重复三处，提高概率而非承诺必然。
- **回显要求放末块而非首块**：`content[0]` 保持纯提示行（客户端可直接展示，测试也断言其与 `display.line` 全等）；指令放最后，避免被大 JSON 冲淡。
- **修掉指令自相矛盾**：原第 5 条「不要向用户展示内部 token」中的 token 指认证令牌，但字面与「回显含 token 数字的提示行」冲突；改为明确限定 Authorization / mcp-token.txt。
- **核验口径不看模型自称**：是否真的检索过，一律查 `memories.db.json` 的 `recall` 审计（`request_id`/`query`/`hits`/`saved_tokens`）。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程 + Electron 类型检查 | `npm run typecheck` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning**（408 文件 / 123 规则 / 87ms） |
| 单元/集成测试 | `npm run test:coverage` | **103 文件 / 1029 用例全过** |
| 覆盖率 | 同上 | 语句 75.29%（7164/9514）、分支 66.52%（4656/6999）、函数 70.65%（1714/2426）、行 78.23%（6238/7973）；阈值 71/61/67/74，通过 |
| 正式打包 | `npm run package` | 退出码 0（vite + esbuild + electron-builder NSIS） |
| 真浏览器 E2E | `npm run test:e2e` | **93 用例全过（32.4s）** |
| 代码索引 | `npm run code:index -- --write` | 262 文件（新增导出 `RECALL_ECHO_NOTE`） |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` | 121,959,000 B = **116.31 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer/win-unpacked/MultiAgent Memory.exe` | 249,934,848 B |
| 增量块映射 | `release/installer/MultiAgent Memory-0.1.0-setup.exe.blockmap` | 随包生成 |

安装包未配置代码签名（沿用既有构建配置，Windows 可能提示「未知发布者」，选择「仍要运行」）。

## 4. 手动测试步骤（Qoder CN）

### 4.1 准备

1. 覆盖安装本批次安装包（或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`），确认程序在运行——MCP HTTP 8204 由桌面端托管，关闭即不可达。
2. 确认 Qoder 设置中已有 `MultiAgent Memory` 服务器：`C:/Users/<用户>/.qoder-cn/settings.json` → `mcpServers`，形如
   ```json
   "MultiAgent Memory": { "type": "http", "url": "http://127.0.0.1:8204/mcp", "headers": { "Authorization": "Bearer <mcp-token.txt 内容>" } }
   ```
   令牌取自数据根（默认 `%APPDATA%\MultiAgent Memory`）的 `mcp-token.txt`；**不要**把令牌粘到聊天/截图/日志。
3. **新开一个 Qoder 会话**（MCP 工具与工作区 `AGENTS.md` 都按会话加载；旧会话看不到本批次改动）。

### 4.2 触发与回显（本批次核心）

1. 在 Qoder 聊天窗口提问：「你还记得 L0 生成 L1 的入库逻辑吗？」
2. **预期**：Qoder 先执行 `multiagent_memory` 的 `recall_memory`（展开「执行工具」可见参数 `query`），随后回答；回答**最后一行**为：
   `🧠 Memory ｜ 命中 N 条（Xt） ｜ 📎 背景 N 条（Xt） ｜ ⚡ 本次省 Xt（全量约 Xt） ｜ 💰 金额未开：未设置单价（全局参数页可设 ¥/百万 token）`
3. 若仍未见工具调用（仅读代码）：换新会话再试；或直接说「调用 multiagent_memory 的 recall_memory 检索『L0 生成 L1』」。
4. **客观核验（不看模型自称）**：打开数据根 `memories.db.json`，在 `audit` 数组中找 `action="recall"` 的最新记录——应有与提问时间对应的 `request_id`、`query`、`hits`、`injected_tokens`、`saved_tokens`。没有这条审计 = 工具没被调用，提示行不可能出现。

### 4.3 金额提示

1. 「全局参数」页 → 普通配置 → 「成本单价」填 `10`（¥/百万 token）→ 保存。
2. 重复 4.2 提问。**预期**：提示行变为
   `💰 本次 ¥…（省 ¥…） ｜ 今日 N 次 ¥…（省 ¥…） ｜ 全部 N 次 ¥…（省 ¥…）`
   且 `全部 N 次 ≥ 今日 N 次 ≥ 本次（含本次调用）`。
3. 清空单价保存 → 再提问：恢复「金额未开」。
4. 输入 `-1` → 保存被拦截（「成本单价不可为负」）。

### 4.4 工具结果结构回归（可选，命令行）

用令牌调用 8204 的 `tools/call`（`recall_memory`）应看到 `result.content` 有 **3** 块：
1. 纯提示行（等于 `structuredContent.display.line`）；
2. 完整 JSON（含 `saved_tokens` 等）；
3. `【展示要求】…最后一行…原样输出…🧠 Memory…`。

### 4.5 安全与回归

1. 错误令牌 → `401`；带 `Origin` 头 → `403 origin_not_allowed`。
2. 审计/`actions.log` 不得出现令牌明文。
3. 其余页面（首页/记忆库/审计/参数/安全等）E2E 已回归通过，安装后可抽查 1–2 页。

## 5. 已知限制（不应作为缺陷）

- **触发/回显仍是概率性**：MCP 无法强制客户端调用工具或强制模型照抄提示；本批次只是把约束放到模型必读的三处（工具描述、结果末块、`AGENTS.md`）。Qoder 若仍不调用，以 4.2 第 4 步的审计为准，并可在提示词里显式点名工具。
- **`AGENTS.md` 按会话加载**：修改后需新会话生效；不读工作区规则的客户端不受其约束。
- **客户端兼容性**：展示/折叠工具结果的 UI 各不相同；`structuredContent` 始终携带完整数据，便于客户端自行渲染。
- **token 是估算**：`ceil(字符数/2)`，与真实 tokenizer 有偏差；金额是按用户单价折算的参考值，不是厂商账单。
- **旧审计不算省量**：批次11 之前的 `recall` 审计无 `injected_tokens/saved_tokens`，只计调用次数并在设单价后追加「今日含 K 次旧记录」。
- **令牌是静态文件**：`mcp-token.txt` 轮换后需同步更新 Qoder 设置，否则 `401`。

## 6. 回滚与数据说明

- 覆盖安装批次11 安装包即可回滚；本批次未改账本结构，旧版本忽略新增的指令文本/结果末块。
- 提示行回显只是展示层行为，不影响账本、审计与召回结果。
- 测试产生的 `recall` 审计会计入「今日/全部」累计；需要干净累计时请先备份数据根或使用独立数据根。
