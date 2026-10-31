# 手动测试报告 · 修复批次 16（登录即自动接入本机 Agent + 卡片真实指标）

- 日期：2026-10-31（本机时间 UTC+08:00；打包完成 **00:27:38**）
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-162718/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,968,411 B = **116.32 MiB**
  - SHA256：`5eac6b70f4fda8e7f2210251b4f198e024f386711dc3d6063f3803f3e2720d7e`
- 未打包目录：`release/installer-20261030-162718/win-unpacked/MultiAgent Memory.exe`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-15.md`（MCP 客户端推广）、`specs/MANUAL-TEST.md` §3.5（通用手测入口）

> **输出目录说明**：旧实例仍从 `release/installer/win-unpacked` 运行，`release/installer` 被占用，打包脚本自动改输出到 `release/installer-20261030-162718/`（目录名中的时间是 UTC，对应本机 **2026-10-31 00:27:18**）。本次**未强制关闭**正在使用的旧实例。上一轮批次15 包 `installer-20261030-160355` 已被本轮取代，请以本文件文首为准。

---

## 0. 起因与结论

用户要求：

1. 说明 Agent 接入页的自动发现逻辑（通过哪些方法发现）；**登录后第一时间扫描并接入本机**；异常时提示用户点「🔍 手动检测」；接入成功的 Agent 自动增加接入卡片；连接成功后把 MCP 服务写入对应 Agent。
2. 卡片内的**连通成功率、熔断状态、平均延时、租户**要在登录后第一次连通时显示出来。

核查后确认：此前页面首次进入是「待扫描」，需要用户手动点按钮；发现结果只有宿主真扫一路，浏览器模式还会回退「内核模拟」；卡片成功率/平均延时没有从后端审计首刷。批次16 把自动接入做成**真实链路**：

| 要求 | 落地 |
| --- | --- |
| 登录即扫描 | 登录成功回调后台执行 `runAutoOnboardOnLogin`（不阻塞登录），结果写 localStorage；接入页通过 `storage` 事件即时恢复 |
| 发现方法 | 三路并行真扫：① 宿主 `hostScan:run` ② 安装痕迹 `hostAgentDetect:run`（五路）③ MCP 客户端配置 `mcp:clients`（10 家真实文件） |
| 异常提示 | 任一路失败保留真实原因；全部失败写 `agentOnboardFailure`，页面顶部「⚠ 自动接入未完成…请点击上方『🔍 手动检测』重试」 |
| 自动加卡 | 新发现的 Agent 按默认值建卡（`addAgentCard`），已有卡片保留用户配置不覆盖 |
| 写 MCP | 已连通（后端 `CONNECTED`；后端拨测未成功时以宿主真扫命中为连接证据）且为可写 JSON 客户端 → 管理员会话经 `mcp:clientWire` 写入；写前备份、原子替换 |
| 卡片指标 | 首次挂载 `GET /agents` + `GET /audit` 回填：成功率（`test` + `auto_bind`）、熔断（`/agents` circuit）、平均延时（审计 `durationMs`）、租户（`/api/me` 会话） |

**核心事实**：批次16 起**纯浏览器不再降级「内核模拟」**——没有宿主能力就明确失败，绝不伪造「已接入」；后端不可达时指标显「—」，不用估算值填充。

---

## 1. 自动发现逻辑（三路 + 合并 + 流水线）

### 1.1 三路信号（`src/web/AgentOnboard/autoDiscovery.ts`）

| 路 | 宿主方法 | 读什么 | 回答什么问题 |
| --- | --- | --- | --- |
| ① 宿主真扫 | `hostScan:run` | Windows `tasklist /fo csv /nh`（`wmic` 兜底）/ Unix `ps -eo comm=` 枚举进程；MCP 注册表/配置存在性；Agent 配置文件路径 | 本机**正在运行**哪些 Agent、注册了什么 MCP、有哪些配置 |
| ② 安装痕迹 | `hostAgentDetect:run` | 五路：CLI `where/which`（含 `--version`）、安装目录 exe、开始菜单快捷方式、home 配置、Windows 注册表卸载项（HKLM/HKCU，PowerShell） | 本机**确实装了**哪些 Agent（以安装痕迹为准，不把运行进程当安装证据） |
| ③ MCP 客户端配置 | `mcp:clients` | 10 家客户端的真实配置文件：`~/.qoder-cn/settings.json`、`~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json`、`~/.gemini/settings.json`、`~/.qwen/settings.json` 等 | 哪些客户端**已注册本服务**（`wired`）、缺令牌（`missing_auth`）、未配置（`missing_entry`）、冲突（`conflict`）、坏文件（`invalid`）、需手工（`manual`） |

合并规则：

- `Promise.allSettled` 三路并行，**单路失败不影响其它路**；每路失败原因原样带出（`errors[]`）。
- 同名 Agent 去重，保留两路证据（如「安装痕迹（cli）· where claude」+「进程 · claude.exe」）。
- `ok = 宿主路成功 || 安装痕迹路成功`；**零命中仍算成功扫描**（本机真没装 Agent 与扫描失败必须区分）。
- `hostCapability() === 'none'`（纯浏览器）→ 直接返回失败原因「非桌面壳环境：浏览器无法读取本机进程/安装痕迹，请使用桌面应用」，不返回空列表冒充「未安装」。

### 1.2 登录触发与流水线（`src/web/AgentOnboard/autoOnboard.ts`）

```text
登录成功（LoginModal）
  → runAutoOnboardOnLogin({ role, sid, form })   // 后台执行，不阻塞登录
    → scanLocalAgents()                           // 三路真扫合并
    → 新 Agent 自动建卡（addAgentCard，已有卡片不覆盖）
    → POST /discover（后端 oneClickOnboard）       // 写 auto_bind 审计，产出 CONNECTED/DEGRADED
    → autoWireMcpForAgents(connectedNames, …)     // 管理员 + 可写 JSON → mcp:clientWire
    → 写 agentOnboardState（discovered/installed/mcp/backendOk/seq）
    → 失败写 agentOnboardFailure（reason/installed/probes）
```

- 同一时刻只跑一轮（`inFlight` 去重）；「⚡ 自动发现并接入」「🔍 手动检测」「↻ 撤销并重接」共用同一流水线。
- 接入页打开时先读持久化状态：有 → 直接显示「✅ 已自动接入 · 切页/重载保持」；无 → 等登录触发的 `storage` 事件即时恢复，不用等切页重扫。
- 失败快照跨 iframe 可见；顶部失败提示同时指向「🔍 手动检测」。

### 1.3 MCP 写入边界（`autoWireMcpForAgents`）

| 条件 | 行为 |
| --- | --- |
| 客户端已 `wired` | 计入「已写入」，不重复改文件 |
| `writable && format=json`（Qoder CN / Claude Code / Cursor） | 管理员会话 → `mcp:clientWire`；写前 `.bak-<ISO>` 备份 + 临时文件 + rename；本次有变化计入「新增」 |
| `conflict`（同名条目指向别的端点） | **拒绝覆盖**，记录真实端点与失败原因 |
| `invalid`（文件不是合法 JSON / 超 8 MiB） | **拒绝写入**，记录解析错误 |
| Codex（TOML）、Gemini/Qwen（只读片段）、Trae/WorkBuddy/Zcode/deepseek harness（无稳定路径） | 记「需手工」，面板给端点与请求头说明 |
| 无登录会话 / 普通成员 | 记失败「无登录会话」「需管理员权限」，**不改文件** |
| 纯浏览器 | 记失败「浏览器模式无法写本机配置」 |

令牌只在片段/写入时一次性传给受信渲染层，绝不进 `actions.log` / 审计。

---

## 2. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 16-A 三路真扫 | `scanLocalAgents()`：`Promise.allSettled` 合并宿主/安装痕迹/MCP 配置；单路失败保留原因；同名去重保留双证据；浏览器明确失败 | `src/web/AgentOnboard/autoDiscovery.ts`（新） |
| 16-A 登录即接入 | `runAutoOnboard` / `runAutoOnboardOnLogin`：自动建卡 → `/discover`（`auto_bind`）→ MCP 自动写入 → 持久化状态/失败快照；同刻一轮 | `src/web/AgentOnboard/autoOnboard.ts`（新） |
| 16-A 状态模型 | `OnboardState`（含 `discovered/installed/mcp/backendOk/seq`）与 `OnboardFailure`；storage 事件键 | `src/web/AgentOnboard/onboardState.ts` |
| 16-A 登录触发 | 登录成功传真实 `{role, sid, form}` 后台执行；MCP 写入的管理员门槛由主进程二次校验 | `src/web/Home/LoginModal.tsx` |
| 16-B 接入页接线 | 自动接入徽章/撤销重接、失败提示 `data-testid="onboard-failure"`、已安装列表、MCP 摘要 `data-testid="mcp-wire-summary"`、storage 即时恢复、自动新增卡片 | `src/web/AgentOnboard/AgentOnboardPage.tsx`、`OneClickOnboard.tsx` |
| 16-C 卡片指标 | 首次挂载 `GET /agents` 合并电路/优先级/状态；`GET /audit` 汇总 `test`+`auto_bind` 成功率与 `durationMs` 平均延时；轮换后刷新；租户来自 `useSessionContext` 的 `/api/me` | `src/web/AgentOnboard/useBackendMirror.ts`、`AgentCard.tsx` |
| 16-C 审计样本 | `auto_bind` 写入本轮真实批量探测耗时 `durationMs`（同轮每家共享一个样本）；旧审计无样本时延时显「—」 | `src/agentOnboard/service.ts` |
| 测试 | 三路合并/单路失败/浏览器失败；MCP 写入（管理员/成员/无会话/冲突/TOML/去重）；登录成功触发自动接入；storage 恢复；卡片指标首刷；`auto_bind` 计入成功率与延时 | `src/web/AgentOnboard/__tests__/autoDiscovery.test.ts`（新）、`AgentOnboardPage.test.tsx`、`coreReal.test.ts`、`src/web/Home/__tests__/LoginModal.test.tsx` |
| E2E | 一键接入改为「四段进度 + 浏览器如实失败并指向手动检测」，不再断言内核模拟 | `e2e/app.spec.ts` |
| 文档 | AGENTS.md §3/§9、`specs/code-map.md` 批次16、`specs/需求规格书.md` §19.9、`specs/MANUAL-TEST.md` §3.5/§6/§7、`specs/code-index.generated.md` | `AGENTS.md`、`specs/*.md` |

### 关键设计（为什么这样做）

- **发现 ≠ 信任**：安装痕迹只回答「装没装」，接入仍按 19.2 打标、按默认值绑定；自动绑定只开只读召回，P2 写入仍需确认。
- **失败必须可见**：三路各自失败都带原文；全部失败写快照，页面明确提示手动检测，绝不把失败显示成「已接入」或「未安装」。
- **MCP 写入只做「稳」的**：只改结构稳定的 JSON 客户端；TOML/未知格式只给片段。冲突/坏文件拒绝覆盖，备份 + 原子替换保证可回退。
- **指标不估算**：无审计样本时成功率/延时显示「—」；`CONNECTED` 只由后端真实探测结果决定（未注入探测时一律 `DEGRADED`，见 `service.ts` / `probe.ts`）。
- **登录不阻塞**：自动接入在后台跑；登录成功先完成跳转，扫描结果通过 storage 事件回填页面。

---

## 3. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程 + Electron 类型检查 | `npm run typecheck` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning**（416 文件 / 123 规则） |
| 单元/集成测试 | `npm run test:coverage` | **107 文件 / 1090 用例全过** |
| 覆盖率 | 同上 | 语句 76.30%（7667/10048）、分支 68.07%（5130/7536）、函数 71.47%（1792/2507）、行 79.21%（6685/8439）；阈值 71/61/67/74，通过 |
| 真浏览器 E2E | `npm run test:e2e` | **21 个 spec / 93 用例全过（31.1s）** |
| 正式打包 | `npm run package` | 退出码 0（vite + esbuild + electron-builder NSIS） |
| 打包内容核对 | `grep -a` app.asar / main.cjs | app.asar 含 `非桌面壳环境`（2）、`onboard-failure`、`mcp-wire-summary`、`已自动接入`、`agentOnboardState`（3）；`main.cjs` 含 `mcp:clientWire`（2）、`hostAgentDetect:run`（2） |

新增单测覆盖：三路合并与去重、单路失败、浏览器失败；MCP 写入正常/已 wired/冲突/TOML/成员/无会话/未收录；登录成功触发后台接入并传 `{role, sid, form}`；storage 事件恢复徽章/发现行/卡片；卡片指标首刷（50% / OPEN / 200ms / `ent_42 / team_99`）；旧审计无 `durationMs` 不伪造延时。

> E2E 说明：所有 spec 的静态服务与后端都用系统分配端口，可与已运行的应用并存；`workers=1` 串行执行。本轮 E2E 在新增两条单测前执行，后续只改测试文件，未改应用代码。

---

## 4. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-162718/MultiAgent Memory-0.1.0-setup.exe` | 121,968,411 B = **116.32 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-162718/win-unpacked/MultiAgent Memory.exe` | 249,934,848 B |
| 增量块映射 | `release/installer-20261030-162718/MultiAgent Memory-0.1.0-setup.exe.blockmap` | 随包生成 |

未配置代码签名（沿用既有配置，Windows 可能提示「未知发布者」，选择「仍要运行」）。

---

## 5. 手动测试步骤

> 前置：安装/启动批次16 新包（旧实例仍在运行批次15 包，需先退出旧实例再启动新包，避免单实例锁让新包直接退出）。

### 5.1 管理员视角：登录即接入

1. 用 `admin` 登录 → **先不打开接入页**，等 3–10 秒（安装痕迹扫描会执行 `where` / `--version`、读注册表；慢机器可能更久）。
2. 打开「Agent 接入配置页」，核对：
   - 顶部显示「✅ 已自动接入 · 切页/重载保持」与「↻ 撤销并重接」；
   - `scanState` 为「完成 · 发现并绑定 N 个 · 宿主真扫」；
   - `#found` 每行带真实信号（如「安装痕迹（cli）· where claude」「进程 · claude.exe」）与「宿主真扫」；
   - 本机确有安装的 Agent 已自动出现在 `#cards`，没有演示卡。
3. 核对卡片四项指标（首次挂载即回填，有审计样本时不得全是「—」）：
   - **连通成功率** = `/audit` 中该 Agent `test` + `auto_bind` 通过数 / 总数（`<95%` 标黄）；
   - **熔断状态** = `/agents` 的 `circuit`（`OPEN` 时「测试接入」禁用并显示熔断降级文案）；
   - **平均延迟** = 审计 `durationMs` 均值（无样本显示「—」，不估算；>5s 标黄）；
   - **租户** = 当前登录的 `enterprise_id / team_id`（只读，来自 `/api/me`）。
4. 点某张卡「测试接入」→ 应出现真实 `req_` 回执与耗时 toast，指标随审计刷新；断网/后端不可达时应如实显示「接入后端不可达，本地未验证」，不得滞留「已连通」。

### 5.2 MCP 自动写入

1. 确认登录会话为管理员、且本机命中 Qoder CN / Claude Code / Cursor 等可写 JSON 客户端。
2. 页面出现「🧠 MCP 接入（自动写入已连通 Agent）」摘要（`data-testid="mcp-wire-summary"`）。
3. 到真实配置文件核对：
   - `~/.claude.json`（key `memagent`）或 `~/.qoder-cn/settings.json`（key `MultiAgent Memory`）含端点 `http://127.0.0.1:8204/mcp` 与 `headers.Authorization`；
   - 写入前生成 `.bak-<ISO 时间戳>` 备份；再点一次不会产生第二个备份；
   - Codex（TOML）/无稳定路径客户端显示「需手工添加」。
4. 查数据根 `actions.log`：
   - `[mcp:client-wire]` 有写入动作，**不含令牌**；
   - `[onboarding] [auto-onboard]` 含 `trigger:"login"`、`found/installed/backendOk/mcp` 计数与耗时。
5. 冲突保护：手工把某 JSON 客户端同名条目改成 `http://127.0.0.1:9999/mcp` → 摘要显示「拒绝覆盖」，原条目不变。

### 5.3 异常提示 + 手动检测

1. 停掉接入后端（结束 8200 端口进程）后重新登录，或点「↻ 撤销并重接」。
2. **预期**：页面顶部出现「⚠ 自动接入未完成：…」并提示点「🔍 手动检测」；点击后仍如实显示失败原因（后端不可达时 `backendOk=false`、`backendError` 带原文），**不得伪造接入卡片/连通状态**。
3. 恢复后端后点「🔍 手动检测」→ 完成文案恢复，MCP 摘要与卡片指标重新回填。

### 5.4 普通成员视角

1. 用普通注册账号登录 → 三路扫描照常执行，自动建卡照常。
2. MCP 摘要显示「需管理员权限才能写入 MCP 配置」，**配置文件不被修改**。
3. 即使绕过 UI 伪造 `sid` 调 IPC，主进程 `requireAdmin` 也应拒绝（`actions.log` 出现 `denied: not_admin/no_session`）。

### 5.5 浏览器模式（`npm run dev`）

1. 点「⚡ 自动发现并接入本机 Agent」→ 四段进度后显示「自动接入失败 · 非桌面壳环境…」，提示改用桌面应用或手动检测。
2. 点「🔍 手动检测」→ 仍如实失败；页面**不得**出现「内核模拟」发现行或伪造卡片。

---

## 6. 已知限制（不应作为缺陷）

- **`CONNECTED` 的判据是「后端宿主探测命中安装痕迹」**（`src/agentOnboard/probe.ts` 复用 `detectLocalAgents`），不是对 Agent 的 MCP 端点做网络握手；Agent 是否真正加载新配置仍取决于客户端重启与自身实现。
- **自动写入仅 JSON 客户端**（Qoder CN / Claude Code / Cursor）；Codex（TOML）、Gemini CLI / Qwen Code（只读片段）、Trae CN / WorkBuddy / Zcode / deepseek harness（无稳定配置路径）只给片段/手工说明。写入后需**重启客户端**才会加载。
- **纯浏览器无宿主能力**：自动接入与手动检测都会明确失败，不降级模拟；需使用桌面应用。
- **登录扫描是后台执行**：慢机器上注册表/CLI 探测可能需要数秒；期间打开接入页会先显示「待扫描」，完成后经 storage 事件自动恢复；全部失败则显示失败提示。
- **接入状态存 localStorage（同源 iframe 共享）**：同一次运行内切页/刷新保持；应用重启会换静态端口（新源），状态不跨重启保留，但登录会再次自动扫描——「登录后第一次」即重新建立。
- **指标样本来源有限**：平均延时来自 `test`/`auto_bind` 审计的 `durationMs`（一轮批量探测所有 Agent 共享一个样本）；旧审计无 `durationMs` 时只显示最近值或「—」，不估算。
- **后端拨测未成功**（不可达或返回失败）：`backendOk=false`，卡片指标保留上一次真实审计或显示「—」；MCP 写入此时以宿主真扫命中为连接证据（仍要求管理员 + 可写 JSON）。
- **冲突/坏文件保护**：同名条目指向其它端点（`conflict`）或文件无法解析（`invalid`）一律拒绝覆盖；超 8 MiB 的配置拒绝读写。
- **租户只读**：卡片租户来自登录会话；`R1` 租户仅全局注入，卡片上不可编辑。
- **目录时间戳为 UTC**：`release/installer-20261030-162718` 目录名由脚本用 UTC 生成，对应本机 2026-10-31 00:27:18。

---

## 7. 结论

- 登录后自动接入已从「页面手动触发」变为**登录后台真扫 → 建卡 → auto_bind 审计 → 自动写 MCP → 持久化恢复**的完整链路；异常可见且指向手动检测，浏览器模式不再伪造发现。
- 卡片四项指标在首次挂载即从真实 `/agents` + `/audit` + `/api/me` 回填；无样本显「—」，不估算。
- 自动化门禁全绿；安装包已生成并核对包含批次16 逻辑。
- 待用户按 §5 完成新包实机点击（重点：管理员登录 → 自动接入徽章 → MCP 文件写入 → 卡片指标 → 停后端看失败提示 → 成员只读）。
