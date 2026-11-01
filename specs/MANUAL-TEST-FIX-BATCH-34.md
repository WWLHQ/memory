# 批次34 手动测试报告 · 「测试连通」不再要求先勾选「启用」（拨测与启用解耦）

日期（UTC+08:00）：2026-11-01
分支：`main`
上一批次：批次33（`specs/MANUAL-TEST-FIX-BATCH-33.md`）

## 1. 用户反馈与真因

用户反馈：**「LLM精炼引擎配置key后测试连通都连不通，本地OLLAMA也连不通」**。

排查不是靠猜网络，而是按动作日志的耗时定位：

| 证据 | 实测值 | 结论 |
|---|---|---|
| 数据根 `llm-config.json` | 4 个引擎 `ollama/deepseek/openrouter/zhipu` **全部 `enabled:false`** | 启用位是关的 |
| 旧 `testEngine()` 第一条检查 | `if (!eng.enabled) return { ok:false, error:'X 未启用' }` | 未勾选启用 → **一条 HTTP 都不发** |
| 日志中 `[ipc:llm:test]` 的耗时 | `ms:7 ~ 11` | 毫秒级返回 = 本地校验挡的，不是网络超时 |
| `curl http://127.0.0.1:11434/api/tags` | HTTP **200**，模型列表含 `qwen2.5:7b` | 本机 Ollama 本身健康 |
| 改完后真连本机 Ollama 的同一段代码 | `{"ok":true,"model":"qwen2.5:7b","latencyMs":588,"enabled":false}` | 解耦后同一引擎**真实连通**，588ms 才是网络该有的量级 |

**设计缺陷**：「测试连通」正是用来决定「要不要启用」的手段，却被「启用」状态反向挡住。用户点一个必然失败的按钮，看到 ❌ 只能理解成「连不通」——这正是本次反馈的来源。

## 2. 改动清单（逐文件为何要动）

| 文件 | 改了什么 | 为什么必须动这个文件 |
|---|---|---|
| [src/electron/llmGateway.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/llmGateway.ts) | `testEngine` 删除 `enabled` 门槛；`EngineTestResult` 增 `enabled?: boolean` 回显 | 真因就在这里。其余前提保持不变：找不到引擎 / 未填模型名 / `needsKey` 且无密钥 → 仍**如实快速失败、不发请求** |
| [src/electron/main.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/main.ts) §6d | `llm:configSet` / `llm:test` 由「只 `mlog()`」改为 `mlog()` + `actionLog('llm', …)` **双写**；拨测日志多带 `enabled` | 修一处文档失真：批次31/32/33 报告都写「`actions.log` 有这两个键」，实测 `actions.log` **0 命中**（`mlog` 落的是 `main.log`）。不双写，以后同类问题还得翻第二个文件 |
| [src/electron/preload.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/preload.ts) | `llmTest` 返回类型加 `enabled?: boolean` | IPC 边界的类型契约，不加则渲染层拿不到 |
| [src/web/params/llmEngine.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/params/llmEngine.ts) | `LlmTestResult` 加 `enabled?: boolean` | 宿主桥到页面的中转类型 |
| [src/web/params/LlmEngineCard.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/params/LlmEngineCard.tsx) | 拨测结果新增「连通但未启用」文案；卡片说明改为**「测试连通」不要求先勾选「启用」** | 用户看得见的地方。只解耦不提示，用户会以为「连通了=已生效」，精炼时仍只有 L1，是另一种误导 |
| [src/web/Home/programLogLabels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/Home/programLogLabels.ts) | 新增 `llm:config-saved` / `llm:test-engine` 中文标签 | 新落 `actions.log` 的键若不登记标签，日志记录页会显示原始 `scope:action`，人话视图断档 |
| [src/electron/__tests__/llmGateway.test.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/__tests__/llmGateway.test.ts) | 原「未启用 → 拒绝」用例换成三条：未启用照样真拨测（断言 mock 服务器**确实收到**该引擎请求）/ 三条快速失败仍不发请求 / 其它前提不放宽 | 先写失败用例再改实现（旧断言正是这个 bug 的固化） |
| [src/web/params/__tests__/LlmEngineCard.test.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/params/__tests__/LlmEngineCard.test.tsx) | 新增 3 例：未启用引擎的拨测按钮可点且不误写草稿 / `enabled:false` 回显「尚未勾选」 / `enabled:true` 不回显 | 覆盖新文案与「不擅自改配置」这条既有约定 |
| `specs/code-index.generated.md`、`specs/code-map.md`、`AGENTS.md`、批次31/32/33 报告 | 索引刷新 + 批次34 段 + §3/§4/§9 同步 + 三份报告原位标注失真 | 维护约定：索引过期视为功能未完成；文档说错比不说更坏 |

**没有动的**：`callOrder()`（精炼排队）仍要求 `enabled`——本次只解耦**拨测**，不放松精炼门槛；`applyProbeResult` 仍只在拨测成功时记延时。

## 3. 门禁数据（实测）

| 门禁 | 结果 |
|---|---|
| `npm run verify:fast` | 通过（退出码 0） |
| `npm run verify`（含 Electron 构建 + Playwright E2E） | 通过（退出码 0）：单测 **126 文件 / 1416 例全绿**，覆盖率 Statements **79.96%**（9413/11772）、Branches **72.06%**（6622/9189）、Functions **75.92%**（2163/2849），E2E **94 passed**（31.4s） |
| `npm run code:index -- --write` | 已刷新（286 个文件） |
| 实机真连本机 Ollama 的 `testEngine` | `enabled:false` 也返回 `ok:true` / `latencyMs:588`；未填模型名 **0ms** 返回「未填写模型名」（确实没发请求）；缺密钥返回「未配置 API Key」；不存在的端点返回 `fetch failed`（真 HTTP 失败） |

## 4. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release\installer\MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,002,364 字节（约 116.4 MiB） |
| SHA256 | `04cc3b6443c5a082316ef4340fe048e442b0bb76f26a532b5d4947ef7fd0a0ae` |
| 清理 | 打包前已强制结束 `release/` 下运行中的旧实例；`release/installer-*` 旧目录清理 0 个，只保留最新一份（本机 `release/installer` 被外部进程 EPERM 占用，产物先落 `installer-20261101-023859`，构建成功后自动收口回固定目录） |

## 5. 手动测试步骤（请逐项打勾）

前置：装完本批次安装包，用**管理员**账号登录（`llm:configSet` / `llm:test` 均需管理员）。

1. **主验证：不勾启用也能拨通本机 Ollama**
   参数页 → 「🧠 LLM 精炼引擎」→ 找到 `Ollama（本地）`行 → **不要勾选「启用」** → 点「测试连通」。
   期望：结果区显示 `✅ 连通（约几百 ms）—— 但尚未勾选「启用」，勾选后才会参与精炼排队`。
   反例（旧行为）：`❌ Ollama（本地） 未启用`。
   同时行内「上次拨测」应变成 `✅ <时间> <N>ms`。
2. **延时参与排队**
   勾选 `Ollama（本地）`的「启用」→ 点「保存 LLM 配置」→ 该行出现「调用顺序 1」徽标。
   期望：**只有勾选启用后**才出现顺序徽标（未启用时不出现，这是精炼口径，不是 bug）。
3. **未填模型名的引擎仍快速失败**
   把某行的「模型名」清空 → 点该行「测试连通」。
   期望：`❌ 未填写模型名`，且**几乎瞬间返回**（这是本地校验，符合预期）。
4. **云端引擎缺密钥的诚实提示**
   `DeepSeek` / `OpenRouter` 当前没有保存密钥：点其「测试连通」。
   期望：`❌ 未配置 API Key`（不会假装连通）。填入密钥后再点应给出真实结果。
5. **动作日志落对文件（本批次第二处修复）**
   做完第 1、2 步后，日志记录页顶部「程序运行日志」应出现中文行 **「LLM 引擎连通拨测（真实 HTTP）」** 与 **「保存 LLM 引擎配置」**；
   或命令行核对：`rg "\[llm:test-engine\]" "<数据根>/actions.log"`（数据根见设置页「数据目录」，本机默认 `%APPDATA%/MultiAgent Memory`）应命中，且**不含任何密钥**。
   注意看 `ms` 字段：真拨测应是几十~几百毫秒；若又是个位数毫秒，说明又被本地校验挡住了——把该行的错误文案原样反馈即可。
6. **配置仍然不含密钥**
   `rg -c "sk-" "%APPDATA%\MultiAgent Memory\llm-config.json"` 期望无命中；密钥只在同目录 `llm-keys.json`。
7. **（可选）智谱连通性**
   本机 `zhipu` 的「服务地址」目前是 `https://open.bigmodel.cn/api/v1`，**这是配置数据填错**（正确预设值 `https://open.bigmodel.cn/api/paas/v4`）。改成正确地址后点「测试连通」应真回；同时确认模型名 `glm-4.7-flash` 是否为该 Key 实际有权限的模型。代码不会代改用户填的地址。

## 6. 诚实边界

- 解耦只针对**拨测**。未勾选「启用」的引擎即使连通也不参与 L2–L6 精炼，写入仍只落 L1（这是既有硬规则，本批次不放松）。
- 「连通但未启用」只在拨测成功那一次的结果区回显；关掉页面不保留（历史要看动作日志的 `enabled` 字段）。
- 排序只认**最近一次成功拨测**的延时，不是实时健康度；引擎中途挂掉仍会先被尝试再回退。
- 34-C 的双写没有单测（`main.ts` 的 IPC handler 不在 vitest 覆盖内，依赖真 Electron 宿主），只能靠第 5 步实机核对。
- 毫秒级返回的失败=本地校验，不是网络；这是以后同类问题的第一判据，已写进 `AGENTS.md §9`。

## 7. 回滚

改动集中在 `testEngine` 的门槛判断 + 结果字段透传 + 日志双写，回滚即恢复该 `enabled` 检查；配置与密钥文件不受影响（本批次未改落盘格式）。
