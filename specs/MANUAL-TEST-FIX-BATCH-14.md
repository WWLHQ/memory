# 手动测试报告 · 修复批次 14（触发措辞改为「优先」，保留回退）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（121,959,940 B = **116.31 MiB**）
- SHA256：`2b4bc184c8c51387584cd0c8de255c27b453a4b9ef5170abe4c1f17dfd759485`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B；目录合计 375,284,441 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-13.md`（折叠明细）、`specs/MANUAL-TEST-FIX-BATCH-12.md`（触发与回显加固）
- 通用手测入口：`specs/MANUAL-TEST.md`

> **本批次无数据模型/审计字段变更，可直接覆盖安装**。只改指令/工具描述/`AGENTS.md` 的触发措辞，并把「硬禁用本地检索」改为「优先用本库、未命中/不可用再回退」。

> **时间口径（本报告起统一）**：一律使用本机时间（UTC+08:00）。账本审计 `ts` 是 epoch 毫秒，界面与本节显示的本地时间即其换算结果；为便于核对，必要时在括号内附 UTC（`…Z`）。上一轮回复把审计时间按 UTC 说成 `15:28`，与聊天窗口的 `23:28` 是同一时刻，属于时间口径混用，本批次修正表述习惯。

## 0. 触发本批次的现象（2026-10-30 23:31 那一轮）

用户在 Qoder 提问「你还记得 L0 生成 L1 的入库逻辑吗？」（23:31:02），结果**没有**出现 🧠 Memory 提示。核对会话记录与账本：

| 本地时间 | 事件 | 证据 |
| --- | --- | --- |
| 23:27:42 | 桌面端批次13 新包启动 | 进程启动时间；8204 正在监听 |
| 23:28:05 | 批次13 实机探针召回 | 审计 `req_01M66PSQ24MPGE7R8H3YK89469`（hits=5，注入 1,051t） |
| 23:31:02 | Qoder 会话开始提问 | 会话记录 `6e315549-…jsonl` |
| 23:31:10–23:31:31 | 该轮 7 次工具调用全部是 `Read`/`Grep`，**无任何 MCP 调用** | 会话记录：读了 Qoder 自带 `~/.qoder-cn/projects/.../memory/layer-rules-hardcoding.md`、`layerRules.ts`、`memories.ts`、`coreWrite.ts`、`qualityGate.ts` |
| 23:31 之后 | 账本 **无** 新增 `recall` 审计 | `memories.db.json` 最新一条仍是 23:28:05 |

结论：8204 与工具都正常（该会话的 MCP 清单里 `multiagent_memory` 4 个工具俱全），是模型这一轮把「项目记忆库」理解成 Qoder 自带 memory 文件 + 代码，没有调用 `recall_memory`。提示行按设计只在真实召回后出现，因此这一轮本来就不会有。

## 1. 本轮改了什么

按用户要求「尽量不禁用，改为优先使用我们的」：

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 14-A 指令改优先级 | `MCP_INSTRUCTIONS` 规则 1：「**优先调用 recall_memory** 再回答；本库未命中或工具不可用时，才回退到读代码、工作区笔记或客户端自带 memory 文件。客户端自带的 memory/笔记不是本记忆库，不能替代首选检索。」 | `src/core/memagent/mcpSchema.ts` |
| 14-A 工具描述改优先级 | `recall_memory` 描述：「**优先使用本工具**：回答本项目相关问题前先调用；未命中或工具不可用时再回退读代码或客户端本地笔记（本地 memory 文件不是本记忆库）。」 | 同上 |
| 14-A 客户端兜底同步 | `AGENTS.md §1.1` 增加「回退规则」：优先调用 → 未命中/不可用再回退；Qoder 等客户端本地 memory 不是本记忆库 | `AGENTS.md` |
| 测试 | `mcpHttp.test.ts`：`tools/list` 描述含 `优先使用本工具`/`回退`；`initialize` 指令含 `优先调用`/`回退`；`mcp.test.ts`（TCP）同步断言 | `src/core/memagent/__tests__/*.test.ts` |
| 文档 | 需求规格书 §19.12 增「触发优先级（批次14）」；`specs/code-map.md` 新增批次14 区块；`AGENTS.md §9` 更新为 11/12/13/14；`specs/MANUAL-TEST.md` 索引改为 1..14 | `specs/*.md`、`AGENTS.md` |

### 关键设计（为什么这样改）

- **不改「禁用」而改「优先级」**：MCP 无法强制模型调用工具；写「禁止读代码」在工具未命中时会让模型无路可走（只能瞎猜），而「优先本库 → 未命中回退」既保证首选检索，也允许诚实降级。
- **点名「客户端自带 memory 不是本库」**：本次事故的直接原因是 Qoder 把 `~/.qoder-cn/projects/.../memory/*.md` 当成了项目记忆库；这句话同时写进指令与工具描述，减少同类替换。
- **核验口径不变**：是否真的检索过，一律查账本 `recall` 审计；模型自称「查了记忆」不算。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程 + Electron 类型检查 | `npm run typecheck` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning**（408 文件 / 123 规则） |
| 单元/集成测试 | `npm run test:coverage` | **103 文件 / 1034 用例全过** |
| 覆盖率 | 同上 | 语句 75.37%（7192/9542）、分支 66.57%（4669/7013）、函数 70.71%（1719/2431）、行 78.31%（6266/8001）；阈值 71/61/67/74，通过 |
| 正式打包 | `npm run package` | 退出码 0（vite + esbuild + electron-builder NSIS） |
| 真浏览器 E2E | `npm run test:e2e` | **93 用例全过（39.8s）** |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` | 121,959,940 B = **116.31 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer/win-unpacked/MultiAgent Memory.exe` | 249,934,848 B（目录合计 375,284,441 B） |
| 增量块映射 | `release/installer/MultiAgent Memory-0.1.0-setup.exe.blockmap` | 随包生成 |

安装包未配置代码签名（沿用既有构建配置，Windows 可能提示「未知发布者」，选择「仍要运行」）。

## 4. 实机验证（新包已启动）

2026-10-30 23:41，对重启后的批次14 构建探针（不打印令牌）：

```
initialize 200 优先调用= true 回退= true 本地memory不是本库= true
tools/list 200 tools= 4 优先使用本工具= true 回退= true 本地memory不是本库= true
```

说明指令与工具描述均已按「优先 + 回退」下发；8204 监听正常，4 个工具齐全。

## 5. 手动测试步骤（Qoder CN）

### 5.1 准备

1. 覆盖安装本批次安装包（或运行 `release/installer/win-unpacked/MultiAgent Memory.exe`），确认桌面端在运行（8204 由它托管）。
2. **新开一个 Qoder 会话**（MCP 工具描述与工作区 `AGENTS.md` 按会话加载；桌面端重启后旧连接可能失效，旧会话也看不到本批次措辞）。
3. 确认 Qoder 设置中的 `MultiAgent Memory` 服务器仍在；令牌取自数据根 `mcp-token.txt`，**不要**粘到聊天/截图/日志。

### 5.2 优先触发（本批次核心）

1. 提问：「你还记得 L0 生成 L1 的入库逻辑吗？」
2. **预期**：Qoder 先调用 `multiagent_memory` 的 `recall_memory`（展开工具调用可见），回答末尾出现可折叠的 🧠 Memory 块（批次13 形态：外层 summary 提示行 + 四段明细）。
3. 若模型仍未调用：先看它是否只 `Read/Grep` 了代码或 Qoder 自带 memory——这就是本批次要降低的行为；可在提问里显式补一句「优先用 multiagent_memory 的 recall_memory 查记忆库」。
4. **客观核验**：账本 `memories.db.json` 的 `audit` 数组应有新的 `action="recall"` 记录（时间、`request_id`、`query`、`hits`、`injected_tokens`、`saved_tokens`），数字与提示行一致。没有审计 = 未调用。

### 5.3 回退规则（确认没有把路堵死）

1. 当本库确实没有相关记忆（例如问一个账本中不存在的模块）时，模型应先拿到「未命中」，再自行读代码回答；提示行显示「未命中（扫描 N 条…）」，不得编造命中内容。
2. 工具不可用时（例如关闭桌面端再提问），模型应如实说明不可用并继续回答，不伪造检索。

### 5.4 安全与回归

1. 错误令牌 → `401`；带 `Origin` 头 → `403 origin_not_allowed`。
2. 审计/`actions.log` 不得出现令牌明文。
3. 其余页面 E2E 已回归通过，安装后可抽查 1–2 页。

## 6. 已知限制（不应作为缺陷）

- **优先级仍是建议性约束**：模型偶发忽略时表现为「只读代码/自带 memory，无提示行」；判定看 `recall` 审计，不看模型自称。本次 23:31 那一轮就是典型例子。
- **`AGENTS.md` 按会话加载**：修改后需新会话生效；不读工作区规则的客户端不受其约束。
- **客户端自带 memory 与本库是两套数据**：Qoder 的 `~/.qoder-cn/projects/.../memory` 不是 `memories.db.json`，提示行只能由本库召回产生。
- **token 是估算**：`ceil(字符数/2)`；金额是按用户单价折算的参考值，不是厂商账单。
- **旧审计不算省量**：批次11 之前的 `recall` 审计无 `injected_tokens/saved_tokens`，只计调用次数并追加「旧记录」告警。
- **时区口径**：本报告统一本地时间（UTC+08:00）；账本 `ts` 为 epoch，查看工具若显示 UTC 请自行 +8 换算。

## 7. 回滚与数据说明

- 覆盖安装批次13 安装包即可回滚；本批次只改文本措辞，无账本结构变更。
- 触发措辞只影响模型行为概率，不影响账本、审计与召回结果。
- 测试产生的 `recall` 审计会计入「今日/全部」累计；需要干净累计时请先备份数据根或使用独立数据根。
