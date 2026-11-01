---
status: done
---

# 批次 32 手动测试报告 —— LLM 多引擎（第三方大模型 + 按延时路由）与 DSH 记忆明细默认收起

- 日期：2026-11-01
- 起因：用户两条要求——
  1. 「LLM 精炼引擎增加第三方大模型，**不区分简单和深入，哪个能用哪个快用哪个**」；
  2. 「DSH 中记忆库信息要**折叠起来**，需要看的时候点击展开查看详细信息，不是直接展示详细，这样**太占页面空间**了」。
- 拍板（三项）：
  - **接入 = 通用 OpenAI 兼容 + 预设快选**：任意 N 个引擎（baseURL + 模型名 + 可选 API Key），预设一键添加（Ollama / DeepSeek / Kimi / 智谱 GLM / 通义千问 / OpenRouter），密钥独立 0600 落盘。
  - **路由 = 按最近拨测延时自动排序**：取消 L2/L3–L6 与厂商的绑定；每个引擎记录最近一次真实「测试连通」延时，精炼按延时升序逐个试，首个成功即用，失败回退下一个。
  - **DSH 折叠 = 先实测渲染能力**：批次29 已实测 DSH 只渲染 Markdown、`<details>` 原样露出（2026-10-31 截图为证）——因此按拍板的回退方案实现「默认一行摘要 + 按需再取明细」。

## 1. 改动清单（逐文件理由）

### 1a. LLM 多引擎与路由（32-A / 32-B）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/electron/llmGateway.ts` | 双引擎 → **N 引擎**：`LlmEngineConfig` 增 `needsKey/lastLatencyMs/lastProbeAt/lastProbeOk`；`LLM_PRESETS` 六家预设；`LlmGatewayProvider.callOrder()` 按 `lastLatencyMs` 升序（未拨测排后、同值按列表顺序稳定并列）→ **逐个顺序回退**；`chatEndpoint()` 统一补全 OpenAI 兼容路径；`isLocalBase()` 按主机名判回环；`loadLlmKeys/saveLlmKey/keyExists`（`llm-keys.json` 0600）+ legacy `llm-deepseek-key.txt` 只读兜底；`mergeLlmConfig`（改/加预设/加自定义/删/密钥）；`applyProbeResult` 只有成功才记延时 | 路由口径就是用户要的「哪个能用哪个快用哪个」；失败不记延时，避免坏引擎把自己顶到队首 |
| `src/electron/main.ts` | §6d：`llm:configSet` 走 `mergeLlmConfig` + `saveLlmKey`；`llm:test` 按引擎 id 真拨测并把结果 `applyProbeResult` **写回配置**后重载网关；动作日志只记 id/模型/延时 | 延时必须落盘才能成为下次精炼的排队依据；日志不落密钥（§4 约定） |
| `src/electron/dataRoot.ts` | 迁移白名单加 `llm-keys.json` | 换数据根后各引擎密钥不丢 |
| `src/electron/preload.ts` | `llm.config/setConfig` 返回类型改 `LlmViewResult{usable,engines,presets}`；`llm.test` 参数从 `'ollama'\|'deepseek'` 改为任意 `engineId: string` | 引擎数量不再固定，返回值/入参必须跟着视图化；返回值只带 `keySet` 布尔 |
| `src/web/hostLlm.ts` | 快照形状 `{usable, engines: LlmEngineView[], presets}`；`modelsFromSnapshot` 按 `isLocalBase` 给 `{free,0}` / `{cheap,0.01}`；**导出 `isLocalBase`** | `isStub` 仍是 getter（保存即热生效，不重建内核）；参数页要复用同一回环判定，避免两处口径漂移 |
| `src/web/params/llmEngine.ts` | 桥接类型改 `LlmConfigPatch{engines,add,remove,key}` + `LlmGatewaySnapshot` | 渲染层不再拼「两份固定配置」，改发补丁 |
| `src/web/params/LlmEngineCard.tsx` | 管理卡重写为**引擎列表**：预设快选「＋添加」、自定义引擎（名称/baseURL/模型/密钥）、逐引擎启用/保存/删除、「测试连通」（✅/❌ + 真实延时 + 最近拨测时刻）、排队顺序徽标、本地/云端标注、密钥写入/清除 | 用户要「增加第三方大模型」，UI 必须能增删任意引擎并看见「谁会被先用」 |
| `src/electron/__tests__/llmGateway.test.ts` | 重写为 **25 例**：延时排序（所有层级同口径）、未拨测排后 + 列表并列、`Authorization` 只发 `needsKey` 引擎（本地引擎即使存有密钥也不发）、三引擎顺序回退捕获 `['kimi','deepseek','ollama']`、全失败聚合错误含各引擎原因且**不含密钥**、可运行性三条跳过、`listModels` 本地/远端 tier 混合、`chatEndpoint` 单元 + 真实请求路径 `/api/paas/v4/chat/completions`、配置往返「JSON 永不含密钥」、批次31 旧形状迁移、钳制四条、密钥落盘/清除/legacy 优先级、`mergeLlmConfig` 五类动作、`testEngine` 诚实失败四条、`applyProbeResult` 口径、`llmEngineViews`、`buildLayerPrompt` 规格 | 修复/改造前先立失败用例；密钥面与排队口径都靠断言钉住 |

### 1b. DSH 记忆明细默认收起（32-C）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/core/memagent/recallInsight.ts` | 新增 `buildRecallCompactMarkdown(hint)`：一行加粗摘要 + 「用同一 query 再调一次并置 `detail=true`」指引，零 HTML | DSH 无可点击折叠控件，四段全文每次铺满聊天窗口就是用户抱怨的点 |
| `src/core/memagent/mcpRecall.ts` | 新增 `RecallDisplayMode`（`html-details` / `markdown-full` / `markdown-compact`）与 `recallDisplayMode(client, detail)`；结果 `display.mode` 下发；`detail` 非布尔 → `-32602` 明确报错 | 把「本次给的是哪一档」变成可核对的事实，而不是靠约定 |
| `src/core/memagent/mcpHttp.ts` | `recallEchoNote(mode)` 由**本次 payload 自己的 `display.mode`** 选文案（原来按客户端标识推断） | 单一真源：末块「展示要求」不能与同一结果里的 markdown 说两套话 |
| `src/core/memagent/mcpSchema.ts` | `recall_memory` 增 `detail` 参数；工具描述与 `MCP_INSTRUCTIONS` 规则 2 改三档口径 | 客户端不保证注入 instructions，所以约束同时写进工具描述 |
| `__tests__/mcp.test.ts`、`__tests__/mcpHttp.test.ts`、`__tests__/recallInsight.test.ts` | TCP/无会话默认断言改紧凑档；新增 `detail=true` → 四小节明细、`detail:'yes'` → 参数错误、Qoder 会话仍 `<details>`、档位矩阵 | 三条路径（默认/要明细/非法参数）都要有契约 |
| `AGENTS.md` §1.1/§3/§6/§9、`CLAUDE.md`、`specs/code-map.md`、`specs/code-index.generated.md` | 触发规则改三档；网关行/数据根清单/已知边界更新；批次32 代码映射段；索引刷新（285 文件） | 门禁要求「功能完成即建索引」 |

**未改动**：内核写路径（质量门 → L1 → 逐层生成 → `checkLayerSpec` → 查重 → 嫁接）与 `src/desktop/hostBridge.ts`（四条 `llm:*` 通道名不变，无需改桥）。

## 2. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,998,377 B（116.35 MiB） |
| SHA256 | `345600E3E99D49E2B4B2690D76FC92C7D3A4221A664E97F27DAEFE2BE96235F4` |

打包收口：`release/installer` 被外部进程占用（EPERM）→ 本次先输出到 `release\installer-20261101-005357`，构建成功后按既有机制**复制 + 删除**收口回 `release/installer`；收口时删除旧 `release/installer` 一份、清理旧安装包目录 0 个，当前 `release/` 下只有 `installer` 一个目录（`ls release/` 实测）。

打包前按既有机制强制结束 `release/` 下运行中的旧实例；打包后只保留最新一份安装包（旧 `release/installer-*`、便携目录 `release/win-unpacked`、`release/builder` 残留一并清理）。

## 3. 自动化验证（真实跑过）

- `npm run verify:fast` **exit 0**：typecheck 双配置 0 错、oxlint 0/0（452 文件）、索引新鲜度通过（285 文件）。
- `npm run verify`（全闸）**exit 0**：Electron 构建 + Playwright E2E **94 passed（32.8s）**，全部打到真实后端。
- 单测：**123 文件 / 1381 用例全过**（批次32 新增/改写：网关 25 例 + MCP 三档 若干）。
- 覆盖率：语句 79.11%（9245/11686）/ 分支 71.07%（6496/9140）/ 函数 74.4%（2105/2829）/ 行 82.13%（8030/9777），均高于阈值（71/61/67/74）。
- **实机验证（真连本机 Ollama，非 mock）**：`127.0.0.1:11434` 在线（`qwen2.5:7b`）。一次性探针脚本（跑完已删除，无残留）实测：
  - 真实拨测 Ollama：`{ok:true, model:"qwen2.5:7b", latencyMs:512}`（模型已预热；冷启动时同一拨测实测 **20910ms**）；
  - 真实拨测「不监听的自定义引擎」：`{ok:false, model:"ghost-model", latencyMs:3, error:"fetch failed"}` → **失败不写延时**，`lastProbeOk=false` 得到断言；
  - 排队 + 回退：把死引擎手工标成「上次最快（1ms）」、Ollama 标 9000ms，真实请求顺序被捕获为
    `["http://127.0.0.1:59017/v1/chat/completions", "http://127.0.0.1:11434/v1/chat/completions"]`
    → **先撞「上次最快」的引擎、失败后顺序回退**，最终由 Ollama 真实生成 L2（7887ms / 118 字，非空串、非占位）；
  - 只剩不可用引擎时 `refineLayer` 如实抛错（错误文案含 `request_id`，供内核记 `refine_error`），**不伪造层级产物**；
  - 落盘配置文件全文不含 `sk-`；IPC 视图引擎项只有 `keySet` 布尔，无密钥字段。

## 4. 手动测试步骤（验收用）

### A. LLM 多引擎与按延时路由

1. 安装新包并启动桌面端，**管理员**登录。
2. 打开「全局参数」页 → 「🧠 LLM 精炼引擎」卡。
3. 本机 Ollama 在跑（`http://127.0.0.1:11434`，先 `ollama pull qwen2.5:7b`）→ Ollama 行勾选启用、模型名 `qwen2.5:7b` → 点「测试连通」→ 显示 ✅ + 真实延时（预热 ~0.5s，冷启动 ~20s 量级）。
4. 点「＋ 预设」添加 **Kimi / 智谱 GLM / 通义千问 / OpenRouter** 任一 → 填 API Key → 该行「测试连通」→ ✅ 显示真实延时，❌ 显示厂商返回原因（截断、不含密钥）。
5. 点「＋ 自定义引擎」填任意 OpenAI 兼容 `baseURL` + 模型名 → 保存 → 「测试连通」应真拨测（本地回环地址自动标「本地/免密钥」，远端标「云端/需密钥」）。
6. 观察**排队顺序徽标**：拨测成功的引擎按最近延时升序，未拨测的排在后面——此顺序就是精炼时的实际尝试顺序。
7. 保存配置 →「写记忆」页写入一条测试记忆 → L2–L6 按延时顺序由引擎真实生成（层级列表可见正文与 `layers_generated_at`）。
8. **回退验证**：把「上次最快」的那个云端引擎的 Key 删掉或让端点挂掉（不启服务），再写一条记忆 → 该次精炼先试它、失败后自动用次快引擎完成；若所有引擎都不可用，内核审计出现 `refine_error`（错误文案不含密钥），该层如实留空。
9. 门禁回归：普通成员 → 该卡只读并提示「需管理员」；未登录/浏览器 dev 模式 → 诚实显示不可用（浏览器模式永远只落 L1）。
10. 日志回查：`actions.log` 出现 `llm:config-saved`（含引擎 id/启用/模型，无密钥）与 `llm:test-engine`（含 `ok/model/latencyMs`）。**（批次34 校正：本条在批次32 交付时并不成立——当时这两个键只经 `mlog()` 落 `main.log`，`actions.log` 实测 0 命中；批次34 起 `main.ts` §6d 双写 `actionLog('llm', …)`，本条才真正可验证。另：批次32 的「测试连通」要求引擎先勾选启用，未勾选时 9ms 内返回「X 未启用」且从不发 HTTP，被用户读成「连不通」——批次34 已解耦，详见 `MANUAL-TEST-FIX-BATCH-34.md`。）**

### B. DSH 记忆明细默认收起

1. 在 DSH 里问一个本项目历史/实现类问题（触发 `recall_memory`）。
2. 预期：回答末尾只有**一行 🧠 Memory 摘要**（加粗）+ 一句「明细已收起…需要看时置 `detail=true`」指引——**不再有整段四小节占满页面**。
3. 说「展开看明细」→ Agent 用同一 query 再调 `recall_memory(detail=true)` → 得到纯 Markdown 四小节（项目背景 / 命中记忆 / Token 用量 / 省钱与费用），数字与第 2 步那一行**完全一致**。
4. 在 **Qoder** 里问同样问题 → 仍是 `<details>` 折叠块（点击可收起/展开），行为与批次29 一致。
5. 参数校验：`detail` 传非布尔（如 `"yes"`）→ 工具返回明确参数错误「detail 必须是布尔值」，不静默按摘要处理。

## 5. 已知边界（诚实声明）

- **DSH 的「展开」不是可点击控件**：服务端无法替客户端渲染折叠 UI，DSH 里点开的动作由 Agent 再调一次 `recall_memory(detail=true)` 完成；字面「点击展开」只在能渲染 HTML `<details>` 的客户端（当前实测 Qoder 系）成立。
- **排序只认「最近一次成功拨测」的延时**，不是实时健康度：长期不点「测试连通」就退回列表顺序；某引擎中途挂掉时，仍会先被尝试再回退（一次写入最多损耗一轮超时/连接失败）。
- **第三方云端引擎未在本机实拨**（需你自填各厂商 API Key）——协议同为 OpenAI 兼容 `chat/completions`，密钥面/请求头/失败路径由 25 例单测覆盖，`测试连通` 即真实 HTTP 拨测；`{tier:cheap, price:0.01}` 只是 routeProxy 的记账元数据，**不代表厂商账单**。
- 自定义引擎按 **OpenAI 兼容 `chat/completions`** 调用；非该协议的端点（如纯 Anthropic  Messages 格式、gRPC 类）不在支持范围。
- 批次31 的 `llm-deepseek-key.txt` 只作 `deepseek` 引擎的**只读兜底**：`llm-keys.json` 有值时优先；在参数页清除密钥不会删除你的遗留文件。
- 本机 7B 模型可能偶发违反层级规格（字数 / mustInclude）→ 内核 `checkLayerSpec` 判废并如实留空 + 记审计；Ollama 冷启动单次精炼实测 ~20s+（预热后拨测 0.5s、L2 生成 ~8s），写入仍会明显变慢。
- `llm:refine` 需会话但不需管理员：登录用户写入即触发精炼；配置与密钥面（启用/模型/增删引擎/密钥/拨测）仍仅管理员。
- 浏览器 dev 模式无主进程 → 永远 FakeLlmProvider（只落 L1），引擎卡诚实禁用。
