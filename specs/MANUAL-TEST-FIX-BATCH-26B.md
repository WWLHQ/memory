# 批次 26-B 手动测试报告 —— 本机信任边界（P1 / P2）

- 日期：2026-10-31
- 范围：`specs/AUDIT-FULL-REVIEW-2026-10-31.md` §6 的 P1-1/2/3/9/10/11 与 P2-14/15/16/17（P0-4/P0-5 已在批次 26-A 交付）
- 原则：与 26-A 相同；每项的诚实偏差与残留风险已固化在 `AGENTS.md` §9「批次26-B」条目，落点表在 `specs/code-map.md`「批次26-B」一节

## 1. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,985,462 B（116.33 MiB） |
| SHA256 | `f7985163d148d58dc0b0b52089b6f51a75be06867c50e742ffef02ad8777b35c` |

## 2. 改动清单

### P1-1 `?backend=` / `?agentBackend=` 回环白名单（`src/web/backend.ts`）
1. URL 参数基址必须 `http://(localhost|127.0.0.1|[::1]):<显式端口>` 且无路径/查询/凭据；不合规回落默认端口并记 `ui:error`。不限定 82xx：E2E 随机端口与 dev 备用端口 8211-8215 都要可用。

### P1-2 数据面 IPC 门禁（`preload.ts` + `main.ts`）
1. `storage:deleteMemory / storage:appendAudit / hostScan:run / hostAgentDetect:run` 四条通道由 preload 尾参自动附带登录会话 id（`src/shared/sessionKey.ts` 单一真源），主进程 `requireDataPlaneSession` 校验，失败**抛错**（内核以 promise rejection 表达，页面显示真实错误）。
2. `appendAudit` 形状校验：action ≤40 字符、request_id 仅 `[A-Za-z0-9_-]{1,64}`、ts 有限数字、detail 须对象。
3. **诚实偏差**：审计报告写「拒绝调用方自报 request_id」，但 P0-2 日志页按 request_id 真查内核审计依赖内核合法自报的关联键 → 实现为形状校验（挡注入面），保留合法关联键。
4. 读通道（get/list/query/putMemory/location/openMemoryFile）未加门禁——审计证据链只有「清空账本 + 伪造审计」，按外科手术范围处理。

### P1-3 租户三元组主进程下发
1. 新增 `tenant:get` IPC（会话校验）：主进程按会话下发 user/team/enterprise 三元组；`kernel.ts syncTenantFromHost()` 模块加载即拉取并覆盖 `mam.tenant.v1`，渲染层自报只在纯浏览器降级时生效。

### P1-9 角色/团队/改密吊销会话（`src/home/server.ts`）
1. role_change / team_assign → 吊销目标账号全部会话；password_change → 连当前会话一并吊销（必须重新登录）。

### P1-10 MCP 令牌项目作用域（`mcpAuth.ts` + 双传输）
1. `McpAccount.scope_project_ids`（默认 `['*']`）：`projectInScope()` 在 recall_memory / write_memory / list_projects 三工具统一校验（HTTP 8204 + TCP 8202）；作用域外项目 McpToolError 拒绝（-32602）。
2. **残留风险（诚实声明）**：默认仍 `['*']`——本机账本混住多租户身份（页面写 kernelAccount、采集器/MCP 写 u1/t1/e1），按 team/enterprise 硬过滤会打破 AGENTS §1.1 召回承诺；真正收紧需先做账本租户归一。单令牌仍是机器级凭据。

### P1-11 L0 查阅门禁与 KDF
1. `l0:unlock` 无 grant_id（管理员密码直阅）分支改 `requireAdmin`（非管理员 403）。
2. `crypto.ts` pbkdf2Sync → 异步 `pbkdf2`（libuv 线程池），解锁不再整停主进程数百 ms。

### P2-14 本机凭据面（`src/home/server.ts` + `loginService.ts`）
1. 登录内存滑动窗口限速：每账号 10 次/分钟 → 429 `rate_limited`（锁定文件可被删除复位，内存计数删不掉；同时约束 scrypt 触发频率）。
2. admin 登录仍在用初始口令 → 每次登录记 `home:default_password_active` 告警（不落口令）。
3. **残留**：默认口令 `Admin@123456` 仍随首启播种（§5 已提示登录后立即修改）；scryptSync 保持同步（异步化要动 login() 同步签名、波及十余个测试文件，本机单用户服务上 50ms 阻塞接受）。

### P2-15 令牌副本清理（`src/electron/mcpClients.ts`）
1. 一键接入写入失败清 `.tmp-` 半成品；成功后每配置文件只保留最新 **3** 份 `.bak-`（含明文令牌的备份不再无限累积）。

### P2-16 Host 头绑定（`src/shared/localOrigin.ts`）
1. `rejectUntrustedHost`：Host 必须恰为 `127.0.0.1|localhost|[::1]:<本服务实际端口>`，否则 403 `host_not_allowed`（防 DNS rebinding）；home 8201 与 onboard 8200 均接线，拒绝落 `host_rejected` 日志。无 Host（HTTP/1.0 CLI）放行。

### P2-17 验证码 / 注册（`src/home/server.ts`）
1. captcha 存量上限 256（超出淘汰最早）+ 签发 30 次/分钟；注册 10 次/分钟 → 429。
2. 防用户名枚举：登录「账号不存在」与「密码错误」返回同一响应（401 `wrong`）；真实原因只在服务端日志/审计。
3. **残留（诚实声明）**：验证码 code 仍直出给调用方——本机无短信/邮件通道，设计取舍；注册/账号持久化仍是全文件 JSON 写（与全应用存储模式一致，P1-5 单独立项）。

## 3. 自动化门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck`（双配置） | 0 错 |
| `npm run lint`（oxlint） | 0 warning / 0 error |
| 索引新鲜度 `code:index:check` | 通过（已 `--write` 刷新，278 文件） |
| 单测 + 覆盖率 | **1289 例**全过；覆盖率 语句 79.28 / 分支 71.62 / 函数 75.21 / 行 82.26（阈值 74/71/67/74） |
| `npm run verify`（含 Electron 构建 + E2E） | **94 例**全过（35.5s） |
| `npm run package` | exit 0；旧产物清理 + 收口回 `release/installer`（EPERM 复制+删除路径正常） |

新增/更新测试：
- 新 `src/core/memagent/__tests__/mcpScope.test.ts`（8 例）：`projectInScope` 纯函数三态；HTTP 全链路 recall 作用域外拒绝 / write 作用域外拒绝不落库 / 作用域内放行 / list_projects 过滤；`runRecallTool` 直调默认 `'*'` 不受影响。
- `src/web/__tests__/kernelTenant.test.ts`（新，4 例）：浏览器降级不动租户 / 主进程三元组覆盖缓存与 localStorage / ok:false 或调用失败保持原租户。
- `src/home/__tests__/admin.test.ts` +3 例（P1-9）：角色变更 / 团队变更 / 改密后旧会话 401、重新登录生效、`sessions_revoked` 日志。
- `src/home/__tests__/server.test.ts` +5 例（批次26-B describe）：恶意 Host 403 `host_not_allowed` + `host_rejected` 日志；登录限速 11 次 → 429（含锁定交互）；注册限速 11 次 → 429；防枚举（ghost 与错密码同响应）；`default_password_active` 告警且口令零落日志。
- `src/shared/__tests__/localOrigin.test.ts` +1 describe（3 例）：回环 Host 放行（大小写）、无 Host 放行、恶意域名/错端口 403。
- `src/electron/__tests__/mcpClients.test.ts` +1 例：连续 5 次写入只留最新 3 份备份、无 `.tmp-` 残留。
- `src/web/__tests__/backend.test.ts`：`?backend=` 白名单 9 例（上一段落交付，随本包一起出）。

## 4. 手动测试步骤（安装版）

> 登录：内置管理员 `admin` / `Admin@123456`（登录后建议立即改密——本批次起每次用它登录都会在程序日志看到 `home:default_password_active` 提醒）。

**A. P1-9 变更吊销会话**
1. 两个会话同时登录同一 member 账号（两个窗口）。
2. admin 在「账号与安全」页改该成员角色/团队 → 另一窗口任何需要会话的操作立即 401，需重新登录。
3. 该成员自己改密 → 当前窗口也提示重新登录。
4. 日志记录页可查 `home:sessions_revoked`（user + count）。

**B. P2-14 登录限速与默认口令告警**
1. 登出后对同一账号连续输错 5 次 → 第 6 次起 423 锁定（原行为）；改用新账号在 1 分钟内连续尝试 11 次 → 第 11 次显示 429「过于频繁」（日志 `home:login_rate_limited`）。
2. 删除数据根 `home-locks.json` 后重启 → 锁定表从快照恢复逻辑不变；但**同一分钟内**的爆破仍会被内存限速拦住（内存计数删不掉）。
3. admin 用初始口令登录 → 日志出现 `home:default_password_active`；改密后再次登录 → 不再出现。
4. 日志全文搜索确认不含任何口令明文。

**C. P2-16 Host 头绑定（DNS rebinding 防护）**
1. 正常使用（浏览器直连 `127.0.0.1:8201` / `:8200`）完全不受影响——登录、接入、镜像全部正常。
2. 模拟 rebinding（PowerShell）：`curl.exe -H "Host: evil.example" http://127.0.0.1:8201/api/health` → **403** `host_not_allowed`；日志出现 `home:host_rejected`。
3. 错端口同理：`curl.exe -H "Host: 127.0.0.1:9999" http://127.0.0.1:8201/api/health` → 403。

**D. P2-17 验证码 / 注册 / 防枚举**
1. 注册页正常注册一个新账号 → 成功（限速 10 次/分钟内无感）。
2. 脚本 1 分钟内注册 >10 次 → 第 11 次 429（日志 `home:register_rate_limited`）；验证码 >30 次/分钟 → 429。
3. 登录一个**不存在的账号**与一个**存在但密码错**的账号 → 两者提示完全一致（都是「账号或密码错误」），无法区分账号是否存在；日志/审计里仍有真实原因。
4. 验证码仍直出显示在页面上（本机无短信通道，设计如此）。

**E. P1-10 MCP 令牌作用域（默认行为不变）**
1. 按 AGENTS §1.1 在 Qoder 等客户端调用 `recall_memory` / `write_memory` / `list_projects` → 默认 `['*']` 作用域，行为与之前完全一致（本项目手动验证：召回提示行与折叠明细照常）。
2. 数据根 `memories.db.json` 审计：本批次的 recall 审计正常记录 `client` 字段。

**F. P1-2 / P1-3 回归**
1. 登录后各页面读写记忆、删除记忆、审计页真查 request_id（P0-2）全部正常——preload 自动带会话，无感。
2. 未登录（清 localStorage）直接在控制台调 `window.api.storage.deleteMemory('x')` → 主进程拒绝（日志 `ipc:...` 记录拒绝原因），页面如実报错，不冒充成功。
3. 接入页自动接入（批次16）行为不变；纯浏览器 dev 模式仍如实降级。

**G. P1-11 L0**
1. 管理员在安全页解锁写密钥 → 正常（异步化后解锁期间 UI 不卡顿）。
2. **普通成员**凭会话调「管理员密码直阅」（无 grant 路径）→ 403 需管理员。
3. 授权查阅（grant_id + 一次性密码）流程不受影响。

## 5. 已知边界 / 遗留

1. **P1-2 诚实偏差**：audit 写通道保留内核自报的合法 `request_id`（形状校验挡注入）——因为 P0-2 日志页真查审计依赖该关联键。
2. **P1-10 残留**：MCP 默认作用域 `['*']`；按 team/enterprise 硬过滤需先做账本租户归一（页面身份 / 采集器身份 / MCP 身份三套并存），否则打破召回承诺。
3. **P2-14 残留**：默认口令随首启播种；scryptSync 未异步化（改动面与收益评估见改动清单 P2-14 第 3 条）。
4. **P2-17 残留**：验证码 code 直出（无通道）；注册全文件 JSON 写（P1-5 单独立项）。
5. 内存限速在进程重启后清零（只作爆破减速，不是隔离边界）。
6. P0-8（git 分段提交，需你授权）与 P0-9（CI 实跑）留待批次 27；P1-4/P1-5（内核摘要行 + 审计增长）建议与真实 LLM Provider 一起设计。
