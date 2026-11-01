---
status: done
---

# 批次 33 手动测试报告 —— 接入页一次登录一扫 + LLM「添加其他厂商」+ DSH 明细改道本机可点页

- 日期：2026-11-01
- 起因：用户三条反馈（前两条为文字，第三条附两张截图）——
  1. 「agent 接入配置页**首次登录扫一次即可，不需要每次切页面扫**」；
  2. 「LLM 精炼引擎厂商要可自定义其他厂商」→ 追问澄清：「**你只有预设厂商没有自定义厂商，我需要添加其他厂商 API**」；
  3. 「**dsh 还是没有改**，禁止自动上细节，只有点击的时候才可显示细节，不点击只显示前 2 行，显示请按照如图 2 的样式，点击黑三角就可展开细节」→ 追加「DSH 看能不能有其他方式实现」。
- 拍板：
  - **33-A** 自动接入去重从「近 60s 有结果就复用」改为**按登录会话记账**（sessionStorage，一次登录一轮）。
  - **33-B** 引擎卡把「添加其他厂商 API」做成显性入口（任意 OpenAI 兼容 baseURL），同时把预设快选从 6 家扩到 13 家。
  - **33-C** 先复测渲染能力：**2026-11-01 DSH 实测仍把 `<details>` 当纯文本吐出**（连 `▶` 黑三角样式都不出现，与批次29/32 结论一致）→ 气泡内联折叠做不到，改「聊天只留 2 行摘要 + 一条可点链接，点开是本机 8204 上的真 HTML 折叠页」。

## 1. 改动清单（逐文件理由）

### 1a. 接入页扫描每次登录只跑一轮（33-A）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/web/AgentOnboard/autoOnboard.ts` | 新增 `ONBOARD_AUTOSCAN_KEY='agentOnboardAutoScanSid'` + `hasAutoScannedSession/markAutoScannedSession/clearAutoScannedSession`（`autoScanStore()` 优先 sessionStorage，宿主环境没有时退回 localStorage）；`runAutoOnboard` 在 `trigger=login/auto` 且有 `sid` 时**起扫即标记**；`resetAutoOnboardState()` 三清（接入状态 / 失败快照 / 扫描标记） | 60s 窗口在「切走再切回」时早已过期，每切一次页就重跑三路真扫（宿主扫描 + 后端拨测 + MCP 面板），既慢又刷屏——正是用户反馈第 1 条。起扫即记，扫描中途切页也不会起第二轮 |
| `src/web/AgentOnboard/AgentOnboardPage.tsx` | 挂载补扫条件改 `if (hasAutoScannedSession(session.sid)) return;`，删除 `AUTO_SCAN_REUSE_MS=60_000` 与时间窗口判定 | 「本次登录已扫过」就是唯一判据；卡片/发现行/接入状态仍由挂载初始态从持久化快照回填，跳过扫描不需要额外补拉 |
| `src/web/Home/LoginModal.tsx`（未改） | 登录成功仍传真实 `sid` 调 `runAutoOnboardOnLogin` | 标记写在流水线内部，登录/启动补扫两条路共用同一口径，不加第二条路径 |
| `src/web/AgentOnboard/__tests__/autoScanSession.test.ts`（新增 4 例）、`__tests__/AgentOnboardPage.test.tsx`（改写批次18 那两条 + 新增 1 条） | 标记落 sessionStorage（不落 localStorage）、按 sid 判定、清除、reset 三清；页面「已扫过 → 宿主扫描 0 次」「换 sid → 扫 1 次且起扫即记账」「无会话 → 登录门禁不扫」 | 修复前先立失败用例；「不重复扫」必须是可断言的调用次数，不是观感 |

### 1b. LLM 添加其他厂商 API（33-B）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/electron/llmGateway.ts` | `LLM_PRESETS` 从 6 家扩到 **13 家**：本机 `ollama/vllm/lmstudio`（`needsKey=false`）+ 云端 `deepseek/kimi/zhipu/qwen/siliconflow/minimax/stepfun/spark/groq/openrouter` | 用户看到的「只有预设」要一次性覆盖常用国产/海外厂商，减少手工填地址的负担 |
| `src/web/params/LlmEngineCard.tsx` | 卡尾「**添加其他厂商 API**」区（`llm-add-section` / `llm-add-custom-name\|baseurl\|model` / `llm-add-custom`）：名称 + baseURL 必填才可点，提交 `{add:{name,baseURL,model}}`，成功后清空输入并提示可点「测试连通」；预设下拉只列**尚未添加**的预设；无宿主 IPC 时不渲染添加入口并如实说明；主进程未返回引擎列表时给 `llm-load-failed` + 「重新读取」 | 用户明确要的是「自定义厂商入口」，必须显眼、可点、可验证；纯浏览器没有主进程就不能假装能加 |
| `src/web/params/llmEngine.ts` | `LlmConfigPatch.add` 形状对齐主进程 `LlmAddEngine`（预设或自定义） | 渲染层与网关补丁口径同一真源 |
| `src/electron/__tests__/llmGateway.test.ts`、`src/web/params/__tests__/LlmEngineCard.test.tsx`（新增 9 例） | 13 家预设顺序 + `needsKey=false` 恰为本机三家 + 序列化不含密钥；页面测试覆盖 add 载荷逐字断言、必填门、预设下拉过滤、空列表指引、member 只读、排队徽标只给可调用引擎、remove | 新能力至少正常/拒绝/边界三条路径 |

### 1c. DSH 明细改道本机一次性页面（33-C）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/core/memagent/recallDetailTickets.ts`（**新文件**） | `RecallDetailTickets<T>`：`issue()` 用 `randomBytes(16).toString('base64url')`（22 字符不可枚举 id）+ `expiresAt=now+RECALL_DETAIL_TTL_MS(30min)`；`take()` 不消费（TTL 内可重复打开）、过期当场回收；上限 `RECALL_DETAIL_MAX_TICKETS=200`，`evict()` 先清过期再按插入序淘汰最早；**纯内存不落盘** | DSH 的聊天窗口无法渲染折叠控件，但它是真浏览器 → 把折叠发生在**我们自己能控制的页面**上。票据必须不可枚举、会过期、不占内存无上限增长，且明细正文不进数据根 |
| `src/core/memagent/recallInsight.ts` | `buildRecallSections(result, hint, price, clip, maxChars=120)` 成为四段**唯一生产者**（聊天 Markdown 与页面同源）；新增 `buildRecallDetailPage()`（真 `<details>` + `list-style:disclosure-closed/open` 黑三角 + 全部展开/收起 + 深浅色 `prefers-color-scheme` + `no-referrer` meta + 页脚口径说明）与 `buildRecallDetailExpiredPage()`；`buildRecallCompactMarkdown(hint, detailUrl?)` 有链接时输出两行摘要 + `▶ [展开本次召回明细（…）](url)`，**不再**输出「请调 detail=true」那句；`hint.shortLine` 保证聊天侧 ≤2 行（今日/全部金额明细移到页面，`hint.line` 保留全量）；未定价摘要分隔符统一为 `） ｜ ` | 用户要求「不点击只显示前 2 行」→ 摘要必须有硬上限；数字与金额仍要求同源，不能为省地方编数据 |
| `src/core/memagent/mcpRecall.ts` | `markdown-compact` 档签发票据，结果增 `display.detail_url`（`http://127.0.0.1:<实际端口>/recall/<id>`；TCP 8202 无 base → `null`）；页面文案的有效期用同一常量 `RECALL_DETAIL_TTL_MS` | 「页面写着 30 分钟有效」与实际票据过期时刻必须同源，否则是假承诺 |
| `src/core/memagent/mcpHttp.ts` | 8204 同一监听器新增 `GET /recall/<id>`（白名单正则 `/^[A-Za-z0-9_-]{16,32}$/`，仍过 `rejectUntrustedHost`）；命中 → `text/html` + `Cache-Control: no-store` + `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` + CSP `default-src 'none'; style/script 'unsafe-inline'; img/frame-ancestors/form-action none`；未知/过期 → 404 失效页；`opts.onViewDetail('ok'\|'miss')`；`recallEchoNote('markdown-compact')` 改「默认收起 + 点击展开 / URL 必须逐字保留 / 禁止自行补写 / 不要因为觉得更完整就调 detail=true」 | 浏览器顶级导航不带 `Origin`，所以同端口能给页；但 Host 绑定与不可猜 id 是这条通道不被本机其它页面/远端利用的前提 |
| `src/core/memagent/mcpSchema.ts` | `recall_memory` 描述与 `MCP_INSTRUCTIONS` 第 2 条改「摘要 + 点击链接展开；链接失效才用 `detail=true`」 | 客户端不保证注入 instructions，所以约束同时写进工具描述 |
| `src/electron/main.ts` | `onViewDetail` → 动作日志 `mcp:recall_detail_view`（只记 `outcome`） | 「有动作就有日志」；明细正文不进日志 |
| `__tests__/recallInsight.test.ts`（改写/新增 11 例）、`__tests__/recallDetailTickets.test.ts`（新增 5 例）、`__tests__/mcpHttp.test.ts`（新增链路 + 页面 + 403 用例） | 两行摘要结构与 priced/未定价文案、带链接档、档位矩阵；票据 id 形态/TTL 边界/重复打开/上限淘汰；真 GET 200 + 加固头、伪造 id 404、带 `Origin` 403、伪造 `Host` 403、页面与摘要 `not.toContain(TOKEN)` | 令牌安全与「不铺开明细」都是必须钉住的断言 |
| `AGENTS.md` §1.1/§3/§9、`CLAUDE.md`、`specs/code-map.md`、`specs/需求规格书.md §19.14`、`specs/code-index.generated.md` | 三档口径改「摘要两行 + 可点明细页」；§3 新增明细档位/明细页与 LLM 自定义厂商行；§9 增批次33-A/33-C 边界；批次33 代码映射段；索引刷新（286 文件） | 门禁要求「功能完成即建索引」 |

**未改动**：内核写路径与召回算法本身（只是换了下发档位）、`display.markdown` 的 HTML 档（Qoder 系仍是 `<details>` 四段折叠）、`llm:configSet` 的 IPC 门禁（仍仅管理员）、数据根文件清单（明细不落盘，无新文件）。

## 2. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,002,091 B（116.35 MiB） |
| SHA256 | `89236ef90b524cccd2dd4d7998e1d7e1532a02239dad3329b393b2aa89f48c76` |
| 构建时刻 | 2026-11-01 10:14（UTC+08:00） |

打包前按既有机制强制结束 `release/` 下运行中的旧实例；`release/installer` 先原子重命名为 `installer-20261101-021415-stale` 腾空，构建成功后删除该旧目录（输出 `[package] 已删除旧安装包目录 release\installer-20261101-021415-stale` / `旧安装包目录清理 1 个`），`exit=0`。当前 `release/` 下只有 `installer` 一个目录（`ls release/` 实测），旧便携包 `release/win-unpacked` 与 `release/builder` 残留一并清理。

## 3. 自动化验证（真实跑过）

- `npm run verify:fast` **exit 0**：typecheck 双配置 0 错、oxlint 0 warnings / 0 errors（456 文件 / 123 规则）、代码索引已是最新（**286 个文件**）。
- `npm run verify`（全闸）**exit 0**：Electron 构建（`main.cjs` / `preload.cjs` built OK）+ Playwright E2E **94 passed（33.6s）**，全部打到真实后端。
- 单测：**126 文件 / 1411 用例全过**（批次33 新增/改写：`autoScanSession.test.ts` 4 例、`AgentOnboardPage.test.tsx` 补扫三条路径、`LlmEngineCard.test.tsx` 9 例、`llmGateway.test.ts` 预设 13 家、`recallDetailTickets.test.ts` 5 例、`recallInsight.test.ts` 明细页/摘要档 11 例、`mcpHttp.test.ts` 明细页链路 + 200/404/Origin 403/伪造 Host 403 + `not.toContain(TOKEN)`）。
- 覆盖率：语句 **79.85%**（9402/11774）/ 分支 **71.98%**（6613/9187）/ 函数 **75.71%**（2157/2849）/ 行 **82.85%**（8168/9858），均高于阈值（71/61/67/74）。

## 4. 手动测试步骤（验收用）

### A. 接入页：首次登录扫一次，切页面不再扫（33-A）

1. 安装新包并启动桌面端，管理员登录 → 首页应显示「已自动接入」完成态（登录瞬间后台跑的那一轮）。
2. 切到「Agent 接入配置」页 → **不应**重新出现「启动后自动扫描…」并刷屏；直接显示已完成态与卡片、发现行、MCP 面板（来自持久化快照回填）。
3. 切去别的页面再切回接入页 2–3 次 → 扫描区域文字保持「完成 · 发现并绑定 N 个 · 宿主真扫」，卡片数量不变。日志佐证：`actions.log` 中 `onboarding:auto-onboard`（`trigger=auto`）在同一个登录会话里**只出现一次**（UTC+08:00 时刻对齐）。
4. 点「🔍 手动检测」→ **必须真扫**（不受标记约束）：出现「宿主真扫 + 安装痕迹 + MCP 配置中…」，并新增一条 `trigger=manual` 日志。
5. 点「撤销并重接全部」→ 标记被清（`resetAutoOnboardState()` 三清），随后再进接入页会重新补扫一轮。
6. 关闭整个应用窗口再打开（同一登录会话恢复）→ 标记随窗口关闭清空，**仍补扫一轮**（批次18 语义保留）；换账号登录（sid 变了）同样照扫。

### B. LLM：添加其他厂商 API（33-B）

1. 管理员 → 「全局参数」页 → 「🧠 LLM 精炼引擎」卡。
2. 「预设快选」下拉应能选到 13 家里尚未添加的（Ollama / vLLM / LM Studio / DeepSeek / Kimi / 智谱 GLM / 通义千问 / SiliconFlow / MiniMax / 阶跃星辰 / 讯飞星火 / Groq / OpenRouter）。
3. 卡尾「**添加其他厂商 API**」：填名称（如「内部网关」）+ baseURL（任意 OpenAI 兼容地址，例 `https://llm.corp.example/v1`）+ 可选模型名 → 点「添加」→ 新引擎行出现，标「云端/需密钥」，`调用顺序` 徽标按可调用口径给。
   - 名称或 baseURL 留空 → 「添加」按钮禁用（不静默提交）。
4. 新引擎行填 API Key → 点「测试连通」→ ✅ 显示真实延时 / ❌ 显示厂商返回原因（截断、**不含密钥**）。延时写入排队：下一个成功拨测的引擎若更快，徽标顺序会变。
5. 门禁：普通成员进同页 → 添加区、保存、拨测、删除全部禁用并提示「需管理员」；未登录/浏览器 dev 模式 → 卡片诚实显示「不可用」，**不渲染添加输入框**。
6. 日志与落盘：`actions.log` 有 `llm:config-saved` / `llm:test-engine`（只记 id/模型/延时）；数据根 `llm-config.json` 全文不含 `sk-` 等密钥串（`rg -c "sk-" <数据根>/llm-config.json` 应为空/0），密钥只在 `llm-keys.json`（0600）。

### C. DSH：不点击只显示 2 行，点击展开真折叠明细（33-C）

1. 在 DSH 里问一个本仓库实现/历史类问题（触发 `recall_memory`）。
2. 预期聊天里只有 **两行加粗摘要**（🧠 Memory 行 + 💰/次数行）+ 一行 `▶ [展开本次召回明细（项目背景 / 命中记忆 / Token 用量 / 省钱与费用）](http://127.0.0.1:<端口>/recall/xxxx)`：**没有**四小节全文，**没有**裸露的 `<details>` 标签，也没有「请调 detail=true」的指引。
3. 点那条链接（或复制 URL 到浏览器，桌面端须正在运行）→ 打开的是**真折叠页**：四个条目默认收起，点每段左侧 `▶` 黑三角展开，右上「全部展开 / 全部收起」可用；页面顶部两行摘要与聊天里数字**完全一致**，深浅色跟随系统。
4. 链接可重复打开（30 分钟内多次点开都行）；等 30 分钟或重启应用后再开 → 显示诚实的「本次召回明细链接已失效」页，并写明退路（重新提问 / 让 Agent 用同一 query 调 `recall_memory(detail=true)`）。
5. 令牌安全：页面与聊天摘要都不含 MCP 令牌（URL 只有随机 id）；伪造 id（如 `/recall/0000000000000000000000`）→ 404 失效页；别的本机页面带 `Origin` 访问 → 403；伪造 `Host` → 403。
6. 回归：**Qoder 里问同样问题**仍是 `<details>` 四段折叠档（`display.mode=html-details`，行为与批次29/32 一致）；`detail=true` 仍能给纯 Markdown 四小节（`markdown-full`）；`detail` 传非布尔 → 明确参数错误。
7. 观测：`actions.log` 每次点开明细页出现一条 `mcp:recall_detail_view`（`outcome=ok` 或 `miss`，不含正文）。

## 5. 已知边界（诚实声明）

- **33-C 的展开发生在系统浏览器/新窗口，不是 DSH 气泡内联**：2026-11-01 复测确认 DSH 把 `<details>` 原样当文本输出，气泡内黑三角在该客户端做不到；用户要求的「点黑三角展开」以「聊天 2 行 + 可点链接 → 本机真折叠页」实现。
- **明细页有 30 分钟 TTL 且只在内存里**：过期/应用重启后旧链接不可恢复（只给 404 失效页与退路），明细正文不进数据根、不进日志；票据上限 200 条，超出淘汰最早。
- **TCP 8202 与拿不到 base 地址的调用 `detail_url=null`**：仍是「摘要 + 再调一次 `detail=true`」口径；纯文本渲染的客户端链接不可点，但 URL 逐字可见可复制。
- **明细页正文按 400 字截断**（页脚写明），完整内容看聊天 `detail=true` 档或原记忆条目。
- **33-A 标记「起扫即记」**：本轮自动接入失败后，切页不会自动重试（失败原因仍如实显示），需点「🔍 手动检测」；关闭应用窗口/重启后标记清空 → 恢复会话仍补扫一轮，换账号（sid 变化）照样扫。
- **33-B 的云端厂商未在本机实拨**（需你自填各厂商 API Key）：协议按 OpenAI 兼容 `chat/completions`，`测试连通` 即真实 HTTP 拨测；`{tier:cheap, price:0.01}` 只是记账元数据，**不代表厂商账单**；非该协议端点（如纯 Anthropic Messages 格式、gRPC）不在支持范围。新添加的引擎在拨测成功前不参与「按延时排队」优先级（排在已拨测引擎之后）。
- 浏览器 dev 模式（`npm run dev`）没有主进程：引擎卡与明细页 IPC 均如实不可用；DSH/接入页仍按各自诚实口径显示。
- 本机测量期间的副作用提醒：2026-11-01 09:32/09:33 为复测 DSH 渲染能力，向你的 DSH 会话发过测试气泡；另外 DSH 的 MCP Bearer 令牌在本会话早前曾被明文显示过，**建议尽快轮换**（接入页「轮换密钥」→「⚡ 一键适配全部」可同步所有客户端）。
