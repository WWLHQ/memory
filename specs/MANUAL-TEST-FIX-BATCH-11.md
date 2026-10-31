# 手动测试报告 · 功能批次 11（MCP 聊天窗口记忆提示 + 成本单价）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（121,958,619 B = **116.31 MiB**）
- SHA256：`fe0dae9f8544a5a4b676491bd814957f4bd1ecba211f054c508e42fb3d7ffebc`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md` ～ `specs/MANUAL-TEST-FIX-BATCH-10.md`
- 通用手测入口：`specs/MANUAL-TEST.md`

> **本批次无破坏性数据变更，可直接覆盖安装**：
> 1) 召回审计 `detail` 追加 `scanned_memories` / `background_tokens` / `bg_mems` / `corpus_tokens` / `injected_tokens` / `saved_tokens` / `budget_trimmed_tokens`（旧审计缺这些字段 → 只计调用次数，提示追加「旧记录」告警，不伪造省量）；
> 2) 参数快照 `cfg` 追加可选 `cost_cny_per_mtok`（旧快照无此字段 → 归一为「未设置」，不显示金额，不需要迁移）。
> 覆盖安装前仍建议备份数据根（默认 `%APPDATA%\MultiAgent Memory`）。

## 0. 本轮用户需求

1. 「所有接入的 agent 要能调用记忆库，所有接入的 agent 在聊天窗口内输入关键词时都可检索记忆库。」
2. 「聊天窗口要能提示携带项目背景，命中记忆，节省多少 token 合计多少钱等提示信息。」

**已拍板的四项口径**：提示显示在**接入 agent 自己的聊天窗口**内（非本程序页面）；金额用**一个固定单价、用户可设置**；累计展示**本次 + 今日 + 全部**；触发方式用 **MCP 指令下发（initialize.instructions）**。

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 11-A 召回增强 | `RecallResult` 新增 `scanned_memories` / `background` / `savings`：项目背景摘要（pinned → 类别优先级 decision>pitfall>preference>fact>insight>context → `updated_at` 倒序；≤5 条、每条 ≤160 字、≤300t，且不挤占 `payload+背景 ≤ 3000t` 硬熔断余量；与本次命中不重复）；省量口径 `corpus_tokens`（项目全部可读记忆，排除墓碑/合并影子）− `injected_tokens`（命中+背景）；召回审计落上述全部字段 | `src/core/memagent/recallInsight.ts`（新）、`agent.ts`、`types.ts` |
| 11-B MCP 指令与工具 | `initialize.instructions` 下发中文指令（关键词/历史依赖 → 必须 `recall_memory`；原样回显 `display.line`；未命中/报错不得声称命中；`money=null` 不得猜金额）；工具扩为 4 个：`recall_memory`（`project_id` 可省略）/`write_memory`/`list_projects`（新）/`get_user_preferences`；`project_id` 自动定位（唯一项目；0/多项目明确报错并引导 `list_projects`）；HTTP 传输 `content[0]=提示行` + `structuredContent`（数组结果包 `{items:[…]}`，符合 MCP 对对象的要求） | `src/core/memagent/mcpSchema.ts`（新）、`mcpRecall.ts`（新）、`mcpHttp.ts`、`mcp.ts` |
| 11-B 提示行与金额 | 单行提示：`🧠 Memory ｜ 命中 N 条（Xt） ｜ 📎 背景 N 条（Xt） ｜ ⚡ 本次省 Xt（全量约 Xt） ｜ 💰 本次/今日/全部…`；今日按**本地时区零点**切分；累计来自真实 `recall` 审计；未设单价 → `money=null` + 「金额未开」；预算裁剪、证据不足、旧审计均追加对应告警 | `recallInsight.ts`（`rollupRecalls`/`formatCny`/`buildRecallHint`） |
| 11-C 参数页成本单价 | 普通配置卡新增「成本单价」（¥ / 百万 token，`min=0`）：留空 = 未设置；保存进内核 preference 快照（pinned），旧快照缺字段归一为 `null`；负数/非有限数保存拦截 | `src/web/params/types.ts`、`defaults.ts`、`NormalConfigCard.tsx`、`logic.ts`、`coreParams.ts`、`src/core/memagent/paramsSnapshot.ts` |
| 11-D 内联页省量诚实化 | `tokenSavingFromMarks(injections, mems)`：基线改为**同一批记忆全文**（与内核同口径 `ceil(字符数/2)`），无全文对照时 `saved=0`——删除原先 `baseline = actual × 2` 的虚构倍数 | `src/web/InlineAttribution/useInlineReal.ts` |
| 测试 | 新增 `recallInsight.test.ts`（13 例）、`useInlineReal.test.ts`（3 例）；扩展 `mcpHttp.test.ts`/`mcp.test.ts`（空账本、非字符串 project_id、自动定位、list_projects、单价与累计、多项目引导）、`params` 两套（单价设置/清空/负数/旧快照） | `src/core/memagent/__tests__/*`、`src/web/params/__tests__/*`、`src/web/InlineAttribution/__tests__/*` |
| 文档 | 需求规格书 §19.5 工具契约修订 + 新增 §19.12「MCP 聊天窗口记忆提示」；`specs/code-map.md` 批次11 区块；`AGENTS.md` §9 边界；`specs/MANUAL-TEST.md` 索引；`npm run code:index -- --write`（262 文件） | `specs/*.md`、`AGENTS.md` |

### 关键设计（为什么这样实现）

- **省量不是拍脑袋**：基线 = 该项目全部可读记忆的 token 估算；注入 = 命中 + 背景；`saved = max(0, 基线 − 注入)`。预算裁剪量单列 `budget_trimmed_tokens`，不与省量混算。
- **累计必须包含本次**：`runRecallTool` 的累计时钟取**召回完成之后**（此前取调用前会漏掉本次审计，负载高时出现「今日/全部」少 1 次的不稳定）。
- **不猜项目**：唯一项目自动定位是为了「用户只配置了 URL+令牌也能用」；多项目时宁可报错列前 5 个 + 引导 `list_projects`，也不跨项目串味。
- **金额诚实**：单价是用户声明的 ¥/百万 token，不是厂商真实账单；未设置就明确「金额未开」，绝不用默认价格填充。
- **指令是建议性契约**：`instructions` 能否被遵循取决于客户端；因此 `structuredContent` 仍携带完整数据，保证「客户端不理指令」时也不丢信息。
- **提示行单一真源**：同一函数同时生成 `display.line`（给聊天窗口回显）与 `display.money/rollup`（给程序解析），避免两处口径漂移。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit`（strict） | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（退出码 0） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning**（408 文件 / 123 规则 / 68ms） |
| 单元/集成测试 | `npm run test:coverage` | **103 文件 / 1029 用例全过** |
| 覆盖率 | 同上 | 语句 75.29%（7163/9513）、分支 66.52%（4656/6999）、函数 70.65%（1714/2426）、行 78.23%（6237/7972）；阈值 71/61/67/74，通过 |
| Web 构建 | `npm run build`（vite） | 通过（19 个 HTML 入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 真浏览器 E2E | `npm run test:e2e` | **93 用例全过（39.8s）** |
| 总门禁 | `npm run verify` | 退出码 0 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

> 相较批次 10（101 文件 / 998 例）净增 **2 文件 / 31 例**：`recallInsight.test.ts` +13、`useInlineReal.test.ts` +3、`mcpHttp.test.ts`/`mcp.test.ts` 新增约 +9、`params` 两套 +6。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` | 121,958,619 B = **116.31 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer/win-unpacked/MultiAgent Memory.exe` | 249,934,848 B |
| 增量块映射 | `release/installer/MultiAgent Memory-0.1.0-setup.exe.blockmap` | 128,945 B |

安装包未配置代码签名（沿用既有构建配置，Windows 可能提示「未知发布者」，选择「仍要运行」）。

## 4. 手动测试步骤（接入 agent 聊天窗口）

### 4.1 准备

1. 覆盖安装并启动，登录（管理员 `admin` / `Admin@123456`，或已注册账号）。
2. 在「写入」页写 2–3 条同一项目（如 `P1`）的**技术记忆**（含模块名/决策/坑），或通过 MCP `write_memory` 写入。
3. 打开数据根（参数页「数据目录」卡片可查看）中的 `mcp-token.txt`，复制令牌（不要发到聊天/截图里）。

### 4.2 连接 MCP（HTTP 8204，推荐）

以支持 streamable HTTP 的 MCP 客户端为例（字段名按客户端文档调整）：

```json
{
  "mcpServers": {
    "multiagent-memory": {
      "type": "http",
      "url": "http://127.0.0.1:8204/mcp",
      "headers": { "Authorization": "Bearer <mcp-token.txt 内容>" }
    }
  }
}
```

重启客户端后：
- `tools/list` 应返回 4 个工具：`recall_memory`、`write_memory`、`list_projects`、`get_user_preferences`；
- `initialize` 应带 `instructions`（客户端若展示服务器说明，可见「关键词/历史依赖 → 调用 recall_memory」「原样回显 display.line」等文字）。

### 4.3 默认（未设单价）提示

1. 在 agent 聊天窗口输入含项目关键词的问题，例如「P1 的持久化方案是什么？继续上次的工作」。
2. **预期**：agent 调用 `recall_memory`；回答中出现一行：
   `🧠 Memory ｜ 命中 N 条（Xt） ｜ 📎 背景 N 条（Xt） ｜ ⚡ 本次省 Xt（全量约 Xt） ｜ 💰 金额未开：未设置单价（全局参数页可设 ¥/百万 token）`
3. 若账本里没有该项目 → 工具报错并提示 `project_id`（不猜项目）；若命中 0 条 → 提示「未命中（扫描 N 条，未注入命中内容）」，不得出现具体记忆内容。

### 4.4 设置单价 → 金额出现

1. 打开「全局参数」页 → 普通配置卡 → 「成本单价」输入 `10`（¥/百万 token）→ 保存（toast 含 `req_`）。
2. 重复 4.3 的提问。**预期**：提示行 `💰 本次 ¥…（省 ¥…）｜ 今日 N 次 ¥…（省 ¥…）｜ 全部 N 次 ¥…（省 ¥…）`，且 `全部 N 次` ≥ `今日 N 次` ≥ 本次（=1）。
3. 粗算校验：`本次 ¥ ≈ 本次注入 token ÷ 1,000,000 × 10`（提示按小额多留位数显示）。
4. 回到参数页把「成本单价」清空 → 保存 → 再次提问：恢复「金额未开」，`display.money=null`。
5. 参数页输入 `-1` → 保存被拦截（提示「成本单价不可为负」）。

### 4.5 项目定位与列表

1. 再写入一个项目 `P2` 的记忆（MCP `write_memory` 或写入页）。
2. 聊天窗口让 agent 直接检索但**不给项目名**。**预期**：工具返回错误，列出 `P1、P2` 并提示先询问用户或调用 `list_projects`。
3. 让 agent 调用 `list_projects` → 应返回真实项目列表（含项目 ID、记忆条数、最近活动时间；不含 `P_SYSTEM` 参数项目）。
4. 指定 `project_id=P1` 再检索 → 正常返回。

### 4.6 安全边界

1. 用错误令牌请求 8204 → `401`；请求带 `Origin` 头（浏览器场景）→ `403 origin_not_allowed`。
2. 跨租户读取：`get_user_preferences` 传其它 `user_id` → 工具报错含「租户」。
3. `actions.log` / 审计页不得出现令牌明文；召回审计可见 `injected_tokens` / `saved_tokens` 等字段。

### 4.7 内联标识页（省量口径回归）

1. 打开「内联记忆标识」页：`⚡ 本次召回 payload X/Y，省 Z token` 中 `Y` 必须等于「被注入记忆全文」的估算值（`ceil(字符数/2)` 求和），不再是固定 ×2。
2. 若页面最近 3 条记忆全文都很短/与摘要一致 → 省量可为 0（诚实结果，不是缺陷）。

## 5. 已知限制（不应作为缺陷）

- **指令是建议性的**：`initialize.instructions` 依赖客户端遵循；部分第三方客户端可能不展示/不执行，此时仍可从 `structuredContent` 拿到 `display.line` 与完整数据。
- **token 是估算**：全链路使用 `ceil(字符数/2)`（中文近似），与具体模型 tokenizer 存在偏差；金额为「按用户单价折算」的参考值，不是厂商账单。
- **旧审计不算省量**：批次11 之前的 `recall` 审计没有 `injected_tokens/saved_tokens`，只计入调用次数，并在提示后追加「今日含 K 次旧记录」。
- **今日按本地时区零点**切分；跨时区/改系统时间会影响「今日」统计（「全部」不受影响）。
- **单价默认未设置**：金额默认不显示；需要用户主动填写（不提供任何内置默认价）。
- **未接入真实 LLM 时仍只有 L1**：`refined_by=stub`，召回内容以 L1 清洗文本为准（沿用既有边界）。
- TCP 8202 为旧版 JSON-RPC 通道：工具方法直接以方法名调用（`recall_memory` 等），不使用 `tools/call` 包装；新接入优先用 HTTP 8204。

## 6. 回滚与数据说明

- 覆盖安装不需要迁移；如需回到批次 10，直接覆盖安装旧包即可，新增审计字段与 `cost_cny_per_mtok` 会被旧版本忽略。
- 单价想「回到未设置」：参数页清空后保存即可（不是删除记忆，快照仍保留其余参数）。
- 测试产生的 `recall` 审计会计入「今日/全部」累计；如需干净累计，请在测试前备份/使用独立数据根。
