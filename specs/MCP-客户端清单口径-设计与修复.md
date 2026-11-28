# MCP 接入页「客户端清单口径」设计与修复（2026-11-28）

> 触发：用户实测「已重新扫描：检出 8 个已安装客户端」，但下方清单只有 6 行；用户判定为**设计问题**，不是数字口误。
> 结论：确实是分组判据的设计缺陷——把「客户端把配置存在内部存储」误判成「只剩残留目录、可能已卸载」，直接扔进了弱提示。

## 1. 现象与证据

| 项 | 实测 |
|---|---|
| 回执 | `已重新扫描：检出 8 个已安装客户端` |
| 清单行数 | 6（Qoder CN、Claude Code、Codex、Cursor、Trae Code CN、WorkBuddy） |
| 差额 2 个 | Zcode（`~/.zcode`）、deepseek harness（`~/.dsh`） |

磁盘核对（2026-11-28 18:49）：

- 6 个客户端有真实配置文件：`~/.qoder-cn/settings.json`、`~/.claude.json`、`~/.codex/config.toml`、`~/.cursor/mcp.json`、`~/.workbuddy/mcp.json`、`%APPDATA%/Trae CN/User/mcp.json`。
- Zcode、deepseek harness 只有安装目录，没有配置文件。

## 2. 根因

`scanMcpClients` 的判定是二值的：

```
installed       = 配置文件存在 || 安装痕迹存在
installEvidence = 配置文件存在 ? 'config' : 安装痕迹存在 ? 'marker' : 'none'
```

而 `MCP_CLIENT_SPECS` 里有两个客户端**永远不可能有配置文件**：

| id | configPath | 原因 |
|---|---|---|
| `zcode` | `null` | 配置存应用内部存储（IndexedDB），只能复制片段手工粘贴 |
| `deepseek-harness` | `null` | 随宿主（Qoder Desktop）下发，自己没有配置文件 |

于是它们恒为 `marker`。而渲染层原来的分组是：

```
rows      = installed && installEvidence !== 'marker'   // 排除了它们
traceOnly = installed && installEvidence === 'marker'   // 它们被当成「残留目录、可能已卸载」
```

**缺陷本质**：`marker` 被赋予了两种完全不同的含义——

1. 「本该有配置文件，但文件没了」→ 疑似卸载，该排除；
2. 「这个客户端天生没有配置文件，痕迹存在就说明装了」→ 真安装，该进清单。

用一个字段承载两种语义，导致第 2 类被永久吃掉。

另有一处次要缺陷：回执计数用 `installed`（含痕迹），清单用过滤后的 `rows`，两套口径必然对不上，同一个页面上出现两个互斥数字。

## 3. 修复方案（已实现）

### 3.1 判据拆成两类，不再看 `marker` 单字段

```
进清单   = installed && (installEvidence !== 'marker' || !displayPath)
仅痕迹   = installed && installEvidence === 'marker' && !!displayPath
```

`displayPath === null` 等价于该客户端没有稳定配置文件入口，痕迹就是唯一证据 → 按真安装处理，状态走 `manual`（需手工），操作区只给「复制片段」。

### 3.2 回执与清单共用同一个谓词

`refresh({announce:true})` 的数字改为与 `rows` 同判据，并把被排除的真·残留目录单独交代：

```
已重新扫描：检出 6 个已安装客户端（另有 1 个仅安装痕迹、配置缺失，不计入清单） · 19:00:00（UTC+08:00）
```

### 3.3 文案纠正

弱提示从「仅发现残留目录…可能已卸载」改为「本该有配置文件却读不到（只剩目录），可能已卸载或配置被删」——只描述第 2 类，不再把 Zcode 这类误伤。

### 3.4 状态语义保持不变

七个 `McpWireState` 一格未改：`manual` 本来就是「该客户端暂无稳定可写配置（只给手工说明）」，正是这两个客户端的正确状态。

## 4. 验证

| 闸门 | 证据 |
|---|---|
| A·影响面 | 全量 343 文件 / 4371 用例全绿；`tsc --noEmit` 0 错；oxlint 改动文件 0 warning 0 error；代码索引 `--check` 一致 |
| B·效果 | 新增用例：4 个有配置文件 + 2 个无配置路径 + 1 个真残留 → 清单 6 行、Zcode/deepseek harness 在行内、Cursor 只在弱提示、回执「检出 6 个…另有 1 个…」 |
| C·变异 | 把 `rows` 判据改回 `installEvidence !== 'marker'` → 用例红（`expected 4 to have length 6`）→ 还原后绿 |

## 5. 边界与遗留

- `zcode` 仍**不可自动写入**（配置存客户端应用内部），只能「复制片段」手工粘贴；`deepseek-harness` 可写，但写的是**宿主**（Qoder CN）的配置。
- `manual` 行的「实测 N 工具」不再一律显示「—」，见第 6 节（按令牌来源给确定结论并标口径）。
- 本方案只统一了「清单口径」，没有改扫描层的 `installed` 语义（`installed` 仍含痕迹），原因是审计与首页计数依赖旧口径；两处消费者已分别对齐到各自需要的那一组。

## 6. 第二轮：无文件面客户端「把工作做完」（2026-11-28）

用户反馈：Zcode / deepseek harness 只是「显示出来了」，但形态写「形态未定」、实测写「—」、动作列空一格，
与其它卡片对不齐，等于工作没做完。三条一起补，判据全部可测：

### 6.1 形态：读不到配置就由规格推导，不留「形态未定」

真源 `src/agentOnboard/mcpClients.ts#impliedTransport(spec)`：

```
format = json | toml  → 'http'          // 本服务写进任何 JSON/TOML 客户端的条目都是 url/httpUrl + headers
inheritsFrom 有值      → 递归宿主的形态   // deepseek harness ← qoder-cn → http
否则                   → undefined       // 只有这一种情况 UI 才允许说「形态未定」
```

UI 顺序：`row.transport`（配置里读到的）→ `impliedTransport`（规格推导）→ 「形态未定」。
推导来源的徽标 title 固定以「将以此形态接入：」开头，不冒充「已接入该形态」。

### 6.2 实测：按令牌来源给确定结论，但口径必须写在徽标里

`McpLiveProbe` 新增 `via: 'config' | 'host' | 'current'`，`attachLiveProbe` 第 4 参 `viaOf` 挂载时
**克隆**结果再写 via（同一份令牌被多个客户端复用时不会互相覆盖）。来源判定（`main.ts`）：

| 情形 | 令牌 | via | 徽标文案 |
|---|---|---|---|
| 有配置且读到令牌 | 该客户端配置里的 | `config` | `实测 ✓ 14 工具` |
| 宿主继承、无配置 | 宿主（Qoder CN）配置里的 | `host` | `实测 ✓ 14 工具 · 经宿主令牌` |
| stdio / 无配置且非继承 | 现役令牌（= 片段里那份） | `current` | `实测 ✓ 14 工具 · 片段令牌` |
| 有配置但读不到令牌 | 不测 | — | `实测 —` + title「这份配置里没有可用的令牌」 |

`readStoredToken` 同步支持宿主继承：`!configPath && inheritsFrom` → 读宿主的令牌；纯手工（Zcode）仍返回 null。

### 6.3 动作：槽位恒定，不出现空位

`!row.writable` 的行（目前只有 Zcode）第二个动作槽位补徽标：未接入 →「需手工粘贴」，
已接入 →「已手工接入」；同时「复制片段」在这类行升级为 `pri` 主按钮——它就是唯一可行动作。

### 6.4 稳定输出：三行定高、名称单行

`theme.css` 的 `.af-client`：名称行 `height:17px; white-space:nowrap; text-overflow:ellipsis`，
形态行/实测行 `height:18px; flex-wrap:nowrap`。长名称不再把下面两行顶下去，任何客户端都恰好三行同高。

## 7. 第二轮验证

| 闸门 | 证据 |
|---|---|
| A·影响面 | 全量 343 文件 / 4375 用例全绿；`tsc --noEmit` 0 错；oxlint 改动文件 0 error；代码索引重建 + `--check` 一致 |
| B·效果 | 新用例：Zcode 形态=HTTP 直连（title「将以此形态接入」）、`live` 含「片段令牌」、`manual-zcode`=「需手工粘贴」、复制片段带 `pri`；deepseek harness 含「经宿主令牌」；两行仍是三行结构 |
| C·变异 | ① `impliedTransport` 恒 undefined → 红（`expected '形态未定' to be 'HTTP 直连'`）② 删 via 后缀 → 红（`to contain '片段令牌'`）③ 动作槽位条件置假 → 红（找不到 `manual-zcode`）；三次还原后哈希一致、141 用例全绿 |

## 8. 第三轮：配置文件路径 / 身份头注入 / 自动接入（2026-11-28，实机更正前两轮的判断）

### 8.1 推翻的错误前提

前两轮把 Zcode 与 deepseek harness 都当成「无稳定配置文件」，因此只能「复制片段 + 手工粘贴」，
`deepseek harness` 还因此写成「随宿主 Qoder 下发」。**这两条都是错的**，实机找到了真实文件：

| 客户端 | 真实配置文件（实测存在） | 格式 | 现有条目 |
|---|---|---|---|
| Zcode | `~/.zcode/mcp.json`（本机是指向 `D:/Work Folder/Agnet/Zcode/.zcode` 的软链接目录） | JSON `mcpServers`，`type+url+headers` | 键 `multiagent-memory`，身份头被写成了 `deepseek-harness` |
| deepseek harness | `~/.dsh/profiles/desktop/cordis.patch.yml` | YAML 插件声明 `- insert: - id: memagent-mcp / name: '@deepseek-ai/dsh-mcp-client' / config:{serverName,transport,url,headers}` | 存在，`Authorization: Bearer` 换行 + 缩进令牌 |

错误根因：配方表把「客户端 UI 里有表单/JSON 编辑器」错当成「磁盘上没有文件」，
把「插件式 YAML」错当成「没有配置面」。**判据应只看磁盘上有没有可读写文件，不看 UI 有没有表单。**

### 8.2 修复

1. **配方更正**（`src/agentOnboard/mcpClients.ts`）：
   - `zcode`：`configPath='~/.zcode/mcp.json'`、`writable=true`、`serverKey='multiagent-memory'`（沿用文件里既有键，避免同一服务被写成两条）。
   - `deepseek-harness`：`format='yaml'`、`configPath='~/.dsh/profiles/desktop/cordis.patch.yml'`、`writable=true`、`pluginName='@deepseek-ai/dsh-mcp-client'`；**删除 `inheritsFrom`**（它有自己的配置面，不再随宿主判定）。
2. **YAML 支持**（新增 `probeYamlConfig` / `mergeMcpYamlConfig`）：纯文本行级定位 `- id: <serverKey>[-mcp]` 块，
   只改三处——`url` 行、`Authorization` 行（认「Bearer 换行 + 缩进令牌」的老写法）、`X-Memagent-Client` 行（缺则补在其后）；
   其它插件、注释、缩进、字段一律不动。没有该条目时追加标准插件声明。块内没有 `url` 字段时拒绝猜写。
3. **身份头按值校验**：`hasClientId` 从「有没有这个头」改为「值是否等于本客户端 id」，并回传 `foundClientId`。
   Zcode 现状（写成 `deepseek-harness`）因此从「已写对」变成「不符」，边界按钮变「补身份头」，一键即可改成 `zcode`。
4. **JSON 合并保留其它请求头**：Zcode 的 `X-Memagent-Render: fold` 不会被顺手删掉（只覆盖 `Authorization` 与 `X-Memagent-Client`）。
5. **UI 对齐**：配置路径列显示真实文件（不再出现「无稳定配置路径」）；状态列对「值不符」显示 `不符：<实际值>`；
   动作列对 YAML 行给等宽徽标「免令牌不适用」（`canStdio` 只对 JSON/TOML 生效），不再出现空槽。

### 8.3 验证

| 闸门 | 证据 |
|---|---|
| A·影响面 | 全量 343 文件 / 4384 用例全绿；`tsc --noEmit` 0 错；oxlint 改动 7 文件 0 warning 0 error；代码索引重建 + `--check` 一致 |
| B·效果 | 新增 YAML 组 5 例（探测/冲突/身份头不符/合并保留注释与其它插件/缺失则追加）；Zcode 真写盘 1 例（改身份头且保留 `X-Memagent-Render`）；DSH 真写盘 1 例（宿主配置一字未动）；面板 1 例（真实路径 + 「不符」+ 免令牌徽标补位） |
| C·变异 | ① 身份头不校验值 → 红（`expected true to be false`）② YAML 不重写身份头 → 红（`to contain 'X-Memagent-Client: deepseek-harness'`）③ `canStdio` 不区分配置格式 → 红（`expected <button…> to be null`）；还原后哈希一致 |
