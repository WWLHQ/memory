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

- `zcode` / `deepseek-harness` 仍**不可自动写入**（无配置文件），只能「复制片段」手工粘贴。若产品要求「一键接入」，需要客户端提供可写配置文件或官方 CLI 命令，属外部能力依赖，不在本仓库可解范围。
- `manual` 行的「实测 N 工具」显示「不可测」属如实呈现：它们没有配置，也就没有令牌可测。
- 本方案只统一了「清单口径」，没有改扫描层的 `installed` 语义（`installed` 仍含痕迹），原因是审计与首页计数依赖旧口径；两处消费者已分别对齐到各自需要的那一组。
