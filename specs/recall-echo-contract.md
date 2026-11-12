---
title: 回显（recall echo）逻辑与格式统计
date: 2026-11-12
status: active
scope: recall_memory 回显 / 三档判档 / 四段模板 / 明细页 / Agent 侧约束
---

# 回显（recall echo）逻辑与格式统计

> **本文是「回显」的可核对统计表，不是新的行为定义。** 行为唯一真源是源码；本文只做逐项归档，
> 便于后续任务不必重读 7 个文件就能确认「改一处会影响哪几档」。
> 规则侧入口见 `AGENTS.md` §1.1，方案侧见 `specs/tasks/RECALL-HIGHLIGHT.md`（批次59 高亮）。
> 统计基准：2026-11-12，工作区 `main`，源码逐行核对。

## 0. 「回显」定义与边界

**回显 = `recall_memory` 成功返回后，接入 Agent 把该次返回的 `display.markdown` 整段原样输出到最终回答末尾。**
`display.line` 是「客户端连 Markdown 都渲染不了」时的单行兜底，不参与三档判档。

- 服务端下发规则三处叠加：`MCP_INSTRUCTIONS`（initialize 指令，§2 回显强制）、工具 `description`（tools/list）、`recallEchoNote(mode)`（tools/call 结果末块）。
- `AGENTS.md` / `CLAUDE.md` 是客户端不注入指令时的兜底触发规则。
- 是否真的检索过，以数据根 `audit.jsonl` 的 `recall` 行为准，不以回显文本为准。

### 数量总表

| 维度 | 数 | 明细 |
|---|---:|---|
| 判档档位 | **3** | `html-details` / `markdown-full` / `markdown-compact` |
| 呈现载体 | **4** | 三档 + 本机一次性明细页 HTML（第 4 种，点链接才出现） |
| 传输通道 | **2** | HTTP `127.0.0.1:8204/mcp`、TCP `8202` |
| HTTP 结果块 | **4 + 1** | `content[0..3]` + `structuredContent`（TCP 只有裸 payload） |
| 明细固定段 | **4** | 项目背景 / 命中记忆 / Token 用量 / 省钱与费用 |
| `display` 字段 | **6** | `line` / `money` / `rollup` / `markdown` / `mode` / `detail_url` |
| 工具入参 | **8** | `query`(必填) / `project_id` / `top_k` / `scene` / `mode` / `detail` / `scope` / `session_id` |
| 白名单客户端 | **3** | `qoder`、`qoder-cn`、`qoder-desktop-mcp-host` |
| `matched_terms` 填充点 | **3** | `agent.ts:187`（主召回）/`:228`（冷回填）/`:251`（个人记忆） |
| 预算阈值 | **3** | soft 1500t / warn 2000t / hard 3000t |

### 文件职责（影响面清单）

| 文件 | 职责 |
|---|---|
| `src/core/memagent/mcpSchema.ts` | 入参 schema、`MCP_INSTRUCTIONS`、`RECALL_SOURCE_BOUNDARY`、工具 description |
| `src/core/memagent/mcpRecall.ts` | `recallDisplayMode` 判档、`runRecallTool` 编排、`RecallToolPayload.display` 契约 |
| `src/core/memagent/recallInsight.ts` | **所有文本的唯一组装真源**：`buildRecallHint` / `buildRecallSections` / `buildRecallMarkdown` / `buildRecallCompactMarkdown` / `buildRecallDetailPage` / `buildRecallDetailExpiredPage` |
| `src/core/memagent/hitHighlight.ts` | `matchedTerms` / `pickHitSpans` / `displayTerms`（命中片段高亮纯函数） |
| `src/core/memagent/mcpHttp.ts` | 四块 `content`、`recallEchoNote`、`GET /recall/<id>` 路由与安全头 |
| `src/core/memagent/recallDetailTickets.ts` | 明细页票据（TTL / 随机 id / 容量） |
| `src/core/memagent/agent.ts` + `types.ts` | `Hit.matched_terms?` 与召回结果数据契约 |
| `src/core/memagent/mcp.ts` | TCP 侧：`runRecallTool(..., client=undefined, detail=undefined)` |

改其中任一文件，须同步核对本文 §3–§5 的模板与 §7 的档位矩阵。

## 1. 触发与判档逻辑（决策链）

```
新会话/新任务
  └─ 首步强制召回（MCP_INSTRUCTIONS §0；服务端 WRITE_GATE_TOOLS 硬门禁）
       └─ recall_memory(query 必填)
            ├─ 参数校验：detail 非布尔 → -32602；scope 非 project/session → -32602；
            │            scope=session 缺 session_id → -32602；session 下 top_k 非 1–10 整数 → -32602
            ├─ 项目定位：显式 project_id → 唯一项目自动定位 → 0/多项目明确报错
            ├─ 三池可见性：projectInScope(account, project_id)
            ├─ 内核召回 → RecallResult（hits/background/savings/budget/scanned_memories…）
            ├─ 读单价 + recall 审计 rollup → buildRecallHint → line / shortLine / money
            └─ recallDisplayMode(client, detail)
                 ├─ client 首段 ∈ 白名单 ─────────────→ html-details   （优先级最高）
                 ├─ 其余 + detail=true ───────────────→ markdown-full
                 └─ 其余 + detail 缺省/false ─────────→ markdown-compact
                        ├─ HTTP（有 tickets+base）→ 签发票据，附 detail_url 链接
                        └─ TCP / 无票据能力      → 无链接，给文字指引
```

判档函数真源：`mcpRecall.ts:255` `recallDisplayMode`；白名单：`mcpRecall.ts:28` `HTML_DETAILS_CLIENT_IDS`，
判据是 `client.split('/')[0].trim().toLowerCase()` 命中（**不是精确等于**）。

三条容易踩空的口径：

1. **白名单优先于 `detail=true`**：Qoder 系客户端即使显式要明细，仍拿 `<details>` 折叠档，而不是纯 Markdown 四小节。
2. **TCP 8202 恒为 `markdown-compact` 且无链接**：`mcp.ts:189` 不传 `client` 也不传 `detail` opts，因此永远走不到 `detailUrl` 分支。
3. **`scope=session` 不改判档**，只改命中来源：按 `session_id` 精确过滤 + `created_at` 倒序、不走语义检索、不注入项目背景、不填 `matched_terms`、`hit.score=0`（「未计算相关度」的诚实值）。

## 2. 数字与文案口径（所有档位同源）

| 项 | 口径 |
|---|---|
| 预算单位 t | `estTokens(s) = ceil(s.length / 2)`，`CHARS_PER_BUDGET_UNIT = 2`；**不是** LLM tokenizer token，中文会低估 BPE |
| 硬熔断 | soft 1500 / warn 2000 / hard 3000；`payload + background ≤ 3000t` |
| 项目背景 | 最多 **5 条**、单条 **160 字**、合计 **300t**；与命中去重、排除 `merged_into`/`deleted`、正文非空；`mode=minimal` 恒空 |
| 背景排序 | 置顶 > 类别优先级 `decision5 / pitfall4 / preference3 / fact2 / insight1 / context0` > 最近更新 > `mem_id` |
| 省量 | `corpus_tokens`（全量基线）/ `payload_tokens` / `background_tokens` / `injected_tokens` / `budget_trimmed_tokens` / `saved_tokens = corpus − injected` |
| 累计 | `rollupRecalls(audits, now)` 从 `audit.jsonl` 的 `recall` 行累计今日/全部；旧账无 `saved_tokens` → 计 `legacy_calls`，用量按 payload 下限、省量不计 |
| 单价 | 来自 `paramsSnapshot.cfg.cost_cny_per_mtok`；`null` → `display.money = null`，文案「金额未开：未设置单价」，**不编造金额** |
| 金额格式 | `formatCny`：`0 → ¥0`、`abs≥1 → 2 位`、`≥0.01 → 4 位`、`否则 6 位`，去尾随 0；非法 → `—`；一律带「估算」字样 |
| 整数格式 | `fmtInt` 千分位 |
| 警告行 | `evidence_thin` → `⚠ 证据不足：未命中权威来源，建议事实优先重试`；`budget.status=fused` → `⚠ 预算熔断：已裁剪 Nt`；今日有旧账 → `⚠ 今日含 N 次旧记录（…）` |

## 3. 三档 + 明细页的精确格式模板

### 3.1 `display.line` — 三档共有，单行，也是 HTTP `content[0]`

```
🧠 Memory ｜ {hitPart} ｜ 📎 背景 {N} 条（{N}t） ｜ ⚡ 本次省 {N}t（全量约 {N}t） ｜ {moneyPart}
```
- 各段与所有 `warnings` 用 ` ｜ ` 连接成**一行**。
- `hitPart`：有命中 = `命中 {N} 条（{payload}t）`；无命中 = `未命中（扫描 {N} 条，未注入命中内容）`。
- `moneyPart`（已设单价）：`💰 金额估算（本地预算单位 t × 单价）：本次 ¥x（省 ¥y） ｜ 今日 N 次 ¥x（省 ¥y） ｜ 全部 N 次 ¥x（省 ¥y）`。
- `moneyPart`（未设单价）：`💰 金额未开：未设置单价（全局参数页可设 ¥/百万预算单位 t；金额按本地预算单位估算）`。

### 3.2 `shortLine` — 只被 `markdown-compact` 用（2 行 + 警告行）

```
🧠 Memory ｜ {hitPart} ｜ 📎 背景 {N} 条（{N}t） ｜ ⚡ 本次省 {N}t（全量约 {N}t）
💰 估算 本次 ¥x（省 ¥y） ｜ 今日 N 次 ｜ 全部 N 次
{warnings…}
```
未设单价时第 2 行 = `💰 金额未开（参数页可设 ¥/百万预算单位 t） ｜ 今日 N 次 ｜ 全部 N 次`。
今日/全部的**金额明细不在聊天侧**，挪到本机明细页，仍与 `line` 同源。

### 3.3 ① `html-details`（白名单客户端）

```
<details>
<summary>{mdInline(line, 500)}</summary>

{sections，段间空一行}
</details>
```
每段：
```
<details>
<summary>{段标题}</summary>

- {行1}
- {行2}
</details>
```
- 正文 `clip = mdInline`：压缩空白 → 截断 **120 字**加 `…` → 转义 `& < >`（防破坏 `<details>`）。
- 命中片段高亮 `<mark>…</mark>`；段标题后缀读法说明 `｜ 黄色 = 与本次提问重合的片段；🎯 = 命中的词`（**仅在本次真的存在 `matched_terms` 时追加**）。
- 客户端不渲染 HTML 时按服务端指示退回单独一行 `display.line`。

### 3.4 ② `markdown-full`（`detail=true`，零 HTML 标签）

```
**{line}**

**{段标题}**

- {行1}
- {行2}
```
四段之间空一行；`clip = plainClip`（压缩空白 + 120 字截断，**不转义**）；
命中片段用 `**「…」**`；读法说明为 `｜ 加粗「」= 与本次提问重合的片段；🎯 = 命中的词`。
触发条件：用户明确要明细 → **用同一个 query 再调一次** `recall_memory(detail=true)`，把那次的 `display.markdown` 原样输出。

### 3.5 ③ `markdown-compact`（默认档，其余客户端）

有明细页票据时：
```
**{shortLine}**

▶ [展开本次召回明细（项目背景 / 命中记忆 / Token / 费用）](http://127.0.0.1:<实际端口>/recall/<随机 id>)
```
无票据（TCP 8202 / 无端口场景）时，第二块换成固定文字指引：
```
📌 明细已收起（项目背景 / 命中记忆 / Token 用量 / 省钱与费用）。需要看时用同一个 query 再调用一次 recall_memory 并置 detail=true，然后把返回的 display.markdown 原样输出；不需要就保持本行，不要自行编造明细。
```
硬约束：**URL 逐字保留**、不得改写链接为纯文本/HTML、不得编造 URL、不得替用户预先展开、不得因「更完整」自动置 `detail=true`；客户端连 Markdown 链接都渲染不了时照原样输出。

### 3.6 ④ 本机明细页 HTML（第 4 种载体，不属于聊天回显）

| 项 | 值 |
|---|---|
| URL | `http://127.0.0.1:<servedPort>/recall/<id>`，`id` = `randomBytes(16).toString('base64url')`（22 字符） |
| 有效期 | `RECALL_DETAIL_TTL_MS = 30 分钟`；容量上限 200 条，先清过期再淘汰最早 |
| 存储 | 进程内 `Map`，**不落盘**；过期随内存释放；`take()` 只读、不销毁 → 30 分钟内同一链接可重复打开（注释里的「一次性」指不可枚举 + 短期有效，不是读一次即焚） |
| 结构 | `<h1>` + 摘要 `<p class="sum">`（shortLine 逐行） + meta（项目 / 查询 / 调用方 / 生成时间 / 有效期） + legend（有命中词才出） + 「全部展开 / 全部收起」按钮 + 四段 `<details><ul><li>` + footer |
| 截断 | 正文默认 **400 字**（`meta.clipChars`），query 80 字、legend 内 query 60 字、命中词 20 字 |
| 安全 | Host 绑定拒 DNS rebinding；`no-store` / `no-referrer` / `nosniff`；CSP `default-src 'none'`；全动态内容 `htmlEscape`；URL 与页面**不含 MCP 令牌**；只监听 127.0.0.1 |
| 失效 | 未知 id / 已过期 / id 格式非 `[A-Za-z0-9_-]{16,32}` → HTTP 404 + `buildRecallDetailExpiredPage()`（给两条可执行退路，不猜数据） |

> 数字口径：页面与聊天摘要**同一次 recall 的真实账本计算**，未重算、未估算；金额仍标「非厂商账单」。

## 4. 四段明细固定模板（`buildRecallSections`，三处共用一份数据）

| 段 | 标题 | 行格式 |
|---|---|---|
| 1 项目背景 | `📎 项目背景 {N} 条（{N}t）` | `[{category}] {clip(content,120/400)}`；无背景时 `无（minimal 模式或账本暂无可用背景）` |
| 2 命中记忆 | `🧠 命中记忆 {N} 条（{N}t）` + 可选读法说明 | `[{layer}/{decay_class}] {正文含高亮}（相关度 0.29） 🎯 命中「词1」「词2」`；无命中 = `未命中（扫描 N 条，未注入命中内容）` |
| 3 Token 用量 | `⚡ Token 用量（本次注入 {N}t）` | 固定 4 行：本次注入 / 全量基线 / 预算裁剪（含 soft·warn·hard）/ 扫描记忆 |
| 4 省钱与费用 | `💰 省钱与费用（本次省 {N}t）` | 未设单价 3 行；已设单价 5 行（本次 / 今日 / 全部 / 单价 / 金额口径）；有今日旧账再加 1 行 |

**共用出口**：`buildRecallMarkdown`（HTML 档 + Markdown 档）、`buildRecallDetailPage`（明细页）都调
`buildRecallSections`，只是传入不同 `clip` 与 `hitStyle.markup` → 数字不会分叉。

## 5. 命中片段高亮（批次59 方案 C）三件套

| 层 | 表现 | 回答 |
|---|---|---|
| ① 片段 | HTML `<mark>` / Markdown `**「…」**` | 用的是哪句 |
| ② 命中词 | 行尾 ` 🎯 命中「…」` | 为什么是它 |
| ③ 读法 | 段标题后缀 + 明细页 legend | 黄色是什么意思 |

- **与打分同源**：`matchedTerms = tokenize(query) ∩ tokenize(content)`，复用 `vector.ts` 的 `tokenize`（中文 2-gram / 英文按词）。过滤：纯标点、长度 < 2、停用词；按长度降序取前 **12**。
- **渲染层定偏移**：`pickHitSpans` 在**截断后的那段文本**上定位，大小写不敏感，重叠/相邻合并（遇 `。；！？;!?\n\r` 不跨句合并），`minLen=2`、取最长 `maxSpans=3` 片、扫描上限 256；`displayTerms` 按正文出现顺序去重取 3 个展示。
- **三处填充**：`agent.ts:187/228/251`；`scope=session` 刻意不填。
- **诚实边界（有反向用例锁着）**：无共有词 → 不高亮、不写空 🎯；命中词被截断切掉 → 该片不标、不移位凑；不做同义/近义扩展（query「慢」/正文「延迟」不标）；cold/dormant 只标回显那段、不越权回读 L1 原文；只用文本切片拼 `<mark>`、不用 `innerHTML`；会话视图不伪装成相关命中。

## 6. HTTP `tools/call` 结果结构（TCP 不适用）

`content` 固定 4 块（仅 `recall_memory` 有 `out.text`）：

| # | 内容 | 用途 |
|---|---|---|
| `content[0]` | `display.line` | 纯文本客户端兜底 |
| `content[1]` | `JSON.stringify(payload, null, 2)` | 完整结果（含 `display` 全字段） |
| `content[2]` | `display.markdown` | **Agent 须原样回显的那一块** |
| `content[3]` | `recallEchoNote(displayMode)` | 按档不同的展示要求 + `RECALL_SOURCE_BOUNDARY` |
| — | `structuredContent` = `payload` | 标准 MCP 结构化结果 |

`recallEchoNote` 三份文案分别要求：HTML 档优先整段输出 `<details>`（不渲染 HTML 则退回 `display.line`）；
`markdown-full` 档整段输出四小节、不添加 HTML 标签；compact 档整段输出两行摘要 + 链接、URL 逐字保留、禁止预展开。
末块统一附 `RECALL_SOURCE_BOUNDARY`：`hits=0` 须如实说「未检索到相关记忆」、事实优先采信命中记忆、工具不可用不得假装检索过。

`payload.display` 字段：`line: string`、`money: RecallMoney | null`、`rollup: RecallRollup`、
`markdown: string`、`mode: 'html-details' | 'markdown-full' | 'markdown-compact'`、`detail_url: string | null`。

**TCP 8202**：`ok(req.id, out.payload)` 直接回裸 payload，没有 4 块结构、没有展示要求块、没有明细页票据 →
恒 `markdown-compact` + `detail_url = null`，聊天侧由 Agent 按文字指引自行处理。

## 7. 档位矩阵（客户端 × detail × 传输）

| 传输 | 客户端 | `detail` | `mode` | `detail_url` | 聊天侧呈现 |
|---|---|---|---|---|---|
| HTTP 8204 | 白名单 3 个之一 | 任意 | `html-details` | `null` | `<details>` 一行收起，点开四段（四段各自可再收起） |
| HTTP 8204 | 其余 | `true` | `markdown-full` | `null` | 加粗 `line` + 四小节纯 Markdown |
| HTTP 8204 | 其余 | 缺省/false | `markdown-compact` | 有（30 分钟） | 两行加粗摘要 + 「▶ 展开」本机链接 |
| TCP 8202 | 无 client | 任意 | `markdown-compact` | `null` | 两行加粗摘要 + 文字指引（`detail=true` 时升 `markdown-full`） |
| 任一 | 连 Markdown 都渲染不了 | — | — | — | 单独一行原样输出 `display.line` |

> TCP 行的「任意 detail」：`mcp.ts` 未传 `client`，`detail=true` 会走到 `markdown-full`；`detail=false/缺省` 为 compact。

## 8. Agent 侧禁止事项（服务端硬约束，逐条对应回显文案）

1. 不得改写、省略、补全任何 token 数字与金额；`display.money === null` 时不得猜金额。
2. 不得自行补写命中条目 / 项目背景 / Token / 费用明细；明细只能来自本次或下一次工具返回。
3. 不得预先展开：不得因为「更完整」自动置 `detail=true`；只有用户在聊天里明确要明细才用**同一 query** 再调一次。
4. 不得改写链接 URL（截断、转纯文本、编造 id 均禁止），不得添加 HTML 标签。
5. `hits=0` 如实说「未检索到相关记忆」；工具不可用 / 网络失败 / 桌面端未启动不得假装检索过。
6. 不得向用户展示 MCP 令牌；`mint_token` 明文令牌只原样转交一次。

## 9. 复核命令

```bash
npx vitest run src/core/memagent/__tests__/recallInsight.test.ts   # 三档/四段/明细页模板
npx vitest run src/core/memagent/__tests__/hitHighlight.test.ts     # 命中片段纯函数
npx vitest run src/core/memagent/__tests__/mcpHttp.test.ts          # 四块 content + 判档 + 明细页路由
npm run test:gate                                                  # 全量回归
npm run code:index:check                                           # 索引一致性
```

## 10. 本轮统计核对出的「措辞 ≠ 实现」三处（如实记录，不改写行为）

| 位置 | 措辞 | 实际 |
|---|---|---|
| `recallDetailTickets.ts` / §3.6 | 「一次性访问票据」 | `take()` 只读不删，30 分钟内同一 id 可重复打开；真正的一次性是「随机不可枚举 + 短期有效 + 不落盘」 |
| `mcpRecall.ts:255` | 「`detail=true` 要四段明细」 | 白名单客户端优先判 `html-details`，`detail=true` 在那一档不生效 |
| `AGENTS.md` §1.1 ③ | 「明细链接已过期时置 `detail=true`」 | 这是**回退操作指引**，不是服务端自动降级；服务端不会因票据过期改档 |

以上三处均为口径说明差异，不是缺陷；改动影响的只有文档，不改运行时。
