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
> **2026-11-21 按用户截图重设计（现行口径）**：`display.markdown` 的摘要恒为**一整行**（2026-11-21 二次拍板压到约 2 行宽）——行首 `⚙ 模式简称`（如「事实优先」，括号里的分流解释只在 detail 档保留），接着 `🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥…（省 ¥…） ｜ 今日 N 次 ｜ 全部 N 次`，告警短版（`⚠ …`）内联在行尾。金额只留本次、今日/全部只留次数，明细在 detail 档「💰 省钱与费用」段完整保留。`dispatch=null`（会话视图 / 无分流动作）时省略行首的模式段。
> **A8 铁律（表述已更新）**：展示要求写「摘要行 + 行首 ⚙ 模式段」，并明确要求**整段原样输出 `display.markdown`**、不得按行重建；`display.line` / `text` / HTTP `content[0]` 与气泡卡标题都是同一行，避免纯文本兜底静默丢掉模式信息。
> **2026-11-21 用户追加（现行硬约束）**：① 摘要行首挂**黑三角 `▶`**（`▶ ⚙ 模式：…`），它就是「点开看明细」的标记；② **禁止用 HTML**——三档 markdown 一律零标签（无折叠标签、无高亮标签），判档与白名单逻辑不动，但 `html-details` 档的载体也改为纯 Markdown 平铺；③ 展开看细节只由**客户端气泡折叠卡**承载：卡片默认收起、标题即该摘要行，展开是统计汇总 + 依据 + 四段平铺；④ `markHitFragments` 的三档高亮统一用 `**「…」**`（`<mark>` 只保留在本机明细页 HTML 里，那不属于聊天回显）。

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
| 摘要行 | **1** | 一整行（约 2 行宽）：`▶`（展开标记）+ `⚙ 模式简称`（`dispatch=null` 时省略） ｜ `🎯 命中 … ｜ 📎 背景 … ｜ ⚡ 省 …t ｜ 💰 ¥…（省 ¥…）｜ 今日 N 次 ｜ 全部 N 次` ｜ 告警短版内联行尾；三档的 `display.markdown` 首行 / `display.line` / 气泡卡标题**同源** |
| 编号依据 | **N = `hits.length`** | `hits[i] → [i+1]`，1-based；**只在 `detail=true` / `html-details` 的依据段里出现**（compact 档摘要行不含编号）；`hits=0` 时全文无 `[n]`；明细页锚点 `id="hit-n"` |
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

1. **白名单优先于 `detail=true`**：Qoder 系客户端即使显式要明细，仍走 `html-details` 档；但 2026-11-21 起该档载体也是零 HTML 的纯 Markdown 平铺（判档不变、标签不再输出）。
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
▶ ⚙ {模式简称} ｜ {hitPart} ｜ 📎 背景 {N} 条 ({N}t) ｜ ⚡ 省 {N}t ｜ {moneyPart=💰 ¥…（省 ¥…）｜ 今日 N 次 ｜ 全部 N 次} ｜ {shortWarnings…}
```
- 各段用 ` ｜ ` 连接成**一行**；**`⚙ 模式` 段在行首**（`dispatch=null` 时整段省略），告警（`⚠ …`）内联在**行尾**；仍不含 `\n`。
- 这一行就是气泡折叠卡的标题、也是 HTTP `content[0]`，三处同源（`hint.line`）。
- `hitPart`：有命中 = `命中 {N} 条 ({payload}t)`；无命中 = `未命中（扫描 {N} 条，未注入命中内容）`。
- `moneyPart`（已设单价）：`💰 本次 ¥x（省 ¥y） ｜ 今日 N 次 ¥x（省 ¥y） ｜ 全部 N 次 ¥x（省 ¥y）`。
- `moneyPart`（未设单价）：`💰 金额未开：未设置单价（可在全局参数页设置）`（**不含 `¥`**，compact 档有「无 ¥」断言）。

### 3.2 `shortLine` — 已与 `line` 合并（同值）

2026-11-21 起 `shortLine === line`（单行摘要），字段保留只为兼容旧调用方；不再有两行/多行形态，也不再有独立的兜底排版。

### 3.3 ① `html-details`（白名单客户端）

```
**▶ ⚙ 模式简称 ｜ 🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥…（省 ¥…）｜ 今日 N 次 ｜ 全部 N 次**

**📊 本次召回统计汇总**

- 命中：{N} 条（{payload}t） · 背景 {M} 条（{bgt}t） · 扫描 {S} 条
- 用量：本次注入 {inj}t / 全量基线 {corp}t · 预算 {status}（软 1500 / 警 2000 / 硬 3000t）
- 省量：{saved}t（{pct}） · 估算 ¥x（省 ¥y）
- 累计：今日 N 次（¥a） · 全部 N 次（¥b）

**🎯 本次用上的依据**

- [1] {正文含 <mark>…</mark>}（L1·hot · 0.30 ▮▮▮▯▯） 🎯 命中「词」
- [2] …

**📎 项目背景 M 条 (bgt)**

- [category] {正文}

**💠 命中记忆 N 条 (payloadt)｜ 黄色 = …**

- [L1/hot] …（相关度 0.30） 🎯 命中「词」

**⚡ Token 用量（本次注入 Xt）** …

**💰 省钱与费用（本次省 Xt）** …

**⚠ 状态 K 项**

- ⚠ 证据不足：…

```
- 首行 = **那一行摘要本身**（`hint.line`，`mdInline(..., 2000)`）：行首 `⚙ 模式：…`，接着 `💠 Memory ｜ 🎯 命中 … ｜ 📎 背景 … ｜ ⚡ … ｜ 💰 …`，告警内联行尾。
  （2026-11-21 起 `buildRecallFoldSummary` 与「▶ 展开本次召回汇总」短句**已删除**，防止旧格式复活。）
- **气泡卡默认收起**；点开一次即见「统计汇总 + `[n]` 依据 + 四段」，四段为加粗标题**平铺**；服务端文本零 HTML 标签。
- 依据行 = `buildRecallCitationLines`：`[i+1] 正文（layer·decay · score ▮▮▮▯▯） 🎯 命中「词」`；无字面重合时改后缀「· 无字面重合，仅按相关度参考」，**不写空 🎯**。
- 正文 `clip = mdInline`：压缩空白 → 截断 **120 字**加 `…` → 转义 `& < >`；高亮 `<mark>`。
- 告警段**只在 `echo.warnings` 非空时生成**（`evidence_thin` / `budget=fused` / 今日旧账），正常轮次不出现。
- 客户端不渲染 HTML 时按服务端指示退回单独一行 `display.line`（A8 起该行末尾带 `⚙ 模式` 段，不丢模式信息）。
- **A8（2026-11-21 已统一）**：`⚙ 模式` 不再是独立一行，而是**摘要行首**（前面再加黑三角 ▶）；三档 + 气泡卡标题 + `display.line` 全部同源，不再有位置偏差。

### 3.4 ② `markdown-full`（`detail=true`，零 HTML 标签）

```
**▶ ⚙ 模式简称 ｜ 🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥x（省 ¥y） ｜ 今日 N 次 ｜ 全部 N 次 ｜ ⚠ 证据不足**（告警仅在真有告警时内联在行尾）

- 命中 / 用量 / 省量 / 累计 四行（同 §3.3）

**🎯 本次用上的依据**

- [1] 正文（L1·hot · 0.30 ▮▮▮▯▯） 🎯 命中「词」

**📎 项目背景 M 条 (Xt)**

- [category] {正文}

**💠 命中记忆 N 条 (Xt)** … **⚡ Token 用量 …** … **💰 省钱与费用 …**
```
- 摘要**一行**，与 compact / html 档**逐字相同**（`hint.line`），只是不使用气泡卡标题以外的折叠容器；三档零 HTML 标签。
- 摘要与正文之间必须空行（单换行会被客户端合并成一段）。
- 摘要后紧跟「统计汇总 + `[n]` 依据」，再是四段明细改成的**加粗小节**（不再折叠）。
- `clip = plainClip`（压缩空白 + 120 字截断，**不转义**）；命中片段用 `**「…」**`，读法说明为 `｜ 加粗「」= 与本次提问重合的片段；🎯 = 命中的词`。
- 触发条件：用户明确要明细 → **用同一个 query 再调一次** `recall_memory(detail=true)`，把那次的 `display.markdown` 原样输出。

### 3.5 ③ `markdown-compact`（默认档，其余客户端）

**2026-11-21 用户两次纠偏后的定稿：compact 档整段只有一整行加粗摘要，没有第二行、没有明细页链接、没有任何 📌 提示语。**

```
**▶ ⚙ 模式简称 ｜ 🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥x（省 ¥y） ｜ 今日 N 次 ｜ 全部 N 次 ｜ ⚠ …**（告警仅在真有告警时内联在行尾）
```

- **为什么删掉链接行与提示行**：用户给的目标截图只有摘要那一行，明确「这显示这些就可以了，然后增加黑三角可以展开看细节就OK了，禁止用HTML」；旧实现多出的「▶ 展开本次召回明细」链接行与「📌 链接点不开时…」提示行属于未按要求实现，连续两轮被用户指出「不管用」。现在展开**只靠行首 ▶ + 客户端气泡折叠卡**，`detail_url` 仍下发在 payload 里给需要的客户端，但不写进 `display.markdown`。
- **compact 档摘要行不含 `[n]` 编号**：编号只在 `detail=true` / `html-details` 的「🎯 本次用上的依据」段里出现；正文需要编号引用时让用户说「看明细」再取明细档，**不得凭空编号**。
- `display.money === null` 时该段为「金额未开：未设置单价（可在全局参数页设置）」，**不出现 `¥`**。
- **无票据（TCP 8202）输出完全相同**：`buildRecallCompactMarkdown()` 忽略 `detailUrl`，有无票据都只输出这一行。
- 硬约束：不得自行补第二行、不得编造明细页链接、不得替用户预先展开、不得因「更完整」自动置 `detail=true`；输出文本必须与 `display.markdown` 逐字一致。

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
| 1 项目背景 | `📎 项目背景 {N} 条 ({N}t)` | `[{category}] {clip(content,120/400)}`；无背景时 `无（minimal 模式或账本暂无可用背景）` |
| 2 命中记忆 | `💠 命中记忆 {N} 条 ({N}t)` + 可选读法说明 | `[{layer}/{decay_class}] {正文含高亮}（相关度 0.29） 🎯 命中「词1」「词2」`；无命中 = `未命中（扫描 N 条，未注入命中内容）` |
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

`recallEchoNote` 三份文案分别要求：三档**零 HTML 标签**；html-details 档是摘要行（行首 `▶ ⚙ 模式` + `💠 Memory ｜ 🎯 命中 … ｜ 📎 背景 …`）+ 统计汇总 + 依据 + 四段平铺，折叠交给气泡卡；不能承载气泡卡则退回 `display.line`（该行同样以 ▶ 开头）；
`markdown-full` 档整段输出一行摘要 + 统计汇总 + `[n]` 依据 + 四段加粗小节、不添加 HTML 标签；
compact 档整段**只输出一整行摘要**、没有链接行与提示语、禁止预展开（2026-11-21 用户定稿）。
**A8 三档共用一条铁律**：不得按「摘要行」的行数自行重建 `display.markdown`，行首 `⚙ 模式` 段必须随整段原样输出、不得省略。
三档共用同一条 `[n]` 就地引用要求（HTML / full 对应「🎯 本次用上的依据」段；**compact 档摘要行不含编号**，要编号引用只能 `detail=true`；编号不得编造、`hits=0` 不标注）。
末块统一附 `RECALL_SOURCE_BOUNDARY`：`hits=0` 须如实说「未检索到相关记忆」、事实优先采信命中记忆、工具不可用不得假装检索过。

`payload.display` 字段：`line: string`、`money: RecallMoney | null`、`rollup: RecallRollup`、
`markdown: string`、`mode: 'html-details' | 'markdown-full' | 'markdown-compact'`、`detail_url: string | null`。

**TCP 8202**：`ok(req.id, out.payload)` 直接回裸 payload，没有 4 块结构、没有展示要求块、没有明细页票据 →
恒 `markdown-compact` + `detail_url = null`，聊天侧由 Agent 按文字指引自行处理。

## 7. 档位矩阵（客户端 × detail × 传输）

| 传输 | 客户端 | `detail` | `mode` | `detail_url` | 聊天侧呈现 |
|---|---|---|---|---|---|
| HTTP 8204 | 白名单（Qoder 系 + `qoder-*` 派生名 + `MEMAGENT_HTML_DETAILS_CLIENTS`） | 任意 | `html-details` | `null` | `<details>`（summary = 一行摘要，行首 `⚙ 模式`），点开是统计汇总 + `[n]` 依据（默认可见）+ 四段加粗标题平铺 |
| HTTP 8204 | 任意客户端且带 `X-Memagent-Render: fold` | 任意 | `html-details` | `null` | 同上——**能力自证通道**（T8），不必等实测白名单 |
| HTTP 8204 | 其余 | `true` | `markdown-full` | `null` | 一行摘要 + 统计汇总四行 + `[n]` 依据 + 四段加粗小节（纯 Markdown） |
| HTTP 8204 | 其余 | 缺省/false | `markdown-compact` | 有（30 分钟，仅在 payload 的 detail_url 字段） | **仅一整行摘要**（**不含 `[n]`、无链接行、无提示语**） |
| TCP 8202 | 无 client | 任意 | `markdown-compact` | `null` | **仅一整行摘要**（与 HTTP 档逐字相同；`detail=true` 时升 `markdown-full`）；裸 TCP 无 HTTP 头，能力声明通道不适用 |
| 任一 | 连 Markdown 都渲染不了 | — | — | — | 单独一行原样输出 `display.line`（与摘要同源，含行首 `⚙ 模式` 段） |

判档优先级（`recallDisplayMode(client, detail, renderFold)`）：**自证头 `renderFold` > 白名单 > detail**。
`renderFold` 只改「这一档怎么呈现」，不进 `display` 字段、不改审计里的 `client`、不改入参 schema。

### 7.1 富媒体客户端（WorkBuddy）：卡片即回显，文本行二选一

2026-11-12 用户拍板 WorkBuddy 不使用 HTML 档；**2026-11-21 三次纠偏（红框位置）最终定稿：富媒体宿主「卡片即回显」——折叠卡独占召回回显区，那行 `▶ ⚙ …` 文本摘要不再输出，文本行与卡片二选一、绝不并存。**

| 项 | 口径 |
|---|---|
| 判档 | 不变——`workbuddy` 仍不在白名单，恒 `markdown-compact`（**不新增档位、不改白名单**；`display` 原有 6 字段不动，仅**新增第 7 个字段 `card`**，见 §7.1.1） |
| 文本通道 | **零 HTML 标签**：不出现折叠/高亮标签。有组件卡片能力的宿主**只出卡片、不输出那行文本摘要**；仅无卡片能力的宿主才回退为一行摘要（`▶ ⚙ 模式`），**不写任何明细页链接** |
| 折叠载体 | **卡片即回显**：宿主组件工具渲染一张**默认收起**的折叠卡，**放在回答末尾的召回回显区**（不插正文中间）；**卡片标题压 2 行、不要大黑三角 ▶、用小箭头（▸/▾）标示可展开**，标题取摘要行各项、去掉行首 ▶；卡内依次放「📊 汇总」四行与「🎯 依据 [n]」。红框那行文本摘要由卡片取代，二者绝不并存 |
| **卡片形态（用户 2026-11-21 反复强调，位置/形态锁死）** | ① 位置 = 回答末尾召回回显区（用户截图标红框处），不是正文中间；② 标题压到 2 行；③ **去掉大黑三角 ▶**（▶ 只是纯文本展开提示，不是可点控件，不能替代卡片的原生小箭头）；④ 小箭头 ▸/▾ 表示可展开、**箭头放大到清晰可见**（默认太小看不清）；⑤ **标题固定排两行**：第一行 = 模式 ｜ 🎯 命中 ｜ 📎 背景 ｜ **⚡ 省量（放第一行末尾）**，第二行 = 💰 金额 ｜ 今日 ｜ 全部 N 次，**「全部 N 次」后紧跟灰色小字「点击查阅详细内容」**（不另起一行、不放省量后）；⑥ **卡片之后不输出任何文字**（不写「卡片已作为会话最后一条内容输出」这类括注，用户红框明令禁止）；⑦ 有卡片就没有那行 `▶ ⚙ …` 文本。`recallEchoNote` / `MCP_INSTRUCTIONS` §2 / `recall_memory` description 三处同步；`mcpHttp.test.ts` C4 加 `二选一、绝不并存 / 卡片标题压成 2 行 / 不要大黑三角 ▶ / 小箭头 / 放在回答末尾的召回回显区` 反向锁 |
| **展开分区顺序（用户 2026-11-12 22:39 拍板）** | 顶部「📊 本次召回统计汇总」（四行，含 Token 与费用数字）→ 明细分段固定为 **📎 项目背景 → 💠 命中记忆 → 🎯 本次用上的依据**（每条含 [n]、层级/相关度、🎯 命中词、正文片段）→ **⚠ 证据不足**（仅真有告警时出现，**放最后**）。其余保持原样：标题、默认收起、摘要行、禁 HTML、卡内正文只取自本次返回（compact 文本里无明细链接）。`mcpHttp.test.ts` C4 用正则锁住该顺序 |
| **项目背景逐条独立（T13，用户 2026-11-12 22:45 回填截图）** | 用户要求「按照这个可折叠显示，命中前面增加项目背景」；截图里 `📎 项目背景 5 条 (293t)` 虽已排在 `💠 命中记忆` 之前，但被压成一整段、读起来像没展开 → 口径细化为「**逐条独立成行**：每条单独一行/一张卡，含类别（`[decision]` / `[fact]` …）与正文片段，**不压缩成一整段**」。`bubbleCard`、`MCP_INSTRUCTIONS` §2、`recall_memory` description 三处同步；`mcpHttp.test.ts` C4 加 `toContain('逐条独立成行')` 断言 |
| 不变项 | 卡内数字/明细只取自本次返回、不得补写或改写；卡片标题口径与 `⚙ 模式` 段同源（去掉行首 ▶）；compact 文本里**不写任何明细页链接**；无卡片能力的客户端才回退纯文本摘要行 |
| 反向断言 | `mcpHttp.test.ts` C4：compact note 含「卡片即回显 / 折叠卡 / 默认收起 / 二选一、绝不并存 / 卡片标题压成 2 行 / 不要大黑三角 ▶ / 小箭头 / 放在回答末尾的召回回显区 / 不要输出任何 HTML 标签 / 逐条独立成行」，并用正则锁住「项目背景→命中记忆→依据→证据不足」顺序；C3 三档均含「折叠卡」 |
| **实测结论（2026-11-12 用户手机端 + 桌面端双端回填）** | 文本通道写 `<details><summary>` 时，WorkBuddy **解析掉了标签（不露裸文本）但也不提供折叠交互**：summary 与内容直接平铺展开、没有可点的三角。→ 若把 `workbuddy` 加进白名单，得到的不是折叠卡而是「明细默认全铺」，比两行摘要更差。**故 `workbuddy` 恒 `markdown-compact` 是实证结论，不是保守猜测**；折叠只在两处成立：① 两行摘要上的明细页链接（点开是本机真 HTML 页，页内真折叠）；② Agent 主动用富媒体卡片承载（宿主能力，非 MCP 文本通道） |

> TCP 行的「任意 detail」：`mcp.ts` 未传 `client`，`detail=true` 会走到 `markdown-full`；`detail=false/缺省` 为 compact。

### 7.1.1 富媒体宿主专用卡片数据结构 `display.card`（2026-11-21 新增）

用户口径：「给 WorkBuddy 单独下一份专门的『卡片数据结构』」。此前卡片标题由 Agent 自行从 `display.line` 拆字符串，任何一处漏改都会出现「文本一行、卡片另一行」两套口径。

**口径**：`display.card` 只对富媒体宿主（`clientIsRichCardHost()`：名字含 `workbuddy` / `codebuddy`）非 null，其余客户端恒 `null`。它是**结构化字段**，宿主直接按字段渲染，不再解析字符串。

| 字段 | 类型 | 说明 |
|---|---|---|
| `titleLine1` | `string` | 卡片标题第一行：模式简称 ｜ 🎯 命中 ｜ 📎 背景 ｜ ⚡ 省量；**已去行首 ▶、不含金额** |
| `titleLine2` | `string` | 卡片标题第二行：💰 金额 ｜ 今日 N 次 ｜ 全部 N 次（金额段起全部归此，保证与 `display.line` 同源可逐字还原） |
| `hint` | `string` | 固定 `RECALL_CARD_HINT = "点击查阅详细内容"` |
| `summary` | `{label,value}[]` | 固定 4 行：Token / 费用 / 今日 / 全部 |
| `background` | `{category,mem_id,excerpt}[]` | 项目背景，逐条独立 |
| `hits` | `{index,mem_id,layer,decay_class,score,terms[],excerpt,feedback_hint,reinforce_count?}[]` | 命中记忆，`index` 即回答里的 `[n]`（1-based）；批次 A2 加 `feedback_hint`（常量 `RECALL_FEEDBACK_HINT`，宿主把 N 替换为 index）；批次 A3 加 `reinforce_count`（累计被确认/强化次数，无记录则省略，不补 0 伪装） |
| `basis` | 同 `hits` | 本次用上的依据，与 `hits` 同源同序 |
| `warnings` | `string[]` | 告警短版，正常轮次为空数组 |

**不变量**：`titleLine1`/`titleLine2` 由 `hint.line` 派生（拼接可逐字还原 `display.line`）；所有数字复用 `fmtInt`/`formatCny`/`hint.money`/`hint.rollup`，零新增计算，绝不改写。`buildRecallCardData()` 为唯一构建口（`recallInsight.ts`）。

**测试锁**：`recallInsight.test.ts` 锁「两行重建等于 `hint.line` / summary 四行 / basis===hits / 零命中不编 🎯 / feedback_hint 常量与 reinforce_count 带出」；`mcpHttp.test.ts` 锁「workbuddy → card 非 null，qoder-cn → card 为 null」；`mcp.test.ts` 锁「TCP 无身份 → card 为 null」。

**批次 A1 隐式弱信号（同日）**：`feedback` 工具新增 `implicit` 参数（仅 `verdict=confirm` 允许）。MCP 层落地、内核 `coreFeedback` 一行不改：confidence 一分不动（trust_delta 恒 0），只 `reinforce_count+1`，落两条审计（`memory_op[op=confirm,implicit,trust_delta=0,reinforce_only]` + `recall_feedback[implicit]`——后者被 `recallEval` 自动当强标签进评估样本池）。红线：必须能归因到召回（linked=false 直接拒绝）；同一 `request_id + mem_id` 幂等去重（重复返回 `duplicate:true` 不再 +1）。测试锁：`mcpManageTools.test.ts`。

**反馈交互按钮（同日，用户提出「光靠回复提示用户不会主动反馈」）**：WorkBuddy/CodeBuddy 等支持会话按钮的宿主，卡片命中逐条渲染「N 有用 ↗」「N 没用 ↗」小按钮，点击经宿主 `sendPrompt` 类机制把「N 有用 / N 没用」作为用户消息发出 → Agent 收到后调 `feedback` 提交（与手打回复同一链路，幂等去重同样生效）。无按钮能力的宿主（如 Qoder 气泡卡）保留文字提示，**不伪造按钮**。协议落点：`mcpSchema.ts` MCP_INSTRUCTIONS §2 + `mcpHttp.ts` bubbleCard。诚实边界：按钮不能直接发起 MCP RPC，中间必经宿主消息发送与 Agent 工具调用两跳；下一包（批次 B）随包生效。

### 7.2 其他 agent 如何吃到 Qoder 同款折叠档（T8，三条通道）

2026-11-12 Qoder 真机验证 `<details>` 折叠卡可用、用户要求「其他 agent 也按这个效果渲染」。
**不能**用「把未实测客户端塞进白名单」来实现——DSH 两次实测把标签露成文本。落地为三条并列通道：

| 通道 | 怎么用 | 适用 | 代价 |
|---|---|---|---|
| ① 派生名前缀 | 白名单新增前缀 `qoder-`（`qoder-desktop` / `qoder-ide` / `qoder-cli` / `qoder-cn-*` 等同渲染栈变体） | Qoder 同厂商客户端换自报名 | 零配置，服务端已内置 |
| ② 能力自证头（**推荐给新客户端**） | 接入配置 `headers` 加 `X-Memagent-Render: fold`（值也可 `html` / `details` / `1` / `true`，逗号多值任一命中） | 任何确认自己气泡能渲染折叠的客户端 / 自研 agent | 一行配置；**渲染不了就别加**，否则标签会露成文本 |
| ③ 运行时白名单 | 环境变量 `MEMAGENT_HTML_DETAILS_CLIENTS="cursor,my-agent"` | 没法改请求头、又想过白名单的场景 | 改环境变量 + 重启；缺省空集 = 历史行为 |

- 三条通道只影响 `display.mode` 与 `display.markdown`，**不改** `display` 原有 6 字段、不改入参 schema、不改审计 `client`（第 7 个字段 `card` 只由宿主能力决定，与这三条通道无关）。
- WorkBuddy 恒走 ② 档（`markdown-compact`）+ 气泡折叠卡，**不适用**本节的 HTML 折叠（§7.1 优先）。
- 反向锁：没声明、不在白名单 → 仍是 compact；`workbuddy` / `dsh-mcp-client` / `zcode` / `unknown` 无声明时断言必须为 `false`。

## 8. Agent 侧禁止事项（服务端硬约束，逐条对应回显文案）

1. 不得改写、省略、补全任何 token 数字与金额；`display.money === null` 时不得猜金额。
2. 不得自行补写命中条目 / 项目背景 / Token / 费用明细；明细只能来自本次或下一次工具返回。
2.5 **`[n]` 引用必须可核对**：正文采用某条命中记忆作事实依据时就地标注 `[n]`，编号必须存在于本次「🎯 本次用上的依据」段（HTML / full 档）；**compact 档摘要行不含编号**，要编号引用只能 `detail=true`；**不得编造编号**；`hits=0` 时不得标注；`scope=session` 的命中不得说成「语义相关命中」。
3. 不得预先展开：不得因为「更完整」自动置 `detail=true`；只有用户在聊天里明确要明细才用**同一 query** 再调一次。
4. 不得编造链接 URL 或明细行，不得添加 HTML 标签；compact 档只输出摘要那一行。
5. `hits=0` 如实说「未检索到相关记忆」；工具不可用 / 网络失败 / 桌面端未启动不得假装检索过。
6. 不得向用户展示 MCP 令牌；`mint_token` 明文令牌只原样转交一次。
7. **所有档位禁用 HTML 标签**（2026-11-21 用户拍板）：三档回显文本一律零标签（折叠/高亮都不用 HTML）；富媒体宿主**卡片即回显**（默认收起、标题 2 行、无大黑三角 ▶、小箭头展开），折叠卡独占回显区、文本摘要行不再输出；服务端不因此改判档、不加白名单。
8. **（A8 / 2026-11-21）不得按「摘要行」自行重建回显**：摘要是**一整行**，`▶ ⚙ 模式简称` 在行首，是 `display.markdown` 的固定组成部分，必须随整段原样输出；纯文本兜底改输出 `display.line` 时同样不得丢掉行首的 ▶ 与模式简称段。

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
| **2026-11-21 按用户截图重设计（现行）** | 摘要**一整行**：行首 `⚙ 模式` → `💠 Memory ｜ 🎯 命中 … ｜ 📎 背景 … ｜ ⚡ … ｜ 💰 本次 …（省 …） ｜ 今日 … ｜ 全部 …` → 告警内联行尾；四段改加粗标题平铺（不再二级 `<details>`）；compact 档不再带 `[n]` | 源码 `buildRecallHint` / `buildRecallMarkdown` / `buildRecallCompactMarkdown` / `recallEchoNote` 与 `mcpSchema` 三处指令已同步；`buildRecallFoldSummary`（旧「▶ 展开本次召回汇总」）已删；`check-no-demo` 的 C02 判据同时解除对 `💰 本次 ` 的拦截（用户明确要求这三段金额回到摘要行） |
| **2026-11-21 追加（用户「黑三角 + 禁止 HTML」）** | 摘要行首挂黑三角 ▶（即展开标记）；三档 markdown 一律零标签，`html-details` 虽保留判档名但载体改纯 Markdown 平铺；高亮统一 `**「…」**`（`<mark>` 只留本机明细页） | `buildRecallHint` / `buildRecallMarkdown` / `recallEchoNote` / `mcpSchema` 三处指令均已同步；`mdInline` 已删除；测试批量改断言并保留反向锁 |
| **2026-11-21 三次纠偏（红框位置，现行）** | 富媒体宿主「**卡片即回显**」：折叠卡独占回答末尾的召回回显区（红框处），那行 `▶ ⚙ …` 文本摘要不再输出——**文本行与卡片二选一、绝不并存**；卡片标题压 2 行、去掉大黑三角 ▶、改小箭头 ▸/▾ 展开；展开含汇总 + 依据 + 背景/命中/token/费用 | `recallEchoNote` 三档 + `MCP_INSTRUCTIONS` §2 + `recall_memory` description/detail 参数 + §7.1 规格同步；`mcpHttp.test.ts` C3/C4 反向断言锁死新口径；无卡片能力的宿主仍回退纯文本摘要行 |
| **2026-11-21 命中图标（现行）** | 摘要行/卡片标题的统计项：`命中 N 条` 前加 **🎯**、背景项保持 **📎**（二者一一对应；零命中不标 🎯，仍写「未命中」）。注意与依据段「🎯 命中「词」」高亮的 🎯 是两个不同位置——前者是统计图标、后者是命中词标记 | `buildRecallHint.hitPart` 是真源，自动同步三档 markdown / display.line / 卡片标题；`recallEchoNote` summaryShape + 卡片标题文案 + `MCP_INSTRUCTIONS` §2 + description 同步；`recallInsight.test.ts` 把「无命中词不写 🎯」的断言精确化为不含 `🎯 命中「` |

以上均为口径说明差异，不是缺陷；改动影响的只有文档，不改运行时。
