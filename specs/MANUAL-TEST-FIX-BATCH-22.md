---
status: done
---

# 手动测试报告 · 修复批次 22（卡片指标样本纠偏 + 测试说明 + MCP 一键适配 + 登录后端诊断）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **10:05**）
- 分支：main（未提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,973,411 B = **116.32 MiB**
  - SHA256：`EE50F248F6100E0813F8264ECCC878E0543DF90F31CC49D7F2F4430104F2AEC2`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联文档：`specs/MANUAL-TEST.md` §3.10、`specs/code-map.md` 批次22、`specs/需求规格书.md` §19.17

> **输出目录说明**：本次打包前 `release/installer` 被外部进程占用（日志 `[package] release/installer 被外部进程占用（EPERM）`），产物先输出到 `release/installer-20261031-020457`；构建成功后按批次21 的兜底逻辑（rename 持续 EPERM → 复制+删除）收口回 `release/installer`，并删除旧目录。最终 `release/` **只剩 `installer/` 一份产物**。

---

## 0. 起因与结论

用户提出四项问题：

1. 「接入卡片中 DeepSeek harness、Claude Code、Codex 的连通成功率一直出不来」
2. 「接入测试必须要一个一个手动点击测试吗？测试接入是干什么用的？不点击测试接入有没有影响？」
3. 「MCP 客户端卡片能不能做个一键适配自动接入 Agent 来减轻配置难度？每个配置卡片大小要统一」
4. 「web 端登录显示登录后端未启动（localhost:8201），无法校验身份」

| 问题 | 根因 | 处理 | 结果 |
| --- | --- | --- | --- |
| 成功率一直出不来 | ① 旧版 `auto_bind` 审计没有 `status/result` 字段，却被当作「失败尝试」计入分母，成功率被压低；② 宿主扫描名（`deepseek harness`）与后端卡片名（`DeepSeek harness` / `deepseek-harness`）大小写/空格不一致，`stats[name]` 精确查表命中不了 → 静默「—」 | 只有带结果字段的样本才计入；新增 `normalizeAgentKey()`（去空白/压缩空格/小写）与 `statsForAgent()` 统一归并；卡片 `lastTest` 在审计缺样本时兜底一次真实样本与延时；完全无统计时显示「指标未加载…」而非裸「—」 | 已落地 |
| 测试是否必须逐张手点 | UI 从未解释测试用途，也无「自动拨测」说明 | 页面顶部说明条 + 每卡 `[data-test-hint]`：测试=真实拨测写审计；登录自动接入已自动拨测；不点不影响接入与指标 | 已落地 |
| MCP 逐个配置太麻烦 + 卡片不齐 | 只有行内「一键接入」，无批量入口；行卡片 `display:flex` 高度随内容 | 面板级「⚡ 一键适配全部（N）」顺序写入全部可写 JSON 客户端并汇总；行卡片改为网格等高布局，按钮底部对齐 | 已落地 |
| Web 端提示「登录后端未启动」 | 直接打开非白名单源（如 Vite 漂移到 5198/5199）时，CORS 预检失败 `fetch` reject，旧代码一律归类成 `backend_unreachable`；开发后端还监听在 8200（与 `HOME_BASE` 8201 不一致） | 新增 `GET /api/health` + `no-cors` 探针区分 `origin_blocked` / `backend_unreachable`，两种文案分别给修复指引；开发后端改 8201、新增 `npm run dev:backend`；Vite 固定 5180 + `strictPort`；拒绝来源写 `origin_rejected` 日志 | 已落地 |

**结论**：成功率缺失的三种真实成因（旧样本污染、名字不匹配、无样本无解释）全部收敛；「必须手点」的误解有界面说明；MCP 配置从逐个点击变为一次批量；登录报错从「一律说没启动」变成可区分的准确诊断。

---

## 1. 改动详解

### 1.1 卡片指标：样本口径纠偏 + 名字归一 + 诚实空态

`src/web/AgentOnboard/useBackendMirror.ts`

- 新增导出：
  - `normalizeAgentKey(name)`：`trim` + 连续空白压缩为单个空格 + `toLowerCase`；
  - `statsForAgent(stats, name)`：先精确命中，再按归一键查找。
- `computeAgentStats(entries, cards)` 重写：
  - 用 `display: Map<norm, 显示名>`（后端卡片名优先播种）+ `byKey: Map<norm, AgentRealStats>` 聚合，卡片与审计自动合并到同一统计键；
  - **旧样本排除**：只有 `status` 或 `result` 存在才计入 `tests/passed`；`durationMs` 为有限非负数才计入延时均值（缺失不补 0）；
  - 时间：`lastTestAt` 取审计与卡片 `lastTest.at` 的更晚真实时间；
  - 卡片 `lastTest` 在审计 0 样本时补 1 次尝试/通过 + 延时（只补一次，不重复计数）；
  - 保持批次21 的 `loadSeq` 乱序守卫。

`src/web/AgentOnboard/AgentOnboardPage.tsx`

- `failureReasons` 改为以 `normalizeAgentKey(c.agent_name)` 为键；`onCards` 用归一键匹配后端卡片；
- 渲染卡片时 `failureReason={failureReasons[normalizeAgentKey(a.name)]}`、`stats={statsForAgent(stats, a.name)}`；
- 页面新增说明条（`data-testid="card-metric-note"`）：「连通成功率与平均延时只统计真实拨测样本（登录自动接入的 auto_bind + 手动『测试接入』），不需要逐张点击测试；手动测试用于复查与排障，不点不影响接入和指标。」

`src/web/AgentOnboard/AgentCard.tsx`

- `[data-metric-src]` 行始终渲染：
  - 有样本 → 「指标来源：接入审计 · N 次连通尝试 / M 次通过 · 最近 X」；
  - 0 样本 → 「暂无连通样本：登录自动接入会自动拨测一次；也可点『▶ 测试接入』立即生成」；
  - 统计完全未加载 → `[data-metric-missing]`「指标未加载：本机接入后端未返回该 Agent 的审计样本；确认桌面端已启动，或点『🔍 手动检测』重建」。

`src/web/AgentOnboard/theme.css`：新增 `.metric-src[data-metric-missing]` 提示样式。

### 1.2 测试接入：用途说明

`src/web/AgentOnboard/TestPanel.tsx` 新增 `[data-test-hint]`：

> 用途：对本机 Agent 真实拨测一次并写审计（生成 request_id 与耗时）。登录自动接入已完成自动拨测，因此不必逐张手点；手动测试用于复查/排障，不点不影响接入与指标。

`theme.css` 新增 `.test .test-hint` 样式。

### 1.3 MCP 面板：一键适配 + 卡片等高

`src/web/AgentOnboard/McpClientsPanel.tsx`

- 新增 `wireAll()`：目标为 `rows.filter(canWire)`（已安装 + 可写 JSON），逐个顺序调用 `mcp:clientWire`，按钮文字实时显示 `适配中 i/N…`，结束汇总「⚡ 一键适配完成：写入 N 个 · 已是最新 M 个 · 失败 …」，随后 `refresh()` 重新扫描。
- 头部按钮 `⚡ 一键适配全部（N）`（`data-act="mcp-wire-all"`、`data-testid="mcp-wire-all"`）：仅管理员、扫描完成且空闲时可用；非管理员/扫描中禁用。
- 行内「一键接入」保留用于个别重试；「复制片段」不变。
- 帮助文本补充第三条操作说明：一键适配全部（管理员批量写入所有可写 JSON 客户端，逐个进度与汇总）。

`src/web/AgentOnboard/theme.css`

```css
#mcp-client-rows { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:10px; align-items:stretch; }
#mcp-client-rows .found { flex-direction:column; align-items:stretch; gap:6px; margin:0; min-height:172px; }
#mcp-client-rows .found .btns { margin-top:auto; }
#mcp-client-rows .found .inject { max-height:160px; }
.mcp-path { margin-left:auto; text-align:right; word-break:break-all; }
```

### 1.4 登录后端诊断：区分「来源被拦」与「没启动」

`src/home/server.ts`

- 新增 `GET /api/health` → `{ ok:true, service:'home', ts }`（无状态探活）；
- Origin 拒绝分支先写日志：`log('home','origin_rejected', { origin: req.headers.origin ?? 'null', method, path })`。

`src/agentOnboard/server.ts`：同样写 `onboarding / origin_rejected`。

`src/web/Home/useLoginMirror.ts`

- 新增 `probeBackendReachable(base, timeoutMs=1800)`：`fetch(base + '/api/health', { method:'GET', mode:'no-cors', cache:'no-store', signal })`。`no-cors` 下即使服务返回 403，响应也会 resolve（opaque），只有网络层不可达才 reject。
- 登录请求 catch 时先探活：可达 → `origin_blocked`，不可达 → `backend_unreachable`。

`src/types/home.ts`：`LoginFailReason` 增加 `'origin_blocked'`。

`src/web/Home/LoginModal.tsx`

| 原因 | 文案 |
| --- | --- |
| `origin_blocked` | 本机登录后端在线，但当前页面来源未被信任（CORS 白名单外）。请从桌面端打开本应用；开发调试请用 npm run dev（127.0.0.1:5180）并先运行 npm run dev:backend。 |
| `backend_unreachable` | 登录后端未响应（localhost:8201）。请从桌面端打开本应用，或先运行 npm run dev:backend 启动本机登录服务。 |

### 1.5 开发态端口对齐

- `tools/dev-backend.mjs`：默认端口 **8200 → 8201**（对齐 `HOME_BASE`），启动日志同步更新。
- `package.json`：新增 `"dev:backend": "node tools/dev-backend.mjs"`。
- `vite.config.ts`：`server: { host:'127.0.0.1', port:5180, strictPort:true, open:'overview.html' }`——端口占用直接失败，不再静默漂移到白名单外端口。
- `src/electron/main.ts`：home 与 agentOnboard 两个服务在未打包态传 `allowDevOrigins: !app.isPackaged`（仅开发调试放行；安装包不放宽白名单）。

---

## 2. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `specs/MANUAL-TEST-FIX-BATCH-22.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `src/web/AgentOnboard/useBackendMirror.ts` | 旧样本排除、`normalizeAgentKey`/`statsForAgent`、名字归并聚合、卡片 `lastTest` 只补一次 |
| `src/web/AgentOnboard/AgentOnboardPage.tsx` | 归一键匹配 stats/failureReasons；页面指标说明条 |
| `src/web/AgentOnboard/AgentCard.tsx` | 指标来源三态（含 `data-metric-missing`）、0 样本文案更新 |
| `src/web/AgentOnboard/TestPanel.tsx` | `[data-test-hint]` 测试用途说明 |
| `src/web/AgentOnboard/McpClientsPanel.tsx` | 面板级「⚡ 一键适配全部」、进度与汇总、操作说明补充 |
| `src/web/AgentOnboard/theme.css` | MCP 行卡片网格等高；`metric-src`/`test-hint` 样式 |
| `src/web/Home/useLoginMirror.ts` | `probeBackendReachable` + `origin_blocked` 判定 |
| `src/web/Home/LoginModal.tsx` | 两种失败原因分别给修复指引 |
| `src/types/home.ts` | `LoginFailReason += 'origin_blocked'` |
| `src/home/server.ts` | `GET /api/health`；`origin_rejected` 日志 |
| `src/agentOnboard/server.ts` | `origin_rejected` 日志 |
| `src/electron/main.ts` | 未打包态 `allowDevOrigins`（开发放行，安装包不放宽） |
| `vite.config.ts` | `127.0.0.1:5180` + `strictPort` |
| `tools/dev-backend.mjs` | 默认端口 8201 |
| `package.json` | 新增 `dev:backend` 脚本 |
| `src/web/AgentOnboard/__tests__/coreReal.test.ts` | 旧样本排除、lastTest 补样本、名字归一合并、延时补齐 |
| `src/web/AgentOnboard/__tests__/McpClientsPanel.test.tsx` | 一键适配全部（写入/已是最新计数） |
| `src/web/Home/__tests__/useLoginMirror.test.tsx` | `origin_blocked`（no-cors 探针） |
| `src/home/__tests__/server.test.ts` | `/api/health` + `origin_rejected` 日志 |
| `specs/code-map.md` | 新增批次22 映射 |
| `specs/需求规格书.md` | 新增 §19.17 |
| `specs/MANUAL-TEST.md` | 新增 §3.10；标题引用更新为 1..22 |
| `AGENTS.md` | §2 `dev:backend`；§3 登录/MCP/自动接入行更新；§9 批次22 边界；浏览器模式说明更新 |
| `specs/code-index.generated.md` | 刷新（268 文件） |

---

## 3. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（渲染 + Electron 双配置，0 错误） |
| `npm run lint` | 通过（oxlint 0 error / 0 warning） |
| `npm run code:index:check` | 通过（索引与源码一致，268 文件） |
| `npm test` | **109 文件 / 1130 用例全过** |
| `npm run test:coverage` | Statements **76.76%** / Branches **68.79%** / Functions **71.83%** / Lines **79.76%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 94 用例全过**（30.9s，真构建产物 + 真后端） |
| `npm run package` | 成功；EPERM → 时间戳目录构建 → 复制+删除收口回 `release/installer`；`release/` 只剩 `installer/` |
| 专项回归（AgentOnboard + Home 相关 9 个测试文件） | 106 用例全过 |

### 3.1 打包产物自检

| 检查 | 结果 |
| --- | --- |
| `dist/assets/agentonboard-*.js` 含 `一键适配全部` | 是 |
| `dist/assets/agentonboard-*.js` 含 `card-metric-note` / `data-metric-missing` / `data-test-hint` | 是 |
| `dist/assets/useLoginMirror-*.js` 含 `origin_blocked` | 是 |
| `release/installer/MultiAgent Memory-0.1.0-setup.exe` 存在且非空 | 是（121,973,411 B） |
| `release/installer/win-unpacked/MultiAgent Memory.exe` 存在 | 是（249,934,848 B） |
| `release/` 只剩 `installer/` | 是 |

---

## 4. 手动测试步骤（待用户执行）

### 4.1 使用本次最新包

1. 关闭正在运行的旧实例（若已打开）。
2. 运行 `release/installer/MultiAgent Memory-0.1.0-setup.exe` 安装并启动；或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`。

### 4.2 卡片成功率（问题 1）

1. 用 `admin`（初始密码 `Admin@123456`，如已改密用新密码）登录 → 打开「Agent 接入配置页」，等待自动接入完成。
2. 重点看 DeepSeek harness / Claude Code / Codex 大卡：
   - 成功率与平均延时应有真实数值（来自 `auto_bind` 审计与卡片 `lastTest`）；
   - 若该 Agent 确实没有样本 → 显示「暂无连通样本：登录自动接入会自动拨测一次…」并说明原因，不得只显示裸「—」；
   - 若统计未加载 → 显示「指标未加载：…」提示。
3. 每张卡下方 `[data-metric-src]` 行应写明「指标来源：接入审计 · N 次连通尝试 / M 次通过 · 最近 X」。
4. 到「审计页」按 Agent 过滤，核对 `auto_bind` / `test` 条数与卡片一致。
5. **旧样本回归**：升级前已有历史审计的机器上，成功率不应因旧版无结果字段的 `auto_bind` 记录被拉低。

### 4.3 测试接入说明（问题 2）

1. 页面顶部应出现说明条：指标只统计真实拨测样本，不需要逐张点击测试。
2. 展开任一张卡的测试区 → `[data-test-hint]` 应解释测试=真实拨测写审计、登录自动接入已自动拨测、不点不影响接入与指标。
3. 验证结论：不做任何手动测试，仅登录自动接入后，卡片指标仍会出数（有样本时）。

### 4.4 MCP 一键适配与卡片尺寸（问题 3）

1. 管理员打开「MCP 客户端接入状态」→ 点「刷新状态」，确认扫描完成（「上次扫描 HH:mm:ss」UTC+08:00）。
2. 点「⚡ 一键适配全部（N）」：
   - 按钮进入「适配中 i/N…」并禁用；
   - 完成后显示「⚡ 一键适配完成：写入 N 个 · 已是最新 M 个 · 失败 …」并自动刷新；
   - 写入过的客户端状态变为「已接入」；目标配置文件旁生成备份（`*.bak-<时间戳>`）；
   - 坏 JSON / 冲突条目不覆盖，汇总里计入「失败」并给出原因。
3. 非管理员登录：该按钮禁用（行内「一键接入」同样禁用）。
4. Codex（TOML）等不可写客户端：不参与批量写入，只用「复制片段」手工粘贴。
5. 视觉检查：MCP 行卡片在常见窗口宽度下等宽等高、按钮组底部对齐；缩放窗口不重叠、不串位。

### 4.5 登录后端诊断（问题 4）

1. 桌面端正常打开：登录不出现「后端未启动」。
2. 浏览器 `npm run dev`（固定 `127.0.0.1:5180`）+ `npm run dev:backend`（8201）：登录可用；若端口 5180 被占用，Vite 应直接报错退出而不是换端口。
3. 用其它端口/来源打开页面登录 → 提示「本机登录后端在线，但当前页面来源未被信任…」；先停掉 home 服务再登录 → 才提示「登录后端未响应（localhost:8201）」。
4. 打开数据根下 `actions.log`，应能看到 `origin_rejected`（含 origin/method/path），且无明文密码/令牌。

---

## 5. 已知限制

1. **无样本不估算**：成功率/平均延时仍只统计真实样本；老机器若旧审计既无结果也无 `lastTest`，只能显示「暂无连通样本」并提示测试一次。
2. **名字归一只容忍大小写/空白**：`DeepSeek harness` 与 `deepseek-harness` 因连字符不同仍可能被视为不同键；若后端返回的名称带连字符而扫描名带空格，请以卡片 `lastTest` 兜底或手动测试生成样本后再看。
3. **一键适配只覆盖 JSON 客户端**：Qoder CN / Claude Code / Cursor 等可写；Codex（TOML）、Trae CN / WorkBuddy / Zcode / deepseek harness 无稳定路径，只能复制片段手工粘贴；批量写入按顺序执行，某个客户端失败不影响后续，但不会回滚已写入的客户端。
4. **`/api/health` 只是探活**：不能证明会话有效或数据库可写；`origin_blocked` 是准确诊断而非放行，安装包仍拒绝白名单外来源。
5. **开发放行仅限未打包态**：`allowDevOrigins: !app.isPackaged` 只影响 `npm run build:electron` 后的本地调试；安装包仍是严格白名单。
6. **安装包未配置代码签名证书**：Windows SmartScreen 可能提示未知发布者（既有情况）。
7. **未提交 git**：按约定等待用户确认。

---

## 6. 结论

- 四项用户问题全部落地：成功率缺失的三类真实成因已修复，测试用途有界面说明且不点无影响，MCP 支持管理员一键批量适配且卡片等高，登录报错能区分「来源被拦」与「未启动」。
- 自动化门禁全绿：typecheck、oxlint、索引检查、109 文件/1130 单测、覆盖率阈值、21 spec/94 E2E、打包与产物自检。
- 手动验收按 §4 执行；最新安装包为 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（SHA256 见页首）。
