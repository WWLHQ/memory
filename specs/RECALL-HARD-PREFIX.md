---
title: 硬前置召回：A 宿主钩子 / B LLM Gateway / C 内核门禁
date: 2026-11-13
status: implemented（A/B/C 均已实施并过用例，待真机实测确认）
scope: 每轮用户输入 → 强制召回 → 拼进上下文 → 再推理；含能力边界与三层开关
---

# 硬前置召回：A 宿主钩子 / B LLM Gateway / C 内核门禁

> 2026-11-13。目标链路：**用户输入 → 强制召回 → 拼进上下文 → 再推理**，把「每轮必召回」从
> 工具模式 + 强 Prompt（模型有概率跳过）升级为宿主/代理/内核三层硬保证。

## 0. 能力边界（先说做不到的）

| 环节 | 能否硬性保证 | 依据 |
|---|---|---|
| 每轮用户输入 → 强制召回 | ✅ | A 由宿主 `UserPromptSubmit` 在模型处理前同步执行；B 由代理在转发前执行 |
| 召回内容进上下文 | ✅ | A 注入 `hookSpecificOutput.additionalContext`；B 改写 `messages` |
| **拼进 system prompt 最前面** | 仅 B ✅ | 宿主 hooks 官方文档只给 `additionalContext`（追加上下文），**没有任何改写/替换 system prompt 的字段**；`systemMessage` 是显示给用户的、不传给 Agent |
| 模型「一个工具都不调直接回答」 | ❌ 拦不住 | C 是 MCP 工具层门禁，只约束"调了工具但未先召回"；根治靠 A/B |

`decision: "block"` 已废弃，现用 `continue: false`；`UserPromptSubmit` 的 `matcher` 不支持。

## 1. 单一真源

`src/core/memagent/recallPrelude.ts` — 纯函数、零 IO、零 Node 依赖，被 A/B 共用，避免两份拼接规则漂移：

- `extractRecallHits` 只认 `structuredContent.hits`，**不猜** content 文本块里长得像 JSON 的东西；
- `buildRecallPrelude` 只注入 `hits[].content` 正文，**绝不注入** `display.markdown` / 回显话术 / 统计数字；
- `injectSystemPrelude` 把 prelude 拼到 system 内容最前面，用 `[RECALL_PRELUDE_V1]` 开闭标记保证幂等（多轮不叠加）；
- `buildHookOutput` 生成 A 的 stdout 契约；无命中只有 `{continue:true}`，不塞空上下文。

Node 22.18+ 原生 TS 剥离可直接 import `.ts`，所以可执行脚本（`.mjs`）与 vitest 用例复用同一份源码。

## 2. A：UserPromptSubmit 宿主钩子

| 文件 | 作用 |
|---|---|
| `.codebuddy/settings.json` | 项目级 hooks 配置（可随仓库提交）；用 `$CODEBUDDY_PROJECT_DIR` 定位脚本 |
| `src/core/memagent/recallHook.ts` | **钩子主体逻辑唯一实现**：stdin 事件 → 8204 `initialize` 拿 sid → `tools/call recall_memory` → 拼 prelude → stdout 契约 |
| `src/core/memagent/recallHookCli.ts` | IO 壳（打包态入口）：读 stdin / 分派 `--self-test`，**不含业务逻辑** |
| `.codebuddy/hooks/force_recall.mjs` | 开发态薄壳：动态 import `recallHook.ts` 并分派（Node 22 原生 TS 剥离） |
| `dist-electron/recall-hard/force_recall.mjs` | **打包态产物**（`build:electron` 用 esbuild 打成自包含 ESM，宿主用系统 node 直接跑，不依赖仓库源码 / node_modules / TS 剥离） |
| `tools/install-force-recall.mjs` | 宿主级 installer：探测 `~/.codebuddy` 与 `~/.workbuddy`，**合并**写入、留 `.bak`、默认 dry-run |

打包态为什么必须单独出产物：`electron-builder` 只带 `dist/**` + `dist-electron/**` + `package.json`，仓库里的
`.codebuddy/hooks/*.mjs` 与 `src/**` 根本不在安装包里；若只指向仓库脚本，**打包后 A 会静默失效**（钩子每次执行都失败）。
两条入口共用 `recallHook.ts`，不存在两份注入逻辑。

硬约束：
- **fail-open**：MCP 未启动 / 超时 / 旧 Node / 令牌缺失 / 非 loopback → 只回 `{continue:true}`，绝不阻断用户提问；
- 令牌只从 `%APPDATA%/MultiAgent Memory/mcp-token.txt` 读（可用 `MEMAGENT_MCP_TOKEN_FILE` 覆盖），不硬编码、不打印；
- `isLoopback()` 挡住把机器级凭据发往远端；
- stderr 只写错误类别，不写 prompt 正文与令牌；
- 自检 `node .codebuddy/hooks/force_recall.mjs --self-test` 与 `node dist-electron/recall-hard/force_recall.mjs --self-test`
  输出同一份 `SELFTEST_OK 13/13`（条数由实际断言数决定，不写死；均不依赖 8204 在线）。

宿主差异（实测）：hooks 是 CodeBuddy Code CLI 能力，`~/.codebuddy/settings.json`；WorkBuddy 桌面端社区实测读
`~/.workbuddy/settings.json`，官方未承诺读同一套 hooks。**CLI 确定可用，桌面端需实测**。
hooks 不热加载：启动时抓快照，改完须重启并在 `/hooks` 面板审核。
Windows 上 hook 强制 Git Bash 执行，故 installer 写入时用 `node` 绝对路径 + 正斜杠路径。

## 3. B：LLM Gateway

两份实现，共用 `recallPrelude.ts` 的同一份拼装规则：

| 实现 | 形态 | 用途 |
|---|---|---|
| `tools/recall-gateway.mjs` | 独立 CLI 反代（应用外起） | 不启动桌面端也能用；`MEMAGENT_GW_UPSTREAM=https://... node tools/recall-gateway.mjs` |
| `src/electron/recallGateway.ts` | **应用内置反代**（主进程按 UI 开关起停） | 参数页「B · LLM 网关」启用后由主进程监听 `127.0.0.1:8300`，退出时释放端口 |

```
客户端 → 127.0.0.1:8300 → [取最后一条 user 文本 → 8204 召回] → 改写 messages[0].system → 上游 LLM
```

- 客户端 base_url 指向 `http://127.0.0.1:8300/v1`（端口可由配置改，`b_port`）；
- 只拦 `POST /v1/chat/completions`（含无 v1 别名），其余路径原样转发；
- 流式响应直接 `pipe`，不缓冲、不改写；客户端自己的上游 `Authorization` 原样透传但绝不打印/落盘；
- MCP 故障 / 超时 / 坏 JSON 一律 fail-open 原样转发；
- 自检 `node tools/recall-gateway.mjs --self-test`（11 例，自带 mock 上游 + mock MCP + 临时令牌文件，CI 可复现）。

代价：需要宿主允许配 `base_url`（CLI 常见，桌面端通常不开放）。

## 4. C：MCP 内核门禁加固

`src/core/memagent/mcpHttp.ts` + `mcpSchema.ts` + `src/electron/main.ts`：

- 批次47 原行为：可靠会话（带 `Mcp-Session-Id`）未召回时**只硬拦写入/治理类工具**，读类仅软提醒；
- 新增严格门禁：开启后未召回时**所有非 `recall_memory` 工具**都硬拦，`recall_memory` 自身永远放行（防死锁）；
- `initialize.instructions` 追加第 10 条声明，`tools/list` 非 recall 工具描述追加「会被硬拦」后缀；
- 开关三种，缺省全关 → 既有客户端与全部既有测试逐字不变：
  1. `McpHttpOptions.strictRecallGate`（主进程注入；**批次62 起改为布尔或求值函数**，传函数时每次 `tools/call` 读当前值
     ——参数页切换即时生效、无需重启；`MAM_STRICT_RECALL_GATE=0` 仅在还没有配置文件时把默认值压成关闭）；
  2. 请求头 `x-memagent-recall-gate: strict`（单次请求自证）；
  3. 都不给 → 批次47 原行为；
- 只影响可靠会话；**无会话头的 UA 兜底请求一律不硬拦**，防 §9 跨客户端串号误杀。

## 5. 三道闸门证据（2026-11-13）

| 闸门 | A | B | C |
|---|---|---|---|
| A 影响面回归 | 宿主配置合并不覆盖其它键；installer 默认 dry-run | 其余路径/字段原样转发 | 默认关闭时 4 个用例钉住批次47 逐字不变；全量回归 0 失败 |
| B 效果验证 | 自检 10/10 + 真实 8204 链路注入 1378 字符且不含回显话术 + 死端口 fail-open | 自检 11/11：上游实收 `system` 首部含命中、原规则不丢、消息条数不变、幂等 | 13/13：读类真的被拦、召回后真的放行、会话隔离、防死锁、防误杀 |
| C 变异验证 | 改坏 `hookEventName` → 自检精确 FAIL → 还原复绿 | 把「拼最前」改成「拼末尾」→ 18 例中仅 1 例红灯 → 还原复绿 | 把 `\|\| strictGate` 改坏 → 13 例中严格组 4 例红灯、默认组 9 例全绿 → 还原复绿 |

### 5.1 批次62 UI 开关（第二轮）的闸门证据

| 闸门 | 证据 |
|---|---|
| A 影响面回归 | 全量 `npm test` 245 文件 / 2971 例全绿；`typecheck`（web + electron 两套 tsconfig）与 `oxlint`（681 文件）0 错；A 脚本两条入口共用 `recallHook.ts`，自检同为 13/13 |
| B 效果验证 | ① B 真 HTTP 端到端探针（假上游 + 假 MCP）：`system` 仍在首位、prelude 置顶、原规则不丢、消息条数 2 条不变、无命中时逐字透传、二次注入仍只有 1 个标记；② C 门禁 getter 用例：同一进程内 关→开→关，三次 `tools/call` 各自按当时的值判定；③ 新增 38 例（配置真源 9 / 控制器 13 / 钩子 7 / 卡片 9） |
| C 变异验证 | ① 把卡片「启用」按钮的 active 判定反转 → UI 用例精确红 1 例（`expected 'rh-choice' to contain 'active'`）→ 还原后 SHA256 与变异前一致、9/9 复绿；② 把 `mergeHostHooks` 的 `if (enabled)` 改成 `if (true)` → 控制器用例红 3 例（停用不摘钩子 / 留空 hooks 壳 / state 报已装）→ 还原后 SHA256 一致、13/13 复绿 |

## 6. 已知限制

- A 的 `additionalContext` 位置由宿主决定，官方未承诺相对 system prompt 的先后；要字面「system 最前面」只能走 B。
- C 拦不住「不调任何工具直接回答」，它是 A/B 的补强，不是替代。
- 三层都依赖 8204 在线（由 Electron 主进程起，须用户双击启动桌面端）；全链路 fail-open，服务没起时只是不注入，不影响对话。
- 每轮都召回会增加耗时、token 与 `mcp_call` 审计，这是硬前置的已知代价 [1]。

## 7. UI 开关（批次62 续）

参数页新增一张卡片「硬前置召回」，三层各一组**「启用 / 不启用」二选一按钮**（不是 checkbox：
这是个互斥的二态选择，勾选框会让人以为可以「都选」）。原型是唯一事实来源：
`design/ui/硬前置召回开关_原型.html`（已注册进 `design/ui/index.html` 的 views）。

### 7.1 配置真源 vs 运行态

| | 存什么 | 存在哪 |
|---|---|---|
| 配置（用户意图） | `a_hook` / `b_gateway` / `b_upstream` / `b_port` / `c_strict_gate` | `<数据根>/recall-hard-config.json`（`src/shared/recallHardConfig.ts` 定义类型、默认值与校验） |
| 运行态（真值） | A：宿主 `settings.json` 里是否真有本钩子；B：网关 handle 是否真在跑；C：服务端当前求值结果 | 每次 `state()` 现读，**绝不拿配置冒充运行态** |

因此卡片上「已启用 / 未启用」徽标与状态行读的是真值，二选一按钮高亮读的是草稿意图；
两者不一致时状态行明写「有未保存改动」，点按钮 ≠ 已生效。

### 7.2 三层各自的运行时语义

| 层 | 保存后发生什么 | 是否需重启 |
|---|---|---|
| A 宿主钩子 | 主进程**合并**写 `~/.workbuddy/settings.json`（只增删 `force_recall.mjs` 那一条，其它钩子与顶层键逐字保留，写前留 `.bak`）；停用时同法只摘自己 | **需要**：hooks 不热加载 → `state.a.needsRestart` 为真时卡片显示横幅 |
| B 内置网关 | 主进程 `startRecallGateway()` 监听 `127.0.0.1:<b_port>`；端口或上游变了先停再起；停用即释放端口；启用前必须填合法 http/https 上游 | 不需要 |
| C 严格门禁 | 只改 `cStrict()` 的返回值，`mcpHttp` 每次 `tools/call` 现读 | 不需要 |

失败路径都要可见：A 脚本不存在时**拒绝启用**（不往宿主配置写死路径）、宿主配置是坏 JSON 时拒绝改写、
B 端口被占时 `state.b.error` 照实显示、C 意图与生效不一致时卡片提示。

### 7.3 通道与权限

| 通道 | 权限 | 说明 |
|---|---|---|
| `recallHard:state` | 任意登录会话 | 读三层真值；不含令牌、不含上游密钥 |
| `recallHard:set` | 仅管理员 | 改宿主配置 / 起停本机端口 / 改所有 Agent 的门禁强度；审计只记「改了哪几个字段」与三层布尔，不记上游地址 |

渲染层桥：`src/web/params/recallHard.ts`（`hostCall` → `hostBridge` → preload `window.api.recallHard`）；
浏览器模式 `hostCapability() === 'none'` → 卡片如实显示「不是桌面宿主环境」，不渲染开关。

### 7.4 相关文件

| 文件 | 作用 |
|---|---|
| `src/shared/recallHardConfig.ts` | 配置类型 / 默认值 / 归一化 / patch 校验 / `base_url` |
| `src/electron/recallHard.ts` | `RecallHardController`：落盘、A 钩子合并与摘除、B 启停、C getter、`state()` 读真值 |
| `src/electron/recallGateway.ts` | 应用内置 B 反代（复用 `recallPrelude.ts`） |
| `src/electron/main.ts` | bootstrap 内建控制器 → `runMcpHttpServer({ strictRecallGate: controller.cStrict })` → 退出时 `stop()` |
| `src/web/params/RecallHardCard.tsx` + `recallHard.css` | 参数页卡片（严格对齐原型） |
