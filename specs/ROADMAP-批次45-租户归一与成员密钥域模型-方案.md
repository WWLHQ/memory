# ROADMAP 批次45+ — 令牌与租户欠账立项（MCP 作用域收紧前置 = 账本租户归一）+ 成员/API 密钥域模型

> 批次41-K 产出（**只出方案，不实现**）。本文件是「立项 + 拆分」，**不含任何代码改动**。
> **总边界（诚实声明）**：这条欠账不处理，**不影响现有数据正确性**——MCP 现在默认 `scope_project_ids=['*']` 全放行、单令牌是机器级凭据，是本仓库**明知且接受**的取舍（批次26-B P1-10 已书面声明）。真正要收紧「按 team/enterprise 硬过滤」之前，必须先做本文件的**账本租户归一**（45-A），否则收紧 = 把 §1.1 的召回承诺打穿。

## 现状（2026-11-03 只读实测，非推测）

| 项 | 当前实测状态 | 证据 |
|---|---|---|
| 渲染层租户 | `getTenant()` 首次调用**现造** `u_<ulid>/team_local/ent_local` 并持久化到 localStorage `mam.tenant.v1`；桌面壳内 `syncTenantFromHost()`（批次26-B P1-3）用会话真值**覆盖**它（改 localStorage 冒充会被纠正）；**纯浏览器/未登录仍走本地现造身份**（每台机器/浏览器各造一个 `user_id`） | `src/web/kernel.ts:53-61/80` |
| 采集器/MCP 租户 | 主进程采集器写账本用的是**硬编码** `u1/t1/e1` 三元组（不是登录会话的三元组） | `src/electron/main.ts` 采集 `WriteCtx` 的 `account`（实测 `user_id:'u1',team_id:'t1',enterprise_id:'e1'`） |
| 结果 | **同一份 `memories.db.json` 里混住多租户身份**：页面写的行带 `u_<ulid>/team_local`，采集器/MCP 写的行带 `u1/t1/e1`。按 team/enterprise 硬过滤会漏召回 / 误隔离 | AGENTS §26-B P1-10「残留风险」 |
| MCP 作用域 | `McpAccount.scope_project_ids` **默认 `['*']`**（`DEFAULT_MCP_ACCOUNT` 冻结，机器级单令牌）；`projectInScope()` 在 recall/write/list 三工具统一校验（HTTP 8204 + TCP 8202 同源），作用域外一律 `McpToolError` 拒绝 | `src/core/memagent/mcpAuth.ts`（56 行）、`mcpScope.test.ts` 8 例 |
| 成员/API 密钥内核域模型 | **暂无**：内核只有 `Account`（写三元组）+ L0 授权（`grantee_user_id`+`scope_project_ids`，L0 专属，非通用多租户）；home 侧 `AccountRecord/AccountView`（admin/member 角色）与内核**未绑定**；「成员/API 密钥表」是**真实空表**（不展示演示行） | AGENTS §9「成员/API 密钥表暂无内核域模型」；`l0vault.ts` L0 grants |

**关键判断**：MCP 作用域收紧（把 `['*']` 换成真实 team/enterprise id 并硬过滤）的**前置**不是改 `projectInScope`（它已写好且已测），而是**让账本里的租户三元组一致且有意义**——这就是 45-A。

## 一、账本租户归一（45-A，MCP scope 收紧的前置）

**目标**：同一份账本里所有行的 `team_id/enterprise_id` 出自**同一个真源**，不再「页面造一个、采集器写一个」。

**拆分建议**
- **45-A1 单一租户真源**：把「租户三元组」的裁决收敛到**登录会话**（`home` 侧）+ 一份数据根级指针（类比 `ledgerDir` 指针的 `tenant.json`：单机安装的**规范三元组**）。三种写者都改为读同一真源：
  - 页面 `kernel.ts`：`syncTenantFromHost` 成功即用它；**浏览器降级**不再现造 `u_<ulid>`，改为读本机规范三元组（缺省时才回落并**明说**是「本机匿名身份」）。
  - 采集器/MCP（`main.ts`）：把硬编码 `u1/t1/e1` 换成数据根规范三元组（或会话三元组），**不再写死**。
- **45-A2 存量归一（备份闸门）**：一次性、可逆、走 `backupBeforeKernelChange` 的迁移，把**历史行**的 `team_id/enterprise_id` 重盖成规范值（`user_id` 可保留原值，`team/enterprise` 归一到规范）；幂等（已归一零写盘），逐行审计。参考批次41-A 审计迁移的「备份失败即拒绝」口径。
- **45-A3 之后才收紧 MCP**：45-A 落地后，把 `DEFAULT_MCP_ACCOUNT.scope_project_ids` 从 `['*']` 改为按规范团队下发（`['*']` 仅留给「本机单租户」默认）；`projectInScope` 的硬过滤此时才是安全的（不再打穿 §1.1 召回）。**本条依赖 41-J 的 42 云端同步**（多机场景）或本机单租户口径（单机场景），须先拍板。

## 二、成员 / API 密钥内核域模型（45-B）

**目标**：内核有真正的「成员」「API 密钥」域模型（§9 欠账），并和 home 侧账号、L0 授权打通。

**拆分建议**
- **45-B1 域模型 + 真实空表**：定义内核 `Member`（`id` / `name` / `role` admin|member / 租户三元组 / `status` active|suspended）与 `ApiKey`（`id` / `owner_member_id` / `secret_hash`（**绝不留明文**，只存哈希 + 首次一次性返回）/ `scope_project_ids` / `created_at` / `revoked_at`），落**真实空表**（沿用「不展示演示行」诚实口径）。
- **45-B2 与既有通道打通**：home 侧 `admin/member` 角色映射到内核 `Member.role`；L0 授权的 `grantee_user_id` 绑定到 `Member.id`（现在 L0 授权已带 `grantee_user_id`+`scope_project_ids`，缺的是「这是个 member」的域）。
- **45-B3 API 密钥进 MCP 门**：把现在**单一机器级 MCP 令牌**升级为「member 的 API key」——每个 key 携带自己的 `scope_project_ids`（复用 45-A 归一后的规范租户 + 45-A3 收紧口径），`mcpAuth.ts` 的 `McpAccount` 由 key 解析而来。**密钥进 `llm-keys.json` 同类的 0600 独立密钥表**（不进日志/审计/URL），轮换/撤销走管理员 + 审计。

## 总排序与风险

1. **45-A 账本租户归一**（是 41-J/42 云端同步 + MCP 收紧的**共同前置**，先做）
2. **45-B 成员/API 密钥域模型**（依赖 45-A 的规范租户；单机可先只做 45-B1 空表 + 45-B2，45-B3 留到多端）
- **红线（沿用批次惯例）**：45-A2 存量归一走备份闸门 + 审计；45-B 密钥零明文落盘、不进日志/审计/URL；任一落地前 `verify` 门禁 + 手测报告。
- **不做的代价（诚实）**：本欠账不处理，MCP 仍是「单令牌 + `['*']` 全放行」，多租户硬隔离做不到；但**单机数据正确性与现有召回不受影响**——所以它可以排在 41-J/42 之后，不阻塞本机功能。
