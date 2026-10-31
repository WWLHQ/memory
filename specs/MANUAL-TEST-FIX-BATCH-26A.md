---
status: done
---

# 批次 26-A 手动测试报告 —— 本机信任边界（P0-4 / P0-5）

- 日期：2026-10-31
- 范围：`specs/AUDIT-FULL-REVIEW-2026-10-31.md` §6 的 P0-4（Webhook 8203 无鉴权）与 P0-5（AgentOnboard 8200 写端点无会话校验）
- 原则：**Origin 白名单不是鉴权；未接会话真源一律拒绝（fail-closed）**

## 1. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,983,792 B（116.33 MiB） |
| SHA256 | `2399f37d7e627e773527be5c3d6c6712ffaf93c9fb0f74a5ef4c6d1e71e0a3b4` |

## 2. 改动清单

### 26-A P0-4：Webhook 8203 令牌闸门（新 `src/electron/webhookServer.ts`）

1. **所有**请求（含无 Origin 的本机调用）一律校验 mcp-token：`Authorization: Bearer <t>` 或 `x-mcp-token: <t>`，`timingSafeEqual` 比较；缺令牌/错令牌 → 401，拒绝不泄露令牌值，落 `webhook:token_rejected` 动作日志。
2. 不受信 Origin（带 Origin 且不在白名单）→ 403（保持批次 A5 行为，先于令牌检查）。
3. body 上限 1 MiB，超限 → 413 且不进入 ingest。
4. `GET /ingest/status`、`GET /ingest/hash` 响应**不再含 `l2_preview`**（只回 id/dedup/状态/hash 等），`n` 钳制 1..100。
5. `POST /ingest` 的响应仍含 `l2_preview`（调用方本来就持有 L1 原文）。
6. `main.ts` 改用该工厂，原内联 webhookSrv handler 退役；`docs/会话采集启动指南.md` 已同步（8203 需令牌 + 401 排障行）。

### 26-A P0-5：AgentOnboard 8200 会话闸门 + 审计脱敏

1. `src/agentOnboard/server.ts` 新增 `getSession` 选项：POST/DELETE 全部要求 `x-session-id` 经会话真源校验；**未提供会话真源 = 写端点全部 401（fail-closed）**。
2. 密钥破坏性操作需管理员：`POST /agents/:name/rotate-key`、`POST /agents/:name/revoke-key`、`DELETE /agents/:name` → 非 admin 会话 403；配置/测试/一键接入 member 即可。
3. 拒绝落 `onboarding:auth_rejected` 动作日志（`no_session` / `admin_required` + user_id，无敏感值）。
4. `GET /audit` 出站脱敏：Windows 盘符路径（`C:\Users\...` 等）与 `/home|/Users|/usr/local|/opt|/var/lib` 路径替换为 `<本机路径>`（probe 失败 reason 可能带本机安装路径）。
5. CORS `Access-Control-Allow-Headers` 增加 `x-session-id`（预检不再被浏览器拦）。
6. UI 带会话头：`AgentOnboardClient` 构造第三参 `getSession`，`useBackendMirror.createService` 与 `autoOnboard.ts` 传 `currentSessionId()`；`main.ts` 向 server 注入 `homeServerRef.getSessionContext`。
7. E2E `e2e/app.spec.ts` 起真实 home 后端 + 内置 admin 真实登录取 sessionId（不再用伪造会话串）；`e2e/servers.ts` 的 `startHomeBackend` 暴露 `homeServer` 句柄。

## 3. 自动化门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck`（双配置） | 0 错 |
| `npm run lint`（oxlint） | 0 warning / 0 error |
| 索引新鲜度 `code:index:check` | 通过（已 `--write` 刷新，277 文件） |
| 单测 + 覆盖率 | 118 文件 / **1262 例**全过；覆盖率 语句 79.16 / 分支 71.47 / 函数 75.09 / 行 82.16（阈值 74/71/67/74） |
| `npm run verify`（含 Electron 构建 + E2E） | 21 spec / **94 例**全过（32.8s） |
| `npm run package` | exit 0；旧产物已清理，收口回 `release/installer`（EPERM 时复制+删除路径正常工作） |

新增/更新测试：
- 新 `src/electron/__tests__/webhookServer.test.ts`（10 例）：无令牌/错令牌 401、受信 Origin 无令牌 401、不受信 Origin 403、Bearer 放行、>1MiB 413 不入库、status/hash 无 l2_preview、n 钳位、404、拒绝日志不含令牌。
- `server.test.ts` +3 例：fail-closed（无会话/伪造 sid/无提供方）、member 403 / admin 放行（轮换/删除）、/audit 路径脱敏。
- `client.test.ts` +1 例：无会话客户端写操作被拒、读不受影响；既有用例改真会话。
- `origin.test.ts`：同源白名单无会话同样 401（Origin 白名单不是鉴权）。
- `e2e/app.spec.ts`：7 例改为真实 admin 会话全绿。

## 4. 手动测试步骤（安装版，管理员视角）

> 登录：内置管理员 `admin` / `Admin@123456`（登录后建议立即改密）。

**A. Webhook 8203 令牌闸门**
1. 启动安装版，登录 admin，进「日志记录页」确认程序日志出现 `bootstrap:webhook-listening`。
2. 令牌位置：数据根 `mcp-token.txt`（设置页「数据目录」卡片可打开）。
3. PowerShell 验证（替换 `<端口8203>`、`<令牌>`）：
   - 不带令牌：`curl.exe -X POST "http://127.0.0.1:8203/ingest" -d "{}"` → **401** `unauthorized`（旧版本这里是放行的——本次收口点）。
   - 带令牌且 Origin 不受信：`curl.exe -H "x-mcp-token: <令牌>" -H "Origin: http://evil.example" ...` → **403** `origin_not_allowed`。
   - 带令牌合法 ingest：`curl.exe -H "x-mcp-token: <令牌>" -H "Content-Type: application/json" -d '{"content":"手测26A","source_agent":"manual","category":"insight"}' "http://127.0.0.1:8203/ingest"` → 200 且 `dedup` 如实。
4. `curl.exe -H "x-mcp-token: <令牌>" "http://127.0.0.1:8203/ingest/status?n=5"` → items 中**没有 `l2_preview` 字段**；`n=999` 也只返回 ≤100 条。
5. 超 1 MiB body（如 2 MB 字符串）→ 413。
6. 日志记录页搜 `token_rejected`：detail 中**不含令牌明文**。

**B. 接入页 8200 会话闸门**
1. 退出登录（或清 session）直接打开「Agent 接入」页：登录门控仍在；若绕过 UI 用 curl 直调写端点（无 `x-session-id`）→ **401**「需要登录后操作」。
2. 普通成员（member）登录 → 接入页：配置卡片、点「测试」、手动检测可用；点某卡「轮换」→ **403**「…需管理员账号」；「撤销绑定」（DELETE）→ 403。
3. 管理员（admin）登录 → 上述操作全部可用；轮换返回一次性明文（只显示一次）。
4. 伪造会话：改 localStorage `session:realpage` 为任意字符串后点「测试」→ 401（会话真源在 home server，渲染层自报无效）。
5. 日志记录页搜 `auth_rejected`：`no_session` / `admin_required` 与 user_id 可查。

**C. 审计脱敏**
1. admin 在接入页对一张卡点「测试」且该 Agent 本机未装（probe 失败）→ `/audit` 返回 reason 中本机路径显示为 `<本机路径>`；UI toast/测试面板同步显示脱敏文案。

**D. 回归**
1. 登录后自动接入（批次16）正常：登录即三路真扫、auto_bind 审计、卡片指标回填（现在带会话头，行为不变）。
2. `npm run dev` 浏览器模式：接入页仍如实报「自动接入失败 · 非桌面壳环境」。

## 5. 已知边界 / 遗留

1. 8200 的 GET（`/agents`、`/audit`）保持只读开放（读不算敏感面）；`/audit` 出站已脱敏。
2. 8203 沿用 mcp-token.txt 单令牌，无按源限速；旧的外部采集调用方（无令牌）会得到 401——需按指南带 `x-mcp-token`。
3. 接入页在**纯浏览器 dev 模式**下 home 后端存在时，写端点带的是 dev 后端会话，正常可用；home 后端不在时页面显示登录门控（原本行为）。
4. 本批次未动 P0-8（git 提交，需用户授权）与 P0-9（CI 实跑，批次 27）；P1/P2 清单见审核报告 §6，将在批次 26-B 处理。
