---
status: done
---

# 手动测试报告 · 修复批次 2（信任边界）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-060257/MultiAgent Memory-0.1.0-setup.exe`（121,912,538 B = 116.26 MiB）
- SHA256：`950dd90b4992c76bbccb32e2c06b38058b1ef4221f9438ce83dd6a331ac1651e`
- 未打包目录：`release/installer-20261030-060257/win-unpacked/MultiAgent Memory.exe`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`；便携包/开发态 `%APPDATA%\multi-agent-memory`
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md`；本轮对应审核清单批次 2（登出会话失效 / 验证码过期 / hostBridge 来源校验 / MCP 鉴权与体积上限 / 租户闭包 / Agent Key 哈希 / dev origin 隔离）
- 配套文档：`docs/会话采集启动指南.md`（已按真实 userData 路径、令牌与 8204 更新）

## 1. 本轮改了什么

| 项 | 内容 |
| --- | --- |
| 2-A 登出会话失效 | 前端登出请求头由 `X-Auth-Session` 改为服务端实际读取的 `x-session-id`（服务端同时兼容旧头），登出后旧 sessionId 立即失效，`GET /api/me` 返回 401 |
| 2-B 验证码过期 | `captchaStore` 记录 `expiresAt`；注册时先判过期再判 code，过期即删除并 400 `invalid_captcha`；`GET /api/captcha` 顺带清理过期项；TTL 可配（缺省 5 分钟） |
| 2-C hostBridge 来源校验 | 仅接受 `e.origin === 当前页面 origin` 且非 `'null'` 的消息；只允许 `CHANNEL_TO_NATIVE` 内方法与数组 args；回包 `targetOrigin` 精确到请求方 origin；同一 `req.id` 10s 内只执行一次（防 iframe 重试重复触发 `backup:runNow` 等副作用） |
| 2-D MCP TCP 鉴权 | 新增 32 字节随机令牌（`userData/mcp-token.txt`，0600）；每个 socket 独立 Session 并记录授权态（删除全局 `currentSession`）；连接首条请求必须带 `params.token`，失败 `-32001`；单行上限 1 MiB（超限 `-32600` 并断开） |
| 2-E MCP HTTP 鉴权 | `POST /mcp` 必须带 `Authorization: Bearer` 或 `x-mcp-token`，否则 401 + `WWW-Authenticate: Bearer`；任何带 `Origin` 的请求 403；路径严格等于 `/mcp`；请求体上限 1 MiB → 413 `payload_too_large` |
| 2-F 租户闭包 | MCP `write_memory.user_id` / `get_user_preferences.user_id` 必须等于本机会话账号（缺省 `u1`），跨租户 → `-32602`；写入一律使用会话 `user_id`，不信任调用方 |
| 2-G Agent Key 脱敏 | 轮换密钥只持久化 `keyHash`（SHA-256）+ `keyTail`（末 4 位），明文仅在轮换响应顶层一次性返回；`GET /agents`、审计与磁盘均不含明文；旧账本若含 `apiKeyPlaintext`，启动即迁移并重写文件清除明文 |
| 2-H dev origin 隔离 | `createOriginPolicy` 默认不再并入 Vite dev 源（5180）；仅 `tools/dev-backend.mjs` 显式 `allowDevOrigins: true`，生产打包态访问 5180 来源一律 403 |
| 2-I 请求体上限 | home / agentOnboard / MCP HTTP 统一 1 MiB，超限 413 `payload_too_large`（防止无界内存占用） |

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 单元/集成测试 | `npx vitest run` | **90 文件 / 816 用例全过** |
| Web 构建 | `npm run build` | 通过（19 个页面入口） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + dir 双目标） |

新增/调整测试：

- `src/shared/__tests__/localOrigin.test.ts`：dev 源需显式 `allowDev`，并新增生产默认不含 dev 源用例。
- `src/home/__tests__/server.test.ts`：新增登出旧 `x-auth-session` 失效、验证码 TTL 过期、1 MiB 上限三组用例。
- `src/desktop/__tests__/hostBridge.test.ts`：新增 5 个信任边界用例（跨源/null Origin/未知方法/重复 id/超时）。
- `src/core/memagent/__tests__/mcp.test.ts`：全部请求带令牌；新增无令牌/错令牌 `-32001`、跨租户 `-32602`、单行超限 `-32600`。
- `src/core/memagent/__tests__/mcpHttp.test.ts`（新建）：401/403/404/413/initialize/跨租户/真实落库。
- `src/agentOnboard/__tests__/service.test.ts` / `server.test.ts`：轮换只回一次性明文；响应卡片、磁盘、重启后均无明文；新增旧账本明文启动迁移用例。

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-060257/MultiAgent Memory-0.1.0-setup.exe` | 121,912,538 B = **116.26 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-060257/win-unpacked/` | 可直接运行 `MultiAgent Memory.exe` |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 仍被本机工作区索引器占用（EPERM），`tools/package-builder.cjs` 按既有逻辑自动输出到时间戳目录，属预期。

## 4. 本轮手动测试用例（重点）

> 令牌读取（PowerShell）：`(Get-Content "$env:APPDATA\MultiAgent Memory\mcp-token.txt" -Raw).Trim()`
> 便携包/开发态把目录换成 `multi-agent-memory`。TCP 完整脚本见 `docs/会话采集启动指南.md` §2.7。

### 4.1 登出会话失效（2-A）

| # | 操作 | 期望 |
| --- | --- | --- |
| A-1 | 登录应用 → 打开 DevTools Network → 记录登录响应的 `sessionId` → 点击退出登录 | 退出请求头为 `x-session-id: <sessionId>`；响应 200 |
| A-2 | 退出后用记录的旧 sessionId 请求 `GET http://127.0.0.1:8201/api/me`（DevTools Console：`fetch` 带 `x-session-id`） | 返回 401；刷新/返回首页要求重新登录，不能凭旧会话直接进入 |
| A-3 | 重新登录后再次 `GET /api/me` | 200，返回当前租户上下文 |

### 4.2 验证码过期（2-B）

| # | 操作 | 期望 |
| --- | --- | --- |
| B-1 | 打开注册页 → 获取验证码 → 5 分钟内完成注册 | 注册成功（缺省 TTL 5 分钟） |
| B-2 | 获取验证码后等待超过 5 分钟再提交 | 400 `invalid_captcha`；该验证码同时被删除，不能重试 |
| B-3 | 获取验证码后重新点「获取验证码」再提交旧 code | 旧 code 400（以最新验证码为准） |

> TTL 默认 5 分钟，单测已用 `captchaTtlMs: 5` + 20ms 等待覆盖过期路径；手动测试可等待 5 分钟验证真实链路。

### 4.3 hostBridge 来源与副作用（2-C）

| # | 操作 | 期望 |
| --- | --- | --- |
| C-1 | 正常使用概览页内嵌 iframe（记忆/审计等子页） | 功能与之前一致；无消息桥报错；备份「立即执行」只触发一次 |
| C-2 | 在 DevTools Console 以错误方法名 `window.parent.postMessage({id:'x',method:'evil'},'*')` 发消息 | 主窗口忽略，不执行任何能力 |
| C-3 | 连点两次「立即备份」或在 iframe 断线重试场景观察日志 | 同一请求 id 只执行一次，不出现重复备份审计 |

> 跨源来源与 `Origin: null` 的忽略、回包 targetOrigin 精确性、未知 channel/非数组 args、重复 id 去重均由 `hostBridge.test.ts` 覆盖。

### 4.4 MCP TCP 鉴权与租户闭包（2-D / 2-F）

| # | 操作 | 期望 |
| --- | --- | --- |
| D-1 | 启动应用，查看 `%APPDATA%\MultiAgent Memory\mcp-token.txt` | 文件存在，内容为 64 位 hex；主日志有 `bootstrap:mcp-token-ready`（只记路径） |
| D-2 | 用 §2.7 脚本但 `initialize` 不带 `params.token` | 返回 `-32001 unauthorized` |
| D-3 | `initialize` 携带正确令牌后再 `tools/list` / `write_memory` | 正常返回三个工具；写入成功；审计出现对应 `write` |
| D-4 | 同一连接首条请求带错令牌 | `-32001`，且该连接后续即使带对令牌也不可用（需重连） |
| D-5 | 用正确令牌发 `write_memory` 且 `params.user_id='u2'` | `-32602`「禁止跨租户写入」；记忆库不新增 |
| D-6 | 用正确令牌发 `get_user_preferences` 且 `user_id='u2'` | `-32602`「禁止跨租户读取」 |
| D-7 | 发送单行 >1 MiB 的 JSON | 返回 `-32600` 后连接被断开；应用不崩溃 |
| D-8 | 两个客户端同时连接并各自写入 | 互不串会话；各自写入使用各自授权账号 |

### 4.5 MCP HTTP 鉴权与体积上限（2-E / 2-I）

| # | 操作 | 期望 |
| --- | --- | --- |
| E-1 | `curl -X POST http://127.0.0.1:8204/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`（不带令牌） | 401 + `WWW-Authenticate: Bearer` |
| E-2 | 同上加 `-H "Authorization: Bearer <token>"` | 200，返回工具清单 |
| E-3 | 用 `x-mcp-token: <token>` 代替 Authorization | 200 |
| E-4 | 带上 `-H 'Origin: http://localhost:5180'` | 403 `origin_not_allowed`（即使是受信页面来源也拒绝浏览器请求） |
| E-5 | 请求 `POST /mcpanything` 或 `GET /mcp` | 404 |
| E-6 | 发送超过 1 MiB 的请求体 | 413 `payload_too_large` |

### 4.6 Agent Key 脱敏与旧账本迁移（2-G）

| # | 操作 | 期望 |
| --- | --- | --- |
| F-1 | Agent 接入页 → 某卡片「轮换密钥」 | 界面显示一次完整密钥（`mam_sk_<48 hex>`）；仅此一次 |
| F-2 | 刷新页面 → `GET http://127.0.0.1:8200/agents` | 卡片只有 `keyHash`（64 hex）与 `keyTail`（末 4 位）；`apiKeyPlaintext` 为 null；无完整密钥 |
| F-3 | 打开 `%APPDATA%\MultiAgent Memory\agent-onboard.json` 搜索完整密钥 | 文件与审计均不含明文 |
| F-4 | 重启应用后再次查看 `GET /agents` | 仍只有 hash/tail，明文不可恢复 |
| F-5 | 构造旧账本：在 `agent-onboard.json` 的卡片中加入 `"apiKeyPlaintext":"mam_sk_<48 hex>"`，重启应用 | 启动即迁移为 hash/tail 并重写文件；`GET /agents` 无明文；文件内旧明文已被清除 |

### 4.7 生产不信任 dev origin（2-H）

| # | 操作 | 期望 |
| --- | --- | --- |
| G-1 | 安装包版启动后，用 curl 向 8200/8201 发送 `Origin: http://localhost:5180` | 403（生产默认不并入 Vite dev 源） |
| G-2 | `npm run dev` 另开开发入口（`tools/dev-backend.mjs` 显式放行） | 5180 来源可正常访问，本地开发不受影响 |

### 4.8 请求体上限（2-I）

| # | 操作 | 期望 |
| --- | --- | --- |
| H-1 | 向 `POST http://127.0.0.1:8201/api/login` 发送 >1 MiB JSON | 413 `payload_too_large`，应用不崩溃 |
| H-2 | 向 `POST http://127.0.0.1:8200/agents` 发送 >1 MiB JSON | 413 `payload_too_large` |

## 5. 回归清单

- 登录 / 登出 / 注册（含验证码）正常；跨 iframe 登录态仍可透传。
- 写入 → 记忆列表、检索、删除 → 审计、立即备份、采集器增量采集均正常。
- Agent 接入页：自动发现、测试接入、轮换密钥、吊销、保存配置均正常；旧卡片仍能加载。
- 桌面应用启动无新增报错；主日志出现 `bootstrap:mcp-token-ready`、MCP/HTTP 监听正常。
- 关闭主窗后 8200–8204 与静态服务全部退出，无残留进程。
- 记忆库、审计、Agent 配置、令牌文件均位于 `%APPDATA%\MultiAgent Memory`（便携版为 `multi-agent-memory`）。

## 6. 已知问题 / 边界

- **令牌没有 UI 展示**：只在 `userData/mcp-token.txt`，需手动读取并配置给 Agent；删除该文件并重启即可轮换（旧令牌立即失效）。
- **TCP 令牌按连接授权一次**：首条请求通过后该连接继承授权；错误令牌会直接拒绝，需重连。
- **Webhook（8203）不需要令牌**：仅监听 `127.0.0.1` 且带浏览器 Origin 的非受信页面会被 403；仍建议只在本机使用。
- **E2E 端口冲突（既有问题，未纳入本批）**：`e2e/overview.spec.ts` 使用 8202、`crossTabAuth.spec.ts` 使用 8204，与桌面应用 MCP 端口重合；同时 `e2e/servers.ts` 的前缀校验可被同前缀路径绕过。均记录在批次 4 门禁任务。
- 未签名安装包 SmartScreen 提示、`author` 缺失提示、esbuild `import.meta` CJS 告警均为既有现象，不影响运行。
- 工作区未提交（流程约束，非遗漏）。

## 7. 版本控制状态

- 本轮修改（未提交）：
  - 源码：`src/shared/localOrigin.ts`、`src/home/server.ts`、`src/web/Home/useLoginMirror.ts`、`src/desktop/hostBridge.ts`、`src/core/memagent/mcpAuth.ts`（新增）、`src/core/memagent/mcp.ts`、`src/core/memagent/mcpHttp.ts`、`src/electron/main.ts`、`src/types/agentOnboard.ts`、`src/agentOnboard/service.ts`、`src/agentOnboard/server.ts`、`src/agentOnboard/client.ts`
  - 开发工具：`tools/dev-backend.mjs`
  - 测试：`src/shared/__tests__/localOrigin.test.ts`、`src/home/__tests__/server.test.ts`、`src/desktop/__tests__/hostBridge.test.ts`、`src/agentOnboard/__tests__/service.test.ts`、`src/agentOnboard/__tests__/server.test.ts`、`src/core/memagent/__tests__/mcp.test.ts`、`src/core/memagent/__tests__/mcpHttp.test.ts`（新增）
  - 文档：`docs/会话采集启动指南.md`、本报告
- 未执行 `git commit` / `git push`。
