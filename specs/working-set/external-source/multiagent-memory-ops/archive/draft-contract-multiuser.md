# 多用户隔离契约条款（草案 · 拟作为 §14）

> 状态：草案 v0.1，待讨论
> 范围：在 MCP Extension Contract v1.0（§0–§13）基础上，新增"每用户 `project_id` 约定 + 登录令牌代理"的规范与可选工具。
> 目的：把"每人只看到自己私人记忆 + 共享"固化为可验收的契约，避免各客户端各搞一套导致隔离失效。

## 14.1 问题
当前 `scope_project_ids` 是静态配置（`mcp.json`），无"按登录用户动态发放受限令牌"的机制。要实现"每人只看到自己私人记忆 + 共享"，必须：
- (a) 约定每用户独立 `project_id`；
- (b) 规定登录时由令牌代理 mint 受限令牌。
本条款把这两点固化为契约。

## 14.2 约定：project_id 命名
- `P-shared`：共享池（保留名）。
- `P-<user_id>`：用户私人池（保留前缀 `P-` + 用户登录标识）。
- `P-archive`：归档池（保留名，可选）。
- 业务项目 ID 不得占用上述保留名。

## 14.3 约定：令牌作用域
- 用户 X 的会话令牌必须满足：`scope_project_ids` ⊇ `['P-shared', 'P-<X>']`，且**不得**包含其他用户的私人池 `P-<Y>`（Y≠X）。
- 管理员/审计令牌可含 `P-archive` 与全部池，但不得下发给普通用户。
- 禁止 `['*']` 下发给真实用户会话。

## 14.4 令牌代理（外部组件，规范其接口契约）
令牌代理**不在**记忆 MCP 内实现，但记忆服务与其对接需满足：
- 输入：已认证用户标识 `user_id`、可选 TTL；
- 输出：MCP Bearer 令牌，其 `scope_project_ids` 按 §14.3 计算；
- 需支持 revoke（注销/超时）。

> 记忆服务侧仅需消费令牌并做 `projectInScope` 校验（已有），**无需新增代码**即可支持本隔离模型——前提是代理按约定 mint。

## 14.5 可选新增 MCP 工具：`create_project`（P2）
为让代理/管理员自动化建私人池：
```json
{
  "name": "create_project",
  "description": "创建项目（用于按需开通每用户私人池 P-<user>）。仅管理员令牌可调用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "项目 ID，须符合 §14.2 命名" },
      "kind": { "type": "string", "enum": ["shared","private","archive"], "description": "池类型，决定默认可见性约定" }
    },
    "required": ["project_id","kind"]
  }
}
```
- 内核映射：`storage.createProject({ project_id, kind })`。
- 权限：仅 `scope_project_ids` 含 `'*'` 或显式 admin 声明的管理员令牌可调用（复用既有管理员判定）。

## 14.6 验收用例（契约级）
1. **私人隔离**：用户 u1 令牌（`['P-shared','P-u1']`）recall `P-u2` → 报错"作用域不含项目 P-u2"；recall `P-u1` 与 `P-shared` 成功。
2. **共享可达**：u1、u2 都能 recall `P-shared` 同一批记忆。
3. **命名约束**：`create_project` 用保留名 `P-shared` 新建 → 拒绝或幂等复用，不覆盖既有共享池。
4. **反模式拦截**：任何用户令牌不得含他人私人池；静态 `['*']` 不得下发给用户会话（部署检查项）。
5. **生命周期**：撤销 uX 令牌 + 将 `P-uX` 迁移至 `P-archive` 后，无任何用户令牌能 recall `P-uX`。

## 14.7 内核落点
| 位置 | 改动 |
|---|---|
| `mcpAuth.ts` | `projectInScope` 维持；对保留名 `P-shared`/`P-archive` 的语义约定文档化（无逻辑改动） |
| `storage` | 新增 `createProject`（仅 §14.5 启用时） |
| 令牌代理 | **外部实现**，记忆服务不改动 |

## 14.8 不变式与 L1 分流实施（已定：混合 + 默认 P-shared）
- **不变式**：`P-shared` 仅接收脱敏后的 L1；分流步骤只消费 L1 产物，绝不消费 L0。管线须保证"脱敏先于分流"。
- **L1 分流（混合路径）**：
  - 显式意图 `for='team'` / `for='me'` → 直接定 `project_id`；
  - 无意图 → 管线按 `category` + 残留个人标记自动定 `project_id`；
  - 低置信 → Agent 向用户确认。
  - 决策树与兜底方向见 SOP §16.6.2（兜底已定 = `P-shared`）。
- **内核落点补充**：精炼管线新增 `routeL1()` 阶段，在脱敏之后、持久化之前为 L1 记录打 `project_id`；该阶段消费 L1 产物，天然满足不变式。

## 14.9 待讨论点
> 已定：L0 不进任何池（保密归档）；L1 分流 = 混合路径、兜底 `P-shared`（见 §14.8）。
1. `create_project` 是否纳入本期？还是先用外部脚本/管理端建池、MCP 暂不开？
2. 令牌代理是记忆服务内置还是纯外部？内置可统一鉴权，但增加攻击面。
3. 是否需要 `scope='user+shared'` 一次性 recall（见 SOP §16.9）？若加，需扩展 `recall_memory`（类似 §6 的 `scope='session'`）。
4. 私人池是否允许 uX 自己跨设备/跨 Agent 共享（`P-u1` 对 u1 的所有 Agent 都可见）——当前设计"按人而不按设备"，需确认是否符合预期。
5. 管理员令牌的"admin 声明"如何签发？是否复用 §14.3 的作用域模型 + 一个 `is_admin` 标记？
6. 脱敏闸门强度（对应 SOP §16.9 原 NQ3）：规则化匹配 vs 模型辅助？是否对高风险加人工复核？
