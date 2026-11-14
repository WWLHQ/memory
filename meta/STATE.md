# 项目状态快照（压缩上下文 · 新会话直读）

> 新会话只需读 `meta/index.md` + 本文件即可接手，无需重读全部文档，省 token。

## 一句话定位
本工作区 = **工作法体系** + 真实项目「**多 Agent 记忆助手**」（需求规格与原型已结构化并跑通首个功能）。

## 当前状态（2026-11-14 08:05 压缩快照 · 优先于下方历史段落）

### A9 / A10 / A11 纯内核收口（2026-11-14 08:05 · **最新** · 未打包 / 未提交 / 未 push）

- **范围**（详见 `specs/reports/召回模式全程序审查报告-2026-11-13.md` §5.1 / §5.2）：
  - A9：`buildRecallModeLine()` 消费 `dispatch.reason`（16.5 降级不再伪称「用户指定」）；观测档 banner 写「自动」与回显同口径（不新增原型外 UI 行）；`mode_dispatch` 审计落 `source`。
  - A10：`normalizeScene()` 内核唯一真源（非法/空 scene 回落 default + reason 如实标注）；`scoreMode()` 大小写归一化；`default.candidates` 扩到 5 套；`viaFallback` 真实化；`top_k` 整数校验；`dispatch.secondary` 与 `secondary_mode_hint.mode` 恒一致。
  - A11（纯内核子集）：A5 取材池复用 `hardFilter`；次模式块前移，hint 优先取材、`backgroundExcludeIds` 让位，杜绝重复注入。
- **三处报告误判已纠正并写入报告 §5.1**：① 原型 `syncSceneMode()` 本就有「critical 禁极简→改回自动+toast」，**不删 QueryBar 改写**（删了反而偏离原型）；② 中文名「顶层洞察」vs「顶层洞察优先」不动，待补原型/批准；③ `pattern_reasoning.weights` 0.90 是**规格书 §2.4.3 自身矛盾**（方案第 30 行），`specs/` 才是 SSOT，**不改代码**。
- **闸门**：TDD 先红 11 条（逐条精确）→ 四件套 64/64 绿；`test:gate` **252 文件 / 3028 例 / 0 失败 / 0 重试**；typecheck / oxlint(688 文件 0 错) / check:no-demo / validate(0 失败) / generate --check 全绿；索引重建 380 源码 / 142 文档后 check 通过。变异 6 处精确打红 6 条，二进制还原后四文件 SHA256 一致、复绿。
- **关键结论**：`default.candidates` 扩到 5 套**不改变 auto 档打分**（A3 权重透传只对手动生效，auto 继续 `growth:v1`），故既有回归零打红。
- **未做（下一批）**：次模式内容进回显（要再动 A8 契约）、`conflictRule` / 热更词表 / `config` 接线、`critical` 最低深度、方案 §3 全套 UI（原型无对应控件，须先补原型或显式批准）、中文名统一、规格书权重和修订。
- **运行态**：8204 仍跑并行会话 23:49 的包；真机取证 `display.markdown` 有 `⚙ 模式`、`display.line`/`content[3]` 无 → **不含 A8 及之后任何改动**。重新打包会覆盖该包，须用户拍板。
- **在途改动**：`recallHard.ts` / `recallHard.test.ts` / `RecallHardCard.tsx` / `params/recallHard.ts` 属并行会话，未碰 / 未还原 / 未提交；`specs/code-index.generated.md` 为本轮索引重建产物；另有并行会话新产生的未跟踪 `specs/reports/dsh-hindsight-local-调研报告-2026-11-14.md`。**禁 `git add .`**。
- **纪律**：【停·等用户实测】→【停·等用户明确确认】→ 才 commit / push。

### A8 回显契约补齐（2026-11-14 00:17 · 未打包 / 未提交）

- **审查报告落盘**：`specs/reports/召回模式全程序审查报告-2026-11-13.md` —— 5 条只读实证探针 + 8204 真机取证（`display.markdown` 有 `⚙ 模式`、`display.line`/`content[0]` 没有、`content[3]` 仍写「两行加粗短摘要」）+ BUG 清单 + A8–A11 排序。
- **A8 真因**：A6 的模式行在代码里已生效，失效点是「服务端下发的展示要求 + 单行兜底字段」。改 `mcpSchema.ts`（instructions / 工具描述 / detail 描述）、`mcpHttp.ts`（`recallEchoNote` 三档 + 气泡卡文案 + 兜底说明）、`recallInsight.ts`（`hint.line` 单行末尾追加 `⚙ 模式` 段）、`specs/recall-echo-contract.md`（全模板同步）。会话视图 `dispatch=null` 仍不编模式行。
- **测试**：C 组夹具改真实 `dispatch`；新增四档载体断言、单行兜底断言、契约四处同口径断言、B6 的「真实 dispatch」对偶用例。TDD 先红 7 例 → 改完 87/87 绿。
- **门禁**：typecheck / oxlint(688 文件 0 错) / no-demo / code:index(380 源码·140 文档) / validate / `tools/generate.py --check` 全绿；`test:gate` **252 文件 3016 例 0 失败**。一次既有 flaky（`fileStorage.reloadOnMtime` mtime 同毫秒）单跑复绿、重跑全量复绿，与本轮无关。
- **变异 3 次**：去 `line` 模式段 → 3 红；`mcpSchema` 去 `⚙ 模式` 标记 → 1 红；`mcpHttp` 去 `⚙ 模式` 标记 → 6 红；三次还原后三文件 SHA256 与变异前一致并复绿。
- **未打包**：当前 8204 跑的是并行会话 23:49 的包（含批次62 A3 修复，**不含 A8**）。打包会覆盖该包 → 须用户先定；真机验 A8 需新包。
- **在途改动**：`recallHard.ts` / `recallHard.test.ts` / `RecallHardCard.tsx` / `params/recallHard.ts` 属并行会话，未碰 / 未还原 / 未提交；`specs/code-index.generated.md` 为本轮索引重建产物。**禁 `git add .`**。
- **纪律**：【停·等用户实测】→【停·等用户明确确认】→ 才 commit / push。后续 A9/A10/A11 见审查报告 §5。

### 召回模式接线 A1–A6（2026-11-13 22:50）

- 规格与落地口径全在 `specs/召回模式设计与实现方案.md` §2.4/§2.6，这里只留「接手要看什么」。
- **A1 契约**：`RecallResult` 的 `hit_keywords`（必填）/ `secondary_mode_hint` / `dispatch`（A6，显式 `null`）。缺字段 = `typecheck` 报错，`recallContract.test.ts` 用 `@ts-expect-error` 锁住。
- **A2 分流**：`agent.recall()` 顶部唯一裁决入口 `resolveMode`；非法 `mode` 抛 `MemAgentError`；`mode_dispatch` 审计记 `mode`（建议）与 `applied_mode`（实际）。**自动分流到极简仍只是观测**：`mode='minimal'`、`applied_mode='auto'`，回显如实报「分流建议极简 · 本轮按默认口径执行」。
- **A3 权重 / A4 分层 / A5 次模式**：只对手动模式生效（auto 档逐条不变，这是既有回归全绿的原因）；三张表 `selectPriority`/`trimOrder`/`disabledLayers` 从零引用变成有消费方；次模式 ≤200t 只作 hint，不并入 hits、不计 payload。
- **A6 回显贯通**：`dispatch` 与审计**同一份对象**→ `buildRecallModeLine()` 在 compact / full / html / 明细页四处输出 `⚙ 模式：…`；Web 检索页删掉第三套词表 `autoDispatch`，改读内核，`history_query` 不再降级，次模式提示不再硬编码。
- **闸门**：`test:gate` 252 文件 3009 例 0 失败；typecheck / oxlint(688 文件 0 错) / code:index / validate / generate --check 全绿。变异 3 次（`dispatch:null` → 11 红；`history_query→default` → 2 红；次模式恢复硬编码 → 1 红），均还原复绿。
- **未做**：`preload`（依赖会话态，本项目 MCP 是无状态调用，暂缓）；**「自动极简真执行」仍留着**——一旦执行会关掉项目背景与冷层补查，须单独评估。

### 批次62 续：A/B/C 三层 UI 开关（本轮）
- 参数页新增卡片「硬前置召回」：三层各一组**「启用 / 不启用」二选一按钮**（不是 checkbox）；原型 `design/ui/硬前置召回开关_原型.html` 为唯一事实来源，已注册进 `design/ui/index.html`（10 个原型）。
- **配置真源** `src/shared/recallHardConfig.ts` → `<数据根>/recall-hard-config.json`。**运行态不拿配置冒充**：A 读宿主 `settings.json` 里是否真有钩子、B 读网关 handle 是否在跑、C 读服务端当前求值值；卡片徽标显示真值，按钮高亮显示草稿，不一致时明写「有未保存改动」。
- **主进程** `src/electron/recallHard.ts`（`RecallHardController`：落盘 / A 合并摘除+`.bak` / B 启停 / C getter）+ `src/electron/recallGateway.ts`（内置 8300 反代，复用 `recallPrelude.ts`）。`main.ts` 在 mcpToken 就绪后建控制器并 `init()`，`runMcpHttpServer({ strictRecallGate: controller.cStrict })`（**运行时 getter，切换即时生效**），退出 `recallHard.stop()` 释放端口。
- **IPC**：`recallHard:state`（任意会话）/ `recallHard:set`（仅管理员，审计只记字段名与三层布尔，不记上游地址）；`preload.ts` + `hostBridge.ts` 已接。
- **A 的打包态**：`build-electron.cjs` 新增 esbuild 步骤 → `dist-electron/recall-hard/force_recall.mjs`（自包含 ESM，宿主用系统 node 直接跑，不依赖仓库源码/TS 剥离）；业务逻辑抽到 `src/core/memagent/recallHook.ts`，`recallHookCli.ts` 与 `.codebuddy/hooks/force_recall.mjs` 都只是 IO 壳。自检从 10 例变 **`SELFTEST_OK 13/13`**（条数由断言数决定，不写死），两条入口输出一致。
- **闸门**：`npm test` 245 文件 **2971 例全绿**；typecheck（web+electron）与 oxlint（681 文件）0 错；B 真 HTTP 探针（system 首位置顶 / 原规则不丢 / 无命中逐字透传 / 幂等）；C getter 关→开→关即时生效；新增 38 例。**变异 2 次**：卡片 active 判定反转 → 1 例精确红；`mergeHostHooks` 的 `if (enabled)` 改 `if (true)` → 3 例红；两次还原后 SHA256 与变异前一致且复绿。
- **打包（19:49 完成）**：`release/installer/MultiAgent Memory-0.1.0-setup.exe` 128,012,825B（SHA256 前缀 `9344F1AF36959A03`）、`app.asar` 前缀 `8A506D6022C003BF`；包内 `dist-electron/recall-hard/force_recall.mjs` 9,974B，`node --self-test` = `SELFTEST_OK 13/13`；`main.cjs` 含 `recall-hard` / `recallHard:state` / `force_recall.mjs` / `recall-hard-config.json`；`app.asar` 含「硬前置召回」「rh-layer」「保存并生效」「请先填写上游地址再启用 B」「recallHard:state/set」。打包后 `package.json` 无改动。**【停·等用户实测】→【停·等用户明确确认】才 commit/push。**

## 历史快照（2026-11-13 08:45 · 批次62 内核三件套）
- **批次62「硬前置召回」A/B/C 全部落地**（规格 `specs/RECALL-HARD-PREFIX.md`）。目标链路：用户输入 → 强制召回 → 拼进上下文 → 再推理。
  - **能力边界（先记牢）**：宿主 hooks 只给 `additionalContext`，**没有任何改写/替换 system prompt 的字段**；`systemMessage` 是给用户看的、不传给 Agent。所以「拼进 system 最前面」只有 B 能做到；C 拦不住「一个工具都不调直接回答」。
  - **单一真源** `src/core/memagent/recallPrelude.ts`：纯函数零 IO，Node 22.18+ 原生 TS 剥离可被 `.mjs` 脚本与 vitest 共用。只注入 `hits[].content`，绝不注入 `display.markdown`/回显话术；`[RECALL_PRELUDE_V1]` 开闭标记保证幂等。
  - **A** `.codebuddy/settings.json` + `.codebuddy/hooks/force_recall.mjs` + `tools/install-force-recall.mjs`（默认 dry-run，`--apply` 才写、留 `.bak`、双宿主须 `--host`）。全链路 fail-open；令牌只读本机文件且只发 loopback。自检 `--self-test` 10/10；真实 8204 注入 1378 字符不含回显话术；死端口回 `{continue:true}`。
  - **B** `tools/recall-gateway.mjs`：OpenAI-compatible 反代，改写 `messages[0].system` 真正置顶；流式 pipe、上游 Authorization 透传不打印、MCP 故障原样转发。自检 `--self-test` 11/11（自带 mock 上游+MCP+临时令牌，CI 可复现）。启动需 `MEMAGENT_GW_UPSTREAM`。
  - **C** `mcpHttp.ts`/`mcpSchema.ts`/`main.ts`：严格门禁开启后可靠会话未召回时**所有非 recall 工具**硬拦，`recall_memory` 自身永远放行（防死锁）；`initialize.instructions` 加第 10 条、`tools/list` 加后缀。**三层开关的准确口径**：① 库级 `runMcpHttpServer({strictRecallGate})` 缺省 **false**（`opts` 不给 = 批次47 逐字不变，既有测试/老客户端不受影响）；② `src/electron/main.ts` 桌面运行时**默认显式传 true**，`MAM_STRICT_RECALL_GATE=0` 才退回旧行为；③ 单次请求头 `x-memagent-recall-gate: strict` 可独立声明严格门禁。无 `Mcp-Session-Id` 的请求一律不硬拦（防 §9 跨客户端串号误杀）。
  - **三道闸门**：A 默认关闭 4 例钉住旧行为；B 18 例纯函数 + 网关 11 例端到端 + C 13 例；变异 3 次（hookEventName 改坏 / 拼最前改拼末尾 / `|| strictGate` 改坏）均精确红灯后还原复绿。
  - **门禁**：typecheck / lint(0 warn) / no-demo / code:index / validate / generate --check 全绿；`test:gate --shards=1` **241 文件 2933 例 0 失败**。索引已重建（373 源码 / 139 文档），规格已补 frontmatter + `meta/index.md` 引用。
  - **宿主差异**：CLI 读 `~/.codebuddy/settings.json`；WorkBuddy 桌面端社区实测读 `~/.workbuddy/settings.json`，官方未承诺读同一套 hooks，**桌面端需实测**。hooks 不热加载，改完须重启 + `/hooks` 面板审核。
  - **【停·等用户实测】→【停·等确认】才 commit/push**。本轮**未打包**（上一轮批次61 产物仍在 `release/`）；工作区仍混有批次61 在途改动，禁 `git add .`。

## 历史快照（2026-11-13 01:05 · 批次61）
- **批次61 补丁（2026-11-13）：排查确认「接真读侧全绿、接反馈动作侧已通」，补齐三处闭环缺口**：
  - **A 召回权重建议可采纳**：生长页「回归评估」新增 `RecallWeightCard`（当前权重 + 最新建议 from→to + 采纳按钮）；采纳写 `growth:v1.recall_weights` 并落 `growth_op:recall_weight_applied`（已采纳置灰，不自动应用）。
  - **B 反馈策略可启用**：新增 `FeedbackLoopCard`（enabled/窗口/阈值）；保存写 `growth:v1.feedback_policy` 并落 `growth_op:feedback_policy_changed`（缺省仍关闭 = 与改造前逐字一致）。
  - **C signal_summary 可观测**：`useGrowthReal.feedbackSignalFromLedger` 取最新 `gc` 审计，卡片展示（召回/证据不足/裁决/拒绝占比/被拒记忆），空态「暂无数据」。
  - **D** `DevPanel` 过时文案已改为「判重/阈值/调度/召回权重/反馈策略统一由净化生长页写 growth:v1 驱动」。
  - 新测试 `src/web/growth/__tests__/growthLoop.test.tsx` 16 例（抽取器 + 两卡 + 页面端到端）。
  - 门禁：typecheck / lint / no-demo / code:index / validate / generate --check 全绿；`test:gate` **239 文件 2902 例 0 失败**；变异 3 次精确红灯后还原复绿。
  - 打包：installer `30aae8a30da4bf31` / win-unpacked 主程序 `0f33df5759131444`，两处 asar/main.cjs 一致；包内标记已验。**【停·等用户实测】→【停·等确认】才提交。**
- **批次61「净化生长 × Agent 侧进化」GAP-1/2/3 全部实施完成**（规格 `specs/tasks/GROWTH-AGENT-EVOLUTION.md`，已补 §7 实施落点对照）。
  - GAP-1：`shared/growthConfig.ts:RECALL_KEYS/DEFAULT_RECALL_WEIGHTS` 为真源，`forgetting.ts:SCORE_WEIGHTS` 仅转发；`scoreMemory` 接权重入参，`agent.ts` 召回入口读 `growth:v1` 后传两处；`hardFilter` 最前排除 `deleted`/`merged_into`；`regression.ts:suggestRecallWeights` 只产建议落 `growth_op`（`applied:false`），**不自动改权重**。
  - GAP-2：`FeedbackPolicy`（缺省 `enabled:false`）进 `growth:v1`；`coreFeedback` reject 达阈降档（`hot→warm→cold`，不推 dormant）并写 `growth_op:reject_downgrade`；`disputed` 用 `findConflictCounterpart` 补齐同项目 live 对手（cos ≥ 0.75），使 `conflict.ts` 路径 1 真能成对；`runForgettingCycle` 追加只读 `signal_summary`，审计读不到不阻断。
  - GAP-3：新模块 `agentUsage.ts` 按 `detail.client` / `mcp_call.agent` 聚合召回/省量/证据不足/首调合规；`gc_report` 新增 `agent_usage` + `concurrency_note`（dry_run 语义未变）；生长页「回归评估」新增「Agent 侧使用」卡，空审计显「暂无数据」；verdict 只能到项目级并已标注「不可按 Agent 拆分」。
- **门禁（批次61）**：typecheck / lint / no-demo（曾因页面用「—」被判红，已改文字原因）/ code:index / validate / generate --check 全绿；`test:gate --shards=1` **238 文件 2882 例 0 失败**。
- **三道闸门（含变异验证）**：GAP-1 变异 3 次（忽略入参权重 / 去 `deleted` 过滤 / 去最小样本守卫）、GAP-2 变异 3 次（去 enabled 开关 / 去冲突对守卫 / 去 try-catch）、GAP-3 变异 3 次（缺 client 冒充 / 合规分母不过滤 / 空态画 0），每次均精确红灯后原样还原复绿。

---

## 历史快照（2026-11-12 23:05）
- **回显重设计 T1–T13 全部实施**。最新 T13 = 折叠卡「📎 项目背景逐条独立成行」（`mcpHttp.ts:bubbleCard` + `mcpSchema.ts` 两处 + `mcpHttp.test.ts` C4）。规格 `specs/tasks/RECALL-ECHO-RAG.md`，契约 `specs/recall-echo-contract.md` §7.1。
- **判档**：Qoder 系 / `X-Memagent-Render: fold` → `html-details`；`detail=true` → `markdown-full`；其余（含 WorkBuddy）恒 `markdown-compact`。WorkBuddy 双端实测文本 `<details>` **无折叠交互** → 禁 HTML，折叠只能走 Agent 富媒体卡片或本机明细页；链接点不开时说「看明细」（同 query + `detail=true`）。
- **产物**：22:50 打包由并行 L0 会话执行、T13 搭车进包；安装包 SHA256 `da4c8968…`，两处 `app.asar` / `main.cjs` 逐字节一致，包内含 T13 文案 3 处。坑：`main.cjs` 在 `app.asar.unpacked/`（asar 内标 `unpacked:true`），且 esbuild 中文转**大写** `\uXXXX`。
- **门禁**：typecheck / lint / validate / generate --check / no-demo / code:index 全绿；`test:gate` 2815 例里 1 例既有 flaky（`fileStorage` mtime 同毫秒，文件=HEAD）；E2E 133/135 里 2 例 L0 在途失配（`OverviewPage` vs `home.spec.ts`）——均与本轮无关。
- **纪律**：打包已完成 → **等用户实测** → **等用户明确确认** → 才 commit/push。工作区混有 L0 在途改动，**不得 `git add .`**；`specs/code-index.generated.md` 含 L0 指纹，提交前须 stash L0 重生成或两批一并提交。
- **待办**：`mcpClients.ts` 一键接入默认带折叠头（独立 UI 任务）；`GROWTH-AGENT-EVOLUTION.md` GAP-1/2/3 未开工。

## 核心规则（压缩）
1. 常驻只 `meta/index.md` + `meta/charter.md`
2. 按需加载、外科编辑（不整篇重写）
3. 改完跑 `python tools/validate_project.py` + 测试，必须全绿
4. 一切 Git 化、PR 化
5. `specs/` 为单一事实来源（SSOT）

## 推荐流程（11 步）
需求提出与收集 → 需求分析与评审 → 产品与交互设计 → 技术方案设计 → 项目计划与任务拆分 → 编码开发 → 测试验证 → 预发布与验收 → 发布上线到生产 → 生产运维与监控 → 反馈与迭代

## 产物清单（压缩）
- **工作法**：README / PLAYBOOK / SOFTWARE_DEV_STEPS / meta/*（SOP 全套）/ tools/*（validate+generate+init+import）
- **真实项目资料（已归位，状态 imported）**：`specs/` 13 份「需求规格书_*.md」；`design/ui/` 12 个原型 HTML；`meta/文档章节索引.md`
- **已结构化**：12 条 REQ + 12 条 AC + 12 条 TC（全部互链），`specs/code-map.md` 连「需求→原型 HTML」；`generate.py` 产出 `build/`

## 现状（压缩 · 2026-10-07 更新）
- **远端**：已推 GitHub `https://github.com/WWLHQ/memory`（默认分支 `main`），GitHub Actions 三道门禁（`npm test` / `validate_project.py` / `generate.py --check`）。
- **CI 真实生效已验证**：首跑 push 因 `build/` 未生成（`--check` 红）被拦 → 修 ci.yml「先 `generate` 再 `--check`」→ PR #1 合并 → push 与 PR 双触发均 **success**。证明门禁能拦错也能过。
- **REQ-003 编码完成（逻辑层 100%）+ 真实后端全链路已接入（T13/T14/T15）**：T1–T12 全落地；T13 零依赖 HTTP 后端（`server.js`，JSON 持久化 `.data/`，提交 `554e20f`）；T14 HTTP 客户端（`client.js` + `service.js` 注入点 + `app.html` 后端地址配置，提交 `62eb3be`）；T15 升级 `e2e.test.js` 为"起真实服务 + T14 注入点跑全链路 + 持久化跨重启"（提交待 push）；`npm test` **50/50 绿**；`specs/code-map.md` 已补映射（本地提交 `94ecf71`）。
- **UI 已严格对齐原型（2026-10-07 重写）**：用户在 `REQ-003` 指出实现与原型 `design/ui/Agent接入页_原型.html` 不一致 → 已重写 `render.js`/`browser.js`/`app.html` 严格逐字段/逐交互对齐原型：暗色主题、`.card/.metrics/.row/.sw/.pill` 等 class、`.found/.gain`、`.toast`、`btnDiscover`+`.stages` 四段动画、`.sig` 信号源+`applyForm` 19.10 端置灰、`data-tool/data-iso/data-chan/data-act/data-rid/data-unbind` 全交互；`render.js` 导出 `renderCard/renderFound/renderGains`（proto 形状）。`npm test` **52/52 绿**，`validate`+`generate --check` 通过。`browser.js` 内置真实后端镜像（隐藏 `#backend` 默认 `localhost:8200`，best-effort 调 T13，不改变原型视觉与同步交互）。
- **完成度边界（重要）**：① 实现=**TS 内核 + React 19 UI**（Vite 构建），**已与规格完全对齐，方案级差异已消除**（2026-10-07 用户拍板走B 方案并完成迁移）；② 真实后端=**可选镜像**：`useBackendMirror.ts` 默认 `http://localhost:8200`（`?backend=` 可覆盖），fire-and-forget，不改原型视觉与同步交互；③ E2E 分两层：`npm test`（vitest 71 例，逻辑 + 组件 + 页面集成）与 `npm run test:e2e`（Playwright 7 例真浏览器点击级，被测对象为 `dist/` 真实构建产物 + 真实后端 :8200）。
- **门禁命令**：`npm run verify` = `typecheck`(tsc --noEmit, strict) → `test`(vitest) → `validate_project.py` → `generate.py --check`。CI 已加 `npm ci` + `typecheck` + vitest + e2e job。
- `npm test` **71/71绿**（新增 28 例：AgentCard 10 + 其余组件 11 + 页面集成 7）。
- **提交约定**：每次提交必须写提交日志（conventional commit，见 MEMORY.md）；T3–T12 已在 initial commit `04cb27b` 打包，决策**不重写历史**、改 code-map 标注任务归属。
- **已推**：2026-10-07 通过 SSH（`git@github.com:WWLHQ/memory.git`，密钥 `C:\Users\LHQ\.ssh\id_ed25519_github_push`）将本地 12 个提交全部推上 `origin/main`（含 `947353f`、`554e20f`…`c7c1476`），`git fetch` 后 `ahead 0` 确认同步。备注：本沙箱出网仅 SSH(22) 可达 GitHub，HTTPS(443) 被本地代理封死；`.workbuddy/memory/` 仍为未跟踪（agent 工作记忆，按需提交）。

## 下一步
- 候选：① 接真实后端（替换 `service.js` 内存为 API）；② 真浏览器 E2E（Playwright 跑 `app.html`）；③ 确认 JS 方案并更新规格消除偏离；④ 推进 REQ-004~REQ-012（补 AC/TC + 跑通一个功能）。
- 推远端需 PAT(repo+workflow)，或用户本机 `git push`。

---

## 流程固化（2026-10-10 更新）

- **全生命周期工作流已固化为强制 SOP**：新增 [`meta/WORKFLOW_SOP.md`](WORKFLOW_SOP.md)（主流程），
  串起 `TASK_SPLITTING`（任务长什么样）→ `CODING_SOP`（单任务 7 步）→ **自检门禁** → 人工验收 → 提交 → 收尾。
- **铁律（已验证）**：交人验收**之前**必须先在本机跑绿 `typecheck + vitest + e2e(--workers=1) + verify`，
  E2E 不得出现静默 SIGTERM；门禁全绿 + 人点头后才 commit（中文 message，一个任务一个 commit）。
- **当前真实项目状态（2026-10-10）**：REQ-003/004/005 + 用户注册已**编码完成并经人工验收通过**，
  自检全绿（`npm test` 178/178、`npm run test:e2e` 24/24、`npm run verify` 通过）。
  关键修复沉淀于 `.workbuddy/memory/pitfalls-2026-10-09.md`（#1~#13，含 vitest vmThreads、npm arborist、
  jsdom window.location、E2E SIGTERM 三层根因、登录门控脱节、CORS 白名单漏头真实 BUG）。
  全部改动已提交（最新 `b4d0f78`，14 文件）。
- **下一步待选 REQ**：REQ-012 检索页 / REQ-011 日志记录页 / REQ-006 其余页面（用户已选「先人工验收再开发」节奏）。

---

## REQ-006 子页批量（2026-10-10，待人工验收 · 挂起）

- **P8 记忆管理页 / P2 写入页 / P11 审计日志页 / P4 生命周期页** 均已按固化流程走完 ①拆分(T1–T5) → ②编码 → ③自检门禁全绿；
  **用户暂不方便验收，四页挂起、未提交**（验收通过后按 ⑥ 各自中文 commit）。
- **新增入口**：`memory.html` / `write.html` / `audit.html` / `lifecycle.html`（Vite 多入口 7 个）；
  Overview 已落地视图 3→7（memory/write/audit/lifecycle 加入，audit 已从 PLANNED 移除）。
- **任务拆分文档**：`specs/tasks/{MEMORY-MANAGE,WRITE-PAGE,AUDIT-LOG,LIFECYCLE}.md`。
- **P4 生命周期页覆盖**：六态机(9.10)迁移 + 调参面板(17.4/17.5，locked 全置灰 G4，freshness=0.5^(age/hl) 实时预览) +
  deprecated 替代跳转(9.7) + N/M(90/180)参数 + 批量迁移(9.10.4，写审计 lifecycle_change + request_id)。
- **自检门禁（全绿）**：`typecheck` ✅；`vitest` **302 例**（P4 34 + memory 33 + write 27 + audit 28 + 其余）；`validate` 0 失败；`generate --check` ✅；e2e 单 spec 全绿（memory 4 / write 3 / audit 4 / lifecycle 4）。
  ⚠ 全量 e2e 中 `app.spec` 因 :8200 被手动验收用的 dev backend 占用而 EADDRINUSE —— 环境耦合非回归，停 backend 后全绿。
- **本地预览**（vite dev + home backend 已起）：`http://localhost:5180/{memory,write,audit,lifecycle}.html`。
- **新增坑**：Playwright strict mode 下同 request_id 多行的 testid 必须带行索引；同文案多处出现时断言改用 getAllByText/first。

## 简写对照（中文）
| 简写 | 中文 | | 简写 | 中文 |
|------|------|---|------|------|
| SSOT | 单一事实来源 | | PR   | 合并请求 |
| REQ  | 需求 | | CI   | 持续集成 |
| AC   | 验收标准 | | UI   | 用户界面 |
| TC   | 测试用例 | | SOP  | 标准作业程序 |
| TDD  | 测试驱动开发 | | DAG  | 有向无环图 |
| ADR  | 决策记录 | | BUG  | 程序缺陷 |
| DoD  | 完成定义 | | E2E  | 端到端测试 |
