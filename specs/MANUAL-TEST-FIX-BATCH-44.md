---
status: awaiting-manual-test
---

# 手动测试报告 · 修复批次 44（MCP 令牌零维护：stdio launcher + 实测连通列 + 循环检测）

- 日期：2026-11-18（北京时间 UTC+08:00；打包完成 **21:57**）
- 分支：main（**未提交**，等实测 + 明确确认后才 commit/push）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：128,139,638 B = **122.20 MiB**
  - SHA256：`03978C0FF664FA3535572EC8A4CE0346BD194064C9FA5373C7894682608B2408`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联文档：`AGENTS.md` §6 柔性路径铁律 ③、`.workbuddy/memory/2026-11-18.md`

> 打包日志里有 8 个 `release/installer-<旧时间戳>` 目录报 `EBUSY` 未删（被占用），
> 本次产物已正常收口到固定目录 `release/installer/`，不影响安装。

---

## 0. 起因与结论

用户明确指出两件事要一起做完：

1. **接入页的「已接入」不可信**——当天实测 6 个客户端配置里的令牌早已失效（401），页面却 8/8 全绿。
2. **令牌散落在每个客户端配置里**——一轮换就全挂，必须改成「客户端配置里没有令牌」的形态。

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| 页面全绿但实际 401 | `state` 是**读配置文件推出来的**（条目在不在、头长得像不像），从来不真调一次 | 新增 `mcpProbe.ts`：每行拿**该客户端配置里的令牌**真调 `tools/list`，以 HTTP 状态码判定，新增「实测 ✓ N 工具 / 实测 ✗ 401」列 |
| 令牌轮换要改 7 处 | Bearer 被抄进每个客户端配置 | 新增 `mcpBridgeScript.ts` + stdio 条目：配置里只写 `node <桥接脚本> <指针> <端点> <客户端id>`，桥接脚本**每次调用现读** `keys/mcp-token.txt` |
| 挂了没人提醒 | 页面只在下一次手动刷新才变 | 每 12 秒静默复检（循环检测），失败数「由 0 变正」主动提示 + 落 `mcp/client-live-probe-bad` 告警日志 |

**结论**：三者是同一件事的三个面——**能编造的证据都不算证据**。真调一次拿状态码，配置里不留凭据，出问题主动喊。

---

## 1. 改动详解

### 1.1 stdio 零维护形态（本次主体）

| 文件 | 改动 |
| --- | --- |
| `src/agentOnboard/mcpClients.ts` | 新增 `MCP_BRIDGE_FILE_NAME` / `MCP_STDIO_COMMAND` / `McpTransport` / `McpStdioTarget` / `buildStdioMcpEntry` / `isStdioEntry`；`probeJsonConfig`/`probeTomlConfig` 认出 stdio 形态并回 `transport`；`mergeMcpJsonConfig` 传 stdio 时**清掉 `url`/`httpUrl`/`type`/`headers`**；新增 `mergeTomlStdioSection` 重建本服务段（连带丢掉 `.http_headers` 子表）；`renderMcpSnippet` 支持 stdio（**片段不含令牌**） |
| `src/electron/mcpBridgeScript.ts`（新） | 自包含 CJS 桥：`node <bridge> <指针> <端点> <客户端id>`；令牌**每次现读**：读指针 → `<root>/keys/mcp-token.txt` → 回落 `<root>/mcp-token.txt` 与指针目录；stdout 只出 JSON、诊断走 stderr；401/超时回 JSON-RPC error 且点名「桌面端是否在运行」 |
| `src/electron/mcpClients.ts` | `wireMcpClient` 增 `mode:'stdio'` + `bridgePath`/`pointerPath`；已是 stdio → `changed:false`；当前 http → 合并改写；缺路径 → 明确拒绝不写盘；`scanMcpClients` 回 `transport` 并给「零维护形态」说明；`snippetForClient` 支持 stdio |
| `src/electron/main.ts` | IPC `mcp:clientWire` / `mcp:clientSnippet` 接受第 3 个参数 `'stdio'`；`stdioTarget()` 把桥接脚本写到**引导指针同目录**（`%APPDATA%\MultiAgent Memory\mcp-bridge.cjs`，数据根搬家也不动） |
| `src/web/AgentOnboard/McpClientsPanel.tsx` | 传输形态徽标（`stdio 零维护` / `HTTP`）、行内「改用 stdio」、顶部「⇄ 全改 stdio（N）」、复制片段按形态出片段、文案说清两者差别 |

### 1.2 实测连通 + 循环检测

| 文件 | 改动 |
| --- | --- |
| `src/electron/mcpProbe.ts`（新） | `parseToolsCount`（兼容纯 JSON 与 SSE `data:`）、`probeMcpEndpoint`（1500ms 超时，返回 `{ok,status,tools,error,at}`）、`attachLiveProbe`（同令牌只探一次） |
| `src/electron/main.ts` | `IPC.mcpClients` 挂探活；stdio 行（配置里没令牌）改用现役令牌实测；失败落 `mcp/client-live-probe-bad` |
| `src/web/AgentOnboard/McpClientsPanel.tsx` | 行内实测徽标、服务端自身徽标 `mcp-server-live`、异常告警块 `mcp-live-alert`、12 秒静默复检 + 「由好变坏」主动提示 |

---

## 2. 门禁结果（全绿）

| 闸门 | 结果 |
| --- | --- |
| A · typecheck | `tsc --noEmit` + `tsc --noEmit -p tsconfig.electron.json` 0 错 |
| A · lint | oxlint 794 文件 / 123 规则：**0 warnings · 0 errors** |
| A · no-demo | 420 文件 / 26 条判据：**零命中** |
| A · code:index | 已重建并校验：426 源文件 / 149 文档 |
| B · npm test | **308 文件 / 3808 例全绿**（EXIT=0） |
| C · 变异验证 | ① 去掉 argv 里的客户端 id → 3 例红；② stdio 合并时不清 `headers` → 2 例红（令牌泄漏）；③ 桥接脚本不再读 `keys/` 子目录 → 1 例红。三处均已还原，复跑 **127 例全绿** |

新增测试：`mcpBridgeScript.test.ts`（**真跑桥接脚本**：假 MCP 端点 + 子进程 + 就地轮换令牌文件 → 断言第二次请求用的是新令牌）、`mcpProbe.test.ts`（7 例）、stdio 纯函数 7 例、electron stdio 真写盘 6 例、面板 4 例。

---

## 3. 手动测试步骤（请你按这个顺序验）

1. **装新包**（覆盖安装即可，数据不丢）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
2. 打开桌面端 →「Agent 接入」页 → 点「刷新状态」，看三件事：
   - 顶部是否出现 **服务端 ✓ N 工具** 徽标（说明 8204 活着、令牌有效）；
   - 每行是否出现 **实测 ✓ N 工具** 或 **实测 ✗ 401**（不再是清一色的「已接入」）；
   - 若某行是 `实测 ✗ 401`，页面顶部应出 **⚠ 实测连通异常** 提示块。
3. 挑一个你正在用的客户端（建议 **WorkBuddy**）点它那行的 **「改用 stdio」**：
   - 回执应说明「配置里不再有令牌」+ 备份路径；
   - 打开 `~/.workbuddy/mcp.json` 核对：条目变成 `command: "node"` + `args: [...]`，**没有 `url` / `headers` / Bearer**；
   - 该行徽标变成 **stdio 零维护**。
4. **验证零维护**：把 `D:\MultiAgent Memory\keys\mcp-token.txt` 改一个字符 → 重启 WorkBuddy → 再回接入页点刷新：
   - 配置一个字没改，实测仍应通（说明桥接脚本读的是文件现值）；
   - 改完记得改回去，或直接让桌面端重新生成令牌。
5. 确认无误后点顶部 **「⇄ 全改 stdio」** 一次性把其余可写客户端也换掉（每个都会先备份成 `.bak-<时间戳>`）。
6. 看日志：`D:\MultiAgent Memory\logs\actions.log` 里应有 `[mcp] client-wire {mode:'stdio'}`；异常时有 `client-live-probe-bad`。

> 提醒：客户端不会热重读配置，**改完要重启对应客户端**才生效；「已接入」≠「实测通」，以实测列为准。

---

## 4. 已知未做 / 需要你定

- `Zcode` 配置存应用内部存储（无文件面）→ 仍只能「复制片段」手工粘；stdio 片段**不含令牌**，可以放心贴。
- `deepseek harness` 随宿主 Qoder 下发：对宿主改 stdio，它就跟着变 stdio。
- 提交与推送**尚未执行**，等你实测 + 明确确认。在途改动（`recallHook.ts` / `pointerRoot.ts` / `llm*` / `tenantSource.ts` 等）与本次改动需要分开提交，届时会先出清单再动 git。
