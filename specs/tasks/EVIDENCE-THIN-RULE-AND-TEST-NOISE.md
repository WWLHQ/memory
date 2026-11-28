---
title: #46 统计口径迁移 + #47 测试噪音防复发 —— 实施记录
date: 2026-11-27
status: implemented（2026-11-27 实施，三闸门通过；未提交，等人工确认）
scope: #46 证据不足率口径归一读取；#47 测试残留检测门禁。不改召回打分/λ/阈值/排序，不改真实账本
depends: RECALL-WEEK-1.md §3/§4/§6；18a404c（口径切换）；11-24 tenant-normalize（测试记忆已清）
---

# #46 统计口径迁移 + #47 测试噪音防复发

> 本记录的事实均为 2026-11-27 现查，不复述立项描述。两项立项描述与当下现状不符，实施时按现查调整（见 §1）。

## 1. 立项描述 vs 现查事实（两处翻转）

**#46**：立项以为只改 `recall-stats.mjs`。现查 `evidence_thin` 消费面有 5 处读历史审计字段——`tools/recall-stats.mjs:123`、`agentUsage.ts:98`、`feedbackSignal.ts:166`、`regression.ts:87-96`、`web/audit/coreAudit.ts:41`；另有 2 处读当轮实时值（`recallInsight.ts:342`、`agent.ts:557`）本就是新口径、不动。权威真值源 `mems_detail`（`agent.ts:638` 落 `[mem_id,relevance,f,imp,conf,boost]`）：当前账本 319 条全带、一周窗口 254 条带。18a404c（2026-11-22 19:56 +0800）改 `score<0.3` → `relevance<0.3` 但字段名不变、无版本标记字段。

**#47**：立项描述要"清理 4 条 T3-PENDING 记忆"。现查该批在 11-22 备份 4 条 → 11-23 重置备份 4 条 → **11-24 tenant-normalize 备份 0 条 → 当前账本 0 条**，已被顺带清空，无可清理对象。产生路径：11-14 05:38 经 MCP write 注入（`category=insight, l0_encrypted, refined_by=stub, llm_calls=0`），同日 `forget` 只降 importance/confidence 未真删，故 11-14~11-15 仍被真实 query 命中。当前账本另 2 条含 `E2E-TEST` 字样的是 codex 汉化脚本正文（`mem_01M843TB17/TB6S`），非噪音。

## 2. #46 实施方案（已实施）

单一真源 `src/core/memagent/evidenceThin.ts`，纯函数 `resolveEvidenceThin(detail)` 按优先级归一，5 处消费点全改走它：

| 优先级 | 条件 | 返回 | source |
|---|---|---|---|
| 1 | `evidence_thin_corrected` 是 boolean | 原值 | `corrected` |
| 2 | `evidence_thin_rule='relevance'` + boolean | 原值 | `relevance` |
| 3 | 有 `mems_detail` 且取到 relevance | `every(rel<0.3)` 实时重算 | `recomputed` |
| 4 | 仅旧 `evidence_thin` boolean、无 rule 无明细 | **null（不可用，跳过）** | `legacy` |
| 5 | 都没有 | null | `unknown` |

**关键设计**：第 3 级实时重算是方案"历史回填 `evidence_thin_corrected`"的等价替代——纯读、不改账本；第 4 级返回 null 而非旧假象值，是实测纠错（见 §4 C 闸门）。落侧 `agent.ts` 新行并列写 `evidence_thin_rule='relevance'`（常量 `EVIDENCE_THIN_RULE`）自证口径。JS 工具 `recall-stats.mjs` 用动态 import 复用同一 TS 真源（与既有 `forgetting.ts` 引用方式一致），不在工具侧重复解读口径。

**改动文件**：新建 `evidenceThin.ts`；改 `agent.ts`、`agentUsage.ts`、`feedbackSignal.ts`、`regression.ts`、`web/audit/coreAudit.ts`、`tools/recall-stats.mjs`。`web/growth/GrowthPanels.tsx` 是聚合 metrics 的下游（上游已归一），未改。

## 3. #47 实施方案（已实施，按现查调整为"验证 + 防复发"）

立项的"召回侧硬过滤 + category 隔离标记"无可靠标识可用（category 固定六类无 `test`；测试记忆写入时 client 未标识；对象已清空），硬做会误伤真实记忆。改为**只读检测门禁**：

- 新建 `tools/check-test-noise.mjs`：扫账本，命中 `T3-PENDING-E2E-TEST` 标记即判红（exit 1），不改账本；白名单具名 3 条（2 条汉化正文 + 1 条本轮方案记忆，含字样但属真实内容），写明理由，不按内容模糊放行。
- 带 `--self-test` 变异自测（造噪音判红、白名单/真实/空判绿）与 `--json`。
- 接入 `package.json` 的 `check:test-noise` 脚本并挂进 `verify:fast`。
- 单测 `tools/__tests__/check-test-noise.test.mjs` 锁 5 例。

## 4. 三道闸门

**A·影响面**：`npm run typecheck` 全绿；`npm run lint` 本轮文件零 error（现存 5 error 全在历史未跟踪 `dsh-plugins/`，非本会话）；`npm run code:index -- --write` 重建 463 源码/181 文档，`package.json` 哈希前后一致，`code:index:check` 绿。

**B·效果**：`recall-stats.mjs` 跑一周窗口（394 次真实 recall、剔除自造 client），归一后 `evidence_thin_rate=4.72% (n=254)`，与权威逐条重算 `thin=12/254=4.72%` 完全一致（初版未做第 4 级 null 时是 27.16%，暴露 legacy 假象混入，已修正）。`check-test-noise` 现查扫描 5244 条记忆、测试残留 0、白名单 3 豁免。

**C·变异**：`evidenceThin.test.ts` 11 例全绿（含 corrected 优先、rule 优先于重算、recomputed 高低相关、legacy→null、阈值 0.3 边界、对象形状兼容、多条全低才 thin）；`check-test-noise` 变异自测 4/4、工具单测 17/17。

**全量测试与 fixture 修正**：`npm run test:coverage` 初跑 8 个失败用例——均因相关测试 fixture 只写 `evidence_thin` 无 `rule`/`mems_detail`，被新口径判 legacy→null。按「测试跟着契约走」修正 6 个 fixture 构造点补 `evidence_thin_rule:'relevance'`（agentUsage/feedbackSignal/regression/forgetting/mcpGcTools/AuditPage fixtures，只改 fixture 不改断言），复跑 **343 文件 / 4352 用例全绿**。（`WritePage` 那条登录态失败是既有、与本轮无关；exit=1 来自沙箱 safe-delete 拦截清理 `coverage/.tmp`，非测试失败。）

## 5. 遗留与边界

- 未提交、未推远端，等人工确认（按项目提交纪律）。
- `evidence_thin_corrected` 回填脚本未写——实时重算已覆盖读取侧全部消费点，回填仅作可选固化，暂不需要；若后续要固化历史真值再补。
- 第 4 级（legacy→null）会让一周窗口参与率从 394 降到 254（`evidence_thin_known`），这是**诚实跳过**旧口径假象，不是数据丢失；报告 RECALL-WEEK-1.md 本就按 254 条口径出 4.72%。
