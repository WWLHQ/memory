---
status: done
---

# 批次 30 手动测试报告 —— MCP 面板审计证据升级（Zcode 已接入却显示「未接入」）

- 日期：2026-10-31
- 起因：用户反馈「Zcode 已经接入 MCP 但是还是显示未接入」。实锤核对：数据根 `memories.db.json` 审计账本里有 `client=zcode/0.16.9` 的 recall 行（2026-10-31 21:38:29 UTC+08:00，query「DeepSeek harness MCP 插件接入 cordis dsh-mcp-client 配置」，命中 2 条）——**Zcode 真实接入且调用成功**。
- 真因：MCP 面板原只凭**读配置文件**判定接入状态；Zcode 配置存应用内部存储（IndexedDB，无文件面，批次28-D 已确认）→ 文件扫描永远 `manual`「需手工」，真实调用无法反映。

## 1. 修复方向：审计证据升级（服务端账本上的事实，不是推断）

`mcp:clients` 扫描时主进程把 **recall 审计**作为接入证据传入扫描：能带有效令牌成功召回过 = 真接通。

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/agentOnboard/mcpClients.ts` | `McpClientSpec` 新增可选 `auditClientIds`（审计调用方名与 id 不同时显式列出；deepseek-harness → `dsh-mcp-client`） | Zcode 审计名 `zcode/0.16.9` 首段恰为 id；DSH 审计自报 `dsh-mcp-client` 与 id 不同 |
| `src/electron/mcpClients.ts` | 新增 `McpRecallEvidence` + 纯函数 `applyRecallEvidence`：按调用方首段匹配 `spec.id`/`auditClientIds`，对 `manual/no_config/missing_entry/missing_auth` 四态升级 wired，note 注明「审计检测到真实调用 N 次（最近 <时间>，UTC+08:00）——配置存应用内部无法读取文件，以审计为准」；`scanMcpClients` 加 `recallEvidence` 选项，扫描末尾应用 | 升级规则集中在纯函数，可单测；note 诚实说明证据来源 |
| `src/electron/main.ts` §6c | `mcp:clients` 处理器改 async：真查 `storage.queryAudit({action:'recall'})` 映射为证据（失败 try/catch 退回纯文件口径，不影响扫描） | 证据真源是内核账本；读不到时保守降级 |
| `src/electron/__tests__/mcpClients.test.ts` | 批次30 五例：Zcode manual→wired（note 断言）/ 调用方不匹配不升级（UA 兜底串、未知名）/ conflict 保持原状 / deepseek-harness 经 `dsh-mcp-client` 命中 / 空证据无影响 | 升级/不升级/边界全覆盖 |
| `AGENTS.md` §9、`specs/code-map.md`、`specs/code-index.generated.md` | 批次30 条目与索引刷新 | 门禁要求 |

**保守边界（诚实化）**：
- `conflict` / `invalid` 不升级——配置文件真实存在但内容有错，审计不能替代修复；
- UA 兜底串（`Cursor (UA)`）不匹配任何 id——无 initialize 会话时调用方身份不可证，不借证据冒认；
- 已 wired（文件/宿主继承）不受影响；审计读不到时纯文件口径，绝不伪造。

## 2. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,990,970 B（116.33 MiB） |
| SHA256 | `F48D46231C273A48753B9CE33FC21E8F4E9F0B8C52D55C61C9F3A817D5838253` |

## 3. 自动化验证（真实跑过）

- 门禁：`npm run verify:fast` **exit 0**（typecheck 双配置 0 错、oxlint 0/0、索引新鲜度通过）。
- 单测：**122 文件 / 1351 用例全过**（含批次30 新增 5 例）。
- 覆盖率：语句 79.62% / 分支 72.00% / 函数 75.44% / 行 82.65%。

## 4. 本机实测（2026-10-31）

- 审计证据：`zcode/0.16.9` 1 次、`dsh-mcp-client/0.0.1` 3 次、`Qoder` 系多次、`unknown` 9 次、无 client 8 次。
- 预期面板效果（装新包后打开「Agent 接入 → MCP 客户端接入状态」）：
  - **Zcode：已接入**，注明「审计检测到真实调用 1 次（最近 2026/10/31 21:38:29，UTC+08:00）——配置存应用内部无法读取文件，以审计为准」，无「一键接入」按钮（已接通无需写入）；
  - deepseek harness：已接入（宿主继承 + 审计证据双通道）；
  - 其余客户端状态不变。

## 5. 手动测试步骤（验收用）

1. 安装新包并启动桌面端，管理员登录。
2. 打开「Agent 接入」页 → MCP 客户端接入状态 → 点「刷新状态」。
3. Zcode 行应显示绿色「已接入」徽标 + 审计证据 note；不再显示「需手工」。
4. 对照「审计日志页」recall 行：Zcode 调用次数与 note 里的 N 一致。
5. 回归：Qoder CN / Claude Code / Codex / WorkBuddy / Trae CN 状态与升级前一致；「⚡ 一键适配全部」只处理仍非 wired 的可写客户端。

## 6. 已知边界

- 证据只统计 `recall` 审计：客户端若只调用过 `write_memory`/`list_projects`（尚未 recall），暂不升级（当前 recall 是所有触发规则的必经动作，实际影响面极小）。
- 升级不区分令牌新旧：审计行是「曾以有效凭据调用成功」的证据；若之后轮换令牌，客户端旧配置会开始 401，届时以文件口径的 `missing_auth`/「审计不再新增」暴露，一键适配可修复。
