# REQ-004 → 回显命中片段高亮（方案 C）· AC/TC

> **背景**：2026-11-11 用户决定 **REQ-004「Agent 界面内联记忆标识」整体作废**——
> 不再做一套独立的标识 UI（演示页 + 悬浮层已删除）。原先规格 §2.1 的
> 「命中片段定位（该条中与本次 query 相关的关键句高亮）」**保留能力、换载体**：
> 落到 `recall_memory` 的**回显**里（`display.markdown` 与一次性本机明细页）。
>
> 采用**方案 C**：后端只产出 `matched_terms`（相关性判定），渲染层负责在文本里定位 span 并高亮。
> 之所以不让后端直接给 offset：正文会先截断再渲染，offset 会随截断失效；让渲染层在「最终要显示的那段文本」上定位，才不会标错位。

## 0. 为什么「一眼看出是召回命中」需要三件套

只给黄色背景，用户看到的是「一段被涂黄的句子」，仍不知道它凭什么被涂。
只给命中词清单，用户又得自己在正文里找。两者叠加才自解释：

| 层 | 表现 | 回答的问题 |
|---|---|---|
| ① 片段高亮 | HTML `<mark>`（黄底）／纯 Markdown `**「…」**` | **用的是哪句** |
| ② 命中词清单 | `🎯 命中「超时」「重试」` | **为什么是它** |
| ③ 读法说明 | 段标题后缀 + 明细页 legend | **这黄色是什么意思** |

③ 只在真的有命中词时出现（`hits` 里存在 `matched_terms` 非空），没有命中就不解释、也不高亮。

## 1. 数据链（方案 C）

```
query ─┐
       ├─ tokenize(query) ∩ tokenize(content) ─→ matched_terms[]   ← 后端（hitHighlight.matchedTerms）
content┘                                                    │
                                                            ▼
                                     Hit.matched_terms（对外契约，可审计「凭什么命中」）
                                                            │
渲染时对**截断后的那一段文本** ─────────────────────────────┤
       pickHitSpans(terms, text) ─→ [{start,end}]           ← 渲染层（hitHighlight.pickHitSpans）
                                                            │
                                    <mark>…</mark> / **「…」**  ← 三处回显共用
```

**与召回打分同源**：召回打分本身是 `vector.ts` 的 hash bag-of-words（中文 2-gram / 英文按词），
`matchedTerms` 复用同一个 `tokenize`。标出来的词就是打分真正用到的词，不是事后另编一套「看起来相关」。

## 2. 字段级 AC / TC

### A 组 · 命中依据计算（后端）

| AC | 判定 | TC | 落点 |
|---|---|---|---|
| AC-HL-01 | `matchedTerms(query, text)` 返回两者共有 token；中文 2-gram 命中（query「接口超时怎么调」↔ 正文「超时重试上限 3 次」→ 含 `超时`） | TC-HL-01 | `hitHighlight.test.ts`「中文 2-gram 命中」 |
| AC-HL-02 | **无共有 token → 空数组**（渲染层据此不高亮，绝不拿最长句冒充） | TC-HL-02 | `hitHighlight.test.ts`「完全没有共有词 → 空数组」 |
| AC-HL-03 | 空 query / 空正文 → 空数组，不抛错 | TC-HL-03 | `hitHighlight.test.ts`「空 query / 空正文」 |
| AC-HL-04 | 英文停用词（the/is/a…）与单字符 token 不进命中依据 | TC-HL-04 | `hitHighlight.test.ts`「虚词不进命中依据」 |
| AC-HL-05 | 纯标点/空白构成的 token 不算命中（2-gram 会切出「，。」） | TC-HL-05 | `hitHighlight.test.ts`「纯标点/空白构成的 token」 |
| AC-HL-06 | 大小写不敏感（`Timeout` ↔ `timeout`） | TC-HL-06 | `hitHighlight.test.ts`「大小写不敏感」 |
| AC-HL-07 | `limit` 生效，长片段优先（同样命中，长 token 更有说服力） | TC-HL-07 | `hitHighlight.test.ts`「limit 生效」 |
| AC-HL-08 | `Hit.matched_terms` 为**可选**字段：旧账本/会话视图没有它，不影响既有回显 | TC-HL-08 | `types.ts` 可选声明 + `mcp.test.ts` 既有 hits 断言全绿 |

### B 组 · 区间定位（渲染层）

| AC | 判定 | TC | 落点 |
|---|---|---|---|
| AC-HL-10 | 命中词定位到正确 offset（切片回读 === 命中词） | TC-HL-10 | `hitHighlight.test.ts`「单个命中词定位到正确 offset」 |
| AC-HL-11 | 相邻 bigram 合并成一片（接口/口超/超时 → 「接口超时」），不出现 2 字碎块 | TC-HL-11 | 「相邻 bigram 合并成一片」 |
| AC-HL-12 | **跨句不合并**：中间有 `。；！？` 时保持两片 | TC-HL-12 | 「跨句不合并」 |
| AC-HL-13 | `terms` 为空 → 空区间 | TC-HL-13 | 「terms 为空 → 空区间」 |
| AC-HL-14 | 命中词在截断后文本里已不存在 → 空区间，**绝不标别处** | TC-HL-14 | 「命中词在截断后的文本里已不存在」 |
| AC-HL-15 | `maxSpans` 限制片段数（默认 3），取最长的几片 | TC-HL-15 | 「maxSpans 限制片段数」 |
| AC-HL-16 | 重叠命中不重复出片 | TC-HL-16 | 「重叠命中不重复出片」 |
| AC-HL-17 | `minLen` 可调（抬到 5 时两字命中不标） | TC-HL-17 | 「minLen 可调」 |

### C 组 · 回显渲染（三处共用一份口径）

| AC | 判定 | TC | 落点 |
|---|---|---|---|
| AC-HL-20 | `html-details` 档（Qoder 等）：命中行内片段用 `<mark>` 包裹 | TC-HL-20 | `recallInsight.test.ts`「回显高亮」 |
| AC-HL-21 | `markdown-full` 档：用 `**「…」**`（零 HTML 标签口径不变） | TC-HL-21 | 同上 |
| AC-HL-22 | 明细页 `/recall/<id>`：`<mark>` + legend 说明「黄色 = 与本次提问重合」 | TC-HL-22 | 同上 |
| AC-HL-23 | 命中行尾追加 `🎯 命中「…」`，**无 matched_terms 时不追加**（旧口径零变化） | TC-HL-23 | 同上 |
| AC-HL-24 | 段标题读法说明**只在有命中词时**追加（旧 fixture 无 terms → 标题逐字不变） | TC-HL-24 | `recallInsight.test.ts` 既有 `toEqual` 标题断言保持绿 |
| AC-HL-25 | 高亮不改数字、不改截断口径：`（相关度 0.90）` 等字段位置不变 | TC-HL-25 | 既有 2727 例回归全绿 |

### D 组 · 诚实边界（必须锁死）

| 边界 | 口径 |
|---|---|
| 未命中 / 无共有词 | **不标**，也不写「🎯」空标签 |
| 命中词被截断切掉 | 该片不标（不移动到别处凑一个） |
| cold/dormant 只有 L2 占位符 | 只在回显给的那段文本内标，**不越权回读 L1 原文** |
| 同义/近义（query 说「慢」、正文写「延迟」） | **不标** —— 那需要检索侧语义，前端猜不准，会把「疑似」标成「确证」 |
| 渲染安全 | 只用文本切片拼 `<mark>`，**不用 innerHTML**；正文仍走 `htmlEscape` |
| 会话视图（`scope=session`） | 不走语义检索，`matched_terms` 不填（不把「最近 N 条」伪装成「相关命中」） |

## 3. 代码落点

| 文件 | 职责 |
|---|---|
| `src/core/memagent/hitHighlight.ts` | `matchedTerms` / `pickHitSpans` / `displayTerms`（纯函数，零依赖） |
| `src/core/memagent/types.ts` | `Hit.matched_terms?: string[]` |
| `src/core/memagent/agent.ts` | recall 主路径 / 冷回填 / 个人记忆命中处填充 `matched_terms` |
| `src/core/memagent/recallInsight.ts` | `buildRecallSections` 的命中行装饰 + 明细页 legend（三处回显共用） |

## 4. 复核命令

```bash
npx vitest run src/core/memagent/__tests__/hitHighlight.test.ts   # 本文件的纯函数层
npx vitest run src/core/memagent/__tests__/recallInsight.test.ts   # 回显渲染层
npm run test:gate                                                  # 全量回归
```

## 5. 已作废的旧载体（勿恢复）

`src/web/InlineAttribution/`、`src/inlineAttribution/`、`src/types/inlineAttribution.ts`、
`inlineattribution.html`、`floatattribution.html`、`e2e/inlineAttribution.spec.ts`、
5 条 `floatAttribution:*` IPC（主进程 / preload / ipcStorage / 日志标签 / Overview 悬浮层按钮）——
已于批次59 全部删除，由 `phase5DHonesty.test.tsx` 断言「目录与入口都不存在」防回流。
