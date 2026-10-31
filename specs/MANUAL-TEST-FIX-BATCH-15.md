---
status: done
---

# 手动测试报告 · 修复批次 15（MCP 客户端接入推广）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **00:04:45**）
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-160355/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,966,127 B = **116.32 MiB**
  - SHA256：`4dfd5149ac6d187c6ae78223e4031988cefe95e3db1294f1a0d6a11bae8b5ff2`
- 未打包目录：`release/installer-20261030-160355/win-unpacked/MultiAgent Memory.exe`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-13.md`（四段折叠）、`specs/MANUAL-TEST-FIX-BATCH-14.md`（触发措辞「优先」）
- 通用手测入口：`specs/MANUAL-TEST.md` §3.4

> **输出目录说明**：旧实例仍从 `release/installer/win-unpacked` 运行，`release/installer` 被占用，打包脚本自动改输出到 `release/installer-20261030-160355/`（目录名中的时间是 UTC，对应本机 **2026-10-31 00:03:55**）。本次**未强制关闭**正在使用的旧实例。前一次打包（`installer-20261030-155918`，23:59:55）已被本轮取代——本轮补上了「宿主扫描失败」的如实提示与第 6 条面板测试，两份安装包请以本文件文首为准。

---

## 0. 起因与结论

用户在 2026-10-30 23:44 的 Qoder 截图中确认：🧠 提示行 + 四段可折叠明细已真实生效，并问「是否可以将这个经验推广到其他已连接 agent 上？」

核查结论：

| 客户端 | 本机真实状态（批次15 扫描） | 说明 |
| --- | --- | --- |
| Qoder CN | `wired`（已接入） | `~/.qoder-cn/settings.json` → `mcpServers["MultiAgent Memory"]` 含 `type/url/headers.Authorization` |
| Claude Code | `missing_auth`（缺令牌，会 401） | `~/.claude.json` → `mcpServers.memagent` **只有 type/url，没有 headers** |
| Codex | `missing_entry`（未配置本服务） | `~/.codex/config.toml` 有其它 `[mcp_servers.*]`，无 `multiagent_memory` |
| Trae CN / WorkBuddy / Zcode / deepseek harness | `manual`（需手工添加） | 无稳定可写配置路径，只给端点/请求头说明 |
| Cursor / Gemini CLI / Qwen Code | `no_config`（未安装） | 有配置路径规范，安装后可一键接入 |

**核心事实**：提示行与四段折叠明细由**服务端统一返回**，所有 MCP 客户端一致；差异只在「客户端是否注册端点」与「该客户端是否加载触发规则」。因此本批次做的是**接入状态可视化 + 安全写入 + 调用方归因**，不是给每个 Agent 重写一套提示。

---

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 15-A 调用方归因 | `RecallReq.client`；MCP `initialize.clientInfo`（优先）/`User-Agent` 识别，`Mcp-Session-Id` 关联；`recall` 审计 `detail.client`（如 `Qoder/9.9.9`、`Cursor (UA)`）；未识别不写，避免伪归属 | `src/core/memagent/types.ts`、`agent.ts`、`mcpRecall.ts`、`mcpHttp.ts` |
| 15-B 客户端配方 | 单一真源：端点 `127.0.0.1:8204/mcp`；10 家客户端的配置路径/格式/条目风格/触发规则/可写性；未知格式 `configPath=null` | `src/agentOnboard/mcpClients.ts` |
| 15-B 状态探测 | 读真实文件内容判定 `wired / missing_auth / missing_entry / conflict / invalid / no_config / manual`；TOML 支持 `[mcp_servers.<key>.http_headers]` 子表；超 8 MiB 拒绝 | 同上（`probeJsonConfig`/`probeTomlConfig`） |
| 15-C 安全写入 | `mergeMcpJsonConfig` 保留其它服务器/条目字段/请求头；`conflict`/`invalid` 拒绝；未变化 `changed=false`。`wireMcpClient` 写前备份 `.bak-<ISO>` + 临时文件 + rename | `src/electron/mcpClients.ts` |
| 15-C IPC | `mcp:clients` 只读；`mcp:clientSnippet` / `mcp:clientWire` 走 `requireAdmin`；动作日志 `mcp:client-wire` 不含令牌 | `src/electron/ipcChannels.ts`、`main.ts §6c`、`preload.ts`、`src/desktop/hostBridge.ts` |
| 15-D UI | Agent 接入页新增「MCP 客户端接入状态」：状态徽标、复制片段、一键接入/补齐、刷新、管理员门禁、浏览器降级说明；宿主扫描失败时显示「扫描失败」并给出错误原文，绝不把失败显示成「已接入」；复用原型类名，未新增 CSS | `src/web/AgentOnboard/McpClientsPanel.tsx`、`AgentOnboardPage.tsx` |
| 15-E 客户端规则 | 根目录 `CLAUDE.md`（`@AGENTS.md` + MCP 优先调用/回显规则）；`AGENTS.md §1.1/§3/§9` 同步 | `CLAUDE.md`、`AGENTS.md` |
| 测试 | 纯函数 24 例、node 层 9 例、面板 6 例；MCP HTTP 增加 client 归因用例 | `src/agentOnboard/__tests__/mcpClients.test.ts`、`src/electron/__tests__/mcpClients.test.ts`、`src/web/AgentOnboard/__tests__/McpClientsPanel.test.tsx`、`src/core/memagent/__tests__/mcpHttp.test.ts` |
| 文档 | 需求规格书 §19.12 增「客户端推广（批次15）」；`specs/code-map.md` 批次15 区块；`specs/MANUAL-TEST.md` 索引 1..15 + §3.4 | `specs/*.md` |

### 关键设计（为什么这样做）

- **状态只按真实文件内容判定**：不猜「应该已接入」，也不因目录存在就显示已连通；`~/.claude.json` 的「有条目无令牌」被如实显示为 `missing_auth`（调用会 401）。
- **一键写入只覆盖结构稳定的 JSON 客户端**（Qoder CN / Claude Code / Cursor）：先备份、再原子替换；同名条目指向其它端点（`conflict`）或文件无法解析（`invalid`）一律拒绝，绝不为了「修复」而覆盖用户其它配置。
- **Codex 是 TOML、其余无稳定路径**：只提供含令牌的片段/手工说明，不自动改配置（TOML 注释/顺序/多行数组的保真写入风险高于收益）。
- **令牌边界**：状态扫描返回值不含令牌；片段/写入仅管理员；令牌只在片段中一次性出现，绝不进 `actions.log` / `main.log` / 审计。
- **调用方归因不伪造**：客户端没给 `clientInfo`、UA 也不认识时，审计不写 `client`（宁缺毋滥）。

---

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程 + Electron 类型检查 | `npm run typecheck` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint） | **0 error / 0 warning**（414 文件 / 123 规则） |
| 单元/集成测试 | `npm run test:coverage` | **106 文件 / 1074 用例全过** |
| 覆盖率 | 同上 | 语句 75.95%（7444/9801）、分支 67.44%（4938/7321）、函数 71.30%（1764/2474）、行 78.91%（6482/8214）；阈值 71/61/67/74，通过 |
| 真浏览器 E2E | `npm run test:e2e` | **93 用例全过（39.9s）** |
| 正式打包 | `npm run package` | 退出码 0（vite + esbuild + electron-builder NSIS） |
| 打包内容核对 | `grep mcp:client*` / `mcp-scan-error` | `app.asar.unpacked/dist-electron/main.cjs` 含 `mcp:clients` / `mcp:clientSnippet` / `mcp:clientWire`；`app.asar` 含扫描失败提示 |

本批次新增单测覆盖：正常（已接入/新建/补齐/幂等）、拒绝（冲突/坏文件/TOML/无路径）、边界（大小写头、TOML 子表、8 MiB 上限、未变化不重写、令牌不外泄）。

> 稳定性备注：本轮改动后曾有一次全量运行出现 1 例失败（尾部日志指向 HTTP 测试的 `server.stop`），立即重跑未复现，随后全量 1074/1074 全过；该失败与本批次改动无直接关联，若后续 CI 复现需单独排查。

---

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-160355/MultiAgent Memory-0.1.0-setup.exe` | 121,966,127 B = **116.32 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-160355/win-unpacked/MultiAgent Memory.exe` | 随包生成 |
| 增量块映射 | `release/installer-20261030-160355/MultiAgent Memory-0.1.0-setup.exe.blockmap` | 随包生成 |

未配置代码签名（沿用既有配置，Windows 可能提示「未知发布者」，选择「仍要运行」）。

---

## 4. 本机真实扫描（只读，未打印令牌）

用新代码对本机 `$HOME` 做只读扫描（`scanMcpClients`，不写任何配置）：

```
qoder-cn          wired          auth=true  installed=true  ~/.qoder-cn/settings.json
claude-code       missing_auth   auth=false installed=true  ~/.claude.json
codex             missing_entry  auth=false installed=true  ~/.codex/config.toml
cursor            no_config      auth=false installed=false ~/.cursor/mcp.json
gemini-cli        no_config      auth=false installed=false ~/.gemini/settings.json
qwen-code         no_config      auth=false installed=false ~/.qwen/settings.json
trae-cn           manual         auth=false installed=true  -
workbuddy         manual         auth=false installed=true  -
zcode             manual         auth=false installed=true  -
deepseek-harness  manual         auth=false installed=true  -
token-leak        false
```

与人工核对一致：Qoder 已接入；Claude Code 条目存在但缺 `headers.Authorization`（这是它调用会 401 的直接原因）；Codex 尚无本服务条目。

---

## 5. 手动测试步骤

> 前置：安装/启动批次15 新包（旧实例仍在运行批次13/14 包，需先退出旧实例再启动新包，避免单实例锁让新包直接退出）。

### 5.1 管理员视角

1. 用 `admin` 登录 → 打开「Agent 接入配置页」→ 滚动到「MCP 客户端接入 · 把记忆提示推广到所有已接入 Agent」。
2. 核对状态（应与 §4 一致）：
   - Qoder CN = **已接入**；
   - Claude Code = **缺令牌（调用会 401）**；
   - Codex = **未配置本服务**；
   - Trae CN / WorkBuddy / Zcode / deepseek harness = **需手工添加**；
   - Cursor / Gemini CLI / Qwen Code = **无配置文件（可新建）**。
3. **建议先退出 Claude Code**（避免它用内存中的旧配置回写），再点 Claude Code 行「补齐令牌」：
   - 提示「已写入 Claude Code（原文件已备份：…\.claude.json.bak-<时间戳>）」；
   - 点「刷新状态」→ 变为 **已接入**；
   - 再点一次「补齐令牌」→ 提示「已是最新，未改动」，且不会产生第二个备份。
4. 点 Qoder CN 行「复制片段」→ 剪贴板得到含 `Authorization: Bearer …` 的 JSON；确认 `actions.log` 中没有该令牌。
5. 把 Codex 行的片段（TOML）手工合并到 `~/.codex/config.toml` 的 `[mcp_servers.multiagent_memory]`（示例已含 `url` 与 `http_headers`），重启 Codex。
6. 重启 Claude Code，在工作区提一个仓库实现/踩坑类问题：
   - 回答应出现「🧠 Memory 提示行 + 四段折叠」；
   - 数据根 `memories.db.json` 的 `recall` 审计应新增一条，`detail.client` 含 `Claude`（如 `Claude Code/x.y.z` 或 `Claude (UA)`）；若客户端未提供标识则不写，不伪造。
7. 冲突保护：手工把某 JSON 客户端（如 Cursor）的同名条目改成 `http://127.0.0.1:9999/mcp` → 面板显示 **冲突**，「一键接入」禁用，点击也不会覆盖原条目。
8. 失败可见（可选）：若宿主桥/主进程不可用，刷新后面板顶部应显示 **扫描失败** 并附错误原文，客户端行不得出现「已接入」。

### 5.2 普通成员视角

1. 用普通注册账号登录 → 同一面板；
2. 「复制片段」「一键接入/补齐」均禁用，顶部提示「需管理员」；
3. 即使绕过 UI 直接用伪造 sessionId 调 IPC，主进程 `requireAdmin` 也应拒绝（`actions.log` 出现 `denied: not_admin/no_session`）。

### 5.3 浏览器模式（可选）

`npm run dev` 直接打开接入页：面板显示「浏览器模式（只读说明）」，列出 10 家客户端与手工说明，刷新按钮禁用；不得出现任何「已接入」。

---

## 6. 已知限制（不应作为缺陷）

- **新包尚未在本机实际启动**：旧实例（批次13/14 包）仍在运行且用户可能正在使用，本报告未强制关闭；面板的实机点击留给上述手测步骤。代码已通过类型检查、单测、E2E 与打包内容核对。
- **自动写入仅 JSON**：Codex（TOML）、Trae CN / WorkBuddy / Zcode / deepseek harness（无稳定配置路径）只给片段/手工说明；Gemini CLI / Qwen Code 各版本字段可能是 `httpUrl` 或 `url`，因此标记为只读片段。
- **写入后需重启客户端**：客户端进程不会热加载 MCP 配置；Claude Code 若正在运行，建议先退出再写入，避免其内存状态回写覆盖。
- **调用方归因尽力而为**：`clientInfo`/UA 缺失时为 `unknown`；不识别不写，故审计里可能没有 `client`（此时不能据此判定「没调用」，应以有无 `recall` 记录为准）。
- **触发仍是建议性**：服务端提示与折叠明细对所有客户端一致，但「先调 `recall_memory` 再回答、原样回显」仍依赖客户端加载 `AGENTS.md`/`CLAUDE.md` 与模型配合；Trae CN / WorkBuddy / Zcode 若无规则文件加载能力，需在会话中显式点名工具。
- **令牌可见范围**：管理员可在片段中看到真实令牌（仅当次响应、不落日志）；普通成员不可复制片段/写入。
- **8 MiB 上限**：超过 8 MiB 的客户端配置被判 `invalid` 并拒绝读写（防止误读/误写超大文件）。
- **目录时间戳为 UTC**：`release/installer-20261030-160355` 目录名由脚本用 UTC 生成，对应本机 2026-10-31 00:03:55。

---

## 7. 结论

- 服务端提示/折叠明细本身已对全部客户端通用；本批次把「其它已连接 Agent 为什么没提示」变成**可看、可修、可核验**：真实扫描 → 缺令牌一键补齐 → 重启后回显 → 审计按 `client` 归因。
- 自动化门禁全绿；安装包已生成并核对包含新 IPC。
- 待用户按 §5 完成新包实机点击（尤其 Claude Code「补齐令牌 → 重启 → 提示行 → 审计 client」四步）。
