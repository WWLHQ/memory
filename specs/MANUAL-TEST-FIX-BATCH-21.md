---
status: done
---

# 手动测试报告 · 修复批次 21（接入指标可解释 + 测试回执诚实化 + MCP 面板收敛）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **09:17**）
- 分支：main（未提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,972,307 B = **116.32 MiB**
  - SHA256：`7CC8530AD96F74DC9F47E5C743C7B2C6308906258B8BF6FAA088B0B338ED8BB5`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联文档：`specs/MANUAL-TEST.md` §3.9、`specs/code-map.md` 批次21、`specs/需求规格书.md` §19.16

> **输出目录说明**：本次打包前 `release/` 下无运行中的旧实例。本机存在宿主/索引器持有的目录句柄，`release/installer` 与新建目录的 **rename 持续返回 EPERM**（实测复制、删除均正常）。批次21 为打包器新增「rename 失败 → 复制 + 删除」收口逻辑，本次打包实测走该分支成功：日志依次出现「目录重命名被占用（EPERM），已改用复制+删除」与「已删除旧 release/installer，并把本次产物收口到固定目录」。最终 `release/` **只剩 `installer/` 一份产物**。

---

## 0. 起因与结论

用户提出三项问题：

1. 「接入卡片内连通成功率、平均延时，接入后要将数据输出出来」
2. 「接入测试显示『本地校验（未上后端）』是什么意思？」
3. 「MCP 接入状态卡片点『刷新状态』无效果；有的已接入、有的未配置本地服务、有的显示无配置文件应该怎么处理？复制片段和一键接入怎么用？没有扫描到的 Agent（如 Cursor、Gemini CLI）就不要显示了」

| 问题 | 根因 | 处理 | 结果 |
| --- | --- | --- | --- |
| 指标接入后不出数 | 页面只在挂载时读一次 `/audit`，接入写入与读取存在毫秒级竞态；无样本时只能显示「—」且不说原因 | 立即 + 800ms + 2400ms 三段重拉，窗口获得焦点/重新可见时重拉；`/agents` 的 `lastTest` 兜底；所有后端卡片都建 0 样本条目；卡片新增「指标来源」说明行 | 已落地 |
| 「本地校验（未上后端）」含义不明 | 旧实现在后端不可达时用一个占位文案，容易被误读成「测过了」 | 改为三态诚实文案：未测试 / 未生成审计回执（后端不可达或失败，附原因）/ 真实 `request_id`（唯一可点状态） | 已落地 |
| MCP 面板刷新无反馈、状态无从处理、未安装客户端占位 | 刷新没有「扫描中」与结果反馈；行内只给状态不给下一步；未安装客户端也用兜底行占位 | 扫描中态 + 上次扫描时间（UTC+08:00）+ 结果条数提示；每行「建议：…」；面板顶部说明「复制片段 vs 一键接入」；只列本机真实检出的客户端，空态给指引 | 已落地 |

**结论**：指标、回执、面板三处都不再「沉默」或「假装」——有真实样本就显示数字与来源，没有就说明原因与下一步。

---

## 1. 改动详解

### 1.1 卡片指标：接入后稳定出数，且可解释

`src/web/AgentOnboard/AgentOnboardPage.tsx`

- 新增 `refreshStats()`：清空旧定时器后**立即**拉一次，并在 **800ms / 2400ms** 各补一次，覆盖 `auto_bind` 审计落盘与页面读取的竞态。
- 触发点：`applyStoredState`（自动接入完成/复用状态）、「测试接入」「轮换密钥」、新增已安装卡片、窗口 `focus` 与 `visibilitychange`。
- 卸载时清理全部定时器，避免后台请求泄漏。

`src/web/AgentOnboard/useBackendMirror.ts`

- `load()` 增加请求序号守卫（`loadSeq`）：慢响应/乱序响应不会覆盖新数据。
- `computeAgentStats(entries, cards)`：
  - 统计 `test` + `auto_bind` 两类审计的尝试数/通过数/最近时间/平均耗时（`durationMs`）；
  - **`/agents` 兜底**：审计接口不可用或尚未写入时，用卡片 `lastTest` 补一条真实样本；
  - **所有后端卡片都建 0 样本条目**，UI 能区分「0 样本」与「加载中」，不会一直挂「—」而无说明。

`src/web/AgentOnboard/AgentCard.tsx`

- 成功率节点新增 `data-conn-src="audit|card"`，悬停提示写明「N 次连通尝试 / M 次通过（接入审计）」或「暂无真实样本，不估算」。
- 新增样本来源行 `[data-metric-src]`：
  - 有样本 → 「指标来源：接入审计 · N 次连通尝试 / M 次通过 · 最近 X」；
  - 无样本 → 「暂无连通样本：接入后自动拨测；也可点『▶ 测试接入』立即生成」。

`src/web/AgentOnboard/theme.css`：新增 `.metric-src`（说明行）、`.rid.rid-muted`（不可点回执）、`.test-reason`（失败原因）三条样式。

### 1.2 测试回执：去掉「本地校验（未上后端）」

`src/web/AgentOnboard/TestPanel.tsx` 重写回执区，`TestEvidence` 由 `{ rid, inject }` 扩展为 `{ rid, local, ok, reason, inject }`：

| 场景 | 显示 | 可点 |
| --- | --- | --- |
| 从未测试 | `尚未测试 · 点「▶ 测试接入」` | 否 |
| 后端不可达（本地未验证） | `后端不可达 · 本次未验证` + 原因行 | 否 |
| 后端返回失败但没给 `request_id` | `未生成审计回执 · 本次未验证` + 原因行 | 否 |
| 拿到真实 `request_id` | 原样的 `req_xxx` | 是（点击显示审计定位提示） |

`data-rid-live` 随状态变化；「本地校验（未上后端）」文案已彻底移除。

### 1.3 MCP 客户端面板：刷新有反馈、状态有指引、只显示真检出的客户端

`src/web/AgentOnboard/McpClientsPanel.tsx`

- **刷新状态**：点击后按钮变「扫描中…」并禁用；完成后顶部出现「上次扫描 HH:mm:ss」（UTC+08:00）与提示「已重新扫描：检出 N 个已安装客户端 · HH:mm:ss（UTC+08:00）」；失败显示失败原因且清空行列表（不把未知当「已接入」）。
- **只列已安装**：`rows = scan.clients.filter(r => r.installed)`；移除了旧的兜底行与 `MCP_CLIENT_SPECS` 依赖。空态提示「未检测到已安装的 MCP 客户端：安装并启动一次客户端后，点『刷新状态』重新扫描。未安装的客户端不再占位显示。」
- **状态处理建议**（每行 `[data-hint]`）：

| 状态 | 建议 |
| --- | --- |
| 已接入 `wired` | 无需操作；重启该客户端后即可使用记忆提示 |
| 缺令牌 `missing_auth` | 点「补齐令牌」写入 Authorization（先备份原文件） |
| 未配置本服务 `missing_entry` | 点「一键接入」写入本服务条目（JSON 客户端） |
| 冲突 `conflict` | 同名条目指向其它端点：手工改成当前端点或删除该条目后刷新 |
| 无法解析 `invalid` | 先手工修复 JSON/TOML，再点「刷新状态」 |
| 无配置文件 `no_config` | 点「一键接入」自动新建配置（JSON 客户端） |
| 需手工 `manual` | 无稳定配置路径：点「复制片段」后按客户端说明手工粘贴 |

  非 JSON / 不可写客户端统一降级为「不支持自动写入：点『复制片段』后按客户端说明手工添加」。
- **两种操作说明**（`[data-testid="mcp-actions-help"]`）：
  - **复制片段**：生成含令牌的配置片段，任何客户端都可粘贴（令牌只在此处一次性展示）；
  - **一键接入**：管理员专用，先备份再合并写入，仅支持 JSON 客户端；冲突/无法解析时拒绝覆盖。
- **浏览器模式**：不列任何客户端、不显示「已接入」，仅说明「浏览器模式无法读取本机客户端配置…请在桌面端打开本页并点『刷新状态』」。

### 1.4 打包收口：rename 失败改走「复制 + 删除」

`tools/package-builder.cjs` 新增 `moveDir(from, to)`：先 `rename`（3 次重试），仍失败则 `fs.cpSync` 复制 + `fs.rmSync` 删除源目录，再继续后续清理。用于「构建成功后收口回 `release/installer`」与「构建失败恢复旧目录」两条路径；构建失败的保护语义不变（旧产物优先保住）。

> 本机实测证据：批次21 第一次打包（09:11）因 `release/installer` rename 恒失败，产物留在 `installer-20261031-011134`；定位到「新建目录的 rename 同样被拒，复制/删除正常」后补上该兜底，第二次打包（09:16）日志出现「已改用复制+删除」并成功收口，`release/` 只剩 `installer/`。

---

## 2. 变更清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `specs/MANUAL-TEST-FIX-BATCH-21.md` | 本报告 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `src/web/AgentOnboard/AgentOnboardPage.tsx` | `refreshStats` 三段重拉；focus/visibility 重拉；测试/轮换/新增卡片后重拉；卸载清理 |
| `src/web/AgentOnboard/useBackendMirror.ts` | `loadSeq` 乱序守卫；`computeAgentStats` 的 `/agents` 兜底与 0 样本条目 |
| `src/web/AgentOnboard/AgentCard.tsx` | `data-conn-src` + 悬停说明；`[data-metric-src]` 指标来源行 |
| `src/web/AgentOnboard/TestPanel.tsx` | 回执三态；只对真实 `request_id` 可点；失败原因行 |
| `src/web/AgentOnboard/McpClientsPanel.tsx` | 刷新反馈、上次扫描时间、只列已安装、状态建议、操作说明、空态/浏览器态 |
| `src/web/AgentOnboard/theme.css` | `.metric-src` / `.rid.rid-muted` / `.test-reason` |
| `src/web/AgentOnboard/__tests__/components.test.tsx` | 回执三态与不可点断言 |
| `src/web/AgentOnboard/__tests__/AgentOnboardPage.test.tsx` | 真实 `request_id` 才出 toast |
| `src/web/AgentOnboard/__tests__/McpClientsPanel.test.tsx` | 只列已安装、空态、刷新扫描中与反馈、UTC+08:00 扫描时间 |
| `src/web/AgentOnboard/__tests__/coreReal.test.ts` | `/agents` 兜底、0 样本、不重复计数 |
| `tools/package-builder.cjs` | `moveDir`：rename 失败退化为复制+删除 |
| `specs/code-map.md` | 新增批次21 映射 |
| `specs/需求规格书.md` | 新增 §19.16 |
| `specs/MANUAL-TEST.md` | 新增 §3.9；Agent 接入行补充批次21 说明；测试数量更新 |
| `AGENTS.md` | §9 已知边界补充批次21 |
| `specs/code-index.generated.md` | 刷新（268 文件，`prepackage` 自动执行） |

---

## 3. 自动化门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（渲染 + Electron 双配置，0 错误） |
| `npm run lint` | 通过（oxlint 0 error / 0 warning） |
| `npm run code:index:check` | 通过（索引与源码一致，268 文件） |
| `npm test` | **109 文件 / 1124 用例全过** |
| `npm run test:coverage` | Statements **76.67%** / Branches **68.65%** / Functions **71.83%** / Lines **79.68%**（阈值 71/61/67/74） |
| `npm run test:e2e` | **21 spec / 94 用例全过**（32.5s，真构建产物 + 真后端） |
| `npm run package` | 成功；rename EPERM → 复制+删除收口到 `release/installer`；旧时间戳目录已清理 |

### 3.1 打包产物自检

| 检查 | 结果 |
| --- | --- |
| `dist/assets/agentonboard-DlYxLWjM.js` 含 `mcp-actions-help`、`data-metric-src`、`未生成审计回执` | 是（各 1 处） |
| `release/installer/MultiAgent Memory-0.1.0-setup.exe` 存在且非空 | 是（121,972,307 B） |
| `release/installer/win-unpacked/MultiAgent Memory.exe` 存在 | 是（249,934,848 B） |
| `release/` 只剩 `installer/` | 是 |
| 打包临时目录 `.icon-ico` 已清理 | 是 |

---

## 4. 手动测试步骤（待用户执行）

### 4.1 使用本次最新包

1. 关闭正在运行的旧实例（若已打开）。
2. 运行 `release/installer/MultiAgent Memory-0.1.0-setup.exe` 安装并启动；或直接运行 `release/installer/win-unpacked/MultiAgent Memory.exe`。

### 4.2 卡片指标（问题 1）

1. 管理员登录 → 打开「Agent 接入配置页」，等待自动接入完成。
2. 每张大卡四项指标下方应出现一行指标来源：
   - 有审计样本 → 「指标来源：接入审计 · N 次连通尝试 / M 次通过 · 最近 X」；
   - 无样本 → 「暂无连通样本：接入后自动拨测；也可点『▶ 测试接入』立即生成」，成功率/平均延时显示「—」（不估算）。
3. 点「▶ 测试接入」→ 成功率与平均延时应随真实审计更新（最迟约 2.4 秒内补齐）；切走页面再切回同样会刷新。
4. 到「审计页」按该 Agent 过滤，核对 `test` / `auto_bind` 条数与卡片显示一致。

### 4.3 测试回执（问题 2）

1. 新建/未测试卡片 → 回执显示「尚未测试 · 点『▶ 测试接入』」，不可点击。
2. 结束 8200 端口进程（停掉接入后端）后再测试 → 显示「后端不可达 · 本次未验证」+ 原因，不可点击；**不得**出现「本地校验（未上后端）」。
3. 后端正常时测试 → 显示真实 `request_id`，点击出现审计定位提示。

### 4.4 MCP 面板（问题 3）

1. 桌面端打开「MCP 客户端接入状态」→ 点「刷新状态」→ 按钮短暂显示「扫描中…」并禁用；完成后出现「上次扫描 HH:mm:ss」（UTC+08:00）与「已重新扫描：检出 N 个已安装客户端」。
2. 确认列表只包含本机真实检出的客户端；未安装的 Cursor / Gemini CLI 不出现。移走所有配置与安装痕迹后刷新 → 显示空态提示。
3. 逐行核对「建议：…」是否与状态匹配（已接入/缺令牌/未配置/冲突/无法解析/无配置/需手工）。
4. 管理员点「复制片段」→ 片段含 `Authorization: Bearer …`，可粘贴到其它客户端；「一键接入」→ 先备份再写入，冲突/坏 JSON 拒绝覆盖。普通成员两个按钮均禁用并提示「需管理员」。
5. 浏览器模式（`npm run dev`）→ 面板不列客户端、不显示「已接入」，仅显示只读说明。

---

## 5. 已知限制

1. **无样本不估算**：成功率/平均延时只在有真实 `test` / `auto_bind` 审计样本（含 `durationMs`）时出数；旧审计无耗时不参与平均，平均延时可能显示「—」而成功率有值。
2. **`/agents` 兜底只补审计缺失**：审计接口可用时以审计为准，卡片 `lastTest` 仅在审计无该 Agent 记录时补一条，不做累加。
3. **MCP 面板只认真实检出**：判定依据是「配置文件存在」或「安装痕迹命中」。若客户端装在自定义路径且没有任何已知痕迹，本机扫描不会列出该客户端（这是诚实行为，不是白屏）。
4. **一键接入的范围**：仅管理员 + 结构稳定的 JSON 客户端（Qoder CN / Claude Code / Cursor）；Codex 为 TOML、Trae CN / WorkBuddy / Zcode / deepseek harness 无稳定路径，只能「复制片段」手工粘贴。
5. **本机打包目录 rename 受限**：宿主/索引器持有目录句柄导致 rename 持续 EPERM，打包器走复制+删除收口；若复制期间磁盘不足会回落到时间戳目录并告警，需人工释放空间后重打包。
6. **安装包未配置代码签名证书**：Windows SmartScreen 可能提示未知发布者（既有情况）。
7. **未提交 git**：按约定等待用户确认。

---

## 6. 结论

- 三项用户问题全部落地：指标接入后可出数且说明来源，回执不再出现误导文案，MCP 面板刷新有反馈、状态有处理建议、只显示真实检出的客户端。
- 打包器补上 rename 失败兜底，本机反复出现的「产物留在时间戳目录」问题已收口到固定路径。
- 自动化门禁全绿：typecheck、oxlint、索引检查、109 文件/1124 单测、覆盖率阈值、21 spec/94 E2E、打包与产物自检。
- 手动验收按 §4 执行；最新安装包为 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（SHA256 见页首）。
