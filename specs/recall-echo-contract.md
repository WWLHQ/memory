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
> **回显结构已按 [`specs/tasks/RECALL-ECHO-RAG.md`](tasks/RECALL-ECHO-RAG.md) 重设计（T1–T5 已实施）**：
> 正文就地引用 `[n]` + 末尾折叠「📊 本次召回统计汇总」+ 本机明细页核对；本文 §3 已按新模板重写。
> 统计基准：2026-11-12，工作区 `main`，源码逐行核对（`recallInsight.ts` 872 行 / `mcpHttp.ts` 632 行）。

## 0. 「回显」定义与边界

**回显 = `recall_memory` 成功返回后，接入 Agent 把该次返回的 `display.markdown` 整段原样输出到最终回答末尾。**
`display.line` 是「客户端连 Markdown 都渲染不了」时的单行兜底，不参与三档判档。
> **A6/A8 后的固定第三行**：`display.markdown` 在两行加粗摘要之后还有一行 `⚙ 模式：…`（由 `buildRecallModeLine(result)` 从 `RecallResult.dispatch` 生成）。`dispatch=null`（会话视图 / 无分流动作）时不产出该行。
> **A8 铁律**：展示要求一律写「两行摘要 + 一行 ⚙ 模式」，并明确要求**整段原样输出 `display.markdown`**、不得按摘要行数重建；`display.line` / `text` / HTTP `content[0]` 末尾也带同一段 `⚙ 模式`，避免纯文本兜底静默丢掉模式信息。

- 服务端下发规则三处叠加：`MCP_INSTRUCTIONS`（initialize 指令，§2 回显强制）、工具 `description`（tools/list）、`recallEchoNote(mode)`（tools/call 结果末块）。
- `AGENTS.md` / `CLAUDE.md` 是客户端不注入指令时的兜底触发规则。
- 是否真的检索过，以数据根 `audit.jsonl` 的 `recall` 行为准，不以回显文本为准。

### 数量总表

| 维度 | 数 | 明细 |
|---|---:|---|
| 判档档位 | **3** | `html-details` / `markdown-full` / `markdown-compact` |
| 呈现载体 | **5** | 三档 + 本机一次性明细页 HTML（点链接才出现）+ **客户端气泡折叠卡**（WorkBuddy 等富媒体客户端，文本零 HTML，2026-11-12 拍板） |
| 传输通道 | **2** | HTTP `127.0.0.1:8204/mcp`、TCP `8202` |
| HTTP 结果块 | **4 + 1** | `content[0..3]` + `structuredContent`（TCP 只有裸 payload） |
| 明细固定段 | **4** | 项目背景 / 命中记忆 / Token 用量 / 省钱与费用 |
| 统计汇总行 | **4** | 命中 / 用量 / 省量 / 累计（`buildRecallStatLines`，数字全部同源） |
| 摘要行 | **2 + 1** | 两行加粗摘要（headline / stats）+ 一行 `⚙ 模式`（`dispatch=null` 时退回 2 行）；三档与明细页同源 |
| 编号依据 | **N = `hits.length`** | `hits[i] → [i+1]`，1-based；`hits=0` 时全文无 `[n]`；明细页锚点 `id="hit-n"` |
| 明细页区块 | **5** | 状态条 / 统计汇总表 / `[n]` 命中卡 / 三段折叠（背景·用量·费用）/ 页脚 |
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
🧠 Memory ｜ {hitPart} ｜ 📎 背景 {N} 条（{N}t） ｜ ⚡ 本次省 {N}t（全量约 {N}t） ｜ {moneyPart} ｜ ⚙ 模式：…
```
- 各段与所有 `warnings` 用 ` ｜ ` 连接成**一行**；**A8 起末尾追加 `⚙ 模式` 段**（与 `display.markdown` 的 `mode_line` 逐字相同，`dispatch=null` 时省略），仍是单行、不含 `\n`。
- `hitPart`：有命中 = `命中 {N} 条（{payload}t）`；无命中 = `未命中（扫描 {N} 条，未注入命中内容）`。
- `moneyPart`（已设单价）：`💰 金额估算（本地预算单位 t × 单价）：本次 ¥x（省 ¥y） ｜ 今日 N 次 ¥x（省 ¥y） ｜ 全部 N 次 ¥x（省 ¥y）`。
- `moneyPart`（未设单价）：`💰 金额未开：未设置单价（全局参数页可设 ¥/百万预算单位 t；金额按本地预算单位估算）`。

### 3.2 `shortLine` — 现为**兜底**（仅当 `hint.echo` 缺失时）

```
🧠 Memory ｜ {hitPart} ｜ 📎 背景 {N} 条（{N}t） ｜ ⚡ 本次省 {N}t（全量约 {N}t）
💰 估算 本次 ¥x（省 ¥y） ｜ 今日 N 次 ｜ 全部 N 次
⚙ 模式：…
{warnings…}
```
> A6 起 `shortLine` 也带 `⚙ 模式` 行（夹在金额行与告警行之间）；A8 让 `line` 与它同口径。
未设单价时第 2 行 = `💰 金额未开（参数页可设 ¥/百万预算单位 t） ｜ 今日 N 次 ｜ 全部 N 次`。
今日/全部的**金额明细不在聊天侧**，挪到本机明细页，仍与 `line` 同源。

> **批次 RAG 起**：`buildRecallHint` 总会填充 `hint.echo`（`RecallEchoSummary`），三档模板优先用它；
> `shortLine` 只留给「手写 `RecallHint` 的老调用方 / 测试桩」兜底，正常回显不再出现此行文案。

### 3.3 ① `html-details`（白名单客户端）

```
<details>
<summary>{buildRecallFoldSummary} ｜ ▶ 展开本次召回汇总</summary>

**📊 本次召回统计汇总**

- 命中：{N} 条（{payload}t） · 背景 {M} 条（{bgt}t） · 扫描 {S} 条
- 用量：本次注入 {inj}t / 全量基线 {corp}t · 预算 {status}（软 1500 / 警 2000 / 硬 3000t）
- 省量：{saved}t（{pct}） · 估算 ¥x（省 ¥y）
- 累计：今日 N 次（¥a） · 全部 N 次（¥b）

**🎯 本次用上的依据**

- [1] {正文含 <mark>…</mark>}（L1·hot · 0.30 ▮▮▮▯▯） 🎯 命中「词」
- [2] …

<details><summary>📎 项目背景 M 条（bgt）</summary>

- [category] {正文}

</details>

<details><summary>🧠 命中记忆 N 条（payloadt）｜ 黄色 = …</summary>

- [L1/hot] …（相关度 0.30） 🎯 命中「词」

</details>

<details><summary>⚡ Token 用量（本次注入 Xt）</summary>…</details>
<details><summary>💰 省钱与费用（本次省 Xt）</summary>…</details>

<details><summary>⚠ 状态 K 项</summary>

- ⚠ 证据不足：…

</details>
</details>
```
- 外层 summary = `🧠 命中 N 条 · 依据「词1」「词2」「词3」 ｜ 省 {pct} ｜ ▶ 展开本次召回汇总`
  （`buildRecallFoldSummary`，`mdInline(...,160)`；命中词取 `recallHitTerms` 前 3 个，**不带编号**；无命中词时只剩命中数 + 省量）。
- **外层默认收起**（不加 `open`）；展开即见「统计汇总 + `[n]` 依据」，四段明细再套二级 `<details>` 收起。
- 依据行 = `buildRecallCitationLines`：`[i+1] 正文（layer·decay · score ▮▮▮▯▯） 🎯 命中「词」`；无字面重合时改后缀「· 无字面重合，仅按相关度参考」，**不写空 🎯**。
- 正文 `clip = mdInline`：压缩空白 → 截断 **120 字**加 `…` → 转义 `& < >`；高亮 `<mark>`。
- 告警段**只在 `echo.warnings` 非空时生成**（`evidence_thin` / `budget=fused` / 今日旧账），正常轮次不出现。
- 客户端不渲染 HTML 时按服务端指示退回单独一行 `display.line`（A8 起该行末尾带 `⚙ 模式` 段，不丢模式信息）。
- **A8 已知偏差**：`⚙ 模式` 行在本档被 `buildRecallMarkdown` 插在 `echoBody`（统计汇总 + `[n]` 依据）**之后**、四段二级折叠之前；compact / full 档则在「汇总」之后。位置统一留 A9。

### 3.4 ② `markdown-full`（`detail=true`，零 HTML 标签）

```
**🧠 命中 N 条 · 依据 [1]「词」[2]「词」 ｜ 省 99.8%（N t）｜ 估算 ¥x**

**📊 汇总：注入 Xt / 基线 Xt · 背景 M 条（Xt） · 今日 N 次 · 全部 N 次**

**⚙ 模式：…**

**⚠ 证据不足：…**（仅在真有告警时）

**📊 本次召回统计汇总**

- 命中 / 用量 / 省量 / 累计 四行（同 §3.3）

**🎯 本次用上的依据**

- [1] 正文（L1·hot · 0.30 ▮▮▮▯▯） 🎯 命中「词」

**📎 项目背景 M 条（Xt）**

- [category] {正文}

**🧠 命中记忆 N 条（Xt）** … **⚡ Token 用量 …** … **💰 省钱与费用 …**
```
- 两行加粗摘要 + `⚙ 模式` 行与 compact 档**逐字相同**（同一个 `hint.echo`），只是不使用 `<details>`。
- **摘要行之间同样必须空行**（2026-11-12 与 compact 同源缺陷）：单换行会被客户端合并成一段，`markdown-full` 与 compact 两档共用同一口径。
- 摘要后紧跟「统计汇总 + `[n]` 依据」，再是四段明细改成的**加粗小节**（不再折叠）。
- `clip = plainClip`（压缩空白 + 120 字截断，**不转义**）；命中片段用 `**「…」**`，读法说明为 `｜ 加粗「」= 与本次提问重合的片段；🎯 = 命中的词`。
- 触发条件：用户明确要明细 → **用同一个 query 再调一次** `recall_memory(detail=true)`，把那次的 `display.markdown` 原样输出。

### 3.5 ③ `markdown-compact`（默认档，其余客户端）

有明细页票据时（注意各行之间是**空行**，见下方说明）：
```
**🧠 命中 N 条 · 依据 [1]「词」[2]「词」 ｜ 省 99.8%（N t）｜ 估算 ¥x**

**📊 汇总：注入 Xt / 基线 Xt · 背景 M 条（Xt） · 今日 N 次 · 全部 N 次**

**⚙ 模式：…**

**⚠ …**（仅在真有告警时追加）

▶ [展开本次召回明细（统计汇总 / 命中依据 / Token / 费用）](http://127.0.0.1:<实际端口>/recall/<随机 id>)

📌 链接点不开时（手机端 / 部分客户端），直接说「看明细」即可，我用同一个 query 取回明细铺开。
```

- **兜底行的由来（2026-11-12 实测）**：WorkBuddy 桌面端与手机端点本机链接均无反应（手机是 `127.0.0.1` 不可达，桌面端是客户端不跳外链）。链接仍保留（浏览器与其它客户端可用），但必须给一条不依赖链接的取明细路径，否则用户永远看不到明细。
- **票据失效口径**：票据存内存，桌面端重启即全部作废；另有 30 分钟 TTL。重启后点旧链接必然 404，属预期行为，不是页面坏了。
- 首行 `[n]` **严格对应 `hits[i]`**：取前 3 条命中、每条只取一个代表词（`matched_terms[0]`），因此 `[1][2][3]` 与依据段编号一一对应；**不是**「top3 命中词逐个编号」（否则同一 `[3]` 会指代不同条目）。
- **各行之间必须是空行（2026-11-12 WorkBuddy 实测回填；A8 起含 `⚙ 模式` 行）**：单换行是 Markdown 软换行，客户端会把「🧠 摘要 / 📊 汇总 / ⚙ 模式 / ⚠ 告警」合并成一整段（截图实证），读者分不出层级。空行 = 段落硬分隔，所有客户端都认；用例 `B5`/`B6` 用 `not.toMatch(/\*\*\n\*\*/)` 反向锁住，退回单换行必红。
- 第 4 条及以后的命中在 compact 档**没有** `[n]`（首行只放 3 条）——正文引用只能落在 `[1][2][3]`，需要更多依据须走 `detail=true` 或明细页。
- `display.money === null` 时首行末段为「金额未开」，**不出现 `¥`**；第二行永远不带金额。
- 无票据（TCP 8202 / 无端口场景）时，链接块换成固定文字指引：
```
📌 明细已收起（统计汇总 / 命中依据 / Token 用量 / 省钱与费用）。需要看时用同一个 query 再调用一次 recall_memory 并置 detail=true，然后把返回的 display.markdown 原样输出；不需要就保持本行，不要自行编造明细。
```
硬约束：**URL 逐字保留**、不得改写链接为纯文本/HTML、不得编造 URL、不得替用户预先展开、不得因「更完整」自动置 `detail=true`；客户端连 Markdown 链接都渲染不了时照原样输出。

### 3.6 ④ 本机明细页 HTML（第 4 种载体，不属于聊天回显）

| 项 | 值 |
|---|---|
| URL | `http://127.0.0.1:<servedPort>/recall/<id>`，`id` = `randomBytes(16).toString('base64url')`（22 字符） |
| 有效期 | `RECALL_DETAIL_TTL_MS = 30 分钟`；容量上限 200 条，先清过期再淘汰最早 |
| 存储 | 进程内 `Map`，**不落盘**；过期随内存释放；`take()` 只读、不销毁 → 30 分钟内同一链接可重复打开（注释里的「一次性」指不可枚举 + 短期有效，不是读一次即焚） |
| 结构 | `<h1>` → 状态条 `<p class="statusbar">`（命中数 · 省量% · 预算状态 · 生成时间 · 有效期）→ 摘要三行 `<p class="sum">`（`echo.headline` / `echo.stats` / `echo.mode_line`，后者为 null 时退回两行）→ meta（项目 / 查询 / 调用方 / 有效期）→ `<h2>📊 本次召回统计汇总</h2>` 真 `<table>`（4 行按键值拆两列）→ 告警 `<ul class="warn">`（仅有告警时）→ legend（有命中词才出）→ 「全部展开 / 全部收起」（`mmAll`）→ 依据段 `<details data-fold="cites" open>`（**默认展开**，标题沿用 `buildRecallSections[1].title`）内为 `[n]` 命中卡 → 背景 / 用量 / 费用三段 `<details data-fold="bg|token|money">` → footer |
| 命中卡 | `<article class="hit" id="hit-n">`：`[n]` 编号徽标 + 层/热度徽标 + 相关度 `0.30 ▮▮▮▯▯` + `复制引用 [n]`（`mmCopy`）+ `<mark>` 高亮正文 + `🎯 命中「词」`（无则「无字面重合，仅按相关度参考」）+ `这条有用 / 这条没用`（`mmFeedback`，只生成可粘贴的 `feedback(...)` 指令文本）；`mem_id` 不过 `/^[A-Za-z0-9_-]{1,64}$/` 时**隐藏反馈按钮**、不拼进 onclick |
| 折叠记忆 | `localStorage` 键 `mm.recall.detail.folds.v1`（`{foldKey: boolean}`），同源、仅本机、不上传不落账本 |
| 锚点 | `/recall/<id>#hit-n` 直达单条依据；`hits=0` 时页面无任何 `[n]`、只给「未命中（扫描 N 条）」 |
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
批次 RAG 起再分两层：① 摘要/统计汇总/编号依据由 `buildRecallEchoSummary` + `buildRecallStatLines` +
`buildRecallCitationLines`（经 `buildRecallEchoBody` 组装）统一产出，三档与明细页共用；
② 明细页的第 2 段（命中记忆）**正文被编号卡替代**，只借用它的 `title`（数字同源），其余三段原样折叠。

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

`recallEchoNote` 三份文案分别要求：HTML 档整段输出外层 `<details>`（summary 以「🧠 命中」开头、含「▶ 展开本次召回汇总」，展开依次是统计汇总四行 → `[n]` 依据 → 四段二级折叠 + 一行 `⚙ 模式`；不加 `open`、不加额外标签；不渲染 HTML 则退回 `display.line`，该行同样带 `⚙ 模式` 段）；
`markdown-full` 档整段输出两行摘要 + 一行 `⚙ 模式` + 统计汇总 + `[n]` 依据 + 四小节、不添加 HTML 标签；
compact 档整段输出两行摘要 + 一行 `⚙ 模式` + 链接、URL 逐字保留、禁止预展开。
**A8 三档共用一条铁律**：不得按「两行摘要」的行数自行重建 `display.markdown`，`⚙ 模式` 行必须随整段原样输出、不得省略。
三档共用同一条 `[n]` 就地引用要求（HTML / full 对应「🎯 本次用上的依据」段，compact 对应首行「依据 [n]」，编号不得编造、`hits=0` 不标注）。
末块统一附 `RECALL_SOURCE_BOUNDARY`：`hits=0` 须如实说「未检索到相关记忆」、事实优先采信命中记忆、工具不可用不得假装检索过。

`payload.display` 字段：`line: string`、`money: RecallMoney | null`、`rollup: RecallRollup`、
`markdown: string`、`mode: 'html-details' | 'markdown-full' | 'markdown-compact'`、`detail_url: string | null`。

**TCP 8202**：`ok(req.id, out.payload)` 直接回裸 payload，没有 4 块结构、没有展示要求块、没有明细页票据 →
恒 `markdown-compact` + `detail_url = null`，聊天侧由 Agent 按文字指引自行处理。

## 7. 档位矩阵（客户端 × detail × 传输）

| 传输 | 客户端 | `detail` | `mode` | `detail_url` | 聊天侧呈现 |
|---|---|---|---|---|---|
| HTTP 8204 | 白名单（Qoder 系 + `qoder-*` 派生名 + `MEMAGENT_HTML_DETAILS_CLIENTS`） | 任意 | `html-details` | `null` | `<details>` 一行收起（summary 含命中数/依据词/省量%），点开是统计汇总四行 + `[n]` 依据（默认可见）+ 四段二级折叠（各可再收起） |
| HTTP 8204 | 任意客户端且带 `X-Memagent-Render: fold` | 任意 | `html-details` | `null` | 同上——**能力自证通道**（T8），不必等实测白名单 |
| HTTP 8204 | 其余 | `true` | `markdown-full` | `null` | 两行加粗摘要 + 一行 `⚙ 模式` + 统计汇总四行 + `[n]` 依据 + 四段加粗小节（纯 Markdown） |
| HTTP 8204 | 其余 | 缺省/false | `markdown-compact` | 有（30 分钟） | 两行加粗摘要（首行含 `[1][2][3]`）+ 一行 `⚙ 模式` + 「▶ 展开本次召回明细」本机链接 |
| TCP 8202 | 无 client | 任意 | `markdown-compact` | `null` | 两行加粗摘要 + 一行 `⚙ 模式` + 文字指引（`detail=true` 时升 `markdown-full`）；裸 TCP 无 HTTP 头，能力声明通道不适用 |
| 任一 | 连 Markdown 都渲染不了 | — | — | — | 单独一行原样输出 `display.line`（A8 起含 `⚙ 模式` 段） |

判档优先级（`recallDisplayMode(client, detail, renderFold)`）：**自证头 `renderFold` > 白名单 > detail**。
`renderFold` 只改「这一档怎么呈现」，不进 `display` 字段、不改审计里的 `client`、不改入参 schema。

### 7.1 富媒体客户端（WorkBuddy）：禁用 HTML，折叠走气泡卡片

2026-11-12 用户拍板：**WorkBuddy 不使用 HTML 档，折叠改由客户端气泡内折叠卡片承载。**

| 项 | 口径 |
|---|---|
| 判档 | 不变——`workbuddy` 仍不在白名单，恒 `markdown-compact`（**不新增档位、不改 `display` 6 字段、不改白名单**） |
| 文本通道 | **零 HTML 标签**：不出现 `<details>`/`<summary>`/`<mark>`；只用两行加粗摘要 + 一行 `⚙ 模式` + 一条 Markdown 链接 |
| 折叠载体 | 客户端气泡内折叠卡。**2026-11-12 用户已验收该形态**（截图确认：默认收起、标题即首行摘要、点开看汇总与依据）→ 服务端措辞从「能做就做」升级为「**有卡片能力就必须做**」：默认收起、卡片标题用首行原文、卡内依次放「📊 汇总」四行与「🎯 依据 [n]」 |
| **展开分区顺序（用户 2026-11-12 22:39 拍板）** | 顶部「📊 本次召回统计汇总」（四行，含 Token 与费用数字）→ 明细分段固定为 **📎 项目背景 → 🧠 命中记忆 → 🎯 本次用上的依据**（每条含 [n]、层级/相关度、🎯 命中词、正文片段）→ **⚠ 证据不足**（仅真有告警时出现，**放最后**）。其余保持原样：标题、默认收起、两行摘要、明细链接、禁 HTML、卡内正文只取自本次返回。`mcpHttp.test.ts` C4 用正则锁住该顺序 |
| **项目背景逐条独立（T13，用户 2026-11-12 22:45 回填截图）** | 用户要求「按照这个可折叠显示，命中前面增加项目背景」；截图里 `📎 项目背景 5 条（293t）` 虽已排在 `🧠 命中记忆` 之前，但被压成一整段、读起来像没展开 → 口径细化为「**逐条独立成行**：每条单独一行/一张卡，含类别（`[decision]` / `[fact]` …）与正文片段，**不压缩成一整段**」。`bubbleCard`、`MCP_INSTRUCTIONS` §2、`recall_memory` description 三处同步；`mcpHttp.test.ts` C4 加 `toContain('逐条独立成行')` 断言 |
| 不变项 | 两行摘要、`⚙ 模式` 行照常输出、URL 逐字保留、卡内不得补写明细或改写数字；做不到富媒体的客户端忽略该条 |
| 反向断言 | `mcpHttp.test.ts` C4：compact note 含「气泡折叠档 / 折叠卡 / 默认收起 / 不要输出任何 HTML 标签 / 逐条独立成行」，并用正则锁住「项目背景→命中记忆→依据→证据不足」顺序；html/full 两档**不得**含「气泡折叠档」 |
| **实测结论（2026-11-12 用户手机端 + 桌面端双端回填）** | 文本通道写 `<details><summary>` 时，WorkBuddy **解析掉了标签（不露裸文本）但也不提供折叠交互**：summary 与内容直接平铺展开、没有可点的三角。→ 若把 `workbuddy` 加进白名单，得到的不是折叠卡而是「明细默认全铺」，比两行摘要更差。**故 `workbuddy` 恒 `markdown-compact` 是实证结论，不是保守猜测**；折叠只在两处成立：① 两行摘要上的明细页链接（点开是本机真 HTML 页，页内真折叠）；② Agent 主动用富媒体卡片承载（宿主能力，非 MCP 文本通道） |

> TCP 行的「任意 detail」：`mcp.ts` 未传 `client`，`detail=true` 会走到 `markdown-full`；`detail=false/缺省` 为 compact。

### 7.2 其他 agent 如何吃到 Qoder 同款折叠档（T8，三条通道）

2026-11-12 Qoder 真机验证 `<details>` 折叠卡可用、用户要求「其他 agent 也按这个效果渲染」。
**不能**用「把未实测客户端塞进白名单」来实现——DSH 两次实测把标签露成文本。落地为三条并列通道：

| 通道 | 怎么用 | 适用 | 代价 |
|---|---|---|---|
| ① 派生名前缀 | 白名单新增前缀 `qoder-`（`qoder-desktop` / `qoder-ide` / `qoder-cli` / `qoder-cn-*` 等同渲染栈变体） | Qoder 同厂商客户端换自报名 | 零配置，服务端已内置 |
| ② 能力自证头（**推荐给新客户端**） | 接入配置 `headers` 加 `X-Memagent-Render: fold`（值也可 `html` / `details` / `1` / `true`，逗号多值任一命中） | 任何确认自己气泡能渲染折叠的客户端 / 自研 agent | 一行配置；**渲染不了就别加**，否则标签会露成文本 |
| ③ 运行时白名单 | 环境变量 `MEMAGENT_HTML_DETAILS_CLIENTS="cursor,my-agent"` | 没法改请求头、又想过白名单的场景 | 改环境变量 + 重启；缺省空集 = 历史行为 |

- 三条通道只影响 `display.mode` 与 `display.markdown`，**不改** `display` 6 字段、不改入参 schema、不改审计 `client`。
- WorkBuddy 恒走 ② 档（`markdown-compact`）+ 气泡折叠卡，**不适用**本节的 HTML 折叠（§7.1 优先）。
- 反向锁：没声明、不在白名单 → 仍是 compact；`workbuddy` / `dsh-mcp-client` / `zcode` / `unknown` 无声明时断言必须为 `false`。

## 8. Agent 侧禁止事项（服务端硬约束，逐条对应回显文案）

1. 不得改写、省略、补全任何 token 数字与金额；`display.money === null` 时不得猜金额。
2. 不得自行补写命中条目 / 项目背景 / Token / 费用明细；明细只能来自本次或下一次工具返回。
2.5 **`[n]` 引用必须可核对**：正文采用某条命中记忆作事实依据时就地标注 `[n]`，编号必须存在于本次依据段（HTML/full）或首行（compact，只有 `[1][2][3]`），**不得编造编号**；`hits=0` 时不得标注；`scope=session` 的命中不得说成「语义相关命中」。
3. 不得预先展开：不得因为「更完整」自动置 `detail=true`；只有用户在聊天里明确要明细才用**同一 query** 再调一次。
4. 不得改写链接 URL（截断、转纯文本、编造 id 均禁止），不得添加 HTML 标签。
5. `hits=0` 如实说「未检索到相关记忆」；工具不可用 / 网络失败 / 桌面端未启动不得假装检索过。
6. 不得向用户展示 MCP 令牌；`mint_token` 明文令牌只原样转交一次。
7. **富媒体客户端（WorkBuddy 等）禁用 HTML 档**：文本里不得输出 `<details>` 等标签（会让客户端露出裸标签），折叠一律交给客户端气泡折叠卡；服务端不因此改判档、不加白名单。
8. **（A8）不得按「两行摘要」的行数重建回显**：`⚙ 模式：…` 是本次 `display.markdown` 的固定组成部分，必须随整段原样输出；纯文本兜底改输出 `display.line` 时也不得丢掉末尾的 `⚙ 模式` 段。

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
| §3.5 compact 首行 | 「依据 [1][2][3]」 | 只覆盖**前 3 条命中**（每条一个代表词）；第 4 条及以后在 compact 档没有编号，正文也就不能引用，须走 `detail=true` / 明细页 |
| 明细页「这条有用 / 没用」 | footer 写「不会自动生效」 | 页面无 MCP 令牌，只生成一行可粘贴的 `feedback(...)` 指令文本并尝试复制；**必须由用户在聊天里让 Agent 执行**才进账本 |

| A6 之前 §3 的「两行摘要」模板 | 只有 headline + stats | A6 起还有第三行 `⚙ 模式`；A8 已把三档模板、档位矩阵、展示要求与 `display.line` 全部同步（会话视图 `dispatch=null` 时仍为两行） |

以上均为口径说明差异，不是缺陷；改动影响的只有文档，不改运行时。
