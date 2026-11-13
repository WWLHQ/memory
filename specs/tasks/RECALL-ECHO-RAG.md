---
title: 回显重设计 — RAG 引用锚点 + 气泡内折叠统计汇总
date: 2026-11-12
status: draft
scope: recall_memory 回显 / 正文引用锚点 / 气泡内折叠统计汇总 / 明细页 / 展示要求同步
---

# 回显重设计 — RAG 引用锚点 + 气泡内折叠统计汇总

> **状态：T1–T13 均已实施；T6 交付闭环已结案（Qoder 气泡内折叠卡实测通过）。**
> T7 = 2026-11-12 用户拍板「WorkBuddy 禁用 HTML → 用气泡折叠方式」，改动落在 compact 档文案，白名单/契约零改动。
> T8 = 2026-11-12 Qoder 验证成功后用户要求「其他 agent 也按这个折叠效果渲染」→ 派生名前缀 + 能力自证头 + 运行时白名单三通道。
> 行为唯一真源是源码；本文是实施规格与验收清单。
> **2026-11-12 新约定**：每次打包完先等用户测试打包产物，测试完再等用户明确确认，才允许 commit / push。
> 当前状态：**T13（项目背景逐条独立成行）已于 2026-11-12 22:49–22:50 重打包并核验产物，等用户实测 + 明确确认后才提交**；工作区混有 L0 在途改动，提交时须逐文件挑选，不得 `git add .`。
>
> 关联真源：[`specs/recall-echo-contract.md`](../recall-echo-contract.md)（现状统计表）、
> [`specs/tasks/RECALL-HIGHLIGHT.md`](RECALL-HIGHLIGHT.md)（命中片段高亮）、
> `specs/接入Agent行为规范.md` §3.1（折叠气泡口径）、
> `specs/MANUAL-TEST-FIX-BATCH-33.md`（DSH 气泡内联折叠实测边界）、
> `specs/文档对齐确认需求稿.md` §4（M1 二次校正）。
> 可交互原型：[`design/ui/回显气泡_原型.html`](../../design/ui/回显气泡_原型.html)。

## 0. 目标与不可逾越的边界

用户拍板（2026-11-12）：① 按 RAG 标准做法执行；② 会话尾部增加**气泡内可折叠控件**，
主要内容是**统计汇总本次召回明细**。

### 0.1 三档现状（不改判档）

| 客户端 | 档位 | 气泡内能否折叠 | 本规格给什么 |
|---|---|---|---|
| 白名单 3 个 Qoder | `html-details` | **能**（2026-11-05 真机目视确认 `<details>` 渲染） | 气泡内 `<details>` 折叠控件 = 统计汇总 + 编号依据 |
| DSH（deepseek harness） | `markdown-compact` | **不能**（批次 29/32/33 三次实测：`<details>` 原样吐成纯文本） | 两行摘要（含统计汇总）+ 一条 `▶` 本机明细页链接 |
| WorkBuddy | `markdown-compact` | **走气泡折叠卡**（2026-11-12 用户拍板：**禁用 HTML 档**，改由客户端气泡内折叠卡片承载统计汇总与依据） | 两行摘要（含统计汇总）+ `▶` 明细页链接 + **气泡内默认收起的折叠卡**（见 §0.4 W2） |
| `detail=true` / TCP 无票据 | `markdown-full` / 文字指引 | 不能 | 纯 Markdown 汇总，零 HTML 标签 |

**诚实边界（必须写进交付说明）**：批次 29/32/33 的「`<details>` 当纯文本」实测对象**只有 DSH**
（`specs/MANUAL-TEST-FIX-BATCH-33.md:15`），把它外推到 WorkBuddy 属无证据推断
（2026-11-12 复核后修正）。WorkBuddy 的真实情况是「渲染能力未实测 + 服务端判档恒为
`markdown-compact`」（`mcpRecall.ts:28` 白名单只有 3 个 qoder），因此改完后本会话的
**纯文本回显**里看不到折叠按钮；要目视确认 `<details>` 效果仍须在 Qoder。把全部客户端
硬切成 `html-details` 会把已接入客户端打回一批裸标签噪声（批次 41-Q/41-X 反复修过这个
误伤），**不做**。

### 0.2 「按钮」的两种含义

| 用户说的 | 能否做 | 落点 |
|---|---|---|
| 气泡尾部的 `▶` **折叠控件**（点击展开/收起统计汇总） | ✅ 能 | `html-details` 档的原生 `<details>`，无需 JS |
| 带 JS 回调的真按钮（上报折叠状态、就地反馈、改变服务端状态） | ❌ 不能 | MCP 文本通道无 JS / 无回调 / 页面无令牌；只能在 `/recall/<id>` 明细页里做真按钮 |

本规格实现前者；后者落在明细页（§4），且明细页按钮只做本地交互，不冒充服务端状态变更。

### 0.3 不变项（硬约束，反向用例锁着）

`display` 6 字段契约不变 · 白名单与 `recallDisplayMode` 判档不变 · HTTP 四块 `content` 顺序不变 ·
`structuredContent` 不变 · 票据 TTL/CSP/安全头不变 · `buildRecallSections` 的四段数字口径不变 ·
`hitHighlight.ts` 与 `matched_terms` 三处填充不变 · **URL 逐字保留**、数字金额不得改写省略补全 ·
不预先展开、不自动 `detail=true`。

### 0.4 WorkBuddy 的富媒体卡片通道（2026-11-12 复核新增，T11 已验收并纳入）

WorkBuddy 消息流**能渲染原生 `<details>` 折叠与带 JS 回调的按钮**（本会话内可视化卡片当场
验证），但这属于「Agent 主动渲染富媒体卡片」通道，**不是**「MCP 回显文本」通道：MCP 只返回
文本，无法替客户端生成控件。若要在 WorkBuddy 实现「会话尾部气泡内可折叠统计汇总」，三条路径：

| 路径 | 做法 | 改动面 | 代价 |
|---|---|---|---|
| W1 | 维持 compact + 明细页链接，不改判档 | 零 | 气泡内无折叠 |
| **W2（2026-11-12 用户拍板采纳）** | **WorkBuddy 禁用 HTML 档**：文本通道零 HTML，折叠改由客户端「气泡内折叠卡片」承载——compact 档 `recallEchoNote` 末尾授权该通道（卡片默认收起、标题用首行原文、卡内只放统计汇总与依据，两行摘要与链接照常输出）；`MCP_INSTRUCTIONS` §2 + `recall_memory` description 同步 | `mcpHttp.ts` 一条文案段 + `mcpSchema.ts` 两处 + C4 用例 | 依赖 Agent 自觉调用；做不到的客户端忽略本条（措辞已写成可选） |
| W3（**否决，且已实测证伪**） | 把 `workbuddy` 加入 `html-details` 白名单 | `mcpRecall.ts` 一行 + 判档测试 | 2026-11-12 双端实测：WorkBuddy 解析 `<details>` 但**不提供折叠交互**（summary 与内容平铺展开、无三角）→ 加白名单只会让明细默认全铺，比两行摘要更差。白名单不含 `workbuddy` 从「用户口径」升级为「实证结论」 |

> **T8 补充（2026-11-12 晚）**：W3「把未实测客户端直接塞白名单」仍否决，但用户要求「其他 agent 也按 Qoder 效果渲染」，
> 于是改为**不靠名字赌**的三条通道：`qoder-*` 派生名前缀 / 请求头 `X-Memagent-Render: fold` / `MEMAGENT_HTML_DETAILS_CLIENTS` 环境变量。
> 详见 [`specs/recall-echo-contract.md`](../recall-echo-contract.md) §7.2。

> **决策（2026-11-12 用户原话：「workbuddy 禁用 html 要用气泡折叠方式」）**：WorkBuddy 恒走 `markdown-compact`，
> 文本里**不出现任何 HTML 标签**；折叠只在客户端气泡层实现（富媒体卡片），服务端**不新增档位、不改 `display` 契约、不动白名单**。
> 实际效果已在本会话目视验证（气泡内默认收起的折叠卡，点开显示统计汇总与 `[n]` 依据）。

## 1. RAG 引用锚点契约

按 RAG 标准做法，把「回显恒在末尾、与回答内容无锚点」改成「正文就地引用、末尾可核对」。

| 项 | 定义 |
|---|---|
| 编号 | `hits[i]` → `[1]`…`[N]`，1-based，按**返回顺序**（与 `score` 降序一致）；**不是** `mem_id`，不新增 `display` 字段 |
| 正文 | Agent 回答里采用某条命中记忆作为事实依据时，就地标注 `[n]`；编号必须存在于本次 `display.markdown` 的依据段，**不得编造编号** |
| 依据段 | `display.markdown` 里每条命中以 `[n]` 开头，给出高亮片段 + 层/热度 + 相关度 + 🎯 命中词 |
| 明细页锚点 | 每条命中卡片带 `id="hit-n"`，`/recall/<id>#hit-n` 可直达 |
| 诚实边界 | `hits=0` 不给任何 `[n]`；`scope=session` 的命中须标注「会话工作记忆」，不伪装成语义相关命中；`matched_terms` 为空时不写空 🎯 |

服务端指令同步点：`MCP_INSTRUCTIONS` §2 增加「就地标注 `[n]`、编号与依据段一致、不得编造」；
`recallEchoNote` 三档文案同步；`recall_memory` 工具 description 同步。

## 2. 气泡内折叠统计汇总 — 逐字模板

所有数字仍来自 `buildRecallHint` / `buildRecallSections`，**不新增任何计算**。
下列示例数字取自 2026-11-12 一次真实 recall，仅作模板示意。

### 2.1 `html-details` 档（Qoder 气泡内折叠，保守档零内联样式）

```
<details>
<summary>🧠 命中 3 条 · 依据「回显」「折叠」「ui」 ｜ 省 99.8% ｜ ▶ 展开本次召回汇总</summary>

**📊 本次召回统计汇总**
- 命中：3 条（1,959t） · 背景 5 条（293t） · 扫描 3,434 条
- 用量：本次注入 2,252t / 全量基线 1,757,064t · 预算 ok（软 1,500 / 警 2,000 / 硬 3,000t）
- 省量：1,754,812t（99.8%） · 估算 ¥0.00045（省 ¥0.351）
- 累计：今日 31 次（¥0.0124） · 全部 161 次（¥0.0404）

**🎯 本次用上的依据**
[1] <mark>回显</mark>逻辑与格式统计…（L1·hot · 0.30 ▮▮▮▯▯） 🎯 回显/明细
[2] 批次43 读取规范 §9.4 <mark>折叠气泡</mark>…（L1·warm · 0.22 ▮▮▯▯▯） 🎯 气泡/内联
[3] …

<details><summary>📎 项目背景 5 条（293t）</summary>

- …
</details>

<details><summary>⚠ 状态 1 项（证据不足）</summary>

- ⚠ 证据不足：未命中权威来源，建议事实优先重试
</details>
</details>
```

四条结构性改动：

1. **外层 summary 短收**：从 `mdInline(line, 500)`（6 段数字长句）改成 ≤80 字的
   「命中数 + top3 命中词 + 省量比例 + 展开提示」；命中词取 `hits[].matched_terms`，与打分同源。
2. **统计汇总前置**：4 行分组键值（命中 / 用量 / 省量 / 累计），替代原先逐段平铺的四段明细。
3. **依据段默认可见**：不套内层 `<details>`，展开外层即见 `[n]` 编号依据；命中片段高亮三件套保留。
4. **数字与告警降级**：背景 / Token / 费用收进二级折叠；告警独立成段且**只在 `warnings` 非空时生成**。

**零样式做层级**：徽标用 `「」`、相关度用 `▮▮▮▯▯` 字符条、高亮沿用已证实的 `<mark>`。
不赌 Qoder 的 sanitizer 是否放行内联 `style` / `<table>` / 嵌套 `open`；增强档（表格、色块、
默认展开依据段）须真机验证后再开开关。

### 2.2 `markdown-compact` 档（其余客户端，气泡内无折叠控件）

```
**🧠 命中 3 条 · 依据「回显」「折叠」「ui」 ｜ 省 99.8%（1,754,812t）｜ 估算 ¥0.00045**
**📊 汇总：注入 2,252t / 基线 1,757,064t · 背景 5 条（293t）· 今日 31 次 · 全部 161 次**
{仅 warnings 非空时追加警告行}

▶ [展开本次召回明细（统计汇总 / 命中依据 / Token / 费用）](http://127.0.0.1:<实际端口>/recall/<随机 id>)
```

保持「两行加粗摘要 + 一行链接」的既有约定，只把首行换成「命中依据前置」短摘要、
第二行换成统计汇总；链接文案加入「统计汇总」以与实际内容一致。URL **逐字保留**。

**〔T2 效果核对修正，2026-11-12〕** 首行的 `[n]` 编号**严格对应 `hits[i]`**（前 3 条命中，
每条只取一个代表词），不是「top3 命中词逐个编号」。原因：按词编号时，第 1 条命中若有 3 个共有词，
首行就会出现 `[3]`，与依据段 `[3]`（第 3 条命中）指代不同对象，正文就地引用会指错。
`buildRecallFoldSummary`（html-details 的 summary）仍用 top3 命中词且**不带编号**，两者不冲突。
compact / markdown-full 档因此有真实可用的 `[1][2]…`；完整依据段在 html-details / markdown-full / 明细页。

### 2.3 `markdown-full` / 无票据文字指引

纯 Markdown（零 HTML 标签）：加粗短摘要 + `📊 统计汇总` 四行 + `🎯 依据` 编号列表 +
四段明细；命中片段用 `**「…」**`，读法说明沿用现有文案。无票据场景的文字指引同步改口径，
仍要求「用同一个 query 再调一次并置 `detail=true`」。

## 3. 统计汇总字段表（全部来自现有账本，零新增字段）

| 组 | 字段 | 来源 |
|---|---|---|
| 命中 | `hits.length`、`savings.payload_tokens`、`scanned_memories` | `RecallResult` |
| 背景 | `background.items.length`、`background.tokens` | `RecallResult.background` |
| 用量 | `savings.injected_tokens`、`savings.corpus_tokens`、`budget.soft/warn/hard/status` | `RecallResult` |
| 省量 | `savings.saved_tokens`、省量比例 `saved/corpus` | `RecallResult.savings`（比例是展示派生，不改变账本） |
| 金额 | `money.this_call.cost_cny/saved_cny`、`money.today/all.calls`、`formatCny` | `RecallHint.money`；`null` 时输出「金额未开」，不编造 |
| 累计 | `rollup.today_calls/all_calls` | `RecallHint.rollup` |
| 状态 | `warnings`（`evidence_thin` / `budget.status=fused` / 今日旧账） | `buildRecallHint` |

> 省量比例是**唯一新增的展示派生值**（`saved_tokens / corpus_tokens`，分母为 0 时输出 `—`），
> 不写库、不改审计、不进 `display` 契约；须在规格与测试里明确它只是展示格式。

## 4. 明细页（唯一能做真按钮的载体）

`buildRecallDetailPage` 单函数改造，不动 MCP 契约：

| 区 | 内容 |
|---|---|
| 顶部状态条 | 一行：命中数 / 省量% / 预算状态 / 生成时间 / 有效期 |
| 统计汇总卡 | §3 四组，字段对齐（明细页可用真 `<table>` 与 CSS） |
| 命中依据 | 编号卡片 `[n]` + `id="hit-n"` 锚点 + 相关度条 + 层/热度徽标 + `<mark>` + 🎯 命中词 + 「复制引用 `[n]`」按钮 |
| 分段 | 依据 / 背景 / 用量 / 费用；折叠状态写 `localStorage`（同源、仅本机） |
| 就地反馈 | 「这条有用 / 没用」→ 生成可粘贴的 `feedback(confirm/reject, mem_id=...)` 指令文本；**页面无 MCP 令牌，不直接调工具、不冒充已生效** |
| 其余三段 | 沿用 `buildRecallSections`，数字与聊天侧同源 |

安全约束不变：全动态内容 `htmlEscape`、CSP `default-src 'none'`、URL 与页面不含令牌、
只监听 127.0.0.1、Host 绑定、30 分钟票据。

## 5. 字段级 AC / TC

### A 组 · RAG 引用锚点

| AC | 断言 | TC |
|---|---|---|
| A1 | 依据段每条命中以 `[n]` 开头，`n` 从 1 连续到 `hits.length` | 构造 3 条命中，逐行正则 `^\[\d+\]` 且序号连续 |
| A2 | `hits=0` 时全文不出现 `[n]` | 空命中用例反向断言 |
| A3 | 明细页每条命中带 `id="hit-n"`，与依据段编号一一对应 | 解析 HTML，比对 `id` 集合与编号集合 |
| A4 | §2 指令 / description / `recallEchoNote` 含「就地标注 `[n]`、不得编造」 | 字符串断言三处文案 |
| A5 | `scope=session` 命中标注「会话工作记忆」，不写 🎯 | 会话视图用例 |

### B 组 · 气泡内折叠统计汇总

| AC | 断言 | TC |
|---|---|---|
| B1 | 外层 `<details>` 默认收起（无 `open` 属性） | 正则断言首标签 |
| B2 | summary ≤80 字，含命中数 + top3 命中词 + 省量比例 + `▶` | 长度与子串断言；无 `matched_terms` 时退化为命中数 + 省量 |
| B3 | 展开后「📊 本次召回统计汇总」四行键值，每个数字与 `display.line` / `sections` 同源 | 数字逐项比对（不重算） |
| B4 | 依据段默认可见、不套内层 `<details>` | 断言 `<mark>` 所在段前无折叠包裹 |
| B5 | 告警段仅在 `warnings` 非空时生成 | 有/无 warning 两态用例 |
| B6 | compact 档保持两行摘要 + 链接，URL 逐字保留 | `detail_url` 全等断言 |
| B7 | `display.money === null` 时输出「金额未开」，无 `¥` | 未设单价用例 |
| B8 | TCP 无票据场景仍走文字指引、无伪造 URL | `detailUrl` 缺省用例 |

### C 组 · 展示要求三处同步

| AC | 断言 | TC |
|---|---|---|
| C1 | `recallEchoNote(mode)` 三份文案与实际 `display.markdown` 措辞逐字一致（含「统计汇总」「依据」） | `mcpHttp.test.ts` 按档断言 |
| C2 | `MCP_INSTRUCTIONS` §2 与 `recall_memory` description 同步 | schema 字符串断言 |
| C3 | `AGENTS.md` §1.1 / `CLAUDE.md` / `recall-echo-contract.md` 同步 | validate + 索引一致性 |

### D 组 · 不变项（反向断言）

| AC | 断言 |
|---|---|
| D1 | `display` 仍为 6 字段，`mode` 仍为 3 档 |
| D2 | `clientSupportsHtmlDetails` 白名单不变、`recallDisplayMode` 分支不变 |
| D3 | HTTP `content` 仍 4 块且顺序不变、`structuredContent` 不变 |
| D4 | 票据 TTL 30 分钟 / 随机 id / 容量 200 / 安全头与 CSP 不变 |
| D5 | `buildRecallSections` 四段数字逐字不变（本次只复用、不重写） |
| D6 | `hitHighlight.ts` 与 `agent.ts` 三处 `matched_terms` 填充不变 |

## 6. 影响面清单

| 文件 | 改动 |
|---|---|
| `src/core/memagent/recallInsight.ts` | 新增 `buildRecallFoldSummary` / `buildRecallEchoSummary`；重构 `buildRecallMarkdown` / `buildRecallCompactMarkdown` / `buildRecallDetailPage`；`buildRecallSections` 与数字口径**不动** |
| `src/core/memagent/mcpHttp.ts` | `recallEchoNote(mode)` 三档文案；四块 `content` 顺序不动 |
| `src/core/memagent/mcpSchema.ts` | `MCP_INSTRUCTIONS` §2 + `recall_memory` description；入参 schema 不动 |
| `src/core/memagent/__tests__/recallInsight.test.ts` | A/B/D 组用例 |
| `src/core/memagent/__tests__/mcp.test.ts` | TCP 端到端 `detail=true` 档旧首行断言更新（数字同源改由统计汇总核对）—— **T2 全量门禁实测补入，初版清单漏列** |
| `src/core/memagent/__tests__/mcpHttp.test.ts` | C/D 组用例 |
| `specs/recall-echo-contract.md` | §3 模板、§4 结构、§7 档位矩阵 |
| `AGENTS.md` §1.1、`CLAUDE.md` | 回显口径指针 |
| `meta/index.md`、`specs/code-index.generated.md` | 登记本规格、重建索引 |
| `design/ui/回显气泡_原型.html` | 原型（本轮已产出） |

**不改**：`mcpRecall.ts`（判档/白名单）、`mcp.ts`（TCP）、`recallDetailTickets.ts`、
`hitHighlight.ts`、`agent.ts`、`types.ts`、`paramsSnapshot.ts`、任何页面入口与 IPC。

## 7. 展示要求三处必须逐字一致

批次 32-C 专门修过「服务端展示要求与实际下发的 `display.markdown` 互相矛盾」。
改模板必须**同一次改动**同步：

1. `mcpHttp.ts:recallEchoNote(mode)` —— 三档各一份，说明本次是什么载体、含哪些段、禁止什么；
2. `mcpSchema.ts:MCP_INSTRUCTIONS` §2 —— 回显强制 + `[n]` 就地引用 + 不预展开 + URL 逐字；
3. `mcpSchema.ts:MCP_TOOLS[recall_memory].description` —— 摘要同上，供不注入 instructions 的客户端。

验收：三处措辞与实际 markdown 的段名（「统计汇总」「本次用上的依据」）逐字一致，
且 `recallEchoNote` 测试按档断言。

## 8. 原子任务拆分（每步展示成果 → 等人工确认 → 再下一步）

| 步 | 内容 | 交付物 |
|---|---|---|
| T1 | 原型 + 本规格（**已完成**） | `design/ui/回显气泡_原型.html`、本文 |
| T2 | 模板函数 + 单元测试（**已完成**） | `recallInsight.ts` + `recallInsight.test.ts`（A/B/D 组）+ `mcp.test.ts`（TCP 端到端旧断言同步） |
| T3 | 展示要求三处同步 + 测试（**已完成**） | `mcpHttp.ts`：`recallEchoNote(mode)` 三档；`mcpSchema.ts`：`MCP_INSTRUCTIONS` §2 + `recall_memory` description + `detail` 参数描述 + 头部注释；`mcpHttp.test.ts`：C 组 5 例 + 三处既有断言同步 |
| T4 | 明细页统计汇总与 `#hit-n` 锚点 + 测试（**已完成**） | `recallInsight.ts:buildRecallDetailPage`（状态条 / 统计汇总表 / `[n]` 命中卡 + `id="hit-n"` / 复制引用 / 就地反馈 / localStorage 折叠 / `mmAll`）+ `recallInsight.test.ts` T4-1…T4-6 + `mcpHttp.test.ts` 真页断言同步 |
| T5 | 文档同步 + 重建索引（**已完成**） | `specs/recall-echo-contract.md`（§0 数量总表 +1 行统计汇总/编号依据、§3.2–3.6 三档与明细页模板按实现重写、§4 共用出口分层、§6 `recallEchoNote` 口径、§7 档位矩阵「聊天侧呈现」、§8 `[n]` 引用约束、§10 三处新差异）/ `AGENTS.md` §1.1（两处档位描述 + `[n]` 引用锚点条目）/ `CLAUDE.md`（三档 + `[n]` 步骤） / `meta/index.md` / code-index |
| T6 | 交付闭环 + Qoder 真机验证（**已结案**） | 关旧端 ✅（两轮各 4 进程已终止）→ 重打包 ✅（安装包 SHA256 `cdcc542a…`）→ 验产物 ✅（包内 `dist-electron/main.cjs` 与源逐字节一致）→ 启新端 ✅（用户手动双击，4 进程 / 8202+8203+8204 LISTENING / `main.log` 有新记录）→ 核运行态 ✅（**Qoder 气泡内折叠卡渲染成功**，用户 2026-11-12 20:56 回填截图） |
| T7 | WorkBuddy 禁用 HTML → 气泡折叠档（**已完成**） | `mcpHttp.ts:recallEchoNote('markdown-compact')` 增可选「气泡折叠档」文案段（默认收起折叠卡、标题用首行原文、卡内只放统计汇总与依据、文本零 HTML、两行摘要与 URL 照常）；`mcpSchema.ts` `MCP_INSTRUCTIONS` §2 + `recall_memory` description 同步；`mcpHttp.test.ts` C4 用例；白名单与 `display` 契约**零改动** |
| T8 | 其他 agent 统一折叠效果（**已完成**） | `mcpRecall.ts`：白名单新增 `qoder-*` 前缀 + `extraHtmlDetailsClients()`（`MEMAGENT_HTML_DETAILS_CLIENTS`）+ `recallDisplayMode(client, detail, renderFold)`；`mcpHttp.ts`：`MCP_RENDER_HEADER='x-memagent-render'` + `clientDeclaresFold()`，`handleRpc`/`callTool` 透传，请求头解析与身份头**分开**；`mcpSchema.ts`：三处指令加「任何客户端可自证折叠能力」；测试：`recallInsight.test.ts` T8 三通道 + `mcpHttp.test.ts` 端到端 C5/C6；文档：`recall-echo-contract.md` §7 矩阵 + §7.2 |
| T9 | compact 档「三行粘成一坨」修复（**已完成**） | 用户实测回填：WorkBuddy 里「🧠 摘要 / 📊 汇总 / ⚠ 告警」被合并成一整段。根因：行间用单 `\n`，Markdown 视为软换行。修法：`buildRecallCompactMarkdown` 改 `join('\n\n')`（空行=段落硬分隔）；**`markdown-full` 档同源缺陷一并修**（`buildRecallMarkdown` 的摘要与告警块）；用例 `B5` 加「带告警 5 段」、`B6/B8` 加 `not.toMatch(/\*\*\n\*\*/)`、htmlDetails:false 档加两段断言；变异「回退单换行」→ 精确红灯 → 还原复绿 |
| T10 | 明细链接不可点兜底（**已完成**） | 实测：WorkBuddy 桌面端与手机端点 `/recall/<id>` 均无反应（手机 = `127.0.0.1` 不可达；桌面端 = 客户端不跳外链）；服务端本身 200（`curl` 与系统浏览器均验证通过），旧链接 404 是「票据存内存 + 重启清空 + 30 分钟 TTL」。修法：compact 档链接后追加一行「📌 链接点不开时…直接说「看明细」即可」，给一条不依赖链接的取明细路径；`display` 契约与 `detail_url` 不变 |
| T11 | 折叠卡从「可选」升级为「必做」（**已完成**） | 2026-11-12 用户验收富媒体折叠卡形态（截图：默认收起、标题=首行摘要、点开看汇总与依据）→ `recallEchoNote('markdown-compact')` 的 `bubbleCard` 措辞改为「若宿主能渲染折叠卡/面板，**必须**输出一张默认收起的卡」，卡内结构写死为「📊 汇总 + 🎯 依据 [n]」；`MCP_INSTRUCTIONS` §2 与 `recall_memory` description 同步；C4 用例补「**必须**为本次召回输出一张」「已验收」两条断言。纯指令文案改动，不改判档、不改 `display` 契约 |
| T12 | 展开分区顺序 + 汇总/明细齐备（**已完成**） | 用户 22:39 拍板「背景 → 命中 → 依据 → 最后加证据不足，其他保持原样，点开可看汇总和明细」。`bubbleCard` 改为：顶部 📊 统计汇总（含 Token/费用数字），明细固定顺序 📎 项目背景 → 🧠 命中记忆 → 🎯 依据（含 [n]·相关度·命中词·正文片段）→ ⚠ 证据不足（仅真有告警时出现、放最后）；`mcpSchema.ts` 两处同步；C4 加顺序正则断言；`recall-echo-contract.md` §7.1 记录 |
| T13 | 项目背景逐条独立成行（**已完成**） | 用户 22:45 回填截图「按照这个可折叠显示，命中前面增加项目背景」：背景虽已排在命中之前，但被压成一整段、读起来像没展开 → `mcpHttp.ts:bubbleCard` 明细顺序里的 📎 项目背景追加「**逐条独立成行**，每条含类别与正文片段，不压缩成一整段」；`mcpSchema.ts` 的 `MCP_INSTRUCTIONS` §2 与 `recall_memory` description 两处同步；`mcpHttp.test.ts` C4 加 `expect(compact).toContain('逐条独立成行')`；纯指令文案改动，判档 / `display` 契约 / 白名单零改动。22:49–22:50 已重打包，运行端 `recall_memory` 返回的【展示要求】已包含新口径；`recall-echo-contract.md` §7.1 同步登记 |

**提交纪律（2026-11-12 升级，长期生效）**：全门禁 → 按 `AGENTS.md` §0.2 重打包并验产物 →
**【停·等用户实测打包产物】** → **【停·等用户明确确认】** → 才允许 `commit` / `push`。
提交前单独展示「改动清单 + 三道闸门输出 + 打包产物核验 + 拟用提交信息」；
不把工作区里非本轮产生的在途改动带入提交。

## 9. 三道闸门计划（每步收尾）

- **A · 影响面回归**：§6 清单逐项核对 + `npm run typecheck` / `lint` / `test:gate` /
  `python tools/validate_project.py` / `generate.py --check` / `npm run check:no-demo` /
  `npm run code:index:check`；D 组反向断言证明既有行为未变。
- **B · 效果验证**：每条 AC 一条正向端到端用例；真实跑一次 `recall_memory`，把返回的
  `display.markdown` 与本文 §2 模板逐字比对；明细页 HTTP 200 + `#hit-n` 存在 + 数字同源。
- **C · 变异验证**：至少一次代码级变异（例如临时去掉 `[n]` 编号生成 → 指定 A1/A3 用例必须红灯
  → 原样还原 → 必须绿灯）；外加输入/状态变异矩阵：
  `hits=0` / 有 `matched_terms` / 无 `matched_terms` / 有 warning / 无单价 /
  `scope=session` / TCP 无票据 / `detail=true` / 白名单客户端。

T1 为纯文档与原型，无运行时改动 → B/C 无对象可验，该轮只跑 A（索引一致性 + 静态门禁），
如实标注，不冒充三栏齐全。T2 / T3 均有运行时改动 → A/B/C 三栏全跑，记录见交付说明与记忆日志。

## 10. 待验证项与风险

| 项 | 说明 |
|---|---|
| 折叠效果目视 | ✅ **Qoder 已实测通过**（2026-11-12 20:56 用户回填：气泡内 `▶` 折叠卡正常渲染）。**WorkBuddy 双端实测（2026-11-12 21:31）：`<details>` 被解析但不提供折叠交互**（summary 与内容平铺、无三角）→ 不加白名单是实证结论（§7.1），折叠只在「点明细页链接」与「Agent 富媒体卡片」两处成立。DSH 两次实测把标签露成纯文本。其他 agent 按 T8 三通道自证即可 |
| Qoder sanitizer | 已知 `<details>/<summary>` 可渲染（本轮实证）；内联 `style` / 嵌套 `open` / `<table>` / `<details>` 内 Markdown 表格**仍未证实** → 保守档零样式，增强档验证后再开 |
| 真按钮 | 气泡内带回调的按钮做不到；明细页按钮只做本地交互，不冒充服务端状态 |
| 交付闭环 | 有运行时源码改动 → 必须走 §0.2 五步；重启后 L0 写密钥默认 `write_unlocked:false`，需在安全页重新解锁（否则采集诚实进 `cursor-hold(l0_locked)`，属预期行为） |
| 在途改动 | 工作区有 11 个非本轮产生的未提交改动（L0 成员写解锁口令相关），不碰、不带入提交 |
| 规格声称 ≠ 实现 | `specs/接入Agent行为规范.md` §3.1 写「折叠气泡首选、取消 markdown-full/单行」，而实际仍是 3 档 + 单行兜底；本文按**代码实际**设计，不按该规格的档位口径推翻实现 |
